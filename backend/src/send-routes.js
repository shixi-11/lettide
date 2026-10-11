import {randomUUID} from 'node:crypto';
import {simpleParser} from 'mailparser';
import {sendMail,saveSentCopy} from './mail.js';
import {pendingSentCopy} from './sent-copy.js';

const publicCopy=({id,accountId,messageId,status,subject,createdAt})=>({id,accountId,messageId,status,subject,createdAt});
export async function registerSendRoutes(app,store,{mailSender=sendMail,sentCopySaver=saveSentCopy,validRecipients}={}){
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
    current.savedAt=new Date().toISOString();delete current.raw;
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
  const {draft,account}=claim,copyId=randomUUID();let accepted=false;
  try{
   const info=await mailSender(store.state,account,draft,{
    onPrepared:packet=>store.mutate(s=>{(s.sentCopies||=[]).push({...packet,id:copyId,accountId:account.id,draftId:draft.id,subject:draft.subject,createdAt:new Date().toISOString(),status:'prepared'});}),
    onAccepted:async packet=>{
     accepted=true;
     await store.mutate(s=>{const j=s.sentCopies?.find(j=>j.id===copyId);if(j)j.status='saving';const d=s.drafts.find(d=>d.id===draft.id);if(d)d.status='sent';s.sendResults[key]={status:'sent',draftId:draft.id,messageId:packet.messageId,copyId,sentCopy:{...pendingSentCopy(),id:copyId}};});
    }
   });
   accepted=true;
   if(info.sentCopy)await finishCopy(copyId,info.sentCopy);
   const result={status:'sent',draftId:draft.id,messageId:info.messageId||null,...(info.sentCopy?{copyId,sentCopy:{...info.sentCopy,id:copyId}}:{})};
   await store.mutate(s=>{s.sendResults[key]=result;s.drafts=s.drafts.filter(x=>x.id!==draft.id);});
   res.json(result);
  }catch{
   // Failure after SMTP acceptance never becomes a send failure or permits another send.
   const result=accepted?{status:'sent',draftId:draft.id,copyId,sentCopy:{...pendingSentCopy(),id:copyId},messageId:store.state.sentCopies?.find(j=>j.id===copyId)?.messageId||null}:{status:'outcome_unknown',draftId:draft.id,message:'Send result is uncertain. Do not retry automatically.'};
   try{await store.mutate(s=>{s.sendResults[key]=result;const d=s.drafts.find(x=>x.id===draft.id);if(d)d.status=result.status;if(accepted){const j=s.sentCopies?.find(j=>j.id===copyId);if(j)j.status='pending';s.drafts=s.drafts.filter(x=>x.id!==draft.id);}});}catch{}
   res.status(accepted?200:502).json(result);
  }
 });
 return {wait:()=>Promise.allSettled([...copyTasks.values()])};
}
