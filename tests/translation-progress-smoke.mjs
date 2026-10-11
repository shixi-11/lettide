import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import {Store} from '../backend/src/store.js';
import {createApp} from '../backend/src/server.js';

// Isolated fictional mail and a controlled translator; no production data or network.
const pw=process.env.PLAYWRIGHT_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const {chromium}=await import(pathToFileURL(pw).href);
const dir=await mkdtemp(path.join(os.tmpdir(),'lettide-progress-'));
const store=await new Store({file:path.join(dir,'state.dpapi')}).open();
await store.mutate(s=>{s.accounts=[{id:'demo',provider:'gmail',email:'demo@example.com',name:'Demo'}];s.messages=[{id:'demo-mail',accountId:'demo',folder:'inbox',from:{name:'Demo',address:'sender@example.com'},subject:'Fictional receipt',text:'A fictional receipt.\n\nThank you for your purchase.',date:new Date().toISOString(),unread:false,attachments:[]}];});
let progress=null,finish,rejectTranslation,receivedRequest,receivedSource,cancelledRequest,copySaves=0;
await store.mutate(s=>{s.sentCopies=[{id:'fictional-copy',accountId:'demo',messageId:'<fictional@example.test>',status:'pending',date:new Date().toISOString(),createdAt:new Date().toISOString(),subject:'Fictional sent copy',raw:Buffer.from('From: sender@example.test\r\nTo: recipient@example.test\r\nSubject: Fictional sent copy\r\nMessage-ID: <fictional@example.test>\r\n\r\nFictional sent body.').toString('base64')}];});
const translator={status:async()=>({state:'ready',translation:progress}),translate:async(_text,_lang,options)=>{receivedRequest=options.requestId;receivedSource=options.sourceLanguage;progress={requestId:receivedRequest,phase:'running',completed:1,total:4};return new Promise((resolve,reject)=>{finish=resolve;rejectTranslation=reject});},cancel:async id=>{cancelledRequest=id;progress=null;rejectTranslation(new Error('Local translation cancelled.'));return true;}};
const port=47937,app=await createApp({store,port,localTranslator:translator,mailSyncer:async()=>[],folderLister:async()=>[],sentCopySaver:async()=>{copySaves++;return {status:'saved',folder:'Sent',uid:7,uidValidity:1};},mailSender:async()=>{throw new Error('Sending forbidden in this fixture');}});
const server=createServer(app);await new Promise(r=>server.listen(port,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,channel:'msedge'});
try {
 const page=await browser.newPage();await page.goto(`http://127.0.0.1:${port}`);
 await page.locator('.sent-copy-notice').filter({hasText:'邮件已发出，副本待保存'}).waitFor();
 await page.getByRole('button',{name:'补存副本',exact:true}).click();
 await page.getByText('副本已保存到已发送',{exact:true}).waitFor();
 assert.equal(copySaves,1);assert.equal(store.state.sentCopies[0].raw,undefined);assert.ok(store.state.messages.some(m=>m.folder==='sent'));
 await page.getByRole('button',{name:/Demo.*Fictional receipt/}).click();
 await page.getByRole('button',{name:'译文',exact:true}).click();
 const bar=page.getByRole('progressbar',{name:'翻译进度'});await bar.waitFor();
 assert.match(receivedRequest,/^[\da-f-]{36}$/i);
 assert.equal(await bar.getAttribute('value'),'1');assert.equal(await bar.getAttribute('max'),'4');
 progress={requestId:'another-request',phase:'running',completed:3,total:5};
 await page.getByText('正在等待上一项翻译完成…',{exact:true}).waitFor();assert.equal(await bar.count(),0);
 progress={requestId:receivedRequest,phase:'running',completed:3,total:4};
 await bar.waitFor();assert.equal(await bar.getAttribute('value'),'3');
 await mkdir('output/playwright',{recursive:true});await page.screenshot({path:'output/playwright/translation-progress.png'});
 finish('这是一张虚构收据。谢谢惠顾。');progress=null;
 await page.getByText('这是一张虚构收据。谢谢惠顾。',{exact:true}).waitFor();assert.equal(await bar.count(),0);
 await page.getByRole('combobox',{name:'原文语言',exact:true}).selectOption('English');
 await page.getByRole('button',{name:'取消翻译',exact:true}).waitFor();assert.equal(receivedSource,'eng_Latn');
 const activeRequest=receivedRequest;await page.getByRole('button',{name:'取消翻译',exact:true}).click();
 await page.getByRole('button',{name:'重试翻译',exact:true}).waitFor();assert.equal(cancelledRequest,activeRequest);
 await page.screenshot({path:'output/playwright/translation-recovery.png'});
 console.log(JSON.stringify({passed:7,fictionalOnly:true,checks:['copy-only recovery','request identity','real progress','queued request isolation','completed result','explicit source language','cancel exact active request']}));
}finally{finish?.('Finished');await browser.close();await new Promise(r=>server.close(r));await store.close();await rm(dir,{recursive:true,force:true});}
