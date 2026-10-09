import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const home=os.homedir(),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const appData=path.join(home,'Library','Application Support','Lettide');
const backupRoot=path.join(appData,'config-backups',new Date().toISOString().replace(/[:.]/g,'-'));
const dryRun=process.argv.includes('--dry-run');

function findCommand(name){
  const dirs=(process.env.PATH||'').split(path.delimiter);
  for(const dir of dirs){const candidate=path.join(dir,name);if(existsSync(candidate))return candidate;}
  return null;
}
async function backup(file,label){
  if(dryRun)return;
  try{const data=await fs.readFile(file);await fs.mkdir(backupRoot,{recursive:true,mode:0o700});await fs.writeFile(path.join(backupRoot,label),data,{mode:0o600,flag:'wx'});}catch(e){if(e.code!=='ENOENT')throw new Error(`Unable to back up ${label}; configuration was not changed`);}
}
function run(exe,args,label){
  if(dryRun){console.log(`${label}: would configure`);return;}
  const result=spawnSync(exe,args,{stdio:'inherit',env:process.env});
  if(result.error||result.status!==0)throw new Error(`${label} configuration failed${result.error?`: ${result.error.message}`:''}`);
}
function mcpTarget(){
  const executable=process.env.LETTIDE_EXECUTABLE;
  const entry=process.env.LETTIDE_MCP_ENTRY||(executable?path.resolve(path.dirname(executable),'..','Resources','backend','src','mcp.js'):path.join(root,'backend','src','mcp.js'));
  const command=executable||process.execPath;
  return {command,args:[entry],env:executable?{ELECTRON_RUN_AS_NODE:'1'}:{}};
}
export function mergeClaudeDesktopConfig(existing,target){
  const config=existing?JSON.parse(existing):{};
  if(!config||Array.isArray(config)||typeof config!=='object')throw new Error('Claude Desktop configuration must be a JSON object');
  if(config.mcpServers===undefined)config.mcpServers={};
  if(!config.mcpServers||Array.isArray(config.mcpServers)||typeof config.mcpServers!=='object')throw new Error('Claude Desktop mcpServers must be a JSON object');
  config.mcpServers.lettide=target;
  return `${JSON.stringify(config,null,2)}\n`;
}
async function configureDesktop(target){
  const file=path.join(home,'Library','Application Support','Claude','claude_desktop_config.json');
  let old=null;try{old=await fs.readFile(file,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
  if(!old&&!await exists(path.dirname(file))){console.log('Claude Desktop configuration directory not found; skipped.');return;}
  let next;try{next=mergeClaudeDesktopConfig(old,target);}catch{throw new Error('Claude Desktop configuration is invalid; original file was not changed');}
  await backup(file,'claude_desktop_config.json');
  if(dryRun){console.log('Claude Desktop: would configure');return;}
  await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
  const temp=`${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp,next,{encoding:'utf8',mode:0o600,flag:'wx'});
  try{await fs.rename(temp,file);}catch(e){await fs.rm(temp,{force:true});throw e;}
}
async function exists(file){try{await fs.access(file);return true;}catch{return false;}}
async function main(){
  const target=mcpTarget();
  if(!(await exists(target.command)))throw new Error('Lettide executable not found; set LETTIDE_EXECUTABLE or install Node.js.');
  if(!(await exists(target.args[0])))throw new Error('Lettide MCP entry not found; set LETTIDE_MCP_ENTRY.');
  const codex=findCommand('codex');
  if(codex){await backup(path.join(home,'.codex','config.toml'),'codex-config.toml');const args=['mcp','add','lettide'];if(target.env.ELECTRON_RUN_AS_NODE)args.push('--env','ELECTRON_RUN_AS_NODE=1');args.push('--',target.command,...target.args);run(codex,args,'Codex');}
  else console.log('Codex CLI not found; skipped.');
  const claude=findCommand('claude');
  if(claude){const configFile=path.join(home,'.claude.json');await backup(configFile,'claude-code.json');let hasEntry=false;try{const config=JSON.parse(await fs.readFile(configFile,'utf8'));hasEntry=Boolean(config?.mcpServers?.lettide);}catch(error){if(error.code!=='ENOENT')throw new Error('Claude Code configuration is invalid; original file was not changed');}if(dryRun)console.log('Claude Code: would configure');else if(hasEntry)run(claude,['mcp','remove','lettide','--scope','user'],'Claude Code removal');const args=['mcp','add','--scope','user','--transport','stdio','lettide'];if(target.env.ELECTRON_RUN_AS_NODE)args.push('--env','ELECTRON_RUN_AS_NODE=1');args.push('--',target.command,...target.args);run(claude,args,'Claude Code');}
  else console.log('Claude Code CLI not found; skipped.');
  await configureDesktop(target);
  console.log(dryRun?'Precheck complete; no configuration was changed.':'AI client configuration complete.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
