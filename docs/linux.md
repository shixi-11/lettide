# Linux 安装与使用

[English](linux.en.md) · [返回下载](../README.md#下载安装)

支持常用的 x64 桌面 Linux。推荐 Ubuntu 22.04+、Debian 12+ 或受支持的 Fedora 版本；不提供 32 位、ARM Linux 或 Alpine 安装包。

## 选择安装包

- **Ubuntu / Debian：**下载 `.deb`，用系统「软件安装」打开并安装。系统会处理依赖；也可使用 `sudo apt install ./Lettide-版本-linux-x64-zh-CN.deb`。
- **Fedora：**下载 `.rpm`，用系统软件中心打开并安装；也可使用 `sudo dnf install ./Lettide-版本-linux-x64-zh-CN.rpm`。
- **其他常用桌面发行版：**选择 `.AppImage`，在文件属性中允许执行后打开。也可先运行 `chmod +x Lettide-版本-linux-x64-zh-CN.AppImage`。不需要另装 Node.js。

AppImage 仍使用系统图形库、桌面钥匙串和 FUSE。若系统没有 FUSE，可先用 `./Lettide-版本-linux-x64-zh-CN.AppImage --appimage-extract` 解包，再运行 `./squashfs-root/AppRun`；请把解包目录保存在固定位置。限制 AppImage 沙箱的系统建议使用本发行版的 DEB/RPM 包，不要关闭浏览器沙箱。

## 桌面钥匙串

邮件与附件使用 AES-256-GCM 加密，随机密钥保存在系统 Secret Service 钥匙串。打开应用前应登录图形桌面并解锁钥匙串。DEB/RPM 声明了所需依赖；AppImage 用户需自行确保已安装 `secret-tool` 和可用的 Secret Service 提供者。

Ubuntu / Debian 对应 `libsecret-tools`、`gnome-keyring`；Fedora 对应 `libsecret`、`gnome-keyring`。缺少工具、钥匙串锁定或密钥丢失时，叠信拒绝明文保存，也不会清空旧邮件来重新开始。轻量桌面需要先配置其钥匙串服务；纯无头服务器不在本版本支持范围内。

默认数据位于 `${XDG_DATA_HOME:-~/.local/share}/Lettide`，可用 `LETTIDE_DATA_DIR` 指定独立目录。不要把数据目录或钥匙串密钥提交到 Git，也不要在不知道用途时删除钥匙串条目。

## AI 与后台

应用内「AI 连接 → 配置 AI 助手」可配置已安装且位于 PATH 的 Codex CLI、Claude Code；若已有 Claude 桌面端配置目录，也会保留原配置并合并叠信入口。客户端是否提供 Linux 桌面版本取决于对应产品。

AppImage 请先移到固定位置，再配置 AI；之后不要改名或移动该文件。关闭窗口会收起到托盘，托盘菜单中的「退出叠信」会停止应用和共享后台。某些 GNOME 桌面需要 AppIndicator 扩展才显示托盘图标；仍可再次启动应用打开原窗口。
