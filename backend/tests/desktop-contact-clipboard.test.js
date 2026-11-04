import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {registerContactClipboard}=createRequire(import.meta.url)('../../desktop/contact-clipboard.cjs');
test('only a trusted app frame can copy the fixed public contact address',()=>{
 let handler;const writes=[],trusted={frame:'main'};
 registerContactClipboard({handle:(name,fn)=>{assert.equal(name,'lettide:copy-contact-email');handler=fn;}},{writeText:value=>writes.push(value)},event=>event===trusted);
 assert.throws(()=>handler({frame:'email'}),/Invalid source/);assert.deepEqual(writes,[]);
 assert.deepEqual(handler(trusted,'attacker-controlled text'),{ok:true});assert.deepEqual(writes,['info@elevencapital.ltd']);
});
test('clipboard failures stay visible to the caller instead of reporting success',()=>{
 let handler;registerContactClipboard({handle:(_name,fn)=>handler=fn},{writeText:()=>{throw Error('Clipboard unavailable')}},()=>true);
 assert.throws(()=>handler({}),/Clipboard unavailable/);
});
