import {spawn} from 'node:child_process';
import {createCipheriv,createDecipheriv,randomBytes,timingSafeEqual} from 'node:crypto';

const SECURITY='/usr/bin/security';
const DEFAULT_SERVICE='com.lettide.store.encryption-key.v1';
const DEFAULT_ACCOUNT='state-key';

function run(args){
  return new Promise((resolve,reject)=>{
    const child=spawn(SECURITY,args,{stdio:['pipe','pipe','ignore']});let out=[];let settled=false;
    child.stdout.on('data',chunk=>out.push(chunk));
    child.on('error',()=>{if(!settled){settled=true;reject(new Error('macOS Keychain protected storage is unavailable'));}});
    child.on('close',code=>{if(settled)return;settled=true;code===0?resolve(Buffer.concat(out)):reject(new Error('macOS Keychain protected storage failed'));});
    child.stdin.end();
  });
}
function runInteractive(command){
  return new Promise((resolve,reject)=>{
    const child=spawn(SECURITY,['-i'],{stdio:['pipe','ignore','ignore']});let settled=false;
    child.on('error',()=>{if(!settled){settled=true;reject(new Error('macOS Keychain protected storage is unavailable'));}});
    child.on('close',code=>{if(settled)return;settled=true;code===0?resolve():reject(new Error('macOS Keychain protected storage failed'));});
    child.stdin.end(`${command}\n`);
  });
}
function decodeKey(output){
  const encoded=output.toString('utf8').trim();
  if(!/^(?:[A-Za-z0-9+/]{4}){10}[A-Za-z0-9+/]{3}=$/.test(encoded))throw new Error('macOS Keychain returned an invalid encryption key');
  const key=Buffer.from(encoded,'base64');
  if(key.length!==32||key.toString('base64')!==encoded){key.fill(0);throw new Error('macOS Keychain returned an invalid encryption key');}
  return key;
}
function assertIdentity(service,account){
  if(!/^[A-Za-z0-9._-]+$/.test(service)||!/^[A-Za-z0-9._-]+$/.test(account))throw new Error('Invalid macOS Keychain item identity');
}
export function createCodec({service=DEFAULT_SERVICE,account=DEFAULT_ACCOUNT,runSecurity=run,runSecurityInteractive=runInteractive}={}){
  assertIdentity(service,account);
  async function readKey(){return decodeKey(await runSecurity(['find-generic-password','-s',service,'-a',account,'-w']));}
  async function getKey(){
    try{return await readKey();}catch{
      const generated=randomBytes(32),encoded=generated.toString('base64');
      let added=false;
      try{
        // security -i reads this fixed ASCII command from stdin; the key is absent from argv.
        await runSecurityInteractive(`add-generic-password -s ${service} -a ${account} -w ${encoded}`);
        added=true;
      }catch{}
      if(added){
        try{
        const stored=await readKey();
        if(!timingSafeEqual(stored,generated)){stored.fill(0);throw new Error('macOS Keychain write verification failed');}
        stored.fill(0);
        return generated;
        }catch{generated.fill(0);throw new Error('macOS Keychain write could not be verified; no plaintext fallback was attempted');}
      }
      generated.fill(0);
      // A competing initializer may have won the unique item; accept only a successful readback.
      try{return await readKey();}catch{throw new Error('macOS Keychain protected storage failed; no plaintext fallback was attempted');}
    }
  }
  return {
    async protect(payload){
      if(process.platform!=='darwin')throw new Error('macOS protected storage is unavailable on this platform');
      const key=await getKey();
      try{const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv),body=Buffer.concat([cipher.update(payload),cipher.final()]);return Buffer.concat([Buffer.from('YQ02'),iv,cipher.getAuthTag(),body]);}
      finally{key.fill(0);}
    },
    async unprotect(blob){
      if(process.platform!=='darwin')throw new Error('macOS protected storage is unavailable on this platform');
      if(blob.length<32||!blob.subarray(0,4).equals(Buffer.from('YQ02')))throw new Error('Invalid macOS encrypted store');
      const key=await getKey();
      try{const iv=blob.subarray(4,16),tag=blob.subarray(16,32),decipher=createDecipheriv('aes-256-gcm',key,iv);decipher.setAuthTag(tag);return Buffer.concat([decipher.update(blob.subarray(32)),decipher.final()]);}
      catch(error){if(error.message.startsWith('macOS Keychain'))throw error;throw new Error('macOS Keychain protected storage failed; stored data was not changed');}
      finally{key.fill(0);}
    }
  };
}
export const macosCrypto=createCodec();
export const protect=payload=>macosCrypto.protect(payload);
export const unprotect=blob=>macosCrypto.unprotect(blob);
export async function deleteKeychainItem({service=DEFAULT_SERVICE,account=DEFAULT_ACCOUNT}={}){
  assertIdentity(service,account);
  await run(['delete-generic-password','-s',service,'-a',account]);
}
