import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mergeClaudeDesktopConfig} from '../../scripts/Configure-AI.mjs';
import {createCodec,deleteKeychainItem} from '../src/macos-crypto.js';

test('macOS Claude Desktop config merge preserves unrelated MCP servers and settings',()=>{
  const result=JSON.parse(mergeClaudeDesktopConfig(JSON.stringify({theme:'dark',mcpServers:{other:{command:'other-tool',args:['serve']}}}),{command:'/Applications/Lettide.app/Contents/MacOS/Lettide',args:['/Applications/Lettide.app/Contents/Resources/backend/src/mcp.js'],env:{ELECTRON_RUN_AS_NODE:'1'}}));
  assert.equal(result.theme,'dark');
  assert.deepEqual(result.mcpServers.other,{command:'other-tool',args:['serve']});
  assert.equal(result.mcpServers.lettide.env.ELECTRON_RUN_AS_NODE,'1');
  assert.throws(()=>mergeClaudeDesktopConfig('{invalid',{command:'lettide',args:[]}));
});

test('macOS Keychain stores and retrieves a fresh AES key for an isolated test item',{skip:process.platform!=='darwin'},async()=>{
  const identity={service:`com.lettide.test.${randomUUID()}`,account:`test-${randomUUID()}`},codec=createCodec(identity),payload=Buffer.from('fictional-only-keychain-roundtrip');let created=false;
  try{
    const encrypted=await codec.protect(payload);
    created=true;
    assert.equal(encrypted.subarray(0,4).toString(),'YQ02');
    assert.deepEqual(await codec.unprotect(encrypted),payload);
    const corrupted=Buffer.from(encrypted);corrupted[corrupted.length-1]^=1;
    await assert.rejects(codec.unprotect(corrupted),/Keychain protected storage failed/);
  }finally{if(created)await deleteKeychainItem(identity);else try{await deleteKeychainItem(identity);}catch{}}
});
