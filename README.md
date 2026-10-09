# 叠信 · Lettide

多个邮箱，一处从容处理。支持 Gmail、GoDaddy 与 QQ 邮箱，带正文翻译，可供 Codex、Claude Code 和 Claude Desktop 共用。

## 下载安装

当前预览版本 **0.2.0**。[下载页](https://github.com/shixi-11/lettide/releases/tag/v0.2.0) · [更新记录](CHANGELOG.md) · [English](README.en.md)

| 系统 | 中文版「叠信」 | English “Lettide” |
| --- | --- | --- |
| Windows 10 / 11，64 位 | [下载安装程序](https://github.com/shixi-11/lettide/releases/download/v0.2.0/Lettide-0.2.0-win-x64-zh-CN.exe) | [Download installer](https://github.com/shixi-11/lettide/releases/download/v0.2.0/Lettide-0.2.0-win-x64-en.exe) |
| macOS 12+，Apple 芯片与 Intel 通用 | [下载 DMG](https://github.com/shixi-11/lettide/releases/download/v0.2.0/Lettide-0.2.0-mac-universal-zh-CN.dmg) | [Download DMG](https://github.com/shixi-11/lettide/releases/download/v0.2.0/Lettide-0.2.0-mac-universal-en.dmg) |

Windows 双击安装；macOS 打开 DMG 后把应用拖入「应用程序」。内置运行环境，无需安装 Node.js。中文版与英文版功能相同，可在设置中切换中文、English 或跟随系统。

安装包由 GitHub Actions 构建上传，对应任务完成后链接生效。当前为未签名预览版：Windows 可能提示未知发布者；macOS 未经过 Apple 公证，首次打开可能需在系统「隐私与安全性」中允许。Mac 自动构建与 Keychain 测试不等于真机界面验收。

## 开始使用

1. 添加邮箱。同一平台可添加多个账号。QQ 使用邮箱或号码与授权码；GoDaddy Professional 使用邮箱密码；Gmail 与 Microsoft 365 在默认浏览器授权。
2. Gmail 和 Microsoft 365 首次需有效的 OAuth 应用配置。当前没有附带发行者的授权应用，不能跳过注册步骤；见 [邮箱接入](docs/邮箱接入.md)。QQ 获取授权码的入口已放在连接页面。
3. 点击「翻译」，译文直接显示在旁边，无需翻译密钥、连接助手或安装模型。
4. 需要 AI 时，点击「AI 连接 → 配置 AI 助手」，再重启相应客户端。

连接由本机后台加密保存，正常情况下无需反复登录。授权撤销、密码或组织策略变化时需要重新连接。关闭桌面窗口后，后台继续供助手调用。

## 邮箱功能

- 多账号统一收件箱、筛选、缓存搜索、已读与星标。
- 同步实际文件夹与 Gmail 标签：收件箱、已发送、归档、垃圾邮件、已删除及自建分类。
- 移动、归档与恢复到收件箱；保留 Gmail 同一邮件的多标签关系。
- 原文、译文与对照阅读，译文本机缓存，原文保留。
- 撰写、回复、转发、本机草稿、查看服务商草稿、抄送、密送、附件下载与发送。
- 每封最多 10 个附件，总大小不超过 10 MB。
- 日间、夜间、系统外观，中英文及系统语言。
- MCP 读取、搜索、同步、草稿与显式确认发送工具。

每个文件夹缓存最近 60 封邮件，搜索针对这些缓存。收件箱与已发送约每分钟检查，其他文件夹每分钟分批检查，目录约每十分钟刷新。选择文件夹或点击同步可立即更新当前分类。

批量操作、全历史服务端搜索、HTML 排版编辑、通知、托盘及开机启动仍在后续计划中。发送结果不确定时禁止自动重发，应先检查已发送邮件。

## 翻译与隐私

仅在点击「翻译」时，将当前正文发送给 Google。不发送主题、账号凭据、发件人字段或附件，不后台批量翻译。正文里原本含有的姓名或地址仍是正文的一部分。

使用 Google 匿名网页翻译服务，不属于有 SLA 的 Cloud Translation API。目前不需要密钥，可能受网络、限流与服务调整影响；失败提示重试，不自动改用收费服务。高级助手任务保留 MCP 与本机 Ollama 方式。

Windows 使用当前用户 DPAPI 加密；macOS 使用 Keychain 保存随机密钥，以 AES-256-GCM 加密。数据分别位于 `%LOCALAPPDATA%/Lettide` 与 `~/Library/Application Support/Lettide`。不要上传数据目录、令牌、授权码、客户端备份或 OAuth 密钥。

## 开发与发布

需要 Node.js 24+、pnpm 11.25。分别在 `backend`、`web`、`desktop` 运行 `pnpm install --frozen-lockfile`。

```sh
node --test backend/tests/*.test.js
cd web && pnpm build
cd ../desktop && node node_modules/electron/install.js
cd ..
node scripts/Build-Desktop.mjs          # Windows 中文
node scripts/Build-Desktop.mjs --en     # Windows English
node scripts/Build-Desktop.mjs --mac    # 在 macOS 构建通用中文版
node scripts/Build-Desktop.mjs --mac --en
```

界面测试只用隔离的虚构数据。`tests/ui-smoke.mjs` 使用 Playwright，以 `PLAYWRIGHT_MODULE` 指向本机安装的模块。`output` 不进入 Git。

发布时统一更新三个包的版本与更新记录，验证并提交源码，创建同版本标签与 GitHub Release，再推送标签触发安装包构建。使用者直接下载 Release 安装包即可。

## 许可

[PolyForm Noncommercial 1.0.0](LICENSE)，商业用途需书面授权。项目属于源码公开项目；版权声明见 [NOTICE](NOTICE)，第三方依赖保留各自许可。
