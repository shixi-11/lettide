# 发布规范 / Release conventions

## English

- This release provides Windows x64 EXE installers and universal Mac DMGs in English and Chinese: four files. Linux installers are deferred.
- `desktop/release-targets.mjs` defines installer names and generates both download tables. Keep README links on the current released version.
- Keep backend, web and desktop versions together. Each release has complete English and Chinese changes, downloads, installation and account setup; English comes first.
- Commit and push source before its immutable version tag. A full installer build must use that exact tag; published installers cannot be replaced.
- The workflow installs the Windows EXE, mounts and copies the Mac DMG, and verifies the installed UI, localized name, encrypted storage, bundled native dependencies and shared AI connection using fictional data.
- Only complete, checked files are uploaded to the draft. Publication requires all four files and then verifies every public download URL without authentication.
- `node scripts/Verify-ReleaseDownloads.mjs --metadata-only` checks draft completeness; omit the flag to verify published downloads. A missing or invalid file fails the check.
- Notes-only runs update bilingual descriptions without rebuilding installers or publishing drafts. Manual infrastructure retries can set `release_ref` to the original version tag. Release operations are serialized while matrix builds remain parallel.

## 简体中文

- 本轮提供 Windows x64 EXE 与 Mac 通用 DMG 的中英文安装包，共四个文件；Linux 安装包暂缓。
- `desktop/release-targets.mjs` 定义安装文件名并生成双语下载表。两份 README 的链接始终指向当前已发布版本。
- backend、web、desktop 版本号保持一致。发布页英文在前、中文在后，各有完整更新、下载、安装与邮箱接入说明。
- 源码先提交并推送，再推不可改写的版本标签；完整构建必须使用该标签，已公开安装包不被替换。
- 工作流安装 Windows EXE、挂载复制 Mac DMG，用虚构数据检查安装后的界面、对应语言名称、加密存储、内置原生依赖及共享 AI 连接。
- 通过检查的完整文件才上传草稿；确认四个文件齐全后公开，再逐个验证无需登录的下载链接。
- `node scripts/Verify-ReleaseDownloads.mjs --metadata-only` 检查草稿完整性；不带该参数则检查公开下载。缺少文件或格式不符会使检查失败。
- 仅说明更新不会重建安装包或公开草稿。构建环境重试可指定 `release_ref` 为原版本标签。发布操作串行，平台和语言构建仍并行。
