import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
import {Store} from '../src/store.js';
import {createApp,startService} from '../src/server.js';

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function fixture(mailSyncer,messageUpdater,folderLister=async()=>[{id:'custom',role:'custom'}],messageLoader){
 const dir=await mkdtemp(path.join(os.tmpdir(),'lettide-sync-scheduler-'));
 const store=await new Store({file:path.join(dir,'state'),codec:{protect:async x=>x,unprotect:async x=>x}}).open();
 await store.mutate(s=>{s.accounts=[{id:'a',provider:'qq',email:'a@example.test',folders:[{id:'custom',role:'custom',accountId:'a'}],foldersSyncedAt:new Date().toISOString()}];s.messages=[{id:'m',accountId:'a',folder:'inbox',folderIds:['inbox'],folders:['inbox'],unread:false,starred:false,subject:'base',text:'fictional',date:'2026-01-01',from:{address:'sender@example.test'},to:[],attachments:[]}];});
 const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const app=await createApp({store,port,folderLister,mailSyncer,messageUpdater,messageLoader});
 const server=createServer(app);await new Promise(r=>server.listen(port,'127.0.0.1',r));
 const base=`http://127.0.0.1:${port}`,headers={Authorization:`Bearer ${store.state.token}`,'Content-Type':'application/json'};
 return {store,base,headers,server,close:async()=>{await new Promise(r=>server.close(r));await store.close();await rm(dir,{recursive:true,force:true});}};
}
const request=(f,path,body,method='POST')=>fetch(f.base+'/api'+path,{method,headers:f.headers,...(body===undefined?{}:{body:JSON.stringify(body)})});

test('network sync work releases the store queue and merges concurrent memberships and flags',async()=>{
 let startedResolve,releaseResolve;const started=new Promise(r=>startedResolve=r),blocked=new Promise(r=>releaseResolve=r);
 const f=await fixture(async(state,account,folder)=>{
  const id=typeof folder==='string'?folder:folder.id;
  if(id==='inbox'){startedResolve();await blocked;}
  const m=state.messages.find(x=>x.id==='m');if(m){m.subject=`sync-${id}`;const set=new Set(m.folderIds||[]);set.add(id);m.folderIds=[...set];m.folders=m.folderIds;}
  return state.messages;
 },async(_state,message,patch)=>{Object.assign(message,patch);if(patch.folder){message.folder=patch.folder;message.folderIds=[patch.folder];message.folders=message.folderIds;}});
 try{
  const inbox=request(f,'/sync',{accountId:'a',folder:'inbox'});await started;
  let timedOut=false;const quick=Promise.all([
   request(f,'/drafts',{accountId:'a',to:'x@example.test',subject:'draft',text:'fictional'}),
   request(f,'/translations',{text:'fictional text',targetLanguage:'English',mode:'assistant'}),
   request(f,'/sync',{accountId:'a',folder:'custom'})
  ]).then(rows=>rows.map(x=>x.status));
  const statuses=await Promise.race([quick,delay(500).then(()=>{timedOut=true;return null;})]);
  await request(f,'/messages/m',{unread:true},'PATCH');
  assert.ok(f.store.state.messages[0].folderIds.includes('custom'));
  await request(f,'/messages/m',{folder:'trash'},'PATCH');
  releaseResolve();await inbox;
  assert.equal(timedOut,false,'draft, translation, and another folder should finish while inbox network work is pending');
  assert.deepEqual(statuses,[201,202,200]);
  const message=f.store.state.messages.find(x=>x.id==='m');assert.equal(message.unread,true);assert.equal(message.folder,'trash');assert.deepEqual(message.folderIds,['trash']);
  assert.equal(f.store.state.drafts.length,1);assert.equal(f.store.state.jobs.length,1);
 }finally{releaseResolve();await f.close();}
});

test('sync completion after account removal cannot recreate its messages',async()=>{
 let startedResolve,releaseResolve;const started=new Promise(r=>startedResolve=r),blocked=new Promise(r=>releaseResolve=r);
 const f=await fixture(async(state)=>{startedResolve();await blocked;return state.messages;});
 try{
  const sync=request(f,'/sync',{accountId:'a',folder:'inbox'});await started;
  assert.equal((await request(f,'/accounts/a',undefined,'DELETE')).status,204);
  releaseResolve();await sync;
  assert.equal(f.store.state.accounts.length,0);assert.equal(f.store.state.messages.length,0);
 }finally{releaseResolve();await f.close();}
});

test('remote folder listing releases the store queue while waiting on the provider',async()=>{
 let startedResolve,releaseResolve;const started=new Promise(r=>startedResolve=r),blocked=new Promise(r=>releaseResolve=r);
 const f=await fixture(async state=>state.messages,undefined,async()=>{startedResolve();await blocked;return [{id:'custom',role:'custom'}];});
 try{
  const folders=request(f,'/folders?refresh=true',undefined,'GET');await started;
  const draft=await Promise.race([request(f,'/drafts',{accountId:'a',to:'x@example.test',subject:'quick',text:'fictional'}),delay(500).then(()=>null)]);
  releaseResolve();await folders;
  assert.ok(draft,'folder network lookup must not hold the store write queue');assert.equal(draft.status,201);
 }finally{releaseResolve();await f.close();}
});

test('parallel first discovery of the same id unions folder memberships',async()=>{
 let startedResolve,releaseResolve;const started=new Promise(r=>startedResolve=r),blocked=new Promise(r=>releaseResolve=r);
 const f=await fixture(async(state,_account,folder)=>{
  const id=typeof folder==='string'?folder:folder.id;if(id==='inbox'){startedResolve();await blocked;}
  state.messages.push({id:'first-seen',accountId:'a',folder:id,folderIds:[id],folders:[id],unread:false,subject:`seen-${id}`,text:'fictional'});return state.messages;
 });
 try{
  await f.store.mutate(s=>{s.messages=[];});
  const inbox=request(f,'/sync',{accountId:'a',folder:'inbox'});await started;
  assert.equal((await request(f,'/sync',{accountId:'a',folder:'custom'})).status,200);
  releaseResolve();await inbox;
  const message=f.store.state.messages.find(x=>x.id==='first-seen');assert.ok(message);assert.ok(message.folderIds.includes('inbox'));assert.ok(message.folderIds.includes('custom'));
 }finally{releaseResolve();await f.close();}
});

test('slow body loading releases the store queue and preserves concurrent flags and moves',async()=>{
 let startedResolve,releaseResolve;const started=new Promise(r=>startedResolve=r),blocked=new Promise(r=>releaseResolve=r);
 const f=await fixture(async state=>state.messages,async(_state,message,patch)=>{Object.assign(message,patch);if(patch.folder){message.folder=patch.folder;message.folderIds=[patch.folder];message.folders=message.folderIds;}},undefined,async(_state,message)=>{startedResolve();await blocked;message.text='loaded fictional body';message.attachments=[{id:'m:attachment',filename:'notes.txt',size:12}];message.bodyLoaded=true;});
 try{
  await f.store.mutate(s=>{s.messages[0].bodyLoaded=false;s.messages[0].text='';});
  const body=request(f,'/messages/m',undefined,'GET');await started;
  const quick=await Promise.race([Promise.all([request(f,'/drafts',{accountId:'a',to:'x@example.test',subject:'body wait',text:'fictional'}),request(f,'/translations',{text:'fictional text',targetLanguage:'English',mode:'assistant'})]),delay(500).then(()=>null)]);
  await request(f,'/messages/m',{unread:true},'PATCH');await request(f,'/messages/m',{folder:'trash'},'PATCH');
  releaseResolve();const response=await body;
  assert.ok(quick,'draft and translation writes must proceed while body network loading is pending');assert.deepEqual(quick.map(x=>x.status),[201,202]);assert.equal(response.status,200);
  const message=f.store.state.messages.find(x=>x.id==='m');assert.equal(message.text,'loaded fictional body');assert.equal(message.bodyLoaded,true);assert.equal(message.attachments[0].filename,'notes.txt');assert.equal(message.unread,true);assert.equal(message.folder,'trash');assert.deepEqual(message.folderIds,['trash']);
 }finally{releaseResolve();await f.close();}
});

test('service stop waits for background polling network work before closing the store',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'lettide-stop-sync-')),store=await new Store({file:path.join(dir,'state'),codec:{protect:async x=>x,unprotect:async x=>x}}).open();
 await store.mutate(s=>{s.accounts=[{id:'a',provider:'qq',email:'a@example.test',folders:[{id:'custom',role:'custom'}],foldersSyncedAt:new Date().toISOString()}];});
 let startedResolve,releaseResolve,closed=false;const started=new Promise(r=>startedResolve=r),blocked=new Promise(r=>releaseResolve=r),realClose=store.close.bind(store);store.close=async()=>{closed=true;return realClose();};
 const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const service=await startService({store,port,folderLister:async()=>[],mailSyncer:async(_state,account,folder)=>{startedResolve();await blocked;account.lastSync=`finished-${folder}`;}});
 try{
  await started;let stopped=false;const stop=service.stop().then(()=>{stopped=true;});await delay(30);assert.equal(closed,false);assert.equal(stopped,false);
  releaseResolve();await stop;assert.equal(closed,true);assert.equal(store.state.accounts[0].lastSync,'finished-inbox');
 }finally{releaseResolve();if(!closed)await service.stop();await rm(dir,{recursive:true,force:true});}
});

test('small visible IMAP bodies prefetch without blocking the list, coalesce with opening, and skip large attachments',async()=>{
 let release,started,calls=0;const gate=new Promise(r=>release=r),ready=new Promise(r=>started=r);
 const f=await fixture(async()=>[],async(_s,m,p)=>Object.assign(m,p),async()=>[],async(_s,m,deps)=>{calls++;assert.equal(deps.priority,'background');started();await gate;m.text='Fictional prefetched body';m.bodyLoaded=true;});
 try{
  await f.store.mutate(s=>{Object.assign(s.messages[0],{bodyLoaded:false,size:1024,providerRef:{type:'imap'}});s.messages.push({...s.messages[0],id:'large',size:1024*1024});});
  const list=await request(f,'/messages',undefined,'GET');assert.equal(list.status,200);await ready;
  const opening=request(f,'/messages/m',undefined,'GET');
  const draft=await request(f,'/drafts',{accountId:'a',to:'receiver@example.test',text:'Fictional draft'});assert.equal(draft.status,201);assert.equal(calls,1);
  release();assert.equal((await (await opening).json()).text,'Fictional prefetched body');await f.server.closeIdleConnections?.();await new Promise(r=>setImmediate(r));assert.equal(calls,1);
 }finally{release();await f.close();}
});
