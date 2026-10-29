const {app, BrowserWindow, shell, dialog, ipcMain, nativeTheme, Menu, Tray, nativeImage}=require('electron');
const {spawn}=require('node:child_process');
const path=require('node:path');
const fs=require('node:fs');
const base=!app.isPackaged&&/^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.LETTIDE_TEST_BASE_URL||'')?process.env.LETTIDE_TEST_BASE_URL:'http://127.0.0.1:47831';
let buildLocale='system';try{buildLocale=require('./build-locale.json').language||'system';}catch{}
let language='zh-CN';
const root=app.isPackaged?process.resourcesPath:path.resolve(__dirname,'..');
let updater,pendingInstaller,updateTimer,updateInterval;
let window,accountManagerWindow,tray,isQuitting=false,backendStopped=false,quitPending=false,mainReady=false,pendingAddAccount=false;
app.setName(buildLocale==='zh-CN'?'叠信':'Lettide');
app.setPath('userData',path.join(app.getPath('appData'),'Lettide'));
if(!app.isPackaged&&process.env.LETTIDE_TEST_USER_DATA)app.setPath('userData',process.env.LETTIDE_TEST_USER_DATA);
app.setAppUserModelId('com.lettide.desktop');
function external(url){try{const u=new URL(url);if(u.protocol==='https:'||u.protocol==='http:')void shell.openExternal(u.href);}catch{}}
function updateTrayMenu(){
  if(!tray)return;
  const en=language==='en';
  tray.setToolTip(en?'Lettide':'叠信');
  tray.setContextMenu(Menu.buildFromTemplate([
    {label:en?'Open Lettide':'打开叠信',click:()=>showMainWindow()},
    {label:en?'Manage accounts':'管理邮箱',click:()=>openAccountManagerWindow()},
    {type:'separator'},
    {label:en?'Quit Lettide':'退出叠信',click:()=>app.quit()},
  ]));
}
function createTray(){
  const source=nativeImage.createFromPath(path.join(__dirname,'assets','icon.png'));
  const icon=source.resize({width:process.platform==='darwin'?18:16,height:process.platform==='darwin'?18:16});
  if(process.platform==='darwin')icon.setTemplateImage(true);
  tray=new Tray(icon);tray.on('double-click',showMainWindow);tray.on('click',()=>{if(process.platform==='darwin')showMainWindow();});updateTrayMenu();
}
function showMainWindow(){if(!window)return;if(window.isMinimized())window.restore();window.show();window.focus();}
async function startService(){
  let existing;try{existing=await fetch(base+'/',{signal:AbortSignal.timeout(1500)});}catch{}
  if(existing?.ok){
    const session=existing.headers.get('set-cookie')?.split(';')[0];
    if(!session)throw new Error('无法验证现有邮箱服务，请退出旧版叠信后重试。');
    const status=await fetch(base+'/api/status',{headers:{Cookie:session},signal:AbortSignal.timeout(5000)});
    if(!status.ok)throw new Error('现有邮箱服务无法验证，请退出旧版叠信后重试。');
    const current=await status.json();if(current.version===app.getVersion())return;
    await stopSharedService(session);
  }
  // Same data directory as backend/src/store.js dataDirectory().
  const {dataDirectory}=await import(require('node:url').pathToFileURL(path.join(root,'backend','src','store.js')).href);
  const resolvedData=dataDirectory();
  const logs=path.join(resolvedData,'logs');fs.mkdirSync(logs,{recursive:true});
  const out=fs.openSync(path.join(logs,'service.log'),'a');const err=fs.openSync(path.join(logs,'service-error.log'),'a');
  const {runtimeCommand}=await import(require('node:url').pathToFileURL(path.join(root,'backend','src','desktop-runtime.js')).href);
  const target=runtimeCommand(path.join(root,'backend','src','server.js'));
  const child=spawn(target.command,target.args,{cwd:root,env:{...process.env,LETTIDE_DATA_DIR:resolvedData,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,detached:true,stdio:['ignore',out,err]});
  child.unref();fs.closeSync(out);fs.closeSync(err);
  const deadline=Date.now()+120000;
  while(Date.now()<deadline){await new Promise(r=>setTimeout(r,500));try{const r=await fetch(base+'/',{signal:AbortSignal.timeout(1500)});if(r.ok)return;}catch{}}
  throw new Error('邮箱服务未能启动，请查看本机 Lettide 日志。');
}
async function prepareUpdateDraft(){
 if(!window||window.isDestroyed())return true;
 const requestId=require('node:crypto').randomUUID();
 return await new Promise(resolve=>{
  const listener=(event,reply)=>{if(event.sender!==window?.webContents||reply?.requestId!==requestId)return;clearTimeout(timer);ipcMain.removeListener('lettide:update-prepared',listener);resolve(reply.ok===true);};
  const timer=setTimeout(()=>{ipcMain.removeListener('lettide:update-prepared',listener);resolve(false)},15000);
  ipcMain.on('lettide:update-prepared',listener);window.webContents.send('lettide:prepare-update',{requestId});
 });
}
async function setupUpdater(){
 const {DesktopUpdater}=require('./updater.cjs');
 const {dataDirectory}=await import(require('node:url').pathToFileURL(path.join(root,'backend','src','store.js')).href);
 updater=new DesktopUpdater({version:app.getVersion(),language,cacheDir:path.join(dataDirectory(),'updates')});
 updater.on('change',state=>{if(window&&!window.isDestroyed())window.webContents.send('lettide:update-state',state)});
 updateTimer=setTimeout(()=>updater.check(),8000);updateTimer.unref?.();
 updateInterval=setInterval(()=>updater.check(),6*60*60*1000);updateInterval.unref?.();
}
async function stopSharedService(sessionCookie){
 const cookies=sessionCookie?null:await window?.webContents.session.cookies.get({url:base});
 const session=sessionCookie||(cookies||[]).map(c=>c.name+'='+c.value).join('; ');if(!session)return;
 const response=await fetch(base+'/api/service/quit',{method:'POST',headers:{Origin:base,Cookie:session,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(5000)});
 if(!response.ok)throw new Error('Could not stop the mail service');
 // The listener may close before queued writes finish. Wait for the shared
 // writer lock to be removed before an installer can replace its executable.
 const {dataDirectory}=await import(require('node:url').pathToFileURL(path.join(root,'backend','src','store.js')).href);
 const file=path.join(dataDirectory(),process.platform==='win32'?'state.dpapi.lock':'state.enc.lock'),deadline=Date.now()+45000;
 while(fs.existsSync(file)){if(Date.now()>deadline)throw new Error('Mail service is still finishing work');await new Promise(r=>setTimeout(r,200));}
}
function openWindow(){
  window=new BrowserWindow({width:1480,height:960,minWidth:800,minHeight:600,title:language==='en'?'Lettide':'叠信',icon:path.join(__dirname,'assets','icon.png'),backgroundColor:nativeTheme.shouldUseDarkColors?'#151820':'#e0e6ed',show:false,autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  if(process.platform!=='darwin')window.setMenu(null);
  window.webContents.setWindowOpenHandler(({url})=>{external(url);return {action:'deny'};});
  const navigation=(event,url)=>{const u=new URL(url);if(u.origin!==base){event.preventDefault();external(url);}};
  window.webContents.on('will-navigate',navigation);window.webContents.on('will-redirect',navigation);
  window.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  window.once('ready-to-show',()=>window.show());
  window.webContents.on('did-finish-load',()=>{mainReady=true;if(pendingAddAccount){pendingAddAccount=false;window.webContents.send('lettide:add-account-request');}});
  window.on('close',event=>{if(!isQuitting){event.preventDefault();window.hide();}});
  window.on('closed',()=>{window=null;mainReady=false;});
  void window.loadURL(base+'/');
}
function openAccountManagerWindow(){
  if(accountManagerWindow&&!accountManagerWindow.isDestroyed()){if(accountManagerWindow.isMinimized())accountManagerWindow.restore();accountManagerWindow.show();accountManagerWindow.focus();return;}
  accountManagerWindow=new BrowserWindow({width:960,height:760,minWidth:560,minHeight:480,title:language==='en'?'Manage accounts · Lettide':'邮箱管理 · 叠信',icon:path.join(__dirname,'assets','icon.png'),backgroundColor:nativeTheme.shouldUseDarkColors?'#151820':'#e0e6ed',show:false,autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  if(process.platform!=='darwin')accountManagerWindow.setMenu(null);
  accountManagerWindow.webContents.setWindowOpenHandler(({url})=>{external(url);return {action:'deny'};});
  const navigation=(event,url)=>{const u=new URL(url);if(u.origin!==base){event.preventDefault();external(url);}else if(u.pathname!=='/'||u.search!=='?window=accounts'){event.preventDefault();void accountManagerWindow.loadURL(base+'/?window=accounts');}};
  accountManagerWindow.webContents.on('will-navigate',navigation);accountManagerWindow.webContents.on('will-redirect',navigation);
  accountManagerWindow.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  accountManagerWindow.once('ready-to-show',()=>accountManagerWindow?.show());
  accountManagerWindow.on('close',event=>{if(!isQuitting){event.preventDefault();accountManagerWindow.hide();}});
  accountManagerWindow.on('closed',()=>{accountManagerWindow=null;});
  void accountManagerWindow.loadURL(base+'/?window=accounts');
}
if(!app.requestSingleInstanceLock()){app.quit();}else{
  app.on('second-instance',showMainWindow);
  app.whenReady().then(async()=>{
    const allowed=event=>event.sender===window?.webContents&&new URL(event.senderFrame.url).origin===base;
    ipcMain.on('lettide:locale',(event)=>{event.returnValue={initialLanguage:buildLocale,systemLanguage:app.getLocale()};});
    ipcMain.handle('lettide:language',(event,value)=>{const senderAllowed=allowed(event)||event.sender===accountManagerWindow?.webContents&&new URL(event.senderFrame.url).origin===base;if(!senderAllowed||!['en','zh-CN'].includes(value))throw new Error('Invalid language');language=value;window?.setTitle(value==='en'?'Lettide':'叠信');if(accountManagerWindow)accountManagerWindow.setTitle(value==='en'?'Manage accounts · Lettide':'邮箱管理 · 叠信');updateTrayMenu();return {ok:true};});
    ipcMain.handle('lettide:update-state',event=>{if(!allowed(event))throw new Error('Invalid source');return updater?.snapshot()||{status:'idle',currentVersion:app.getVersion()};});
    ipcMain.handle('lettide:check-update',event=>{if(!allowed(event))throw new Error('Invalid source');updater.language=language;return updater.check();});
    ipcMain.handle('lettide:download-update',event=>{if(!allowed(event))throw new Error('Invalid source');return updater.download();});
    ipcMain.handle('lettide:install-update',async event=>{
      if(!allowed(event))throw new Error('Invalid source');const file=await updater.installer(),en=language==='en';
      const answer=await dialog.showMessageBox(window,{type:'question',title:en?'Install update':'安装更新',message:en?'Save your draft and install the downloaded update?':'保存草稿并安装已下载的更新？',detail:en?'Lettide will close. Your accounts, messages and saved drafts stay on this device.':'叠信将关闭；已连接账号、邮件和草稿会保留。',buttons:en?['Install update','Later']:['安装更新','稍后'],defaultId:0,cancelId:1,noLink:true});
      if(answer.response!==0)return {ok:false,cancelled:true};
      if(!await prepareUpdateDraft())return {ok:false,error:en?'Could not save the current draft. Save it before installing.':'当前草稿未能保存，请先保存后再安装。'};
      pendingInstaller=file;setImmediate(()=>app.quit());return {ok:true};
    });
    ipcMain.handle('lettide:open-account-manager',event=>{if(!allowed(event))throw new Error('请求来源无效');openAccountManagerWindow();return {ok:true};});
    ipcMain.handle('lettide:open-add-account',event=>{if(event.sender!==accountManagerWindow?.webContents||new URL(event.senderFrame.url).origin!==base)throw new Error('Invalid source');pendingAddAccount=true;showMainWindow();if(mainReady){pendingAddAccount=false;window.webContents.send('lettide:add-account-request');}return {ok:true};});
    ipcMain.handle('lettide:open-external',async(event,url)=>{if(!allowed(event))throw new Error('Invalid source');const u=new URL(url);if(u.protocol!=='https:')throw new Error('Only secure browser links are supported');await shell.openExternal(u.href);return {ok:true};});
    language=(buildLocale==='system'?app.getLocale():buildLocale).startsWith('zh')?'zh-CN':'en';
    if(process.platform==='darwin')Menu.setApplicationMenu(Menu.buildFromTemplate([{label:language==='en'?'Lettide':'叠信',submenu:[{role:'about'},{type:'separator'},{role:'hide'},{role:'hideOthers'},{type:'separator'},{role:'quit'}]},{role:'editMenu'},{role:'windowMenu'}]));
    ipcMain.handle('lettide:configure-ai',async(event)=>{
      if(event.sender!==window?.webContents||new URL(event.senderFrame.url).origin!==base)throw new Error('请求来源无效');
      const script=path.join(root,'scripts','Configure-AI.ps1');
      const {dataDirectory}=await import(require('node:url').pathToFileURL(path.join(root,'backend','src','store.js')).href);
      return await new Promise(resolve=>{
        const unix=process.platform!=='win32';const ps=spawn(unix?process.execPath:'powershell.exe',unix?[path.join(root,'scripts','Configure-AI.mjs')]:['-NoProfile','-ExecutionPolicy','Bypass','-File',script],{windowsHide:true,env:{...process.env,LETTIDE_DATA_DIR:dataDirectory(),LETTIDE_EXECUTABLE:app.isPackaged?(process.platform==='linux'&&process.env.APPIMAGE?process.env.APPIMAGE:process.execPath):'',LETTIDE_APPIMAGE:process.platform==='linux'&&process.env.APPIMAGE?'1':'',LETTIDE_MCP_ENTRY:path.join(root,'backend','src','mcp.js'),ELECTRON_RUN_AS_NODE:unix?'1':''}});
        let failed=false;ps.on('error',()=>{failed=true;resolve({ok:false,message:'无法打开配置工具，请运行项目中的连接AI助手.cmd。'});});
        ps.on('exit',code=>{if(!failed)resolve({ok:code===0,message:code===0?'已配置找到的客户端，重启对应客户端后可用。':'配置未完成，请检查已安装的 AI 客户端。'});});
      });
    });
    try{await startService();createTray();openWindow();await setupUpdater();}catch(e){dialog.showErrorBox('叠信启动失败',e.message);app.quit();}
  });
  app.on('before-quit',event=>{
    if(backendStopped){isQuitting=true;tray?.destroy();return;}
    event.preventDefault();if(quitPending)return;quitPending=true;
    (async()=>{try{await stopSharedService();}catch(error){if(pendingInstaller){pendingInstaller=null;quitPending=false;dialog.showErrorBox(language==='en'?'Update postponed':'暂未安装更新',language==='en'?'The mail service is still finishing work. Try installing again shortly.':'邮件服务仍在完成当前任务，请稍后再点安装更新。');return;}}
      clearTimeout(updateTimer);clearInterval(updateInterval);
      if(pendingInstaller){const file=pendingInstaller;pendingInstaller=null;try{if(process.platform==='win32'){
        const child=spawn(file,['/S','--updated','--force-run'],{detached:true,stdio:'ignore',windowsHide:true});await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject)});child.unref();
       }else{const error=await shell.openPath(file);if(error)throw new Error(error);}
      }catch(error){quitPending=false;dialog.showErrorBox(language==='en'?'Could not open installer':'无法打开安装程序',error.message);return;}}
      backendStopped=true;app.quit();
    })();
  });
  app.on('activate',()=>{if(!window)openWindow();else showMainWindow();});
  app.on('window-all-closed',()=>{});
}
