import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {installerAssets} from '../desktop/release-targets.mjs';import {verifyReleaseMetadata,verifyDownload,readReleaseMetadata} from '../scripts/Verify-ReleaseDownloads.mjs';
const pkg=JSON.parse(await readFile(new URL('../desktop/package.json',import.meta.url),'utf8')),expected=installerAssets(pkg.version);
test('both README languages link every current Windows and Mac installer',async()=>{
 assert.equal(expected.length,4);for(const file of ['README.md','README.en.md']){const text=await readFile(new URL('../'+file,import.meta.url),'utf8');const links=[...text.matchAll(/https:\/\/github\.com\/shixi-11\/lettide\/releases\/download\/v[^)\s]+/g)].map(m=>m[0]);assert.equal(links.length,4,file+' must have four direct downloads');for(const asset of expected)assert.ok(links.includes(`https://github.com/shixi-11/lettide/releases/download/v${pkg.version}/${asset.name}`),file+' misses '+asset.name);}
});
test('a missing Mac installer prevents release completion',()=>{
 const release={tag_name:'v'+pkg.version,assets:expected.map(a=>({...a,state:'uploaded',size:100}))};assert.equal(verifyReleaseMetadata(release,pkg.version).length,4);release.assets=release.assets.filter(a=>a.format!=='dmg');assert.throws(()=>verifyReleaseMetadata(release,pkg.version),/Missing complete installer/);
});
test('download verification rejects a broken link, HTML login page and wrong installer bytes',async()=>{
 await assert.rejects(verifyDownload('https://example.test/x.deb','deb',async()=>new Response('Not found',{status:404})),/HTTP 404/);
 await assert.rejects(verifyDownload('https://example.test/x.deb','deb',async()=>new Response('<html>login</html>',{headers:{'content-type':'text/html'}})),/HTML/);
 await assert.rejects(verifyDownload('https://example.test/x.deb','deb',async()=>new Response('wrong bytes')),/format/);
 assert.equal(await verifyDownload('https://example.test/x.deb','deb',async()=>new Response('!<arch>\ncontent',{status:206})),206);
});

test('download signatures can span network chunks and invalid DMG trailers are rejected',async()=>{
 const fetchSplit=async()=>new Response(new ReadableStream({start(c){c.enqueue(Buffer.from('M'));c.enqueue(Buffer.from('Zbody'));c.close();}}),{status:206});assert.equal(await verifyDownload('https://example.test/app.exe','exe',fetchSplit),206);
 await assert.rejects(verifyDownload('https://example.test/app.dmg','dmg',async()=>new Response('not a disk image',{status:206})),/format/);
 let range;assert.equal(await verifyDownload('https://example.test/app.dmg','dmg',async(_url,options)=>{range=options.headers.Range;return new Response('koly'+'.'.repeat(508),{status:206});}),206);assert.equal(range,'bytes=-512');
});

test('authenticated draft lookup uses the release list when tag lookup returns 404',async()=>{
 const release={tag_name:'v'+pkg.version,draft:true,assets:[]};const urls=[];const result=await readReleaseMetadata(pkg.version,{Authorization:'Bearer fictional-test-token'},{fetcher:async url=>{urls.push(url);return url.includes('/tags/')?new Response('{}',{status:404}):Response.json([release]);}});assert.deepEqual(result,release);assert.equal(urls.length,2);assert.match(urls[1],/releases\?per_page=100$/);
 await assert.rejects(readReleaseMetadata(pkg.version,{}, {fetcher:async()=>new Response('{}',{status:404})}),/HTTP 404/);
});
