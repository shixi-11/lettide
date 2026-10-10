## 下载 / Downloads

| 系统 / Platform | 简体中文 / Chinese | English / 英文 |
| --- | --- | --- |
| Windows 10 / 11 · x64 | [叠信 · 安装程序](https://github.com/shixi-11/lettide/releases/download/v{{VERSION}}/Lettide-{{VERSION}}-win-x64-zh-CN.exe) | [Lettide · Windows installer](https://github.com/shixi-11/lettide/releases/download/v{{VERSION}}/Lettide-{{VERSION}}-win-x64-en.exe) |
| macOS 12+ · Apple Silicon + Intel | [叠信 · DMG](https://github.com/shixi-11/lettide/releases/download/v{{VERSION}}/Lettide-{{VERSION}}-mac-universal-zh-CN.dmg) | [Lettide · Mac DMG](https://github.com/shixi-11/lettide/releases/download/v{{VERSION}}/Lettide-{{VERSION}}-mac-universal-en.dmg) |

{{CHANGES}}

## Installation and account setup

Run the Windows installer, or open the DMG and drag the app into Applications. Node.js is included. Chinese installers use the name 叠信; English installers use Lettide. You can switch the interface language in Settings.

Gmail and Microsoft 365 still require an OAuth app configuration for the first connection. QQ Mail requires an app password. [Account setup guide](https://github.com/shixi-11/lettide/blob/main/docs/account-setup.en.md)

After a one-time offline model download (about 920 MB), click Translated or Compare to translate on this device. Model downloads contain no email text; translation never uploads the body or falls back to an online service.

These preview installers are unsigned, and the Mac app is not notarized. Successful builds do not establish live mailbox verification or a physical Mac UI acceptance test.

## 安装与连接

Windows 双击安装程序；macOS 打开 DMG 后拖入「应用程序」。无需另装 Node.js。中文版显示「叠信」，英文版显示「Lettide」，应用内可切换语言。

Gmail / Microsoft 365 首次连接仍需 OAuth 应用配置，QQ 需要邮箱授权码。[邮箱接入指南](https://github.com/shixi-11/lettide/blob/main/docs/邮箱接入.md)

首次下载约 920 MB 离线模型后，点击「译文」或「对照」在本机翻译。模型下载不包含邮件正文，翻译不会上传正文或自动改用在线服务。

当前为未签名预览版，Mac 未经过 Apple 公证。安装包构建通过不等于真实邮箱或 Mac 真机界面已验收。
