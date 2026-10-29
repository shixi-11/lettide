// Gmail's official history cursor is captured before the full list, so mail
// arriving during that list is still visible to the next incremental check.
export async function historyWindow(account,key,request){
 const previous=account.gmailHistory?.[key];
 if(!previous){const profile=await request('/profile');return {cursor:profile.historyId||null,changed:true,ids:new Set(),deleted:new Set()};}
 const ids=new Set(),deleted=new Set();let pageToken='',cursor=previous,changed=false;
 try{
  for(let page=0;page<10;page++){
   const query=new URLSearchParams({startHistoryId:previous,maxResults:'500'});if(pageToken)query.set('pageToken',pageToken);
   const data=await request('/history?'+query),history=data.history||[];changed ||= history.length>0;
   for(const entry of history){for(const item of entry.messages||[])if(item.id)ids.add(item.id);for(const item of entry.messagesDeleted||[])if(item.message?.id){ids.add(item.message.id);deleted.add(item.message.id);}for(const item of entry.messagesAdded||[])if(item.message?.id){ids.add(item.message.id);deleted.delete(item.message.id);}for(const kind of ['labelsAdded','labelsRemoved'])for(const item of entry[kind]||[])if(item.message?.id)ids.add(item.message.id);}
   pageToken=data.nextPageToken||'';cursor=pageToken?history.at(-1)?.id||cursor:data.historyId||cursor;
   if(!pageToken)break;
  }
  return {cursor,changed,ids,deleted};
 }catch(error){if(error.status!==404)throw error;const profile=await request('/profile');return {cursor:profile.historyId||null,changed:true,ids:new Set(),deleted:new Set()};}
}
