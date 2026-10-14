import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {cloneData,sameData} from '../src/data-clone.js';
import {Store} from '../src/store.js';

test('mail snapshots isolate nested containers, preserve payloads and handle own prototype keys safely',()=>{
 const source=JSON.parse('{"messages":[{"attachments":[{"content":"ZmFrZS1wYXlsb2Fk","metadata":{"tags":["sample"]}}]}],"__proto__":{"polluted":true}}');
 const copy=cloneData(source);assert.deepEqual(copy,source);assert.notEqual(copy.messages,source.messages);assert.notEqual(copy.messages[0].attachments[0].metadata,source.messages[0].attachments[0].metadata);
 copy.messages[0].attachments[0].metadata.tags.push('changed');copy.messages[0].attachments[0].content='new';assert.equal(source.messages[0].attachments[0].content,'ZmFrZS1wYXlsb2Fk');assert.deepEqual(source.messages[0].attachments[0].metadata.tags,['sample']);assert.equal({}.polluted,undefined);assert.equal(Object.getPrototypeOf(copy),Object.prototype);assert.equal(Object.hasOwn(copy,'__proto__'),true);
 assert.equal(sameData({a:1,b:{c:2}},{b:{c:2},a:1}),true);assert.equal(sameData(source,copy),false);
});

test('failed encrypted persistence cannot leak nested attachment edits and later writes still succeed',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'lettide-isolated-clone-'));let fail=false;
 const store=await new Store({file:join(dir,'state'),codec:{protect:async data=>{if(fail)throw new Error('fictional disk error');return data;},unprotect:async data=>data}}).open();
 try{
  await store.mutate(s=>s.messages.push({id:'sample',attachments:[{content:'ZmFrZQ==',metadata:{tags:['base']}}]}));
  const saved={...store.state.messages[0].attachments[0]};assert.equal(saved.content,undefined);
  fail=true;await assert.rejects(store.mutate(s=>{s.messages[0].attachments[0].content='changed';s.messages[0].attachments[0].metadata.tags.push('changed');}),/fictional disk error/);
  assert.equal(store.state.messages[0].attachments[0].blob,saved.blob);assert.equal(store.state.messages[0].attachments[0].content,undefined);assert.equal((await store.readAttachment(store.state.messages[0].attachments[0])).toString(),'fake');assert.deepEqual(store.state.messages[0].attachments[0].metadata.tags,['base']);fail=false;await store.mutate(s=>s.messages[0].starred=true);assert.equal(store.state.messages[0].starred,true);
  const readback=await new Store({file:join(dir,'state'),readOnly:true,codec:{unprotect:async data=>data}}).open();try{assert.deepEqual(readback.state.messages,store.state.messages);}finally{await readback.close();}
 }finally{await store.close();await rm(dir,{recursive:true,force:true});}
});
