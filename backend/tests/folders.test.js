import {test} from 'node:test';
import assert from 'node:assert/strict';
import {listRemoteFolders,syncAccount,updateRemote,composeGmailRaw,sendMail,publicMessage,googleHeaders} from '../src/mail.js';

const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
const stateFor=(account)=>({accounts:[account],messages:[],settings:{}});

test('IMAP folder discovery returns real special-use and custom mailbox paths',async()=>{
 const account={id:'qq-1',provider:'qq',email:'a@example.test',password:'mock'};
 const boxes=[
  {path:'INBOX',name:'INBOX',specialUse:'\\Inbox'},
  {path:'Sent Messages',name:'已发送',specialUse:'\\Sent'},
  {path:'Deleted Messages',name:'已删除',specialUse:'\\Trash'},
  {path:'Junk',name:'垃圾邮件',specialUse:'\\Junk'},
  {path:'Archive',name:'归档',specialUse:'\\All'},
  {path:'Projects/Work',name:'Work'},
 ];
 const deps={imapClientFactory:()=>({connect:async()=>{},list:async()=>boxes,logout:async()=>{}})};
 const folders=await listRemoteFolders(stateFor(account),account,deps);
 assert.deepEqual(folders.map(x=>x.role),['inbox','sent','trash','junk','archive','custom']);
 const custom=folders.at(-1);assert.equal(custom.providerId,'Projects/Work');assert.equal(custom.accountId,account.id);assert.equal(custom.id,'imap:UHJvamVjdHMvV29yaw');
});

test('Graph folder discovery follows nested mailFolders pages recursively',async()=>{
 const account={id:'graph-1',provider:'microsoft',email:'a@example.test',accessToken:'mock',expiresAt:Date.now()+3600000};
 const aliases=new Set(['inbox','sentitems','junkemail','deleteditems','archive','drafts']);let aliasCalls=0;
 const deps={fetchImpl:async url=>{const u=new URL(url),p=u.pathname,alias=p.match(/\/v1\.0\/me\/mailFolders\/([^/]+)$/)?.[1];
  if(alias&&aliases.has(alias)){aliasCalls++;if(alias==='inbox')return json({id:'inbox-id',displayName:'收件箱'});return new Response('',{status:404});}
  if(p==='/v1.0/me/mailFolders')return json({value:[{id:'inbox-id',displayName:'Inbox'}]});
  if(p==='/v1.0/me/mailFolders/inbox-id/childFolders'&&u.searchParams.has('$skip'))return json({value:[{id:'child-2',displayName:'Archive'}]});
  if(p==='/v1.0/me/mailFolders/inbox-id/childFolders')return json({value:[{id:'child-1',displayName:'Projects'}],'@odata.nextLink':'https://graph.microsoft.com/v1.0/me/mailFolders/inbox-id/childFolders?$skip=1'});
  if(p==='/v1.0/me/mailFolders/child-1/childFolders')return json({value:[{id:'grandchild',displayName:'Work'}]});
  return json({value:[]});
 }};
 const folders=await listRemoteFolders(stateFor(account),account,deps);
 assert.deepEqual(folders.map(x=>x.providerId),['inbox-id','child-1','child-2','grandchild']);
 assert.equal(aliasCalls,6);assert.equal(folders[0].id,'inbox');assert.equal(folders[0].name,'Inbox');assert.equal(folders.at(-1).id,'graph:Z3JhbmRjaGlsZA');
});

test('Gmail discovers user labels and keeps one message with all label memberships',async()=>{
 const account={id:'gmail-1',provider:'gmail',email:'a@example.test',accessToken:'mock',expiresAt:Date.now()+3600000};
 const state=stateFor(account);state.messages.push({id:'gmail-1:gmail:m1',accountId:account.id,folder:'inbox',folderIds:['inbox','gmail:b2xkLWxhYmVs'],unread:true,starred:true,providerRef:{type:'gmail',id:'m1',labelIds:['INBOX','old-label']}});let messageFetches=0,listUrls=[];
 const deps={fetchImpl:async url=>{
  const u=new URL(url);
  if(u.pathname.endsWith('/labels'))return json({labels:[{id:'INBOX',name:'INBOX',type:'system'},{id:'SENT',name:'SENT',type:'system'},{id:'project-x',name:'项目',type:'user'}]});
  if(u.pathname.endsWith('/messages')&&!u.pathname.match(/\/messages\/[^/]+$/)){listUrls.push(u);return json({messages:[{id:'m1'}]});}
  if(u.pathname.endsWith('/messages/m1')){messageFetches++;return json({id:'m1',threadId:'t1',internalDate:'1700000000000',labelIds:['INBOX','SENT','project-x'],payload:{headers:[],mimeType:'text/plain',body:{data:Buffer.from('body').toString('base64')}}});}
  throw new Error(`Unexpected mock request ${url}`);
 }};
 const folders=await listRemoteFolders(state,account,deps),custom=folders.find(x=>x.name==='项目');
 assert.equal(custom.id,'gmail:cHJvamVjdC14');assert.equal(custom.accountId,account.id);
 await syncAccount(state,account,'inbox','',20,deps);
 await syncAccount(state,account,custom.id,'',20,deps);
 assert.equal(messageFetches,2);assert.equal(state.messages.length,1);
 assert.deepEqual(new Set(state.messages[0].folderIds),new Set(['inbox','sent',custom.id]));
 assert.deepEqual(new Set(state.messages[0].providerRef.labelIds),new Set(['INBOX','SENT','project-x']));
 assert.equal(state.messages[0].unread,false);assert.equal(state.messages[0].starred,false);
 assert.equal(listUrls.at(-1).searchParams.get('labelIds'),'project-x');assert.equal(listUrls.at(-1).searchParams.has('q'),false);
 assert.equal(state.messages[0].id,'gmail-1:gmail:m1');
});

test('Gmail moves messages between inbox, trash, junk and archive and restores them to inbox',async()=>{
 const account={id:'gmail-2',provider:'gmail',email:'a@example.test',accessToken:'mock',expiresAt:Date.now()+3600000};
 const bodies=[];const deps={fetchImpl:async(url,init={})=>{const body=JSON.parse(init.body||'{}');if(url.includes('/modify'))bodies.push(body);return url.endsWith('/labels')?json({labels:[]}):json({});}};
 for(const [folder,add,remove] of [
  ['trash',['TRASH'],['INBOX','SPAM']],['junk',['SPAM'],['INBOX','TRASH']],['archive',[],['INBOX','SPAM','TRASH']],['inbox',['INBOX'],['SPAM','TRASH']],
 ]){
  const state=stateFor(account),m={id:'gmail-2:gmail:m1',accountId:account.id,folder:'inbox',folderIds:['inbox'],providerRef:{type:'gmail',id:'m1',labelIds:['INBOX']}};state.messages.push(m);
  await updateRemote(state,m,{folder},{...deps});
  const body=bodies.at(-1);assert.deepEqual(new Set(body.addLabelIds),new Set(add));assert.deepEqual(new Set(body.removeLabelIds),new Set(remove));assert.equal(m.folder,folder);
 }
});

test('IMAP custom folder sync fetches the existing remote folder and preserves its UID path',async()=>{
 const account={id:'qq-2',provider:'qq',email:'a@example.test',password:'mock'},state=stateFor(account),boxes=[{path:'INBOX',name:'INBOX',specialUse:'\\Inbox'},{path:'Sent',name:'Sent',specialUse:'\\Sent'},{path:'Projects/Work',name:'Projects'}],opened=[];
 const deps={imapClientFactory:()=>({mailbox:{exists:1,uidValidity:7},connect:async()=>{},logout:async()=>{},list:async()=>boxes,getMailboxLock:async box=>{opened.push(box);return {release(){}};},fetch:async function*(){yield {uid:4,flags:new Set(),envelope:{date:new Date('2026-01-01')},source:Buffer.from('From: sender@example.test\r\nTo: a@example.test\r\nSubject: Test\r\n\r\nBody')}}})};
 const folders=await listRemoteFolders(state,account,deps),custom=folders.find(x=>x.role==='custom');
 await syncAccount(state,account,custom.id,'',10,deps);
 assert.ok(opened.includes('Projects/Work'));assert.equal(state.messages[0].providerRef.folder,'Projects/Work');assert.deepEqual(state.messages[0].folderIds,[custom.id]);
});

test('custom folder descriptors cannot be used with another account',async()=>{
 const account={id:'qq-current',provider:'qq',email:'a@example.test',password:'mock'},state=stateFor(account);
 await assert.rejects(syncAccount(state,account,{id:'imap:UHJvamVjdHMvV29yaw',accountId:'qq-other'}),/does not belong to this account/);
});

test('IMAP resync removes an externally moved message from stale inbox membership',async()=>{
 const account={id:'qq-4',provider:'qq',email:'a@example.test',password:'mock'},state=stateFor(account);state.messages.push({id:'qq-4:imap:INBOX:1',accountId:account.id,folder:'inbox',folderIds:['inbox'],folders:['inbox'],providerRef:{type:'imap',folder:'INBOX',uid:1,uidValidity:'7'}});
 const deps={imapClientFactory:()=>({mailbox:{exists:0,uidValidity:7},connect:async()=>{},logout:async()=>{},list:async()=>[{path:'INBOX',name:'INBOX',specialUse:'\\Inbox'}],getMailboxLock:async()=>({release(){}})})};
 await syncAccount(state,account,'inbox','',20,deps);assert.equal(state.messages.length,0);
});

test('IMAP move without a UID mapping invalidates the cached UID before later flag updates',async()=>{
 const account={id:'qq-3',provider:'qq',email:'a@example.test',password:'mock'},state=stateFor(account),boxes=[{path:'INBOX',name:'INBOX',specialUse:'\\Inbox'},{path:'Trash',name:'Trash',specialUse:'\\Trash'}];let flagCalls=0;
 const deps={imapClientFactory:()=>({mailbox:{exists:1,uidValidity:7},connect:async()=>{},logout:async()=>{},list:async()=>boxes,getMailboxLock:async()=>({release(){}}),messageMove:async()=>({}),messageFlagsAdd:async()=>{flagCalls++;},messageFlagsRemove:async()=>{flagCalls++;}})};
 const m={id:'qq-3:imap:INBOX:1',accountId:account.id,folder:'inbox',providerRef:{type:'imap',folder:'INBOX',uid:1,uidValidity:'7'}};state.messages.push(m);
 await updateRemote(state,m,{folder:'trash'},deps);assert.equal(m.providerRef.uid,null);assert.equal(m.providerRef.folder,'Trash');assert.equal(state.messages.length,0);
 await assert.rejects(updateRemote(state,m,{unread:false},deps),/UID unavailable/);assert.equal(flagCalls,0);
});

test('IMAP move resolves destination before locking and commits after remote move without a second folder listing',async()=>{
 const account={id:'qq-atomic',provider:'qq',email:'a@example.test',password:'mock'},state=stateFor(account);let listCalls=0,moveCalls=0,lockHeld=false;
 const boxes=[{path:'INBOX',name:'INBOX',specialUse:'\\Inbox'},{path:'Trash',name:'Trash',specialUse:'\\Trash'}];
 const deps={imapClientFactory:()=>({
  mailbox:{exists:1,uidValidity:7},connect:async()=>{},logout:async()=>{},
  list:async()=>{listCalls++;if(listCalls>1)throw new Error('unexpected second folder list');return boxes;},
  getMailboxLock:async()=>{lockHeld=true;return {release(){lockHeld=false;}};},
  messageMove:async()=>{assert.equal(lockHeld,true);moveCalls++;return {uidMap:new Map([[1,9]]),uidValidity:8};}
 })};
 const m={id:'qq-atomic:imap:INBOX:1',accountId:account.id,folder:'inbox',folderIds:['inbox'],providerRef:{type:'imap',folder:'INBOX',uid:1,uidValidity:'7'}};state.messages.push(m);
 await updateRemote(state,m,{folder:'trash'},deps);
 assert.equal(listCalls,1);assert.equal(moveCalls,1);assert.equal(m.providerRef.folder,'Trash');assert.equal(m.providerRef.uid,9);assert.deepEqual(m.folderIds,['trash']);
});

test('IMAP move uses the account folder cache without opening a folder-list connection',async()=>{
 const account={id:'qq-cached',provider:'qq',email:'a@example.test',password:'mock',folders:[{id:'trash',role:'trash',providerId:'Deleted Items'}]},state=stateFor(account);let listCalls=0,moveCalls=0;
 const deps={imapClientFactory:()=>({mailbox:{exists:1,uidValidity:7},connect:async()=>{},logout:async()=>{},list:async()=>{listCalls++;throw new Error('cache should avoid remote list');},getMailboxLock:async()=>({release(){}}),messageMove:async(_uid,folder)=>{assert.equal(folder,'Deleted Items');moveCalls++;return {uidMap:new Map([[1,2]]),uidValidity:8};}})};
 const m={id:'qq-cached:imap:INBOX:1',accountId:account.id,folder:'inbox',providerRef:{type:'imap',folder:'INBOX',uid:1,uidValidity:'7'}};state.messages.push(m);
 await updateRemote(state,m,{folder:'trash'},deps);assert.equal(listCalls,0);assert.equal(moveCalls,1);assert.equal(m.providerRef.uid,2);
});

test('Gmail move commits local labels after one preflight label lookup and no post-move request',async()=>{
 const account={id:'gmail-atomic',provider:'gmail',email:'a@example.test',accessToken:'mock',expiresAt:Date.now()+3600000},state=stateFor(account);let labelCalls=0,modifyCalls=0;
 const deps={fetchImpl:async(url,init={})=>{if(url.endsWith('/labels')){labelCalls++;if(labelCalls>1)throw new Error('unexpected post-move label lookup');return json({labels:[{id:'INBOX',name:'INBOX',type:'system'},{id:'TRASH',name:'TRASH',type:'system'},{id:'SPAM',name:'SPAM',type:'system'},{id:'custom-1',name:'项目',type:'user'}]});}if(url.includes('/modify')){modifyCalls++;return json({});}throw new Error(`Unexpected mock request ${url}`);}};
 const customId='gmail:Y3VzdG9tLTE',m={id:'gmail-atomic:gmail:m1',accountId:account.id,folder:'inbox',folderIds:['inbox','gmail:Y3VzdG9tLTE'],providerRef:{type:'gmail',id:'m1',labelIds:['INBOX','custom-1']}};state.messages.push(m);
 await updateRemote(state,m,{folder:'trash'},deps);
 assert.equal(labelCalls,1);assert.equal(modifyCalls,1);assert.deepEqual(new Set(m.providerRef.labelIds),new Set(['custom-1','TRASH']));assert.deepEqual(new Set(m.folderIds),new Set(['trash','gmail:Y3VzdG9tLTE']));
});

test('Graph move is the final provider request and commits the returned message ID locally',async()=>{
 const account={id:'graph-atomic',provider:'microsoft',email:'a@example.test',accessToken:'mock',expiresAt:Date.now()+3600000,folders:[{id:'trash',role:'trash',providerId:'trash-id'}]},state=stateFor(account);const calls=[];
 const deps={fetchImpl:async(url,init={})=>{calls.push({url,method:init.method||'GET'});if(url.endsWith('/messages/m1'))return json({});if(url.endsWith('/messages/m1/move'))return json({id:'m2'});throw new Error('unexpected request after move');}};
 const m={id:'graph-atomic:graph:m1',accountId:account.id,folder:'inbox',folderIds:['inbox'],providerRef:{type:'graph',id:'m1',folder:'inbox'}};state.messages.push(m);
 await updateRemote(state,m,{folder:'trash'},deps);
 assert.deepEqual(calls.map(x=>x.method),['POST']);assert.equal(calls[0].url.endsWith('/messages/m1/move'),true);assert.equal(m.id,'graph-atomic:graph:m2');assert.equal(m.providerRef.id,'m2');assert.deepEqual(m.folderIds,['trash']);
});

test('Gmail MIME and SMTP sends decode base64 attachments while retaining reply headers',async()=>{
 const attachment={filename:'hello.txt',content:Buffer.from('hello attachment').toString('base64'),contentType:'text/plain'};
 const raw=Buffer.from(await composeGmailRaw({from:'a@example.test',to:'b@example.test',subject:'file',text:'body',attachments:[{filename:attachment.filename,content:Buffer.from(attachment.content,'base64'),contentType:attachment.contentType}]}),'base64url').toString('utf8');
 assert.match(raw,/filename="?hello\.txt"?/);assert.match(raw,/aGVsbG8gYXR0YWNobWVudA==/);
 let sentOptions;const account={id:'smtp-1',provider:'qq',email:'a@example.test',password:'mock'},state=stateFor(account);state.messages.push({id:'source',providerRef:{type:'imap',rfcMessageId:'<original@example.test>',references:'<older@example.test>'}});
 await sendMail(state,account,{to:'b@example.test',subject:'reply',text:'body',replyToMessageId:'source',attachments:[attachment]},{smtpTransportFactory:()=>({sendMail:async options=>(sentOptions=options,{messageId:'sent'})}),imapClientFactory:()=>({connect:async()=>{throw new Error('fixture copy failure')},logout:async()=>{}})});
 assert.equal(sentOptions.attachments[0].content.toString(),'hello attachment');assert.equal(sentOptions.inReplyTo,'<original@example.test>');assert.equal(sentOptions.references,'<older@example.test> <original@example.test>');
});

test('Gmail send request carries an attached MIME part and keeps Gmail reply threading',async()=>{
 const account={id:'gmail-send',provider:'gmail',email:'a@example.test',accessToken:'mock',expiresAt:Date.now()+3600000},state=stateFor(account);state.messages.push({id:'source',providerRef:{type:'gmail',threadId:'thread-1',rfcMessageId:'<original@example.test>',references:'<older@example.test>'}});let payload;
 const deps={fetchImpl:async(_url,init)=>{payload=JSON.parse(init.body);return json({id:'sent-1'});}};
 const attachment={filename:'hello.txt',content:Buffer.from('hello attachment').toString('base64'),contentType:'text/plain'};
 const result=await sendMail(state,account,{to:'b@example.test',subject:'reply',text:'body',replyToMessageId:'source',attachments:[attachment]},deps);
 const raw=Buffer.from(payload.raw,'base64url').toString('utf8');assert.equal(payload.threadId,'thread-1');assert.match(raw,/filename="?hello\.txt"?/);assert.match(raw,/aGVsbG8gYXR0YWNobWVudA==/);assert.match(raw,/In-Reply-To: <original@example\.test>/i);assert.equal(result.messageId,'sent-1');
});

test('Graph direct and reply sends encode fileAttachment payloads without changing reply flow',async()=>{
 const attachment={filename:'hello.txt',content:Buffer.from('hello attachment').toString('base64'),contentType:'text/plain'};
 const account={id:'graph-send',provider:'microsoft',email:'a@example.test',accessToken:'mock',expiresAt:Date.now()+3600000};
 let sentPayload;const directDeps={fetchImpl:async(url,init)=>{if(url.endsWith('/me/messages')){sentPayload={message:JSON.parse(init.body)};assert.equal(init.headers.Prefer,'IdType="ImmutableId"');return json({id:'immutable-sent'});}return json({},202);}};
 await sendMail(stateFor(account),account,{to:'b@example.test',subject:'file',text:'body',attachments:[attachment]},directDeps);
 assert.equal(sentPayload.message.attachments[0]['@odata.type'],'#microsoft.graph.fileAttachment');assert.equal(sentPayload.message.attachments[0].name,'hello.txt');assert.equal(Buffer.from(sentPayload.message.attachments[0].contentBytes,'base64').toString(),'hello attachment');
 const replyState=stateFor(account);replyState.messages.push({id:'source',providerRef:{type:'graph',id:'source-1',rfcMessageId:'<original@example.test>'}});const calls=[];
 const replyDeps={fetchImpl:async(url,init={})=>{calls.push({url,init});return url.endsWith('/createReply')?json({id:'reply-1'}):json({},202);}};
 await sendMail(replyState,account,{to:'b@example.test',subject:'reply',text:'body',replyToMessageId:'source',attachments:[attachment]},replyDeps);
 assert.ok(calls[0].url.endsWith('/createReply'));assert.equal(calls[1].url.endsWith('/reply-1'),true);assert.equal(JSON.parse(calls[1].init.body).attachments,undefined);assert.ok(calls[2].url.endsWith('/reply-1/attachments'));const replyAttachment=JSON.parse(calls[2].init.body);assert.equal(replyAttachment['@odata.type'],'#microsoft.graph.fileAttachment');assert.equal(replyAttachment.name,'hello.txt');assert.equal(Buffer.from(replyAttachment.contentBytes,'base64').toString(),'hello attachment');assert.ok(calls[3].url.endsWith('/reply-1/send'));
});

test('public messages expose folder membership and replyTo but never attachment contents',()=>{
 const visible=publicMessage({id:'m',accountId:'a',folder:'inbox',folderIds:['inbox','gmail:label'],replyTo:'reply@example.test',attachments:[{id:'att',filename:'secret.txt',size:4,content:'c2VjcmV0'}]});
 assert.deepEqual(visible.folderIds,['inbox','gmail:label']);assert.equal(visible.replyTo,'reply@example.test');assert.equal(visible.attachments[0].content,undefined);
 const headers=googleHeaders({headers:[{name:'reply-to',value:'Reply Person <reply@example.test>'}]},'1700000000000');assert.deepEqual(headers.replyTo,[{name:'Reply Person',address:'reply@example.test'}]);
});
