const {app, BrowserWindow, shell, dialog, ipcMain, nativeTheme, Menu}=require('electron');
const {spawn}=require('node:child_process');
const path=require('node:path');
const fs=require('node:fs');
const base=!app.isPackaged&&/^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.LETTIDE_TEST_BASE_URL||'')?process.env.LETTIDE_TEST_BASE_URL:'http://127.0.0.1:47831';
let buildLocale='system';try{buildLocale=require('./build-locale.json').language||'system';}catch{}
let language='zh-CN';
const root=app.isPackaged?process.resourcesPath:path.resolve(__dirname,'..');
let window;
app.setName('Lettide');
app.setPath('userData',path.join(app.getPath('appData'),'Lettide'));
if(!app.isPackaged&&process.env.LETTIDE_TEST_USER_DATA)app.setPath('userData',process.env.LETTIDE_TEST_USER_DATA);
app.setAppUserModelId('com.lettide.desktop');
function external(url){try{const u=new URL(url);if(u.protocol==='https:'||u.protocol==='http:')void shell.openExternal(u.href);}catch{}}
async function startService(){
  try{const r=await fetch(base+'/',{signal:AbortSignal.timeout(1500)});if(r.ok)return;}catch{}
  const logs=process.platform==='win32'?path.join(process.env.LOCALAPPDATA,'Lettide','logs'):path.join(app.getPath('userData'),'logs');fs.mkdirSync(logs,{recursive:true});
  const out=fs.openSync(path.join(logs,'service.log'),'a');const err=fs.openSync(path.join(logs,'service-error.log'),'a');
  const child=spawn(process.execPath,[path.join(root,'backend','src','server.js')],{cwd:root,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,detached:true,stdio:['ignore',out,err]});
  child.unref();fs.closeSync(out);fs.closeSync(err);
  for(let i=0;i<80;i++){await new Promise(r=>setTimeout(r,250));try{const r=await fetch(base+'/',{signal:AbortSignal.timeout(1500)});if(r.ok)return;}catch{}}
  throw new Error('邮箱服务未能启动，请查看本机 Lettide 日志。');
}
function openWindow(){
  window=new BrowserWindow({width:1480,height:960,minWidth:800,minHeight:600,title:language==='en'?'Lettide':'叠信',icon:path.join(__dirname,'assets','icon.png'),backgroundColor:nativeTheme.shouldUseDarkColors?'#151820':'#f4f7fc',show:false,autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  if(process.platform!=='darwin')window.setMenu(null);
  window.webContents.setWindowOpenHandler(({url})=>{external(url);return {action:'deny'};});
  const navigation=(event,url)=>{const u=new URL(url);if(u.origin!==base){event.preventDefault();external(url);}};
  window.webContents.on('will-navigate',navigation);window.webContents.on('will-redirect',navigation);
  window.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  window.once('ready-to-show',()=>window.show());
  window.on('closed',()=>{window=null;});
  void window.loadURL(base+'/');
}
if(!app.requestSingleInstanceLock()){app.quit();}else{
  app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.show();window.focus();}});
  app.whenReady().then(async()=>{
    const allowed=event=>event.sender===window?.webContents&&new URL(event.senderFrame.url).origin===base;
    ipcMain.on('lettide:locale',(event)=>{event.returnValue={initialLanguage:buildLocale,systemLanguage:app.getLocale()};});
    ipcMain.handle('lettide:language',(event,value)=>{if(!allowed(event)||!['en','zh-CN'].includes(value))throw new Error('Invalid language');language=value;window.setTitle(value==='en'?'Lettide':'叠信');return {ok:true};});
    ipcMain.handle('lettide:open-external',async(event,url)=>{if(!allowed(event))throw new Error('Invalid source');const u=new URL(url);if(u.protocol!=='https:')throw new Error('Only secure browser links are supported');await shell.openExternal(u.href);return {ok:true};});
    language=(buildLocale==='system'?app.getLocale():buildLocale).startsWith('zh')?'zh-CN':'en';
    if(process.platform==='darwin')Menu.setApplicationMenu(Menu.buildFromTemplate([{label:language==='en'?'Lettide':'叠信',submenu:[{role:'about'},{type:'separator'},{role:'hide'},{role:'hideOthers'},{type:'separator'},{role:'quit'}]},{role:'editMenu'},{role:'windowMenu'}]));
    ipcMain.handle('lettide:configure-ai',async(event)=>{
      if(event.sender!==window?.webContents||new URL(event.senderFrame.url).origin!==base)throw new Error('请求来源无效');
      const script=path.join(root,'scripts','Configure-AI.ps1');
      return await new Promise(resolve=>{
        const mac=process.platform==='darwin';const ps=spawn(mac?process.execPath:'powershell.exe',mac?[path.join(root,'scripts','Configure-AI.mjs')]:['-NoProfile','-ExecutionPolicy','Bypass','-File',script],{windowsHide:true,env:{...process.env,LETTIDE_EXECUTABLE:app.isPackaged?process.execPath:'',LETTIDE_MCP_ENTRY:path.join(root,'backend','src','mcp.js'),ELECTRON_RUN_AS_NODE:mac?'1':''}});
        let failed=false;ps.on('error',()=>{failed=true;resolve({ok:false,message:'无法打开配置工具，请运行项目中的连接AI助手.cmd。'});});
        ps.on('exit',code=>{if(!failed)resolve({ok:code===0,message:code===0?'已配置找到的客户端，重启对应客户端后可用。':'配置未完成，请检查已安装的 AI 客户端。'});});
      });
    });
    try{await startService();openWindow();}catch(e){dialog.showErrorBox('叠信启动失败',e.message);app.quit();}
  });
  app.on('activate',()=>{if(!window)openWindow();});
  app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
}
