import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,readdir,rm,stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.js';

// Fictional reversible codec, so plaintext attachment bytes on disk are detectable.
const codec={protect:async x=>Buffer.concat([Buffer.from('T'),Buffer.from(x.map(b=>b^0x5a))]),unprotect:async x=>{assert.equal(x[0],0x54);return Buffer.from(x.subarray(1).map(b=>b^0x5a));}};
const fixture=async fn=>{const dir=await mkdtemp(path.join(os.tmpdir(),'lettide-attachments-'));try{await fn(dir,path.join(dir,'state'))}finally{await rm(dir,{recursive:true,force:true});}};
const big=Buffer.alloc(2*1024*1024,'fictional attachment ');
const message=(id,content)=>({id,accountId:'a',subject:'fictional',text:'body',attachments:[{id:`${id}:att:0`,filename:'report.pdf',size:content.length,content:content.toString('base64')}]});
const files=async dir=>(await readdir(path.join(dir,'attachments')).catch(()=>[])).sort();

test('Inline attachments move out of the mail index on open and still download intact',()=>fixture(async(dir,file)=>{
  await writeFile(file,await codec.protect(Buffer.from(JSON.stringify({version:1,token:'t',accounts:[{id:'a'}],messages:[message('m1',big)],drafts:[]}))));
  const store=await new Store({file,codec}).open();
  try{
    const a=store.state.messages[0].attachments[0];
    assert.equal(a.content,undefined);assert.match(a.sha256,/^[0-9a-f]{64}$/);
    assert.deepEqual(await store.readAttachment(a),big);
    assert.ok((await stat(file)).size<10_000,'index no longer carries attachment bytes');
    const [name]=await files(dir);assert.equal(name,a.blob);
    assert.ok(!(await readFile(path.join(dir,'attachments',name))).includes(Buffer.from('fictional attachment')),'attachment is encrypted on disk');
  }finally{await store.close();}
  const reader=await new Store({file,codec,readOnly:true}).open();
  try{assert.deepEqual(await reader.readAttachment(reader.state.messages[0].attachments[0]),big);}finally{await reader.close();}
}));

test('New mail attachments are written once and reused when the same content returns',()=>fixture(async(dir,file)=>{
  const store=await new Store({file,codec}).open();
  try{
    await store.mutate(s=>{s.messages.push(message('m1',big));});
    const first=store.state.messages[0].attachments[0].blob;
    await store.mutate(s=>{s.messages[0]=message('m1',big);});
    assert.equal(store.state.messages[0].attachments[0].blob,first);
    assert.deepEqual(await files(dir),[first]);
  }finally{await store.close();}
}));

test('Tampered or swapped attachment files fail closed',()=>fixture(async(dir,file)=>{
  const store=await new Store({file,codec}).open();
  try{
    await store.mutate(s=>{s.messages.push(message('m1',big),message('m2',Buffer.from('other fictional file')));});
    const [a1,a2]=store.state.messages.map(m=>m.attachments[0]);
    await assert.rejects(store.readAttachment({...a1,blob:a2.blob}),/verification/);
    await assert.rejects(store.readAttachment({...a1,blob:'../state'}),/unavailable/);
    const target=path.join(dir,'attachments',a1.blob),raw=await readFile(target);raw[raw.length-1]^=1;await writeFile(target,raw);
    await assert.rejects(store.readAttachment(a1));
  }finally{await store.close();}
}));

test('Files of removed mail and interrupted saves are cleaned when the writer opens',()=>fixture(async(dir,file)=>{
  let keep;
  const store=await new Store({file,codec}).open();
  try{
    await store.mutate(s=>{s.messages.push(message('m1',big),message('m2',Buffer.from('removed fictional file')));});
    keep=store.state.messages[0].attachments[0].blob;
    await store.mutate(s=>{s.messages=s.messages.filter(m=>m.id==='m1');});
    await writeFile(path.join(dir,'attachments',`${keep}.123.tmp`),'partial');
    assert.equal((await files(dir)).length,3);
  }finally{await store.close();}
  const reopened=await new Store({file,codec}).open();
  try{assert.deepEqual(await files(dir),[keep]);assert.deepEqual(await reopened.readAttachment(reopened.state.messages[0].attachments[0]),big);}finally{await reopened.close();}
}));
