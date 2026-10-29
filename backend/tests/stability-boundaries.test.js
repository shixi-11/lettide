import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {loadMessageBody,loadAttachment,syncAccount,inspectProviderSend} from '../src/mail.js';
import {readDownload,describeParts} from '../src/imap-content.js';
import {splitText} from '../src/translate.js';
import {Store} from '../src/store.js';
import {createApp} from '../src/server.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
test('Chinese multipart body opens without downloading PDF and CID attachments',async()=>{
 const a={id:'a',provider:'qq'},m={id:'m',accountId:'a',bodyLoaded:false,providerRef:{type:'imap',folder:'INBOX',uid:1,uidValidity:'7'}},state={accounts:[a],settings:{}},calls=[];
 const structure={type:'multipart/mixed',childNodes:[{type:'multipart/alternative',childNodes:[{part:'1.1',type:'text/plain',size:36},{part:'1.2',type:'text/html',size:99}]},{type:'application/pdf',part:'2',size:20000000,disposition:'attachment',dispositionParameters:{filename:'方案.pdf'}},{type:'image/png',part:'3',id:'<inline-image>',disposition:'inline',size:20}]};
 const client={mailbox:{uidValidity:7},connect:async()=>{},logout:async()=>{},getMailboxLock:async()=>({release(){}}),fetchOne:async(_uid,fields)=>{assert.equal(fields.source,undefined);return {bodyStructure:structure}},download:async(_uid,part)=>{calls.push(part);return {meta:{},content:Readable.from([part==='1.1'?Buffer.from('你好，周五的会议已经确认。'):Buffer.from('fictional attachment')])}}};
 const deps={imapClientFactory:()=>client};await loadMessageBody(state,m,deps);assert.equal(m.text,'你好，周五的会议已经确认。');assert.deepEqual(calls,['1.1']);assert.equal(m.attachments.length,2);assert.equal(m.attachments[0].filename,'方案.pdf');
 assert.equal((await loadAttachment(state,m,m.attachments[0],deps)).toString(),'fictional attachment');assert.deepEqual(calls,['1.1','2']);assert.equal(describeParts(structure,'m').text.length,2);
});
test('streamed content rejects missing parts and size-limit truncation',async()=>{
 await assert.rejects(readDownload({},5),/unavailable/);await assert.rejects(readDownload({meta:{expectedSize:30},content:Readable.from([Buffer.alloc(5)])},5),/limit/);await assert.rejects(readDownload({meta:{},content:Readable.from([Buffer.alloc(6)])},5),/limit/);
});
test('natural text splitting preserves every character, words and Unicode boundaries',()=>{
 const original=('This is a complete sentence.\n\n'.repeat(200))+'你好😀';const chunks=splitText(original);assert.equal(chunks.join(''),original);assert.ok(chunks.length>1);for(const chunk of chunks.slice(0,-1))assert.match(chunk,/\s$/);
 const emoji=splitText('😀'.repeat(5000));assert.equal(emoji.join(''),'😀'.repeat(5000));assert.ok(emoji.every(x=>!/^[\uDC00-\uDFFF]/.test(x)&&!/[\uD800-\uDBFF]$/.test(x)));
});
async function fixture(extra={}){const dir=await mkdtemp(path.join(tmpdir(),'lettide-boundary-')),store=await new Store({file:path.join(dir,'state'),codec:{protect:async x=>x,unprotect:async x=>x}}).open();await store.mutate(s=>{s.accounts=[{id:'g',provider:'gmail',email:'fictional@example.test',accessToken:'old',refreshToken:'old',expiresAt:1}];s.drafts=[{id:'d',accountId:'g',to:'receiver@example.test',subject:'Fictional',text:'Fictional body',status:'draft'}]});const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port,app=await createApp({store,port,...extra});server.on('request',app);const request=(p,b)=>fetch('http://127.0.0.1:'+port+'/api'+p,{method:b?'POST':'GET',headers:{Authorization:'Bearer '+store.state.token,'Content-Type':'application/json',...(p.endsWith('/send')?{'Idempotency-Key':'fixture-one-send'}:{})},...(b?{body:JSON.stringify(b)}:{})});return {store,request,close:async()=>{await new Promise(r=>server.close(r));await store.close();await rm(dir,{recursive:true,force:true})}};}
test('cancelling online translation aborts the provider and cannot create a completed cache',async()=>{
 let ready;const started=new Promise(r=>ready=r);const f=await fixture({googleTranslator:async(_text,_target,{signal})=>{ready();await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));return 'must not cache'}});
 try{const pending=f.request('/translations',{text:'Fictional body',targetLanguage:'简体中文',mode:'google',requestId:'cancel-me'});await started;assert.equal((await (await f.request('/translations/cancel',{requestId:'cancel-me'})).json()).cancelled,true);assert.equal((await pending).status,503);assert.equal(f.store.state.jobs[0].status,'cancelled');assert.equal(f.store.state.jobs[0].translation,undefined);}finally{await f.close()}
});
test('a sending snapshot cannot roll back newer credentials persisted by another operation',async()=>{
 let ready,release;const started=new Promise(r=>ready=r),gate=new Promise(r=>release=r);const f=await fixture({mailSender:async()=>{ready();await gate;return {messageId:'sent'}}});
 try{const send=f.request('/drafts/d/send',{});await started;await f.store.mutate(s=>Object.assign(s.accounts[0],{accessToken:'new',refreshToken:'rotated',expiresAt:9999999999999}));release();assert.equal((await send).status,200);assert.equal(f.store.state.accounts[0].refreshToken,'rotated');assert.equal(f.store.state.accounts[0].accessToken,'new');}finally{release();await f.close()}
});
test('Microsoft acknowledged Sent cache survives provider delay and merges its immutable remote ID',async()=>{
 const account={id:'ms',provider:'microsoft',accessToken:'mock',expiresAt:Date.now()+3600000,folders:[{id:'sent',role:'sent',providerId:'sentitems'}]},message={id:'ms:graph:immutable',accountId:'ms',date:new Date().toISOString(),text:'Already accepted',bodyLoaded:true,folder:'sent',folderIds:['sent'],providerPendingUntil:Date.now()+300000},state={accounts:[account],settings:{},messages:[message]};
 let arrived=false;const deps={metadataOnly:true,fetchImpl:async()=>Response.json({value:arrived?[{id:'immutable',subject:'Fictional',receivedDateTime:message.date,bodyPreview:'Preview'}]:[]})};
 await syncAccount(state,account,'sent','',60,deps);assert.equal(state.messages.length,1);assert.deepEqual(state.messages[0].folderIds,['sent']);arrived=true;await syncAccount(state,account,'sent','',60,deps);assert.equal(state.messages.length,1);assert.equal(state.messages[0].providerPendingUntil,null);assert.equal(state.messages[0].text,'Already accepted');
});
test('MCP initialize and tool discovery never start a mail service or read encrypted mail',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'lettide-mcp-idle-')),entry=fileURLToPath(new URL('../src/mcp.js',import.meta.url)),client=new Client({name:'fictional-test',version:'1'}),transport=new StdioClientTransport({command:process.execPath,args:[entry],env:{...process.env,LETTIDE_DATA_DIR:dir},stderr:'pipe'});
 try{await client.connect(transport,{timeout:5000});const tools=await client.listTools();assert.ok(tools.tools.some(t=>t.name==='mail_search'));assert.deepEqual(await readdir(dir),[]);}finally{await client.close();await rm(dir,{recursive:true,force:true})}
});

test('separate translation request IDs can be cancelled independently',async()=>{
 const started=new Set();const f=await fixture({googleTranslator:async(_text,_target,{signal})=>{const index=started.size;started.add(index);await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,120);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(signal.reason)},{once:true})});return '完成译文'}});
 try{const a=f.request('/translations',{text:'Fictional concurrent text',targetLanguage:'简体中文',requestId:'window-a'}),b=f.request('/translations',{text:'Fictional concurrent text',targetLanguage:'简体中文',requestId:'window-b'});const deadline=Date.now()+3000;while(started.size<2&&Date.now()<deadline)await new Promise(r=>setTimeout(r,5));assert.equal(started.size,2,'each cancellable request must own its task');await f.request('/translations/cancel',{requestId:'window-a'});assert.equal((await a).status,503);assert.equal((await b).status,200);assert.equal(f.store.state.jobs.filter(j=>j.status==='cancelled').length,1);assert.equal(f.store.state.jobs.filter(j=>j.status==='completed').length,1);}finally{await f.close()}
});
test('a provider 401 renews a read once but does not replay writes',async()=>{
 const account={id:'g401',provider:'gmail',email:'fictional@example.test',accessToken:'revoked',refreshToken:'refresh',expiresAt:Date.now()+3600000,folders:[{id:'inbox',role:'inbox',providerId:'INBOX'}]},state={accounts:[account],settings:{googleClientId:'fixture'},messages:[]};let requests=0,renewals=0;
 await syncAccount(state,account,'inbox','',60,{metadataOnly:true,fetchImpl:async(url)=>{if(url.includes('/token')){renewals++;return Response.json({access_token:'fresh',expires_in:3600})}if(url.endsWith('/profile'))return Response.json({});requests++;return requests===1?new Response('',{status:401}):Response.json({messages:[]})}});assert.equal(requests,2);assert.equal(renewals,1);assert.equal(account.accessToken,'fresh');
});

test('an uncertain two-stage send keeps its provider receipt and never sends again on retry',async()=>{
 let sends=0;const f=await fixture({mailSender:async(_s,_a,_d,callbacks)=>{sends++;await callbacks.onProviderPrepared({provider:'microsoft',providerDraftId:'immutable-receipt'});throw new Error('Fictional send interruption')}});
 try{await f.store.mutate(s=>{s.accounts[0].provider='microsoft'});const response=await f.request('/drafts/d/send',{});assert.equal(response.status,502);const result=await response.json();assert.equal(result.status,'outcome_unknown');assert.equal(result.providerDraftId,'immutable-receipt');assert.equal(f.store.state.drafts[0].providerDraftId,'immutable-receipt');assert.equal((await f.request('/drafts/d/send',{})).status,409);assert.equal(sends,1);}finally{await f.close()}
});
test('provider send reconciliation is read-only and eventual drafts remain uncertain',async()=>{
 const account={id:'receipt',provider:'microsoft',accessToken:'mock',expiresAt:Date.now()+3600000},state={settings:{}};let draft=true,calls=0;
 const deps={fetchImpl:async(url,init)=>{calls++;assert.equal(init.method,undefined);assert.match(url,/messages\/immutable-receipt\?/);assert.equal(init.headers.Prefer,'IdType="ImmutableId"');return Response.json({id:'immutable-receipt',isDraft:draft,sentDateTime:'2026-10-29T00:00:00Z'})}};
 assert.equal((await inspectProviderSend(state,account,'immutable-receipt',deps)).status,'outcome_unknown');draft=false;assert.equal((await inspectProviderSend(state,account,'immutable-receipt',deps)).status,'sent');assert.equal(calls,2);
});

test('a confirmed provider receipt finalizes Sent and removes the uncertain draft without resending',async()=>{
 let sends=0;const f=await fixture({mailSender:async(_s,_a,_d,c)=>{sends++;await c.onProviderPrepared({providerDraftId:'immutable-receipt'});throw Error('uncertain')},providerSendInspector:async()=>({status:'sent',messageId:'immutable-receipt',sentDateTime:'2026-10-29T00:00:00Z'})});
 try{await f.store.mutate(s=>{s.accounts[0].provider='microsoft'});assert.equal((await f.request('/drafts/d/send',{})).status,502);assert.equal((await f.request('/drafts/d/send-status')).status,200);assert.equal(f.store.state.drafts.length,0);const sent=f.store.state.messages.filter(m=>m.folder==='sent');assert.equal(sent.length,1);assert.equal(sent[0].id,'g:graph:immutable-receipt');assert.equal(sent[0].text,'Fictional body');assert.equal(sent[0].date,'2026-10-29T00:00:00Z');assert.equal(f.store.state.sendResults['fixture-one-send'].status,'sent');assert.equal(sends,1);}finally{await f.close()}
});
