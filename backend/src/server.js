import express from 'express';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {promises as fs} from 'node:fs';
import path from 'node:path';
const appVersion=JSON.parse(await fs.readFile(new URL('../package.json',import.meta.url),'utf8')).version;
import {fileURLToPath} from 'node:url';
import {Store,newId,publicAccount} from './store.js';
import {syncAccount,loadMessageBody,publicMessage,updateRemote,sendMail,saveSentCopy,testImap,testSmtp,listRemoteFolders} from './mail.js';
import {translateGoogle,languageCodes} from './translate.js';
import {LocalTranslator} from './local-translate.js';
import {registerAccountManagement} from './account-management.js';
import {registerSendRoutes} from './send-routes.js';
import {normalizeLanguage} from './translation-language.js';

const defaultStaticRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../web/dist');
function validAttachments(value){return value===undefined||Array.isArray(value)&&value.length<=10&&value.every(a=>a&&typeof a.filename==='string'&&a.filename.length>0&&a.filename.length<=255&&!/[\r\n]/.test(a.filename)&&typeof a.content==='string'&&/^[A-Za-z0-9+/]*={0,2}$/.test(a.content)&&Buffer.from(a.content,'base64').length<=10*1024*1024)&&value.reduce((n,a)=>n+Buffer.from(a.content,'base64').length,0)<=10*1024*1024;}
const validRecipients=d=>!!String(d.to||'').trim()&&[d.to,d.cc,d.bcc].filter(Boolean).every(v=>!/[\r\n]/.test(String(v))&&String(v).split(',').every(x=>/^\s*[^\s<>@,]+@[^\s<>@,]+\s*$/.test(x)));
export async function createApp({store=new Store(),staticRoot=defaultStaticRoot,port=47831,mailSender=sendMail,sentCopySaver=saveSentCopy,oauthFetch=fetch,googleTranslator=translateGoogle,localTranslator=null,folderLister=listRemoteFolders,mailSyncer=syncAccount,messageLoader=loadMessageBody,messageUpdater=updateRemote,accountTester=async a=>{await testImap(a);await testSmtp(a);}}={}) {
 await store.open(); const app=express(), pendingOAuth=new Map();app.locals.store=store;app.locals.mailSyncer=mailSyncer;app.locals.folderLister=folderLister;
 const syncTasks=new Map();
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 async function refreshFolders(accountId){
  const account=store.state.accounts.find(a=>a.id===accountId);if(!account)return false;
  const beforeAccount=structuredClone(account),snapshot={settings:structuredClone(store.state.settings),accounts:[structuredClone(account)],messages:[]};
  const found=await folderLister(snapshot,snapshot.accounts[0]);
  return store.mutate(state=>{const current=state.accounts.find(a=>a.id===accountId);if(!current)return false;const afterAccount=snapshot.accounts[0];for(const key of Object.keys({...beforeAccount,...afterAccount}))if(!same(beforeAccount[key],afterAccount[key])&&same(current[key],beforeAccount[key])){if(Object.hasOwn(afterAccount,key))current[key]=structuredClone(afterAccount[key]);else delete current[key];}current.folders=found.map(f=>({...f,accountId}));current.foldersSyncedAt=new Date().toISOString();return true;});
 }
 async function syncFolder(accountId,folder){
  const account=store.state.accounts.find(a=>a.id===accountId);if(!account)return;
  const beforeAccount=structuredClone(account),baseline=store.state.messages.filter(m=>m.accountId===accountId).map(m=>structuredClone(m));
  const snapshot={settings:structuredClone(store.state.settings),accounts:[structuredClone(account)],messages:baseline.map(m=>structuredClone(m))};
  const custom=!['inbox','sent','drafts','archive','junk','trash'].includes(folder),target=custom?{id:folder,accountId}:folder;
  await mailSyncer(snapshot,snapshot.accounts[0],target,'',60,{metadataOnly:true});
  const synced=snapshot.messages.filter(m=>m.accountId===accountId),baseById=new Map(baseline.map(m=>[m.id,m])),syncedById=new Map(synced.map(m=>[m.id,m]));
  await store.mutate(state=>{
   const liveAccount=state.accounts.find(a=>a.id===accountId);if(!liveAccount)return;
   const currentById=new Map(state.messages.filter(m=>m.accountId===accountId).map(m=>[m.id,m]));
   const allIds=new Set([...baseById.keys(),...syncedById.keys()]);
   for(const id of allIds){
    const base=baseById.get(id),remote=syncedById.get(id),current=currentById.get(id);
    if(!base){
     if(remote&&!current)state.messages.push(structuredClone(remote));
     else if(remote&&current){const merged=structuredClone(current),membership=new Set([...(current.folderIds||current.folders||[current.folder||'inbox']),...(remote.folderIds||remote.folders||[remote.folder||'inbox'])]);merged.folderIds=[...membership];merged.folders=merged.folderIds;const index=state.messages.findIndex(m=>m.id===id);if(index>=0)state.messages[index]=merged;}
     continue;
    }
    if(!current)continue;
    if(!remote){
     const changed=Object.keys({...base,...current}).some(key=>!same(base[key],current[key]));
     if(!changed)state.messages=state.messages.filter(m=>m.id!==id);
     continue;
    }
    if(!same(base.folder,current.folder))continue;
    const merged=structuredClone(remote);
    for(const key of new Set([...Object.keys(base),...Object.keys(current)]))if(!['folderIds','folders'].includes(key)&&!same(base[key],current[key])){if(Object.hasOwn(current,key))merged[key]=structuredClone(current[key]);else delete merged[key];}
    const baseMembership=new Set(base.folderIds||base.folders||[base.folder||'inbox']),currentMembership=new Set(current.folderIds||current.folders||[current.folder||'inbox']),syncedMembership=new Set(remote.folderIds||remote.folders||[remote.folder||'inbox']),membership=new Set(baseMembership);
    for(const id of baseMembership)if(!currentMembership.has(id))membership.delete(id);
    for(const id of currentMembership)if(!baseMembership.has(id))membership.add(id);
    for(const id of baseMembership)if(!syncedMembership.has(id))membership.delete(id);
    for(const id of syncedMembership)if(!baseMembership.has(id))membership.add(id);
    merged.folderIds=[...membership];merged.folders=merged.folderIds;
    const index=state.messages.findIndex(m=>m.id===id);if(index>=0)state.messages[index]=merged;
   }
   const baseFields=beforeAccount,afterAccount=snapshot.accounts[0];
   for(const key of Object.keys({...baseFields,...afterAccount}))if(!same(baseFields[key],afterAccount[key])&&same(liveAccount[key],baseFields[key])){if(Object.hasOwn(afterAccount,key))liveAccount[key]=structuredClone(afterAccount[key]);else delete liveAccount[key];}
  });
 }
 app.locals.refreshFolders=refreshFolders;
 app.locals.syncFolder=(accountId,folder)=>{const key=JSON.stringify([accountId,folder]);let work=syncTasks.get(key);if(!work){work=syncFolder(accountId,folder);syncTasks.set(key,work);work.finally(()=>syncTasks.delete(key)).catch(()=>{});}return work;};
 app.disable('x-powered-by'); app.use(express.json({limit:'20mb'}));app.use((req,res,next)=>{res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');res.setHeader('Cache-Control','no-store');next();});
const loopHost=h=>['127.0.0.1','localhost','[::1]'].includes((h.match(/^\[::1\]|^[^:]+/)||[])[0])&&h.endsWith(`:${port}`);
app.use((req,res,next)=>!loopHost(req.headers.host||'')&&!(req.method==='GET'&&req.path==='/api/oauth/callback')?res.sendStatus(403):next());
function auth(req,res,next){if(!loopHost(req.headers.host||''))return res.sendStatus(403);if(req.method==='GET'&&req.path==='/oauth/callback')return next();const origin=req.headers.origin;if(origin){try{const o=new URL(origin);if(!['127.0.0.1','localhost','[::1]'].includes(o.hostname)||o.port!==String(port))return res.sendStatus(403);}catch{return res.sendStatus(403);}}if(req.headers['sec-fetch-site']==='cross-site')return res.sendStatus(403);
 const bearer=req.headers.authorization?.startsWith('Bearer ')?req.headers.authorization.slice(7):null, cookie=(req.headers.cookie||'').split('; ').find(x=>x.startsWith('yq_session='))?.slice(11);if(bearer&&bearer===store.state.token){req.authType='mcp';return next();}if(['POST','PUT','PATCH','DELETE'].includes(req.method)&&!origin)return res.sendStatus(403);if(cookie&&cookie===store.state.token){req.authType='ui';return next();}return res.sendStatus(401);}
app.get('/',async(req,res)=>{if(!loopHost(req.headers.host||'')||req.headers['sec-fetch-site']==='cross-site')return res.sendStatus(403);if(req.headers.origin){try{const u=new URL(req.headers.origin);if(!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.port!==String(port))return res.sendStatus(403);}catch{return res.sendStatus(403);}}res.cookie('yq_session',store.state.token,{httpOnly:true,sameSite:'Strict',secure:false,path:'/'});return res.sendFile(path.join(staticRoot,'index.html'),err=>{if(err&&!res.headersSent)res.status(503).type('text').send('Lettide is ready; web assets are not built yet.');});});
app.use('/api',auth);
 registerAccountManagement(app,store);
 const local=()=>app.locals.localTranslator||(app.locals.localTranslator=localTranslator||new LocalTranslator({modelDir:path.join(path.dirname(store.file),'models')}));
 app.get('/api/translations/local',async(req,res)=>res.json(await local().status()));
 app.post('/api/translations/local/cancel',async(req,res)=>{const id=req.body?.requestId;if(typeof id!=='string'||!id||id.length>128)return res.status(400).json({error:'A translation requestId is required'});res.json({cancelled:await local().cancel?.(id)||false});});
 app.post('/api/translations/local/download',async(req,res)=>{try{res.status(202).json(await local().download())}catch{res.status(503).json({error:'Offline model download could not start'})}});
 app.post('/api/service/quit',(req,res)=>{if(req.authType!=='ui')return res.sendStatus(403);res.json({ok:true});setImmediate(()=>app.locals.requestQuit?.());});
app.get('/api/integrations',(req,res)=>res.json({service:{baseUrl:`http://127.0.0.1:${port}`,processId:process.pid},mcp:{transport:'stdio',command:process.execPath,args:[path.resolve(path.dirname(fileURLToPath(import.meta.url)),'mcp.js')]},dataDirectory:path.dirname(store.file)}));
app.get('/api/status',(req,res)=>{const s=store.state;res.json({accounts:s.accounts.length,messageCount:s.messages.length,lastSync:s.accounts.map(a=>a.lastSync).filter(Boolean).sort().at(-1)||null,translation:{mode:s.settings.translationMode,queued:s.jobs.filter(j=>j.status==='pending').length},version:appVersion});});
app.get('/api/accounts',(req,res)=>res.json(store.state.accounts.map(publicAccount)));
app.post('/api/accounts',async(req,res)=>{const b=req.body||{};if(!['qq','godaddy'].includes(b.provider)||!b.email||!b.password)return res.status(400).json({error:'Provider, email, and credentials are required'});const a={id:newId(),provider:b.provider,name:String(b.name||b.email).slice(0,120),email:String(b.email).trim(),password:b.password,createdAt:new Date().toISOString(),lastSync:null};for(const k of ['imapHost','smtpHost','imapPort','smtpPort','sentFolder'])if(b[k]!==undefined)a[k]=b[k];try{await accountTester(a);}catch{return res.status(422).json({error:'Could not verify both incoming and outgoing mail settings; account was not saved'});}a.verifiedAt=new Date().toISOString();const added=await store.mutate(s=>{if(s.accounts.some(x=>x.provider===a.provider&&x.email.toLowerCase()===a.email.toLowerCase()))return false;s.accounts.push(a);return true;});if(!added)return res.status(409).json({error:'This provider and email address are already connected'});res.status(201).json(publicAccount(a));});
app.delete('/api/accounts/:id',async(req,res)=>{await store.mutate(s=>{const removed=new Set(s.messages.filter(m=>m.accountId===req.params.id).map(m=>m.id));s.accounts=s.accounts.filter(a=>a.id!==req.params.id);s.messages=s.messages.filter(m=>m.accountId!==req.params.id);s.drafts=s.drafts.filter(d=>d.accountId!==req.params.id);s.sentCopies=(s.sentCopies||[]).filter(j=>j.accountId!==req.params.id);s.jobs=s.jobs.filter(j=>!removed.has(j.messageId));});res.sendStatus(204);});
app.get('/api/folders',async(req,res)=>{
 const errors=[];
 if(req.query.refresh==='true')for(const a of [...store.state.accounts])try{await refreshFolders(a.id);}catch{errors.push(a.id);}
 const rows=store.state.accounts.flatMap(a=>(a.folders||[]).map(f=>({...f,accountId:a.id})));
 if(errors.length)res.setHeader('X-Lettide-Folder-Errors',String(errors.length));
 res.json(rows);
});
app.get('/api/settings',(req,res)=>{const s=store.state.settings;res.json({googleClientId:s.googleClientId||'',googleClientSecretSet:!!s.googleClientSecret,microsoftClientId:s.microsoftClientId||'',microsoftClientSecretSet:!!s.microsoftClientSecret,translationMode:s.translationMode,ollamaModel:s.ollamaModel});});
app.put('/api/settings',async(req,res)=>{const b=req.body||{};await store.mutate(s=>{for(const k of ['googleClientId','microsoftClientId','ollamaModel'])if(typeof b[k]==='string')s.settings[k]=b[k];for(const k of ['googleClientSecret','microsoftClientSecret'])if(typeof b[k]==='string'&&b[k])s.settings[k]=b[k];if(['local','google','assistant','ollama'].includes(b.translationMode))s.settings.translationMode=b.translationMode;});res.json({ok:true});});
function prepareOAuth(provider){
 if(!['gmail','microsoft'].includes(provider))throw new Error('Unsupported provider');
 const cfg=store.state.settings,client=provider==='gmail'?(cfg.googleClientId||process.env.LETTIDE_GOOGLE_CLIENT_ID):(cfg.microsoftClientId||process.env.LETTIDE_MICROSOFT_CLIENT_ID);
 if(!client)return {setupRequired:true,setupUrl:provider==='gmail'?'https://console.cloud.google.com/auth/clients':'https://entra.microsoft.com/'};
 for(const [key,value] of pendingOAuth)if(Date.now()-value.created>600000)pendingOAuth.delete(key);
 const verifier=randomBytes(48).toString('base64url'),state=randomBytes(24).toString('base64url');
 pendingOAuth.set(state,{provider,verifier,client,secret:provider==='gmail'?(cfg.googleClientSecret||process.env.LETTIDE_GOOGLE_CLIENT_SECRET):(cfg.microsoftClientSecret||process.env.LETTIDE_MICROSOFT_CLIENT_SECRET),created:Date.now()});
 const u=new URL(provider==='gmail'?'https://accounts.google.com/o/oauth2/v2/auth':'https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
 const params={client_id:client,redirect_uri:'http://127.0.0.1:'+port+'/api/oauth/callback',response_type:'code',scope:provider==='gmail'?'openid email https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send':'offline_access openid email User.Read Mail.ReadWrite Mail.Send',state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',access_type:'offline',prompt:'consent'};
 for(const [k,v] of Object.entries(params))u.searchParams.set(k,v);
 return {url:u.href};
}
app.post('/api/oauth/prepare',(req,res)=>{try{res.json(prepareOAuth(req.body?.provider));}catch{res.status(400).json({error:'Unsupported provider'});}});
app.get('/api/oauth/start',(req,res)=>{try{const result=prepareOAuth(req.query.provider);result.url?res.redirect(result.url):res.status(409).json(result);}catch{res.status(400).send('Unsupported provider');}});
app.get('/api/oauth/callback',async(req,res)=>{const p=pendingOAuth.get(req.query.state);pendingOAuth.delete(req.query.state);if(!p||Date.now()-p.created>600000)return res.status(400).send('OAuth state expired');const s=store.state.settings,client=p.client,secret=p.secret,url=p.provider==='gmail'?'https://oauth2.googleapis.com/token':'https://login.microsoftonline.com/common/oauth2/v2.0/token';let stage='token';try{if(req.query.error)throw new Error('cancelled');const body=new URLSearchParams({client_id:client,redirect_uri:'http://127.0.0.1:'+port+'/api/oauth/callback',grant_type:'authorization_code',code:req.query.code,code_verifier:p.verifier});if(secret)body.set('client_secret',secret);const r=await oauthFetch(url,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body,signal:AbortSignal.timeout(15000)});if(!r.ok)throw 0;const t=await r.json();stage='profile';const profile=await oauthFetch(p.provider==='gmail'?'https://gmail.googleapis.com/gmail/v1/users/me/profile':'https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName',{headers:{Authorization:`Bearer ${t.access_token}`},signal:AbortSignal.timeout(15000)});if(!profile.ok)throw 0;const me=await profile.json(),email=me.emailAddress||me.mail||me.userPrincipalName;if(!email)throw 0;stage='persistent_access';const existing=store.state.accounts.find(x=>x.provider===p.provider&&x.email.toLowerCase()===email.toLowerCase());if(!t.refresh_token&&!existing?.refreshToken)throw 0;stage='save';const a={id:existing?.id||newId(),provider:p.provider,name:me.displayName||email,email,accessToken:t.access_token,refreshToken:t.refresh_token||existing.refreshToken,expiresAt:Date.now()+t.expires_in*1000,createdAt:existing?.createdAt||new Date().toISOString(),verifiedAt:new Date().toISOString()};await store.mutate(x=>{const old=x.accounts.find(y=>y.provider===p.provider&&y.email.toLowerCase()===email.toLowerCase());if(old)Object.assign(old,a,{id:old.id});else x.accounts.push(a);});res.type('html').send('<meta charset="utf-8"><title>Lettide</title><p>邮箱已连接，可以关闭此页面，返回叠信。</p><p>Account connected. You can close this page and return to Lettide.</p>');}catch{const messages={token:'无法完成令牌交换，请重新连接。 / Token exchange failed. Please reconnect.',profile:'无法读取邮箱资料，请检查 Gmail API 是否启用及组织访问政策。 / Cannot verify the mailbox. Check Gmail API and organization access policies.',persistent_access:'未获得持续访问权限，请重新授权。 / Persistent access was not granted. Please reconnect.',save:'授权已完成，但本机保存失败，请重试。 / Authorization completed but local storage failed. Please retry.'};res.status(400).type('text').send(messages[stage]);}});
app.get('/api/messages',(req,res)=>{const {accountId,folder='inbox',query='',unread,limit='100'}=req.query;if(!['inbox','sent','drafts','archive','junk','trash'].includes(folder)&&!store.state.accounts.some(a=>(!accountId||a.id===accountId)&&(a.folders||[]).some(f=>f.id===folder)))return res.status(400).json({error:'Invalid folder'});let rows=store.state.messages.filter(m=>(!accountId||m.accountId===accountId)&&(m.folderIds||[m.folder||'inbox']).includes(folder));if(query)rows=rows.filter(m=>`${m.subject} ${m.text} ${m.from?.address}`.toLowerCase().includes(String(query).toLowerCase()));if(unread!==undefined)rows=rows.filter(m=>m.unread===(unread==='true'));rows.sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));res.json({items:rows.slice(0,Math.min(200,Math.max(1,+limit||100))).map(publicMessage),total:rows.length});});
const bodyLoads=new Map();
 async function ensureBody(id){const current=store.state.messages.find(x=>x.id===id);if(!current||current.bodyLoaded!==false)return current;let work=bodyLoads.get(id);if(!work){const baseMessage=structuredClone(current),account=store.state.accounts.find(a=>a.id===current.accountId);if(!account)return null;const baseAccount=structuredClone(account),snapshot={settings:structuredClone(store.state.settings),accounts:[structuredClone(account)],messages:[baseMessage]};work=(async()=>{await messageLoader(snapshot,snapshot.messages[0]);const loaded=snapshot.messages[0];return store.mutate(state=>{if(!state.accounts.some(a=>a.id===baseMessage.accountId))return null;const message=state.messages.find(x=>x.id===id);if(!message||message.bodyLoaded!==false)return message||null;for(const key of ['text','attachments','bodyLoaded'])if(Object.hasOwn(loaded,key))message[key]=structuredClone(loaded[key]);const liveAccount=state.accounts.find(a=>a.id===baseMessage.accountId),loadedAccount=snapshot.accounts[0];for(const key of Object.keys({...baseAccount,...loadedAccount}))if(!same(baseAccount[key],loadedAccount[key])&&same(liveAccount[key],baseAccount[key])){if(Object.hasOwn(loadedAccount,key))liveAccount[key]=structuredClone(loadedAccount[key]);else delete liveAccount[key];}return message;});})();bodyLoads.set(id,work);work.finally(()=>bodyLoads.delete(id)).catch(()=>{});}return work;}
 app.locals.waitForBackgroundTasks=async()=>{while(syncTasks.size||bodyLoads.size)await Promise.allSettled([...syncTasks.values(),...bodyLoads.values()]);};
 app.get('/api/messages/:id',async(req,res)=>{try{const m=await ensureBody(req.params.id);m?res.json(publicMessage(m)):res.sendStatus(404)}catch{res.status(502).json({error:'Could not load email content. Please retry.'})}});
app.post('/api/sync',async(req,res)=>{
 const accounts=store.state.accounts.filter(a=>!req.body?.accountId||a.id===req.body.accountId);
 if(req.body?.accountId&&!accounts.length)return res.sendStatus(404);
 const selected=req.body?.folder,errors=[],synced=new Set();
 for(const a of accounts){let ok=true;const current=store.state.accounts.find(x=>x.id===a.id);if(!current)continue;try{if(!current.foldersSyncedAt||Date.now()-Date.parse(current.foldersSyncedAt)>600000)await refreshFolders(a.id);}catch{ok=false;errors.push({accountId:a.id,error:'Folder sync failed'});}
 const folders=selected?[selected]:[...new Set(['inbox','sent',...(store.state.accounts.find(x=>x.id===a.id)?.folders||[]).map(f=>f.id)])];
 for(const folder of folders){const custom=!['inbox','sent','drafts','archive','junk','trash'].includes(folder),known=store.state.accounts.find(x=>x.id===a.id)?.folders?.find(f=>f.id===folder);if(custom&&!known){ok=false;errors.push({accountId:a.id,folder,error:'Invalid folder'});continue;}
 try{await app.locals.syncFolder(a.id,folder);}catch{ok=false;errors.push({accountId:a.id,folder,error:'Sync failed; check connection settings'});}}
 if(ok)synced.add(a.id);
 }res.json({synced:synced.size,errors});
});
app.patch('/api/messages/:id',async(req,res)=>{const b=req.body||{};if(typeof b.unread!=='boolean'&&typeof b.starred!=='boolean'&&b.folder===undefined)return res.status(400).json({error:'No supported changes'});if(b.folder!==undefined&&!['inbox','sent','archive','junk','trash'].includes(b.folder)&&!store.state.accounts.some(a=>(a.folders||[]).some(f=>f.id===b.folder)))return res.status(400).json({error:'Invalid folder'});try{const changed=await store.mutate(async s=>{const m=s.messages.find(x=>x.id===req.params.id);if(!m)return null;await messageUpdater(s,m,{...(typeof b.unread==='boolean'?{unread:b.unread}:{}),...(typeof b.starred==='boolean'?{starred:b.starred}:{}),...(b.folder?{folder:['inbox','sent','archive','junk','trash'].includes(b.folder)?b.folder:{id:b.folder,accountId:m.accountId}}:{})});return publicMessage(m);});changed?res.json(changed):res.sendStatus(404);}catch{res.status(502).json({error:'Provider update failed'});}});
app.get('/api/messages/:id/attachments/:attachmentId',(req,res)=>{const m=store.state.messages.find(x=>x.id===req.params.id),a=m?.attachments?.find(x=>x.id===req.params.attachmentId);if(!a)return res.sendStatus(404);res.setHeader('Content-Type','application/octet-stream');res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(path.basename(a.filename))}`);res.send(Buffer.from(a.content,'base64'));});
app.get('/api/drafts',(req,res)=>res.json(store.state.drafts.map(({accountId,id,to,cc,bcc,subject,text,html,attachments,replyToMessageId,updatedAt,status})=>({accountId,id,to,cc,bcc,subject,text,html,attachments:attachments||[],replyToMessageId,updatedAt,status}))));
app.post('/api/drafts',async(req,res)=>{const b=req.body||{};if(!validAttachments(b.attachments))return res.status(400).json({error:'Attachments exceed the 10 MB limit or are invalid'});if(!store.state.accounts.some(a=>a.id===b.accountId))return res.status(400).json({error:'Select a valid account'});if([b.to,b.cc,b.bcc].some(v=>v&&/[\r\n]/.test(String(v)))||/[\r\n]/.test(String(b.subject||'')))return res.status(400).json({error:'Recipients or subject are invalid'});if(b.replyToMessageId&&!store.state.messages.some(m=>m.id===b.replyToMessageId&&m.accountId===b.accountId))return res.status(400).json({error:'Reply source must belong to the selected account'});const d={id:newId(),accountId:b.accountId,to:String(b.to||''),cc:String(b.cc||''),bcc:String(b.bcc||''),subject:String(b.subject||''),text:String(b.text||''),html:String(b.html||''),attachments:b.attachments||[],replyToMessageId:b.replyToMessageId||null,updatedAt:new Date().toISOString(),status:'draft'};await store.mutate(s=>s.drafts.push(d));res.status(201).json(d);});
app.put('/api/drafts/:id',async(req,res)=>{const b=req.body||{},current=store.state.drafts.find(x=>x.id===req.params.id);if(!current)return res.sendStatus(404);if(!validAttachments(b.attachments))return res.status(400).json({error:'Attachments exceed the 10 MB limit or are invalid'});if(current.status&&current.status!=='draft')return res.status(409).json({error:'A draft that has started sending cannot be edited'});for(const k of ['to','cc','bcc','subject'])if(b[k]!==undefined&&/[\r\n]/.test(String(b[k])))return res.status(400).json({error:'Recipients or subject are invalid'});if(b.replyToMessageId&&!store.state.messages.some(m=>m.id===b.replyToMessageId&&m.accountId===current.accountId))return res.status(400).json({error:'Reply source must belong to the selected account'});const updated=await store.mutate(s=>{const d=s.drafts.find(x=>x.id===req.params.id);if(!d||d.status&&d.status!=='draft')return null;for(const k of ['to','cc','bcc','subject','text','html','replyToMessageId'])if(b[k]!==undefined)d[k]=String(b[k]);if(b.attachments!==undefined)d.attachments=b.attachments;d.updatedAt=new Date().toISOString();return d;});updated?res.json(updated):res.status(409).json({error:'A draft that has started sending cannot be edited'});});
await registerSendRoutes(app,store,{mailSender,sentCopySaver,validRecipients});
const onlineInFlight=new Map();
app.post('/api/translations',async(req,res)=>{
 const b=req.body||{};if(!languageCodes[b.targetLanguage]||(!b.text&&!b.messageId))return res.status(400).json({error:'Text or messageId and a supported targetLanguage are required'});
 let text=b.text;if(b.messageId){let m;try{m=await ensureBody(b.messageId)}catch{return res.status(502).json({error:'Could not load email content. Please retry.'})}if(!m)return res.sendStatus(404);text=m.text;}
 if(typeof text!=='string'||!text.trim()||text.length>100000)return res.status(400).json({error:'Email text is empty or too long to translate'});
 const mode=b.mode||'local';
 if(!['local','google','assistant','ollama'].includes(mode))return res.status(400).json({error:'Unsupported translation mode'});
 if(mode==='local'){
  if(b.sourceLanguage&&!normalizeLanguage(b.sourceLanguage))return res.status(400).json({error:'Unsupported source language'});
  const sourceLanguage=normalizeLanguage(b.sourceLanguage)||'';
  const hash=createHash('sha256').update(text).digest('hex'),key='local:v2:'+(b.messageId||'text')+':'+b.targetLanguage+':'+sourceLanguage+':'+hash;
  const cached=store.state.jobs.find(j=>j.sourceHash===hash&&j.messageId===(b.messageId||null)&&j.targetLanguage===b.targetLanguage&&j.status==='completed'&&j.provider==='local'&&j.cacheVersion===2&&(j.sourceLanguage||'')===sourceLanguage);
  if(cached)return res.json({id:cached.id,status:'completed',translation:cached.translation});
  if((await local().status()).state!=='ready')return res.status(409).json({code:'MODEL_NOT_READY',error:'Offline translation model is not ready'});
  let work=onlineInFlight.get(key);if(!work){const requestId=typeof b.requestId==='string'&&b.requestId.length<=128?b.requestId:null;work=(async()=>{const translation=await local().translate(text,b.targetLanguage,{requestId,sourceLanguage:sourceLanguage||undefined});const job={id:newId(),messageId:b.messageId||null,text,targetLanguage:b.targetLanguage,sourceHash:hash,provider:'local',cacheVersion:2,sourceLanguage,status:'completed',translation,createdAt:new Date().toISOString(),completedAt:new Date().toISOString()};await store.mutate(s=>{if(!job.messageId||s.messages.some(m=>m.id===job.messageId))s.jobs.push(job);});return {id:job.id,status:'completed',translation};})();onlineInFlight.set(key,work);work.finally(()=>onlineInFlight.delete(key)).catch(()=>{});}
  try{return res.json(await work)}catch(error){return res.status(503).json({error:error?.message||'Local translation failed; please try again'})}
 }
 if(mode==='google'){

  const hash=createHash('sha256').update(text).digest('hex'),key=(b.messageId||'text')+':'+b.targetLanguage+':'+hash;
  const cached=store.state.jobs.find(j=>j.sourceHash===hash&&j.messageId===(b.messageId||null)&&j.targetLanguage===b.targetLanguage&&j.status==='completed'&&j.provider==='google');
  if(cached)return res.json({id:cached.id,status:'completed',translation:cached.translation});
  let work=onlineInFlight.get(key);
  if(!work){work=(async()=>{const job={id:newId(),messageId:b.messageId||null,text,targetLanguage:b.targetLanguage,sourceHash:hash,provider:'google',status:'running',createdAt:new Date().toISOString()};await store.mutate(s=>s.jobs.push(job));
   try{const translation=await googleTranslator(text,b.targetLanguage);await store.mutate(s=>Object.assign(s.jobs.find(j=>j.id===job.id),{status:'completed',translation,completedAt:new Date().toISOString()}));return {id:job.id,status:'completed',translation};}
   catch{await store.mutate(s=>Object.assign(s.jobs.find(j=>j.id===job.id),{status:'failed',error:'Google translation is temporarily unavailable'}));throw new Error('Google translation is temporarily unavailable');}
  })();onlineInFlight.set(key,work);work.finally(()=>onlineInFlight.delete(key)).catch(()=>{});}
  try{return res.json(await work);}catch{return res.status(503).json({error:'Google translation is temporarily unavailable'});}
 }
 const job={id:newId(),messageId:b.messageId||null,text:String(text),targetLanguage:String(b.targetLanguage),status:mode==='ollama'?'running':'pending',createdAt:new Date().toISOString()};await store.mutate(s=>s.jobs.push(job));if(job.status==='running'){const s=store.state.settings;try{const r=await fetch('http://127.0.0.1:11434/api/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:s.ollamaModel||'qwen2.5:7b',prompt:`Translate the following email text into ${job.targetLanguage}. Preserve meaning and formatting. Return only the translation.\n\n${job.text}`,stream:false}),signal:AbortSignal.timeout(120000)});if(!r.ok)throw 0;const translation=(await r.json()).response;if(typeof translation!=='string'||!translation.trim())throw 0;await store.mutate(s=>{const x=s.jobs.find(y=>y.id===job.id);x.status='completed';x.translation=translation;x.completedAt=new Date().toISOString();});return res.json({status:'completed',id:job.id,translation});}catch{await store.mutate(s=>{const x=s.jobs.find(y=>y.id===job.id);x.status='failed';x.error='Local translation service is unavailable';});return res.status(503).json({error:'Local translation service is unavailable',id:job.id});}}res.status(202).json({status:'pending',id:job.id});});
app.get('/api/translations/jobs',(req,res)=>res.json(store.state.jobs.map(({id,messageId,targetLanguage,status,createdAt,text,translation,completedAt,provider,cacheVersion,sourceLanguage})=>({cacheVersion,sourceLanguage,id,messageId,targetLanguage,status,createdAt,text,provider,...(translation?{translation}:{}),...(completedAt?{completedAt}:{})}))));
app.post('/api/translations/:id/complete',async(req,res)=>{const b=req.body||{},j=store.state.jobs.find(x=>x.id===req.params.id);if(!j||j.status!=='pending')return res.sendStatus(404);if(typeof b.translation!=='string'||!b.translation.trim())return res.status(400).json({error:'translation is required'});await store.mutate(s=>{const x=s.jobs.find(y=>y.id===j.id);x.translation=b.translation;x.status='completed';x.completedAt=new Date().toISOString();});res.json({status:'completed'});});
app.use((req,res,next)=>loopHost(req.headers.host||'')?next():res.sendStatus(403));
app.use(express.static(staticRoot,{index:false,dotfiles:'deny',fallthrough:true,setHeaders:(res)=>{res.setHeader('Cache-Control','no-store');}}));
app.use((req,res)=>{if(req.path.startsWith('/api/'))return res.sendStatus(404);if(req.method==='GET'&&!path.extname(req.path)&&req.accepts('html'))return res.sendFile(path.join(staticRoot,'index.html'),err=>{if(err&&!res.headersSent)res.sendStatus(404);});res.sendStatus(404);});
return app;
}
export async function startService(options={}){
 const app=await createApp(options),listener=app.listen(options.port||47831,'127.0.0.1'),serviceStore=app.locals.store;let polling=false,cursor=0,stopped=false;
 async function poll(){if(polling||stopped)return;polling=true;try{
  for(const a of [...serviceStore.state.accounts]){
   if(stopped)break;
   if(!a.foldersSyncedAt||Date.now()-Date.parse(a.foldersSyncedAt)>600000)try{await app.locals.refreshFolders(a.id);}catch{}
   const current=serviceStore.state.accounts.find(x=>x.id===a.id);if(!current)continue;
   const extras=(current.folders||[]).filter(f=>!['inbox','sent'].includes(f.id));
   const batch=['inbox','sent',...Array.from({length:Math.min(3,extras.length)},(_,i)=>extras[(cursor+i)%extras.length].id)];
   for(const folder of new Set(batch)){if(stopped)break;try{await app.locals.syncFolder(a.id,folder);}catch{}}
  }cursor+=3;
 }finally{polling=false;}}
 let pollWork=Promise.resolve();const runPoll=()=>{if(!polling&&!stopped)pollWork=poll().catch(()=>{});};
 let stopping;const stop=()=>stopping||(stopping=(async()=>{stopped=true;clearTimeout(initial);clearInterval(timer);await new Promise(resolve=>listener.close(resolve));await pollWork;await app.locals.waitForBackgroundTasks();await app.locals.localTranslator?.close();await serviceStore.queue.catch(()=>{});await serviceStore.close();})());
 app.locals.requestQuit=()=>stop().then(()=>{if(options.exitOnQuit)process.exit(0)});
 const timer=setInterval(runPoll,60000);timer.unref();const initial=setTimeout(runPoll,1500);initial.unref();
 return {app,listener,stop};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){const service=await startService({exitOnQuit:true});const stop=()=>{service.stop().finally(()=>process.exit(0));};process.on('SIGINT',stop);process.on('SIGTERM',stop);}
