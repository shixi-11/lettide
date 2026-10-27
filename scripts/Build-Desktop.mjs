import {readFile,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {releasePlatforms} from '../desktop/release-targets.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const language=process.argv.includes('--en')?'en':'zh-CN';
if(process.argv.includes('--mac')&&process.argv.includes('--linux'))throw new Error('Choose one target platform.');
const platform=releasePlatforms.find(p=>p.id===(process.argv.includes('--linux')?'linux':process.argv.includes('--mac')?'mac':'win'));
const arch=process.argv.includes('--x64')?'x64':process.argv.includes('--arm64')?'arm64':platform.arch;
const pkg=JSON.parse(await readFile(path.join(root,'desktop/package.json'),'utf8'));
await writeFile(path.join(root,'desktop/build-locale.json'),JSON.stringify({language}));
const productName=language==='en'?'Lettide':'叠信';
const nativeExcludes=[];
for(const host of ['win32','darwin','linux','linuxmusl']){
  if(host!==platform.host){nativeExcludes.push(`!onnxruntime-node/bin/napi-v3/${host}/**`,`!@img/sharp-${host}-*/**`,`!@img/sharp-libvips-${host}-*/**`);}
  else if(arch!=='universal'){
    const other=arch==='x64'?'arm64':'x64';nativeExcludes.push(`!onnxruntime-node/bin/napi-v3/${host}/${other}/**`,`!@img/sharp-${host}-${other}/**`,`!@img/sharp-libvips-${host}-${other}/**`);
  }
}
const resources=pkg.build.extraResources.map(resource=>resource.from==='../backend/node_modules'?{...resource,filter:[...resource.filter,...nativeExcludes]}:resource);
const macOptions={...pkg.build.mac,...(platform.id==='mac'&&arch==='universal'?{x64ArchFiles:'Contents/Resources/backend/node_modules/{@img,onnxruntime-node}/**/*'}:{})};
const artifact=`Lettide-${pkg.version}-${platform.id}-${arch}-${language}.`;
const override={...pkg.build,mac:macOptions,extraResources:resources,productName,
  copyright:language==='en'?'Copyright © 2026 Shixi Lin':'Copyright © 2026 光之十一',
  artifactName:artifact+'${ext}',
  nsis:{...pkg.build.nsis,shortcutName:productName,artifactName:artifact+'exe'},
  dmg:{...pkg.build.dmg,title:productName+' '+pkg.version,artifactName:artifact+'dmg'},
  linux:{...pkg.build.linux,desktop:{entry:{Name:productName,Comment:language==='en'?'All your mail, in one calm place':'多个邮箱，一处从容处理'}}},
};
const config=path.join(root,'desktop/release-config.json');await writeFile(config,JSON.stringify(override));
const builder=path.join(root,'desktop/node_modules/electron-builder/out/cli/cli.js');
const child=spawn(process.execPath,[builder,'--'+(platform.id==='win'?'win':platform.id),...platform.targets,'--'+arch,'--config',config,'--publish','never'],{cwd:path.join(root,'desktop'),env:{...process.env,CSC_IDENTITY_AUTO_DISCOVERY:'false'},stdio:'inherit'});
child.on('error',e=>{console.error(e.message);process.exitCode=1});child.on('exit',code=>process.exitCode=code||0);
