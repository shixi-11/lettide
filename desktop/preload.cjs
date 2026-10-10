const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('lettide',{
 desktop:true,
 initialLanguage:ipcRenderer.sendSync('lettide:locale').initialLanguage,
 systemLanguage:ipcRenderer.sendSync('lettide:locale').systemLanguage,
 configureAI:()=>ipcRenderer.invoke('lettide:configure-ai'),
 openExternal:url=>ipcRenderer.invoke('lettide:open-external',url),
 setLanguage:language=>ipcRenderer.invoke('lettide:language',language),
 openAccountManager:()=>ipcRenderer.invoke('lettide:open-account-manager'),
 openAddAccount:()=>ipcRenderer.invoke('lettide:open-add-account'),
 onAddAccountRequest:callback=>{const listener=()=>callback();ipcRenderer.on('lettide:add-account-request',listener);return()=>ipcRenderer.removeListener('lettide:add-account-request',listener);},
});
