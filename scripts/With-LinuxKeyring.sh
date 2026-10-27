#!/usr/bin/env bash
set -euo pipefail
if [[ "${LETTIDE_KEYRING_TEST_SESSION:-}" != 1 ]]; then
  test_root="$(mktemp -d /tmp/lettide-keyring.XXXXXXXX)"
  cleanup() { [[ "$test_root" == /tmp/lettide-keyring.* ]] && rm -rf -- "$test_root"; }
  trap cleanup EXIT
  mkdir -m 700 "$test_root/home" "$test_root/run"
  HOME="$test_root/home" XDG_RUNTIME_DIR="$test_root/run" XDG_CONFIG_HOME="$test_root/home/.config" XDG_DATA_HOME="$test_root/home/.local/share" LETTIDE_KEYRING_TEST_SESSION=1 dbus-run-session -- bash "$0" "$@"
  exit $?
fi
printf '%s' 'fictional-ci-keyring-password' | gnome-keyring-daemon --unlock --components=secrets >/dev/null
"$@"
