// Desktop window titles already show the icon and name, so the sidebar leaves them out; browsers keep them.
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {Store} from '../backend/src/store.js';
import {createApp} from '../backend/src/server.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const pw=process.env.PLAYWRIGHT_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const {chromium}=await import(pathToFileURL(pw).href);
const output=process.env.LETTIDE_SHOTS||path.join(root,'output','sidebar');await mkdir(output,{recursive:true});
const dir=await mkdtemp(path.join(os.tmpdir(),'lettide-brand-'));
const store=await new Store({file:path.join(dir,'state'),codec:{protect:async x=>x,unprotect:async x=>x}}).open();
const port=47963,service=await createApp({store,port,folderLister:async()=>[],mailSyncer:async()=>[],mailSender:async()=>{throw new Error('No live mail allowed')}}),server=createServer(service);
await new Promise(r=>server.listen(port,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,channel:'msedge'});const checks=[];
try{
 const web=await browser.newPage({viewport:{width:1366,height:820},locale:'zh-CN'});await web.goto(`http://127.0.0.1:${port}/`);
 await web.getByRole('heading',{name:'收件箱',exact:true}).waitFor();assert.equal(await web.locator('.sidebar .brand').count(),1);checks.push('Browser keeps the sidebar name');
 const desk=await browser.newPage({viewport:{width:1366,height:820},locale:'zh-CN'});
 await desk.addInitScript(()=>{window.lettide={desktop:true,initialLanguage:'zh-CN',systemLanguage:'zh-CN'};});
 await desk.goto(`http://127.0.0.1:${port}/`);await desk.getByRole('heading',{name:'收件箱',exact:true}).waitFor();
 assert.equal(await desk.locator('.sidebar .brand').count(),0);await desk.screenshot({path:path.join(output,'桌面侧栏.png'),clip:{x:0,y:0,width:640,height:420}});checks.push('Desktop sidebar drops the duplicated icon and name');
 console.log(JSON.stringify({ok:true,checks}));
}finally{await browser.close();server.closeAllConnections?.();await new Promise(r=>server.close(r));await store.close?.();await rm(dir,{recursive:true,force:true}).catch(()=>{});}
