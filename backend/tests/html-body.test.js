import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,readdir,rm,stat} from 'node:fs/promises';
import {createServer} from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.js';
import {createApp} from '../src/server.js';
import {htmlIsShell,HTML_BODY_FORMAT} from '../src/mail.js';

// Fictional reversible codec, so plaintext page bytes on disk are detectable.
const codec={protect:async x=>Buffer.concat([Buffer.from('T'),Buffer.from(x.map(b=>b^0x5a))]),unprotect:async x=>{assert.equal(x[0],0x54);return Buffer.from(x.subarray(1).map(b=>b^0x5a));}};
const fixture=async fn=>{const dir=await mkdtemp(path.join(os.tmpdir(),'lettide-html-'));try{await fn(dir,path.join(dir,'state'))}finally{await rm(dir,{recursive:true,force:true});}};
const page=marker=>`<html><body><table width="600"><tr><td><h1>Fictional newsletter ${marker}</h1><a href="https://example.test/offer">Open the fictional offer</a></td></tr></table>${'<p>fictional paragraph</p>'.repeat(4000)}</body></html>`;
const message=(id,html)=>({id,accountId:'a',subject:'fictional',text:'Fictional newsletter',bodyLoaded:true,htmlFormat:HTML_BODY_FORMAT,html,attachments:[]});
const files=async dir=>(await readdir(path.join(dir,'bodies')).catch(()=>[])).sort();

test('Mail pages live in separate encrypted files, not the mail index',()=>fixture(async(dir,file)=>{
  const html=page('one'),store=await new Store({file,codec}).open();
  try{
    await store.mutate(s=>{s.messages.push(message('m1',html));});
    const m=store.state.messages[0];
    assert.equal(m.html,undefined);assert.match(m.htmlSha256,/^[0-9a-f]{64}$/);
    assert.equal(await store.readHtml(m),html);
    assert.ok((await stat(file)).size<10_000,'index does not carry the page');
    const [name]=await files(dir);assert.equal(name,m.htmlBlob);
    assert.ok(!(await readFile(path.join(dir,'bodies',name))).includes(Buffer.from('Fictional newsletter')),'page is encrypted on disk');
    await store.mutate(s=>{s.messages[0]={...s.messages[0],html};});
    assert.equal(store.state.messages[0].htmlBlob,m.htmlBlob,'unchanged page reuses its file');
    assert.deepEqual(await files(dir),[m.htmlBlob]);
  }finally{await store.close();}
  const reader=await new Store({file,codec,readOnly:true}).open();
  try{assert.equal(await reader.readHtml(reader.state.messages[0]),html);assert.equal(await reader.readHtml({id:'plain'}),null);}finally{await reader.close();}
}));

test('Inline pages in an older index are moved out when the writer opens',()=>fixture(async(dir,file)=>{
  const html=page('legacy');
  await writeFile(file,await codec.protect(Buffer.from(JSON.stringify({version:1,token:'t',accounts:[{id:'a'}],messages:[message('m1',html)],drafts:[]}))));
  const store=await new Store({file,codec}).open();
  try{const m=store.state.messages[0];assert.equal(m.html,undefined);assert.equal(await store.readHtml(m),html);assert.ok((await stat(file)).size<10_000);}finally{await store.close();}
}));

test('Tampered or swapped page files fail closed',()=>fixture(async(dir,file)=>{
  const store=await new Store({file,codec}).open();
  try{
    await store.mutate(s=>{s.messages.push(message('m1',page('one')),message('m2',page('two')));});
    const [m1,m2]=store.state.messages;
    await assert.rejects(store.readHtml({...m1,htmlBlob:m2.htmlBlob}),/verification/);
    await assert.rejects(store.readHtml({...m1,htmlBlob:'../state'}),/unavailable/);
    const target=path.join(dir,'bodies',m1.htmlBlob),raw=await readFile(target);raw[raw.length-1]^=1;await writeFile(target,raw);
    await assert.rejects(store.readHtml(m1));
  }finally{await store.close();}
}));

test('Pages of removed mail, dropped pages and interrupted saves are cleaned when the writer opens',()=>fixture(async(dir,file)=>{
  let keep;
  const store=await new Store({file,codec}).open();
  try{
    await store.mutate(s=>{s.messages.push(message('m1',page('one')),message('m2',page('two')),message('m3',page('three')));});
    keep=store.state.messages[0].htmlBlob;
    await store.mutate(s=>{s.messages=s.messages.filter(m=>m.id!=='m2');s.messages.find(m=>m.id==='m3').html=null;});
    assert.equal(store.state.messages.find(m=>m.id==='m3').htmlBlob,undefined,'a page found absent drops its reference');
    await writeFile(path.join(dir,'bodies',`${keep}.123.tmp`),'partial');
    assert.equal((await files(dir)).length,4);
  }finally{await store.close();}
  const reopened=await new Store({file,codec}).open();
  try{assert.deepEqual(await files(dir),[keep]);assert.equal(await reopened.readHtml(reopened.state.messages[0]),page('one'));}finally{await reopened.close();}
}));

test('A page that is only a shell yields to fuller plain text',()=>{
  assert.equal(htmlIsShell('<a href="https://example.test/view">View online</a>','Fictional plain text with the whole message and many more details than the page'),true);
  assert.equal(htmlIsShell(page('one'),'Fictional newsletter one'),false);
});

const png=Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000','hex');
test('The page API needs login, refetches older mail once and embeds inline pictures',()=>fixture(async(dir,file)=>{
  const store=await new Store({file,codec}).open();let refreshes=0;
  await store.mutate(s=>{s.accounts=[{id:'a',provider:'qq',folders:[{id:'inbox',role:'inbox'}],foldersSyncedAt:new Date().toISOString()}];s.messages=[
    // Cached before pages were kept: no htmlFormat, Content-ID still unknown.
    {id:'old',accountId:'a',folderIds:['inbox'],subject:'Fictional',text:'Fictional cached text',textFormat:2,bodyLoaded:true,attachments:[{id:'old:att:0',filename:'logo.png',size:png.length,content:png.toString('base64')}]},
    {id:'plain',accountId:'a',folderIds:['inbox'],subject:'Fictional',text:'Fictional plain mail',textFormat:2,bodyLoaded:true,htmlFormat:HTML_BODY_FORMAT,attachments:[]}];});
  const port=47961,app=await createApp({store,port,messageLoader:async(_s,m,deps)=>{assert.equal(deps.refreshText,true);refreshes++;await new Promise(r=>setTimeout(r,40));Object.assign(m,{text:'Fictional cached text',textFormat:2,html:'<p>Fictional page</p><img src="cid:logo.png@fictional"><img src="https://tracker.example.test/pixel.gif">',htmlFormat:HTML_BODY_FORMAT,attachments:[{id:'old:att:0',filename:'logo.png',size:png.length,cid:'logo.png@fictional'}]});}}),server=createServer(app);
  await new Promise(r=>server.listen(port,'127.0.0.1',r));
  const get=(url,auth=true)=>fetch(`http://127.0.0.1:${port}/api${url}`,{headers:auth?{Authorization:'Bearer '+store.state.token}:{}});
  try{
    assert.notEqual((await get('/messages/old/html',false)).status,200,'login is required');
    const [first,second]=await Promise.all([get('/messages/old/html'),get('/messages/old/html')]).then(rs=>Promise.all(rs.map(r=>r.json())));
    assert.equal(refreshes,1,'older mail is fetched again only once');
    for(const body of [first,second]){assert.match(body.html,/Fictional page/);assert.ok(body.html.includes('data:image/png;base64,'+png.toString('base64')),'inline picture comes from the attachment');assert.ok(body.html.includes('https://tracker.example.test/pixel.gif'),'remote pictures are left for the viewer to allow');assert.equal(body.shell,false);}
    const stored=store.state.messages.find(m=>m.id==='old');
    assert.equal(stored.htmlFormat,HTML_BODY_FORMAT);assert.ok(stored.htmlBlob);assert.equal(stored.html,undefined);assert.equal(stored.attachments[0].cid,'logo.png@fictional');assert.ok(stored.attachments[0].blob,'cached attachment content is kept');
    await get('/messages/old/html');assert.equal(refreshes,1);
    assert.equal((await (await get('/messages/old')).json()).html,undefined,'message JSON does not carry the page');
    assert.deepEqual(await (await get('/messages/plain/html')).json(),{html:null});assert.equal(refreshes,1);
    assert.equal((await get('/messages/missing/html')).status,404);
  }finally{await new Promise(r=>server.close(r));await app.locals.waitForBackgroundTasks?.();await store.close();}
}));
