# Lettide

A calmer home for Gmail, GoDaddy and QQ Mail, with inline translation and shared mail tools for Codex and Claude.

**Preview 0.2.0** · [Downloads](https://github.com/shixi-11/lettide/releases/tag/v0.2.0) · [中文说明](README.md)

| Platform | English installer | Chinese installer |
| --- | --- | --- |
| Windows 10 / 11, x64 | [Lettide](https://github.com/shixi-11/lettide/releases/download/v0.2.0/Lettide-0.2.0-win-x64-en.exe) | [叠信](https://github.com/shixi-11/lettide/releases/download/v0.2.0/Lettide-0.2.0-win-x64-zh-CN.exe) |
| macOS 12+, Apple Silicon and Intel | [Lettide DMG](https://github.com/shixi-11/lettide/releases/download/v0.2.0/Lettide-0.2.0-mac-universal-en.dmg) | [叠信 DMG](https://github.com/shixi-11/lettide/releases/download/v0.2.0/Lettide-0.2.0-mac-universal-zh-CN.dmg) |

Run the Windows installer, or open the DMG and drag the app into Applications. Node.js is included. Choose English, Chinese or the system language in Settings. These preview installers are unsigned; the Mac app is not notarized. Downloads appear when the corresponding build finishes. Automated Mac builds do not constitute a physical Mac UI acceptance test.

Read and search cached mail, sync folders and Gmail labels, archive, move, restore, star, reply, forward, save drafts and send attachments. Each folder currently caches its latest 60 emails. Each message supports ten attachments and 10 MB total.

Google and Microsoft require an OAuth app registration; a publisher OAuth client is not bundled yet. QQ requires an app password from its official settings. See the [connection guide](docs/邮箱接入.md).

Translate displays the result beside the original. Only the body you explicitly translate is sent to Google's anonymous web service; no account credentials, subject or attachments. This is not the supported Cloud Translation API and may be limited or unavailable. No paid fallback is used. Syncing never automatically translates mail.

Windows protects local data with CurrentUser DPAPI; macOS stores an AES-256-GCM key in Keychain. Local data and configuration do not belong in Git. Sending through MCP requires explicit confirmation.

Source is available under [PolyForm Noncommercial 1.0.0](LICENSE). Commercial use requires written authorization. See [NOTICE](NOTICE).
