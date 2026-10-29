const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('lettide',{
 desktop:true,
 updateState:()=>ipcRenderer.invoke('lettide:update-state'),
 checkForUpdates:()=>ipcRenderer.invoke('lettide:check-update'),
 downloadUpdate:()=>ipcRenderer.invoke('lettide:download-update'),
 installUpdate:()=>ipcRenderer.invoke('lettide:install-update'),
 onUpdateState:callback=>{const listener=(_event,value)=>callback(value);ipcRenderer.on('lettide:update-state',listener);return()=>ipcRenderer.removeListener('lettide:update-state',listener);},
 onPrepareUpdate:callback=>{const listener=async(_event,{requestId})=>{let ok=false;try{ok=await callback()===true}catch{}ipcRenderer.send('lettide:update-prepared',{requestId,ok});};ipcRenderer.on('lettide:prepare-update',listener);return()=>ipcRenderer.removeListener('lettide:prepare-update',listener);},
 initialLanguage:ipcRenderer.sendSync('lettide:locale').initialLanguage,
 systemLanguage:ipcRenderer.sendSync('lettide:locale').systemLanguage,
 configureAI:()=>ipcRenderer.invoke('lettide:configure-ai'),
 openExternal:url=>ipcRenderer.invoke('lettide:open-external',url),
 setLanguage:language=>ipcRenderer.invoke('lettide:language',language),
 openAccountManager:()=>ipcRenderer.invoke('lettide:open-account-manager'),
 openAddAccount:()=>ipcRenderer.invoke('lettide:open-add-account'),
 onAddAccountRequest:callback=>{const listener=()=>callback();ipcRenderer.on('lettide:add-account-request',listener);return()=>ipcRenderer.removeListener('lettide:add-account-request',listener);},
});
