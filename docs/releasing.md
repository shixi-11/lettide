# 发布规范 / Release conventions

## English

- Keep one Release per version. English and Chinese sections each include the complete download table, changes, installation and account setup. English comes first.
- `desktop/release-targets.mjs` defines the supported installer names: two Windows EXEs, two universal Mac DMGs and six Linux x64 DEB/RPM/AppImage files.
- Keep `README.md` and `README.en.md` linked to each other and to all ten current-version installers. Linux and account setup guides are available in both languages.
- Bump backend, web and desktop versions together and add full English and Chinese changelog sections. Run `node --test backend/tests/*.test.js` and `node --test tests/release-notes.test.mjs tests/downloads.test.mjs`, then build the interface.
- Commit and push the exact source revision before its version tag. Do not change an existing tag. Each installer is built from that tag with locked dependencies.
- The workflow creates a draft, checks native storage and packaged dependencies, installs the Linux DEB for UI/MCP checks, checks AppImage reconnects and tests the RPM runtime in Fedora. Only complete builds are uploaded.
- The final job requires all ten installers, publishes the bilingual preview Release and requests every public download URL. A missing or invalid installer fails publication checks. Notes-only runs update existing notes without replacing installers or publishing drafts.
- Use `node scripts/Verify-ReleaseDownloads.mjs` with `GH_TOKEN` if API rate limits require authentication. Download requests themselves are unauthenticated. `--metadata-only` checks completeness before a draft is published.
- Preserve Windows DPAPI and macOS Keychain data. Linux uses Secret Service and must never fall back to a plaintext key. Test keyrings use an isolated HOME and D-Bus session; do not run test cleanup against personal keyring items.

## 简体中文

- 同一版本只用一个 Release。英文在前、中文在后，每个区块都有完整下载表、更新、安装和邮箱连接说明。
- `desktop/release-targets.mjs` 定义安装文件名：Windows 两个 EXE、Mac 两个通用 DMG、Linux x64 六个 DEB/RPM/AppImage，共十个文件。
- `README.md` 与 `README.en.md` 互相链接，并提供当前版本的十个直接下载入口。Linux 与邮箱接入指南均有中英文版。
- backend、web、desktop 同步更新版本号，补齐中英文更新记录。运行后台测试、发布说明与下载测试，再构建界面。
- 源码先提交并推送，再推同版本标签，不改写旧标签。各安装包使用该标签和锁定依赖构建。
- 工作流先创建草稿，验证系统存储与原生依赖，在 Linux 安装 DEB 检查界面和 MCP，验证 AppImage 重连，并在 Fedora 检查 RPM 运行环境。只有通过检查的包才上传。
- 最后一个任务确认十个文件齐全，再公开双语预览 Release，并真实请求每个下载链接。缺少文件或格式不符会导致发布检查失败。仅说明更新不会替换安装包或公开草稿。
- `node scripts/Verify-ReleaseDownloads.mjs` 核对下载；API 限额时可设置 `GH_TOKEN`，文件下载本身仍使用未登录请求。公开草稿前先用 `--metadata-only` 检查完整性。
- 保留 Windows DPAPI 与 macOS Keychain 数据格式。Linux 使用 Secret Service，不允许明文密钥回退。测试钥匙串使用隔离 HOME 和 D-Bus 会话，不清理个人钥匙串条目。
