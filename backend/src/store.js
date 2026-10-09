import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {randomBytes, randomUUID} from 'node:crypto';

const initial = () => ({version:1, token:randomBytes(32).toString('base64url'), accounts:[], messages:[], drafts:[], settings:{translationMode:'assistant',ollamaModel:'qwen2.5:7b'}, jobs:[], sendResults:{}});
function dpapi(mode, payload) {
  if (process.platform !== 'win32') throw new Error('Protected storage is unavailable on this platform');
  const script = 'Add-Type -AssemblyName System.Security;'+(mode === 'protect'
    ? '$b=[Convert]::FromBase64String([Console]::In.ReadToEnd());$p=[Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($p))'
    : '$b=[Convert]::FromBase64String([Console]::In.ReadToEnd());$p=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($p))');
  return new Promise((resolve,reject)=>{
    const ps=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,stdio:['pipe','pipe','ignore']});
    let out=''; ps.stdout.setEncoding('utf8').on('data',x=>out+=x); ps.on('error',()=>reject(new Error('Windows protected storage failed'))); ps.on('close',code=>code===0&&out?resolve(Buffer.from(out.trim(),'base64')):reject(new Error('Windows protected storage failed'))); ps.stdin.end(payload.toString('base64'));
  });
}
export class Store {
  constructor({file=path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'Lettide','state.dpapi'), codec=null,readOnly=false}={}) { this.file=file; this.codec=codec; this.readOnly=readOnly; this.state=null; this.queue=Promise.resolve(); this.lockHandle=null; }
  async open(){
    if(this.state&&(this.readOnly||this.lockHandle))return this;
    if(!this.readOnly) await fs.mkdir(path.dirname(this.file),{recursive:true});
    if(!this.readOnly) await this.acquireWriterLock();
    try {
      let raw; try { raw=await fs.readFile(this.file); } catch(e) {
        if(e.code!=='ENOENT'||this.readOnly) throw e;
        this.state=initial(); const encrypted=await this.encrypt(Buffer.from(JSON.stringify(this.state))),tmp=`${this.file}.${process.pid}.${randomUUID()}.init`;
        const h=await fs.open(tmp,'wx',0o600);try{await h.writeFile(encrypted);await h.sync();}finally{await h.close();}
        try{await fs.link(tmp,this.file);await fs.rm(tmp,{force:true});return this;}catch(err){await fs.rm(tmp,{force:true});if(err.code!=='EEXIST')throw err;raw=await fs.readFile(this.file);}
      }
      if(raw){if(this.codec)this.state=JSON.parse((await this.codec.unprotect(raw)).toString('utf8'));else{if(!raw.subarray(0,4).equals(Buffer.from('YQ01')))throw new Error();this.state=JSON.parse((await dpapi('unprotect',raw.subarray(4))).toString('utf8'));}}
      return this;
    } catch(e){await this.close();if(e.message==='Windows protected storage failed'||e.message.startsWith('Another email service'))throw e;if(e.code==='ENOENT'&&this.readOnly)throw e;throw new Error('Stored data could not be safely opened; refusing to reset it');}
  }
  async acquireWriterLock(){
    const lockPath=this.file+'.lock';
    try{this.lockHandle=await fs.open(lockPath,'wx',0o600);this.lockPath=lockPath;await this.lockHandle.writeFile(JSON.stringify({pid:process.pid,startedAt:Date.now()}));await this.lockHandle.sync();}
    catch(e){if(e.code!=='EEXIST')throw e;let owner;try{owner=JSON.parse(await fs.readFile(lockPath,'utf8'));}catch{}let alive=true;if(owner?.pid)try{process.kill(owner.pid,0);}catch(err){if(err.code==='ESRCH')alive=false;}if(!alive){await fs.rm(lockPath,{force:true});return this.acquireWriterLock();}throw new Error('Another email service backend writer is already running');}
  }
  async encrypt(payload){return this.codec?this.codec.protect(payload):Buffer.concat([Buffer.from('YQ01'),await dpapi('protect',payload)]);}
  async persist(state){if(this.readOnly)throw new Error('Read-only store');const encrypted=await this.encrypt(Buffer.from(JSON.stringify(state))),tmp=`${this.file}.${process.pid}.${randomUUID()}.tmp`,backup=`${this.file}.${process.pid}.${randomUUID()}.bak`;const h=await fs.open(tmp,'wx',0o600);try{await h.writeFile(encrypted);await h.sync();}finally{await h.close();}try{try{await fs.rename(this.file,backup);await fs.rename(tmp,this.file);await fs.rm(backup,{force:true});}catch(e){try{await fs.access(backup);await fs.rename(backup,this.file);}catch{}throw e;}}catch(e){await fs.rm(tmp,{force:true});throw e;}}
  async save(){await this.persist(this.state);}
  mutate(fn){const operation=this.queue.catch(()=>{}).then(async()=>{if(this.readOnly)throw new Error('Read-only store');const next=structuredClone(this.state),out=await fn(next);await this.persist(next);this.state=next;return out;});this.queue=operation.catch(()=>{});return operation;}
  async close(){if(this.lockHandle){try{await this.lockHandle.close();}catch{}this.lockHandle=null;try{await fs.rm(this.lockPath,{force:true});}catch{}}}
}
export const newId=()=>randomUUID();
export const publicAccount=({password,accessToken,refreshToken,clientSecret,...a})=>a;
