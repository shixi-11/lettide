const {app, BrowserWindow, shell, dialog, ipcMain, nativeTheme}=require('electron');
const {spawn}=require('node:child_process');
const path=require('node:path');
const fs=require('node:fs');
const base='http://127.0.0.1:47831';
const root=app.isPackaged?process.resourcesPath:path.resolve(__dirname,'..');
let window;
app.setName('Lettide');
app.setAppUserModelId('com.lettide.desktop');
function external(url){try{const u=new URL(url);if(u.protocol==='https:'||u.protocol==='http:')void shell.openExternal(u.href);}catch{}}
async function startService(){
  try{const r=await fetch(base+'/',{signal:AbortSignal.timeout(1500)});if(r.ok)return;}catch{}
  const logs=path.join(process.env.LOCALAPPDATA||app.getPath('userData'),'Lettide','logs');fs.mkdirSync(logs,{recursive:true});
  const out=fs.openSync(path.join(logs,'service.log'),'a');const err=fs.openSync(path.join(logs,'service-error.log'),'a');
  const child=spawn(process.execPath,[path.join(root,'backend','src','server.js')],{cwd:root,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,detached:true,stdio:['ignore',out,err]});
  child.unref();fs.closeSync(out);fs.closeSync(err);
  for(let i=0;i<80;i++){await new Promise(r=>setTimeout(r,250));try{const r=await fetch(base+'/',{signal:AbortSignal.timeout(1500)});if(r.ok)return;}catch{}}
  throw new Error('邮箱服务未能启动，请查看本机 Lettide 日志。');
}
function openWindow(){
  window=new BrowserWindow({width:1480,height:960,minWidth:800,minHeight:600,title:'叠信 · Lettide',backgroundColor:nativeTheme.shouldUseDarkColors?'#151820':'#f4f7fc',show:false,autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  window.setMenu(null);
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
    ipcMain.handle('lettide:configure-ai',async(event)=>{
      if(event.sender!==window?.webContents||new URL(event.senderFrame.url).origin!==base)throw new Error('请求来源无效');
      const script=path.join(root,'scripts','Configure-AI.ps1');
      return await new Promise(resolve=>{
        const ps=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',script],{windowsHide:true,env:{...process.env,LETTIDE_EXECUTABLE:app.isPackaged?process.execPath:'',ELECTRON_RUN_AS_NODE:''}});
        let failed=false;ps.on('error',()=>{failed=true;resolve({ok:false,message:'无法打开配置工具，请运行项目中的连接AI助手.cmd。'});});
        ps.on('exit',code=>{if(!failed)resolve({ok:code===0,message:code===0?'已配置找到的客户端，重启对应客户端后可用。':'配置未完成，请运行连接AI助手.cmd 查看提示。'});});
      });
    });
    try{await startService();openWindow();}catch(e){dialog.showErrorBox('叠信启动失败',e.message);app.quit();}
  });
  app.on('activate',()=>{if(!window)openWindow();});
  app.on('window-all-closed',()=>app.quit());
}
