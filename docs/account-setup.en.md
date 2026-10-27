# Account setup

[中文](邮箱接入.md) · [Back to Lettide](../README.en.md)

Connect each account separately. You can add multiple accounts from the same provider. Credentials are stored locally and are not written to GitHub or your MCP client configuration.

## QQ Mail

Enable IMAP/SMTP in QQ Mail's account settings and follow its official process to generate an app password. In Lettide, choose QQ Mail and enter your email address or QQ number and this app password. Do not use your QQ sign-in password here.

The defaults are `imap.qq.com:993` for IMAP and `smtp.qq.com:465` for SMTP, both with TLS. Lettide checks both incoming and outgoing connections before saving the account.

## GoDaddy Professional Email / Titan

Choose GoDaddy's Professional Email / Titan option and enter your email address and mailbox password or app password. The defaults are `imap.secureserver.net:993` and `smtpout.secureserver.net:465`, both with TLS. If your account's settings specify different servers, enter those in the server settings.

Your GoDaddy account password may differ from your mailbox password. Follow the current [GoDaddy setup instructions](https://www.godaddy.com/help/use-imap-settings-to-add-my-professional-email-powered-by-titan-to-a-client-32204).

## Gmail

1. Create a Google Cloud application, enable the Gmail API and configure the OAuth consent screen.
2. Create a **Desktop app** OAuth client. Lettide uses PKCE and the loopback callback `http://127.0.0.1:47831/api/oauth/callback`; authorization opens in your default browser. An existing Web application client configured with this callback can also be retained.
3. In Lettide, open **Settings → Account authorization** and enter the Client ID. Enter a Client Secret only if your application type requires one.
4. Add a Gmail account and complete authorization on Google's official page. Authorize each account separately; it appears in Lettide when authorization finishes.

In testing mode, add your email addresses as test users. Refresh tokens for apps in Google's testing mode may expire after seven days. For long-term use, follow Google's requirements for publishing and verification. See [Google OAuth documentation](https://developers.google.com/identity/protocols/oauth2) and [Gmail authorization](https://developers.google.com/workspace/gmail/api/auth/web-server).

## GoDaddy Microsoft 365 / Outlook

1. Register an application in Microsoft Entra and choose the supported account types for your accounts.
2. Add `http://127.0.0.1:47831/api/oauth/callback` under the mobile and desktop application platform and allow public desktop clients. This setup usually does not require a Client Secret. An existing Web platform configuration can retain its secret.
3. Add delegated permissions: `User.Read`, `Mail.ReadWrite`, `Mail.Send` and `offline_access`.
4. Enter the Client ID in Lettide's account authorization settings, and enter a Client Secret only if required. Choose Outlook, or choose Microsoft 365 / Outlook when adding GoDaddy and complete Microsoft's official authorization flow.

Organization accounts may need administrator consent. GoDaddy tenant policies may restrict custom applications, so your administrator may need to approve access. Lettide uses the [Microsoft Graph mail API](https://learn.microsoft.com/en-us/graph/api/resources/mail-api-overview); you do not need to keep reopening Outlook on the web.

## Connect AI clients

In the desktop app, choose **AI connections → Set up AI assistants**. On Windows, you can also run `连接AI助手.cmd` from the source checkout. Setup adds an MCP entry named `lettide` to detected clients, preserves other connections and backs up the original configuration in Lettide's local data directory.

Reload MCP in Codex, start a new Claude Code session, or fully quit and reopen Claude Desktop. Confirm that tools such as `mail_accounts_list` and `mail_search` appear in the client.

You can ask an assistant to check unread mail, search cached messages, read mail, prepare reply drafts or process translation tasks. Sending has separate preparation and confirmation steps and requires your explicit instruction. Email bodies, attachment names and links cannot authorize actions.

Windows uses CurrentUser DPAPI; macOS stores the encryption key in Keychain; Linux uses an unlocked desktop Secret Service keyring. See [Linux installation](linux.en.md) for desktop requirements. Reauthorize your accounts after changing system users or reinstalling the operating system. Do not copy cookies or put tokens in source code.

From 0.3.4, Windows encrypts the cache with AES-256-GCM and protects its random key with DPAPI. An existing cache is upgraded when next saved. Local backups must retain both `state.dpapi` and `state.dpapi.key.dpapi`; the key remains tied to the same Windows user. Older versions cannot read the upgraded format.

## Reading translations

Download the offline model once in Settings. Clicking Translated or Compare then processes the selected body locally; no email content is uploaded. Model downloads contain only public model files. See [model details](translation-model.md).
