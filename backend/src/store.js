import {cloneData} from './data-clone.js';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import * as macosCrypto from './macos-crypto.js';
import {createWindowsCodec} from './windows-crypto.js';
import {createLinuxCodec} from './linux-crypto.js';

const initial = () => ({version:1, token:randomBytes(32).toString('base64url'), accounts:[], messages:[], drafts:[], settings:{translationMode:'google',ollamaModel:'qwen2.5:7b'}, jobs:[], sendResults:{}});
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
// Store-packaged Windows apps (Claude, Codex) privately redirect new files under AppData,
// so each client would see its own copy and token. The user profile root is shared by all.
export function dataDirectory(){
  if(process.env.LETTIDE_DATA_DIR)return path.resolve(process.env.LETTIDE_DATA_DIR);
  if(process.platform==='darwin')return path.join(os.homedir(),'Library','Application Support','Lettide');
  if(process.platform==='linux')return path.join(path.isAbsolute(process.env.XDG_DATA_HOME||'')?process.env.XDG_DATA_HOME:path.join(os.homedir(),'.local','share'),'Lettide');
  return path.join(os.homedir(),'.lettide');
}
const legacyWindowsFile=()=>path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'Lettide','state.dpapi');
const exists=file=>fs.access(file).then(()=>true,()=>false);
const sha256=data=>createHash('sha256').update(data).digest('hex');
const attachmentName=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const hasInlineAttachments=state=>(state?.messages||[]).some(m=>(m.attachments||[]).some(a=>typeof a.content==='string'));
export class Store {
  constructor({file, legacyFile, codec=null,readOnly=false}={}) {
    const usesDefault=!file;
    file??=path.join(dataDirectory(),process.platform==='win32'?'state.dpapi':'state.enc');
    this.file=file; this.legacyFile=legacyFile??(usesDefault&&process.platform==='win32'&&!process.env.LETTIDE_DATA_DIR?legacyWindowsFile():null);
    this.codec=codec; this.readOnly=readOnly; this.state=null; this.revision=0; this.queue=Promise.resolve(); this.lockHandle=null; this.windowsCrypto=createWindowsCodec({keyFile:file+'.key.dpapi',dpapi}); this.linuxCrypto=createLinuxCodec({keyId:createHash('sha256').update(path.resolve(file)).digest('hex')});
  }
  // Copies (never moves) data from the pre-0.3.12 location. The state file lands last, so its presence means the copy finished.
  async migrateLegacy(){
    if(!this.legacyFile||path.resolve(this.legacyFile)===path.resolve(this.file)||await exists(this.file)||!await exists(this.legacyFile))return;
    const from=path.dirname(this.legacyFile),to=path.dirname(this.file);
    try{await fs.cp(path.join(from,'models'),path.join(to,'models'),{recursive:true,force:false,errorOnExist:false});}catch(e){if(e.code!=='ENOENT')console.error('[Lettide] Translation model copy skipped:',e.message);}
    if(await exists(this.legacyFile+'.key.dpapi'))await fs.copyFile(this.legacyFile+'.key.dpapi',this.file+'.key.dpapi');
    const tmp=`${this.file}.${process.pid}.${randomUUID()}.migrate`;
    try{await fs.copyFile(this.legacyFile,tmp);await fs.rename(tmp,this.file);}finally{await fs.rm(tmp,{force:true});}
  }
  async open(){
    if(this.state&&(this.readOnly||this.lockHandle))return this;
    if(!this.readOnly) await fs.mkdir(path.dirname(this.file),{recursive:true,mode:0o700});
    if(process.platform!=='win32'&&!this.readOnly)await fs.chmod(path.dirname(this.file),0o700);
    if(!this.readOnly) await this.acquireWriterLock();
    try {
      if(!this.readOnly) await this.migrateLegacy();
      let raw; try { raw=await fs.readFile(this.file); } catch(e) {
        if(e.code!=='ENOENT'||this.readOnly) throw e;
        this.state=initial(); const encrypted=await this.encrypt(Buffer.from(JSON.stringify(this.state))),tmp=`${this.file}.${process.pid}.${randomUUID()}.init`;
        const h=await fs.open(tmp,'wx',0o600);try{await h.writeFile(encrypted);await h.sync();}finally{await h.close();}
        try{await fs.link(tmp,this.file);await fs.rm(tmp,{force:true});return this;}catch(err){await fs.rm(tmp,{force:true});if(err.code!=='EEXIST')throw err;raw=await fs.readFile(this.file);}
      }
      if(raw){if(process.platform!=='win32'&&!this.readOnly)await fs.chmod(this.file,0o600);this.state=JSON.parse((await this.decrypt(raw)).toString('utf8'));}
      if(!this.readOnly){if(hasInlineAttachments(this.state))await this.save();await this.collectAttachmentFiles();}
      return this;
    } catch(e){await this.close();if(e.message==='Windows protected storage failed'||e.message.startsWith('macOS Keychain')||e.message.startsWith('Linux Secret Service')||e.message.startsWith('Another email service'))throw e;if(e.code==='ENOENT'&&this.readOnly)throw e;throw new Error('Stored data could not be safely opened; refusing to reset it');}
  }
  async acquireWriterLock(){
    const lockPath=this.file+'.lock';
    try{this.lockHandle=await fs.open(lockPath,'wx',0o600);this.lockPath=lockPath;await this.lockHandle.writeFile(JSON.stringify({pid:process.pid,startedAt:Date.now()}));await this.lockHandle.sync();}
    catch(e){if(e.code!=='EEXIST')throw e;let owner;try{owner=JSON.parse(await fs.readFile(lockPath,'utf8'));}catch{}let alive=true;if(owner?.pid)try{process.kill(owner.pid,0);}catch(err){if(err.code==='ESRCH')alive=false;}if(!alive){await fs.rm(lockPath,{force:true});return this.acquireWriterLock();}throw new Error('Another email service backend writer is already running');}
  }
  async encrypt(payload){if(this.codec)return this.codec.protect(payload);if(process.platform==='darwin')return macosCrypto.protect(payload);if(process.platform==='linux')return this.linuxCrypto.protect(payload);if(process.platform!=='win32')throw new Error('Protected storage is unavailable on this platform');return this.windowsCrypto.protect(payload);}
  async decrypt(raw){if(this.codec)return this.codec.unprotect(raw);const magic=raw.subarray(0,4).toString('latin1');if(magic==='YQ02'){if(process.platform!=='darwin')throw new Error();return macosCrypto.unprotect(raw);}if(magic==='YQ03'){if(process.platform!=='win32')throw new Error();return this.windowsCrypto.unprotect(raw);}if(magic==='YQ04'){if(process.platform!=='linux')throw new Error();return this.linuxCrypto.unprotect(raw);}if(magic!=='YQ01')throw new Error();return dpapi('unprotect',raw.subarray(4));}
  // Received attachments live in separate encrypted files, so routine saves rewrite only the small mail index.
  get attachmentDir(){return path.join(path.dirname(this.file),'attachments');}
  async readAttachment(attachment){
    if(typeof attachment?.content==='string')return Buffer.from(attachment.content,'base64');
    if(!attachmentName.test(attachment?.blob||''))throw new Error('Attachment content is unavailable');
    const data=await this.decrypt(await fs.readFile(path.join(this.attachmentDir,attachment.blob)));
    if(sha256(data)!==attachment.sha256)throw new Error('Attachment content failed verification');
    return data;
  }
  async externalizeAttachments(state){
    const known=new Map();for(const m of this.state?.messages||[])for(const a of m.attachments||[])if(a.blob)known.set(a.id,a);
    let dirReady=false;
    for(const m of state.messages||[])for(const a of m.attachments||[]){
      if(typeof a.content!=='string')continue;
      const data=Buffer.from(a.content,'base64'),hash=sha256(data),previous=known.get(a.id);
      if(previous?.sha256===hash&&await exists(path.join(this.attachmentDir,previous.blob)))a.blob=previous.blob;
      else{
        if(!dirReady){await fs.mkdir(this.attachmentDir,{recursive:true,mode:0o700});dirReady=true;}
        const blob=randomUUID(),file=path.join(this.attachmentDir,blob),tmp=`${file}.${process.pid}.tmp`,h=await fs.open(tmp,'wx',0o600);
        try{await h.writeFile(await this.encrypt(data));await h.sync();}finally{await h.close();}
        await fs.rename(tmp,file);a.blob=blob;
      }
      a.sha256=hash;delete a.content;
    }
  }
  // Only the writer runs this, before any transaction, so every unreferenced file is an orphan from removed mail or an interrupted save.
  async collectAttachmentFiles(){
    let names;try{names=await fs.readdir(this.attachmentDir);}catch{return;}
    const used=new Set();for(const m of this.state.messages||[])for(const a of m.attachments||[])if(a.blob)used.add(a.blob);
    for(const name of names)if(!used.has(name))await fs.rm(path.join(this.attachmentDir,name),{force:true}).catch(()=>{});
  }
  async persist(state){if(this.readOnly)throw new Error('Read-only store');await this.externalizeAttachments(state);const encrypted=await this.encrypt(Buffer.from(JSON.stringify(state))),tmp=`${this.file}.${process.pid}.${randomUUID()}.tmp`,backup=`${this.file}.${process.pid}.${randomUUID()}.bak`;const h=await fs.open(tmp,'wx',0o600);try{await h.writeFile(encrypted);await h.sync();}finally{await h.close();}try{try{await fs.rename(this.file,backup);await fs.rename(tmp,this.file);await fs.rm(backup,{force:true});}catch(e){try{await fs.access(backup);await fs.rename(backup,this.file);}catch{}throw e;}}catch(e){await fs.rm(tmp,{force:true});throw e;}}
  async save(){await this.persist(this.state);}
  mutate(fn){const operation=this.queue.catch(()=>{}).then(async()=>{if(this.readOnly)throw new Error('Read-only store');const next=cloneData(this.state),out=await fn(next);await this.persist(next);this.state=next;this.revision++;return out;});this.queue=operation.catch(()=>{});return operation;}
  async close(){this.windowsCrypto.close();this.linuxCrypto.close();if(this.lockHandle){try{await this.lockHandle.close();}catch{}this.lockHandle=null;try{await fs.rm(this.lockPath,{force:true});}catch{}}}
}
export const newId=()=>randomUUID();
export const publicAccount=({password,accessToken,refreshToken,clientSecret,...a})=>a;
