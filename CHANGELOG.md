# 更新记录 / Changelog

## 0.3.12

### 中文

- Windows 数据目录改为 `%USERPROFILE%\.lettide`。从微软商店安装的 Claude、Codex 会把各自写进 `AppData` 的新文件放到私有位置，导致每个客户端各存一份数据、令牌对不上，后到的客户端连接叠信时报「Server disconnected」。现在所有客户端和桌面程序共用同一份数据。
- 首次启动时，旧目录 `%LOCALAPPDATA%\Lettide` 里的加密数据、密钥和离线翻译模型会复制到新目录，原处保留不删；新目录已有数据时不再复制，也不会被旧数据覆盖。
- 可用环境变量 `LETTIDE_DATA_DIR` 指定数据目录。
- AI 助手连到使用另一份数据的叠信服务时，报错会说明原因和处理办法，而不是只显示认证失败。

### English

- Windows data now lives in `%USERPROFILE%\.lettide`. Claude and Codex installed from the Microsoft Store redirect new files under `AppData` into private per-app locations, so each client kept its own copy and token, and whichever client started second saw “Server disconnected”. All clients and the desktop app now share one data folder.
- On first start, the encrypted data, key and offline translation model in the former `%LOCALAPPDATA%\Lettide` are copied to the new folder and left in place. Once the new folder holds data, nothing is copied again and older data never overwrites it.
- Set `LETTIDE_DATA_DIR` to choose another data folder.
- When an AI assistant reaches a Lettide service that uses different data, the error now explains why and what to do instead of only reporting an authentication failure.

## 0.3.11

### 中文

- 大邮箱同步、正文保存和状态操作不再反复复制未变化的附件字符串；只复制可修改的数据容器，保留事务失败回滚与全部附件。
- 比较同步状态时避免把未变化的大附件重复序列化，减少大缓存的内存与等待开销。
- 包含 0.3.10 的本地翻译修复、新缓存与错语种检查，以及 0.3.9 的连接复用和正文预取。
- 修正构建检查中已结束计时器误报同步阻塞的问题。

### English

- Avoid repeatedly copying unchanged attachment strings during large-mailbox sync, body saves and status updates. Copy mutable containers while preserving transaction rollback and every attachment.
- Compare sync state without serializing unchanged large attachments, reducing memory and waiting overhead for large caches.
- Include the offline translation fixes, refreshed cache and script checks from 0.3.10, plus connection reuse and body prefetching from 0.3.9.
- Fix a build check whose expired timer could incorrectly report a blocked sync after the operation had already finished.

## 0.3.10

### 中文

- 修复长短段落混合批量翻译时，已结束的短段继续生成、混入其他语言并反复重复的问题。每段独立结束，保留逐段显示和原文结构。
- 按完整句子翻译，保留网址、邮箱地址、分隔线和简短署名，减少多句段落漏译与装饰文字误译。
- 明显错语种、异常重复和过度膨胀的结果不会被显示或缓存为成功译文；旧版翻译缓存不再复用。
- 保留 0.3.9 的邮箱连接复用、正文预取与保存队列优化。
- 安装包直接上传 GitHub Release，避免临时构建附件配额耗尽阻断下载。

### English

- Fix mixed-length translation batches continuing to generate after a short segment has ended, producing repeated text in unrelated languages. End each segment independently while preserving progressive display and source structure.
- Translate complete sentences separately, retaining URLs, email addresses, separators and short signatures to reduce skipped sentences and mistranslated decoration.
- Reject visibly incorrect scripts, abnormal repetition and excessive expansion before showing or caching a successful translation. Invalidate older translation caches.
- Retain the IMAP connection reuse, body prefetching and save-queue improvements from 0.3.9.
- Upload installers directly to GitHub Releases so exhausted temporary build-artifact storage cannot block downloads.

## 0.3.9

### 中文

- 复用 IMAP 邮箱连接，减少打开邮件时反复登录的等待；当前列表中的少量小邮件会在后台准备正文，大邮件仍按需下载。
- 已读、星标和移动操作在联网时不再占用共用保存队列，避免拖慢正文、草稿和翻译结果的保存。
- 译文分段完成后逐步显示，无需等待整封翻译结束；保留原文、链接、取消和重试功能。离线全文翻译仍受设备性能与邮件长度影响。
- 尚未下载正文的邮件会显示准备状态，避免误显示为没有正文。

### English

- Reuse IMAP connections to reduce repeated sign-in delays when opening messages. Prepare a few small messages from the visible list in the background; large messages remain on demand.
- Keep network work for read status, stars and moves out of the shared save queue so it cannot hold up message bodies, drafts or translation results.
- Show translated segments as they finish instead of waiting for the full email. Preserve original text, links, cancellation and retry. Full offline translation time still depends on the device and email length.
- Show a preparation state for messages whose bodies have not been downloaded, instead of indicating that they have no body.

## 0.3.8

### English

- Save SMTP messages to the server's Sent folder with their attachments and reply headers. If saving fails after sending, retry only the copy and check its Message-ID to avoid duplicates.
- Add source language selection and cancellation for offline translations. Fix mixed-language detection, discard older translation caches, and report unchanged output as an error when translating between different languages.
- Bound stalled translation requests and show preparation and queue progress. Reduce repeated tokenization when splitting long emails; offline processing time still depends on the email and device.

### 中文

- SMTP 发信后将附件与回复信息一起保存到服务器的已发送文件夹。发送成功但副本保存失败时，可单独补存，并检查邮件标识避免重复。
- 离线翻译增加原文语言选择与取消入口，修复混合语言识别并更新翻译缓存。翻译不同语言时，如果模型返回原文，会明确提示失败。
- 为停滞的翻译请求设置超时，显示准备和排队状态，减少长邮件分段时的重复计算。离线翻译耗时仍取决于邮件长度与设备性能。

## 0.3.7

### English

- Load Gmail message lists with concurrent metadata requests. Fetch bodies and attachments when opening a message, and reuse cached content on subsequent reads.
- Keep mailbox sync and content downloads from blocking draft saves, other folders, or translation updates. Preserve changes made while a sync is running.

### 中文

- Gmail 邮件列表并行获取摘要信息，打开邮件时再下载正文和附件；已下载的内容直接使用本机缓存。
- 邮箱同步和正文下载不再阻塞草稿保存、其他文件夹或翻译状态更新，并保留同步期间的操作结果。

## 0.3.6

### English

- Translate short paragraphs in batches while preserving line breaks and links. Show actual offline translation progress and distinguish queued requests.
- Recover a stalled local translation worker after a timeout, and allow retrying without restarting the app. Long emails still take time to process on the device.
- Show which browser authorization step failed without exposing credentials, so Gmail connection problems can be diagnosed.

### 中文

- 短段落批量翻译，保留换行和链接；显示离线翻译实际进度，并区分排队中的请求。
- 本地翻译超时后恢复模型进程，可直接重试，无需重启应用；长邮件仍需要本机计算时间。
- 浏览器授权失败时区分失败步骤，方便排查 Gmail 连接问题，同时避免显示凭据。

## 0.3.5

### English

- Retry service startup when the previous backend is still releasing its data lock, so AI assistants can reconnect after a restart. Includes the cache, account-management and language-control improvements from 0.3.4.

### 中文

- 旧后台尚未释放数据锁时自动重试启动，让 AI 助手在后台重启后恢复连接；包含 0.3.4 的缓存提速、邮箱管理及语言入口优化。

## 0.3.4

### English

- Speed up Windows mail-cache reads and writes with AES-256-GCM and a DPAPI-protected key. Existing encrypted data migrates when next saved.
- Add a visible Add mailbox action and clearer ordering controls to the account manager.
- Separate interface language from email translation language, with labeled controls for each.
- Improve AI assistant startup and recovery when the shared mail service is unavailable or restarting.

### 中文

- 加快 Windows 邮件缓存读写，使用 AES-256-GCM 加密及 DPAPI 保护的密钥；已有加密数据在下次保存时迁移。
- 邮箱管理窗口增加「添加邮箱」，明确显示排序操作。
- 分开设置界面语言与邮件翻译语言，入口标明用途。
- 改善 AI 助手在邮箱后台启动、暂不可用或重启时的连接处理。

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
