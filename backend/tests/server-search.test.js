import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
import {Store} from '../src/store.js';
import {createApp} from '../src/server.js';
import {searchAccount,syncAccount,markServerSearch,SERVER_SEARCH_KEEP_MS} from '../src/mail.js';

// 虚构的 IMAP 邮箱：seq 从 1 开始，uid = seq*10。search 行为可按测试替换。
function fakeImap({count=200,validity='5',search}={}){
 const rows=Array.from({length:count},(_,i)=>({seq:i+1,uid:(i+1)*10,subject:i===4?'虚构发票 2019':`Fictional note ${i+1}`,from:i===7?'billing@example.test':`sender${i+1}@example.test`,date:new Date(Date.UTC(2019,0,1)+i*86400000)}));
 const calls={search:[],fetch:[]};
 const envelope=r=>({subject:r.subject,from:[{name:'',address:r.from}],to:[{address:'me@example.test'}],date:r.date,messageId:`<m${r.uid}@example.test>`});
 const client={mailbox:{exists:count,uidValidity:validity},connect:async()=>{},logout:async()=>{},list:async()=>[],getMailboxLock:async()=>({release(){}}),
  search:async(query,options)=>{calls.search.push({query,options});return search?search(query,rows):rows.filter(r=>r.subject.includes('发票')).map(r=>r.uid);},
  fetch:async function*(range,fields,options){calls.fetch.push({range,fields,options});let picked;if(options?.uid){const set=new Set(String(range).split(',').map(Number));picked=rows.filter(r=>set.has(r.uid));}else{const [a,b]=String(range).split(':').map(Number);picked=rows.filter(r=>r.seq>=a&&r.seq<=b);}for(const r of picked)yield {uid:r.uid,flags:new Set(r.uid===50?['\\Seen']:[]),envelope:envelope(r),size:900,bodyStructure:{type:'text/plain',part:'1',size:40}};}};
 return {client,calls,rows};
}
const imapAccount=(provider='godaddy')=>({id:'acct',provider,email:'me@example.test',password:'fictional',folders:[{id:'inbox',role:'inbox',providerId:'INBOX'}]});

test('IMAP server search uses SEARCH over subject, sender and body, then fetches headers only for the newest hits',async()=>{
 const {client,calls}=fakeImap({search:()=>[50,80,1200,1500]}),account=imapAccount(),state={accounts:[account],messages:[],settings:{}};
 const result=await searchAccount(state,account,'inbox','虚构发票',2,{imapClientFactory:()=>client});
 assert.deepEqual(calls.search[0],{query:{or:[{subject:'虚构发票'},{from:'虚构发票'},{body:'虚构发票'}]},options:{uid:true}});
 assert.equal(result.messages.length,2);assert.equal(result.more,true);assert.equal(result.limited,false);
 assert.deepEqual(result.messages.map(m=>m.providerRef.uid),[1500,1200]);
 assert.equal(calls.fetch.length,1);assert.equal(calls.fetch[0].fields.source,undefined);assert.deepEqual(calls.fetch[0].options,{uid:true});
 const m=result.messages[0];assert.equal(m.id,'acct:imap:INBOX:1500');assert.equal(m.bodyLoaded,false);assert.equal(m.text,'');assert.deepEqual(m.folderIds,['inbox']);assert.equal(m.providerRef.uidValidity,'5');assert.equal(m.providerRef.rfcMessageId,'<m1500@example.test>');
});

test('QQ search tolerates rejected or ignored UTF-8 SEARCH by falling back to criteria, then to recent headers',async()=>{
 // 整个 OR 被拒、只有 SUBJECT 可用
 let fake=fakeImap({search:q=>q.subject?[50]:false});let account=imapAccount('qq');
 let result=await searchAccount({accounts:[account],messages:[],settings:{}},account,'inbox','虚构发票',50,{imapClientFactory:()=>fake.client});
 assert.equal(fake.calls.search.length,4);assert.deepEqual(result.messages.map(m=>m.providerRef.uid),[50]);assert.equal(result.limited,true);
 // SEARCH 全部失败：只在本机比对最近邮件的主题与发件人
 fake=fakeImap({search:()=>false});account=imapAccount('qq');
 result=await searchAccount({accounts:[account],messages:[],settings:{}},account,'inbox','billing@',50,{imapClientFactory:()=>fake.client});
 assert.deepEqual(result.messages.map(m=>m.providerRef.uid),[80]);assert.equal(result.limited,true);assert.ok(fake.calls.fetch.some(c=>c.range==='1:200'&&c.fields.envelope&&!c.fields.source));
 // QQ 对中文 SEARCH 静默返回空：同样回退到主题比对
 fake=fakeImap({search:()=>[]});account=imapAccount('qq');
 result=await searchAccount({accounts:[account],messages:[],settings:{}},account,'inbox','发票',50,{imapClientFactory:()=>fake.client});
 assert.deepEqual(result.messages.map(m=>m.providerRef.uid),[50]);assert.equal(result.limited,true);
 // 非 QQ 的空结果就是空结果
 fake=fakeImap({search:()=>[]});account=imapAccount('godaddy');
 result=await searchAccount({accounts:[account],messages:[],settings:{}},account,'inbox','发票',50,{imapClientFactory:()=>fake.client});
 assert.equal(result.messages.length,0);assert.equal(result.limited,false);
});

test('Gmail server search sends q with the folder label and reads metadata only',async()=>{
 const urls=[],account={id:'g',provider:'gmail',email:'me@example.test',accessToken:'fictional',expiresAt:Date.now()+3600000,folders:[{id:'inbox',role:'inbox',providerId:'INBOX'},{id:'gmail:TGFiZWw',role:'custom',providerId:'Label_1',accountId:'g'}]};
 const fetchImpl=async url=>{const u=new URL(url);urls.push(u);if(u.pathname.endsWith('/messages'))return Response.json({messages:[{id:'old1'}],nextPageToken:'next'});return Response.json({id:'old1',threadId:'t',labelIds:['INBOX','Label_1'],snippet:'Fictional older invoice',internalDate:String(Date.UTC(2018,5,1)),payload:{headers:[{name:'Subject',value:'Invoice 2018'},{name:'From',value:'Billing <billing@example.test>'},{name:'Message-ID',value:'<g-old@example.test>'}]}});};
 const result=await searchAccount({accounts:[account],messages:[],settings:{}},account,'inbox','invoice from:billing',50,{fetchImpl});
 const list=urls.find(u=>u.pathname.endsWith('/messages'));assert.equal(list.searchParams.get('q'),'invoice from:billing');assert.deepEqual(list.searchParams.getAll('labelIds'),['INBOX']);assert.equal(list.searchParams.get('maxResults'),'50');
 assert.equal(urls.find(u=>u.pathname.endsWith('/old1')).searchParams.get('format'),'metadata');
 const m=result.messages[0];assert.equal(m.id,'g:gmail:old1');assert.equal(m.text,'Fictional older invoice');assert.equal(m.bodyLoaded,false);assert.equal(m.unread,false);assert.deepEqual([...m.folderIds].sort(),['gmail:TGFiZWw','inbox']);assert.equal(result.more,true);
});

test('Graph server search uses $search without $orderby and keeps the searched folder',async()=>{
 const urls=[],account={id:'o',provider:'microsoft',email:'me@example.test',accessToken:'fictional',expiresAt:Date.now()+3600000,folders:[{id:'inbox',role:'inbox',providerId:'AAMk-inbox'}]};
 const fetchImpl=async url=>{urls.push(new URL(url));return Response.json({value:[{id:'AAMk-old',internetMessageId:'<o-old@example.test>',subject:'Contract 2017',from:{emailAddress:{name:'Legal',address:'legal@example.test'}},toRecipients:[],receivedDateTime:'2017-03-01T00:00:00Z',bodyPreview:'Fictional preview',isRead:true,flag:{flagStatus:'flagged'}}],'@odata.nextLink':'https://graph.microsoft.com/v1.0/next'});};
 const result=await searchAccount({accounts:[account],messages:[],settings:{}},account,'inbox','say "contract"',50,{fetchImpl});
 const u=urls[0];assert.equal(u.searchParams.get('$search'),'"say  contract"');assert.equal(u.searchParams.has('$orderby'),false);assert.equal(u.searchParams.get('$top'),'50');assert.ok(u.pathname.endsWith('/mailFolders/AAMk-inbox/messages'));assert.match(u.searchParams.get('$select'),/bodyPreview/);
 const m=result.messages[0];assert.equal(m.id,'o:graph:AAMk-old');assert.equal(m.text,'Fictional preview');assert.equal(m.bodyLoaded,false);assert.equal(m.starred,true);assert.deepEqual(m.folderIds,['inbox']);assert.equal(result.more,true);
});

test('Regular Graph sync still orders by date and never sends $search',async()=>{
 const urls=[],account={id:'o',provider:'microsoft',email:'me@example.test',accessToken:'fictional',expiresAt:Date.now()+3600000,folders:[{id:'inbox',role:'inbox',providerId:'AAMk-inbox'}]};
 await syncAccount({accounts:[account],messages:[],settings:{}},account,'inbox','',60,{metadataOnly:true,fetchImpl:async url=>{urls.push(new URL(url));return Response.json({value:[]});}});
 assert.equal(urls[0].searchParams.get('$orderby'),'receivedDateTime desc');assert.equal(urls[0].searchParams.has('$search'),false);
});

test('Synced window trimming keeps marked server-search hits until the mark expires',async()=>{
 const {client}=fakeImap({count:3}),account=imapAccount(),now=Date.now();
 const row=(uid,extra={})=>({id:`acct:imap:INBOX:${uid}`,accountId:'acct',folder:'inbox',folderIds:['inbox'],folders:['inbox'],subject:'Old fictional',date:'2010-01-01T00:00:00Z',providerRef:{type:'imap',folder:'INBOX',uid,uidValidity:'5'},bodyLoaded:false,text:'',...extra});
 const state={accounts:[account],settings:{},messages:[markServerSearch(row(9001),'old',now),row(9002),{...row(9003),serverSearch:{until:now-1,terms:['old']}}]};
 await syncAccount(state,account,'inbox','',60,{metadataOnly:true,imapClientFactory:()=>client});
 const ids=state.messages.map(m=>m.id);assert.ok(ids.includes('acct:imap:INBOX:9001'));assert.ok(!ids.includes('acct:imap:INBOX:9002'));assert.ok(!ids.includes('acct:imap:INBOX:9003'));assert.equal(state.messages.filter(m=>/:(10|20|30)$/.test(m.id)).length,3);
 assert.ok(state.messages.find(m=>m.id==='acct:imap:INBOX:9001').serverSearch.until>=now+SERVER_SEARCH_KEEP_MS-1000);
});

async function fixture(options){
 const dir=await mkdtemp(path.join(os.tmpdir(),'lettide-server-search-'));
 const store=await new Store({file:path.join(dir,'state'),codec:{protect:async x=>x,unprotect:async x=>x}}).open();
 await store.mutate(s=>{s.accounts=[{id:'a',provider:'qq',email:'a@example.test',folders:[{id:'inbox',role:'inbox',providerId:'INBOX'}],foldersSyncedAt:new Date().toISOString()},{id:'b',provider:'gmail',email:'b@example.test',folders:[{id:'inbox',role:'inbox',providerId:'INBOX'}],foldersSyncedAt:new Date().toISOString()},{id:'c',provider:'microsoft',email:'c@example.test',folders:[],foldersSyncedAt:new Date().toISOString()}];s.messages=[{id:'a:imap:INBOX:10',accountId:'a',folder:'inbox',folderIds:['inbox'],folders:['inbox'],unread:false,starred:true,subject:'Already cached',text:'Downloaded fictional body',textFormat:2,bodyLoaded:true,date:'2026-10-01T00:00:00Z',from:{address:'x@example.test'},to:[],attachments:[],providerRef:{type:'imap',folder:'INBOX',uid:10,uidValidity:'5'}}];});
 const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const app=await createApp({store,port,folderLister:async()=>[],messageLoader:async(_s,m)=>{m.text='Fictional loaded body';m.textFormat=2;m.bodyLoaded=true;},...options});
 const server=createServer(app);await new Promise(r=>server.listen(port,'127.0.0.1',r));
 const request=(route,body)=>fetch(`http://127.0.0.1:${port}/api${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${store.state.token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}).then(async r=>({status:r.status,body:await r.json().catch(()=>null)}));
 return {store,app,request,close:async()=>{await app.locals.waitForBackgroundTasks();await new Promise(r=>server.close(r));await store.close();await rm(dir,{recursive:true,force:true});}};
}
const hit=(accountId,key,extra={})=>({id:`${accountId}:${key}`,accountId,folder:'inbox',folderIds:['inbox'],folders:['inbox'],subject:`Older fictional ${key}`,from:{address:'old@example.test'},to:[],date:'2015-05-05T00:00:00Z',text:'snippet',bodyLoaded:false,attachments:[],unread:true,starred:false,providerRef:{type:'imap',folder:'INBOX',uid:Number(key.split(':').at(-1))||1,uidValidity:'5',rfcMessageId:`<${accountId}-${key}@example.test>`},...extra});

test('Server search merges hits once, keeps cached state, isolates failing accounts and stays findable locally',async()=>{
 let calls=0;
 const f=await fixture({serverSearchTimeoutMs:200,serverSearcher:async(state,account,folder,query,limit,options)=>{calls++;assert.equal(folder,'inbox');assert.equal(query,'older');assert.equal(limit,50);assert.equal(options.priority,'foreground');
  if(account.id==='a'){account.lastSearch='fictional';return {messages:[hit('a','imap:INBOX:10',{unread:true,starred:false,subject:'Server copy'}),hit('a','imap:INBOX:900')],more:true,limited:true};}
  if(account.id==='b')throw Object.assign(new Error('expired'),{code:'AUTH_REQUIRED'});
  return new Promise(()=>{});}});
 try{
  const first=await f.request('/server-search',{query:' older ',folder:'inbox'});
  assert.equal(first.status,200);assert.equal(calls,3);assert.equal(first.body.added,1);assert.equal(first.body.more,true);assert.deepEqual(first.body.limited,['a']);assert.equal(first.body.searched,3);
  assert.deepEqual(first.body.errors.sort((x,y)=>x.accountId.localeCompare(y.accountId)),[{accountId:'b',error:'Authorization expired; reconnect this account'},{accountId:'c',error:'Server search timed out'}]);
  assert.deepEqual(first.body.items.map(m=>m.id),['a:imap:INBOX:10','a:imap:INBOX:900']);assert.equal(first.body.items[1].summary,true);
  const cached=f.store.state.messages.find(m=>m.id==='a:imap:INBOX:10');assert.equal(cached.unread,false);assert.equal(cached.starred,true);assert.equal(cached.subject,'Already cached');assert.equal(cached.text,'Downloaded fictional body');assert.equal(cached.bodyLoaded,true);assert.deepEqual(cached.serverSearch.terms,['older']);
  assert.equal(f.store.state.accounts.find(a=>a.id==='a').lastSearch,'fictional');
  const again=await f.request('/server-search',{query:'older',accountId:'a'});assert.equal(again.body.added,0);assert.equal(f.store.state.messages.filter(m=>m.id==='a:imap:INBOX:900').length,1);assert.deepEqual(again.body.errors,[]);
  // 摘要里没有关键词的服务器结果，本机搜索同一个词仍能找到
  const local=await f.request('/messages?query=older&summary=true');assert.deepEqual(local.body.items.map(m=>m.id).sort(),['a:imap:INBOX:10','a:imap:INBOX:900']);
  const body=await f.request('/messages/a:imap:INBOX:900');assert.equal(body.status,200);assert.equal(body.body.text,'Fictional loaded body');
  assert.equal((await f.request('/server-search',{query:''})).status,400);assert.equal((await f.request('/server-search',{query:'x',accountId:'missing'})).status,404);assert.equal((await f.request('/server-search',{query:'x',folder:'nope'})).status,400);
 }finally{await f.close();}
});

test('Server search deduplicates by Message-ID against a cached copy in the same folder',async()=>{
 const f=await fixture({serverSearcher:async(state,account)=>account.id==='a'?{messages:[hit('a','imap:INBOX:77',{providerRef:{type:'imap',folder:'INBOX',uid:77,uidValidity:'5',rfcMessageId:'<dup@example.test>'}})]}:{messages:[]}});
 try{
  await f.store.mutate(s=>{s.messages.push({id:'a:sent-copy:1',accountId:'a',folder:'inbox',folderIds:['inbox'],folders:['inbox'],subject:'Local copy',date:'2015-05-05T00:00:00Z',providerRef:{type:'sent-copy',rfcMessageId:'<dup@example.test>'},attachments:[]});});
  const r=await f.request('/server-search',{query:'dup'});assert.equal(r.body.added,0);assert.deepEqual(r.body.items.map(m=>m.id),['a:sent-copy:1']);assert.equal(f.store.state.messages.some(m=>m.id==='a:imap:INBOX:77'),false);
 }finally{await f.close();}
});

test('A real background sync after server search does not trim the hit from the cache',async()=>{
 // 邮箱共 200 封；同步窗口只取最近 60 封。服务器搜索命中第 5 封（uid 50），远在窗口之外。
 const {client}=fakeImap({count:200,search:()=>[50]});
 const f=await fixture({serverSearcher:(state,account,folder,query,limit,options)=>account.provider==='qq'?searchAccount(state,account,folder,query,limit,{...options,imapClientFactory:()=>client}):Promise.resolve({messages:[]}),mailSyncer:(state,account,folder,query,limit,options)=>syncAccount(state,account,folder,query,limit,{...options,imapClientFactory:()=>client})});
 try{
  // 先让缓存里只有一封窗口外的普通旧邮件，验证普通旧邮件照旧规则处理、带标记的命中被保留
  client.mailbox.exists=200;
  const r=await f.request('/server-search',{query:'发票',accountId:'a'});assert.equal(r.status,200);assert.equal(r.body.added,1);assert.deepEqual(r.body.items.map(m=>m.id),['a:imap:INBOX:50']);
  // 模拟邮箱里只剩 30 封（窗口未满，旧规则会把窗口外的缓存邮件全部移出）
  const fetch=client.fetch;client.mailbox.exists=30;client.fetch=async function*(range,fields,options){if(!options?.uid){const [a]=String(range).split(':').map(Number);yield* fetch(`${Math.max(a,171)}:200`,fields,options);return;}yield* fetch(range,fields,options);};
  assert.equal((await f.request('/sync',{accountId:'a',folder:'inbox'})).status,200);
  const ids=f.store.state.messages.map(m=>m.id);
  assert.ok(ids.includes('a:imap:INBOX:50'));assert.ok(!ids.includes('a:imap:INBOX:10'));assert.ok(ids.includes('a:imap:INBOX:2000'));
 }finally{await f.close();}
});
