import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store} from '../src/store.js';

// Fictional reversible codec; fixtures never use the real data directory or platform keys.
const codec={protect:async x=>Buffer.concat([Buffer.from('T'),Buffer.from(x.map(b=>b^0x5a))]),unprotect:async x=>{assert.equal(x[0],0x54);return Buffer.from(x.subarray(1).map(b=>b^0x5a));}};
const fixture=async fn=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lettide-recovery-'));try{await fn(dir,path.join(dir,'state.dpapi'));}finally{await fs.rm(dir,{recursive:true,force:true});}};
const state=()=>({version:1,token:'fictional-token',accounts:[{id:'a',email:'fictional@example.test',password:'fictional-secret'}],messages:[{id:'m',accountId:'a',text:'cached body',attachments:[]}],drafts:[{id:'d',accountId:'a',text:'unsent draft'}],settings:{translationMode:'google'},jobs:[],sendResults:{}});
const intermediate=(file,suffix)=>`${file}.123.${randomUUID()}.${suffix}`;
const writeState=async(file,value)=>fs.writeFile(file,await codec.protect(Buffer.from(JSON.stringify(value))));
const readState=async file=>JSON.parse((await codec.unprotect(await fs.readFile(file))).toString('utf8'));
const snapshot=async dir=>{const out={};for(const name of (await fs.readdir(dir)).sort())out[name]=(await fs.readFile(path.join(dir,name))).toString('base64');return out;};

test('Writer restores a lone backup with all accounts, cached mail and drafts intact',t=>fixture(async(dir,file)=>{
  const expected=state(),backup=intermediate(file,'bak');await writeState(backup,expected);
  const log=t.mock.method(console,'error',()=>{}),store=await new Store({file,codec}).open();
  try{
    assert.deepEqual(store.state,expected);assert.deepEqual(await readState(file),expected);
    assert.deepEqual((await fs.readdir(dir)).sort(),['state.dpapi','state.dpapi.lock']);
    assert.equal(log.mock.callCount(),1);assert.match(log.mock.calls[0].arguments.join(' '),/recover.*backup/i);
    assert.ok(!log.mock.calls[0].arguments.join(' ').includes(expected.token));
  }finally{await store.close();}
}));

test('Recovery picks the newest decryptable JSON backup and never a tmp or stale legacy copy',()=>fixture(async(dir,file)=>{
  const expected=state(),old=intermediate(file,'bak'),good=intermediate(file,'bak'),corrupt=intermediate(file,'bak'),invalid=intermediate(file,'bak'),tmp=intermediate(file,'tmp'),legacy=path.join(dir,'legacy');
  await writeState(old,{...expected,token:'old'});await writeState(good,expected);await fs.writeFile(corrupt,'truncated');await fs.writeFile(invalid,await codec.protect(Buffer.from('{')));
  await writeState(tmp,{...expected,token:'uncommitted'});await writeState(legacy,{...expected,token:'legacy'});
  for(const [index,name] of [old,good,corrupt,invalid,tmp].entries()){const date=new Date(1700000000000+index*10000);await fs.utimes(name,date,date);}
  const store=await new Store({file,legacyFile:legacy,codec}).open();
  try{assert.deepEqual(store.state,expected);assert.deepEqual(await readState(file),expected);assert.deepEqual((await fs.readdir(dir)).sort(),['legacy','state.dpapi','state.dpapi.lock']);}finally{await store.close();}
}));

test('Unreadable backups refuse initialization and preserve every intermediate file',()=>fixture(async(dir,file)=>{
  await fs.writeFile(intermediate(file,'bak'),'truncated');await writeState(intermediate(file,'tmp'),state());
  const before=await snapshot(dir);assert.equal(Object.keys(before).length,2);
  await assert.rejects(new Store({file,codec}).open(),/refusing to reset/);
  assert.deepEqual(await snapshot(dir),before);await assert.rejects(fs.readFile(file),{code:'ENOENT'});
}));

test('Writer cleans only regular intermediate files belonging to this state',()=>fixture(async(dir,file)=>{
  const expected=state();await writeState(file,expected);
  const stale=['tmp','bak','init','migrate'].map(suffix=>intermediate(file,suffix));for(const name of stale)await fs.writeFile(name,'interrupted');
  const keep=[intermediate(path.join(dir,'other.dpapi'),'bak'),intermediate(file+'.key.dpapi','tmp'),file+'.123.not-a-uuid.bak',file+'.notes.tmp',file+'.key.dpapi'];
  for(const name of keep)await fs.writeFile(name,'unrelated');
  const directory=intermediate(file,'tmp');await fs.mkdir(directory);await fs.writeFile(path.join(directory,'keep'),'unrelated');
  const store=await new Store({file,codec}).open();
  try{
    assert.deepEqual(store.state,expected);for(const name of stale)await assert.rejects(fs.readFile(name),{code:'ENOENT'});
    for(const name of keep)assert.equal(await fs.readFile(name,'utf8'),'unrelated');assert.equal(await fs.readFile(path.join(directory,'keep'),'utf8'),'unrelated');
  }finally{await store.close();}
}));

test('Fresh initialization ignores tmp contents and cleans interrupted tmp, init and migrate files',()=>fixture(async(dir,file)=>{
  for(const suffix of ['tmp','init','migrate'])await writeState(intermediate(file,suffix),state());
  const store=await new Store({file,codec}).open();
  try{assert.deepEqual(store.state.accounts,[]);assert.notEqual(store.state.token,state().token);assert.deepEqual((await fs.readdir(dir)).sort(),['state.dpapi','state.dpapi.lock']);}finally{await store.close();}
}));

// Saving still moves the committed state aside before placing the new one: on Windows a replace-in-place
// fails while another process briefly has the file open, but moving an open file aside does not.
test('Saving leaves only the committed state, and an interruption between the two renames is recovered',()=>fixture(async(dir,file)=>{
  const store=await new Store({file,codec}).open();
  try{await store.mutate(s=>Object.assign(s,state()));await store.save();assert.deepEqual(await readState(file),state());assert.deepEqual((await fs.readdir(dir)).sort(),['state.dpapi','state.dpapi.lock']);}finally{await store.close();}
  await fs.rename(file,intermediate(file,'bak'));await writeState(intermediate(file,'tmp'),{...state(),token:'never-committed'});
  const reopened=await new Store({file,codec}).open();
  try{assert.deepEqual(reopened.state,state());assert.deepEqual((await fs.readdir(dir)).sort(),['state.dpapi','state.dpapi.lock']);}finally{await reopened.close();}
}));

test('Read-only open never recovers backups or cleans intermediates, whether state exists or not',()=>fixture(async(dir,file)=>{
  const expected=state();for(const suffix of ['tmp','bak','init','migrate'])await writeState(intermediate(file,suffix),expected);
  const before=await snapshot(dir);assert.equal(Object.keys(before).length,4);
  await assert.rejects(new Store({file,codec,readOnly:true}).open(),{code:'ENOENT'});assert.deepEqual(await snapshot(dir),before);
  await writeState(file,expected);const present=await snapshot(dir),reader=await new Store({file,codec,readOnly:true}).open();
  try{assert.deepEqual(reader.state,expected);}finally{await reader.close();}
  assert.deepEqual(await snapshot(dir),present);
}));

test('Existing corrupt state fails closed without replacing it with a backup or cleaning evidence',()=>fixture(async(dir,file)=>{
  await fs.writeFile(file,'corrupt');await writeState(intermediate(file,'bak'),state());await fs.writeFile(intermediate(file,'tmp'),'partial');
  const before=await snapshot(dir);await assert.rejects(new Store({file,codec}).open(),/refusing to reset/);assert.deepEqual(await snapshot(dir),before);
}));

test('Another writer lock prevents backup recovery and cleanup',()=>fixture(async(dir,file)=>{
  await writeState(intermediate(file,'bak'),state());const owner=new Store({file,codec});await owner.acquireWriterLock();
  try{const before=await snapshot(dir);await assert.rejects(new Store({file,codec}).open(),/Another email service/);assert.deepEqual(await snapshot(dir),before);}finally{await owner.close();}
}));

test('Failed backup rename preserves the backup and refuses to create an empty state',t=>fixture(async(dir,file)=>{
  await writeState(intermediate(file,'bak'),state());const before=await snapshot(dir);
  const replacement=t.mock.method(fs,'rename',async()=>{throw Object.assign(new Error('Fictional recovery failure'),{code:'EIO'});});
  try{await assert.rejects(new Store({file,codec}).open(),/refusing to reset/);assert.deepEqual(await snapshot(dir),before);}finally{replacement.mock.restore();}
}));
