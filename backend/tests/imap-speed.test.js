import {test} from 'node:test';
import assert from 'node:assert/strict';
import {syncAccount,loadMessageBody} from '../src/mail.js';

const account=()=>({id:'qq',provider:'qq',email:'fictional@example.test',password:'fictional',folders:[{id:'inbox',role:'inbox',providerId:'INBOX'}]});
function fixture({validity='7',source}={}){
 const a=account(),state={accounts:[a],messages:[],settings:{}},calls=[];
 const deps={metadataOnly:true,imapClientFactory:()=>({mailbox:{exists:1,uidValidity:validity},connect:async()=>{},logout:async()=>{},list:async()=>{throw Error('Cached folder path must avoid LIST')},getMailboxLock:async()=>({release(){}}),fetch:async function*(range,fields){calls.push({range,fields});yield {uid:9,flags:new Set(['\\Seen']),envelope:{subject:'Fictional note',from:[{address:'sender@example.test'}],to:[{address:a.email}],date:new Date('2026-10-10'),messageId:'<fictional@example.test>'}}},fetchOne:async(uid,fields,options)=>{calls.push({uid,fields,options});return {source:source||Buffer.from('From: Sender <sender@example.test>\r\nTo: fictional@example.test\r\nSubject: Fictional note\r\nMessage-ID: <fictional@example.test>\r\n\r\nFull fictional body')}}})};return {a,state,deps,calls};
}
test('First IMAP folder sync downloads headers only, then opens and caches one body',async()=>{
 const {a,state,deps,calls}=fixture();await syncAccount(state,a,'inbox','',60,deps);
 const m=state.messages[0];assert.equal(m.subject,'Fictional note');assert.equal(m.bodyLoaded,false);assert.equal(m.text,'');assert.equal(calls.length,1);assert.equal(calls[0].fields.source,undefined);assert.deepEqual(m.folderIds,['inbox']);
 await loadMessageBody(state,m,deps);assert.equal(m.bodyLoaded,true);assert.equal(m.text,'Full fictional body');assert.deepEqual(calls[1],{uid:9,fields:{source:true},options:{uid:true}});await loadMessageBody(state,m,deps);assert.equal(calls.length,2);
 await syncAccount(state,a,'inbox','',60,deps);assert.equal(state.messages[0].text,'Full fictional body');assert.equal(state.messages[0].bodyLoaded,true);assert.equal(state.messages[0].unread,false);assert.equal(calls.filter(c=>c.fields.source).length,1);
});
test('Changed UID validity invalidates cached content and blocks an obsolete body read',async()=>{
 const {a,state,deps}=fixture({validity:'8'});const old={id:'qq:imap:INBOX:9',accountId:'qq',folderIds:['inbox'],text:'Old fictional body',providerRef:{type:'imap',uid:9,folder:'INBOX',uidValidity:'7'},bodyLoaded:false};state.messages=[old];
 await assert.rejects(loadMessageBody(state,old,deps),/UID validity changed/);await syncAccount(state,a,'inbox','',60,deps);assert.equal(state.messages[0].text,'');assert.equal(state.messages[0].bodyLoaded,false);assert.equal(state.messages[0].providerRef.uidValidity,'8');
});
test('Opening a missing remote body does not erase cached metadata',async()=>{
 const {a,state,deps}=fixture();await syncAccount(state,a,'inbox','',60,deps);const m=state.messages[0],base=deps.imapClientFactory;deps.imapClientFactory=()=>({...base(),fetchOne:async()=>false});await assert.rejects(loadMessageBody(state,m,deps),/no longer available/);assert.equal(m.subject,'Fictional note');assert.equal(m.bodyLoaded,false);
});
