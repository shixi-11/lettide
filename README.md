# 叠信 · Lettide

多个邮箱，一处从容处理。支持 Gmail、Outlook、GoDaddy 与 QQ 邮箱，带正文翻译，可供 Codex、Claude Code 和 Claude Desktop 共用。

## 下载安装

当前预览版本 **0.3.3**。[下载页](https://github.com/shixi-11/lettide/releases/tag/v0.3.3) · [更新记录](CHANGELOG.md) · [English](README.en.md)

| 系统 | 中文版「叠信」 | English “Lettide” |
| --- | --- | --- |
| Windows 10 / 11，64 位 | [下载安装程序](https://github.com/shixi-11/lettide/releases/download/v0.3.3/Lettide-0.3.3-win-x64-zh-CN.exe) | [Download installer](https://github.com/shixi-11/lettide/releases/download/v0.3.3/Lettide-0.3.3-win-x64-en.exe) |
| macOS 12+，Apple 芯片与 Intel 通用 | [下载 DMG](https://github.com/shixi-11/lettide/releases/download/v0.3.3/Lettide-0.3.3-mac-universal-zh-CN.dmg) | [Download DMG](https://github.com/shixi-11/lettide/releases/download/v0.3.3/Lettide-0.3.3-mac-universal-en.dmg) |

Windows 双击安装；macOS 打开 DMG 后把应用拖入「应用程序」。内置运行环境，无需安装 Node.js。中文版与英文版功能相同，可在设置中切换中文、English 或跟随系统。

安装包由 GitHub Actions 构建上传，对应任务完成后链接生效。当前为未签名预览版：Windows 可能提示未知发布者；macOS 未经过 Apple 公证，首次打开可能需在系统「隐私与安全性」中允许。Mac 自动构建与 Keychain 测试不等于真机界面验收。

## 开始使用

1. 添加邮箱。同一平台可添加多个账号。QQ 使用邮箱或号码与授权码；GoDaddy Professional 使用邮箱密码；Gmail 与 Microsoft 365 在默认浏览器授权。左上角点击切换邮箱，账号较多时可以搜索；文件夹与标签跟随当前邮箱，选择「全部邮箱」可统一阅读，文件夹按账号分组展开；「管理邮箱」打开独立窗口调整顺序或移除连接。
2. Gmail 和 Microsoft 365 首次需有效的 OAuth 应用配置。当前没有附带发行者的授权应用，不能跳过注册步骤；见 [邮箱接入](docs/邮箱接入.md)。QQ 获取授权码的入口已放在连接页面。
3. 在设置中下载一次离线翻译模型（约 920 MB）。之后点击「译文」或「对照」，直接在本机翻译，无需联网、翻译密钥或连接助手。
4. 需要 AI 时，点击「AI 连接 → 配置 AI 助手」，再重启相应客户端。

连接由本机后台加密保存，正常情况下无需反复登录。授权撤销、密码或组织策略变化时需要重新连接。关闭桌面窗口后收起到系统托盘并继续同步；双击图标打开，右键选择「退出叠信」结束应用和后台服务。助手再次调用时可以按需启动后台。

## 邮箱功能

- 多账号统一收件箱、筛选、缓存搜索、已读与星标。
- 同步实际文件夹与 Gmail 标签：收件箱、已发送、归档、垃圾邮件、已删除及自建分类。
- 移动、归档与恢复到收件箱；保留 Gmail 同一邮件的多标签关系。
- 原文、译文与对照阅读，译文本机缓存，原文保留。
- 撰写、回复、转发、本机草稿、查看服务商草稿、抄送、密送、附件下载与发送。
- 每封最多 10 个附件，总大小不超过 10 MB。
- 日间、夜间、系统外观，中英文及系统语言。
- MCP 读取、搜索、同步、草稿与显式确认发送工具。

每个文件夹缓存最近 60 封邮件，搜索针对这些缓存。QQ 等 IMAP 邮箱先加载列表，打开邮件后下载并缓存正文和附件；离线阅读和正文搜索使用已下载的内容。收件箱与已发送约每分钟检查，其他文件夹每分钟分批检查，目录约每十分钟刷新。选择文件夹或点击同步可立即更新当前分类。

批量操作、全历史服务端搜索、HTML 排版编辑、通知及开机启动仍在后续计划中。发送结果不确定时禁止自动重发，应先检查已发送邮件。

## 翻译与隐私

点击「译文」或「对照」后，使用本机离线模型处理当前正文，原文与译文保留在本机。首次模型下载连接 Hugging Face，下载请求不包含邮件正文；之后翻译禁止远程模型访问，不自动改用在线或收费服务。模型加载和生成需要一定时间，已经缓存的译文直接显示。

离线模型使用 Meta NLLB-200 的量化 ONNX 版本；详见 [模型来源与许可](docs/translation-model.md)。高级助手任务仍可显式选择 MCP 翻译队列。

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

发布时统一更新三个包的版本与双语更新记录，验证、提交并同步源码，再推送同版本标签。工作流会自动生成中英文发布页和安装包下载标签。使用者直接下载 Release 安装包即可；维护流程见[发布规范](docs/releasing.md)。

## 许可

[PolyForm Noncommercial 1.0.0](LICENSE)，商业用途需书面授权。项目属于源码公开项目；版权声明见 [NOTICE](NOTICE)，第三方依赖保留各自许可。
