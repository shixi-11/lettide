$ErrorActionPreference = 'Stop'
$mailRoot = Split-Path $PSScriptRoot -Parent
$mailPnpmCommand = Get-Command pnpm -ErrorAction SilentlyContinue
$mailPnpm = if ($mailPnpmCommand) {$mailPnpmCommand.Source} else {Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd'}
if (!(Test-Path -LiteralPath $mailPnpm)) { throw '需要 Node.js 24 和 pnpm。安装后重新运行。' }
foreach ($component in @('backend','web','desktop')) {
 Push-Location (Join-Path $mailRoot $component)
 try { & $mailPnpm install --frozen-lockfile; if ($LASTEXITCODE -ne 0) {throw ('依赖安装失败：'+$component)} } finally {Pop-Location}
}
Push-Location (Join-Path $mailRoot 'desktop')
try {node node_modules/electron/install.js; if ($LASTEXITCODE -ne 0) {throw '桌面运行时安装失败。'}} finally {Pop-Location}
Push-Location (Join-Path $mailRoot 'web')
try {& $mailPnpm run build; if ($LASTEXITCODE -ne 0) {throw '界面构建失败。'}} finally {Pop-Location}
Push-Location (Join-Path $mailRoot 'desktop')
try {& $mailPnpm run pack; if ($LASTEXITCODE -ne 0) {throw '桌面程序构建失败。'}} finally {Pop-Location}
Write-Host '安装完成。双击 启动邮箱.cmd 开始使用。'
