import {readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),output=path.join(root,'output','desktop');
let executable=process.argv.includes('--appimage')?undefined:process.env.LETTIDE_TEST_EXECUTABLE,args=[];
if(!executable){
 if(process.argv.includes('--appimage')){const files=(await readdir(output)).filter(n=>n.endsWith('.AppImage'));if(files.length!==1)throw Error('Expected one AppImage for the current build');executable=path.join(output,files[0]);args.push('--appimage-extract-and-run');}
 else if(process.platform==='win32')executable=path.join(output,'win-unpacked','Lettide.exe');
 else if(process.platform==='linux')executable=path.join(output,'linux-unpacked','Lettide');
 else if(process.platform==='darwin'){const app=(await readdir(path.join(output,'mac-universal'))).find(n=>n.endsWith('.app'));if(!app)throw Error('Packaged Mac app not found');const dir=path.join(output,'mac-universal',app,'Contents','MacOS');executable=path.join(dir,(await readdir(dir))[0]);}
 else throw Error('Unsupported target desktop platform');
}
const code=`(async()=>{
 const {createRequire}=require('node:module'),{pathToFileURL}=require('node:url'),path=require('node:path');
 const resources=process.platform==='darwin'?path.resolve(path.dirname(process.execPath),'..','Resources'):path.join(path.dirname(process.execPath),'resources');
 const requireBackend=createRequire(path.join(resources,'backend','package.json'));
 await import(pathToFileURL(requireBackend.resolve('@huggingface/transformers')).href);
 await requireBackend('sharp')({create:{width:1,height:1,channels:3,background:'#808080'}}).png().toBuffer();
 if(process.platform==='linux'){
   const {Store}=await import(pathToFileURL(path.join(resources,'backend','src','store.js')).href),fs=require('node:fs/promises'),os=require('node:os'),crypto=require('node:crypto');
   const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lettide-packaged-')),file=path.join(dir,'state.enc');let store;
   try{store=await new Store({file}).open();const token=store.state.token;await store.mutate(s=>s.jobs.push({id:'fictional',translation:'虚构译文'}));await store.close();store=await new Store({file}).open();if(store.state.token!==token||store.state.jobs[0].translation!=='虚构译文')throw Error('Native encrypted storage failed');}
   finally{await store?.close();require('node:child_process').spawnSync('secret-tool',['clear','application','com.lettide.store.encryption-key.v1','store',crypto.createHash('sha256').update(file).digest('hex')],{stdio:'ignore'});await fs.rm(dir,{recursive:true,force:true});}
 }
 console.log(JSON.stringify({packagedRuntime:true,platform:process.platform,arch:process.arch,translationDependencies:true,nativeImageDependency:true,secretService:process.platform==='linux'}));
})().catch(e=>{console.error(e.message);process.exitCode=1;});`;
const child=spawn(executable,[...args,'-e',code],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,stdio:'inherit'});
const timer=setTimeout(()=>{child.kill();process.exitCode=1;console.error('Packaged runtime check timed out');},120000);
child.on('error',e=>{clearTimeout(timer);console.error(e.message);process.exitCode=1;});child.on('exit',code=>{clearTimeout(timer);process.exitCode=code||0;});
