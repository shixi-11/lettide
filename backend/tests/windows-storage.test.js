import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createWindowsCodec} from '../src/windows-crypto.js';
import {Store} from '../src/store.js';

test('Windows key wrapping stays small, ciphertext authenticates, and missing keys fail closed',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'lettide-key-')),keyFile=path.join(dir,'key.dpapi'),calls=[];
  const dpapi=async(mode,value)=>{calls.push({mode,bytes:value.length});if(mode==='protect')return Buffer.concat([Buffer.from('wrapped:'),value]);assert.equal(value.subarray(0,8).toString(),'wrapped:');return Buffer.from(value.subarray(8));};
  const codec=createWindowsCodec({keyFile,dpapi}),payload=Buffer.alloc(1024*1024,65);
  try{
    const first=await codec.protect(payload),second=await codec.protect(payload);
    assert.equal(first.subarray(0,4).toString(),'YQ03');assert.notDeepEqual(first,second);
    assert.deepEqual(await codec.unprotect(first),payload);
    assert.ok(calls.every(c=>c.bytes<=40));assert.equal(calls.filter(c=>c.mode==='protect').length,1);
    const corrupted=Buffer.from(first);corrupted[20]^=1;await assert.rejects(codec.unprotect(corrupted));
    codec.close();const wrapped=await readFile(keyFile);await rm(keyFile);
    await assert.rejects(codec.unprotect(first),{code:'ENOENT'});
    await assert.rejects(readFile(keyFile),{code:'ENOENT'});
    await writeFile(keyFile,Buffer.from('corrupt'));await assert.rejects(codec.unprotect(first));
    assert.equal((await readFile(keyFile)).toString(),'corrupt');
    await writeFile(keyFile,wrapped);assert.deepEqual(await codec.unprotect(first),payload);
    codec.close();await writeFile(keyFile,Buffer.concat([Buffer.from('wrapped:'),Buffer.alloc(32,7)]));
    await assert.rejects(codec.unprotect(first));
  }finally{codec.close();await rm(dir,{recursive:true,force:true});}
});

function legacyProtect(payload){
  return new Promise((resolve,reject)=>{
    const script='Add-Type -AssemblyName System.Security;$b=[Convert]::FromBase64String([Console]::In.ReadToEnd());$p=[Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($p))';
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,stdio:['pipe','pipe','ignore']});let out='';child.stdout.on('data',s=>out+=s);child.on('error',reject);child.on('close',code=>code===0?resolve(Buffer.from(out,'base64')):reject(new Error('legacy fixture failed')));child.stdin.end(payload.toString('base64'));
  });
}
test('Windows legacy store migrates on save and reopens with DPAPI-wrapped AES key',{skip:process.platform!=='win32'},async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'lettide-migrate-')),file=path.join(dir,'state.dpapi');let writer,reader;
  try{
    const state={version:1,token:'fictional',accounts:[],messages:[],settings:{example:'retained'}};
    await writeFile(file,Buffer.concat([Buffer.from('YQ01'),await legacyProtect(Buffer.from(JSON.stringify(state)))]));
    writer=await new Store({file}).open();assert.deepEqual(writer.state,state);
    await writer.save();await writer.close();assert.equal((await readFile(file)).subarray(0,4).toString(),'YQ03');
    assert.ok((await readFile(file+'.key.dpapi')).length<2048);
    reader=await new Store({file,readOnly:true}).open();assert.deepEqual(reader.state,state);await reader.close();
    const original=await readFile(file),tampered=Buffer.from(original);tampered[31]^=1;await writeFile(file,tampered);
    await assert.rejects(new Store({file}).open(),/refusing to reset/);assert.deepEqual(await readFile(file),tampered);
    await writeFile(file,original);await rm(file+'.key.dpapi');
    await assert.rejects(new Store({file}).open(),/refusing to reset/);assert.deepEqual(await readFile(file),original);
    await assert.rejects(readFile(file+'.key.dpapi'),{code:'ENOENT'});
  }finally{await writer?.close();await reader?.close();await rm(dir,{recursive:true,force:true});}
});
