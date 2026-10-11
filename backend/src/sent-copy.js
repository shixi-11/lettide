import {simpleParser} from 'mailparser';

const normalizeId=value=>String(value||'').trim().replace(/^<|>$/g,'');
const sentBox=box=>String(box.specialUse||'').toLowerCase().includes('\\sent')||/^(sent(?: items| messages| mail)?|已发送(?:邮件)?)$/i.test(box.name||box.path||'');
export const selectSentMailbox=(account,boxes)=>account.sentFolder?boxes.find(b=>b.path===account.sentFolder):boxes.find(b=>String(b.specialUse||'').toLowerCase().includes('\\sent'))||boxes.find(sentBox);

// This module only searches and appends. It must never have access to an SMTP transport.
export async function saveImapSentCopy(account,packet,{clientFactory,wait=ms=>new Promise(r=>setTimeout(r,ms)),autoSaveChecks=3}={}){
 const raw=Buffer.from(packet.raw,'base64');
 const parsed=await simpleParser(raw);
 if(!packet.messageId||normalizeId(parsed.messageId)!==normalizeId(packet.messageId))throw new Error('Sent copy Message-ID does not match');
 const client=clientFactory();
 try{
  await client.connect();
  const boxes=await client.list();
  const folder=selectSentMailbox(account,boxes)?.path;
  if(!folder)throw new Error('Remote Sent folder is unavailable');
  const lock=await client.getMailboxLock(folder);
  try{
   const find=async()=>{
    const ids=await client.search({header:{'message-id':packet.messageId}},{uid:true});
    if(!Array.isArray(ids))throw new Error('Could not check Sent folder for an existing copy');
    // IMAP HEADER searches match substrings; check the exact RFC Message-ID too.
    if(ids.length)for await(const row of client.fetch(ids,{envelope:true},{uid:true}))if(normalizeId(row.envelope?.messageId)===normalizeId(packet.messageId))return row.uid;
    return null;
   };
   let uid;
   for(let i=0;i<autoSaveChecks;i++){uid=await find();if(uid)return {status:'saved',folder,uid,uidValidity:String(client.mailbox.uidValidity||''),alreadyExists:true};if(i+1<autoSaveChecks)await wait(250);}
   const result=await client.append(folder,raw,['\\Seen'],new Date(packet.date));
   if(!result)throw new Error('Server did not confirm saving the Sent copy');
   uid=result.uid||await find();
   if(!uid)throw new Error('Sent copy could not be verified; check the Sent folder before retrying');
   return {status:'saved',folder,uid,uidValidity:String(result.uidValidity||client.mailbox.uidValidity||''),alreadyExists:false};
  }finally{lock.release();}
 }finally{await client.logout().catch(()=>{});}
}

export const pendingSentCopy=()=>({status:'pending',message:'Message was sent. Its Sent copy still needs to be saved; do not send the message again.'});
