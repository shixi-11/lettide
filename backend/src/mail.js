import {ImapFlow} from 'imapflow';
import nodemailer from 'nodemailer';
import {simpleParser} from 'mailparser';
import MailComposer from 'nodemailer/lib/mail-composer';
import {htmlToText as convertHtmlToText} from 'html-to-text';
import {randomUUID} from 'node:crypto';
import {ImapPool} from './imap-pool.js';
import {refreshToken,renewUnauthorized} from './oauth-session.js';
import {describeParts,readDownload} from './imap-content.js';
import {historyWindow} from './gmail-history.js';
import {saveImapSentCopy,pendingSentCopy,selectSentMailbox} from './sent-copy.js';

const address=(a)=>({name:a?.name||'',address:a?.address||''});
export const messageSummary=m=>({...publicMessage(m),text:(m.text||'').slice(0,240),summary:true});
export const publicMessage=(m)=>({id:m.id,accountId:m.accountId,subject:m.subject,from:m.from,to:m.to,date:m.date,text:m.text,unread:!!m.unread,starred:!!m.starred,...(m.bodyLoaded===false?{bodyLoaded:false}:{}),...(m.folder?{folder:m.folder}:{}),...(m.folderIds||m.folders?{folderIds:[...(m.folderIds||m.folders)]}:{}),...(m.replyTo?{replyTo:m.replyTo}:{}),attachments:(m.attachments||[]).map(({id,filename,size})=>({id,filename,size}))});
export async function testImap(account){const d=defaults(account),c=new ImapFlow({host:d.imap.host,port:d.imap.port,secure:true,auth:{user:account.email,pass:account.password},logger:false,connectionTimeout:10000,socketTimeout:15000,authTimeout:10000});await c.connect();await c.logout();}
export async function testSmtp(account){const d=defaults(account),t=nodemailer.createTransport({host:d.smtp.host,port:d.smtp.port,secure:d.smtp.secure,auth:{user:account.email,pass:account.password},connectionTimeout:10000,socketTimeout:15000});await t.verify();t.close();}
export const htmlBodyToText=(plain,html)=>plain?.trim()?plain:convertHtmlToText(html||'',{wordwrap:false});
export const providerDate=internalDate=>new Date(Number(internalDate)||Date.now()).toISOString();
export async function composeGmailRaw(options){return new Promise((resolve,reject)=>new MailComposer(options).compile().build((error,message)=>error?reject(error):resolve(message.toString('base64url'))));}
function defaults(a){
 if(a.provider==='qq') return {imap:{host:a.imapHost||'imap.qq.com',port:a.imapPort||993,secure:true},smtp:{host:a.smtpHost||'smtp.qq.com',port:a.smtpPort||465,secure:true}};
 if(a.provider==='godaddy') return {imap:{host:a.imapHost||'imap.secureserver.net',port:a.imapPort||993,secure:true},smtp:{host:a.smtpHost||'smtpout.secureserver.net',port:a.smtpPort||465,secure:true}};
 return {imap:{host:a.imapHost,port:a.imapPort||993,secure:true},smtp:{host:a.smtpHost,port:a.smtpPort||465,secure:true}};
}
const roleAliases={inbox:'inbox',sent:'sent',junk:'junk',spam:'junk',trash:'trash',deleted:'trash',archive:'archive',drafts:'drafts'};
const standardId=role=>role;
const encodedId=value=>Buffer.from(String(value)).toString('base64url');
const imapRole=box=>{const use=String(box.specialUse||'').toLowerCase(),path=String(box.path||'').toLowerCase(),name=String(box.name||'').toLowerCase();if(path==='inbox'||use.includes('\\inbox'))return 'inbox';if(use.includes('\\sent')||/^(sent(?: items| messages| mail)?|已发送(?:邮件)?)$/.test(name||path))return 'sent';if(use.includes('\\junk')||use.includes('\\spam')||/junk|spam/.test(`${path} ${name}`))return 'junk';if(use.includes('\\trash')||/trash|deleted items/.test(`${path} ${name}`))return 'trash';if(use.includes('\\archive')||use.includes('\\all')||/archive|all mail/.test(`${path} ${name}`))return 'archive';if(use.includes('\\drafts')||/drafts/.test(`${path} ${name}`))return 'drafts';return 'custom';};
const folderDescriptor=(account,providerId,name,role,provider=account.provider)=>({id:role==='custom'?`${provider}:${encodedId(providerId)}`:standardId(role),name:name||role,role,providerId,...(role==='custom'?{accountId:account.id}:{})});
const uniqueFolders=(rows,account,provider)=>{const seen=new Set();return rows.map(x=>{if(!seen.has(x.id)){seen.add(x.id);return x;}const custom=folderDescriptor(account,x.providerId,x.name,'custom',provider);seen.add(custom.id);return custom;});};
function imapClient(account,deps={}){const d=defaults(account);return (deps.imapClientFactory||((options)=>new ImapFlow(options)))({host:d.imap.host,port:d.imap.port,secure:d.imap.secure,auth:{user:account.email,pass:account.password},logger:false,connectionTimeout:10000,socketTimeout:300000,maxIdleTime:25000,authTimeout:10000});}
const sharedImapPool=new ImapPool();
export const closeMailConnections=accountId=>sharedImapPool.close(accountId);
async function pooledImapClient(account,deps={}){
 if(deps.imapClientFactory&&!deps.imapPool)return imapClient(account,deps);
 const d=defaults(account),pool=deps.imapPool||sharedImapPool;
 const lease=await pool.acquire(account.id,[account.provider,account.email,account.password,d.imap],()=>imapClient(account,deps),deps.priority==='background'?0:10);
 return new Proxy(lease.client,{get(target,key){if(key==='connect')return async()=>{};if(key==='logout')return lease.release;const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
}
export async function listRemoteFolders(state,account,deps={}){
 try {
  if(account.provider==='gmail'){
   const data=await googleRequest(account,state.settings,'/labels',{},{fetchImpl:deps.fetchImpl}),known=new Set(['INBOX','SENT','SPAM','TRASH','DRAFT']),rows=(data.labels||[]).filter(x=>x.type==='user'||known.has(x.id)).map(x=>{const map={INBOX:'inbox',SENT:'sent',SPAM:'junk',TRASH:'trash',DRAFT:'drafts'};const role=map[x.id]||'custom';return folderDescriptor(account,x.id,x.name,role,'gmail');});
   rows.push({id:'archive',name:'已归档',role:'archive'});return uniqueFolders(rows,account,'gmail');
  }
  if(account.provider==='microsoft'){
   await refreshToken(account,state.settings,'microsoft',deps.fetchImpl);
   const aliases={inbox:'inbox',sentitems:'sent',junkemail:'junk',deleteditems:'trash',archive:'archive',drafts:'drafts'},aliasIds=new Map(),aliasFolders=[];
   await Promise.all(Object.entries(aliases).map(async([alias,role])=>{try{const x=await graphRequest(account,`/me/mailFolders/${alias}`,{},{fetchImpl:deps.fetchImpl});if(x?.id){aliasIds.set(x.id,role);aliasFolders.push(x);}}catch{}}));
   const rows=[],visited=new Set(),queue=[];let url='/me/mailFolders?$top=100&includeHiddenFolders=true';
   while(url){const data=await graphRequest(account,url,{},{fetchImpl:deps.fetchImpl});for(const x of data.value||[]){if(visited.has(x.id))continue;visited.add(x.id);const role=aliasIds.get(x.id)||'custom';rows.push(folderDescriptor(account,x.id,x.displayName,role,'graph'));queue.push(x.id);}
    url=data['@odata.nextLink']||null;}
   for(const x of aliasFolders){if(visited.has(x.id))continue;visited.add(x.id);rows.push(folderDescriptor(account,x.id,x.displayName,aliasIds.get(x.id),'graph'));queue.push(x.id);}
   while(queue.length){const parentId=queue.shift();let childUrl=`/me/mailFolders/${encodeURIComponent(parentId)}/childFolders?$top=100&includeHiddenFolders=true`;while(childUrl){const children=await graphRequest(account,childUrl,{},{fetchImpl:deps.fetchImpl});for(const child of children.value||[]){if(visited.has(child.id))continue;visited.add(child.id);rows.push(folderDescriptor(account,child.id,child.displayName,'custom','graph'));queue.push(child.id);}childUrl=children['@odata.nextLink']||null;}}
   return uniqueFolders(rows,account,'graph');
  }
  const c=await pooledImapClient(account,deps);await c.connect();try{const boxes=await c.list(),sent=selectSentMailbox(account,boxes);return uniqueFolders(boxes.map(x=>folderDescriptor(account,x.path,x.name,x.path===sent?.path?'sent':imapRole(x)==='sent'?'custom':imapRole(x),'imap')),account,'imap');}finally{await c.logout().catch(()=>{});}
 }catch(error){throw new Error(`Could not list remote folders: ${error.message}`);}
}
async function folderRows(state,account,deps={}){return account.folders?.length?account.folders:await listRemoteFolders(state,account,deps);}
async function resolveFolder(state,account,folder,deps={}){if(folder&&typeof folder==='object'&&folder.accountId&&folder.accountId!==account.id)throw new Error('Folder does not belong to this account');const raw=String(typeof folder==='object'?(folder.id||''):folder||'inbox'),role=roleAliases[raw.toLowerCase()];if(role){const cached=account.folders?.find(x=>x.role===role);return {id:role,role,folderKey:role,...(cached?.providerId?{providerId:cached.providerId}:{})};}let rows=account.folders||[],known=rows.find(x=>x.id===raw&&(!x.accountId||x.accountId===account.id));if(!known){rows=await listRemoteFolders(state,account,deps);known=rows.find(x=>x.id===raw&&(!x.accountId||x.accountId===account.id));}if(!known)throw new Error('Folder does not belong to this account');return {...known,folderKey:known.id};}
async function imapFetch(a,folder,query,limit=100,deps={}){
 const client=await pooledImapClient(a,deps);
 const out=[]; await client.connect();
 try { const folders=folder.providerId||folder.role==='inbox'?[]:await client.list(),sentBox=selectSentMailbox(a,folders)?.path,draftsBox=folders.find(x=>imapRole(x)==='drafts')?.path;const box=(folder.role==='sent'?a.sentFolder:null)||folder.providerId|| (folder.role==='sent'?(sentBox||'Sent'):folder.role==='drafts'?(draftsBox||'Drafts'):folder.role==='inbox'?'INBOX':folders.find(x=>imapRole(x)===folder.role)?.path);if(!box)throw new Error(`Remote ${folder.role} folder is unavailable`); const lock=await client.getMailboxLock(box); try {
   const total=client.mailbox.exists||0;if(!total)return out;const start=Math.max(1,total-limit+1),uidValidity=String(client.mailbox.uidValidity||'');
   if(deps.metadataOnly){
    const cached=new Map((deps.cachedMessages||[]).filter(m=>m.accountId===a.id&&m.providerRef?.folder===box&&m.providerRef.uidValidity===uidValidity).map(m=>[m.providerRef.uid,m]));
    for await(const msg of client.fetch(`${start}:${total}`,{uid:true,flags:true,envelope:true,size:true,bodyStructure:true})){
     const old=cached.get(msg.uid),e=msg.envelope||{},id=`${a.id}:imap:${box}:${msg.uid}`;
     out.push({...old,id,accountId:a.id,providerRef:{...old?.providerRef,type:'imap',folder:box,uid:msg.uid,uidValidity,...(msg.bodyStructure?{bodyStructure:msg.bodyStructure}:{}),rfcMessageId:old?.providerRef?.rfcMessageId||e.messageId||null},subject:old?.subject??e.subject??'',from:old?.from||address(e.from?.[0]),to:old?.to||(e.to||[]).map(address),date:old?.date||(e.date||new Date()).toISOString(),size:msg.size||old?.size,text:old?.text||'',attachments:old?.attachments||[],bodyLoaded:old?old.bodyLoaded!==false:false,unread:!msg.flags.has('\\Seen'),starred:msg.flags.has('\\Flagged')});
    }return out;
   }
   for await (const msg of client.fetch(`${start}:${total}`,{uid:true,flags:true,envelope:true,source:true,bodyStructure:true})) {
     const p=await simpleParser(msg.source); const subject=p.subject||''; if(query&&!subject.toLowerCase().includes(query.toLowerCase())&&!p.text?.toLowerCase().includes(query.toLowerCase())) continue;
     const id=`${a.id}:imap:${box}:${msg.uid}`; const attachments=(p.attachments||[]).map((x,i)=>({id:`${id}:att:${i}`,filename:x.filename||'attachment',size:x.size,content:x.content.toString('base64')}));
     out.push({id,accountId:a.id,providerRef:{type:'imap',folder:box,uid:msg.uid,uidValidity,rfcMessageId:p.messageId||null,references:p.references||[]},subject,from:address(p.from?.value?.[0]),to:(p.to?.value||[]).map(address),...(p.replyTo?.value?.length?{replyTo:p.replyTo.value.map(address)}:{}),date:(p.date||msg.envelope?.date||new Date()).toISOString(),text:htmlBodyToText(p.text,typeof p.html==='string'?p.html:''),unread:!msg.flags.has('\\Seen'),starred:msg.flags.has('\\Flagged'),attachments});
   }
 } finally {lock.release();} } finally {await client.logout().catch(()=>{});} return out;
}
export async function loadMessageBody(state,message,deps={}){
 if(message.bodyLoaded!==false)return message;
 const account=state.accounts.find(a=>a.id===message.accountId);if(!account)throw new Error('Account unavailable');
 if(message.providerRef?.type==='gmail'){const m=await googleRequest(account,state.settings,`/messages/${message.providerRef.id}?format=full`,{},deps);const content=await gmailContent(account,m,state.settings,deps);Object.assign(message,content);return message;}
 if(message.providerRef?.type==='graph'){
  await refreshToken(account,state.settings,'microsoft',deps.fetchImpl||fetch);
  const id=encodeURIComponent(message.providerRef.id),m=await graphRequest(account,'/me/messages/'+id+'?$select=body,hasAttachments',{},deps);
  const attachments=m.hasAttachments?(await graphRequest(account,'/me/messages/'+id+'/attachments?$select=id,name,size',{},deps)).value||[]:[];
  Object.assign(message,{text:htmlBodyToText(m.body?.contentType==='text'?m.body.content:'',m.body?.contentType==='html'?m.body.content:''),bodyLoaded:true,attachments:attachments.map(a=>({id:message.id+':att:'+a.id,filename:a.name||'attachment',size:a.size||0,remotePart:a.id}))});return message;
 }
 if(message.providerRef?.type!=='imap')return message;
 const client=await pooledImapClient(account,deps);await client.connect();try{const lock=await client.getMailboxLock(message.providerRef.folder);try{
  if(String(client.mailbox.uidValidity||'')!==message.providerRef.uidValidity)throw new Error('Message UID validity changed');
  if(typeof client.download==='function'){
   const row=message.providerRef.bodyStructure?{bodyStructure:message.providerRef.bodyStructure}:await client.fetchOne(message.providerRef.uid,{bodyStructure:true},{uid:true});
   if(!row)throw new Error('Message no longer available');
   if(row.bodyStructure){
    const parts=describeParts(row.bodyStructure,message.id),chosen=parts.text.find(p=>p.type==='text/plain')||parts.text.find(p=>p.type==='text/html');
    let text='';if(chosen){const max=2*1024*1024;if(chosen.size>max)throw new Error('Email body is too large to display');const download=await client.download(message.providerRef.uid,chosen.part,{uid:true,maxBytes:max});const bytes=await readDownload(download,max);text=bytes.toString('utf8');if(chosen.type==='text/html')text=htmlBodyToText('',text);}
    Object.assign(message,{text,attachments:parts.attachments,bodyLoaded:true});return message;
   }
  }
  const row=await client.fetchOne(message.providerRef.uid,{source:true},{uid:true});if(!row?.source)throw new Error('Message no longer available');
  const p=await simpleParser(row.source);Object.assign(message,{subject:p.subject||message.subject,from:address(p.from?.value?.[0]),to:(p.to?.value||[]).map(address),...(p.replyTo?.value?.length?{replyTo:p.replyTo.value.map(address)}:{}),text:htmlBodyToText(p.text,typeof p.html==='string'?p.html:''),attachments:(p.attachments||[]).map((x,i)=>({id:`${message.id}:att:${i}`,filename:x.filename||'attachment',size:x.size,content:x.content.toString('base64')})),bodyLoaded:true});
  Object.assign(message.providerRef,{rfcMessageId:p.messageId||null,references:p.references||[]});return message;
 }finally{lock.release()}}finally{await client.logout().catch(()=>{})}
}
async function graphRequest(a,path,init={},deps={}){
 const fetchImpl=deps.fetchImpl||fetch,send=()=>fetchImpl(/^https:\/\//i.test(path)?path:'https://graph.microsoft.com/v1.0'+path,{...init,signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+a.accessToken,Prefer:'IdType="ImmutableId"',...(init.headers||{})}});
 let response=await send();
 if(response.status===401&&(!init.method||init.method==='GET')){await renewUnauthorized(a,fetchImpl);response=await send();}
 if(!response.ok){const error=new Error('Microsoft Graph request failed ('+response.status+')');if(response.status===401||response.status===403)error.code='AUTH_REQUIRED';throw error;}
 return [202,204].includes(response.status)?null:response.json();
}
async function googleRequest(a,s,path,init={},deps={}){
 const fetchImpl=deps.fetchImpl||fetch;await refreshToken(a,s,'gmail',fetchImpl);
 const send=()=>fetchImpl('https://gmail.googleapis.com/gmail/v1/users/me'+path,{...init,signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+a.accessToken,...(init.headers||{})}});
 let response=await send();if(response.status===401&&(!init.method||init.method==='GET')){await renewUnauthorized(a,fetchImpl);response=await send();}
 if(!response.ok){const error=new Error('Gmail API request failed ('+response.status+')');error.status=response.status;if(response.status===401||response.status===403)error.code='AUTH_REQUIRED';throw error;}
 return response.json();
}

function decode64(s=''){return Buffer.from(s.replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('utf8');}
function decodeBuffer(s=''){return Buffer.from(s.replace(/-/g,'+').replace(/_/g,'/'),'base64');}
export function googleHeaders(payload,internalDate){const h=payload.headers||[]; const get=n=>h.find(x=>x.name.toLowerCase()===n)?.value||''; const parsed=(v)=>{const m=v.match(/^(.*?)\s*<([^>]+)>$/);return m?{name:m[1].replace(/^"|"$/g,''),address:m[2]}:{name:'',address:v};},replyTo=get('reply-to').split(/,\s*/).filter(Boolean).map(parsed);return {subject:get('subject'),from:parsed(get('from')),to:get('to').split(/,\s*/).filter(Boolean).map(parsed),...(replyTo.length?{replyTo}:{}),date:providerDate(internalDate)};}
async function mapConcurrent(items,limit,fn){
 const out=new Array(items.length);let next=0;
 await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(next<items.length){const index=next++;out[index]=await fn(items[index]);}}));return out;
}
async function gmailContent(a,m,settings,deps={}){
 const payload=m.payload||{},parts=[],attachmentParts=[];
 function walk(p){if(p.parts)p.parts.forEach(walk);if(p.body?.data)parts.push({mime:p.mimeType,data:decode64(p.body.data)});if(p.body?.attachmentId)attachmentParts.push({id:p.body.attachmentId,filename:p.filename||'attachment',size:p.body.size||0});}walk(payload);
 const pick=t=>parts.find(p=>p.mime===t)?.data||'',id=`${a.id}:gmail:${m.id}`;
 const attachments=attachmentParts.map(part=>({id:`${id}:att:${part.id}`,filename:part.filename,size:part.size,remotePart:part.id}));
 return {text:htmlBodyToText(pick('text/plain'),pick('text/html')),attachments:attachments.filter(Boolean),bodyLoaded:true};
}
async function gmailFetch(a,folder,query,limit,settings,deps={}){
 const cached=new Map((deps.cachedMessages||[]).filter(m=>m.accountId===a.id).map(m=>[m.id,m]));
 const history=deps.metadataOnly&&!query?await historyWindow(a,folder.folderKey,path=>googleRequest(a,settings,path,{},deps)):null;
 if(history&&!history.changed){(a.gmailHistory||={})[folder.folderKey]=history.cursor;const rows=[...cached.values()].filter(m=>(m.folderIds||m.folders||[m.folder||'inbox']).includes(folder.folderKey));rows.unchanged=true;return rows;}
 const url=new URLSearchParams({maxResults:String(Math.min(limit,100))});
 if(folder.role==='archive')url.set('q',['-in:inbox','-in:sent','-in:drafts','-in:trash','-in:spam',query||''].filter(Boolean).join(' '));
 else{const label=folder.providerId||({inbox:'INBOX',sent:'SENT',drafts:'DRAFT',junk:'SPAM',trash:'TRASH'}[folder.role]);if(label)url.append('labelIds',label);if(query)url.set('q',query);}
 const list=await googleRequest(a,settings,`/messages?${url}`,{},deps),refs=[...(list.messages||[])],seen=new Set(refs.map(m=>m.id)),removed=new Set(history?.deleted||[]);
 for(const id of history?.ids||[])if(!seen.has(id)&&cached.has(a.id+':gmail:'+id)&&!removed.has(id)){refs.push({id});seen.add(id);}
 const result=await mapConcurrent(refs,4,async ref=>{
  if(removed.has(ref.id))return null;
  const params=new URLSearchParams({format:deps.metadataOnly?'metadata':'full'});
  if(deps.metadataOnly)for(const header of ['From','To','Subject','Date','Reply-To','Message-ID','References'])params.append('metadataHeaders',header);
  let m;try{m=await googleRequest(a,settings,`/messages/${ref.id}?${params}`,{},deps)}catch(error){if(error.status===404){removed.add(ref.id);return null;}throw error;}const payload=m.payload||{},h=googleHeaders(payload,m.internalDate),id=`${a.id}:gmail:${m.id}`,old=cached.get(id);
  const content=deps.metadataOnly?{text:old?.bodyLoaded!==false&&old?old.text||'':m.snippet||'',attachments:old?.attachments||[],bodyLoaded:!!old&&old.bodyLoaded!==false}:await gmailContent(a,m,settings,deps);
  const msgId=(payload.headers||[]).find(x=>x.name.toLowerCase()==='message-id')?.value||null,refs=(payload.headers||[]).find(x=>x.name.toLowerCase()==='references')?.value||'';
  return {id,accountId:a.id,providerRef:{type:'gmail',id:m.id,labelIds:m.labelIds||[],threadId:m.threadId,rfcMessageId:msgId,references:refs},...h,...content,unread:(m.labelIds||[]).includes('UNREAD'),starred:(m.labelIds||[]).includes('STARRED')};
 });
 if(history?.cursor)(a.gmailHistory||={})[folder.folderKey]=history.cursor;
 const label=folder.providerId||({inbox:'INBOX',sent:'SENT',drafts:'DRAFT',junk:'SPAM',trash:'TRASH'}[folder.role]);
 const rows=result.filter(Boolean).filter(m=>{const labels=m.providerRef.labelIds||[],belongs=folder.role==='archive'?!labels.some(id=>['INBOX','SENT','DRAFT','TRASH','SPAM'].includes(id)):!label||labels.includes(label);if(!belongs)removed.add(m.providerRef.id);return belongs;});rows.removedIds=removed;return rows;
}
async function graphFetch(a,folder,query,limit,settings,deps={}){
 await refreshToken(a,settings,'microsoft',deps.fetchImpl||fetch);
 const f=folder.providerId||({sent:'sentitems',drafts:'drafts',inbox:'inbox',junk:'junkemail',trash:'deleteditems',archive:'archive'}[folder.role]||'inbox');
 const q=new URLSearchParams({$top:String(Math.min(limit,100)),$orderby:'receivedDateTime desc',$select:'id,internetMessageId,subject,from,toRecipients,replyTo,receivedDateTime,'+(deps.metadataOnly?'bodyPreview':'body')+',isRead,flag,hasAttachments'});if(query)q.set('$search',String.fromCharCode(34)+query+String.fromCharCode(34));
 const r=await graphRequest(a,'/me/mailFolders/'+encodeURIComponent(f)+'/messages?'+q,{},deps),cached=new Map((deps.cachedMessages||[]).map(m=>[m.id,m]));
 return (r.value||[]).map(m=>{const id=a.id+':graph:'+m.id,old=cached.get(id);return {id,accountId:a.id,providerRef:{type:'graph',id:m.id,folder:f,rfcMessageId:m.internetMessageId||null},subject:m.subject||'',from:address(m.from?.emailAddress),to:(m.toRecipients||[]).map(x=>address(x.emailAddress)),...(m.replyTo?.length?{replyTo:m.replyTo.map(x=>address(x.emailAddress))}:{}),date:m.receivedDateTime,text:deps.metadataOnly?(old?.bodyLoaded!==false&&old?old.text||'':m.bodyPreview||''):htmlBodyToText(m.body?.contentType==='text'?m.body.content:'',m.body?.contentType==='html'?m.body.content:''),bodyLoaded:deps.metadataOnly?!!old&&old.bodyLoaded!==false:false,unread:!m.isRead,starred:m.flag?.flagStatus==='flagged',attachments:old?.attachments||[]};});
}
export async function syncAccount(state,account,folder='inbox',query='',limit=100,deps={}){const target=await resolveFolder(state,account,folder,deps),key=target.folderKey,fresh=account.provider==='microsoft'?await graphFetch(account,target,query,limit,state.settings,{...deps,cachedMessages:state.messages}):account.provider==='gmail'?await gmailFetch(account,target,query,limit,state.settings,{...deps,cachedMessages:state.messages}):await imapFetch(account,target,query,limit,{...deps,cachedMessages:state.messages});if(fresh.unchanged){account.lastSync=new Date().toISOString();return fresh;}state.messages=state.messages.filter(m=>!(m.accountId===account.id&&m.providerRef?.type==='sent-copy'&&fresh.some(remote=>remote.providerRef?.rfcMessageId&&remote.providerRef.rfcMessageId===m.providerRef.rfcMessageId)));const accountRows=account.provider==='gmail'?await folderRows(state,account,deps):[];const labelFolders=new Map(accountRows.filter(x=>x.providerId).map(x=>[x.providerId,x.id]));for(const existing of state.messages.filter(x=>x.accountId===account.id)){const prior=existing.folderIds||existing.folders||[existing.folder||'inbox'];const pending=(existing.sentCopyPending||existing.providerPendingUntil>Date.now())&&!fresh.some(m=>m.id===existing.id),oldWindow=fresh.length>=limit&&Date.parse(existing.date)<Math.min(...fresh.map(m=>Date.parse(m.date)).filter(Number.isFinite));existing.folderIds=pending||oldWindow&&!fresh.removedIds?.has(existing.providerRef?.id)?prior:prior.filter(x=>x!==key);existing.folders=existing.folderIds;}
 for(const m of fresh){m.providerPendingUntil=null;const old=state.messages.find(x=>x.id===m.id);let memberships=[key];if(m.providerRef?.type==='gmail'){memberships=(m.providerRef.labelIds||[]).map(id=>labelFolders.get(id)).filter(Boolean);if(!(m.providerRef.labelIds||[]).some(id=>['INBOX','SENT','DRAFT','TRASH','SPAM'].includes(id)))memberships.push('archive');if(target.role==='custom'||target.role==='archive')memberships.push(key);}else if(old)memberships=[...new Set([...memberships,...(old.folderIds||old.folders||[])])];m.folder=old?.folder||key;m.folderIds=[...new Set(memberships)];m.folders=m.folderIds;if(old)Object.assign(old,m);else state.messages.push(m);}
 state.messages=state.messages.filter(m=>m.accountId!==account.id||m.folderIds?.length);account.lastSync=new Date().toISOString();return fresh;}
export async function updateRemote(state,m,patch,deps={}){
 const a=state.accounts.find(x=>x.id===m.accountId);if(!a)throw new Error('Account not found');if(m.providerRef?.type==='sent-copy')throw Object.assign(new Error('Sent copy is still being saved. Try again shortly.'),{code:'COPY_PENDING'});let folderTarget;
 if(m.providerRef?.type==='imap'){
  if(!Number.isInteger(m.providerRef.uid))throw new Error('Message UID unavailable; sync its folder before changing it');
  let target,destination;
  if(patch.folder){
   const rows=await folderRows(state,a,deps);a.folders=rows;
   target=folderTarget=await resolveFolder(state,a,patch.folder,deps);
   destination=target.providerId||rows.find(x=>x.role===target.role)?.providerId;
   if(!destination)throw new Error('Remote destination folder is unavailable');
  }
  const c=await pooledImapClient(a,deps);await c.connect();
  try{const lock=await c.getMailboxLock(m.providerRef.folder);try{
   const currentValidity=String(c.mailbox.uidValidity||'');if(m.providerRef.uidValidity&&currentValidity!==m.providerRef.uidValidity)throw new Error('Message UID validity changed');
   if(patch.unread!==undefined)await (patch.unread?c.messageFlagsRemove(m.providerRef.uid,['\\Seen'],{uid:true}):c.messageFlagsAdd(m.providerRef.uid,['\\Seen'],{uid:true}));
   if(patch.starred!==undefined)await (patch.starred?c.messageFlagsAdd(m.providerRef.uid,['\\Flagged'],{uid:true}):c.messageFlagsRemove(m.providerRef.uid,['\\Flagged'],{uid:true}));
   if(patch.folder){const oldUid=m.providerRef.uid,moved=await c.messageMove(oldUid,destination,{uid:true});m.providerRef.uid=moved?.uidMap?.get?.(oldUid)||null;m.providerRef.uidValidity=moved?.uidValidity?String(moved.uidValidity):'';m.providerRef.folder=destination;if(m.providerRef.uid===null){const index=state.messages.findIndex(x=>x.id===m.id);if(index>=0)state.messages.splice(index,1);}}
  }finally{lock.release();}}finally{await c.logout().catch(()=>{});}
 }
  if(m.providerRef?.type==='graph'){
   await refreshToken(a,state.settings,'microsoft',deps.fetchImpl||fetch);let destination;
   if(patch.folder){folderTarget=await resolveFolder(state,a,patch.folder,deps);destination=folderTarget.providerId||({inbox:'inbox',sent:'sentitems',drafts:'drafts',junk:'junkemail',trash:'deleteditems',archive:'archive'}[folderTarget.role]||folderTarget.role);}
   const data={};if(patch.unread!==undefined)data.isRead=!patch.unread;if(patch.starred!==undefined)data.flag={flagStatus:patch.starred?'flagged':'notFlagged'};
   if(Object.keys(data).length)await graphRequest(a,`/me/messages/${m.providerRef.id}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(data)},deps);
   if(patch.folder){const moved=await graphRequest(a,`/me/messages/${m.providerRef.id}/move`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({destinationId:destination})},deps);m.providerRef.id=moved.id;m.id=`${a.id}:graph:${moved.id}`;m.folder=folderTarget.folderKey;}
  }
  if(m.providerRef?.type==='gmail'){
   const addLabelIds=[],removeLabelIds=[];let target,rows;
   for(const [key,label]of [['unread','UNREAD'],['starred','STARRED']])if(patch[key]!==undefined){const present=(m.providerRef.labelIds||[]).includes(label);if(patch[key]&&!present)addLabelIds.push(label);if(!patch[key]&&present)removeLabelIds.push(label);}
   if(patch.folder){rows=await folderRows(state,a,deps);a.folders=rows;target=folderTarget=await resolveFolder(state,a,patch.folder,deps);if(target.role==='inbox'){addLabelIds.push('INBOX');removeLabelIds.push('SPAM','TRASH');}else if(target.role==='trash'){addLabelIds.push('TRASH');removeLabelIds.push('INBOX','SPAM');}else if(target.role==='junk'){addLabelIds.push('SPAM');removeLabelIds.push('INBOX','TRASH');}else if(target.role==='archive'){removeLabelIds.push('INBOX','SPAM','TRASH');}else if(target.role==='custom'){addLabelIds.push(target.providerId);removeLabelIds.push('INBOX','SPAM','TRASH');}else if(target.role==='sent'||target.role==='drafts')throw new Error('Cannot move a message into this system folder');}
   await googleRequest(a,state.settings,`/messages/${m.providerRef.id}/modify`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({addLabelIds:[...new Set(addLabelIds)],removeLabelIds:[...new Set(removeLabelIds)]})},deps);
   m.providerRef.labelIds=[...new Set([...(m.providerRef.labelIds||[]).filter(x=>!removeLabelIds.includes(x)),...addLabelIds])];
   if(patch.folder){m.folder=target.folderKey;const labels=m.providerRef.labelIds,roles={INBOX:'inbox',SENT:'sent',DRAFT:'drafts',SPAM:'junk',TRASH:'trash'},custom=new Map(rows.filter(x=>x.role==='custom').map(x=>[x.providerId,x.id]));m.folderIds=[...new Set([...labels.map(x=>roles[x]||custom.get(x)).filter(Boolean),...(labels.some(x=>['INBOX','SENT','DRAFT','SPAM','TRASH'].includes(x))?[]:['archive'])])];m.folders=m.folderIds;}
  }
  if(patch.folder&&m.providerRef?.type!=='gmail'){m.folder=folderTarget.folderKey;m.folderIds=[folderTarget.folderKey];m.folders=m.folderIds;}
  Object.assign(m,{...patch,...(patch.folder?{folder:m.folder}:{})});
}
const sendAttachments=items=>(items||[]).map(x=>({filename:x.filename||'attachment',content:Buffer.from(String(x.content||''),'base64'),...(x.contentType?{contentType:x.contentType}:{})}));
const graphAttachment=x=>({'@odata.type':'#microsoft.graph.fileAttachment',name:x.filename,contentType:x.contentType||'application/octet-stream',contentBytes:x.content.toString('base64')});
export async function saveSentCopy(state,account,packet,deps={}){
 return saveImapSentCopy(account,packet,{...deps,clientFactory:()=>imapClient(account,deps)});
}
export async function sendMail(state,account,draft,deps={}){const source=draft.replyToMessageId?state.messages.find(m=>m.id===draft.replyToMessageId):null,replyId=source?.providerRef?.rfcMessageId||undefined,attachments=sendAttachments(draft.attachments);
 if(account.provider==='microsoft') {await refreshToken(account,state.settings,'microsoft',deps.fetchImpl||fetch);const message={subject:draft.subject,body:{contentType:draft.html?'HTML':'Text',content:draft.html||draft.text},toRecipients:String(draft.to).split(',').map(address=>({emailAddress:{address:address.trim()}})),...(draft.cc?{ccRecipients:String(draft.cc).split(',').map(x=>({emailAddress:{address:x.trim()}}))}:{}),...(draft.bcc?{bccRecipients:String(draft.bcc).split(',').map(x=>({emailAddress:{address:x.trim()}}))}:{}),...(attachments.length?{attachments:attachments.map(graphAttachment)}:{})};let sentId;if(source?.providerRef?.type==='graph'){const reply=await graphRequest(account,`/me/messages/${source.providerRef.id}/createReply`,{method:'POST'},{fetchImpl:deps.fetchImpl}),{attachments:graphAttachments,...replyMessage}=message;await graphRequest(account,`/me/messages/${reply.id}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(replyMessage)},{fetchImpl:deps.fetchImpl});for(const attachment of graphAttachments||[])await graphRequest(account,`/me/messages/${reply.id}/attachments`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(attachment)},{fetchImpl:deps.fetchImpl});sentId=reply.id;await deps.onProviderPrepared?.({provider:'microsoft',providerDraftId:sentId});await graphRequest(account,`/me/messages/${reply.id}/send`,{method:'POST'},{fetchImpl:deps.fetchImpl});}else{const prepared=await graphRequest(account,'/me/messages',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(message)},{fetchImpl:deps.fetchImpl});if(!prepared?.id)throw new Error('Microsoft draft preparation failed');sentId=prepared.id;await deps.onProviderPrepared?.({provider:'microsoft',providerDraftId:sentId});await graphRequest(account,'/me/messages/'+encodeURIComponent(sentId)+'/send',{method:'POST'},{fetchImpl:deps.fetchImpl});}return {messageId:sentId};}
 if(account.provider==='gmail') {await refreshToken(account,state.settings,'gmail',deps.fetchImpl||fetch);const raw=await composeGmailRaw({from:account.email,to:draft.to,cc:draft.cc||undefined,bcc:draft.bcc||undefined,subject:draft.subject,text:draft.text||undefined,html:draft.html||undefined,attachments,inReplyTo:replyId,references:source?.providerRef?.references?[source.providerRef.references,replyId].filter(Boolean).join(' '):replyId});const r=await (deps.fetchImpl||fetch)('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{Authorization:`Bearer ${account.accessToken}`,'content-type':'application/json'},body:JSON.stringify({raw,...(source?.providerRef?.type==='gmail'&&source.providerRef.threadId?{threadId:source.providerRef.threadId}:{})}),signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error('Gmail send failed');return {messageId:(await r.json()).id||null};}
 const smtp=defaults(account).smtp,transport=(deps.smtpTransportFactory||nodemailer.createTransport)({host:smtp.host,port:smtp.port,secure:smtp.secure,auth:{user:account.email,pass:account.password},connectionTimeout:10000,socketTimeout:15000});
 const mail={from:account.email,to:draft.to,cc:draft.cc||undefined,bcc:draft.bcc||undefined,subject:draft.subject,text:draft.text,html:draft.html||undefined,inReplyTo:replyId,references:[...(Array.isArray(source?.providerRef?.references)?source.providerRef.references:[source?.providerRef?.references]),replyId].filter(Boolean).join(' ')||undefined,attachments,messageId:`<${randomUUID()}@${account.email.split('@')[1]}>`,date:new Date()};
 try{
  const mime=new MailComposer(mail).compile();mime.keepBcc=true;const raw=await new Promise((resolve,reject)=>mime.build((e,b)=>e?reject(e):resolve(b)));
  const packet={raw:raw.toString('base64'),messageId:mail.messageId,date:mail.date.toISOString()};
  // Persist the exact MIME before SMTP, so an interrupted send keeps its identity.
  await deps.onPrepared?.(packet);
  const boundary=raw.indexOf('\r\n\r\n'),headers=raw.subarray(0,boundary).toString('latin1').split(/\r\n(?=[^ \t])/).filter(h=>!/^bcc:/i.test(h)).join('\r\n');
  const wire=Buffer.concat([Buffer.from(headers,'latin1'),raw.subarray(boundary)]);
  const info=await transport.sendMail({...mail,raw:wire,envelope:mime.getEnvelope()});
  // From this point, only copy storage may be retried. SMTP must never be replayed.
  let sentCopy=pendingSentCopy();
  try{await deps.onAccepted?.(packet);sentCopy=await saveSentCopy(state,account,packet,deps);}catch{}
  return {...info,messageId:packet.messageId,sentCopy,...(sentCopy.status==='pending'?{sentCopyPacket:packet}:{})};
 }finally{transport.close?.();}
}

export async function loadAttachment(state,message,attachment,deps={}){
 const account=state.accounts.find(a=>a.id===message.accountId);if(!account||!attachment.remotePart)throw new Error('Attachment unavailable');
 if(message.providerRef?.type==='gmail'){const part=await googleRequest(account,state.settings,'/messages/'+encodeURIComponent(message.providerRef.id)+'/attachments/'+encodeURIComponent(attachment.remotePart),{},deps);return decodeBuffer(part.data);}
 if(message.providerRef?.type==='graph'){await refreshToken(account,state.settings,'microsoft',deps.fetchImpl||fetch);const part=await graphRequest(account,'/me/messages/'+encodeURIComponent(message.providerRef.id)+'/attachments/'+encodeURIComponent(attachment.remotePart),{},deps);return Buffer.from(part.contentBytes||'','base64');}
 if(message.providerRef?.type!=='imap')throw new Error('Attachment unavailable');
 const client=await pooledImapClient(account,deps);await client.connect();try{const lock=await client.getMailboxLock(message.providerRef.folder);try{if(String(client.mailbox.uidValidity||'')!==message.providerRef.uidValidity)throw new Error('Message UID validity changed');return await readDownload(await client.download(message.providerRef.uid,attachment.remotePart,{uid:true,maxBytes:25*1024*1024}),25*1024*1024);}finally{lock.release()}}finally{await client.logout().catch(()=>{})}
}

export async function inspectProviderSend(state,account,providerDraftId,deps={}){
 if(account.provider!=='microsoft')throw new Error('Provider send receipt unavailable');
 await refreshToken(account,state.settings,'microsoft',deps.fetchImpl||fetch);
 const message=await graphRequest(account,'/me/messages/'+encodeURIComponent(providerDraftId)+'?$select=id,isDraft,sentDateTime',{},deps);
 // An eventually-consistent draft is never proof that send was not accepted.
 return {status:message?.isDraft===false&&message?.sentDateTime?'sent':'outcome_unknown',messageId:message?.id||providerDraftId,...(message?.sentDateTime?{sentDateTime:message.sentDateTime}:{})};
}
