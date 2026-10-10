import {readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'output','desktop');
let executable,resources;
if(process.platform==='win32'){
 executable=path.join(output,'win-unpacked','Lettide.exe');
 resources=path.join(output,'win-unpacked','resources');
}else if(process.platform==='darwin'){
 const app=(await readdir(path.join(output,'mac-universal'))).find(name=>name.endsWith('.app'));
 if(!app)throw new Error('Packaged Mac app not found');
 const contents=path.join(output,'mac-universal',app,'Contents');
 const binary=(await readdir(path.join(contents,'MacOS')))[0];
 executable=path.join(contents,'MacOS',binary);resources=path.join(contents,'Resources');
}else throw new Error('Run this check on the target desktop platform');
const code=`(async()=>{
 const {createRequire}=require('node:module'),{pathToFileURL}=require('node:url');
 const requireBackend=createRequire(${JSON.stringify(path.join(resources,'backend','package.json'))});
 await import(pathToFileURL(requireBackend.resolve('@huggingface/transformers')).href);
 const sharp=requireBackend('sharp');
 await sharp({create:{width:1,height:1,channels:3,background:'#808080'}}).png().toBuffer();
 console.log(JSON.stringify({packagedRuntime:true,platform:process.platform,arch:process.arch,translationDependencies:true,nativeImageDependency:true}));
})().catch(error=>{console.error(error.message);process.exitCode=1;});`;
const child=spawn(executable,['-e',code],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,stdio:'inherit'});
const timer=setTimeout(()=>{child.kill();process.exitCode=1;console.error('Packaged runtime check timed out');},60000);
child.on('error',error=>{clearTimeout(timer);console.error(error.message);process.exitCode=1;});
child.on('exit',code=>{clearTimeout(timer);process.exitCode=code||0;});
