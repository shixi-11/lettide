import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {simpleParser} from 'mailparser';
import {sendMail,saveSentCopy} from '../src/mail.js';
import {createApp} from '../src/server.js';

const account={id:'sender',provider:'qq',email:'sender@example.test',password:'fictional'};
const draft={id:'draft',accountId:account.id,to:'reader@example.test',bcc:'blind@example.test',subject:'Fictional reply',text:'Fictional body',replyToMessageId:'parent',attachments:[{filename:'notes.txt',content:Buffer.from('Fictional attachment').toString('base64')}]};
const state=()=>({token:'fixture-token',accounts:[structuredClone(account)],drafts:[structuredClone(draft)],messages:[{id:'parent',providerRef:{rfcMessageId:'<parent@example.test>',references:['<older@example.test>']}}],settings:{},jobs:[],sendResults:{}});
function remote({fail=false,appendUncertain=false,autoSaved=false}={}){
 const copies=new Map();let appends=0,connects=0;const boxes=[{path:'INBOX'},{path:'Provider/Sent',name:'Sent',specialUse:'\\Sent'}];
 const client=()=>({mailbox:{uidValidity:9},connect:async()=>{connects++;if(fail)throw new Error('fictional IMAP failure')},logout:async()=>{},list:async()=>boxes,getMailboxLock:async folder=>{assert.ok(boxes.some(b=>b.path===folder));return {release(){}}},search:async query=>[...copies].filter(([,id])=>id.includes(query.header['message-id'])).map(([uid])=>uid),fetch:async function*(ids){for(const uid of ids)yield {uid,envelope:{messageId:copies.get(uid)}}},append:async(folder,raw,flags,date)=>{appends++;const p=await simpleParser(raw);copies.set(7,p.messageId);assert.deepEqual(flags,['\\Seen']);assert.ok(date instanceof Date);if(appendUncertain)throw new Error('fictional lost APPEND response');return {uid:7,uidValidity:9}}});
 return {client,copies,boxes,stats:()=>({appends,connects}),smtp:()=>({sendMail:async options=>{if(autoSaved)copies.set(4,options.messageId);return {messageId:options.messageId}},close(){}})};
}

test('SMTP accepted + IMAP copy saved preserves MIME, Message-ID, attachments, reply chain and private Bcc',async()=>{
 const r=remote();let wire,packet,prepared=false;
 const result=await sendMail(state(),account,draft,{smtpTransportFactory:()=>({sendMail:async options=>{assert.equal(prepared,true);wire=options;return {messageId:options.messageId}},close(){}}),imapClientFactory:r.client,wait:async()=>{},onPrepared:async p=>{prepared=true;packet=p}});
 assert.equal(result.sentCopy.status,'saved');assert.equal(r.stats().appends,1);
 const sent=await simpleParser(wire.raw),copy=await simpleParser(Buffer.from(packet.raw,'base64'));
 assert.equal(sent.messageId,copy.messageId);assert.equal(result.messageId,copy.messageId);assert.equal(sent.bcc,undefined);assert.equal(copy.bcc.value[0].address,'blind@example.test');assert.ok(wire.envelope.to.includes('blind@example.test'));
 assert.equal(copy.attachments[0].content.toString(),'Fictional attachment');assert.equal(copy.inReplyTo,'<parent@example.test>');assert.deepEqual(copy.references,['<older@example.test>','<parent@example.test>']);assert.equal(sent.text,copy.text);
});

test('server auto-save is detected by exact Message-ID and no copy is appended',async()=>{
 const r=remote({autoSaved:true});const info=await sendMail(state(),account,draft,{smtpTransportFactory:r.smtp,imapClientFactory:r.client,wait:async()=>{}});
 assert.equal(info.sentCopy.alreadyExists,true);assert.equal(r.stats().appends,0);
});

test('SMTP success and copy failure remain separate; only the copy is safely retried after an uncertain APPEND',async()=>{
 const r=remote({appendUncertain:true});let sends=0;
 const info=await sendMail(state(),account,draft,{smtpTransportFactory:()=>({sendMail:async()=>{sends++;return {}},close(){}}),imapClientFactory:r.client,wait:async()=>{}});
 assert.equal(info.sentCopy.status,'pending');assert.ok(info.sentCopyPacket.raw);
 const restored=await saveSentCopy(state(),account,info.sentCopyPacket,{imapClientFactory:r.client,wait:async()=>{}});
 assert.equal(restored.status,'saved');assert.equal(restored.alreadyExists,true);assert.equal(sends,1);assert.equal(r.stats().appends,1);
});

test('configured Sent mailbox wins; missing or uncheckable mailbox never gets a guessed APPEND',async()=>{
 const r=remote({fail:true});const info=await sendMail(state(),account,draft,{smtpTransportFactory:r.smtp,imapClientFactory:r.client});
 const good=remote();good.boxes.push({path:'Custom/Outgoing',name:'Outgoing'});
 const saved=await saveSentCopy(state(),{...account,sentFolder:'Custom/Outgoing'},info.sentCopyPacket,{imapClientFactory:good.client,wait:async()=>{}});assert.equal(saved.folder,'Custom/Outgoing');
 await assert.rejects(saveSentCopy(state(),{...account,sentFolder:'Missing'},info.sentCopyPacket,{imapClientFactory:good.client}),/unavailable/);
 const before=good.stats().appends;await assert.rejects(saveSentCopy(state(),account,{...info.sentCopyPacket,messageId:'<wrong@example.test>'},{imapClientFactory:good.client}),/does not match/);assert.equal(good.stats().appends,before);
});

test('SMTP rejection never attempts to create a Sent copy',async()=>{
 const r=remote();await assert.rejects(sendMail(state(),account,draft,{smtpTransportFactory:()=>({sendMail:async()=>{throw new Error('SMTP rejection')},close(){}}),imapClientFactory:r.client}),/SMTP rejection/);assert.equal(r.stats().connects,0);
});

test('a provider special-use Sent folder takes priority over a custom folder named Sent',async()=>{
 const r=remote();r.boxes.unshift({path:'Sent',name:'Sent'});
 const info=await sendMail(state(),account,draft,{smtpTransportFactory:r.smtp,imapClientFactory:r.client,wait:async()=>{}});
 assert.equal(info.sentCopy.folder,'Provider/Sent');
});

async function fixture(sender,initial=state(),options={}){
 const store={state:initial,queue:Promise.resolve(),open:async()=>{},mutate(fn){const work=this.queue.then(async()=>{const next=structuredClone(this.state),value=await fn(next);this.state=next;return value});this.queue=work.catch(()=>{});return work;}};
 const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const app=await createApp({store,port,mailSender:sender,...options}),server=createServer(app);await new Promise(r=>server.listen(port,'127.0.0.1',r));
 const url=`http://127.0.0.1:${port}`,headers={authorization:`Bearer ${store.state.token}`,'content-type':'application/json'};
 return {store,app,url,headers,close:()=>new Promise(r=>server.close(r))};
}

test('API reports sent after copy failure, persists retry MIME privately, and refuses all resend keys',async()=>{
 let sends=0;const r=remote({fail:true});const f=await fixture((s,a,d,callbacks)=>sendMail(s,a,d,{...callbacks,smtpTransportFactory:()=>({sendMail:async()=>{sends++;return {}},close(){}}),imapClientFactory:r.client}));
 try{
  const response=await fetch(f.url+'/api/drafts/draft/send',{method:'POST',headers:{...f.headers,'Idempotency-Key':'one'}});assert.equal(response.status,200);const result=await response.json();assert.equal(result.status,'sent');assert.equal(result.sentCopy.status,'pending');assert.equal(result.sentCopyPacket,undefined);assert.equal(f.store.state.drafts.length,0);assert.ok(f.store.state.sentCopies[0].raw);
  const listing=await(await fetch(f.url+'/api/sent-copies',{headers:f.headers})).json();assert.equal(listing.length,1);assert.equal(listing[0].raw,undefined);
  const duplicate=await fetch(f.url+'/api/drafts/draft/send',{method:'POST',headers:{...f.headers,'Idempotency-Key':'one'}});assert.equal(duplicate.status,200);const different=await fetch(f.url+'/api/drafts/draft/send',{method:'POST',headers:{...f.headers,'Idempotency-Key':'two'}});assert.equal(different.status,404);assert.equal(sends,1);
 }finally{await f.close()}
});

test('a restart recovers accepted saving copies but keeps prepared-only outcomes blocked',async()=>{
 const initial=state();initial.sentCopies=[{id:'accepted',accountId:account.id,draftId:'draft',status:'saving',raw:'private'},{id:'uncertain',accountId:account.id,status:'prepared',raw:'private'}];
 const f=await fixture(async()=>assert.fail('No SMTP allowed during recovery'),initial);
 try{assert.equal(f.store.state.sentCopies[0].status,'pending');assert.equal(f.store.state.drafts.length,0);const r=await fetch(f.url+'/api/sent-copies/uncertain/retry',{method:'POST',headers:f.headers,body:'{}'});assert.equal(r.status,409);}finally{await f.close()}
});


test('copy-only API retry deduplicates concurrent calls, updates Sent locally and removes stored MIME after saving',async()=>{
 const failed=remote({fail:true}),good=remote();let sends=0,saves=0;
 const f=await fixture((s,a,d,callbacks)=>sendMail(s,a,d,{...callbacks,smtpTransportFactory:()=>({sendMail:async()=>{sends++;return {}},close(){}}),imapClientFactory:failed.client}),state(),{sentCopySaver:async(s,a,packet)=>{saves++;await new Promise(r=>setTimeout(r,20));return saveSentCopy(s,a,packet,{imapClientFactory:good.client,wait:async()=>{}})}});
 try{
  const sent=await(await fetch(f.url+'/api/drafts/draft/send',{method:'POST',headers:{...f.headers,'Idempotency-Key':'copy-only'}})).json();
  const retry=()=>fetch(f.url+'/api/sent-copies/'+sent.copyId+'/retry',{method:'POST',headers:f.headers,body:'{}'});
  const responses=await Promise.all([retry(),retry()]);assert.deepEqual(responses.map(r=>r.status),[200,200]);assert.equal(saves,1);assert.equal(sends,1);assert.equal(good.stats().appends,1);
  assert.equal(f.store.state.sentCopies[0].raw,undefined);assert.equal(f.store.state.sendResults['copy-only'].sentCopy.status,'saved');const message=f.store.state.messages.find(m=>m.folder==='sent');assert.equal(message.unread,false);assert.equal(message.attachments[0].filename,'notes.txt');assert.equal(message.providerRef.rfcMessageId,sent.messageId);
  assert.equal((await retry()).status,200);assert.equal(saves,1);
 }finally{await f.close()}
});
