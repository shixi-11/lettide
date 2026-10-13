import {createHash} from 'node:crypto';

// An exclusive lease owns the IMAP session and its selected mailbox.
// Failed operations are never replayed, especially writes with uncertain outcomes.
export class ImapPool {
 constructor({maxPerAccount=2,idleMs=120000,waitMs=20000}={}){this.max=maxPerAccount;this.idleMs=idleMs;this.waitMs=waitMs;this.buckets=new Map();}
 async acquire(accountId,identity,create,priority=10){
  const fingerprint=createHash('sha256').update(JSON.stringify(identity)).digest('hex');
  let bucket=this.buckets.get(accountId);
  while(bucket&&bucket.fingerprint!==fingerprint){await this.close(accountId);bucket=this.buckets.get(accountId);}
  if(!bucket){bucket={fingerprint,entries:[],queue:[],closed:false};this.buckets.set(accountId,bucket);}
  return new Promise((resolve,reject)=>{const request={resolve,reject,create,priority,timer:null};request.timer=setTimeout(()=>{const index=bucket.queue.indexOf(request);if(index>=0)bucket.queue.splice(index,1);reject(new Error('Mailbox connection is busy. Please retry.'));},this.waitMs);bucket.queue.push(request);bucket.queue.sort((a,b)=>b.priority-a.priority);this.pump(bucket);});
 }
 pump(bucket){
  if(bucket.closed)return;
  while(bucket.queue.length){
   let entry=bucket.entries.find(e=>!e.busy);
   if(entry&&(entry.client.usable===false)){this.discard(bucket,entry);continue;}
   if(!entry&&bucket.entries.length>=this.max)return;
   const request=bucket.queue.shift();clearTimeout(request.timer);
   if(entry){clearTimeout(entry.timer);entry.busy=true;request.resolve(this.lease(bucket,entry));continue;}
   try{entry={client:request.create(),busy:true,timer:null};}catch(error){request.reject(error);continue;}bucket.entries.push(entry);entry.client.on?.('error',()=>{});
   void (async()=>{try{await entry.client.connect();if(bucket.closed)throw new Error('Mailbox connection was closed');request.resolve(this.lease(bucket,entry));}catch(error){this.discard(bucket,entry);request.reject(error);}finally{this.pump(bucket);}})();
  }
 }
 lease(bucket,entry){let released=false;return {client:entry.client,release:async()=>{if(released)return;released=true;entry.busy=false;if(bucket.closed||entry.client.usable===false)this.discard(bucket,entry);else{entry.timer=setTimeout(()=>this.discard(bucket,entry),this.idleMs);entry.timer.unref?.();}this.pump(bucket);}};}
 discard(bucket,entry){clearTimeout(entry.timer);const i=bucket.entries.indexOf(entry);if(i>=0)bucket.entries.splice(i,1);try{entry.client.close();}catch{}this.pump(bucket);}
 async close(accountId){const buckets=accountId===undefined?[...this.buckets.values()]:[this.buckets.get(accountId)].filter(Boolean);if(accountId===undefined)this.buckets.clear();else this.buckets.delete(accountId);for(const bucket of buckets){bucket.closed=true;for(const request of bucket.queue){clearTimeout(request.timer);request.reject(new Error('Mailbox connection was closed'));}bucket.queue=[];for(const entry of [...bucket.entries]){clearTimeout(entry.timer);if(!entry.busy)this.discard(bucket,entry);}}}
}
