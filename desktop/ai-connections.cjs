const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {execFile}=require('node:child_process');

function windowsPackages(){
 // Package data folders survive uninstall. Ask Windows which packages are
 // registered for this user; never infer installation from leftover settings.
 const script="$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.Encoding]::UTF8; @(Get-AppxPackage -Name Claude; Get-AppxPackage -Name OpenAI.Codex) | Select-Object PackageFamilyName | ConvertTo-Json -Compress";
 return new Promise((resolve,reject)=>execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:8000,maxBuffer:32768},(error,stdout)=>{if(error)return reject(Error('Could not check installed AI clients'));try{const value=stdout.trim()?JSON.parse(stdout):[];resolve(Array.isArray(value)?value:[value])}catch{reject(Error('Could not check installed AI clients'))}}));
}

// Only the [mcp_servers.lettide] table decides the status: its command, any
// quoted path in it (args may span lines) and an explicit enabled = false.
function codexEntry(text){
 let inTable=false,found=false,command,enabled=true;const args=[];
 for(const raw of text.split(/\r?\n/)){
  const line=raw.trim();if(!line||line.startsWith('#'))continue;
  const header=line.match(/^\[\s*([^\]]+?)\s*\]/);
  if(header){const keys=header[1].split('.').map(key=>key.trim().replace(/^["']|["']$/g,''));inTable=keys.length===2&&keys[0]==='mcp_servers'&&keys[1]==='lettide';found||=inTable;continue}
  if(!inTable)continue;
  const values=[...line.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)].map(m=>m[2]??m[1].replace(/\\(.)/g,'$1'));
  if(/^command\s*=/.test(line))command=values[0];else if(/^enabled\s*=\s*false\b/.test(line))enabled=false;else args.push(...values);
 }
 return found?{command,args,enabled}:null;
}

async function aiConnectionStatus({platform=process.platform,home=os.homedir(),env=process.env,registeredPackages}={}){
 const p=platform==='win32'?path.win32:path.posix;
 const exists=async file=>{try{return (await fs.stat(file)).isFile()}catch{return false}};
 const directory=async file=>{try{return (await fs.stat(file)).isDirectory()}catch{return false}};
 const anyFile=async files=>(await Promise.all(files.map(exists))).some(Boolean);
 const appData=env.APPDATA||p.join(home,'AppData','Roaming'),local=env.LOCALAPPDATA||p.join(home,'AppData','Local');
 const packages=platform==='win32'?(registeredPackages||await windowsPackages()):[];
 const packageDirs=prefix=>packages.filter(item=>item.PackageFamilyName?.toLowerCase().startsWith(prefix)).map(item=>p.join(local,'Packages',item.PackageFamilyName));
 const codexPackages=packageDirs('openai.codex_'),claudePackages=packageDirs('claude_');
 const findCommand=async command=>{
  if(typeof command!=='string'||!command)return false;
  const expanded=command.startsWith('~/')||command.startsWith('~\\')?p.join(home,command.slice(2)):command;
  if(p.isAbsolute(expanded))return exists(expanded);
  if(/[\\/]/.test(expanded))return false;
  const suffixes=platform==='win32'?['',...(env.PATHEXT||'.COM;.EXE;.BAT;.CMD').split(';')]:[''];
  const dirs=[...(env.PATH||env.Path||'').split(platform==='win32'?';':':').filter(Boolean),p.join(home,'.local','bin'),p.join(home,'.cargo','bin')];
  if(platform==='win32')dirs.push(p.join(appData,'npm'));else dirs.push('/usr/local/bin','/opt/homebrew/bin');
  return anyFile(dirs.flatMap(dir=>suffixes.map(suffix=>p.join(dir.replace(/^"|"$/g,''),expanded+suffix))));
 };
 const desktopFiles=platform==='win32'?[p.join(appData,'Claude','claude_desktop_config.json'),...claudePackages.map(dir=>p.join(dir,'LocalCache','Roaming','Claude','claude_desktop_config.json'))]:[platform==='darwin'?p.join(home,'Library','Application Support','Claude','claude_desktop_config.json'):p.join(env.XDG_CONFIG_HOME||p.join(home,'.config'),'Claude','claude_desktop_config.json')];
 const applications=platform==='darwin'?['/Applications',p.join(home,'Applications')]:[];
 const clients=[
  {id:'codex',files:[p.join(env.CODEX_HOME||p.join(home,'.codex'),'config.toml')],installed:await findCommand('codex')||codexPackages.length>0||await anyFile([p.join(local,'Programs','Codex','Codex.exe')])||(await Promise.all(applications.map(dir=>directory(p.join(dir,'Codex.app'))))).some(Boolean)},
  {id:'claude-code',files:[p.join(home,'.claude.json')],installed:await findCommand('claude')},
  {id:'claude-desktop',files:desktopFiles,installed:claudePackages.length>0||await anyFile([p.join(local,'AnthropicClaude','Claude.exe'),p.join(local,'Programs','Claude','Claude.exe')])||(await Promise.all(applications.map(dir=>directory(p.join(dir,'Claude.app'))))).some(Boolean)}
 ];
 const connected=async entry=>{
  if(!entry||entry.enabled===false||!await findCommand(entry.command)||!Array.isArray(entry.args))return false;
  for(const arg of entry.args){if(typeof arg!=='string')continue;const file=arg.startsWith('~/')||arg.startsWith('~\\')?p.join(home,arg.slice(2)):arg;if(p.isAbsolute(file)&&/[\\/]backend[\\/]src[\\/]mcp\.js$/i.test(file)&&await exists(file))return true}
  return false;
 };
 return Promise.all(clients.map(async client=>{
  const reasons=[],connections=[];
  for(const file of client.files){
   let text;try{text=(await fs.readFile(file,'utf8')).replace(/^\uFEFF/,'')}catch(error){reasons.push(error.code==='ENOENT'?undefined:'unreadable');connections.push(false);continue}
   try{const entry=client.id==='codex'?codexEntry(text):JSON.parse(text)?.mcpServers?.lettide;connections.push(await connected(entry));reasons.push(undefined)}catch{reasons.push('invalid');connections.push(false)}
  }
  // Both Claude Desktop locations can be active. A stale/invalid one must not
  // hide an unconnected MSIX client behind a connected legacy configuration.
  const hasConnection=client.id==='claude-desktop'&&claudePackages.length?connections.slice(1).every(Boolean):connections.some(Boolean);
  const reason=(client.id==='claude-desktop'&&claudePackages.length?reasons.slice(1):reasons).find(Boolean);
  return {id:client.id,state:client.installed?(hasConnection&&!reason?'connected':'disconnected'):'not-installed',...(client.installed&&reason?{reason}:{})};
 }));
}
module.exports={aiConnectionStatus};
