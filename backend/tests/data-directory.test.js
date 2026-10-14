import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Store,dataDirectory} from '../src/store.js';

const codec={protect:async x=>x,unprotect:async x=>x};
const fixture=async fn=>{const dir=await mkdtemp(path.join(os.tmpdir(),'lettide-datadir-'));try{await fn(dir)}finally{await rm(dir,{recursive:true,force:true});}};

test('Data directory honours LETTIDE_DATA_DIR and leaves Windows AppData',()=>{
  const saved=process.env.LETTIDE_DATA_DIR;
  try{
    process.env.LETTIDE_DATA_DIR='fictional-lettide-data';assert.equal(dataDirectory(),path.resolve('fictional-lettide-data'));
    delete process.env.LETTIDE_DATA_DIR;
    if(process.platform==='win32')assert.equal(dataDirectory(),path.join(os.homedir(),'.lettide'));
  }finally{if(saved===undefined)delete process.env.LETTIDE_DATA_DIR;else process.env.LETTIDE_DATA_DIR=saved;}
});

test('Legacy data is copied once, kept in place, and newer data is never overwritten',()=>fixture(async dir=>{
  const legacy=path.join(dir,'legacy','state'),file=path.join(dir,'current','state'),state={version:1,token:'fictional-token',accounts:[{id:'a'}],messages:[],drafts:[]};
  await mkdir(path.join(dir,'legacy','models','m'),{recursive:true});
  await writeFile(legacy,JSON.stringify(state));await writeFile(legacy+'.key.dpapi','fictional-key');await writeFile(path.join(dir,'legacy','models','m','w.bin'),'weights');
  const first=await new Store({file,legacyFile:legacy,codec}).open();
  try{assert.deepEqual(first.state,state);}finally{await first.close();}
  assert.equal(await readFile(file+'.key.dpapi','utf8'),'fictional-key');
  assert.equal(await readFile(path.join(dir,'current','models','m','w.bin'),'utf8'),'weights');
  assert.equal(await readFile(legacy,'utf8'),JSON.stringify(state));
  assert.deepEqual((await readdir(path.join(dir,'current'))).filter(x=>/\.migrate$/.test(x)),[]);
  await writeFile(legacy,JSON.stringify({...state,token:'stale-token'}));
  const second=await new Store({file,legacyFile:legacy,codec}).open();
  try{assert.equal(second.state.token,'fictional-token');}finally{await second.close();}
}));

test('Readers never migrate and a missing legacy file starts fresh',()=>fixture(async dir=>{
  const legacy=path.join(dir,'legacy','state'),file=path.join(dir,'current','state');
  await mkdir(path.dirname(legacy),{recursive:true});await writeFile(legacy,'{"token":"legacy"}');
  await assert.rejects(new Store({file,legacyFile:legacy,codec,readOnly:true}).open(),{code:'ENOENT'});
  const fresh=await new Store({file,legacyFile:path.join(dir,'missing','state'),codec}).open();
  try{assert.notEqual(fresh.state.token,'legacy');assert.deepEqual(fresh.state.accounts,[]);}finally{await fresh.close();}
}));
