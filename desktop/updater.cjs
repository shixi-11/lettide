const {EventEmitter}=require('node:events');
const fs=require('node:fs/promises'),{createReadStream}=require('node:fs');
const path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const REPOSITORY='https://github.com/shixi-11/lettide';
const FEED='https://api.github.com/repos/shixi-11/lettide/releases?per_page=20';
function versionParts(value){const match=String(value).match(/^v?(\d+)\.(\d+)\.(\d+)$/);if(!match)throw new Error('Invalid release version');return match.slice(1).map(Number);}
function compareVersions(a,b){const left=versionParts(a),right=versionParts(b);for(let i=0;i<3;i++)if(left[i]!==right[i])return left[i]>right[i]?1:-1;return 0;}
function selectInstaller(release,{platform,language}){
 const version=versionParts(release?.tag_name).join('.'),locale=language==='zh-CN'?'zh-CN':'en';
 if(release.draft||release.html_url!==REPOSITORY+'/releases/tag/v'+version)throw new Error('Unsupported release');
 const suffix=platform==='win32'?'win-x64-'+locale+'.exe':platform==='darwin'?'mac-universal-'+locale+'.dmg':null;
 if(!suffix)throw new Error('Installer is not available for this system');
 const name='Lettide-'+version+'-'+suffix,asset=release.assets?.find(a=>a.name===name);
 if(!asset||asset.state!=='uploaded'||!Number.isSafeInteger(asset.size)||asset.size<512||asset.size>1024*1024*1024||asset.browser_download_url!==REPOSITORY+'/releases/download/v'+version+'/'+name||!/^sha256:[a-f0-9]{64}$/.test(asset.digest||''))throw new Error('Verified installer is not available yet');
 return {version,name,size:asset.size,url:asset.browser_download_url,digest:asset.digest.slice(7),releaseUrl:release.html_url};
}
class DesktopUpdater extends EventEmitter{
 constructor({version,platform=process.platform,language='en',cacheDir,fetchImpl=fetch,stallTimeoutMs=45000}={}){super();versionParts(version);this.current=version;this.platform=platform;this.language=language;this.cacheDir=path.resolve(cacheDir);this.fetchImpl=fetchImpl;this.stallTimeoutMs=stallTimeoutMs;this.state={status:'idle',currentVersion:version,latestVersion:null,progress:0,error:null};this.asset=null;this.checking=null;this.downloading=null;}
 snapshot(){return {...this.state};}
 update(values){this.state={...this.state,...values};this.emit('change',this.snapshot());return this.snapshot();}
 check(){if(this.checking)return this.checking;if(this.downloading)return Promise.resolve(this.snapshot());this.checking=this.runCheck().finally(()=>{this.checking=null});return this.checking;}
 async runCheck(){
  this.update({status:'checking',error:null});
  try{const response=await this.fetchImpl(FEED,{headers:{Accept:'application/vnd.github+json','User-Agent':'Lettide-update-check'},signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error('Update service unavailable');const releases=await response.json();if(!Array.isArray(releases))throw Error('Invalid release feed');const release=releases.filter(r=>{try{versionParts(r.tag_name);return !r.draft&&r.html_url===REPOSITORY+'/releases/tag/'+r.tag_name}catch{return false}}).sort((a,b)=>compareVersions(b.tag_name,a.tag_name))[0];if(!release)throw Error('No published releases');
   const latest=versionParts(release.tag_name).join('.');if(compareVersions(latest,this.current)<=0){this.asset=null;return this.update({status:'up-to-date',latestVersion:latest,checkedAt:new Date().toISOString(),progress:0,file:null});}
   const asset=selectInstaller(release,{platform:this.platform,language:this.language});const same=this.asset?.digest===asset.digest&&this.state.file&&await fs.stat(this.state.file).then(stat=>stat.isFile()&&stat.size===asset.size,()=>false);this.asset=asset;return this.update({status:same?'ready':'available',latestVersion:latest,releaseUrl:asset.releaseUrl,file:same?this.state.file:null,progress:same?100:0,checkedAt:new Date().toISOString()});
  }catch{return this.update({status:'error',error:'Could not check for updates. Try again.'});}
 }
 download(){if(this.downloading)return this.downloading;this.downloading=this.runDownload().finally(()=>{this.downloading=null});return this.downloading;}
 async runDownload(){
  const asset=this.asset;if(!asset)throw new Error('Check for updates first');
  if(this.state.status==='ready')return this.snapshot();
  await fs.mkdir(this.cacheDir,{recursive:true,mode:0o700});const temporary=path.join(this.cacheDir,asset.name+'.'+randomUUID()+'.part'),file=path.join(this.cacheDir,asset.name);let handle,idleTimer;const controller=new AbortController(),watch=()=>{clearTimeout(idleTimer);idleTimer=setTimeout(()=>controller.abort(),this.stallTimeoutMs);idleTimer.unref?.();};
  this.update({status:'downloading',progress:0,error:null,file:null});
  try{
   watch();const response=await this.fetchImpl(asset.url,{headers:{'User-Agent':'Lettide-update-download'},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(600000)])});
   if(!response.ok||!response.body)throw new Error('Download failed');
   const length=response.headers?.get('content-length');if(length&&Number(length)!==asset.size)throw new Error('Download size mismatch');
   handle=await fs.open(temporary,'wx',0o600);const hash=createHash('sha256');let received=0,lastProgress=-1;
   for await(const part of response.body){const chunk=Buffer.from(part);watch();received+=chunk.length;if(received>asset.size)throw new Error('Download size mismatch');hash.update(chunk);await handle.writeFile(chunk);const progress=Math.floor(received*100/asset.size);if(progress!==lastProgress){lastProgress=progress;this.update({progress});}}
   if(received!==asset.size||hash.digest('hex')!==asset.digest)throw new Error('Download verification failed');
   await handle.sync();await handle.close();handle=null;
   await verifyMagic(temporary,this.platform,asset.size);await fs.rename(temporary,file);return this.update({status:'ready',progress:100,file,error:null});
  }catch{await handle?.close().catch(()=>{});await fs.rm(temporary,{force:true}).catch(()=>{});return this.update({status:'error',progress:0,file:null,error:'Could not download a verified update. Try again.'});}finally{clearTimeout(idleTimer);}
 }
 async installer(){
  if(this.state.status!=='ready'||!this.state.file||!this.asset)throw new Error('Download the update first');
  const file=this.state.file,asset=this.asset;try{if(path.dirname(file)!==this.cacheDir||path.basename(file)!==asset.name)throw new Error('Invalid installer path');
  const stat=await fs.stat(file),hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);if(stat.size!==asset.size||hash.digest('hex')!==asset.digest)throw new Error('Update file changed; download it again');await verifyMagic(file,this.platform,asset.size);return file;}catch{this.update({status:'available',progress:0,file:null,error:'Update file changed; download it again'});throw new Error('Update file changed; download it again');}
 }
}
async function verifyMagic(file,platform,size){const handle=await fs.open(file,'r');try{const bytes=Buffer.alloc(platform==='darwin'?512:2);await handle.read(bytes,0,bytes.length,platform==='darwin'?size-512:0);if(platform==='win32'?bytes.toString()!=='MZ':bytes.subarray(0,4).toString()!=='koly')throw new Error('Installer format invalid');}finally{await handle.close()}}
module.exports={DesktopUpdater,compareVersions,selectInstaller};
