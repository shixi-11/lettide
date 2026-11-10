import {createRequire} from 'node:module';import {fileURLToPath,pathToFileURL} from 'node:url';import path from 'node:path';import os from 'node:os';import {mkdtemp,readFile,rm} from 'node:fs/promises';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),requireDesktop=createRequire(path.join(root,'desktop/package.json')),{_electron}=requireDesktop('playwright');
const executable=process.env.LETTIDE_TEST_EXECUTABLE;if(process.env.CI!=='true'||!executable)throw Error('Run with an installed executable on a disposable CI host');
const dir=await mkdtemp(path.join(os.tmpdir(),'lettide-linux-ui-')),data=path.join(dir,'data'),resources=process.platform==='darwin'?path.resolve(path.dirname(executable),'..','Resources'):path.join(path.dirname(executable),'resources');const env={...process.env,LETTIDE_DATA_DIR:data,XDG_CONFIG_HOME:path.join(dir,'config')};delete env.ELECTRON_RUN_AS_NODE;
let app,client,transport;
try{
 app=await _electron.launch({executablePath:executable,args:['--disable-gpu'],env,timeout:60000});const page=await app.firstWindow();
 const language=JSON.parse(await readFile(path.join(root,'desktop/build-locale.json'),'utf8')).language,name=language==='en'?'Lettide':'叠信';await page.getByRole('heading',{name:language==='en'?'Inbox':'收件箱',exact:true}).waitFor({timeout:45000});
 const runtime=await app.evaluate(({app})=>({version:app.getVersion(),name:app.getName()}));const version=JSON.parse(await readFile(path.join(root,'desktop/package.json'),'utf8')).version;assert.equal(runtime.version,version);assert.equal(runtime.name,name);assert.equal(await page.title(),name);assert.deepEqual(await page.evaluate(()=>({node:typeof window.process,require:typeof window.require})),{node:'undefined',require:'undefined'});
 const license=await readFile(path.join(resources,'LICENSE'),'utf8');assert.equal(license,await readFile(path.join(root,'LICENSE'),'utf8'));assert.match(license,/MIT License/);assert.equal(await readFile(path.join(resources,'THIRD_PARTY_NOTICES'),'utf8'),await readFile(path.join(root,'THIRD_PARTY_NOTICES'),'utf8'));
 await app.evaluate(({shell})=>{globalThis.__lettideTestLinks=[];shell.openExternal=async url=>{globalThis.__lettideTestLinks.push(url);};});
 await page.getByRole('button',{name:language==='en'?'Settings':'设置',exact:true}).click();
 const alerts=page.getByRole('checkbox',{name:language==='en'?/New mail alerts/:/新邮件提醒/});await alerts.waitFor();assert.equal(await alerts.isChecked(),false);
 await page.getByRole('button',{name:language==='en'?'About':'关于',exact:true}).click();
 const about=page.getByRole('region',{name:language==='en'?'About Lettide':'关于叠信'});await about.getByRole('heading',{name,exact:true}).waitFor();
 assert.ok((await about.innerText()).includes(language==='en'?'Shixi Lin':'光之十一'));
 await about.getByRole('button',{name:language==='en'?'Support Lettide':'支持叠信',exact:true}).click();
 await about.getByRole('button',{name:language==='en'?'Source code':'查看源码',exact:true}).click();
 await about.getByRole('button',{name:/MIT License/}).click();
 assert.deepEqual(await app.evaluate(async()=>{const until=Date.now()+5000;while(globalThis.__lettideTestLinks.length<3&&Date.now()<until)await new Promise(r=>setTimeout(r,20));return globalThis.__lettideTestLinks;}),['https://shixilin.com/'+(language==='en'?'en':'zh')+'/support','https://github.com/shixi-11/lettide/tree/v'+version,'https://github.com/shixi-11/lettide/blob/v'+version+'/LICENSE']);
 await app.evaluate(({clipboard})=>clipboard.writeText('fictional previous clipboard value'));
 await about.getByRole('button',{name:language==='en'?'Copy collaboration email':'复制合作邮箱',exact:true}).click();
 await about.getByText(language==='en'?'Email address copied.':'邮箱地址已复制。',{exact:true}).waitFor();
 assert.equal(await app.evaluate(({clipboard})=>clipboard.readText()),'info@elevencapital.ltd');
 await page.getByRole('button',{name:language==='en'?'Close':'关闭',exact:true}).click();
 const {Client}=await import(pathToFileURL(path.join(resources,'backend/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js')).href),{StdioClientTransport}=await import(pathToFileURL(path.join(resources,'backend/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js')).href);
 client=new Client({name:'lettide-linux-fixture',version:'1'});transport=new StdioClientTransport({command:executable,args:[path.join(resources,'backend/src/mcp.js')],env:{...env,ELECTRON_RUN_AS_NODE:'1'},stderr:'pipe'});await client.connect(transport);assert.equal(client.getServerVersion().version,version);const result=await client.callTool({name:'mail_accounts_list',arguments:{}});assert.deepEqual(JSON.parse(result.content.find(c=>c.type==='text').text),[]);await client.close();client=null;await transport.close();transport=null;
 // An old updater or a misconfigured service launch must not raise the live window.
 await app.evaluate(({BrowserWindow})=>{
   const main=BrowserWindow.getAllWindows()[0];
   main.hide();
   globalThis.__lettideShowCount=0;
   main.on('show',()=>globalThis.__lettideShowCount++);
 });
 for(const args of [['--updated'],['--background'],[path.join(resources,'backend/src/mcp.js')]]){
   const launch=spawnSync(executable,args,{env,windowsHide:true,timeout:15000});
   assert.equal(launch.status,0,launch.error?.message||String(launch.stderr));
 }
 assert.deepEqual(await app.evaluate(async({BrowserWindow})=>{
   await new Promise(resolve=>setTimeout(resolve,500));
   return {visible:BrowserWindow.getAllWindows()[0].isVisible(),shows:globalThis.__lettideShowCount};
 }),{visible:false,shows:0});
 const reopen=spawnSync(executable,[],{env,windowsHide:true,timeout:15000});
 assert.equal(reopen.status,0,reopen.error?.message||String(reopen.stderr));
 assert.equal(await app.evaluate(async({BrowserWindow})=>{
   const deadline=Date.now()+5000;
   while(!BrowserWindow.getAllWindows()[0].isVisible()&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,25));
   return BrowserWindow.getAllWindows()[0].isVisible();
 }),true);
 const raw=await readFile(path.join(data,process.platform==='win32'?'state.dpapi':'state.enc'));assert.equal(raw.subarray(0,4).toString(),{win32:'YQ03',darwin:'YQ02',linux:'YQ04'}[process.platform]);await page.screenshot({path:path.join(root,'output',`installed-${process.platform}-${language}.png`)});console.log(JSON.stringify({installedDesktopUI:true,platform:process.platform,language,version,brand:name,rendererIsolated:true,mcpConnected:true,nativeEncryptedStore:true,mitLicenseBundled:true,localizedSupportLinks:true,collaborationEmailCopied:true,desktopAlertsDefaultOff:true,backgroundLaunchStayedHidden:true,manualReopenWorked:true,realMailAccessed:false}));
}finally{await client?.close();await transport?.close();await app?.close();if(process.platform==='linux')spawnSync('secret-tool',['clear','application','com.lettide.store.encryption-key.v1','store',createHash('sha256').update(path.join(data,process.platform==='win32'?'state.dpapi':'state.enc')).digest('hex')],{stdio:'ignore'});await rm(dir,{recursive:true,force:true});}
