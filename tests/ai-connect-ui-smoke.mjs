import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {Store} from '../backend/src/store.js';
import {createApp} from '../backend/src/server.js';

// All state, profiles and screenshots stay inside this worktree. The desktop
// bridge is a fixture: this test never configures installed AI clients.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),output=path.join(root,'output/ai-connect');await mkdir(output,{recursive:true});
const dir=await mkdtemp(path.join(output,'fixture-'));
const pw=process.env.PLAYWRIGHT_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const {chromium}=await import(pathToFileURL(pw).href);
const store=await new Store({file:path.join(dir,'state'),codec:{protect:async x=>x,unprotect:async x=>x}}).open();
await store.mutate(s=>{s.accounts=[{id:'fictional',provider:'qq',name:'Fictional reader',email:'reader@example.test',folders:[{id:'inbox',role:'inbox'}],foldersSyncedAt:new Date().toISOString()}];});
const port=47964,service=await createApp({store,port,mailSyncer:async()=>[],folderLister:async()=>[],mailSender:async()=>{throw Error('No mail sending in this fixture')}}),server=createServer(service);
let browser;const checks=[],errors=[];
try{
 await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
 browser=await chromium.launch({headless:true,channel:'msedge'});
 const context=await browser.newContext({viewport:{width:1100,height:850},locale:'zh-CN'});
 await context.addInitScript(()=>{
  localStorage.setItem('lettide-language','zh-CN');
  localStorage.setItem('mail-theme','light');
  window.__rows=[{id:'codex',state:'connected'},{id:'claude-code',state:'disconnected'},{id:'claude-desktop',state:'connected'}];window.__reads=0;window.__writes=0;
  window.lettide={desktop:true,aiConnectionStatus:async()=>{window.__reads++;if(window.__readError)throw Error('fixture');return window.__rows},configureAI:async()=>{window.__writes++;if(window.__failure)return {ok:false,error:window.__failure};window.__rows=window.__rows.map(row=>row.state==='disconnected'?{...row,state:'connected'}:row);return {ok:true}}};
  Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{if(window.__copyError)throw Error('denied');window.__copied=text}}});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${port}/`);
 await page.getByRole('button',{name:'AI 连接',exact:true}).click();let modal=page.getByRole('dialog',{name:'连接 AI 助手'});await modal.locator('.ai-status.connected').first().waitFor();
 assert.deepEqual(await modal.locator('.integration-row h3').allTextContents(),['Codex','Claude Code','Claude 桌面端']);
 assert.deepEqual(await modal.locator('.ai-status').allTextContents(),['已连接','未连接','已连接']);assert.equal(await modal.getByText('让助手帮你',{exact:true}).count(),0);assert.equal(await modal.locator('.integration-row button,.integration-row>svg').count(),0);
 await page.screenshot({path:path.join(output,'中文日间.png')});checks.push('Three independent states; no decorative link buttons or example block');
 await modal.getByRole('button',{name:'复制连接指令',exact:true}).click();await modal.getByRole('button',{name:'已复制',exact:true}).waitFor();
 const copied=await page.evaluate(()=>window.__copied),target=JSON.parse(copied.slice(copied.indexOf('{'))).mcpServers.lettide;
 const actual=await page.evaluate(async()=>await(await fetch('/api/integrations')).json());
 assert.equal(target.command,actual.mcp.command);assert.deepEqual(target.args,actual.mcp.args);assert.equal(target.env.ELECTRON_RUN_AS_NODE,'1');assert.equal(target.env.LETTIDE_DATA_DIR,actual.dataDirectory);assert.ok(copied.includes('重启'));checks.push('Chinese instructions copy real command and args with Electron environment and the same mailbox data directory');
 await modal.getByRole('button',{name:'复制连接指令',exact:true}).waitFor();
 await modal.getByRole('button',{name:'一键连接',exact:true}).click();await modal.getByRole('status').getByText('已连接 Claude Code，重启它后生效。',{exact:true}).waitFor();
 assert.equal(await modal.getByRole('button',{name:'一键连接',exact:true}).isDisabled(),true);assert.equal(await page.evaluate(()=>window.__reads),2);checks.push('Setup rereads status, names newly connected client and disables when complete');
 await modal.getByRole('button',{name:'关闭',exact:true}).click();await page.evaluate(()=>{window.__rows=[{id:'codex',state:'not-installed'},{id:'claude-code',state:'not-installed'},{id:'claude-desktop',state:'not-installed'}]});
 await page.getByRole('button',{name:'AI 连接',exact:true}).click();await modal.getByText('未安装',{exact:true}).first().waitFor();assert.equal(await modal.getByRole('button',{name:'一键连接',exact:true}).isDisabled(),true);checks.push('Opening again refreshes state; no installed clients disables setup');
 await modal.getByRole('button',{name:'关闭',exact:true}).click();await page.evaluate(()=>{window.__rows[1].state='disconnected';window.__failure='permission-denied'});
 await page.getByRole('button',{name:'夜间',exact:true}).click();await page.getByRole('button',{name:'AI 连接',exact:true}).click();await modal.getByText('未连接',{exact:true}).waitFor();await modal.getByRole('button',{name:'一键连接',exact:true}).click();await modal.getByRole('alert').getByText('没有权限更新客户端配置，请检查文件权限。',{exact:true}).waitFor();await page.screenshot({path:path.join(output,'中文夜间.png')});checks.push('Setup failures are readable in the dark theme');
 await modal.getByRole('button',{name:'关闭',exact:true}).click();await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('combobox',{name:'界面语言',exact:true}).selectOption('en');await page.getByRole('button',{name:'Close',exact:true}).click();
 await page.getByRole('button',{name:'AI connections',exact:true}).click();modal=page.getByRole('dialog',{name:'Connect AI assistants'});await modal.getByRole('button',{name:'Copy setup instructions',exact:true}).click();await modal.getByRole('button',{name:'Copied',exact:true}).waitFor();assert.ok((await page.evaluate(()=>window.__copied)).startsWith('Add the local email tool Lettide'));await modal.getByText('Claude Desktop',{exact:true}).waitFor();await page.screenshot({path:path.join(output,'English-dark.png')});checks.push('English client names, instructions and feedback are translated');
 await modal.getByRole('button',{name:'Close',exact:true}).click();await page.evaluate(()=>{delete window.lettide});await page.getByRole('button',{name:'AI connections',exact:true}).click();await modal.getByText('Run “连接AI助手.cmd” in the project folder.',{exact:true}).waitFor();assert.equal(await modal.getByRole('button',{name:'Connect automatically',exact:true}).count(),0);checks.push('Browser fallback remains available without desktop bridge');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:checks.length,checks,output}));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await service.locals.localTranslator?.close();await store.close();await rm(dir,{recursive:true,force:true})}
