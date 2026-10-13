import {cloneData,sameData} from './data-clone.js';
// Run remote work outside the global encrypted-store write queue. Serialize only
// operations on the same message, then merge changed fields into live state.
export function createMessageMutator(store,remoteUpdate){
 const pending=new Map(),same=sameData;
 const update=(id,patch)=>{const prior=pending.get(id)||Promise.resolve();const work=prior.catch(()=>{}).then(async()=>{
  const current=store.state.messages.find(m=>m.id===id);if(!current)return null;
  const account=store.state.accounts.find(a=>a.id===current.accountId);if(!account)return null;
  const before=cloneData(current),beforeAccount=cloneData(account),snapshot={settings:cloneData(store.state.settings),accounts:[cloneData(account)],messages:[cloneData(current)]};
  const remoteMessage=snapshot.messages[0];
  await remoteUpdate(snapshot,remoteMessage,patch);
  const removed=!snapshot.messages.some(m=>m.id===id);
  return store.mutate(state=>{const liveAccount=state.accounts.find(a=>a.id===before.accountId),live=state.messages.find(m=>m.id===id);if(!liveAccount||!live)return null;
   const after=snapshot.messages.find(m=>m.id===id)||remoteMessage,forced=new Set([...(typeof patch.unread==='boolean'?['unread']:[]),...(typeof patch.starred==='boolean'?['starred']:[]),...(patch.folder?['folder','folderIds','folders','providerRef']:[])]);for(const key of new Set([...Object.keys(before),...Object.keys(after)]))if(forced.has(key)||!same(before[key],after[key])){if(Object.hasOwn(after,key))live[key]=cloneData(after[key]);else delete live[key];}
   const afterAccount=snapshot.accounts[0];for(const key of new Set([...Object.keys(beforeAccount),...Object.keys(afterAccount)]))if(!same(beforeAccount[key],afterAccount[key])&&same(liveAccount[key],beforeAccount[key])){if(Object.hasOwn(afterAccount,key))liveAccount[key]=cloneData(afterAccount[key]);else delete liveAccount[key];}
   if(removed){state.messages=state.messages.filter(m=>m.id!==id);return cloneData(after);}
   return cloneData(live);
  });
 });pending.set(id,work);work.finally(()=>{if(pending.get(id)===work)pending.delete(id);}).catch(()=>{});return work;};
 update.wait=async()=>{while(pending.size)await Promise.allSettled([...pending.values()]);};return update;
}
