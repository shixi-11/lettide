# Lettide

**All your mail, in one calm place.**

Lettide is an open-source desktop email client for Windows and macOS. Bring multiple Gmail, Outlook, GoDaddy and QQ Mail accounts together to read, search, organize and reply to mail, with online translation when you need it. Codex, Claude Code and Claude Desktop can also share your connected accounts through local MCP tools.

[中文说明](README.md) · [Download](#download) · [Account setup](docs/account-setup.en.md) · [Changelog](CHANGELOG.md)

## What you can do

- **Manage multiple accounts:** add several accounts from the same provider, use a unified inbox or switch to one mailbox, and reorder or disconnect accounts in a separate management window.
- **Keep folders and labels in sync:** browse Inbox, Sent, Drafts, Spam, Trash and custom folders. Gmail messages retain their multiple labels. All-inbox mode groups folders by account.
- **Read and organize:** mark read or unread, star, move, delete, restore and archive where supported. HTML mail retains its layout, ordinary messages follow the light or dark theme, and remote images stay blocked until you choose to load them.
- **Write and send attachments:** compose, reply, forward, add Cc or Bcc, save local drafts and view provider drafts. Delete local drafts, clear the confirmed selection or restore them from Trash. Each message supports up to ten attachments and 10 MB total.
- **Find recent and older mail:** search the local cache first, then search the mail server when you need older messages. Server search returns up to 50 matches per account.
- **Translate on demand:** switch between Original, Translation and Side by side, with source and target language choices. Google’s free online translation needs no API key, downloaded model or connected assistant; results are cached locally.
- **Stay connected in the background:** closing the window keeps Lettide in the system tray. New mail notifications and the taskbar badge are off by default. Enable them in Settings. The unread count remains available in the tray. Choose English or Chinese and light, dark or system appearance.
- **Connect your assistants:** Codex, Claude Code and Claude Desktop can read, search, sync and create drafts, then send only after explicit confirmation. They share the local connection, so you do not sign in to each mailbox again for every assistant.

## Download

Current preview: **0.5.10**. [All downloads](https://github.com/shixi-11/lettide/releases/tag/v0.5.10)

| Platform and package | English “Lettide” | 简体中文「叠信」 |
| --- | --- | --- |
| Windows 10 / 11 · x64 | [Download exe](https://github.com/shixi-11/lettide/releases/download/v0.5.10/Lettide-0.5.10-win-x64-en.exe) | [下载 exe](https://github.com/shixi-11/lettide/releases/download/v0.5.10/Lettide-0.5.10-win-x64-zh-CN.exe) |
| macOS 13+ · Apple Silicon + Intel | [Download dmg](https://github.com/shixi-11/lettide/releases/download/v0.5.10/Lettide-0.5.10-mac-universal-en.dmg) | [下载 dmg](https://github.com/shixi-11/lettide/releases/download/v0.5.10/Lettide-0.5.10-mac-universal-zh-CN.dmg) |

Run the Windows EXE, or open the Mac DMG and drag the app into Applications. Node.js is included. English downloads use Lettide; Chinese downloads use 叠信. Change the interface language in Settings. Linux installers are deferred.

These preview installers are unsigned. Windows may show an unknown publisher warning; the Mac app is not notarized and may need approval in Privacy & Security on first launch.

Lettide checks for updates after launch and downloads new versions in the background. When one is ready, choose Install update in the app or tray menu. Settings also includes Check for updates. Lettide verifies the download and saves your current draft before installation. On Windows, open Lettide manually after installation. On Mac, follow the DMG instructions to replace the app.

## Get started

1. **Add an account.** QQ Mail uses an email address or QQ number and an app password. GoDaddy Professional uses the mailbox password. Gmail, Outlook and GoDaddy Microsoft 365 authorize in your default browser. Google and Microsoft require an OAuth app registration for the first connection; a publisher OAuth client is not bundled yet. See the [account setup guide](docs/account-setup.en.md).
2. **Choose a mailbox.** Use the account switcher at the top left. Folders follow the selected account; All inboxes groups each account’s folders separately. Right-click a message for common actions.
3. **Read and translate.** Select a message, then switch between Original, Translation and Side by side. Attachments download when clicked; email links open in your browser.
4. **Connect an assistant.** Open AI connections → Configure AI assistants and restart the relevant client as instructed. Assistants share the same local mailbox connection; sending requires explicit confirmation.

Connections are encrypted on this device and normally stay signed in. Revoked authorization, password changes or organization policies can require reconnection. Closing the window hides Lettide in the tray. Choose Quit Lettide from the tray menu to stop the app and shared service; a later assistant connection can start the service when needed.

## Sync, translation and privacy

Inbox and Sent are checked about every **30 seconds**, with accounts handled in parallel. This is polling, not push delivery. Other folders are checked in batches each minute, and the folder list refreshes about every ten minutes. Selecting a folder or clicking Sync checks that folder immediately. Each sync reads its latest 60 messages and keeps previously cached history. Lists load short previews, bodies load on demand, and attachments download only when clicked. Offline reading uses downloaded bodies.

Only when you request translation is the selected email body sent to Google. Account details, subjects, headers and attachments are excluded. Originals and cached translations remain encrypted locally. The free web endpoint may change or temporarily limit requests; failures can be retried, with no automatic paid fallback. See [translation details](docs/translation.md).

Mail caches use AES-256-GCM. Windows protects the encryption key with CurrentUser DPAPI; macOS uses Keychain. Default data locations are `%USERPROFILE%/.lettide` on Windows and `~/Library/Application Support/Lettide` on macOS. Set `LETTIDE_DATA_DIR` to choose another location. Do not upload mailbox data, tokens, OAuth secrets or client backups to Git.

Uncertain sends are not retried automatically: check Sent before taking further action. If SMTP accepted a message but its Sent copy was not saved, save that copy separately without sending the message again.

## Develop and build

Use Node.js 24+ and pnpm 11.25. Run `pnpm install --frozen-lockfile` separately in `backend`, `web` and `desktop`, then:

```sh
node --test backend/tests/*.test.js
cd web && pnpm build
cd ../desktop && node node_modules/electron/install.js
cd ..
node scripts/Build-Desktop.mjs --en     # Windows, English
node scripts/Build-Desktop.mjs          # Windows, Chinese
node scripts/Build-Desktop.mjs --mac --en # Universal Mac, on macOS
node scripts/Build-Desktop.mjs --mac
```

The repository includes application code and build scripts. Each release links to its matching source tag. See [release conventions](docs/releasing.md) and [backend details](backend/README.md). Tests use isolated fictional data; `output` is excluded from Git.

## License

Lettide is open-source software under the [GNU Affero General Public License v3.0 only (AGPL-3.0-only)](LICENSE). Official installers are free for personal and business use, including commercial work. When distributing a covered modified version, provide its corresponding source under the AGPLv3 terms. If users interact with a modified version over a network, offer those users access to its corresponding source as required by the license. Charging for distribution is permitted; distributing a covered derivative as proprietary software is not.

The software is provided without warranty. Using Lettide does not require publishing your emails, credentials or independent business materials. See [copyright and third-party notices](NOTICE). Third-party dependencies and [optional offline model weights](docs/translation-model.md) retain their separate licenses; the weights are not licensed under the AGPLv3. Earlier tags and published releases retain the licenses supplied with them.

## Support and collaboration

Lettide is developed and maintained by Shixi Lin. If you find it useful, you can [make a voluntary contribution to support its maintenance](https://shixilin.com/en/support). All features remain available without donating. You can also find the link in Settings → About.

For collaborations: [info@elevencapital.ltd](mailto:info@elevencapital.ltd).
