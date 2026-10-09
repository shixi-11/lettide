$ErrorActionPreference='Stop'
$mailRoot=Split-Path $PSScriptRoot -Parent
$mailExe=Join-Path $mailRoot 'output\desktop\win-unpacked\Lettide.exe'
if(Test-Path -LiteralPath $mailExe){Start-Process -FilePath $mailExe;exit}
$mailElectron=Join-Path $mailRoot 'desktop\node_modules\electron\dist\electron.exe'
if(!(Test-Path -LiteralPath $mailElectron)){throw '请先运行 安装依赖.cmd。'}
Start-Process -FilePath $mailElectron -ArgumentList @('"'+(Join-Path $mailRoot 'desktop')+'"') -WorkingDirectory $mailRoot
