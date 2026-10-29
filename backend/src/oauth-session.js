import {createHash} from 'node:crypto';
const sessions=new Map(),contexts=new WeakMap();
// Snapshots from simultaneous sync/read/send operations share renewal, including
// the brief interval after a provider rotates its refresh token but before save.
export async function refreshToken(account,settings,provider,fetchImpl=fetch){
 contexts.set(account,{settings,provider});
 if(Date.now()<=(account.expiresAt||0)-60000)return account;
 const cfg=provider==='gmail'?{url:'https://oauth2.googleapis.com/token',clientId:settings.googleClientId||process.env.LETTIDE_GOOGLE_CLIENT_ID,secret:settings.googleClientSecret||process.env.LETTIDE_GOOGLE_CLIENT_SECRET}:{url:'https://login.microsoftonline.com/common/oauth2/v2.0/token',clientId:settings.microsoftClientId||process.env.LETTIDE_MICROSOFT_CLIENT_ID,secret:settings.microsoftClientSecret||process.env.LETTIDE_MICROSOFT_CLIENT_SECRET};
 const key=createHash('sha256').update(JSON.stringify([provider,account.id,account.email,cfg.clientId,cfg.secret,account.refreshToken])).digest('hex');
 for(const [id,item] of sessions)if(item.expires<Date.now())sessions.delete(id);
 let item=sessions.get(key);
 if(!item){
  item={expires:Date.now()+30000,promise:null};
  item.promise=(async()=>{
   const body=new URLSearchParams({client_id:cfg.clientId||'',refresh_token:account.refreshToken||'',grant_type:'refresh_token'});if(cfg.secret)body.set('client_secret',cfg.secret);
   const response=await fetchImpl(cfg.url,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body,signal:AbortSignal.timeout(15000)});
   if(!response.ok){const error=new Error('OAuth refresh failed');error.code=response.status===400||response.status===401?'AUTH_REQUIRED':'TEMPORARY';throw error;}
   const token=await response.json();if(!token.access_token||!Number.isFinite(Number(token.expires_in)))throw new Error('OAuth refresh returned invalid credentials');
   return {accessToken:token.access_token,expiresAt:Date.now()+Number(token.expires_in)*1000,...(token.refresh_token?{refreshToken:token.refresh_token}:{})};
  })();sessions.set(key,item);item.promise.catch(()=>{if(sessions.get(key)===item)sessions.delete(key)});
 }
 Object.assign(account,await item.promise);return account;
}

export async function renewUnauthorized(account,fetchImpl=fetch){
 const context=contexts.get(account);if(!context)throw new Error('OAuth context unavailable');
 account.expiresAt=0;return refreshToken(account,context.settings,context.provider,fetchImpl);
}
