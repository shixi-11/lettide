import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {Store} from '../src/store.js';
import {createApp} from '../src/server.js';

test('configured Google and Microsoft browser flows bind PKCE and client ID, save persistent access once and reject replay',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'lettide-oauth-fixture-'));
 const store=await new Store({file:path.join(dir,'state'),codec:{protect:async x=>x,unprotect:async x=>x}}).open();
 const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const app=await createApp({store,port,oauthFetch:(...args)=>globalThis.fetch(...args)}),server=createServer(app);await new Promise(r=>server.listen(port,'127.0.0.1',r));
 const base=`http://127.0.0.1:${port}`,nativeFetch=globalThis.fetch;
 const headers={authorization:`Bearer ${store.state.token}`,'Content-Type':'application/json'};
 let expected,tokenCalls=0;
 globalThis.fetch=async(url,options={})=>{
  const value=String(url);if(value.startsWith(base+'/'))return nativeFetch(url,options);
  if(value==='https://oauth2.googleapis.com/token'||value==='https://login.microsoftonline.com/common/oauth2/v2.0/token'){
   tokenCalls++;const params=new URLSearchParams(options.body);
   assert.equal(params.get('client_id'),expected.client);assert.equal(params.get('code'),'fictional-code');
   assert.equal(params.get('redirect_uri'),base+'/api/oauth/callback');
   assert.equal(createHash('sha256').update(params.get('code_verifier')).digest('base64url'),expected.challenge);
   return Response.json({access_token:'fixture-access-token',refresh_token:'fixture-refresh-token',expires_in:3600});
  }
  if(value.startsWith('https://gmail.googleapis.com/gmail/v1/users/me/profile'))return Response.json({emailAddress:'google-reader@example.test'});
  if(value.startsWith('https://graph.microsoft.com/v1.0/me?'))return Response.json({mail:'microsoft-reader@example.test',displayName:'Fictional reader'});
  throw new Error('Unexpected external request in OAuth fixture');
 };
 try{
  for(const provider of ['gmail','microsoft']){
   const key=provider==='gmail'?'googleClientId':'microsoftClientId',client='fictional-'+provider+'-client';
   await store.mutate(s=>s.settings[key]=client);
   const prepared=await (await nativeFetch(base+'/api/oauth/prepare',{method:'POST',headers,body:JSON.stringify({provider})})).json();
   const url=new URL(prepared.url),state=url.searchParams.get('state');
   assert.equal(url.origin,provider==='gmail'?'https://accounts.google.com':'https://login.microsoftonline.com');
   assert.equal(url.searchParams.get('client_id'),client);assert.equal(url.searchParams.get('code_challenge_method'),'S256');
   assert.ok(url.searchParams.get('scope').includes(provider==='gmail'?'gmail.modify':'Mail.ReadWrite'));
   assert.ok(url.searchParams.get('scope').includes(provider==='gmail'?'gmail.send':'offline_access'));
   expected={client,challenge:url.searchParams.get('code_challenge')};
   await store.mutate(s=>s.settings[key]='changed-after-prepare');
   const callback=base+'/api/oauth/callback?'+new URLSearchParams({state,code:'fictional-code'});
   const response=await nativeFetch(callback);assert.equal(response.status,200);assert.match(await response.text(),/Account connected/);
   assert.equal((await nativeFetch(callback)).status,400);
   const account=store.state.accounts.find(a=>a.provider===provider);assert.equal(account.refreshToken,'fixture-refresh-token');
  }
  assert.equal(tokenCalls,2);assert.equal(store.state.accounts.length,2);
  assert.equal((await nativeFetch(base+'/api/oauth/callback?state=unknown&code=fictional-code')).status,400);assert.equal(tokenCalls,2);
  const publicAccounts=await (await nativeFetch(base+'/api/accounts',{headers})).text();assert.ok(!publicAccounts.includes('fixture-access-token'));assert.ok(!publicAccounts.includes('fixture-refresh-token'));
 }finally{globalThis.fetch=nativeFetch;await new Promise(r=>server.close(r));await store.close();await rm(dir,{recursive:true,force:true});}
});
