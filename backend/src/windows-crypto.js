import {promises as fs} from 'node:fs';
import {createCipheriv,createDecipheriv,randomBytes,randomUUID} from 'node:crypto';

// DPAPI protects only the random key. Large mail caches stay authenticated and
// encrypted without moving their entire contents through a PowerShell process.
export function createWindowsCodec({keyFile,dpapi}) {
  let key=null;
  async function readKey(){
    const decoded=await dpapi('unprotect',await fs.readFile(keyFile));
    if(decoded.length!==32){decoded.fill(0);throw new Error('Invalid Windows storage key');}
    return decoded;
  }
  async function getKey(create=false){
    if(key)return key;
    try{key=await readKey();return key;}catch(error){if(error.code!=='ENOENT'||!create)throw error;}
    const generated=randomBytes(32),tmp=`${keyFile}.${process.pid}.${randomUUID()}.tmp`;
    try{
      const wrapped=await dpapi('protect',generated);
      const handle=await fs.open(tmp,'wx',0o600);
      try{await handle.writeFile(wrapped);await handle.sync();}finally{await handle.close();}
      try{await fs.link(tmp,keyFile);}catch(error){if(error.code!=='EEXIST')throw error;}
      // Always use the stored winner, including when another initializer won.
      key=await readKey();return key;
    }finally{generated.fill(0);await fs.rm(tmp,{force:true});}
  }
  return {
    async protect(payload){
      const secret=await getKey(true),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',secret,iv);
      const body=Buffer.concat([cipher.update(payload),cipher.final()]);
      return Buffer.concat([Buffer.from('YQ03'),iv,cipher.getAuthTag(),body]);
    },
    async unprotect(blob){
      if(blob.length<32||blob.subarray(0,4).toString()!=='YQ03')throw new Error('Invalid Windows encrypted store');
      const secret=await getKey(),decipher=createDecipheriv('aes-256-gcm',secret,blob.subarray(4,16));
      decipher.setAuthTag(blob.subarray(16,32));
      return Buffer.concat([decipher.update(blob.subarray(32)),decipher.final()]);
    },
    close(){key?.fill(0);key=null;}
  };
}
