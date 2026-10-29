import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';
import {Store} from '../backend/src/store.js';import {createApp} from '../backend/src/server.js';
const {chromium}=await import(pathToFileURL(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')).href);
const dir=await mkdtemp(path.join(os.tmpdir(),'lettide-sync-')),store=await new Store({file:path.join(dir,'state'),codec:{protect:async x=>x,unprotect:async x=>x}}).open();
await store.mutate(s=>{s.accounts=[{id:'qq',name:'Personal QQ',email:'personal@example.test',provider:'qq',folders:[{id:'inbox',role:'inbox',accountId:'qq'}]},{id:'gmail',name:'Work Gmail',email:'work@example.test',provider:'gmail',lastSync:'2026-10-10T12:00:00Z',folders:[{id:'inbox',role:'inbox',accountId:'gmail'},{id:'archive',role:'archive',accountId:'gmail'}]}]});
let release,fail=true,bodyReads=0;const gate=new Promise(r=>release=r),port=47949;
const app=await createApp({store,port,folderLister:async(_s,a)=>a.folders,localTranslator:{status:async()=>({state:'not_downloaded'})},mailSyncer:async(s,a)=>{if(a.id==='qq'){await gate;if(fail)throw Error('Fictional timeout');s.messages=[{id:'qq-mail',accountId:a.id,folder:'inbox',folderIds:['inbox'],subject:'Fictional QQ message',text:'',bodyLoaded:false,date:new Date().toISOString(),from:{name:'Example sender',address:'sender@example.test'},unread:false}];a.lastSync=new Date().toISOString()}},messageLoader:async(_s,m)=>{bodyReads++;await new Promise(r=>setTimeout(r,400));m.text='Meeting tomorrow.';m.bodyLoaded=true},messageUpdater:async()=>{}}),server=createServer(app);
await new Promise(r=>server.listen(port,'127.0.0.1',r));const browser=await chromium.launch({headless:true,channel:'msedge'}),page=await browser.newPage({locale:'zh-CN',viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto('http://127.0.0.1:'+port);await page.getByText('正在同步邮件…',{exact:true}).first().waitFor();assert.equal(await page.getByText('这里还没有邮件',{exact:true}).count(),0);
 release();await page.getByRole('alert').waitFor();assert.match(await page.getByRole('alert').innerText(),/同步失败/);
 await page.getByRole('button',{name:'切换邮箱',exact:true}).click();await page.getByRole('button',{name:/Personal QQ/}).click();await page.getByRole('button',{name:'同步邮件',exact:true}).waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelector('[aria-label="同步邮件"]').disabled);
 assert.equal(await page.locator('.sidebar-navigation').getByRole('button',{name:'归档',exact:true}).count(),0);assert.equal(await page.locator('.list-header h1').innerText(),'收件箱');assert.match(await page.locator('.list-footer').innerText(),/连接暂时中断，正在自动重试/);
 fail=false;await page.getByRole('button',{name:'关闭提示',exact:true}).click();await page.getByRole('button',{name:'同步邮件',exact:true}).click();await page.getByRole('button',{name:/Example sender.*Fictional QQ/}).click();
 await page.getByText('正在加载正文…',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'译文',exact:true}).isDisabled(),true);await page.getByText('Meeting tomorrow.',{exact:true}).last().waitFor();assert.equal(bodyReads,1);
 assert.equal(await page.locator('.reader-toolbar').getByRole('button',{name:'归档',exact:true}).count(),0);assert.equal(await page.locator('.move-select option[value="archive"]').count(),0);
 await page.locator('.message-detail').click({button:'right'});assert.equal(await page.getByRole('menuitem',{name:'归档',exact:true}).count(),0);await page.keyboard.press('Escape');
 await mkdir('output/playwright',{recursive:true});await page.screenshot({path:'output/playwright/qq-sync-fictional.png'});
 await page.getByRole('button',{name:'切换邮箱',exact:true}).click();await page.getByRole('button',{name:/Work Gmail/}).click();await page.locator('.sidebar-navigation').getByRole('button',{name:'归档',exact:true}).waitFor();
 assert.deepEqual(errors,[]);const result={passed:8,fictionalOnly:true,checks:['Message opens on demand and translation waits for its body','Syncing does not look like an empty inbox','Automatic sync failure is visible','Manual retry loads mail','QQ archive absent from navigation, toolbar, move selector and context menu','Gmail archive remains available','Inbox title is localized','Sync timestamp belongs to selected account'],errors};await writeFile('output/sync-ui-checks.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{release();await browser.close();await new Promise(r=>server.close(r));await store.close();await rm(dir,{recursive:true,force:true})}
