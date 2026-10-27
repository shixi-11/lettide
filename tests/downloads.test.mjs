import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {installerAssets} from '../desktop/release-targets.mjs';import {verifyReleaseMetadata,verifyDownload} from '../scripts/Verify-ReleaseDownloads.mjs';
const pkg=JSON.parse(await readFile(new URL('../desktop/package.json',import.meta.url),'utf8')),expected=installerAssets(pkg.version);
test('both README languages link every current Windows, Mac and Linux installer',async()=>{
 assert.equal(expected.length,10);for(const file of ['README.md','README.en.md']){const text=await readFile(new URL('../'+file,import.meta.url),'utf8');const links=[...text.matchAll(/https:\/\/github\.com\/shixi-11\/lettide\/releases\/download\/v[^)\s]+/g)].map(m=>m[0]);assert.equal(links.length,10,file+' must have ten direct downloads');for(const asset of expected)assert.ok(links.includes(`https://github.com/shixi-11/lettide/releases/download/v${pkg.version}/${asset.name}`),file+' misses '+asset.name);}
});
test('a missing Linux installer prevents release completion',()=>{
 const release={tag_name:'v'+pkg.version,assets:expected.map(a=>({...a,state:'uploaded',size:100}))};assert.equal(verifyReleaseMetadata(release,pkg.version).length,10);release.assets=release.assets.filter(a=>a.format!=='rpm');assert.throws(()=>verifyReleaseMetadata(release,pkg.version),/Missing complete installer/);
});
test('download verification rejects a broken link, HTML login page and wrong installer bytes',async()=>{
 await assert.rejects(verifyDownload('https://example.test/x.deb','deb',async()=>new Response('Not found',{status:404})),/HTTP 404/);
 await assert.rejects(verifyDownload('https://example.test/x.deb','deb',async()=>new Response('<html>login</html>',{headers:{'content-type':'text/html'}})),/HTML/);
 await assert.rejects(verifyDownload('https://example.test/x.deb','deb',async()=>new Response('wrong bytes')),/format/);
 assert.equal(await verifyDownload('https://example.test/x.deb','deb',async()=>new Response('!<arch>\ncontent',{status:206})),206);
});
