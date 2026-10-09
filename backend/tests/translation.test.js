import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.js';
import {createApp} from '../src/server.js';
import {translateGoogle} from '../src/translate.js';
test('anonymous translation sends only explicitly supplied text and language parameters over POST',async()=>{
 const calls=[];const result=await translateGoogle('Hello.\n\nFictional body.','简体中文',{fetchImpl:async(url,init)=>{calls.push({url,init});return {ok:true,json:async()=>[[['译文']]]};}});
 assert.equal(result,'译文\n\n译文');assert.equal(calls.length,2);
 for(const {url,init} of calls){assert.equal(new URL(url).search,'');assert.equal(init.method,'POST');assert.deepEqual([...new URLSearchParams(init.body).keys()],['client','sl','tl','dt','q']);assert.equal(init.headers.Authorization,undefined);}
 await assert.rejects(translateGoogle('Fictional','invalid'),/Unsupported/);
});
test('web translation rejects rate limits and malformed responses without assistant or paid fallback',async()=>{
 await assert.rejects(translateGoogle('Fictional','English',{fetchImpl:async()=>({ok:false,status:429})}),/unavailable/);
 await assert.rejects(translateGoogle('Fictional','English',{fetchImpl:async()=>({ok:true,json:async()=>[]})}),/no text/);
});
test('click API translates only the body, caches results, lists real folder memberships and validates attachment limits',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'lettide-click-'));const store=await new Store({file:path.join(dir,'state'),codec:{protect:async x=>x,unprotect:async x=>x}}).open();
 await store.mutate(s=>{s.accounts=[{id:'a',provider:'qq',email:'fictional@example.test',folders:[{id:'imap:bGFiZWw',name:'Projects',role:'custom',accountId:'a'}]}];s.messages=[{id:'m',accountId:'a',subject:'DO NOT SEND SUBJECT',text:'Fictional email body only.',from:{address:'DO NOT SEND ADDRESS'},folderIds:['inbox','imap:bGFiZWw'],date:new Date().toISOString(),attachments:[]}];});
 let calls=0;const app=await createApp({store,port:47943,googleTranslator:async(text,lang)=>{assert.equal(text,'Fictional email body only.');assert.equal(lang,'简体中文');calls++;return '虚构正文。';}});const server=createServer(app);await new Promise(r=>server.listen(47943,'127.0.0.1',r));const base='http://127.0.0.1:47943',headers={Authorization:'Bearer '+store.state.token,'Content-Type':'application/json'};
 try{
  const request=(url,body)=>fetch(base+url,{method:body?'POST':'GET',headers,...(body?{body:JSON.stringify(body)}:{})});
  await request('/api/messages');assert.equal(calls,0);
  for(let i=0;i<2;i++){const r=await request('/api/translations',{messageId:'m',targetLanguage:'简体中文',mode:'google'});assert.equal(r.status,200);assert.equal((await r.json()).translation,'虚构正文。');}assert.equal(calls,1);
  const folder=await (await request('/api/messages?accountId=a&folder=imap%3AbGFiZWw')).json();assert.equal(folder.items.length,1);
  const oauth=await (await request('/api/oauth/prepare',{provider:'gmail'})).json();assert.equal(oauth.setupRequired,true);assert.match(oauth.setupUrl,/console.cloud.google.com/);
  await store.mutate(s=>s.settings.googleClientId='fictional-client');const auth=await (await request('/api/oauth/prepare',{provider:'gmail'})).json();assert.equal(new URL(auth.url).hostname,'accounts.google.com');assert.match(auth.url,/code_challenge_method=S256/);
  const invalid=await request('/api/drafts',{accountId:'a',attachments:[{filename:'x',content:'invalid$$'}]});assert.equal(invalid.status,400);
 }finally{await new Promise(r=>server.close(r));await store.close();await rm(dir,{recursive:true,force:true});}
});
