import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import {Client} from '../backend/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import {StdioClientTransport} from '../backend/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const exe=process.env.LETTIDE_TEST_EXECUTABLE||path.join(root,'output/desktop/win-unpacked/Lettide.exe');
const entry=path.join(path.dirname(exe),'resources/backend/src/mcp.js');
const output=path.join(root,'output/desktop-checks');await mkdir(output,{recursive:true});
const client=new Client({name:'lettide-local-check',version:'1.0.0'});
const transport=new StdioClientTransport({command:exe,args:[entry],env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stderr:'pipe'});
const checks=[];
try{
 await client.connect(transport);
 const {tools}=await client.listTools();
 assert.ok(['mail_accounts_list','mail_read','mail_search','mail_sync','mail_draft_create','mail_draft_prepare_send','mail_draft_confirm_send','mail_translation_jobs','mail_translation_complete'].every(n=>tools.some(t=>t.name===n)));
 const accounts=await client.callTool({name:'mail_accounts_list',arguments:{}});
 assert.equal(accounts.isError,undefined);assert.ok(Array.isArray(JSON.parse(accounts.content[0].text)));
 checks.push('Packaged Electron runtime starts MCP and authenticates the shared local backend; all 9 tools available');
}finally{await client.close();}
const {_electron}=await import(pathToFileURL(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')).href);
const app=await _electron.launch({executablePath:exe,args:[],env:Object.fromEntries(Object.entries(process.env).filter(([k])=>k!=='ELECTRON_RUN_AS_NODE')),timeout:40000});
try{
 const page=await app.firstWindow();await page.getByRole('heading',{name:'收件箱',exact:true}).waitFor();
 assert.equal(await page.title(),'叠信 · Lettide');
 assert.deepEqual(await page.evaluate(()=>({require:typeof window.require,node:typeof window.process,desktop:window.lettide?.desktop})),{require:'undefined',node:'undefined',desktop:true});
 checks.push('Actual packaged Windows window loads with isolated context and no renderer Node access');
 await page.getByRole('button',{name:'日间',exact:true}).click();
 await page.screenshot({path:path.join(output,'叠信日间.jpg'),type:'jpeg',quality:92,animations:'disabled'});
 await page.getByRole('button',{name:'夜间',exact:true}).click();
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('.nav-item.active')).backgroundColor==='rgb(45, 60, 89)');
 await page.screenshot({path:path.join(output,'叠信夜间.jpg'),type:'jpeg',quality:92,animations:'disabled'});
 await page.reload();assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
 checks.push('Native window supports day/night and remembers the chosen appearance');
 await page.getByRole('button',{name:'添加邮箱',exact:true}).first().click();
 const dialog=page.getByRole('dialog',{name:'添加邮箱'});
 await dialog.getByRole('combobox').selectOption('microsoft');
 await dialog.getByRole('button',{name:/连接 Microsoft 账号/}).click();
 await dialog.getByRole('alert').getByText('请先在连接设置中填写对应平台的 OAuth 应用信息。').waitFor();
 await dialog.getByRole('button',{name:'关闭',exact:true}).click();
 checks.push('GoDaddy Microsoft 365 connection has an inline first-setup prompt and keeps the desktop window');
 await page.getByRole('button',{name:'日间',exact:true}).click();
 await writeFile(path.join(output,'checks.json'),JSON.stringify({checks,checkedAt:new Date().toISOString(),liveMailboxesVerified:false},null,2));
 console.log(JSON.stringify({passed:checks.length,checks}));
}finally{await app.close();}
