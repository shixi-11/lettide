import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {createApp} from '../src/server.js';

test('OAuth reports safe failure stages and stores persistent access only after mailbox verification',async()=>{
 const store={state:{token:randomUUID(),settings:{googleClientId:'fictional',googleClientSecret:'fictional-secret'},accounts:[]},open:async()=>{},mutate:async function(fn){return fn(this.state);}};
 let mode='token',calls=0;
 const app=await createApp({store,port:47945,oauthFetch:async(url)=>{
  calls++;
  if(url.includes('/token'))return {ok:mode!=='token',json:async()=>({access_token:'fictional-access',...(mode!=='persistent_access'?{refresh_token:'fictional-refresh'}:{}),expires_in:3600})};
  return {ok:mode!=='profile',json:async()=>({emailAddress:'fictional@example.test'})};
 }});
 const server=createServer(app);await new Promise(r=>server.listen(47945,'127.0.0.1',r));
 const base='http://127.0.0.1:47945',headers={Authorization:'Bearer '+store.state.token,'Content-Type':'application/json'};
 try{
  for(mode of ['token','profile','persistent_access','success']){
   const prepared=await(await fetch(base+'/api/oauth/prepare',{method:'POST',headers,body:JSON.stringify({provider:'gmail'})})).json();
   const state=new URL(prepared.url).searchParams.get('state');
   const response=await fetch(base+'/api/oauth/callback?'+new URLSearchParams({state,code:'fictional-code'}));
   const body=await response.text();assert.doesNotMatch(body,/fictional-(secret|access|refresh|code)/);
   assert.equal(response.status,mode==='success'?200:400);
   assert.match(body,mode==='token'?/Token exchange failed/:mode==='profile'?/Cannot verify the mailbox/:mode==='persistent_access'?/Persistent access/:/Account connected/);
   assert.equal(store.state.accounts.length,mode==='success'?1:0);
  }
  assert.equal(store.state.accounts[0].refreshToken,'fictional-refresh');
  const before=calls;assert.equal((await fetch(base+'/api/oauth/callback?state=expired&code=fictional')).status,400);assert.equal(calls,before);
 }finally{await new Promise(r=>server.close(r));}
});
