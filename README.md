# 叠信 · Lettide

**简体中文** | [English](README.en.md)

**多个邮箱，一处从容处理。**

叠信是一款适用于 Windows 和 macOS 的开源桌面邮箱客户端。把多个 Gmail、Outlook、GoDaddy 和 QQ 邮箱放在一起，阅读、搜索、整理和回复邮件；遇到外文，点一下即可在线翻译。Codex、Claude Code 和 Claude Desktop 也能通过本机 MCP 工具共用已连接的邮箱。

[下载安装](#下载安装) · [邮箱接入](docs/邮箱接入.md) · [更新记录](CHANGELOG.md)

## 现在可以做什么

- **多邮箱统一管理**：同一平台可添加多个账号，统一查看收件箱，也可搜索、切换单个邮箱；独立窗口管理账号顺序和连接。
- **同步文件夹与标签**：显示邮箱里的收件箱、已发送、草稿、垃圾邮件、已删除及自建文件夹，支持 Gmail 多标签关系；全部邮箱模式下按账号分组。
- **阅读与整理**：已读、未读、星标、移动、删除、恢复，以及邮箱支持的归档；HTML 邮件保留排版，普通邮件适配日间、夜间主题，远程图片由你决定是否加载。
- **写信与附件**：撰写、回复、转发、抄送、密送、附件收发；保存本机草稿、查看服务商草稿。本机草稿支持删除、按当前范围清空及从已删除恢复。每封邮件最多 10 个附件，总大小不超过 10 MB。
- **搜索新旧邮件**：先搜索本机缓存；需要更早的邮件时，可按需搜索邮箱服务器。服务器搜索每个账号最多返回 50 条匹配结果。
- **点选翻译**：原文、译文、对照切换，选择源语言和目标语言；使用 Google 免费在线翻译，无需密钥、模型或 AI 助手，译文在本机缓存。
- **后台同步与提醒**：窗口关闭后收起到托盘，继续检查新邮件；新邮件弹窗和任务栏未读提示默认关闭，可在设置中开启。托盘可查看未读数。支持中英文、日间、夜间和跟随系统。
- **让助手调用邮箱**：Codex、Claude Code 和 Claude Desktop 可读取、搜索、同步、创建草稿，并在明确确认后发送邮件；共用本机连接，无需为每个助手重复登录邮箱。

## 下载安装

当前预览版本 **0.5.10**。[完整下载页](https://github.com/shixi-11/lettide/releases/tag/v0.5.10)

| 系统与安装包 | 简体中文「叠信」 | English “Lettide” |
| --- | --- | --- |
| Windows 10 / 11 · 64 位 | [下载 exe](https://github.com/shixi-11/lettide/releases/download/v0.5.10/Lettide-0.5.10-win-x64-zh-CN.exe) | [Download exe](https://github.com/shixi-11/lettide/releases/download/v0.5.10/Lettide-0.5.10-win-x64-en.exe) |
| macOS 13+ · Apple 芯片与 Intel | [下载 dmg](https://github.com/shixi-11/lettide/releases/download/v0.5.10/Lettide-0.5.10-mac-universal-zh-CN.dmg) | [Download dmg](https://github.com/shixi-11/lettide/releases/download/v0.5.10/Lettide-0.5.10-mac-universal-en.dmg) |

Windows 双击 EXE 安装；macOS 打开 DMG，把应用拖入「应用程序」。内置运行环境，无需安装 Node.js。中文版显示「叠信」，英文版显示「Lettide」，界面语言可在设置中切换。Linux 安装包暂缓。

当前安装包为未签名预览版：Windows 可能提示未知发布者；macOS 未经过 Apple 公证，首次打开可能需在系统「隐私与安全性」中允许。

应用启动后会检查新版并在后台下载，准备好后可在应用或托盘选择「安装更新」。设置中也有「检查更新」。安装前会校验文件并保存当前草稿。Windows 安装完成后请手动打开叠信，Mac 按 DMG 提示替换应用。

## 开始使用

1. **添加邮箱**：QQ 使用邮箱地址或 QQ 号码与授权码；GoDaddy Professional 使用邮箱密码；Gmail、Outlook 和 GoDaddy Microsoft 365 在默认浏览器完成授权。Gmail 和 Microsoft 首次连接需要 OAuth 应用配置，目前未附带发行者的授权应用，具体见[邮箱接入](docs/邮箱接入.md)。
2. **切换与整理**：左上角选择单个邮箱或全部邮箱。文件夹跟随账号切换；全部邮箱下可分别展开各账号目录。邮件右键菜单提供常用操作。
3. **阅读与翻译**：选择一封邮件，在「原文／译文／对照」间切换。点击附件下载，点击邮件链接在浏览器打开。
4. **连接助手**：打开「AI 连接 → 配置 AI 助手」，按提示重启对应客户端。助手使用同一份本机邮箱连接；发送邮件需要明确确认。

账号连接在本机加密保存，正常情况下无需反复登录；授权被撤销、密码或组织政策变化时需要重新连接。关闭窗口会收起到托盘；右键托盘图标选择「退出叠信」才会结束应用及共享服务。之后助手调用可以按需启动后台。

## 同步、翻译与隐私

收件箱与已发送约每 **30 秒**检查一次，各账号并行处理，属于轮询同步。其他文件夹每分钟分批检查，目录约每十分钟刷新；选择文件夹或点击同步可立即检查当前分类。每次读取文件夹最近 60 封邮件，保留此前缓存的历史内容。列表先加载简短预览，正文按需读取，附件点击后下载；离线阅读使用已下载的正文。

只有你点击翻译时，当前邮件正文才会发送给 Google；不发送账号、主题、邮件头或附件。原文与缓存译文在本机加密保存。免费网页翻译可能临时限流或变更，失败可重试，不会自动切换收费服务。[翻译说明](docs/translation.md)

邮件缓存使用 AES-256-GCM 加密，Windows 通过当前用户 DPAPI 保护密钥，macOS 使用 Keychain。默认数据目录为 Windows 的 `%USERPROFILE%/.lettide` 和 macOS 的 `~/Library/Application Support/Lettide`，可用 `LETTIDE_DATA_DIR` 指定。不要把数据目录、令牌、OAuth 密钥或客户端备份上传到 Git。

发送结果不确定时不自动重发；应先核对已发送邮件。SMTP 邮件已发送但副本未保存时，可单独补存副本，无需再次发信。

## 开发与构建

需要 Node.js 24+、pnpm 11.25。在 `backend`、`web`、`desktop` 分别执行 `pnpm install --frozen-lockfile`，然后：

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

源码包含应用及构建脚本；下载对应版本时，可在发布页取得同一标签的源码。发布维护见[发布规范](docs/releasing.md)，后台接口见[服务说明](backend/README.md)。测试使用隔离的虚构数据，`output` 不进入 Git。

## 许可

当前开发版的叠信自有代码采用 [MIT 许可证](LICENSE)。官方安装包免费，个人和企业均可使用。MIT 允许使用、修改和再分发，分发时须保留版权和许可声明。

[版权与第三方声明](NOTICE)。第三方依赖及[可选离线模型权重](docs/translation-model.md)适用各自的许可。已发布的安装包及历史标签适用随附的许可证。

## 支持与合作

叠信由光之十一开发和维护。如果它对你有帮助，欢迎[自愿打赏，支持后续维护](https://shixilin.com/zh/support)。打赏不影响任何功能的使用，应用「设置 → 关于」中也有入口。

合作联系：[info@elevencapital.ltd](mailto:info@elevencapital.ltd)。
