const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {aiConnectionStatus}=require('../desktop/ai-connections.cjs');

async function fixture(t){
 const output=path.resolve(__dirname,'../output/ai-tests');await fs.mkdir(output,{recursive:true});const home=await fs.mkdtemp(path.join(output,'fixture-'));
 t.after(()=>fs.rm(home,{recursive:true,force:true}));
 const env={PATH:path.join(home,'bin'),PATHEXT:'.EXE;.CMD',APPDATA:path.join(home,'Roaming'),LOCALAPPDATA:path.join(home,'Local')};
 const write=async(file,text='')=>{await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,text)};
 const binary=path.join(home,'runtime.exe'),entry=path.join(home,'Lettide #1','backend','src','mcp.js');await write(binary);await write(entry);
 const target={command:binary,args:[entry],env:{ELECTRON_RUN_AS_NODE:'1'}};
 const codex=path.join(home,'.codex','config.toml'),code=path.join(home,'.claude.json'),desktop=path.join(env.APPDATA,'Claude','claude_desktop_config.json');
 const toml=()=>`[mcp_servers.lettide]\ncommand = ${JSON.stringify(binary)}\nargs = [\n ${JSON.stringify(entry)}, # inline comment\n]\n[mcp_servers.lettide.env]\nELECTRON_RUN_AS_NODE = "1"\n`;
 const config=()=>JSON.stringify({unrelated:{secret:'fixture-secret-must-not-escape'},mcpServers:{lettide:target}});
 const registeredPackages=[];
 const install=async()=>{await write(path.join(env.PATH,'codex.cmd'));await write(path.join(env.PATH,'claude.exe'));await write(path.join(env.LOCALAPPDATA,'AnthropicClaude','Claude.exe'))};
 return {home,env,write,target,binary,entry,codex,code,desktop,toml,config,install,registeredPackages,status:()=>aiConnectionStatus({home,env,registeredPackages}),states:async()=>Object.fromEntries((await aiConnectionStatus({home,env,registeredPackages})).map(row=>[row.id,row.state]))};
}
const windows={skip:process.platform!=='win32'};
test('missing clients, installed clients without configuration, and valid live connections',windows,async t=>{
 const f=await fixture(t);assert.deepEqual(await f.states(),{codex:'not-installed','claude-code':'not-installed','claude-desktop':'not-installed'});
 await f.install();assert.deepEqual(await f.states(),{codex:'disconnected','claude-code':'disconnected','claude-desktop':'disconnected'});
 await f.write(f.codex,f.toml());await f.write(f.code,f.config());await f.write(f.desktop,f.config());assert.deepEqual(await f.states(),{codex:'connected','claude-code':'connected','claude-desktop':'connected'});
 assert.ok(!JSON.stringify(await f.status()).includes('fixture-secret'));assert.ok(!JSON.stringify(await f.status()).includes(f.home));
 await fs.rm(f.entry);assert.ok(Object.values(await f.states()).every(state=>state==='disconnected'));
});
test('missing launch command, disabled entries, unrelated MCP entries and invalid JSON are not connected',windows,async t=>{
 const f=await fixture(t);await f.install();await f.write(f.codex,f.toml());await f.write(f.code,f.config());await f.write(f.desktop,'{ "secret": "fixture-secret", invalid json');
 assert.equal((await f.status()).find(row=>row.id==='claude-desktop').reason,'invalid');
 await fs.rm(f.binary);assert.equal((await f.states()).codex,'disconnected');await f.write(f.binary);
 await f.write(f.codex,f.toml().replace('command =','enabled = false\ncommand ='));assert.equal((await f.states()).codex,'disconnected');
 await f.write(f.codex,f.toml().replace('[mcp_servers.lettide]','[mcp_servers.another]'));assert.equal((await f.states()).codex,'disconnected');
 await f.write(f.code,JSON.stringify({mcpServers:{another:f.target}}));assert.equal((await f.states())['claude-code'],'disconnected');
 assert.ok(!JSON.stringify(await f.status()).includes('fixture-secret'));
});
test('Codex quoted keys, literal paths and multiline args are read; commented tables are not',windows,async t=>{
 const f=await fixture(t);await f.install();
 await f.write(f.codex,`# [mcp_servers.lettide]\n["mcp_servers".'lettide']\ncommand = '${f.binary}'\nargs = [\n '${f.entry}',\n]\n`);assert.equal((await f.states()).codex,'connected');
 await f.write(f.codex,`# [mcp_servers.lettide]\n# command = '${f.binary}'\n# args = ['${f.entry}']\n`);assert.equal((await f.states()).codex,'disconnected');
});
test('MSIX Claude configuration is checked in addition to the legacy location',windows,async t=>{
 const f=await fixture(t);const packaged=path.join(f.env.LOCALAPPDATA,'Packages','Claude_fixture','LocalCache','Roaming','Claude','claude_desktop_config.json');
 f.registeredPackages.push({PackageFamilyName:'Claude_fixture'});
 await f.write(packaged,JSON.stringify({mcpServers:{}}));await f.write(f.desktop,f.config());assert.equal((await f.states())['claude-desktop'],'disconnected');
 await f.write(packaged,f.config());assert.equal((await f.states())['claude-desktop'],'connected');
 await fs.rm(f.desktop);assert.equal((await f.states())['claude-desktop'],'connected');
 await f.write(f.desktop,'invalid old config');assert.equal((await f.states())['claude-desktop'],'connected');
 await f.write(path.join(f.env.LOCALAPPDATA,'Packages','Claude_old','unused'),'');assert.equal((await f.states())['claude-desktop'],'connected');
 await f.write(packaged,f.config().replaceAll('mcp.js','missing.js'));assert.equal((await f.states())['claude-desktop'],'disconnected');
});
test('config-only leftovers do not count as an installed CLI',windows,async t=>{
 const f=await fixture(t);await f.write(f.codex,f.toml());await f.write(f.code,f.config());await f.write(f.desktop,f.config());assert.ok(Object.values(await f.states()).every(state=>state==='not-installed'));
});
test('Codex uses CODEX_HOME when it is set',windows,async t=>{
 const f=await fixture(t);await f.install();f.env.CODEX_HOME=path.join(f.home,'custom-codex');await f.write(f.codex,f.toml());assert.equal((await f.states()).codex,'disconnected');
 await f.write(path.join(f.env.CODEX_HOME,'config.toml'),f.toml());assert.equal((await f.states()).codex,'connected');
});
