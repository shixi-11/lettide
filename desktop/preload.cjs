const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('lettide',{
 desktop:true,
 initialLanguage:ipcRenderer.sendSync('lettide:locale').initialLanguage,
 systemLanguage:ipcRenderer.sendSync('lettide:locale').systemLanguage,
 configureAI:()=>ipcRenderer.invoke('lettide:configure-ai'),
 openExternal:url=>ipcRenderer.invoke('lettide:open-external',url),
 setLanguage:language=>ipcRenderer.invoke('lettide:language',language),
});
