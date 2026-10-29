# Lettide

A calmer home for Gmail, Outlook, GoDaddy and QQ Mail, with inline translation and shared mail tools for Codex and Claude.

**Preview 0.5.2** · [Downloads](https://github.com/shixi-11/lettide/releases/tag/v0.5.2) · [Changelog](CHANGELOG.md) · [中文说明](README.md)

| Platform and package | English “Lettide” | 简体中文「叠信」 |
| --- | --- | --- |
| Windows 10 / 11 · x64 | [Download exe](https://github.com/shixi-11/lettide/releases/download/v0.5.2/Lettide-0.5.2-win-x64-en.exe) | [下载 exe](https://github.com/shixi-11/lettide/releases/download/v0.5.2/Lettide-0.5.2-win-x64-zh-CN.exe) |
| macOS 13+ · Apple Silicon + Intel | [Download dmg](https://github.com/shixi-11/lettide/releases/download/v0.5.2/Lettide-0.5.2-mac-universal-en.dmg) | [下载 dmg](https://github.com/shixi-11/lettide/releases/download/v0.5.2/Lettide-0.5.2-mac-universal-zh-CN.dmg) |

Run the Windows EXE, open the Mac DMG and drag the app into Applications. Node.js is included. Choose English, Chinese or the system language in Settings. These preview installers are unsigned; the Mac app is not notarized.

Settings includes Check for updates; startup checks also notify you about newer releases. Download and install from the app. Downloads are verified and the current draft is saved before installation. Windows restarts into the update; on Mac, follow the DMG instructions to replace the app. Account data and cached mail are preserved.

Inbox and Sent are checked about every 30 seconds across accounts in parallel. Unchanged Gmail folders use a lightweight history-cursor check; other folders are checked in batches.

Read and search cached mail, sync folders and Gmail labels, archive, move, restore, star, reply, forward, save drafts and send attachments. Each sync reads the latest 60 messages in a folder and retains previously cached older mail. Lists transfer short previews, message bodies load on demand, and attachments download only when clicked. Offline reading and body searches use downloaded text. Each message supports ten attachments and 10 MB total.

Use the account switcher at the top left to choose or search your accounts. Folders and labels belong to the selected account; choose All inboxes for a unified view. Each account remembers its last folder during the current session.

Google and Microsoft require an OAuth app registration; a publisher OAuth client is not bundled yet. QQ requires an app password from its official settings. See the [account setup guide](docs/account-setup.en.md).

Click Translation or Side by side to use Google’s free online translation. No API key, model download or connected assistant is required. Only the selected email body is sent to Google; account details, subject, headers and attachments are excluded. Results are cached in the encrypted local store, and your original email is preserved. Choose source and target languages, cancel or retry from the reader. The free web endpoint can be limited or change; errors are visible and there is no paid fallback. See [translation details](docs/translation.md). The legacy offline engine remains available only through explicit compatibility APIs and is not loaded during normal reading; its [model attribution and license](docs/translation-model.md) remain intact.

Folders appear in All inboxes grouped by account. Open Manage accounts to reorder accounts or remove local connections in a separate window. Closing a window keeps Lettide in the system tray; right-click the tray icon and choose Quit Lettide to stop the app and shared service. A later assistant connection can start the service again.

Mail caches use AES-256-GCM. Windows protects the random encryption key with CurrentUser DPAPI; macOS stores it in Keychain. Data lives in `%USERPROFILE%/.lettide` on Windows (from 0.3.12; the former `%LOCALAPPDATA%/Lettide` is copied there once and left in place) and `~/Library/Application Support/Lettide` on macOS; set `LETTIDE_DATA_DIR` to choose another folder. Local data and configuration do not belong in Git. Sending through MCP requires explicit confirmation. SMTP messages are copied to the server’s Sent folder; a failed copy can be saved separately through the app or MCP without resending the email.

Source is available under [PolyForm Noncommercial 1.0.0](LICENSE). Commercial use requires written authorization. See [NOTICE](NOTICE).

For maintainers: [release conventions](docs/releasing.md) cover bilingual notes, installer labels and version tags.

In-app update checks include published preview and stable releases, excluding drafts. Automatic checks only notify; Settings lets you check, download and choose to install. Drafts are saved before installation, and the running version is verified afterward.

Delete local drafts from the list, context menu or editor. Clear drafts acts on the confirmed local drafts in the current account and search scope. Restore them from Trash; drafts currently sending are kept, and uncertain sends are never submitted again by deletion or restoration. Provider drafts can still be moved individually to the provider’s Trash.
