import path from 'node:path';

// AppImage mounts are temporary. Launch a fresh, self-owned extraction for every
// service so assistants keep working after the mail window closes.
export function runtimeCommand(entry,{platform=process.platform,executable=process.execPath,appImage=process.env.APPIMAGE}={}){
  if(platform==='linux'&&appImage){
    if(!['server.js','mcp.js'].includes(path.basename(entry)))throw new Error('Unsupported AppImage entry');
    const code=`import(require('node:url').pathToFileURL(require('node:path').join(require('node:path').dirname(process.execPath),'resources','backend','src',${JSON.stringify(path.basename(entry))})).href).then(m=>${path.basename(entry)==='server.js'?'m.runService()':'undefined'}).catch(e=>{console.error(e.message);process.exitCode=1})`;
    return {command:appImage,args:['--appimage-extract-and-run','-e',code]};
  }
  return {command:executable,args:[entry]};
}
