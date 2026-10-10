import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const packages=await Promise.all(['backend','web','desktop'].map(async folder=>JSON.parse(await readFile(path.join(root,folder,'package.json'),'utf8'))));
const current=packages[0].version;
if(packages.some(pkg=>pkg.version!==current))throw new Error('All package versions must match before release.');
const requested=process.argv.indexOf('--version');
const version=requested===-1?current:process.argv[requested+1];
if(!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version||''))throw new Error('Invalid release version.');
if(process.env.GITHUB_REF_TYPE==='tag'&&process.env.GITHUB_REF_NAME!==`v${version}`)throw new Error('The release tag must match the package version.');
const changelog=await readFile(path.join(root,'CHANGELOG.md'),'utf8');
const chunks=changelog.split(/^## /m).slice(1);
const chunk=chunks.find(value=>value.split(/\r?\n/,1)[0].trim()===version);
if(!chunk)throw new Error(`Missing changelog for ${version}.`);
const changes=chunk.slice(chunk.indexOf('\n')+1).trim();
for(const language of ['中文','English']){
 const sections=changes.split(/^### /m).slice(1);
 const section=sections.find(value=>value.split(/\r?\n/,1)[0].trim()===language);
 if(!section||!/^\s*-\s+\S/m.test(section.slice(section.indexOf('\n')+1)))throw new Error(`Missing ${language} release notes.`);
}
const template=await readFile(path.join(root,'.github/RELEASE_TEMPLATE.md'),'utf8');
if(!template.includes('{{VERSION}}')||!template.includes('{{CHANGES}}'))throw new Error('Release template is incomplete.');
const notes=template.replaceAll('{{VERSION}}',version).replace('{{CHANGES}}',`## 更新 / What's new\n\n${changes}`);
if(/\{\{[A-Z_]+\}\}/.test(notes))throw new Error('Unresolved release placeholder.');
const file=path.join(root,'output',`release-notes-${version}.md`);
if(!process.argv.includes('--check')){await mkdir(path.dirname(file),{recursive:true});await writeFile(file,notes+'\n')}
console.log(JSON.stringify({version,tag:`v${version}`,file:path.relative(root,file).replaceAll('\\','/'),languages:['zh-CN','en'],checkedOnly:process.argv.includes('--check')}));
