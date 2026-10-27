import test from 'node:test';import assert from 'node:assert/strict';import {runtimeCommand,appImageRuntimeCommand} from '../src/desktop-runtime.js';
test('native runtimes retain their entry while AppImage starts a fresh stable image',()=>{
 assert.deepEqual(runtimeCommand('/app/backend/src/mcp.js',{platform:'linux',executable:'/app/Lettide',appImage:undefined}),{command:'/app/Lettide',args:['/app/backend/src/mcp.js']});
 const mcp=runtimeCommand('/tmp/.mount-old/resources/backend/src/mcp.js',{platform:'linux',appImage:'/home/example/Lettide.AppImage'});assert.equal(mcp.command,'/bin/sh');assert.equal(mcp.args[0],'-c');assert.ok(mcp.args.includes('/home/example/Lettide.AppImage'));assert.ok(!mcp.args.join(' ').includes('.mount-old'));assert.match(mcp.args.at(-1),/process\.execPath/);assert.match(mcp.args.at(-1),/mcp\.js/);
 const server=runtimeCommand('server.js',{platform:'linux',appImage:'/home/example/Lettide.AppImage'});assert.match(server.args.at(-1),/m\.runService\(\)/);assert.throws(()=>runtimeCommand('unexpected.js',{platform:'linux',appImage:'/sample.AppImage'}),/Unsupported AppImage entry/);
});

test('assistant data overrides are absolute and do not change with its working directory',async()=>{
 const {mcpTarget}=await import('../../scripts/Configure-AI.mjs');const {dataDirectory}=await import('../src/store.js');const old=process.env.LETTIDE_DATA_DIR,original=process.cwd();
 try{process.env.LETTIDE_DATA_DIR='fictional-relative-mail';const target=mcpTarget();assert.equal(target.env.LETTIDE_DATA_DIR,dataDirectory());assert.ok((await import('node:path')).isAbsolute(target.env.LETTIDE_DATA_DIR));process.chdir((await import('node:os')).tmpdir());process.env.LETTIDE_DATA_DIR=target.env.LETTIDE_DATA_DIR;assert.equal(dataDirectory(),target.env.LETTIDE_DATA_DIR);}finally{process.chdir(original);if(old===undefined)delete process.env.LETTIDE_DATA_DIR;else process.env.LETTIDE_DATA_DIR=old;}
});

test('AppImage extraction stays quiet, forwards stdin and removes only its own extraction', {skip:process.platform!=='linux'},async()=>{
 const fs=await import('node:fs/promises'),path=await import('node:path'),os=await import('node:os'),{spawn}=await import('node:child_process');const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lettide-image-fixture-'));const image=path.join(dir,'fixture.AppImage');
 try{
  const fake="#!/bin/sh\nset -eu\ntest \"$1\" = --appimage-extract\necho 'extraction chatter must not reach MCP'\nmkdir squashfs-root\nprintf '#!/bin/sh\\nexec \"$LETTIDE_TEST_NODE\" \"$@\"\\n' > squashfs-root/Lettide\nchmod +x squashfs-root/Lettide\n";await fs.writeFile(image,fake,{mode:0o700});
  const code="process.stdin.setEncoding('utf8');let text='';process.stdin.on('data',c=>text+=c);process.stdin.on('end',()=>console.log(JSON.stringify({received:text})));";const target=appImageRuntimeCommand(image,['-e',code]);assert.ok(target.args[1].includes('\n'));
  const child=spawn(target.command,target.args,{env:{...process.env,TMPDIR:dir,LETTIDE_TEST_NODE:process.execPath},stdio:['pipe','pipe','pipe']});let output='',errors='';child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>errors+=c);const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});child.stdin.end('fictional handshake');const timer=setTimeout(()=>child.kill(),10000);let status;try{status=await done;}finally{clearTimeout(timer);}assert.equal(status,0,errors);assert.deepEqual(JSON.parse(output.trim()),{received:'fictional handshake'});assert.deepEqual((await fs.readdir(dir)).filter(n=>n.startsWith('lettide-appimage.')),[]);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
