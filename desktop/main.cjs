const {app, BrowserWindow, shell, dialog, ipcMain, nativeTheme, Menu, Tray, nativeImage, Notification}=require('electron');
const {spawn}=require('node:child_process');
const path=require('node:path');
const fs=require('node:fs');
const {aiConnectionStatus}=require('./ai-connections.cjs');
const base=!app.isPackaged&&/^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.LETTIDE_TEST_BASE_URL||'')?process.env.LETTIDE_TEST_BASE_URL:'http://127.0.0.1:47831';
let buildLocale='system';try{buildLocale=require('./build-locale.json').language||'system';}catch{}
let language='zh-CN';
const root=app.isPackaged?process.resourcesPath:path.resolve(__dirname,'..');
let updater,pendingInstaller,updateTimer,updateInterval,aiConfiguration;
let window,accountManagerWindow,tray,isQuitting=false,backendStopped=false,quitPending=false,mainReady=false,pendingAddAccount=false;
let mailWatch={timer:null,seen:null,unread:0,notes:new Set()},desktopPrefs={newMailAlerts:true},prefsFile=null;
app.setName(buildLocale==='zh-CN'?'叠信':'Lettide');
app.setPath('userData',path.join(app.getPath('appData'),'Lettide'));
if(!app.isPackaged&&process.env.LETTIDE_TEST_USER_DATA)app.setPath('userData',process.env.LETTIDE_TEST_USER_DATA);
app.setAppUserModelId('com.lettide.desktop');
function external(url){try{const u=new URL(url);if(u.protocol==='https:'||u.protocol==='http:')void shell.openExternal(u.href);}catch{}}
function updateTrayMenu(){
  if(!tray)return;
  const en=language==='en';
  const ready=updater?.snapshot().status==='ready'?updater.snapshot().latestVersion:null;
  const unread=mailWatch.unread?(en?` · ${mailWatch.unread} unread`:` · ${mailWatch.unread} 封未读`):'';
  tray.setToolTip(ready?(en?`Lettide · ${ready} is ready`:`叠信 · 新版本 ${ready} 已准备好`)+unread:(en?'Lettide':'叠信')+unread);
  tray.setContextMenu(Menu.buildFromTemplate([
    {label:en?'Open Lettide':'打开叠信',click:()=>showMainWindow()},
    {label:en?'Manage accounts':'管理邮箱',click:()=>openAccountManagerWindow()},
    {label:en?'New mail alerts':'新邮件提醒',type:'checkbox',checked:desktopPrefs.newMailAlerts,click:item=>setDesktopPrefs({newMailAlerts:item.checked})},
    {type:'separator'},
    ...(ready?[{label:en?`Restart to update to ${ready}`:`重启并更新到 ${ready}`,click:async()=>{const result=await installUpdate();if(result.error)dialog.showErrorBox(en?'Update not installed':'暂未安装更新',result.error);}},{type:'separator'}]:[]),
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
// Preferences live next to the mail data (~/.lettide), not in AppData.
async function loadDesktopPrefs(){
 const {dataDirectory}=await import(require('node:url').pathToFileURL(path.join(root,'backend','src','store.js')).href);
 prefsFile=path.join(!app.isPackaged&&process.env.LETTIDE_TEST_USER_DATA?app.getPath('userData'):dataDirectory(),'desktop-preferences.json');
 try{const saved=JSON.parse(fs.readFileSync(prefsFile,'utf8'));if(typeof saved.newMailAlerts==='boolean')desktopPrefs.newMailAlerts=saved.newMailAlerts;}catch{}
}
function setDesktopPrefs(patch){
 if(typeof patch?.newMailAlerts==='boolean')desktopPrefs.newMailAlerts=patch.newMailAlerts;
 try{if(prefsFile){fs.mkdirSync(path.dirname(prefsFile),{recursive:true});fs.writeFileSync(prefsFile,JSON.stringify(desktopPrefs));}}catch{}
 updateTrayMenu();return {...desktopPrefs};
}
// A small accent dot for the Windows taskbar button; no red, matching the app accent.
function unreadDot(){
 const size=16,data=Buffer.alloc(size*size*4);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){const d=Math.hypot(x+.5-size/2,y+.5-size/2),edge=Math.max(0,Math.min(1,6.5-d)),ring=Math.max(0,Math.min(1,7.5-d)),i=(y*size+x)*4,a=Math.round(255*ring);
  // BGRA, premultiplied: white ring around an accent (#377ffa) dot.
  data[i]=Math.round((0xfa*edge+255*(1-edge))*ring);data[i+1]=Math.round((0x7f*edge+255*(1-edge))*ring);data[i+2]=Math.round((0x37*edge+255*(1-edge))*ring);data[i+3]=a;}
 return nativeImage.createFromBitmap(data,{width:size,height:size});
}
function showUnread(count){
 if(mailWatch.unread===count)return;mailWatch.unread=count;
 if(process.platform==='darwin'||process.platform==='linux')app.setBadgeCount(count);
 if(process.platform==='win32'&&window&&!window.isDestroyed())window.setOverlayIcon(count?unreadDot():null,count?(language==='en'?`${count} unread`:`${count} 封未读`):'');
 updateTrayMenu();
}
function openMessage(message){showMainWindow();if(mainReady&&window&&!window.isDestroyed())window.webContents.send('lettide:open-message',{id:message.id,accountId:message.accountId});}
function keepNote(note,onClick){mailWatch.notes.add(note);const done=()=>mailWatch.notes.delete(note);note.on('click',()=>{done();onClick();});note.on('close',done);note.show();}
function announceMail(rows){
 if(!Notification.isSupported())return;
 const en=language==='en',sender=m=>m.from?.name||m.from?.address||(en?'Unknown sender':'未知发件人'),subject=m=>m.subject||(en?'(No subject)':'（无主题）');
 const sorted=[...rows].sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));
 if(sorted.length>3){keepNote(new Notification({title:en?`${sorted.length} new emails`:`${sorted.length} 封新邮件`,body:sorted.slice(0,3).map(m=>`${sender(m)}：${subject(m)}`).join('\n')}),showMainWindow);return;}
 for(const m of sorted)keepNote(new Notification({title:sender(m),body:subject(m)}),()=>openMessage(m));
}
// The backend syncs on its own; the desktop shell only watches the unread inbox
// through the same signed-in session as the window. The first round is a baseline.
async function checkMail(){
 if(!window||window.isDestroyed())return;
 try{
  const cookies=await window.webContents.session.cookies.get({url:base});const session=cookies.map(c=>c.name+'='+c.value).join('; ');if(!session)return;
  const response=await fetch(base+'/api/messages?folder=inbox&unread=true&summary=true&limit=200',{headers:{Cookie:session},signal:AbortSignal.timeout(10000)});if(!response.ok)return;
  const {items=[],total=0}=await response.json();showUnread(total);
  if(mailWatch.seen){const fresh=items.filter(m=>!mailWatch.seen.has(m.id)&&Date.now()-Date.parse(m.date)<3*24*60*60*1000);if(fresh.length&&desktopPrefs.newMailAlerts&&!(window.isVisible()&&window.isFocused()))announceMail(fresh);}
  const seen=new Set([...(mailWatch.seen||[]),...items.map(m=>m.id)]);mailWatch.seen=seen.size>5000?new Set(items.map(m=>m.id)):seen;
 }catch{}
}
function startMailWatch(){if(mailWatch.timer)return;void checkMail();mailWatch.timer=setInterval(checkMail,30000);mailWatch.timer.unref?.();}
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
 let announced=null;
 updater.on('change',state=>{
  if(window&&!window.isDestroyed())window.webContents.send('lettide:update-state',state);
  updateTrayMenu();
  // The window often lives hidden in the tray, where the sidebar notice is never seen.
  if(state.status==='ready'&&state.latestVersion&&announced!==state.latestVersion){announced=state.latestVersion;if(!(window?.isVisible()&&window.isFocused())&&Notification.isSupported()){const en=language==='en',note=new Notification({title:en?`Lettide ${state.latestVersion} is ready`:`叠信 ${state.latestVersion} 已准备好`,body:en?'Open Lettide and restart to update.':'打开叠信，点「重启并更新」即可。'});note.on('click',showMainWindow);note.show();}}
 });
 updateTimer=setTimeout(fetchUpdate,8000);updateTimer.unref?.();
 updateInterval=setInterval(fetchUpdate,6*60*60*1000);updateInterval.unref?.();
}
// A found update downloads in the background so the user only has to restart.
async function fetchUpdate(){try{const state=await updater.check();if(state.status==='available')await updater.download();}catch{}}
async function installUpdate(){
 const en=language==='en';let file;try{file=await updater.installer();}catch{return {ok:false,error:en?'The downloaded update is no longer valid. Check for updates again.':'已下载的更新已失效，请重新检查更新。'};}
 if(!await prepareUpdateDraft())return {ok:false,error:en?'Could not save the current draft. Save it before installing.':'当前草稿未能保存，请先保存后再安装。'};
 pendingInstaller=file;setImmediate(()=>app.quit());return {ok:true};
}
async function stopSharedService(sessionCookie){
 const cookies=sessionCookie?null:await window?.webContents.session.cookies.get({url:base});
 const session=sessionCookie||(cookies||[]).map(c=>c.name+'='+c.value).join('; ');if(!session)return;
 const response=await fetch(base+'/api/service/quit',{method:'POST',headers:{Origin:base,Cookie:session,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(5000)});
 if(!response.ok)throw new Error('Could not stop the mail service');
 // A test service has its own store; never wait on the real data lock for it.
 if(base!=='http://127.0.0.1:47831')return;
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
  // Mail pages render in sandboxed frames; any link or refresh that tries to load inside them goes to the browser instead.
  window.webContents.on('will-frame-navigate',event=>{if(event.isMainFrame||/^about:(srcdoc|blank)$/.test(event.url||''))return;event.preventDefault();external(event.url);});
  window.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  window.once('ready-to-show',()=>window.show());
  window.webContents.on('did-finish-load',()=>{mainReady=true;startMailWatch();if(pendingAddAccount){pendingAddAccount=false;window.webContents.send('lettide:add-account-request');}});
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
    ipcMain.handle('lettide:check-update',async event=>{if(!allowed(event))throw new Error('Invalid source');updater.language=language;const state=await updater.check();if(state.status==='available')void updater.download().catch(()=>{});return state;});
    ipcMain.handle('lettide:download-update',event=>{if(!allowed(event))throw new Error('Invalid source');return updater.download();});
    ipcMain.handle('lettide:install-update',async event=>{
      if(!allowed(event))throw new Error('Invalid source');return installUpdate();
    });
    ipcMain.handle('lettide:open-account-manager',event=>{if(!allowed(event))throw new Error('请求来源无效');openAccountManagerWindow();return {ok:true};});
    ipcMain.handle('lettide:open-add-account',event=>{if(event.sender!==accountManagerWindow?.webContents||new URL(event.senderFrame.url).origin!==base)throw new Error('Invalid source');pendingAddAccount=true;showMainWindow();if(mainReady){pendingAddAccount=false;window.webContents.send('lettide:add-account-request');}return {ok:true};});
    ipcMain.handle('lettide:open-external',async(event,url)=>{if(!allowed(event))throw new Error('Invalid source');const u=new URL(url);if(u.protocol!=='https:')throw new Error('Only secure browser links are supported');await shell.openExternal(u.href);return {ok:true};});
    language=(buildLocale==='system'?app.getLocale():buildLocale).startsWith('zh')?'zh-CN':'en';
    if(process.platform==='darwin')Menu.setApplicationMenu(Menu.buildFromTemplate([{label:language==='en'?'Lettide':'叠信',submenu:[{role:'about'},{type:'separator'},{role:'hide'},{role:'hideOthers'},{type:'separator'},{role:'quit'}]},{role:'editMenu'},{role:'windowMenu'}]));
    ipcMain.handle('lettide:configure-ai',async(event)=>{
      if(event.sender!==window?.webContents||new URL(event.senderFrame.url).origin!==base)throw new Error('请求来源无效');
      if(aiConfiguration)return aiConfiguration;
      aiConfiguration=(async()=>{
      const script=path.join(root,'scripts','Configure-AI.ps1');
      const {dataDirectory}=await import(require('node:url').pathToFileURL(path.join(root,'backend','src','store.js')).href);
      return await new Promise(resolve=>{
        const unix=process.platform!=='win32';const ps=spawn(unix?process.execPath:'powershell.exe',unix?[path.join(root,'scripts','Configure-AI.mjs')]:['-NoProfile','-ExecutionPolicy','Bypass','-File',script],{windowsHide:true,env:{...process.env,LETTIDE_DATA_DIR:dataDirectory(),LETTIDE_EXECUTABLE:app.isPackaged?(process.platform==='linux'&&process.env.APPIMAGE?process.env.APPIMAGE:process.execPath):'',LETTIDE_APPIMAGE:process.platform==='linux'&&process.env.APPIMAGE?'1':'',LETTIDE_MCP_ENTRY:path.join(root,'backend','src','mcp.js'),ELECTRON_RUN_AS_NODE:unix?'1':''}});
        let error='setup-failed';ps.stdout.resume();ps.stderr.on('data',chunk=>{const text=chunk.toString();if(/JSON|配置不是有效|configuration is invalid/i.test(text))error='invalid-config';else if(/EACCES|EPERM|Access.*denied|UnauthorizedAccess|拒绝访问/i.test(text))error='permission-denied';});
        ps.on('error',()=>resolve({ok:false,error:'launch-failed'}));
        ps.on('close',code=>resolve({ok:code===0,...(code===0?{}:{error})}));
      });
      })();
      try{return await aiConfiguration}finally{aiConfiguration=null}
    });
    ipcMain.handle('lettide:ai-status',event=>{if(!allowed(event))throw new Error('Invalid source');return aiConnectionStatus();});
    ipcMain.handle('lettide:desktop-prefs',event=>{if(!allowed(event))throw new Error('Invalid source');return {...desktopPrefs};});
    ipcMain.handle('lettide:set-desktop-prefs',(event,patch)=>{if(!allowed(event))throw new Error('Invalid source');return setDesktopPrefs(patch);});
    try{await startService();await loadDesktopPrefs();createTray();openWindow();await setupUpdater();}catch(e){dialog.showErrorBox('叠信启动失败',e.message);app.quit();}
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
