const publicDraft=({accountId,id,to,cc,bcc,subject,text,html,attachments,replyToMessageId,updatedAt,status,deletedAt})=>({accountId,id,to,cc,bcc,subject,text,html,attachments:attachments||[],replyToMessageId,updatedAt,status,...(deletedAt?{deletedAt}:{})});
export function registerDraftManagement(app,store){
 app.get('/api/drafts',(req,res)=>res.json(store.state.drafts.filter(d=>req.query.includeDeleted==='true'||!d.deletedAt).map(publicDraft)));
 app.delete('/api/drafts/:id',async(req,res)=>{
  const result=await store.mutate(s=>{const draft=s.drafts.find(d=>d.id===req.params.id);if(!draft)return 'missing';if(draft.status==='sending')return 'sending';draft.deletedAt||=new Date().toISOString();return 'deleted'});
  if(result==='missing')return res.sendStatus(404);if(result==='sending')return res.status(409).json({error:'A sending draft cannot be deleted. Wait for the send result.'});res.sendStatus(204);
 });
 app.post('/api/drafts/clear',async(req,res)=>{
  const {ids,accountId}=req.body||{};
  if(!Array.isArray(ids)||ids.length>10000||ids.some(id=>typeof id!=='string'||!id||id.length>300)||accountId!==undefined&&(typeof accountId!=='string'||!accountId))return res.status(400).json({error:'Select the drafts to clear'});
  const selected=new Set(ids),result=await store.mutate(s=>{if(accountId&&!s.accounts.some(a=>a.id===accountId))return null;let deleted=0,skipped=0;const now=new Date().toISOString();for(const draft of s.drafts){if(draft.deletedAt||!selected.has(draft.id)||accountId&&draft.accountId!==accountId)continue;if(draft.status==='sending'){skipped++;continue}draft.deletedAt=now;deleted++}return {deleted,skipped}});
  if(!result)return res.status(400).json({error:'Select a valid account'});res.json(result);
 });
 app.post('/api/drafts/:id/restore',async(req,res)=>{const found=await store.mutate(s=>{const draft=s.drafts.find(d=>d.id===req.params.id);if(!draft)return false;delete draft.deletedAt;return true});found?res.sendStatus(204):res.sendStatus(404)});
}
