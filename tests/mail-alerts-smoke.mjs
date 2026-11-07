import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {Store} from '../backend/src/store.js';
import {createApp} from '../backend/src/server.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const pw=process.env.PLAYWRIGHT_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const {_electron}=await import(pathToFileURL(pw).href);
const dir=await mkdtemp(path.join(os.tmpdir(),'lettide-alerts-'));
const store=await new Store({file:path.join(dir,'state'),codec:{protect:async x=>x,unprotect:async x=>x}}).open();
const now=new Date().toISOString();
const mail=(id,sender,subject)=>({id,accountId:'fixture-account',folder:'inbox',subject,from:{name:sender,address:`${sender.toLowerCase()}@example.com`},to:[{address:'work@example.com'}],date:new Date().toISOString(),text:'Fictional content only',textFormat:2,bodyLoaded:true,unread:true,starred:false,providerRef:{type:'fixture'},attachments:[]});
await store.mutate(s=>{s.accounts=[{id:'fixture-account',name:'Fixture',email:'fixture@example.com',provider:'imap',verifiedAt:now,lastSync:now}];s.messages=[mail('old-unread','Ava','Already waiting')];});
const port=47946,service=await createApp({store,port,folderLister:async()=>[],mailSyncer:async()=>[],mailSender:async()=>{throw new Error('No live mail allowed')}}),server=createServer(service);
await new Promise(r=>server.listen(port,'127.0.0.1',r));
const env={...process.env,LETTIDE_TEST_BASE_URL:`http://127.0.0.1:${port}`,LETTIDE_TEST_USER_DATA:path.join(dir,'profile')};delete env.ELECTRON_RUN_AS_NODE;
const app=await _electron.launch({executablePath:path.join(root,'desktop/node_modules/electron/dist',process.platform==='win32'?'electron.exe':'Electron.app/Contents/MacOS/Electron'),args:[path.join(root,'desktop')],env,timeout:40000});
const checks=[];
const waitFor=async(test,ms=40000)=>{const end=Date.now()+ms;while(Date.now()<end){const v=await test();if(v)return v;await new Promise(r=>setTimeout(r,500));}throw new Error('Timed out');};
try{
 // Record notifications and tray tooltips instead of showing them on the desktop.
 await app.evaluate(({Notification,Tray})=>{globalThis.__notes=[];Notification.prototype.show=function(){globalThis.__notes.push(this)};const tip=Tray.prototype.setToolTip;Tray.prototype.setToolTip=function(text){globalThis.__tip=text;return tip.call(this,text)}});
 const page=await app.firstWindow();await page.getByRole('heading',{name:'收件箱',exact:true}).waitFor();
 await page.getByRole('button',{name:'设置',exact:true}).click();
 const toggle=page.getByRole('checkbox',{name:/新邮件提醒/});await toggle.waitFor();assert.equal(await toggle.isChecked(),false);
 await toggle.check();
 await waitFor(async()=>{try{return JSON.parse(await readFile(path.join(dir,'profile','desktop-preferences.json'),'utf8')).newMailAlerts===true}catch{return false}},5000);
 await page.getByRole('button',{name:'关闭',exact:true}).click();
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].hide());
 // The unread mail that was already there is only the baseline.
 await page.waitForTimeout(1500);
 assert.equal(await app.evaluate(()=>globalThis.__notes.length),0);checks.push('Existing unread mail does not trigger a notification');
 await store.mutate(s=>{s.messages.push(mail('new-one','Lucas','Fresh fixture mail'))});
 await waitFor(()=>app.evaluate(()=>globalThis.__notes.length>0));
 assert.deepEqual(await app.evaluate(()=>globalThis.__notes.map(n=>({title:n.title,body:n.body}))),[{title:'Lucas',body:'Fresh fixture mail'}]);checks.push('New inbox mail shows sender and subject');
 assert.match(await app.evaluate(()=>globalThis.__tip||''),/2 封未读/);checks.push('Tray tooltip shows the unread count');
 await app.evaluate(()=>globalThis.__notes[0].emit('click'));
 await page.getByRole('heading',{name:'Fresh fixture mail'}).waitFor({timeout:10000});
 assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),true);checks.push('Clicking the notification opens the window on that mail');
 await page.getByRole('button',{name:'设置',exact:true}).click();
 await toggle.waitFor();assert.equal(await toggle.isChecked(),true);await toggle.uncheck();
 await waitFor(async()=>{try{return JSON.parse(await readFile(path.join(dir,'profile','desktop-preferences.json'),'utf8')).newMailAlerts===false}catch{return false}},5000);
 await page.getByRole('button',{name:'关闭',exact:true}).click();
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].hide());
 await waitFor(()=>app.evaluate(()=>/1 封未读/.test(globalThis.__tip||'')),40000);checks.push('Reading the mail lowers the unread count');
 await store.mutate(s=>{s.messages.push(mail('muted-one','Sophia','Muted fixture mail'))});
 await waitFor(()=>app.evaluate(()=>/2 封未读/.test(globalThis.__tip||'')),40000);
 assert.equal(await app.evaluate(()=>globalThis.__notes.length),1);checks.push('Turning alerts off stops notifications but keeps the unread count');
 console.log(JSON.stringify({ok:true,checks},null,1));
}finally{
 await app.close().catch(()=>{});server.closeAllConnections?.();await new Promise(r=>server.close(r));await store.flush?.();await rm(dir,{recursive:true,force:true}).catch(()=>{});
}
