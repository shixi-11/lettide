# Linux installation and use

[简体中文](linux.md) · [Back to downloads](../README.en.md)

Lettide supports common x64 desktop Linux distributions. Ubuntu 22.04+, Debian 12+ and supported Fedora releases are recommended. This release does not provide 32-bit, ARM Linux or Alpine packages.

## Choose a package

- **Ubuntu / Debian:** download the `.deb` and open it with Software Install. The package manager resolves dependencies. Alternatively, run `sudo apt install ./Lettide-VERSION-linux-x64-en.deb`.
- **Fedora:** download the `.rpm` and install it through the software center, or use `sudo dnf install ./Lettide-VERSION-linux-x64-en.rpm`.
- **Other supported desktop distributions:** download the `.AppImage`, allow execution in its file properties and open it. Alternatively, run `chmod +x Lettide-VERSION-linux-x64-en.AppImage` first. Node.js is included.

AppImage still uses system graphics libraries, a desktop keyring and FUSE. Without FUSE, extract with `./Lettide-VERSION-linux-x64-en.AppImage --appimage-extract`, then run `./squashfs-root/AppRun` and keep the extracted directory in a permanent location. On systems that restrict the AppImage sandbox, prefer the distribution's DEB/RPM package rather than disabling the browser sandbox.

## Desktop keyring

Mail and attachments use AES-256-GCM encryption. The random key is stored in the desktop Secret Service keyring. Sign in to your graphical desktop and unlock its keyring before opening Lettide. DEB/RPM packages declare the required dependencies; AppImage users must provide `secret-tool` and a working Secret Service provider.

On Ubuntu / Debian these packages are `libsecret-tools` and `gnome-keyring`; on Fedora they are `libsecret` and `gnome-keyring`. Missing tools, a locked keyring or a missing key cause storage to fail safely. Lettide does not fall back to plaintext or erase old mail to start over. Lightweight desktops may need keyring setup. Headless servers are outside this release's support scope.

Data defaults to `${XDG_DATA_HOME:-~/.local/share}/Lettide`. Set `LETTIDE_DATA_DIR` to choose a separate directory. Keep mail data and keyring secrets out of Git; do not remove keyring items unless you understand their purpose.

## AI clients and background service

In AI Connection, choose Configure AI assistants to configure installed Codex CLI and Claude Code commands found on PATH. An existing Claude desktop configuration is merged while preserving other settings. Availability of a Linux desktop client depends on the corresponding product.

Move an AppImage to its permanent location before configuring AI clients, then keep its name and location unchanged. Closing a window leaves Lettide in the system tray; Quit Lettide stops the app and shared service. Some GNOME desktops require an AppIndicator extension to display tray icons. Launching Lettide again reopens its existing window.
