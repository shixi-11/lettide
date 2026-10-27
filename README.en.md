# Lettide

A calmer home for Gmail, Outlook, GoDaddy and QQ Mail, with inline translation and shared mail tools for Codex and Claude.

**Preview 0.4.1** · [Downloads](https://github.com/shixi-11/lettide/releases/tag/v0.4.1) · [Changelog](CHANGELOG.md) · [中文说明](README.md)

| Platform and package | English “Lettide” | 简体中文「叠信」 |
| --- | --- | --- |
| Windows 10 / 11 · x64 | [Download exe](https://github.com/shixi-11/lettide/releases/download/v0.4.1/Lettide-0.4.1-win-x64-en.exe) | [下载 exe](https://github.com/shixi-11/lettide/releases/download/v0.4.1/Lettide-0.4.1-win-x64-zh-CN.exe) |
| macOS 13+ · Apple Silicon + Intel | [Download dmg](https://github.com/shixi-11/lettide/releases/download/v0.4.1/Lettide-0.4.1-mac-universal-en.dmg) | [下载 dmg](https://github.com/shixi-11/lettide/releases/download/v0.4.1/Lettide-0.4.1-mac-universal-zh-CN.dmg) |
| Linux · x64 · Ubuntu / Debian · DEB | [Download deb](https://github.com/shixi-11/lettide/releases/download/v0.4.1/Lettide-0.4.1-linux-x64-en.deb) | [下载 deb](https://github.com/shixi-11/lettide/releases/download/v0.4.1/Lettide-0.4.1-linux-x64-zh-CN.deb) |
| Linux · x64 · Fedora · RPM | [Download rpm](https://github.com/shixi-11/lettide/releases/download/v0.4.1/Lettide-0.4.1-linux-x64-en.rpm) | [下载 rpm](https://github.com/shixi-11/lettide/releases/download/v0.4.1/Lettide-0.4.1-linux-x64-zh-CN.rpm) |
| Linux · x64 · Desktop distributions · AppImage | [Download AppImage](https://github.com/shixi-11/lettide/releases/download/v0.4.1/Lettide-0.4.1-linux-x64-en.AppImage) | [下载 AppImage](https://github.com/shixi-11/lettide/releases/download/v0.4.1/Lettide-0.4.1-linux-x64-zh-CN.AppImage) |

Run the Windows EXE, open the Mac DMG and drag the app into Applications, or choose a Linux DEB, RPM or AppImage. See [Linux installation](docs/linux.en.md). Node.js is included. Choose English, Chinese or the system language in Settings. These preview installers are unsigned; the Mac app is not notarized.

Read and search cached mail, sync folders and Gmail labels, archive, move, restore, star, reply, forward, save drafts and send attachments. Each folder currently caches its latest 60 emails. QQ and other IMAP accounts load the list first, then download and cache the body and attachments when you open a message. Offline reading and body searches use downloaded content. Each message supports ten attachments and 10 MB total.

Use the account switcher at the top left to choose or search your accounts. Folders and labels belong to the selected account; choose All inboxes for a unified view. Each account remembers its last folder during the current session.

Google and Microsoft require an OAuth app registration; a publisher OAuth client is not bundled yet. QQ requires an app password from its official settings. See the [account setup guide](docs/account-setup.en.md).

Download the offline model once in Settings (about 920 MB). Clicking Translated or Compare then translates on this device without an online service, API key or connected assistant. Model downloads connect to Hugging Face and contain no email text. Remote model access is disabled for inference, with no online or paid fallback. Generation takes time; cached translations appear immediately. Choose the source language if detection is inaccurate, or cancel a pending translation. Unchanged output between different languages is reported as a failed translation. See [model source and license](docs/translation-model.md).

Folders appear in All inboxes grouped by account. Open Manage accounts to reorder accounts or remove local connections in a separate window. Closing a window keeps Lettide in the system tray; right-click the tray icon and choose Quit Lettide to stop the app and shared service. A later assistant connection can start the service again.

Mail caches use AES-256-GCM. Windows protects the random encryption key with CurrentUser DPAPI; macOS stores it in Keychain; Linux uses the desktop Secret Service keyring. Data lives in `%USERPROFILE%/.lettide` on Windows (from 0.3.12; the former `%LOCALAPPDATA%/Lettide` is copied there once and left in place), `~/Library/Application Support/Lettide` on macOS and `${XDG_DATA_HOME:-~/.local/share}/Lettide` on Linux; set `LETTIDE_DATA_DIR` to choose another folder. Local data and configuration do not belong in Git. Sending through MCP requires explicit confirmation. SMTP messages are copied to the server’s Sent folder; a failed copy can be saved separately through the app or MCP without resending the email.

Source is available under [PolyForm Noncommercial 1.0.0](LICENSE). Commercial use requires written authorization. See [NOTICE](NOTICE).

For maintainers: [release conventions](docs/releasing.md) cover bilingual notes, installer labels and version tags.
