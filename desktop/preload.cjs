const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('lettide',{desktop:true,configureAI:()=>ipcRenderer.invoke('lettide:configure-ai')});
