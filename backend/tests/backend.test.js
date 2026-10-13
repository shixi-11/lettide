import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request as httpRequest} from 'node:http';
import {mkdtemp,rm,readFile,mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {Store} from '../src/store.js';
import {createApp} from '../src/server.js';
import {htmlBodyToText,googleHeaders,composeGmailRaw} from '../src/mail.js';

function testCodec(){const key=randomBytes(32);return {protect:async b=>{const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv),data=Buffer.concat([c.update(b),c.final()]);return Buffer.concat([iv,c.getAuthTag(),data]);},unprotect:async b=>{const d=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));d.setAuthTag(b.subarray(12,28));return Buffer.concat([d.update(b.subarray(28)),d.final()]);}};}
async function fixture(options={}){const dir=await mkdtemp(path.join(os.tmpdir(),'youqiao-test-')),publicDir=path.join(dir,'public');await mkdir(path.join(publicDir,'assets'),{recursive:true});await writeFile(path.join(publicDir,'index.html'),'<!doctype html><script type="module" src="/assets/app.js"></script>');await writeFile(path.join(publicDir,'assets','app.js'),'globalThis.testAsset=true');const store=await new Store({file:path.join(dir,'state'),codec:testCodec()}).open(),probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));const app=await createApp({store,staticRoot:publicDir,port,...options}),server=createServer(app);await new Promise(r=>server.listen(port,'127.0.0.1',r));const url=`http://127.0.0.1:${port}`,headers={'host':`127.0.0.1:${port}`};return {dir,store,url,headers,server,close:async()=>{await new Promise(r=>server.close(r));await store.close();await rm(dir,{recursive:true,force:true});}};}

test('encrypted store round-trips, serializes writers, and recovers after a failed transaction',async()=>{const dir=await mkdtemp(path.join(os.tmpdir(),'youqiao-store-')),file=path.join(dir,'state'),codec=testCodec(),s=await new Store({file,codec}).open();await s.mutate(x=>x.accounts.push({id:'a',password:'private-secret'}));const raw=await readFile(file);assert.equal(raw.includes(Buffer.from('private-secret')),false);const reader=await new Store({file,codec,readOnly:true}).open();assert.equal(reader.state.accounts[0].password,'private-secret');assert.deepEqual(await readFile(file),raw);await assert.rejects(new Store({file,codec}).open(),/Another email service/);await assert.rejects(s.mutate(x=>{x.accounts.push({id:'rolled-back'});throw new Error('fail');}),/fail/);await s.mutate(x=>x.accounts.push({id:'b'}));assert.deepEqual(s.state.accounts.map(a=>a.id),['a','b']);await assert.rejects(new Store({file,codec:testCodec(),readOnly:true}).open(),/could not be safely opened/);await s.close();await rm(dir,{recursive:true,force:true});});

test('API rejects unauthenticated, cross-origin, and cross-site requests; MCP bearer is accepted',async()=>{const f=await fixture();try{let r=await fetch(f.url+'/api/status',{headers:f.headers});assert.equal(r.status,401);r=await fetch(f.url+'/api/status',{headers:{...f.headers,authorization:`Bearer ${f.store.state.token}`,'sec-fetch-site':'cross-site'}});assert.equal(r.status,403);r=await fetch(f.url+'/api/status',{headers:{...f.headers,authorization:`Bearer ${f.store.state.token}`}});assert.equal(r.status,200);r=await fetch(f.url+'/api/status',{headers:{...f.headers,authorization:`Bearer ${f.store.state.token}`,origin:'https://evil.example'}});assert.equal(r.status,403);}finally{await f.close();}});

test('UI cookie is HttpOnly and write requires same-origin Origin',async()=>{const f=await fixture();try{const r=await fetch(f.url+'/',{headers:f.headers}),cookie=r.headers.get('set-cookie');assert.match(cookie,/HttpOnly/i);assert.match(cookie,/SameSite=Strict/i);const session=cookie.split(';')[0];let write=await fetch(f.url+'/api/settings',{method:'PUT',headers:{...f.headers,cookie:session,'content-type':'application/json'},body:JSON.stringify({translationMode:'assistant'})});assert.equal(write.status,403);write=await fetch(f.url+'/api/settings',{method:'PUT',headers:{...f.headers,cookie:session,origin:f.url,'content-type':'application/json'},body:JSON.stringify({translationMode:'assistant'})});assert.equal(write.status,200);}finally{await f.close();}});

test('empty installation has no sample mail or accounts and account API never returns secrets',async()=>{const f=await fixture();try{const auth={...f.headers,authorization:`Bearer ${f.store.state.token}`};const before=await (await fetch(f.url+'/api/accounts',{headers:auth})).json();assert.deepEqual(before,[]);assert.deepEqual((await (await fetch(f.url+'/api/messages',{headers:auth})).json()).items,[]);await f.store.mutate(s=>s.accounts.push({id:'a',provider:'qq',email:'a@example.test',password:'not-returned',createdAt:new Date().toISOString()}));const rows=await (await fetch(f.url+'/api/accounts',{headers:auth})).json();assert.equal(rows[0].password,undefined);}finally{await f.close();}});

test('message folder changes return updated state and provider failures remain explicit',async()=>{
 let fail=false,calls=0;
 const f=await fixture({messageUpdater:async(_state,message,patch)=>{calls++;if(fail)throw new Error('mock provider failure');message.folder=patch.folder;message.folderIds=[patch.folder];}});
 try{
  const auth={...f.headers,authorization:`Bearer ${f.store.state.token}`,'content-type':'application/json'};
  await f.store.mutate(s=>{s.accounts.push({id:'fake-account',provider:'qq'});s.messages.push({id:'fake-message',accountId:'fake-account',folder:'inbox',folderIds:['inbox'],subject:'fixture',text:'fictional body',date:'2026-01-01',from:{address:'sender@example.test'},to:[],attachments:[]});});
  let response=await fetch(f.url+'/api/messages/fake-message',{method:'PATCH',headers:auth,body:JSON.stringify({folder:'trash'})});
  assert.equal(response.status,200);assert.deepEqual((await response.json()).folderIds,['trash']);assert.equal(calls,1);
  fail=true;response=await fetch(f.url+'/api/messages/fake-message',{method:'PATCH',headers:auth,body:JSON.stringify({folder:'archive'})});
  assert.equal(response.status,502);assert.deepEqual(await response.json(),{error:'Provider update failed'});assert.equal(calls,2);
  assert.deepEqual(f.store.state.messages[0].folderIds,['trash']);
 }finally{await f.close();}
});

test('account filters keep cached mail isolated and drafts require a one-shot idempotency key',async()=>{let sends=0;const f=await fixture({mailSender:async()=>{sends++;return {messageId:'message-1'};}});try{const auth={...f.headers,authorization:`Bearer ${f.store.state.token}`};await f.store.mutate(s=>{s.accounts.push({id:'a',email:'a@example.test'},{id:'b',email:'b@example.test'});s.messages.push({id:'m-a',accountId:'a',folder:'inbox',subject:'alpha',text:'private-a',date:'2026-01-01',from:{address:'a@example.test'},to:[],attachments:[]},{id:'m-b',accountId:'b',folder:'inbox',subject:'beta',text:'private-b',date:'2026-01-01',from:{address:'b@example.test'},to:[],attachments:[]});s.drafts.push({id:'d',accountId:'a',to:'b@example.test',subject:'hello',text:'draft'});});let rows=await (await fetch(f.url+'/api/messages?accountId=a',{headers:auth})).json();assert.equal(rows.total,1);assert.equal(rows.items[0].text,'private-a');const sendHeaders={...auth,'Idempotency-Key':'stable-key'};let response=await fetch(f.url+'/api/drafts/d/send',{method:'POST',headers:sendHeaders});assert.equal(response.status,200);response=await fetch(f.url+'/api/drafts/d/send',{method:'POST',headers:sendHeaders});assert.equal(response.status,200);assert.equal(sends,1);}finally{await f.close();}});

test('uncertain send is recorded and cannot be retried with the same key',async()=>{let sends=0;const f=await fixture({mailSender:async()=>{sends++;throw new Error('uncertain');}});try{const auth={...f.headers,authorization:`Bearer ${f.store.state.token}`};await f.store.mutate(s=>{s.accounts.push({id:'a'});s.drafts.push({id:'d',accountId:'a',to:'x@example.test',subject:'hello',text:'draft'});});const headers={...auth,'Idempotency-Key':'uncertain-key'};let r=await fetch(f.url+'/api/drafts/d/send',{method:'POST',headers});assert.equal(r.status,502);assert.equal((await r.json()).status,'outcome_unknown');r=await fetch(f.url+'/api/drafts/d/send',{method:'POST',headers});assert.equal(r.status,409);assert.equal((await r.json()).status,'outcome_unknown');assert.equal(sends,1);}finally{await f.close();}});

test('assistant translation queue retains source text and completed translation for UI readback',async()=>{const f=await fixture();try{const auth={...f.headers,authorization:`Bearer ${f.store.state.token}`};let r=await fetch(f.url+'/api/translations',{method:'POST',headers:{...auth,'content-type':'application/json'},body:JSON.stringify({text:'原文内容',targetLanguage:'English',mode:'assistant'})});assert.equal(r.status,202);const {id}=await r.json();let jobs=await (await fetch(f.url+'/api/translations/jobs',{headers:auth})).json();assert.equal(jobs[0].text,'原文内容');assert.equal(jobs[0].status,'pending');r=await fetch(`${f.url}/api/translations/${id}/complete`,{method:'POST',headers:{...auth,'content-type':'application/json'},body:JSON.stringify({translation:'Translated text'})});assert.equal(r.status,200);jobs=await (await fetch(f.url+'/api/translations/jobs',{headers:auth})).json();assert.equal(jobs[0].translation,'Translated text');assert.equal(jobs[0].status,'completed');}finally{await f.close();}});

test('offline translation requires explicit model download, deduplicates work and invalidates changed body cache',async()=>{
 let ready=false,downloads=0,translations=0,online=0;
 const f=await fixture({localTranslator:{status:async()=>({state:ready?'ready':'not_downloaded'}),download:async()=>{downloads++;return {state:'downloading'};},translate:async text=>{translations++;await new Promise(r=>setTimeout(r,25));return '译文 '+text;}},googleTranslator:async()=>{online++;throw new Error('Online fallback forbidden');}});
 try{
  const auth={...f.headers,authorization:`Bearer ${f.store.state.token}`,'content-type':'application/json'};
  const translate=()=>fetch(f.url+'/api/translations',{method:'POST',headers:auth,body:JSON.stringify({messageId:'offline-fixture',targetLanguage:'简体中文'})});
  await f.store.mutate(s=>s.messages.push({id:'offline-fixture',text:'Fictional meeting reminder'}));
  assert.equal((await fetch(f.url+'/api/translations/local',{headers:auth})).status,200);assert.equal(downloads,0);
  let result=await translate();assert.equal(result.status,409);assert.equal((await result.json()).code,'MODEL_NOT_READY');assert.equal(online,0);assert.equal(translations,0);
  assert.equal((await fetch(f.url+'/api/translations/local/download',{method:'POST',headers:auth,body:'{}'})).status,202);assert.equal(downloads,1);
  ready=true;const pair=await Promise.all([translate(),translate()]);assert.deepEqual(pair.map(r=>r.status),[200,200]);assert.equal(translations,1);
  assert.equal((await translate()).status,200);assert.equal(translations,1);
  await f.store.mutate(s=>s.messages[0].text='Changed fictional reminder');assert.equal((await translate()).status,200);assert.equal(translations,2);assert.equal(online,0);
  assert.equal(f.store.state.jobs.length,2);assert.ok(f.store.state.jobs.every(j=>j.provider==='local'));
 }finally{await f.close();}
});

test('removing an account clears its local mail, drafts and translations while keeping other accounts',async()=>{
 const f=await fixture();try{
  const auth={...f.headers,authorization:`Bearer ${f.store.state.token}`};
  await f.store.mutate(s=>{s.accounts.push({id:'remove-fixture'},{id:'keep-fixture'});s.messages.push({id:'remove-mail',accountId:'remove-fixture'},{id:'keep-mail',accountId:'keep-fixture'});s.drafts.push({id:'remove-draft',accountId:'remove-fixture'},{id:'keep-draft',accountId:'keep-fixture'});s.jobs.push({messageId:'remove-mail',translation:'private fixture translation'},{messageId:'keep-mail',translation:'retained fixture'});});
  assert.equal((await fetch(f.url+'/api/accounts/remove-fixture',{method:'DELETE',headers:auth})).status,204);
  assert.deepEqual(f.store.state.accounts.map(a=>a.id),['keep-fixture']);assert.deepEqual(f.store.state.messages.map(m=>m.id),['keep-mail']);assert.deepEqual(f.store.state.drafts.map(d=>d.id),['keep-draft']);assert.deepEqual(f.store.state.jobs.map(j=>j.messageId),['keep-mail']);
 }finally{await f.close();}
});

test('built web assets are served from only the configured web root with browser security headers',async()=>{const f=await fixture();try{const root=await fetch(f.url+'/',{headers:f.headers});assert.equal(root.status,200);assert.match(root.headers.get('content-security-policy'),/default-src 'self'/);assert.equal(root.headers.get('x-content-type-options'),'nosniff');assert.match(root.headers.get('cache-control'),/no-store/);const asset=await fetch(f.url+'/assets/app.js',{headers:f.headers});assert.equal(asset.status,200);assert.match(await asset.text(),/testAsset/);const privatePath=await fetch(f.url+'/state.dpapi',{headers:f.headers});assert.equal(privatePath.status,404);const forgedHost=await new Promise((resolve,reject)=>{const port=new URL(f.url).port,req=httpRequest({hostname:'127.0.0.1',port,path:'/assets/app.js',headers:{host:`evil.example:${port}`}},resolve);req.on('error',reject);req.end();});forgedHost.resume();assert.equal(forgedHost.statusCode,403);const auth={...f.headers,authorization:`Bearer ${f.store.state.token}`};const info=await (await fetch(f.url+'/api/integrations',{headers:auth})).json();assert.equal(info.service.baseUrl,f.url);assert.equal(JSON.stringify(info).includes(f.store.state.token),false);}finally{await f.close();}});

test('HTML-only mail becomes readable text, Gmail uses message internalDate and MIME encodes Unicode',async()=>{assert.match(htmlBodyToText('', '<p>你好，<b>世界</b></p>'),/你好，世界/);const date=googleHeaders({headers:[{name:'subject',value:'你好'}]},'1700000000000').date;assert.equal(date,'2023-11-14T22:13:20.000Z');const raw=Buffer.from(await composeGmailRaw({from:'发送者 <sender@example.test>',to:'reader@example.test',subject:'中文主题',text:'邮件正文'}),'base64url').toString('utf8');assert.match(raw,/Subject: =\?UTF-8\?B\?/i);assert.match(raw,/Content-Transfer-Encoding: base64/i);});

test('same provider accepts multiple accounts and rejects duplicate identity after injected connection check',async()=>{let checks=0;const f=await fixture({accountTester:async()=>{checks++;}});try{const auth={...f.headers,authorization:`Bearer ${f.store.state.token}`,'content-type':'application/json'};for(const email of ['one@example.test','two@example.test']){const r=await fetch(f.url+'/api/accounts',{method:'POST',headers:auth,body:JSON.stringify({provider:'qq',email,password:'test-only',imapHost:'mail.example.test',smtpHost:'mail.example.test'})});assert.equal(r.status,201);}let duplicate=await fetch(f.url+'/api/accounts',{method:'POST',headers:auth,body:JSON.stringify({provider:'qq',email:'ONE@example.test',password:'test-only'})});assert.equal(duplicate.status,409);assert.equal((await (await fetch(f.url+'/api/accounts',{headers:auth})).json()).length,2);assert.equal(checks,3);}finally{await f.close();}});

test('drafts save incomplete recipient details and update in place until send is claimed',async()=>{const f=await fixture();try{const auth={...f.headers,authorization:`Bearer ${f.store.state.token}`,'content-type':'application/json'};await f.store.mutate(s=>s.accounts.push({id:'a',email:'sender@example.test'}));let r=await fetch(f.url+'/api/drafts',{method:'POST',headers:auth,body:JSON.stringify({accountId:'a',subject:'Started',text:'body'})});assert.equal(r.status,201);const draft=await r.json();r=await fetch(f.url+`/api/drafts/${draft.id}`,{method:'PUT',headers:auth,body:JSON.stringify({to:'reader@example.test',subject:'Finished',text:'edited'})});assert.equal(r.status,200);const edited=await r.json();assert.equal(edited.id,draft.id);assert.equal(edited.status,'draft');assert.equal(edited.subject,'Finished');}finally{await f.close();}});

test('different idempotency keys cannot send one draft twice concurrently',async()=>{let release,started;const gate=new Promise(r=>release=r),entered=new Promise(r=>started=r);let sends=0;const f=await fixture({mailSender:async()=>{sends++;started();await gate;return {messageId:'sent'};}});try{const auth={...f.headers,authorization:`Bearer ${f.store.state.token}`};await f.store.mutate(s=>{s.accounts.push({id:'a'});s.drafts.push({id:'d',accountId:'a',to:'reader@example.test',subject:'Hi',text:'body',status:'draft'});});const first=fetch(f.url+'/api/drafts/d/send',{method:'POST',headers:{...auth,'Idempotency-Key':'key-1'}});await entered;const second=await fetch(f.url+'/api/drafts/d/send',{method:'POST',headers:{...auth,'Idempotency-Key':'key-2'}});assert.equal(second.status,409);release();assert.equal((await first).status,200);assert.equal(sends,1);}finally{release();await f.close();}});

test('Windows CurrentUser DPAPI store encrypts and reads back in an isolated temporary folder',{skip:process.platform!=='win32'},async()=>{const dir=await mkdtemp(path.join(os.tmpdir(),'youqiao-dpapi-')),file=path.join(dir,'state.dpapi');try{const store=await new Store({file}).open();await store.mutate(s=>s.settings.translationMode='assistant');await store.close();const reader=await new Store({file,readOnly:true}).open();assert.equal(reader.state.settings.translationMode,'assistant');}finally{await rm(dir,{recursive:true,force:true});}});


test('offline translations invalidate previous engine caches and keep explicit source language caches separate',async()=>{
 const calls=[];const f=await fixture({localTranslator:{status:async()=>({state:'ready'}),translate:async(text,target,options)=>{calls.push(options);return '虚构译文';}}});
 try{
  const headers={authorization:`Bearer ${f.store.state.token}`,'content-type':'application/json'};
  await f.store.mutate(s=>{s.messages.push({id:'mixed',text:'Hello, this is a fictional email. 谢谢。'});s.jobs.push({id:'old-cache',messageId:'mixed',text:s.messages[0].text,targetLanguage:'简体中文',provider:'local',status:'completed',translation:s.messages[0].text});});
  const translate=sourceLanguage=>fetch(f.url+'/api/translations',{method:'POST',headers,body:JSON.stringify({messageId:'mixed',targetLanguage:'简体中文',sourceLanguage})});
  assert.equal((await translate('English')).status,200);assert.equal(calls.length,1);assert.equal(calls[0].sourceLanguage,'eng_Latn');
  assert.equal((await translate('English')).status,200);assert.equal(calls.length,1);assert.equal((await translate('Français')).status,200);assert.equal(calls.length,2);
  assert.equal((await translate('Unsupported')).status,400);assert.equal(calls.length,2);
 }finally{await f.close()}
});

test('cancel API addresses a translation request without invoking a translator or changing email state',async()=>{
 let requested;const f=await fixture({localTranslator:{status:async()=>({state:'ready'}),cancel:async id=>{requested=id;return true},translate:async()=>assert.fail('Cancellation must not start translation')}});
 try{const headers={authorization:`Bearer ${f.store.state.token}`,'content-type':'application/json'};
  let response=await fetch(f.url+'/api/translations/local/cancel',{method:'POST',headers,body:JSON.stringify({requestId:'fictional-translation'})});assert.equal(response.status,200);assert.deepEqual(await response.json(),{cancelled:true});assert.equal(requested,'fictional-translation');
  response=await fetch(f.url+'/api/translations/local/cancel',{method:'POST',headers,body:'{}'});assert.equal(response.status,400);assert.equal(f.store.state.messages.length,0);
 }finally{await f.close()}
});

test('version 2 mixed-language caches are invalidated and invalid new translations are never stored',async()=>{
 const {createHash}=await import('node:crypto');let calls=0,invalid=false;const source='Hello, please review the attached fictional report. Thank you.';
 const f=await fixture({localTranslator:{status:async()=>({state:'ready'}),translate:async()=>{calls++;return invalid?'您好 '+('مرحبا '.repeat(9)):'您好，请查看随附的虚构报告。谢谢。';}}});
 try{const headers={authorization:`Bearer ${f.store.state.token}`,'content-type':'application/json'};
  await f.store.mutate(s=>{s.messages=[{id:'old-message',text:source}];s.jobs=[{id:'old-v2',messageId:'old-message',text:source,sourceHash:createHash('sha256').update(source).digest('hex'),sourceLanguage:'eng_Latn',targetLanguage:'简体中文',provider:'local',cacheVersion:2,status:'completed',translation:'您好 '+('مرحبا '.repeat(9))}];});
  const request=sourceLanguage=>fetch(f.url+'/api/translations',{method:'POST',headers,body:JSON.stringify({messageId:'old-message',targetLanguage:'简体中文',sourceLanguage,mode:'local'})});
  let response=await request('English');assert.equal(response.status,200);assert.equal(calls,1);assert.equal((await response.json()).translation,'您好，请查看随附的虚构报告。谢谢。');assert.equal(f.store.state.jobs.at(-1).cacheVersion,3);
  invalid=true;const count=f.store.state.jobs.length;response=await request('Français');assert.equal(response.status,503);assert.match((await response.json()).error,/unexpected language/);assert.equal(f.store.state.jobs.length,count);
 }finally{await f.close();}
});
