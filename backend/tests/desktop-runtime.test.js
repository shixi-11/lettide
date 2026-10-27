import test from 'node:test';import assert from 'node:assert/strict';import {runtimeCommand} from '../src/desktop-runtime.js';
test('native runtimes retain their entry while AppImage starts a fresh stable image',()=>{
 assert.deepEqual(runtimeCommand('/app/backend/src/mcp.js',{platform:'linux',executable:'/app/Lettide',appImage:undefined}),{command:'/app/Lettide',args:['/app/backend/src/mcp.js']});
 const mcp=runtimeCommand('/tmp/.mount-old/resources/backend/src/mcp.js',{platform:'linux',appImage:'/home/example/Lettide.AppImage'});assert.equal(mcp.command,'/home/example/Lettide.AppImage');assert.equal(mcp.args[0],'--appimage-extract-and-run');assert.ok(!mcp.args.join(' ').includes('.mount-old'));assert.match(mcp.args[2],/process\.execPath/);assert.match(mcp.args[2],/mcp\.js/);
 const server=runtimeCommand('server.js',{platform:'linux',appImage:'/home/example/Lettide.AppImage'});assert.match(server.args[2],/m\.runService\(\)/);assert.throws(()=>runtimeCommand('unexpected.js',{platform:'linux',appImage:'/sample.AppImage'}),/Unsupported AppImage entry/);
});
