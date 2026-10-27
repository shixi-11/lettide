import {installerAssets} from '../desktop/release-targets.mjs';
import {readFile,writeFile} from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';
export function verifyReleaseMetadata(release,version){
 if(release.tag_name!==`v${version}`)throw Error('Release tag does not match requested version');
 const expected=installerAssets(version);for(const asset of expected){const rows=release.assets.filter(a=>a.name===asset.name);if(rows.length!==1||rows[0].state!=='uploaded'||rows[0].size<=0)throw Error('Missing complete installer: '+asset.name);}return expected;
}
export async function verifyDownload(url,format,fetcher=fetch){
 const magic={exe:Buffer.from('MZ'),deb:Buffer.from('!<arch>\n'),rpm:Buffer.from([0xed,0xab,0xee,0xdb]),AppImage:Buffer.from([0x7f,0x45,0x4c,0x46]),dmg:Buffer.from('koly')}[format];
 if(!magic)throw Error('Unsupported installer format: '+format);
 let range='bytes=0-63',expectedRange;
 if(format==='dmg'){
  const head=await fetcher(url,{method:'HEAD',headers:{'User-Agent':'Lettide-download-check'},redirect:'follow',signal:AbortSignal.timeout(45000)});
  if(!head.ok)throw Error('Download HEAD HTTP '+head.status+': '+path.basename(url));
  const size=Number(head.headers.get('content-length'));if(!Number.isSafeInteger(size)||size<512)throw Error('Installer format metadata is invalid: '+path.basename(url));
  // GitHub release storage rejects suffix ranges, but accepts absolute offsets.
  range=`bytes=${size-512}-${size-1}`;expectedRange=`bytes ${size-512}-${size-1}/${size}`;
 }
 const r=await fetcher(url,{headers:{Range:range,'User-Agent':'Lettide-download-check'},redirect:'follow',signal:AbortSignal.timeout(45000)});
 if(!r.ok){await r.body?.cancel();throw Error('Download HTTP '+r.status+': '+path.basename(url));}
 if(format==='dmg'&&(r.status!==206||r.headers.get('content-range')!==expectedRange)){await r.body?.cancel();throw Error('Installer range response does not match the DMG footer');}
 if(/text\/html/i.test(r.headers.get('content-type')||'')){await r.body?.cancel();throw Error('Download returned an HTML page: '+path.basename(url));}
 const reader=r.body?.getReader();if(!reader)throw Error('Download has no data');let parts=[],length=0;const required=format==='dmg'?512:magic.length;
 try{while(length<required){const part=await reader.read();if(part.done)break;parts.push(Buffer.from(part.value));length+=part.value.length;}}finally{await reader.cancel();}
 if(!length)throw Error('Download is empty');if(length<required)throw Error('Installer data is truncated');const bytes=Buffer.concat(parts);
 if(!bytes.subarray(0,magic.length).equals(magic))throw Error('Installer format does not match: '+path.basename(url));
 return r.status;
}
export async function readReleaseMetadata(version,headers,{fetcher=fetch}={}){
 const base='https://api.github.com/repos/shixi-11/lettide',options={headers,signal:AbortSignal.timeout(30000)};
 const response=await fetcher(`${base}/releases/tags/v${version}`,options);
 if(response.ok)return response.json();
 // GitHub's tag lookup only exposes published releases. Drafts are available
 // to an authorized maintainer through the release list instead.
 if(response.status===404&&headers.Authorization){
  const list=await fetcher(`${base}/releases?per_page=100`,options);if(!list.ok)throw Error('Release metadata HTTP '+list.status);
  const release=(await list.json()).find(r=>r.tag_name===`v${version}`);if(release)return release;
 }
 throw Error('Release metadata HTTP '+response.status);
}
async function main(){
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),version=JSON.parse(await readFile(path.join(root,'desktop/package.json'),'utf8')).version;
 const headers={Accept:'application/vnd.github+json','User-Agent':'Lettide-release-check'},token=process.env.GH_TOKEN||process.env.GITHUB_TOKEN;if(token)headers.Authorization='Bearer '+token;
 const release=await readReleaseMetadata(version,headers),expected=verifyReleaseMetadata(release,version);let verified=0;if(release.draft&&!process.argv.includes('--metadata-only'))throw Error('Release is still a draft');
 if(!process.argv.includes('--metadata-only'))for(const asset of expected){const url=`https://github.com/shixi-11/lettide/releases/download/v${version}/${asset.name}`;let error;for(let attempt=0;attempt<3;attempt++){try{await verifyDownload(url,asset.format);error=null;break;}catch(e){error=e;if(attempt<2)await new Promise(r=>setTimeout(r,1500*(attempt+1)));}}if(error)throw error;verified++;console.log(JSON.stringify({download:asset.name,publicAccess:true}));}
 console.log(JSON.stringify({version,expectedInstallers:expected.length,verifiedDownloads:verified,metadataOnly:process.argv.includes('--metadata-only')}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
