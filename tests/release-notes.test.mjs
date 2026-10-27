import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,writeFile,readFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';

const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function fixture(t,{english=true,mismatch=false}={}){
 const root=await mkdtemp(path.join(os.tmpdir(),'lettide-release-'));
 t.after(async()=>{if(path.dirname(path.resolve(root))!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('lettide-release-'))throw new Error('Unexpected cleanup path');await rm(root,{recursive:true,force:true})});
 for(const folder of ['scripts','.github','backend','web','desktop'])await mkdir(path.join(root,folder));
 for(const file of ['scripts/Prepare-Release.mjs','.github/RELEASE_TEMPLATE.md','desktop/release-targets.mjs'])await copyFile(path.join(source,file),path.join(root,file));
 for(const folder of ['backend','web','desktop'])await writeFile(path.join(root,folder,'package.json'),JSON.stringify({version:mismatch&&folder==='web'?'1.2.4':'1.2.3'}));
 await writeFile(path.join(root,'CHANGELOG.md'),`# Changelog\n\n## 1.2.3\n\n### 中文\n\n- 修复连接。\n${english?'\n### English\n\n- Fix account connections.\n':''}`);
 const run=(extra={})=>spawnSync(process.execPath,[path.join(root,'scripts/Prepare-Release.mjs')],{encoding:'utf8',env:{...process.env,GITHUB_REF_TYPE:'',GITHUB_REF_NAME:'',...extra}});
 return {root,run};
}
test('A release includes both complete language sections and all four Windows and Mac installers',async t=>{
 const {root,run}=await fixture(t);assert.equal(run().status,0);
 const notes=await readFile(path.join(root,'output/release-notes-1.2.3.md'),'utf8');
 assert.match(notes,/## 简体中文/);assert.match(notes,/## English/);assert.ok(notes.indexOf('## English')<notes.indexOf('## 简体中文'));
 assert.match(notes,/修复连接/);assert.match(notes,/Fix account connections/);
 assert.equal((notes.match(/releases\/download\/v1\.2\.3\//g)||[]).length,8);
 assert.doesNotMatch(notes,/\{\{[A-Z_]+\}\}/);
});
test('Missing English prevents publishing a Chinese-only release',async t=>{
 const {run}=await fixture(t,{english:false});const result=run();assert.notEqual(result.status,0);assert.match(result.stderr,/Missing English release notes/);
});
test('Inconsistent package versions prevent release generation',async t=>{
 const {run}=await fixture(t,{mismatch:true});const result=run();assert.notEqual(result.status,0);assert.match(result.stderr,/package versions must match/);
});
test('A different Git tag cannot publish installers under the package version',async t=>{
 const {run}=await fixture(t);const result=run({GITHUB_REF_TYPE:'tag',GITHUB_REF_NAME:'v9.9.9'});assert.notEqual(result.status,0);assert.match(result.stderr,/tag must match/);
});
