# 叠信 · Lettide

让来信汇流，让阅读轻一些。

叠信是一款 Windows 桌面邮箱管理器，把多个 Gmail、QQ 和 GoDaddy 邮箱放在同一个收件箱里。日间、夜间与跟随系统三种外观，原文、译文与双栏对照阅读，减少切换账号与语言的负担。

## 使用

构建完成后，双击 `启动邮箱.cmd` 或桌面程序 `Lettide.exe`。安装包可创建「叠信 Lettide」桌面入口。

1. 添加邮箱。QQ 使用邮箱授权码；GoDaddy Professional Email / Titan 使用 IMAP/SMTP；GoDaddy Microsoft 365 与 Gmail 通过官方页面授权。
2. Gmail 与 Microsoft 365 首次使用前，在设置中填写自己的 OAuth 应用信息，具体见 [邮箱接入](docs/邮箱接入.md)。
3. 在「连接 AI 助手」中配置 Codex、Claude Code 和 Claude 桌面端，重启对应客户端后使用邮箱工具。

邮箱授权由本机后台统一加密保存。正常使用时无需反复登录；授权撤销、密码或组织策略变化时，需要重新连接。桌面窗口关闭后，邮箱后台继续运行，供 AI 助手调用；后台每分钟检查新邮件。

## 当前功能

- 多账号统一收件箱、按账号查看、搜索、已读与星标、收信与已发送邮件同步。
- 阅读邮件与下载已有附件，撰写、保存草稿、回复、转发与发送纯文本邮件。
- 原文、译文与对照阅读。可使用本机 Ollama 翻译，也可以由已连接的 AI 助手完成翻译任务。
- 一个 MCP 后台供多个 AI 客户端共享，不在每个客户端重复保存邮箱凭据。
- Windows 用户级 DPAPI 加密保存账号、令牌、邮件缓存与草稿。

当前按每个账号的每个文件夹缓存最近 60 封邮件，搜索针对这些本机缓存。附件发送、全历史搜索、系统托盘与开机启动尚未提供。发送结果不确定时会保留状态并禁止自动重发，需先检查已发送邮件。

## 翻译与 AI

「本机翻译」需要自行安装并启动 [Ollama](https://ollama.com/)，准备设置中填写的模型。默认模型为 `qwen2.5:7b`。此方式无需翻译服务密钥。

「AI 助手翻译」会生成待处理任务。请在 Codex 或 Claude 中提出「完成叠信待处理的翻译」，助手通过 MCP 读取任务并回写译文。它不会在没有助手运行时自动生成译文。使用外部 AI 客户端时，交给该客户端的邮件内容会按该客户端的服务方式处理。

## 开发与构建

需要 Windows、Node.js 24 或以上、pnpm。运行 `安装依赖.cmd` 安装锁定依赖、构建界面及桌面程序。Electron 44 需要额外执行一次 `node node_modules/electron/install.js` 下载桌面运行时，安装脚本已包含该步骤。

```powershell
cd backend
pnpm test
cd ../web
pnpm build
cd ../desktop
pnpm run pack
# 如需安装包
pnpm build
```

`backend` 为邮箱与 MCP 后台，`web` 为桌面阅读界面，`desktop` 为 Electron 窗口与安装构建，`scripts` 为本机启动与客户端配置。生成文件位于 `output`，不进入 Git。

账号数据保存在当前 Windows 用户的 `%LOCALAPPDATA%\Lettide`，不在项目内。不要将此数据目录、客户端配置备份、授权码或 OAuth 密钥提交到仓库。测试仅使用虚构邮箱数据；模拟测试通过不代表真实服务商账号已经接入。

## 许可

源码采用 [PolyForm Noncommercial 1.0.0](LICENSE)，商业用途需另行取得书面授权。该许可包含非商业限制，因此本项目属于源码公开项目，不表述为 OSI 开源。版权声明见 [NOTICE](NOTICE)，第三方依赖保留各自许可。
