# 更新记录 / Changelog

## 0.3.3

### English

- Load QQ and other IMAP message lists before downloading bodies and attachments. Open a message to fetch its content once, then reuse the cache. Reuse folder metadata and combine duplicate sync requests.
- Show a syncing state while the first inbox download is in progress, and surface automatic sync errors. The selected account now shows its own last sync time.
- Show Archive only for accounts that support it. QQ accounts without an archive folder no longer show it in navigation, the toolbar, the move selector or the context menu; Gmail keeps Archive.
- Display the Inbox heading in the selected interface language instead of the server's INBOX name.

### 中文

- QQ 等 IMAP 邮箱优先加载邮件列表，正文和附件在打开邮件时下载并缓存；复用文件夹信息，合并重复同步请求。
- 首次下载收件箱时显示同步状态，自动同步失败时显示提示；切换邮箱后显示该账号自己的同步时间。
- 按账号实际支持情况显示归档。QQ 没有归档文件夹时，侧栏、工具栏、移动列表及右键菜单隐藏归档；Gmail 仍保留。
- 收件箱标题随界面语言显示，不再使用服务器的 INBOX 名称。

## 0.3.2

### English

- Translate offline on this device after a one-time model download (about 920 MB). Clicking Translated or Compare starts translation directly; completed results are cached.
- Right-click a message to mark it read or unread, star, archive, move or delete. Delete and move show progress and report errors; provider operations no longer make unnecessary folder queries after a successful move.
- Show folders in All inboxes, grouped by account. Manage accounts in a separate window, reorder them or remove a local connection.
- Add a dedicated Outlook entry, soften the light theme, and keep the app running in the system tray when its window is closed. Right-click the tray icon to quit.
- Gmail and Outlook browser sign-in still require the publisher's OAuth application configuration. The installers do not bundle publisher client IDs yet.
- Keep the universal Mac translation dependencies, and finish browser sign-in automatically for both newly added and reauthorized accounts.

### 中文

- 首次下载约 920 MB 模型后可在本机离线翻译。点击「译文」或「对照」直接开始，已完成译文本机缓存。
- 邮件支持右键标记已读／未读、星标、归档、移动和删除。删除与移动显示进度和错误，远端移动成功后不再依赖额外文件夹查询。
- 「全部邮箱」显示按账号分组的文件夹；独立管理窗口可调整邮箱顺序、移除本机连接。
- 增加独立 Outlook 入口，柔化日间配色；关闭窗口收起到系统托盘，通过图标右键菜单退出。
- Gmail 与 Outlook 浏览器登录仍需发行方配置 OAuth 应用，当前安装包尚未附带发行方 Client ID。
- 保留 Mac 通用安装包的翻译依赖修复；新增邮箱和已有邮箱重新授权成功后，自动结束浏览器授权等待。

## 0.3.1

### English

- Translate offline on this device after a one-time model download (about 920 MB). Clicking Translated or Compare starts translation directly; completed results are cached.
- Right-click a message to mark it read or unread, star, archive, move or delete. Delete and move show progress and report errors; provider operations no longer make unnecessary folder queries after a successful move.
- Show folders in All inboxes, grouped by account. Manage accounts in a separate window, reorder them or remove a local connection.
- Add a dedicated Outlook entry, soften the light theme, and keep the app running in the system tray when its window is closed. Right-click the tray icon to quit.
- Gmail and Outlook browser sign-in still require the publisher's OAuth application configuration. The installers do not bundle publisher client IDs yet.
- Correct packaging of offline translation dependencies for the universal Mac installer.

### 中文

- 首次下载约 920 MB 模型后可在本机离线翻译。点击「译文」或「对照」直接开始，已完成译文本机缓存。
- 邮件支持右键标记已读／未读、星标、归档、移动和删除。删除与移动显示进度和错误，远端移动成功后不再依赖额外文件夹查询。
- 「全部邮箱」显示按账号分组的文件夹；独立管理窗口可调整邮箱顺序、移除本机连接。
- 增加独立 Outlook 入口，柔化日间配色；关闭窗口收起到系统托盘，通过图标右键菜单退出。
- Gmail 与 Outlook 浏览器登录仍需发行方配置 OAuth 应用，当前安装包尚未附带发行方 Client ID。
- 修复 Mac 通用安装包中离线翻译依赖的合并方式。

## 0.3.0

### English

- Translate offline on this device after a one-time model download (about 920 MB). Clicking Translated or Compare starts translation directly; completed results are cached.
- Right-click a message to mark it read or unread, star, archive, move or delete. Delete and move show progress and report errors; provider operations no longer make unnecessary folder queries after a successful move.
- Show folders in All inboxes, grouped by account. Manage accounts in a separate window, reorder them or remove a local connection.
- Add a dedicated Outlook entry, soften the light theme, and keep the app running in the system tray when its window is closed. Right-click the tray icon to quit.
- Gmail and Outlook browser sign-in still require the publisher's OAuth application configuration. The installers do not bundle publisher client IDs yet.

### 中文

- 首次下载约 920 MB 模型后可在本机离线翻译。点击「译文」或「对照」直接开始，已完成译文本机缓存。
- 邮件支持右键标记已读／未读、星标、归档、移动和删除。删除与移动显示进度和错误，远端移动成功后不再依赖额外文件夹查询。
- 「全部邮箱」显示按账号分组的文件夹；独立管理窗口可调整邮箱顺序、移除本机连接。
- 增加独立 Outlook 入口，柔化日间配色；关闭窗口收起到系统托盘，通过图标右键菜单退出。
- Gmail 与 Outlook 浏览器登录仍需发行方配置 OAuth 应用，当前安装包尚未附带发行方 Client ID。

## 0.2.2

### 中文

- 邮箱切换器点击展开，支持搜索账号；只显示当前邮箱的文件夹与标签。
- 各邮箱在当前会话中分别记住上次打开的分类；长地址和文件夹名省略显示，分类列表可收起和滚动。
- 草稿数量与列表跟随当前邮箱。

### English

- Open the account switcher to choose or search your accounts. Only the selected account's folders and labels are shown.
- Each account remembers its last folder during the current session. Long addresses and folder names are shortened on screen, and folder lists can collapse and scroll.
- Draft counts and lists follow the selected account.

## 0.2.1

### 中文

- 修复安装包依赖独立性与 macOS 通用构建。
- 安装包包含 0.2.0 的正文在线翻译、文件夹与 Gmail 标签同步、归档与已删除、移动与恢复、附件发送、中英文切换、紧凑界面和新图标。

### English

- Fix standalone installer dependencies and the macOS universal build.
- The installers include the 0.2.0 features: inline translation, synced folders and Gmail labels, archive and trash, moving and restoring messages, attachments, language switching, a compact interface and the new icon.

## 0.2.0

### 中文

- 点击即可在线翻译正文，保留原文与对照阅读；无需配置翻译密钥。
- 同步邮箱实际文件夹和 Gmail 标签，支持归档、已删除、垃圾邮件、移动与恢复。
- 附件随草稿保存并发送，支持抄送与密送。
- 中英文及跟随系统语言，紧凑的日间和夜间界面，新的叠信图标。
- QQ 连接只需邮箱与授权码；Google 和 Microsoft 授权明确打开默认浏览器。
- Windows 安装程序与 macOS 通用 DMG 构建，中文名称「叠信」，英文名称「Lettide」。

### English

- Translate email bodies inline without a translation API key, with the original and translation available side by side.
- Sync actual mail folders and Gmail labels, including Archive, Trash and Junk; move messages and restore them to Inbox.
- Save and send attachments with drafts, with Cc and Bcc support.
- Switch between English, Chinese and the system language, with compact light and dark themes and a new app icon.
- Connect QQ Mail with an email address and app password. Google and Microsoft authorization explicitly opens the default browser.
- Build Windows installers and macOS universal DMGs. Chinese installers use the name 叠信; English installers use Lettide.

## 0.1.0

### 中文

- 多账号 Gmail、GoDaddy、QQ 邮箱统一阅读与发送。
- 本机加密连接，Codex、Claude Code 和 Claude Desktop 共用 MCP 后台。

### English

- Read and send mail from multiple Gmail, GoDaddy and QQ Mail accounts in one app.
- Protect account connections with local encryption and share a local MCP service with Codex, Claude Code and Claude Desktop.
