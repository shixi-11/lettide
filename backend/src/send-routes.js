import {randomUUID} from 'node:crypto';
import {simpleParser} from 'mailparser';
import {sendMail,saveSentCopy,inspectProviderSend} from './mail.js';
import {sameData} from './data-clone.js';
import {pendingSentCopy} from './sent-copy.js';

const publicCopy=({id,accountId,messageId,status,subject,createdAt})=>({id,accountId,messageId,status,subject,createdAt});
const cacheOAuthSent=(s,account,draft,info)=>{
 if(!s.accounts.some(a=>a.id===account.id)||!['gmail','microsoft'].includes(account.provider))return;
 const id=info.messageId?account.id+(account.provider==='gmail'?':gmail:':':graph:')+info.messageId:account.id+':sent-local:'+draft.id;
 if(!s.messages.some(m=>m.id===id))s.messages.push({id,accountId:account.id,subject:draft.subject,from:{name:account.name||'',address:account.email},to:String(draft.to).split(',').map(address=>({address:address.trim()})),date:info.sentDateTime||new Date().toISOString(),text:draft.text||'',bodyLoaded:true,providerPendingUntil:Date.now()+300000,folder:'sent',folderIds:['sent'],folders:['sent'],unread:false,starred:false,attachments:draft.attachments||[],providerRef:account.provider==='gmail'?{type:'gmail',id:info.messageId}:(info.messageId?{type:'graph',id:info.messageId,folder:'sentitems'}:{type:'sent-local',draftId:draft.id})});
};
export async function registerSendRoutes(app,store,{mailSender=sendMail,sentCopySaver=saveSentCopy,providerSendInspector=inspectProviderSend,validRecipients}={}){
 if(store.state.sentCopies?.some(j=>j.status==='saving'))await store.mutate(s=>{for(const j of s.sentCopies)if(j.status==='saving')j.status='pending';s.drafts=s.drafts.filter(d=>!s.sentCopies.some(j=>j.draftId===d.id&&j.status==='pending'));});
 const copyTasks=new Map();
 const finishCopy=async(id,outcome)=>{
  const job=store.state.sentCopies?.find(j=>j.id===id);if(!job)return;
  const parsed=outcome.status==='saved'&&job.raw?await simpleParser(Buffer.from(job.raw,'base64')):null;
  await store.mutate(s=>{
   const current=s.sentCopies?.find(j=>j.id===id);if(!current)return;
   current.status=outcome.status;current.outcome=outcome;
   for(const result of Object.values(s.sendResults))if(result.copyId===id)result.sentCopy={...outcome,id};
   if(outcome.status==='saved'){
    current.savedAt=new Date().toISOString();delete current.raw;s.messages=s.messages.filter(m=>m.providerRef?.copyId!==id);
    if(parsed&&s.accounts.some(a=>a.id===current.accountId)){
     const messageId=`${current.accountId}:imap:${outcome.folder}:${outcome.uid}`;
     if(!s.messages.some(m=>m.id===messageId))s.messages.push({id:messageId,accountId:current.accountId,folder:'sent',folderIds:['sent'],folders:['sent'],providerRef:{type:'imap',folder:outcome.folder,uid:outcome.uid,uidValidity:outcome.uidValidity,rfcMessageId:current.messageId,references:parsed.references||[]},subject:parsed.subject||'',from:parsed.from?.value?.[0]||{},to:parsed.to?.value||[],date:current.date,text:parsed.text||'',unread:false,starred:false,bodyLoaded:true,attachments:(parsed.attachments||[]).map((a,i)=>({id:`${messageId}:att:${i}`,filename:a.filename||'attachment',size:a.size,content:a.content.toString('base64')}))});
    }
   }
  });
 };
 app.get('/api/sent-copies',(_req,res)=>res.json((store.state.sentCopies||[]).filter(j=>j.status==='pending').map(publicCopy)));
 app.post('/api/sent-copies/:id/retry',async(req,res)=>{
  const job=store.state.sentCopies?.find(j=>j.id===req.params.id);
  if(!job)return res.sendStatus(404);
  if(job.status==='saved')return res.json({status:'saved',id:job.id});
  if(job.status!=='pending')return res.status(409).json({error:'SMTP acceptance has not been confirmed. Do not resend or save a Sent copy automatically.'});
  const account=store.state.accounts.find(a=>a.id===job.accountId);if(!account)return res.sendStatus(404);
  let work=copyTasks.get(job.id);
  if(!work){work=(async()=>{let outcome;try{outcome=await sentCopySaver(store.state,structuredClone(account),structuredClone(job));}catch{outcome=pendingSentCopy();}await finishCopy(job.id,outcome);return {...outcome,id:job.id};})();copyTasks.set(job.id,work);work.finally(()=>copyTasks.delete(job.id)).catch(()=>{});}
  try{const result=await work;res.status(result.status==='saved'?200:502).json(result);}catch{res.status(503).json(pendingSentCopy());}
 });
 app.get('/api/drafts/:id/send-status',async(req,res)=>{
  const draft=store.state.drafts.find(d=>d.id===req.params.id),receipt=Object.values(store.state.sendResults).find(r=>r.draftId===req.params.id&&r.providerDraftId);
  const current=store.state.accounts.find(a=>a.id===draft?.accountId);if(!receipt||!current)return res.status(409).json({status:'outcome_unknown',message:'No provider receipt is available. Check Sent before sending again.'});
  try{const account=structuredClone(current),result=await providerSendInspector(store.state,account,receipt.providerDraftId);
   await store.mutate(s=>{const live=s.accounts.find(a=>a.id===account.id);if(live)for(const key of ['accessToken','refreshToken','expiresAt'])if(sameData(live[key],current[key])&&account[key]!==undefined)live[key]=account[key];if(result.status==='sent'){for(const r of Object.values(s.sendResults))if(r.draftId===draft.id)Object.assign(r,result);cacheOAuthSent(s,account,draft,result);s.drafts=s.drafts.filter(d=>d.id!==draft.id);}});
   res.json(result);
  }catch{res.status(503).json({status:'outcome_unknown',message:'Could not verify the provider result. The message was not sent again.'});}
 });
 app.post('/api/drafts/:id/send',async(req,res)=>{
  const key=req.get('Idempotency-Key');if(!key||key.length>200)return res.status(400).json({error:'Idempotency-Key is required'});
  const claim=await store.mutate(s=>{
   if(Object.hasOwn(s.sendResults,key))return {prior:s.sendResults[key]};
   const d=s.drafts.find(x=>x.id===req.params.id);if(!d)return {error:'missing'};
   if(d.status&&d.status!=='draft')return {error:d.status};
   if(!s.accounts.some(a=>a.id===d.accountId))return {error:'account_missing'};
   if(!validRecipients(d)||/[\r\n]/.test(String(d.subject||'')))return {error:'invalid_recipients'};
   d.status='sending';s.sendResults[key]={status:'sending',draftId:d.id,startedAt:new Date().toISOString()};
   return {draft:structuredClone(d),account:structuredClone(s.accounts.find(a=>a.id===d.accountId))};
  });
  if(claim.prior)return res.status(claim.prior.status==='sent'?200:409).json(claim.prior);
  if(claim.error)return claim.error==='missing'?res.sendStatus(404):['invalid_recipients','account_missing'].includes(claim.error)?res.status(400).json({error:'Enter valid recipients and select a connected account before sending'}):res.status(409).json({status:claim.error,message:'This draft has already started sending and will not be retried automatically.'});
  const {draft,account}=claim,accountBaseline=structuredClone(claim.account),copyId=randomUUID();let accepted=false;
  try{
   const info=await mailSender(store.state,account,draft,{
    onProviderPrepared:receipt=>store.mutate(s=>{const result=s.sendResults[key],draft=s.drafts.find(d=>d.id===claim.draft.id);if(result)Object.assign(result,receipt);if(draft)Object.assign(draft,receipt);}),
    onPrepared:packet=>store.mutate(s=>{(s.sentCopies||=[]).push({...packet,id:copyId,accountId:account.id,draftId:draft.id,subject:draft.subject,createdAt:new Date().toISOString(),status:'prepared'});}),
    onAccepted:async packet=>{
     accepted=true;
     await store.mutate(s=>{const j=s.sentCopies?.find(j=>j.id===copyId);if(j)j.status='saving';const d=s.drafts.find(d=>d.id===draft.id);if(d)d.status='sent';s.sendResults[key]={status:'sent',draftId:draft.id,messageId:packet.messageId,copyId,sentCopy:{...pendingSentCopy(),id:copyId}};
      if(s.accounts.some(a=>a.id===account.id)&&!s.messages.some(m=>m.providerRef?.copyId===copyId))s.messages.push({id:account.id+':smtp-sent:'+copyId,accountId:account.id,subject:draft.subject,from:{name:account.name||'',address:account.email},to:String(draft.to).split(',').map(address=>({address:address.trim()})),date:packet.date||new Date().toISOString(),text:draft.text||'',bodyLoaded:true,sentCopyPending:true,folder:'sent',folderIds:['sent'],folders:['sent'],unread:false,starred:false,attachments:draft.attachments||[],providerRef:{type:'sent-copy',copyId,rfcMessageId:packet.messageId}});
     });
    }
   });
   accepted=true;
   if(info.sentCopy)await finishCopy(copyId,info.sentCopy);
   const result={status:'sent',draftId:draft.id,messageId:info.messageId||null,...(info.sentCopy?{copyId,sentCopy:{...info.sentCopy,id:copyId}}:{})};
   await store.mutate(s=>{
    s.sendResults[key]=result;s.drafts=s.drafts.filter(x=>x.id!==draft.id);
    const live=s.accounts.find(a=>a.id===account.id);if(live)for(const name of ['accessToken','refreshToken','expiresAt'])if(account[name]!==undefined&&sameData(live[name],accountBaseline[name]))live[name]=account[name];
    if(live)cacheOAuthSent(s,account,draft,info);
   });
   res.json(result);
  }catch{
   // Failure after SMTP acceptance never becomes a send failure or permits another send.
   const result=accepted?{status:'sent',draftId:draft.id,copyId,sentCopy:{...pendingSentCopy(),id:copyId},messageId:store.state.sentCopies?.find(j=>j.id===copyId)?.messageId||null}:{status:'outcome_unknown',draftId:draft.id,...(store.state.sendResults[key]?.providerDraftId?{providerDraftId:store.state.sendResults[key].providerDraftId,provider:'microsoft'}:{}),message:'Send result is uncertain. Do not retry automatically.'};
   try{await store.mutate(s=>{s.sendResults[key]=result;const d=s.drafts.find(x=>x.id===draft.id);if(d)d.status=result.status;if(accepted){const j=s.sentCopies?.find(j=>j.id===copyId);if(j)j.status='pending';s.drafts=s.drafts.filter(x=>x.id!==draft.id);}});}catch{}
   res.status(accepted?200:502).json(result);
  }
 });
 return {wait:()=>Promise.allSettled([...copyTasks.values()])};
}
