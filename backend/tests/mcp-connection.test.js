import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requestWithReconnect,waitForBackend} from '../src/mcp-connection.js';

test('MCP startup waits through a slow service initialization',async()=>{
  let probes=0,started=0;
  await waitForBackend('http://fixture.test',{timeoutMs:1000,intervalMs:1,requestTimeoutMs:10,startBackend:async()=>{started++;},fetchImpl:async()=>++probes<5?Promise.reject(new Error('not ready')):new Response('',{status:200})});
  assert.equal(started,1);assert.equal(probes,5);
});

test('MCP request reconnects once when the backend restarts',async()=>{
  let online=false,reconnects=0,calls=0;
  const response=await requestWithReconnect('http://fixture.test/api/status',{}, {fetchImpl:async()=>{calls++;if(!online)throw new Error('connection closed');return new Response('ok',{status:200});},reconnect:async()=>{reconnects++;online=true;}});
  assert.equal(response.status,200);assert.equal(calls,2);assert.equal(reconnects,1);
});

test('MCP never replays a write after an uncertain connection loss',async()=>{
  let reconnects=0,calls=0;
  await assert.rejects(requestWithReconnect('http://fixture.test/api/drafts/send',()=>({method:'POST'}),{fetchImpl:async()=>{calls++;throw new Error('connection closed');},reconnect:async()=>{reconnects++;}}),/outcome may be uncertain/);
  assert.equal(calls,1);assert.equal(reconnects,1);
});

test('MCP creates fresh request options after reconnect and avoids an extra final reconnect',async()=>{
  let token='old',reconnects=0;const headersSeen=[];
  await assert.rejects(requestWithReconnect('http://fixture.test/api/status',()=>({method:'GET',headers:{authorization:token}}),{maxAttempts:2,fetchImpl:async(_url,options)=>{headersSeen.push(options.headers.authorization);throw new Error('connection closed');},reconnect:async()=>{reconnects++;token='new';}}));
  assert.deepEqual(headersSeen,['old','new']);assert.equal(reconnects,1);
});

test('MCP startup reports a bounded timeout when service never becomes ready',async()=>{
  await assert.rejects(waitForBackend('http://fixture.test',{timeoutMs:5,intervalMs:1,requestTimeoutMs:10,fetchImpl:async()=>{throw new Error('offline');}}),/did not become ready/);
});

test('MCP relaunches a child that exits while the old service releases its writer lock',async()=>{
  let launches=0;
  await waitForBackend('http://fixture.test',{timeoutMs:1000,intervalMs:1,relaunchIntervalMs:0,startBackend:async()=>({exitCode:++launches===1?1:null}),fetchImpl:async()=>launches<2?Promise.reject(new Error('not ready')):new Response('',{status:200})});
  assert.equal(launches,2);
});
