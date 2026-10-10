import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {createServer} from 'node:http';
import {Store} from '../src/store.js';import {createApp} from '../src/server.js';
test('Body reads are deduplicated, cached and available to translations; syncs reuse folder metadata',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'lettide-body-')),store=await new Store({file:path.join(dir,'state'),codec:{protect:async x=>x,unprotect:async x=>x}}).open();let reads=0,lists=0,syncs=0;
 await store.mutate(s=>{s.accounts=[{id:'qq',provider:'qq',folders:[{id:'inbox',role:'inbox'}],foldersSyncedAt:new Date().toISOString()}];s.messages=['one','two'].map(id=>({id,accountId:'qq',folderIds:['inbox'],subject:'Fictional',bodyLoaded:false,text:''}))});
 const port=47955,base=`http://127.0.0.1:${port}`,app=await createApp({store,port,messageLoader:async(_s,m)=>{reads++;await new Promise(r=>setTimeout(r,70));m.text='Fictional complete body';m.bodyLoaded=true},folderLister:async()=>{lists++;return []},mailSyncer:async(_s,_a,_f,_q,_n,options)=>{assert.equal(options.metadataOnly,true);syncs++;await new Promise(r=>setTimeout(r,70))},localTranslator:{status:async()=>({state:'ready'}),translate:async text=>{assert.equal(text,'Fictional complete body');return '虚构正文'}}}),server=createServer(app);await new Promise(r=>server.listen(port,'127.0.0.1',r));
 const request=(url,body)=>fetch(base+'/api'+url,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+store.state.token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}).then(async r=>({status:r.status,body:await r.json()}));
 try{
  const rows=await request('/messages');assert.equal(rows.body.items[0].bodyLoaded,false);assert.equal(reads,0);
  const read=await Promise.all([request('/messages/one'),request('/messages/one')]);assert.ok(read.every(r=>r.body.text==='Fictional complete body'));assert.equal(reads,1);await request('/messages/one');assert.equal(reads,1);
  const translated=await request('/translations',{messageId:'two',targetLanguage:'简体中文',mode:'local'});assert.equal(translated.status,200);assert.equal(translated.body.translation,'虚构正文');assert.equal(reads,2);
  await Promise.all([request('/sync',{accountId:'qq',folder:'inbox'}),request('/sync',{accountId:'qq',folder:'inbox'})]);assert.equal(syncs,1);assert.equal(lists,0);
 }finally{await new Promise(r=>server.close(r));await store.close();await rm(dir,{recursive:true,force:true})}
});
