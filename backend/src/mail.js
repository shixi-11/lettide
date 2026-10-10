import {ImapFlow} from 'imapflow';
import nodemailer from 'nodemailer';
import {simpleParser} from 'mailparser';
import MailComposer from 'nodemailer/lib/mail-composer';
import {htmlToText as convertHtmlToText} from 'html-to-text';

const address=(a)=>({name:a?.name||'',address:a?.address||''});
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
const imapRole=box=>{const use=String(box.specialUse||'').toLowerCase(),path=String(box.path||'').toLowerCase(),name=String(box.name||'').toLowerCase();if(path==='inbox'||use.includes('\\inbox'))return 'inbox';if(use.includes('\\sent')||path==='sent'||path==='sent items')return 'sent';if(use.includes('\\junk')||use.includes('\\spam')||/junk|spam/.test(`${path} ${name}`))return 'junk';if(use.includes('\\trash')||/trash|deleted items/.test(`${path} ${name}`))return 'trash';if(use.includes('\\archive')||use.includes('\\all')||/archive|all mail/.test(`${path} ${name}`))return 'archive';if(use.includes('\\drafts')||/drafts/.test(`${path} ${name}`))return 'drafts';return 'custom';};
const folderDescriptor=(account,providerId,name,role,provider=account.provider)=>({id:role==='custom'?`${provider}:${encodedId(providerId)}`:standardId(role),name:name||role,role,providerId,...(role==='custom'?{accountId:account.id}:{})});
const uniqueFolders=(rows,account,provider)=>{const seen=new Set();return rows.map(x=>{if(!seen.has(x.id)){seen.add(x.id);return x;}const custom=folderDescriptor(account,x.providerId,x.name,'custom',provider);seen.add(custom.id);return custom;});};
function imapClient(account,deps={}){const d=defaults(account);return (deps.imapClientFactory||((options)=>new ImapFlow(options)))({host:d.imap.host,port:d.imap.port,secure:d.imap.secure,auth:{user:account.email,pass:account.password},logger:false,connectionTimeout:10000,socketTimeout:15000,authTimeout:10000});}
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
  const c=imapClient(account,deps);await c.connect();try{return uniqueFolders((await c.list()).map(x=>folderDescriptor(account,x.path,x.name,imapRole(x),'imap')),account,'imap');}finally{await c.logout().catch(()=>{});}
 }catch(error){throw new Error(`Could not list remote folders: ${error.message}`);}
}
async function folderRows(state,account,deps={}){return account.folders?.length?account.folders:await listRemoteFolders(state,account,deps);}
async function resolveFolder(state,account,folder,deps={}){if(folder&&typeof folder==='object'&&folder.accountId&&folder.accountId!==account.id)throw new Error('Folder does not belong to this account');const raw=String(typeof folder==='object'?(folder.id||''):folder||'inbox'),role=roleAliases[raw.toLowerCase()];if(role){const cached=account.folders?.find(x=>x.role===role);return {id:role,role,folderKey:role,...(cached?.providerId?{providerId:cached.providerId}:{})};}let rows=account.folders||[],known=rows.find(x=>x.id===raw&&(!x.accountId||x.accountId===account.id));if(!known){rows=await listRemoteFolders(state,account,deps);known=rows.find(x=>x.id===raw&&(!x.accountId||x.accountId===account.id));}if(!known)throw new Error('Folder does not belong to this account');return {...known,folderKey:known.id};}
async function imapFetch(a,folder,query,limit=100,deps={}){
 const client=imapClient(a,deps);
 const out=[]; await client.connect();
 try { const folders=folder.providerId||folder.role==='inbox'?[]:await client.list(),sentBox=folders.find(x=>imapRole(x)==='sent')?.path,draftsBox=folders.find(x=>imapRole(x)==='drafts')?.path;const box=folder.providerId|| (folder.role==='sent'?(a.sentFolder||sentBox||'Sent'):folder.role==='drafts'?(draftsBox||'Drafts'):folder.role==='inbox'?'INBOX':folders.find(x=>imapRole(x)===folder.role)?.path);if(!box)throw new Error(`Remote ${folder.role} folder is unavailable`); const lock=await client.getMailboxLock(box); try {
   const total=client.mailbox.exists||0;if(!total)return out;const start=Math.max(1,total-limit+1),uidValidity=String(client.mailbox.uidValidity||'');
   if(deps.metadataOnly){
    const cached=new Map((deps.cachedMessages||[]).filter(m=>m.accountId===a.id&&m.providerRef?.folder===box&&m.providerRef.uidValidity===uidValidity).map(m=>[m.providerRef.uid,m]));
    for await(const msg of client.fetch(`${start}:${total}`,{uid:true,flags:true,envelope:true})){
     const old=cached.get(msg.uid),e=msg.envelope||{},id=`${a.id}:imap:${box}:${msg.uid}`;
     out.push({...old,id,accountId:a.id,providerRef:{...old?.providerRef,type:'imap',folder:box,uid:msg.uid,uidValidity,rfcMessageId:old?.providerRef?.rfcMessageId||e.messageId||null},subject:old?.subject??e.subject??'',from:old?.from||address(e.from?.[0]),to:old?.to||(e.to||[]).map(address),date:old?.date||(e.date||new Date()).toISOString(),text:old?.text||'',attachments:old?.attachments||[],bodyLoaded:old?old.bodyLoaded!==false:false,unread:!msg.flags.has('\\Seen'),starred:msg.flags.has('\\Flagged')});
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
 if(message.providerRef?.type!=='imap')return message;
 const client=imapClient(account,deps);await client.connect();try{const lock=await client.getMailboxLock(message.providerRef.folder);try{
  if(String(client.mailbox.uidValidity||'')!==message.providerRef.uidValidity)throw new Error('Message UID validity changed');
  const row=await client.fetchOne(message.providerRef.uid,{source:true},{uid:true});if(!row?.source)throw new Error('Message no longer available');
  const p=await simpleParser(row.source);Object.assign(message,{subject:p.subject||message.subject,from:address(p.from?.value?.[0]),to:(p.to?.value||[]).map(address),...(p.replyTo?.value?.length?{replyTo:p.replyTo.value.map(address)}:{}),text:htmlBodyToText(p.text,typeof p.html==='string'?p.html:''),attachments:(p.attachments||[]).map((x,i)=>({id:`${message.id}:att:${i}`,filename:x.filename||'attachment',size:x.size,content:x.content.toString('base64')})),bodyLoaded:true});
  Object.assign(message.providerRef,{rfcMessageId:p.messageId||null,references:p.references||[]});return message;
 }finally{lock.release()}}finally{await client.logout().catch(()=>{})}
}
async function graphRequest(a,path,init={},deps={}){ const r=await (deps.fetchImpl||fetch)(/^https:\/\//i.test(path)?path:`https://graph.microsoft.com/v1.0${path}`,{...init,signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${a.accessToken}`,...(init.headers||{})}}); if(!r.ok) throw new Error(`Microsoft Graph request failed (${r.status})`); return [202,204].includes(r.status)?null:r.json(); }
async function refreshToken(a,s,provider,fetchImpl=fetch){ if(Date.now()<=(a.expiresAt||0)-60000) return a; const cfg=provider==='gmail'?{url:'https://oauth2.googleapis.com/token',clientId:s.googleClientId,secret:s.googleClientSecret}:{url:'https://login.microsoftonline.com/common/oauth2/v2.0/token',clientId:s.microsoftClientId,secret:s.microsoftClientSecret}; const body=new URLSearchParams({client_id:cfg.clientId,refresh_token:a.refreshToken,grant_type:'refresh_token'});if(cfg.secret)body.set('client_secret',cfg.secret);const r=await fetchImpl(cfg.url,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body,signal:AbortSignal.timeout(15000)}); if(!r.ok) throw new Error('OAuth refresh failed'); const t=await r.json(); Object.assign(a,{accessToken:t.access_token,expiresAt:Date.now()+t.expires_in*1000,...(t.refresh_token?{refreshToken:t.refresh_token}:{})}); return a; }
async function googleRequest(a,s,path,init={},deps={}){await refreshToken(a,s,'gmail',deps.fetchImpl||fetch); const r=await (deps.fetchImpl||fetch)(`https://gmail.googleapis.com/gmail/v1/users/me${path}`,{...init,signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${a.accessToken}`,...(init.headers||{})}});if(!r.ok)throw new Error(`Gmail API request failed (${r.status})`);return r.json();}
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
 const attachments=await mapConcurrent(attachmentParts,4,async part=>{try{const x=await googleRequest(a,settings,`/messages/${m.id}/attachments/${part.id}`,{},deps);return {id:`${id}:att:${part.id}`,filename:part.filename,size:part.size,content:decodeBuffer(x.data).toString('base64')};}catch{return null;}});
 return {text:htmlBodyToText(pick('text/plain'),pick('text/html')),attachments:attachments.filter(Boolean),bodyLoaded:true};
}
async function gmailFetch(a,folder,query,limit,settings,deps={}){
 const url=new URLSearchParams({maxResults:String(Math.min(limit,100))});
 if(folder.role==='archive')url.set('q',['-in:inbox','-in:sent','-in:drafts','-in:trash','-in:spam',query||''].filter(Boolean).join(' '));
 else{const label=folder.providerId||({inbox:'INBOX',sent:'SENT',drafts:'DRAFT',junk:'SPAM',trash:'TRASH'}[folder.role]);if(label)url.append('labelIds',label);if(query)url.set('q',query);}
 const list=await googleRequest(a,settings,`/messages?${url}`,{},deps),cached=new Map((deps.cachedMessages||[]).filter(m=>m.accountId===a.id).map(m=>[m.id,m]));
 return mapConcurrent(list.messages||[],4,async ref=>{
  const params=new URLSearchParams({format:deps.metadataOnly?'metadata':'full'});
  if(deps.metadataOnly)for(const header of ['From','To','Subject','Date','Reply-To','Message-ID','References'])params.append('metadataHeaders',header);
  const m=await googleRequest(a,settings,`/messages/${ref.id}?${params}`,{},deps),payload=m.payload||{},h=googleHeaders(payload,m.internalDate),id=`${a.id}:gmail:${m.id}`,old=cached.get(id);
  const content=deps.metadataOnly?{text:old?.bodyLoaded!==false&&old?old.text||'':m.snippet||'',attachments:old?.attachments||[],bodyLoaded:!!old&&old.bodyLoaded!==false}:await gmailContent(a,m,settings,deps);
  const msgId=(payload.headers||[]).find(x=>x.name.toLowerCase()==='message-id')?.value||null,refs=(payload.headers||[]).find(x=>x.name.toLowerCase()==='references')?.value||'';
  return {id,accountId:a.id,providerRef:{type:'gmail',id:m.id,labelIds:m.labelIds||[],threadId:m.threadId,rfcMessageId:msgId,references:refs},...h,...content,unread:(m.labelIds||[]).includes('UNREAD'),starred:(m.labelIds||[]).includes('STARRED')};
 });
}
async function graphFetch(a,folder,query,limit,settings,deps={}){await refreshToken(a,settings,'microsoft',deps.fetchImpl||fetch);const f=folder.providerId||({sent:'sentitems',drafts:'drafts',inbox:'inbox',junk:'junkemail',trash:'deleteditems',archive:'archive'}[folder.role]||'inbox');const q=new URLSearchParams({$top:String(Math.min(limit,100)),$orderby:'receivedDateTime desc',$select:'id,internetMessageId,subject,from,toRecipients,replyTo,receivedDateTime,body,isRead,flag,hasAttachments'});if(query)q.set('$search',`"${query}"`);const r=await graphRequest(a,`/me/mailFolders/${encodeURIComponent(f)}/messages?${q}`,{},deps),out=[];for(const m of r.value||[]){const id=`${a.id}:graph:${m.id}`,attachments=[];if(m.hasAttachments)try{const list=await graphRequest(a,`/me/messages/${m.id}/attachments?$select=id,name,size,contentBytes`,{},deps);for(const x of list.value||[])if(x.contentBytes)attachments.push({id:`${id}:att:${x.id}`,filename:x.name||'attachment',size:x.size||0,content:x.contentBytes});}catch{}out.push({id,accountId:a.id,providerRef:{type:'graph',id:m.id,folder:f,rfcMessageId:m.internetMessageId||null},subject:m.subject||'',from:address(m.from?.emailAddress),to:(m.toRecipients||[]).map(x=>address(x.emailAddress)),...(m.replyTo?.length?{replyTo:m.replyTo.map(x=>address(x.emailAddress))}:{}),date:m.receivedDateTime,text:htmlBodyToText(m.body?.contentType==='text'?m.body.content:'',m.body?.contentType==='html'?m.body.content:''),unread:!m.isRead,starred:m.flag?.flagStatus==='flagged',attachments});}return out;}
export async function syncAccount(state,account,folder='inbox',query='',limit=100,deps={}){const target=await resolveFolder(state,account,folder,deps),key=target.folderKey,fresh=account.provider==='microsoft'?await graphFetch(account,target,query,limit,state.settings,deps):account.provider==='gmail'?await gmailFetch(account,target,query,limit,state.settings,{...deps,cachedMessages:state.messages}):await imapFetch(account,target,query,limit,{...deps,cachedMessages:state.messages});const accountRows=account.provider==='gmail'?await folderRows(state,account,deps):[];const labelFolders=new Map(accountRows.filter(x=>x.providerId).map(x=>[x.providerId,x.id]));for(const existing of state.messages.filter(x=>x.accountId===account.id)){const prior=existing.folderIds||existing.folders||[existing.folder||'inbox'];existing.folderIds=prior.filter(x=>x!==key);existing.folders=existing.folderIds;}
 for(const m of fresh){const old=state.messages.find(x=>x.id===m.id);let memberships=[key];if(m.providerRef?.type==='gmail'){memberships=(m.providerRef.labelIds||[]).map(id=>labelFolders.get(id)).filter(Boolean);if(!(m.providerRef.labelIds||[]).some(id=>['INBOX','SENT','DRAFT','TRASH','SPAM'].includes(id)))memberships.push('archive');if(target.role==='custom'||target.role==='archive')memberships.push(key);}else if(old)memberships=[...new Set([...memberships,...(old.folderIds||old.folders||[])])];m.folder=old?.folder||key;m.folderIds=[...new Set(memberships)];m.folders=m.folderIds;if(old)Object.assign(old,m);else state.messages.push(m);}
 state.messages=state.messages.filter(m=>m.accountId!==account.id||m.folderIds?.length);account.lastSync=new Date().toISOString();return fresh;}
export async function updateRemote(state,m,patch,deps={}){
 const a=state.accounts.find(x=>x.id===m.accountId);if(!a)throw new Error('Account not found');let folderTarget;
 if(m.providerRef?.type==='imap'){
  if(!Number.isInteger(m.providerRef.uid))throw new Error('Message UID unavailable; sync its folder before changing it');
  let target,destination;
  if(patch.folder){
   const rows=await folderRows(state,a,deps);a.folders=rows;
   target=folderTarget=await resolveFolder(state,a,patch.folder,deps);
   destination=target.providerId||rows.find(x=>x.role===target.role)?.providerId;
   if(!destination)throw new Error('Remote destination folder is unavailable');
  }
  const c=imapClient(a,deps);await c.connect();
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
export async function sendMail(state,account,draft,deps={}){const source=draft.replyToMessageId?state.messages.find(m=>m.id===draft.replyToMessageId):null,replyId=source?.providerRef?.rfcMessageId||undefined,attachments=sendAttachments(draft.attachments);
 if(account.provider==='microsoft') {await refreshToken(account,state.settings,'microsoft',deps.fetchImpl||fetch);const message={subject:draft.subject,body:{contentType:draft.html?'HTML':'Text',content:draft.html||draft.text},toRecipients:String(draft.to).split(',').map(address=>({emailAddress:{address:address.trim()}})),...(draft.cc?{ccRecipients:String(draft.cc).split(',').map(x=>({emailAddress:{address:x.trim()}}))}:{}),...(draft.bcc?{bccRecipients:String(draft.bcc).split(',').map(x=>({emailAddress:{address:x.trim()}}))}:{}),...(attachments.length?{attachments:attachments.map(graphAttachment)}:{})};if(source?.providerRef?.type==='graph'){const reply=await graphRequest(account,`/me/messages/${source.providerRef.id}/createReply`,{method:'POST'},{fetchImpl:deps.fetchImpl}),{attachments:graphAttachments,...replyMessage}=message;await graphRequest(account,`/me/messages/${reply.id}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(replyMessage)},{fetchImpl:deps.fetchImpl});for(const attachment of graphAttachments||[])await graphRequest(account,`/me/messages/${reply.id}/attachments`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(attachment)},{fetchImpl:deps.fetchImpl});await graphRequest(account,`/me/messages/${reply.id}/send`,{method:'POST'},{fetchImpl:deps.fetchImpl});}else await graphRequest(account,'/me/sendMail',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message,saveToSentItems:true})},{fetchImpl:deps.fetchImpl});return {messageId:null};}
 if(account.provider==='gmail') {await refreshToken(account,state.settings,'gmail',deps.fetchImpl||fetch);const raw=await composeGmailRaw({from:account.email,to:draft.to,cc:draft.cc||undefined,bcc:draft.bcc||undefined,subject:draft.subject,text:draft.text||undefined,html:draft.html||undefined,attachments,inReplyTo:replyId,references:source?.providerRef?.references?[source.providerRef.references,replyId].filter(Boolean).join(' '):replyId});const r=await (deps.fetchImpl||fetch)('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{Authorization:`Bearer ${account.accessToken}`,'content-type':'application/json'},body:JSON.stringify({raw,...(source?.providerRef?.type==='gmail'&&source.providerRef.threadId?{threadId:source.providerRef.threadId}:{})}),signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error('Gmail send failed');return {messageId:(await r.json()).id||null};}
 const smtp=defaults(account).smtp,transport=(deps.smtpTransportFactory||nodemailer.createTransport)({host:smtp.host,port:smtp.port,secure:smtp.secure,auth:{user:account.email,pass:account.password},connectionTimeout:10000,socketTimeout:15000});return transport.sendMail({from:account.email,to:draft.to,cc:draft.cc||undefined,bcc:draft.bcc||undefined,subject:draft.subject,text:draft.text,html:draft.html||undefined,inReplyTo:replyId,references:replyId||undefined,attachments});}
