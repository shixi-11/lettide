const contactEmail='info@elevencapital.ltd';
function registerContactClipboard(ipcMain,clipboard,allowed){
 ipcMain.handle('lettide:copy-contact-email',event=>{
  if(!allowed(event))throw new Error('Invalid source');
  clipboard.writeText(contactEmail);
  return {ok:true};
 });
}
module.exports={registerContactClipboard};
