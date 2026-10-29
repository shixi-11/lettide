import {test} from 'node:test';
import assert from 'node:assert/strict';
import {syncAccount,loadMessageBody,loadAttachment} from '../src/mail.js';

test('Gmail lists metadata with bounded concurrency and loads one body and its attachments on demand',async()=>{
 const account={id:'g',provider:'gmail',email:'fictional@example.test',accessToken:'mock',expiresAt:Date.now()+3600000,folders:[{id:'inbox',role:'inbox',providerId:'INBOX'}]};
 const state={accounts:[account],messages:[],settings:{}},calls=[];let active=0,peak=0,unread=true;
 const deps={metadataOnly:true,fetchImpl:async url=>{
  const u=new URL(url);calls.push(u);
  if(u.pathname.endsWith('/messages'))return Response.json({messages:Array.from({length:12},(_,i)=>({id:'m'+i}))});
  if(u.pathname.includes('/attachments/'))return Response.json({data:Buffer.from('fictional attachment').toString('base64url')});
  assert.ok(!u.pathname.endsWith('/labels'),'Reuse the account folder cache');
  const id=u.pathname.split('/').at(-1),format=u.searchParams.get('format');active++;peak=Math.max(peak,active);
  await new Promise(r=>setTimeout(r,2));active--;
  const headers=[{name:'Subject',value:'Fictional note '+id},{name:'From',value:'Sender <sender@example.test>'},{name:'Message-ID',value:'<'+id+'@example.test>'}];
  return Response.json({id,threadId:'t'+id,internalDate:'1700000000000',labelIds:unread?['INBOX','UNREAD']:['INBOX'],snippet:'Preview only',payload:{headers,...(format==='full'?{parts:[{mimeType:'text/plain',body:{data:Buffer.from('Complete fictional body').toString('base64url')}},{filename:'file.txt',body:{attachmentId:'a1',size:20}}]}:{})}});
 }};
 await syncAccount(state,account,'inbox','',60,deps);
 assert.equal(state.messages.length,12);assert.equal(peak,4);
 assert.equal(calls.filter(u=>u.searchParams.get('format')==='full').length,0);
 assert.equal(calls.filter(u=>u.pathname.includes('/attachments/')).length,0);
 assert.ok(state.messages.every(m=>m.bodyLoaded===false&&m.text==='Preview only'));
 const message=state.messages[0];await loadMessageBody(state,message,deps);
 assert.equal(message.bodyLoaded,true);assert.equal(message.text,'Complete fictional body');assert.equal(message.attachments.length,1);
 assert.equal(calls.filter(u=>u.pathname.includes('/attachments/')).length,0);
 assert.equal((await loadAttachment(state,message,message.attachments[0],deps)).toString(),'fictional attachment');
 await loadMessageBody(state,message,deps);assert.equal(calls.filter(u=>u.searchParams.get('format')==='full').length,1);
 unread=false;await syncAccount(state,account,'inbox','',60,deps);
 assert.equal(state.messages[0].text,'Complete fictional body');assert.equal(state.messages[0].bodyLoaded,true);assert.equal(state.messages[0].unread,false);
 assert.equal(calls.filter(u=>u.searchParams.get('format')==='full').length,1);
});

test('A failed Gmail body read preserves metadata and remains retryable',async()=>{
 const account={id:'g',provider:'gmail',accessToken:'mock',expiresAt:Date.now()+3600000};
 const message={id:'g:gmail:m',accountId:'g',providerRef:{type:'gmail',id:'m'},text:'Preview',bodyLoaded:false,attachments:[]};
 await assert.rejects(loadMessageBody({accounts:[account],settings:{}},message,{fetchImpl:async()=>new Response('',{status:404})}),/Gmail API/);
 assert.equal(message.bodyLoaded,false);assert.equal(message.text,'Preview');
});
