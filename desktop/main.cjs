const {app, BrowserWindow, shell, dialog, ipcMain, nativeTheme, Menu, Tray, nativeImage}=require('electron');
const {spawn}=require('node:child_process');
const path=require('node:path');
const fs=require('node:fs');
const base=!app.isPackaged&&/^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.LETTIDE_TEST_BASE_URL||'')?process.env.LETTIDE_TEST_BASE_URL:'http://127.0.0.1:47831';
let buildLocale='system';try{buildLocale=require('./build-locale.json').language||'system';}catch{}
let language='zh-CN';
const root=app.isPackaged?process.resourcesPath:path.resolve(__dirname,'..');
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
  try{const r=await fetch(base+'/',{signal:AbortSignal.timeout(1500)});if(r.ok)return;}catch{}
  // Same data directory as backend/src/store.js dataDirectory().
  const {dataDirectory}=await import(require('node:url').pathToFileURL(path.join(root,'backend','src','store.js')).href);
  const logs=path.join(dataDirectory(),'logs');fs.mkdirSync(logs,{recursive:true});
  const out=fs.openSync(path.join(logs,'service.log'),'a');const err=fs.openSync(path.join(logs,'service-error.log'),'a');
  const {runtimeCommand}=await import(require('node:url').pathToFileURL(path.join(root,'backend','src','desktop-runtime.js')).href);
  const target=runtimeCommand(path.join(root,'backend','src','server.js'));
  const child=spawn(target.command,target.args,{cwd:root,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,detached:true,stdio:['ignore',out,err]});
  child.unref();fs.closeSync(out);fs.closeSync(err);
  const deadline=Date.now()+120000;
  while(Date.now()<deadline){await new Promise(r=>setTimeout(r,500));try{const r=await fetch(base+'/',{signal:AbortSignal.timeout(1500)});if(r.ok)return;}catch{}}
  throw new Error('邮箱服务未能启动，请查看本机 Lettide 日志。');
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
    ipcMain.handle('lettide:open-account-manager',event=>{if(!allowed(event))throw new Error('请求来源无效');openAccountManagerWindow();return {ok:true};});
    ipcMain.handle('lettide:open-add-account',event=>{if(event.sender!==accountManagerWindow?.webContents||new URL(event.senderFrame.url).origin!==base)throw new Error('Invalid source');pendingAddAccount=true;showMainWindow();if(mainReady){pendingAddAccount=false;window.webContents.send('lettide:add-account-request');}return {ok:true};});
    ipcMain.handle('lettide:open-external',async(event,url)=>{if(!allowed(event))throw new Error('Invalid source');const u=new URL(url);if(u.protocol!=='https:')throw new Error('Only secure browser links are supported');await shell.openExternal(u.href);return {ok:true};});
    language=(buildLocale==='system'?app.getLocale():buildLocale).startsWith('zh')?'zh-CN':'en';
    if(process.platform==='darwin')Menu.setApplicationMenu(Menu.buildFromTemplate([{label:language==='en'?'Lettide':'叠信',submenu:[{role:'about'},{type:'separator'},{role:'hide'},{role:'hideOthers'},{type:'separator'},{role:'quit'}]},{role:'editMenu'},{role:'windowMenu'}]));
    ipcMain.handle('lettide:configure-ai',async(event)=>{
      if(event.sender!==window?.webContents||new URL(event.senderFrame.url).origin!==base)throw new Error('请求来源无效');
      const script=path.join(root,'scripts','Configure-AI.ps1');
      return await new Promise(resolve=>{
        const unix=process.platform!=='win32';const ps=spawn(unix?process.execPath:'powershell.exe',unix?[path.join(root,'scripts','Configure-AI.mjs')]:['-NoProfile','-ExecutionPolicy','Bypass','-File',script],{windowsHide:true,env:{...process.env,LETTIDE_EXECUTABLE:app.isPackaged?(process.platform==='linux'&&process.env.APPIMAGE?process.env.APPIMAGE:process.execPath):'',LETTIDE_APPIMAGE:process.platform==='linux'&&process.env.APPIMAGE?'1':'',LETTIDE_MCP_ENTRY:path.join(root,'backend','src','mcp.js'),ELECTRON_RUN_AS_NODE:unix?'1':''}});
        let failed=false;ps.on('error',()=>{failed=true;resolve({ok:false,message:'无法打开配置工具，请运行项目中的连接AI助手.cmd。'});});
        ps.on('exit',code=>{if(!failed)resolve({ok:code===0,message:code===0?'已配置找到的客户端，重启对应客户端后可用。':'配置未完成，请检查已安装的 AI 客户端。'});});
      });
    });
    try{await startService();createTray();openWindow();}catch(e){dialog.showErrorBox('叠信启动失败',e.message);app.quit();}
  });
  app.on('before-quit',event=>{
    if(backendStopped){isQuitting=true;tray?.destroy();return;}
    event.preventDefault();if(quitPending)return;quitPending=true;
    (async()=>{try{const cookies=await window?.webContents.session.cookies.get({url:base});if(cookies?.length)await fetch(base+'/api/service/quit',{method:'POST',headers:{Origin:base,Cookie:cookies.map(c=>c.name+'='+c.value).join('; '),'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(5000)});}catch{}finally{backendStopped=true;app.quit();}})();
  });
  app.on('activate',()=>{if(!window)openWindow();else showMainWindow();});
  app.on('window-all-closed',()=>{});
}
