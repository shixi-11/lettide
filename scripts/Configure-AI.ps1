param([switch]$DryRun)
$ErrorActionPreference = 'Stop'
$mailRoot = Split-Path $PSScriptRoot -Parent
$mailNodeCommand = Get-Command node -ErrorAction SilentlyContinue
$mailNode = if ($mailNodeCommand) {$mailNodeCommand.Source} else {Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'}
$mailEntry = Join-Path $mailRoot 'backend\src\mcp.js'
$mailElectron = $env:LETTIDE_EXECUTABLE
if (!$mailElectron) {$mailElectron=Join-Path $mailRoot 'output\desktop\win-unpacked\Lettide.exe'}
$mailEnvironment=@()
if (Test-Path -LiteralPath $mailElectron) {$mailNode=$mailElectron;$mailEntry=Join-Path (Split-Path $mailElectron -Parent) 'resources\backend\src\mcp.js';$mailEnvironment=@('--env','ELECTRON_RUN_AS_NODE=1')}
if (!(Test-Path -LiteralPath $mailNode) -or !(Test-Path -LiteralPath $mailEntry)) {throw '找不到邮箱运行环境。'}
$mailBackup = Join-Path $env:LOCALAPPDATA ('Lettide\config-backups\'+(Get-Date -Format 'yyyyMMdd-HHmmss'))
function Save-ConfigBackup([string]$source,[string]$name) {if (!$DryRun -and (Test-Path -LiteralPath $source)) {New-Item -ItemType Directory -Path $mailBackup -Force|Out-Null;Copy-Item -LiteralPath $source -Destination (Join-Path $mailBackup $name)}}
$mailCodex = Get-Command codex -ErrorAction SilentlyContinue
if ($mailCodex) {
 Save-ConfigBackup (Join-Path $env:USERPROFILE '.codex\config.toml') 'codex-config.toml'
 if (!$DryRun) {& $mailCodex.Source mcp add lettide @mailEnvironment -- $mailNode $mailEntry; if ($LASTEXITCODE -ne 0) {throw 'Codex MCP 配置失败。'}}
 Write-Host 'Codex：邮箱 MCP 配置就绪（重载客户端后可用）。'
}
$mailClaude = Get-Command claude -ErrorAction SilentlyContinue
if (!$mailClaude) {$mailClaudeFile=Join-Path $env:USERPROFILE '.local\bin\claude.exe';if(Test-Path -LiteralPath $mailClaudeFile){$mailClaude=Get-Item -LiteralPath $mailClaudeFile}}
if ($mailClaude) {
 Save-ConfigBackup (Join-Path $env:USERPROFILE '.claude.json') 'claude-code.json'
 if (!$DryRun) {
  $mailClaudeExe = if ($mailClaude.Source) {$mailClaude.Source} else {$mailClaude.FullName}
  # Only the mailbox entry is changed; other MCP definitions remain intact.
  $mailExistingClaude=Join-Path $env:USERPROFILE '.claude.json'
  $mailHasEntry=$false
  if(Test-Path -LiteralPath $mailExistingClaude){try{$mailUserConfig=Get-Content -Raw -Encoding UTF8 -LiteralPath $mailExistingClaude|ConvertFrom-Json;$mailHasEntry=[bool]$mailUserConfig.mcpServers.PSObject.Properties['lettide']}catch{throw 'Claude Code 配置不是有效 JSON，未修改。'}}
  if($mailHasEntry){& $mailClaudeExe mcp remove lettide --scope user | Out-Null;if($LASTEXITCODE -ne 0){throw '无法更新 Claude Code 中的叠信入口。'}}
  & $mailClaudeExe mcp add --scope user --transport stdio lettide @mailEnvironment -- $mailNode $mailEntry
  if ($LASTEXITCODE -ne 0) {throw 'Claude Code MCP 配置失败。'}
 }
 Write-Host 'Claude Code：邮箱 MCP 配置就绪（重启会话后可用）。'
}
$mailDesktopPaths=@((Join-Path $env:APPDATA 'Claude\claude_desktop_config.json'))
$mailPackages=Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA 'Packages') -Directory -ErrorAction SilentlyContinue|Where-Object {$_.Name -like 'Claude_*'}
foreach($mailPackage in $mailPackages){$mailDesktopPaths+=Join-Path $mailPackage.FullName 'LocalCache\Roaming\Claude\claude_desktop_config.json'}
$mailDesktopFound=$false
foreach($mailConfig in $mailDesktopPaths) {
 if (!(Test-Path -LiteralPath (Split-Path $mailConfig -Parent))) {continue}
 $mailDesktopFound=$true
 Save-ConfigBackup $mailConfig 'claude-desktop.json'
 try {$mailObj=if(Test-Path -LiteralPath $mailConfig){Get-Content -Raw -Encoding UTF8 -LiteralPath $mailConfig|ConvertFrom-Json}else{[pscustomobject]@{}}}catch{throw 'Claude 配置不是有效 JSON，未修改原文件。'}
 if (!$mailObj.PSObject.Properties['mcpServers']) {$mailObj=Add-Member -InputObject $mailObj -NotePropertyName mcpServers -NotePropertyValue ([pscustomobject]@{}) -PassThru}
 $mailObj.mcpServers=Add-Member -InputObject $mailObj.mcpServers -NotePropertyName 'lettide' -PassThru -NotePropertyValue ([pscustomobject]@{command=$mailNode;args=@($mailEntry);env=if($mailEnvironment.Count){@{ELECTRON_RUN_AS_NODE='1'}}else{@{}}}) -Force
 if (!$DryRun) {$mailObj|ConvertTo-Json -Depth 30|Set-Content -LiteralPath $mailConfig -Encoding utf8}
 Write-Host 'Claude 桌面端：邮箱 MCP 配置就绪（完全退出再启动后可用）。'
}
if (!$mailDesktopFound) {Write-Host '未发现 Claude 桌面端配置目录；安装后再次运行本脚本即可连接。'}
if ($DryRun) {Write-Host '当前为预检查，没有修改任何配置。'}
Write-Host '邮箱授权由本机后台统一保存，配置中不写邮箱密码或令牌。'
