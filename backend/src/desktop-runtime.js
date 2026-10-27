import path from 'node:path';

// Extraction chatter must never enter MCP stdout. Each service owns a separate
// extraction, which survives unrelated mail-window or assistant processes.
const launcher=[
  "set -eu",
  "image=$1",
  "shift",
  "work=$(mktemp -d \"${TMPDIR:-/tmp}/lettide-appimage.XXXXXXXX\")",
  "child=",
  "cleanup() { rm -rf -- \"$work\"; }",
  "stop() { if [ -n \"$child\" ]; then kill \"$child\" 2>/dev/null || true; wait \"$child\" 2>/dev/null || true; fi; exit 143; }",
  "trap cleanup EXIT",
  "trap stop INT TERM",
  "cd \"$work\"",
  "\"$image\" --appimage-extract >/dev/null",
  "binary=\"$work/squashfs-root/Lettide\"",
  "test -f \"$binary\" && test -x \"$binary\"",
  "exec 3<&0",
  "APPIMAGE=\"$image\" ELECTRON_RUN_AS_NODE=1 \"$binary\" \"$@\" <&3 3<&- &",
  "child=$!",
  "exec 3<&-",
  "status=0",
  "wait \"$child\" || status=$?",
  "exit \"$status\""
].join('\n');
export function appImageRuntimeCommand(image,nodeArgs){
  if(!path.isAbsolute(image||''))throw new Error('AppImage path must be absolute');
  return {command:'/bin/sh',args:['-c',launcher,'lettide-appimage',image,...nodeArgs]};
}
export function runtimeCommand(entry,{platform=process.platform,executable=process.execPath,appImage=process.env.APPIMAGE}={}){
  if(platform==='linux'&&appImage){
    const name=path.basename(entry);if(!['server.js','mcp.js'].includes(name))throw new Error('Unsupported AppImage entry');
    const code=`import(require('node:url').pathToFileURL(require('node:path').join(require('node:path').dirname(process.execPath),'resources','backend','src',${JSON.stringify(name)})).href).then(m=>${name==='server.js'?'m.runService()':'undefined'}).catch(e=>{console.error(e.message);process.exitCode=1})`;
    return appImageRuntimeCommand(appImage,['-e',code]);
  }
  return {command:executable,args:[entry]};
}
