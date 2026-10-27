import {spawn} from 'node:child_process';
import {createCipheriv,createDecipheriv,randomBytes,timingSafeEqual} from 'node:crypto';

const SERVICE='com.lettide.store.encryption-key.v1';
const failure=()=>new Error('Linux Secret Service protected storage is unavailable. Install secret-tool and unlock the desktop keyring; no plaintext fallback was attempted.');
export function runSecretTool(args,input='') {
  return new Promise((resolve,reject)=>{
    const child=spawn('secret-tool',args,{stdio:['pipe','pipe','pipe']});let out=[],err=[],bytes=0,settled=false;
    const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(result);};
    const timer=setTimeout(()=>{child.kill();finish(failure());},90000);
    child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>4096){child.kill();finish(failure());}else out.push(chunk);});
    child.stderr.on('data',chunk=>{if(err.length<8)err.push(chunk.subarray(0,512));});
    child.on('error',()=>finish(failure()));child.stdin.on('error',()=>{});
    child.on('close',code=>{
      const value=Buffer.concat(out).toString('utf8').trim(),message=Buffer.concat(err).toString('utf8').trim();
      if(code===0)return finish(null,value);
      if(args[0]==='lookup'&&code===1&&!value&&!message)return finish(null,null);
      finish(failure());
    });
    child.stdin.end(input);
  });
}
function decode(value){
  if(typeof value!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(value))throw new Error('Linux Secret Service returned an invalid encryption key');
  const key=Buffer.from(value,'base64');if(key.length!==32||key.toString('base64')!==value){key.fill(0);throw new Error('Linux Secret Service returned an invalid encryption key');}return key;
}
export function createLinuxCodec({keyId,run=runSecretTool}={}) {
  if(!/^[A-Za-z0-9._-]{1,128}$/.test(keyId||''))throw new Error('Invalid Linux keyring item identity');
  const attributes=['application',SERVICE,'store',keyId];let key=null,pending=null;
  async function getKey(create){
    if(key)return key;if(pending)return pending;
    pending=(async()=>{
      const found=await run(['lookup',...attributes]);if(found!==null){key=decode(found);return key;}
      if(!create)throw new Error('Linux Secret Service encryption key is missing; stored data was not changed');
      const generated=randomBytes(32);
      try{
        // The secret goes through stdin, never process arguments or a file.
        await run(['store','--label','Lettide mail encryption key',...attributes],generated.toString('base64'));
        const stored=decode(await run(['lookup',...attributes]));
        if(!timingSafeEqual(stored,generated)){stored.fill(0);throw new Error('Linux Secret Service key write verification failed');}
        key=stored;return key;
      }finally{generated.fill(0);}
    })();
    try{return await pending;}finally{pending=null;}
  }
  return {
    async protect(payload){const secret=await getKey(true),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',secret,iv);return seal(cipher,iv,payload);},
    async unprotect(blob){
      if(blob.length<32||blob.subarray(0,4).toString()!=='YQ04')throw new Error('Invalid Linux encrypted store');
      const secret=await getKey(false),decipher=createDecipheriv('aes-256-gcm',secret,blob.subarray(4,16));decipher.setAuthTag(blob.subarray(16,32));
      try{return Buffer.concat([decipher.update(blob.subarray(32)),decipher.final()]);}catch{throw new Error('Linux Secret Service protected storage failed; stored data was not changed');}
    },
    close(){key?.fill(0);key=null;}
  };
}
function seal(cipher,iv,payload){const body=Buffer.concat([cipher.update(payload),cipher.final()]);return Buffer.concat([Buffer.from('YQ04'),iv,cipher.getAuthTag(),body]);}
