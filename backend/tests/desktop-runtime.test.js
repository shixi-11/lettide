import test from 'node:test';import assert from 'node:assert/strict';import {runtimeCommand} from '../src/desktop-runtime.js';
test('native runtimes retain their entry while AppImage starts a fresh stable image',()=>{
 assert.deepEqual(runtimeCommand('/app/backend/src/mcp.js',{platform:'linux',executable:'/app/Lettide',appImage:undefined}),{command:'/app/Lettide',args:['/app/backend/src/mcp.js']});
 const mcp=runtimeCommand('/tmp/.mount-old/resources/backend/src/mcp.js',{platform:'linux',appImage:'/home/example/Lettide.AppImage'});assert.equal(mcp.command,'/home/example/Lettide.AppImage');assert.equal(mcp.args[0],'--appimage-extract-and-run');assert.ok(!mcp.args.join(' ').includes('.mount-old'));assert.match(mcp.args[2],/process\.execPath/);assert.match(mcp.args[2],/mcp\.js/);
 const server=runtimeCommand('server.js',{platform:'linux',appImage:'/home/example/Lettide.AppImage'});assert.match(server.args[2],/m\.runService\(\)/);assert.throws(()=>runtimeCommand('unexpected.js',{platform:'linux',appImage:'/sample.AppImage'}),/Unsupported AppImage entry/);
});

test('assistant data overrides are absolute and do not change with its working directory',async()=>{
 const {mcpTarget}=await import('../../scripts/Configure-AI.mjs');const {dataDirectory}=await import('../src/store.js');const old=process.env.LETTIDE_DATA_DIR,original=process.cwd();
 try{process.env.LETTIDE_DATA_DIR='fictional-relative-mail';const target=mcpTarget();assert.equal(target.env.LETTIDE_DATA_DIR,dataDirectory());assert.ok((await import('node:path')).isAbsolute(target.env.LETTIDE_DATA_DIR));process.chdir((await import('node:os')).tmpdir());process.env.LETTIDE_DATA_DIR=target.env.LETTIDE_DATA_DIR;assert.equal(dataDirectory(),target.env.LETTIDE_DATA_DIR);}finally{process.chdir(original);if(old===undefined)delete process.env.LETTIDE_DATA_DIR;else process.env.LETTIDE_DATA_DIR=old;}
});
