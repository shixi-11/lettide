import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
import {translateGoogle} from '../src/translate.js';
import {Store} from '../src/store.js';
import {createApp} from '../src/server.js';
import {syncAccount} from '../src/mail.js';
import {ImapPool} from '../src/imap-pool.js';
import {EventEmitter} from 'node:events';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
test('online translation batches a normal multipart email into one body-only POST',async()=>{
 const calls=[];const original='Hello.\n\nPlease confirm Friday.\n\nThank you.';
 const text=await translateGoogle(original,'简体中文',{sourceLanguage:'English',fetchImpl:async(url,init)=>{calls.push({url,init});return Response.json([[['你好。\n\n请确认周五。\n\n谢谢。']]]);}});
 assert.equal(calls.length,1);assert.equal(text,'你好。\n\n请确认周五。\n\n谢谢。');
 const {url,init}=calls[0];assert.equal(new URL(url).search,'');assert.equal(init.method,'POST');const body=new URLSearchParams(init.body);assert.equal(body.get('q'),original);assert.equal(body.get('sl'),'en');assert.equal(init.headers.Authorization,undefined);
});
test('online chunks have bounded parallelism, preserve order and a whole-operation deadline',async()=>{
 let active=0,peak=0;const seen=[];
 const text=await translateGoogle('x'.repeat(11000),'简体中文',{fetchImpl:async(_url,init)=>{const n=seen.length;seen.push(init.signal);active++;peak=Math.max(peak,active);await delay(n===0?15:2);active--;return Response.json([[[String(n)]]]);}});
 assert.ok(peak>1&&peak<=3);assert.equal(text,'0123');assert.ok(seen.every(x=>x===seen[0]));
});
test('background IMAP work leaves one connection for an interactive body read',async()=>{
 const pool=new ImapPool({maxPerAccount:2}),create=()=>Object.assign(new EventEmitter(),{usable:true,connect:async()=>{},close(){this.usable=false}});
 const first=await pool.acquire('a',[],create,0);let second;
 const waiting=pool.acquire('a',[],create,0).then(x=>{second=x;return x;});await delay(15);
 try{assert.equal(second,undefined);const interactive=await pool.acquire('a',[],create,10);assert.equal(pool.buckets.get('a').entries.length,2);await interactive.release();await first.release();await (await waiting).release();}finally{await first.release();await pool.close();await waiting.catch(()=>{});}
});
test('parallel expired OAuth snapshots share one renewal and retain rotated credentials',async()=>{
 const account={id:'renewal-fixture',provider:'gmail',email:'a@example.test',refreshToken:'old',accessToken:'expired',expiresAt:0,folders:[{id:'inbox',role:'inbox',providerId:'INBOX'}]},settings={googleClientId:'fictional-client'};let refreshes=0;
 const deps={metadataOnly:true,fetchImpl:async(url)=>{if(String(url).includes('/token')){refreshes++;await delay(15);return Response.json({access_token:'fresh',refresh_token:'rotated',expires_in:3600});}return Response.json({messages:[]});}};
 const a=structuredClone(account),b=structuredClone(account);await Promise.all([syncAccount({messages:[],settings},a,'inbox','',60,deps),syncAccount({messages:[],settings},b,'inbox','',60,deps)]);
 assert.equal(refreshes,1);assert.equal(a.refreshToken,'rotated');assert.equal(b.refreshToken,'rotated');
});
async function fixture(){const dir=await mkdtemp(path.join(tmpdir(),'lettide-stability-')),store=await new Store({file:path.join(dir,'state'),codec:{protect:async x=>x,unprotect:async x=>x}}).open();await store.mutate(s=>{s.accounts=[{id:'g',provider:'gmail',email:'a@example.test'}];s.messages=[{id:'large',accountId:'g',folderIds:['inbox'],subject:'Fictional',text:'x'.repeat(12000),date:new Date().toISOString(),attachments:[]}];s.drafts=[{id:'d',accountId:'g',to:'receiver@example.test',subject:'Fictional send',text:'Fictional body.',status:'draft'}];});const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;const app=await createApp({store,port,mailSender:async()=>({messageId:'provider-id'})});server.on('request',app);const headers={Authorization:'Bearer '+store.state.token,'Content-Type':'application/json'},base='http://127.0.0.1:'+port+'/api';return {store,base,headers,close:async()=>{await new Promise(r=>server.close(r));await store.close();await rm(dir,{recursive:true,force:true})}};}
test('list summaries do not retransmit full bodies; direct reads remain complete',async()=>{const f=await fixture();try{const result=await (await fetch(f.base+'/messages?summary=true',{headers:f.headers})).json();assert.ok(result.items[0].text.length<=240);const full=await (await fetch(f.base+'/messages/large',{headers:f.headers})).json();assert.equal(full.text.length,12000);}finally{await f.close()}});
test('successful provider send is immediately in shared Sent cache without waiting for polling',async()=>{const f=await fixture();try{const response=await fetch(f.base+'/drafts/d/send',{method:'POST',headers:{...f.headers,'Idempotency-Key':'one-send'},body:'{}'});assert.equal(response.status,200);const list=await (await fetch(f.base+'/messages?folder=sent',{headers:f.headers})).json();assert.equal(list.items.length,1);assert.equal(list.items[0].subject,'Fictional send');assert.equal(list.items[0].text,'Fictional body.');assert.equal(list.items[0].id,'g:gmail:provider-id');const repeated=await fetch(f.base+'/drafts/d/send',{method:'POST',headers:{...f.headers,'Idempotency-Key':'one-send'},body:'{}'});assert.equal(repeated.status,200);assert.equal(f.store.state.messages.filter(m=>m.folderIds?.includes('sent')).length,1);}finally{await f.close()}});
