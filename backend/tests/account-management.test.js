import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {registerAccountManagement} from '../src/account-management.js';

async function fixture(accounts) {
  const store={state:{accounts:accounts.map(id=>({id}))},async mutate(fn){const copy=structuredClone(this.state);const result=await fn(copy);this.state=copy;return result;}};
  const app=express();app.use(express.json());registerAccountManagement(app,store);
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  return {store,url:`http://127.0.0.1:${server.address().port}/api/accounts/order`,close:()=>new Promise(resolve=>server.close(resolve))};
}

test('account order requires the complete unique id set and persists requested order',async()=>{
  const f=await fixture(['a','b','c']);
  try {
    const response=await fetch(f.url,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({ids:['c','a','b']})});
    assert.equal(response.status,200);assert.deepEqual(f.store.state.accounts.map(a=>a.id),['c','a','b']);
    const incomplete=await fetch(f.url,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({ids:['a','b']})});assert.equal(incomplete.status,409);
    const duplicate=await fetch(f.url,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({ids:['a','a','b']})});assert.equal(duplicate.status,400);
  } finally {await f.close();}
});

test('account order rejects a list made stale by a concurrent account change',async()=>{
  const f=await fixture(['a','b']);
  try {
    f.store.state.accounts.push({id:'new'});
    const response=await fetch(f.url,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({ids:['b','a']})});
    assert.equal(response.status,409);assert.deepEqual(f.store.state.accounts.map(a=>a.id),['a','b','new']);
  } finally {await f.close();}
});
