# 发布规范 / Release conventions

## 中文

- 发布标题统一使用「叠信 · Lettide 版本号」。发布说明必须包含下载表、中文更新、英文更新和两种语言的安装与连接指引。
- README 按语言分成 `README.md` 与 `README.en.md`，互相链接；接入指南同样提供中文和英文。英文入口不能只指向中文操作说明。
- `CHANGELOG.md` 每个版本分别填写 `### 中文` 与 `### English`。英文须完整表达对应版本的变化和限制，不以一句英文摘要替代。
- 安装包文件名保持 `Lettide-版本-系统-架构-语言`；GitHub 下载标签同时写出平台与「简体中文 / Chinese」或「English / 英文」。图标不嵌入文字，中文版安装名为「叠信」，英文版为「Lettide」。
- 同步 backend、web、desktop 三个包的版本号及 README 下载链接，完成检查并提交、推送源码，再推送同版本标签。禁止用同一标签覆盖不同程序代码。
- `node scripts/Prepare-Release.mjs --check` 验证版本与双语更新记录；去掉 `--check` 会生成发布正文。模板位于 `.github/RELEASE_TEMPLATE.md`。
- 标签触发的工作流先生成双语 Release，再构建四种安装包并添加双语下载标签。只修改文档时，可手动选择 `notes_only` 更新说明，不重建或覆盖现有安装包。
- 仓库保留既有可见性；不上传真实邮箱、邮件、附件、凭据、客户端备份或个人机器路径。明确区分构建、虚构数据检查和真实账号验收。

## English

- Use the title “叠信 · Lettide VERSION”. Every release includes a download table, complete Chinese and English changes, and account setup and installation instructions in both languages.
- Keep separate, cross-linked Chinese and English READMEs and setup guides. English entry points must lead to English instructions.
- Every version in `CHANGELOG.md` needs `### 中文` and `### English` sections. Translate the changes and limitations fully rather than replacing them with a short English summary.
- Keep installer filenames in the form `Lettide-VERSION-PLATFORM-ARCH-LANGUAGE`. Asset labels identify the platform and “简体中文 / Chinese” or “English / 英文”. Keep the icon free of text; Chinese installers use 叠信 and English installers use Lettide.
- Update all three package versions and README download links together. Check, commit and push the source before pushing its version tag. Never reuse a tag for different application code.
- Run `node scripts/Prepare-Release.mjs --check` to validate versions and bilingual notes, or omit `--check` to generate the release body from `.github/RELEASE_TEMPLATE.md`.
- Tag builds prepare the bilingual release before uploading four labeled installers. For documentation-only changes, dispatch the workflow with `notes_only` enabled; existing installers stay intact.
- Preserve repository visibility and exclude real mail, attachments, credentials, client backups and personal machine paths. Distinguish successful builds and fictional fixtures from live account acceptance tests.

[GitHub CLI: create releases](https://cli.github.com/manual/gh_release_create) · [Edit release notes](https://cli.github.com/manual/gh_release_edit)
