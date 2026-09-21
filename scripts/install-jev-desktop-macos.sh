#!/bin/zsh

set -euo pipefail

readonly SCRIPT_DIR="${0:A:h}"
readonly REPO_ROOT="${SCRIPT_DIR:h}"
readonly INSTALL_DIR="${HOME}/Applications"
readonly DESTINATION="${INSTALL_DIR}/T3 Code Jev.app"
readonly OFFICIAL_APP="/Applications/T3 Code (Alpha).app"
readonly JEV_BUNDLE_ID="com.t3tools.t3code.jev"
readonly VERIFY_ONLY="${1:-}"

fail() {
  print -u2 -- "install-jev-desktop-macos: $*"
  exit 1
}

node_major_version() {
  "$1" -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null
}

resolve_node() {
  local candidate
  local -a candidates
  candidates=(
    "${T3CODE_NODE:-}"
    "${commands[node]:-}"
    "${HOME}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
  )

  for candidate in "${candidates[@]}"; do
    [[ -n "$candidate" && -x "$candidate" ]] || continue
    if (( $(node_major_version "$candidate") >= 24 )); then
      print -r -- "$candidate"
      return 0
    fi
  done

  return 1
}

app_is_running() {
  /usr/bin/osascript - "$JEV_BUNDLE_ID" <<'APPLESCRIPT'
on run argv
  set bundleId to item 1 of argv
  tell application "System Events"
    return exists (first application process whose bundle identifier is bundleId)
  end tell
end run
APPLESCRIPT
}

quit_installed_app() {
  [[ -d "$DESTINATION" ]] || return 0
  [[ "$(app_is_running)" == "true" ]] || return 0

  print -- "Quitting ${DESTINATION}..."
  /usr/bin/osascript <<'APPLESCRIPT'
tell application id "com.t3tools.t3code.jev" to quit
APPLESCRIPT

  local attempt
  for attempt in {1..30}; do
    [[ "$(app_is_running)" == "false" ]] && return 0
    sleep 1
  done

  fail "the installed Jev app did not quit after 30 seconds; close it manually and retry"
}

[[ "$(uname -s)" == "Darwin" ]] || fail "this installer only supports macOS"
[[ -z "$VERIFY_ONLY" || "$VERIFY_ONLY" == "--verify-only" ]] || fail "usage: $0 [--verify-only]"
[[ -f "${REPO_ROOT}/scripts/build-desktop-artifact.ts" ]] || fail "repository root not found"
[[ -x "${REPO_ROOT}/node_modules/.bin/vp" ]] || fail "dependencies are missing; run vp i first"
[[ ! -L "$DESTINATION" ]] || fail "refusing to replace symlink at ${DESTINATION}"

case "$(uname -m)" in
  arm64) readonly ARCH="arm64" ;;
  x86_64) readonly ARCH="x64" ;;
  *) fail "unsupported Mac architecture: $(uname -m)" ;;
esac

NODE_BIN="$(resolve_node)" || fail "Node.js 24 or newer is required; set T3CODE_NODE to its executable"
readonly NODE_BIN
export PATH="${NODE_BIN:h}:${REPO_ROOT}/node_modules/.bin:${PATH}"

TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/t3code-jev-install.XXXXXX")"
readonly TEMP_ROOT
readonly OUTPUT_DIR="${TEMP_ROOT}/artifacts"
readonly UNPACK_DIR="${TEMP_ROOT}/unpacked"
readonly PREPARED_APP="${TEMP_ROOT}/T3 Code Jev.app"
readonly PREVIOUS_APP="${TEMP_ROOT}/previous.app"

cleanup() {
  /bin/rm -rf "$TEMP_ROOT"
}
trap cleanup EXIT INT TERM

# macOS 27's iconutil currently rejects even iconsets that it extracted itself. Let the normal
# conversion run first, then retain the installed production icon if that system tool fails.
for icon_candidate in \
  "${DESTINATION}/Contents/Resources/icon.icns" \
  "${OFFICIAL_APP}/Contents/Resources/icon.icns"; do
  if [[ -f "$icon_candidate" ]]; then
    export T3CODE_JEV_FALLBACK_ICNS="$icon_candidate"
    readonly ICONUTIL_SHIM_DIR="${TEMP_ROOT}/bin"
    mkdir -p "$ICONUTIL_SHIM_DIR"
    cat >"${ICONUTIL_SHIM_DIR}/iconutil" <<'ICONUTIL_SHIM'
#!/bin/zsh
if /usr/bin/iconutil "$@"; then
  exit 0
fi

output=""
while (( $# > 0 )); do
  if [[ "$1" == "-o" || "$1" == "--output" ]]; then
    shift
    output="${1:-}"
    break
  fi
  shift
done

[[ -n "$output" && -f "${T3CODE_JEV_FALLBACK_ICNS:-}" ]] || exit 1
/bin/cp "$T3CODE_JEV_FALLBACK_ICNS" "$output"
print -u2 -- "iconutil failed; reused the installed T3 Code icon for this local build."
ICONUTIL_SHIM
    chmod +x "${ICONUTIL_SHIM_DIR}/iconutil"
    export PATH="${ICONUTIL_SHIM_DIR}:${PATH}"
    break
  fi
done

print -- "Building the latest ${ARCH} desktop app from ${REPO_ROOT}..."
cd "$REPO_ROOT"
"$NODE_BIN" scripts/build-desktop-artifact.ts \
  --platform mac \
  --target zip \
  --arch "$ARCH" \
  --output-dir "$OUTPUT_DIR"

ZIP_PATH="$(find "$OUTPUT_DIR" -maxdepth 1 -type f -name "T3-Code-*-${ARCH}.zip" -print -quit)"
[[ -n "$ZIP_PATH" ]] || fail "the desktop build did not produce the expected ZIP artifact"

mkdir -p "$UNPACK_DIR"
/usr/bin/ditto -x -k "$ZIP_PATH" "$UNPACK_DIR"
BUILT_APP="$(find "$UNPACK_DIR" -maxdepth 2 -type d -name '*.app' -print -quit)"
[[ -n "$BUILT_APP" ]] || fail "the desktop ZIP did not contain an app bundle"

EXECUTABLE_NAME="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "${BUILT_APP}/Contents/Info.plist")"
[[ -x "${BUILT_APP}/Contents/MacOS/${EXECUTABLE_NAME}" ]] || fail "the built app bundle is incomplete"
/usr/bin/ditto "$BUILT_APP" "$PREPARED_APP"

readonly PREPARED_PLIST="${PREPARED_APP}/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier ${JEV_BUNDLE_ID}" "$PREPARED_PLIST"
# Electron locates its packaged helper apps from CFBundleName. Keep the builder's internal name;
# CFBundleDisplayName and the outer .app directory provide the visible Jev identity.
/usr/libexec/PlistBuddy -c 'Set :CFBundleDisplayName T3 Code Jev' "$PREPARED_PLIST"
readonly INTERNAL_APP_NAME="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleName' "$PREPARED_PLIST")"
[[ -d "${PREPARED_APP}/Contents/Frameworks/${INTERNAL_APP_NAME} Helper.app" ]] || \
  fail "the app name no longer matches its Electron helper bundles"
# Keep the official app as the owner of t3code:// links and prevent this local build from replacing
# itself through the official update channel.
/usr/libexec/PlistBuddy -c 'Delete :CFBundleURLTypes' "$PREPARED_PLIST"
/usr/libexec/PlistBuddy -c 'Add :LSMultipleInstancesProhibited bool true' "$PREPARED_PLIST" 2>/dev/null || \
  /usr/libexec/PlistBuddy -c 'Set :LSMultipleInstancesProhibited true' "$PREPARED_PLIST"
/usr/libexec/PlistBuddy -c 'Add :LSEnvironment dict' "$PREPARED_PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c 'Delete :LSEnvironment:T3CODE_DISABLE_AUTO_UPDATE' "$PREPARED_PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c 'Add :LSEnvironment:T3CODE_DISABLE_AUTO_UPDATE string true' "$PREPARED_PLIST"
/usr/bin/codesign --force --deep --sign - "$PREPARED_APP"
/usr/bin/codesign --verify --deep --strict "$PREPARED_APP"

if [[ "$VERIFY_ONLY" == "--verify-only" ]]; then
  print -- "Verified a fresh ${ARCH} T3 Code Jev app bundle without changing installed apps."
  exit 0
fi

quit_installed_app
mkdir -p "$INSTALL_DIR"

if [[ -e "$DESTINATION" ]]; then
  mv "$DESTINATION" "$PREVIOUS_APP"
fi

if ! mv "$PREPARED_APP" "$DESTINATION"; then
  [[ -e "$PREVIOUS_APP" ]] && mv "$PREVIOUS_APP" "$DESTINATION"
  fail "installation failed; the previous Jev app was restored"
fi

/usr/bin/codesign --verify --deep --strict "$DESTINATION"
readonly VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "${DESTINATION}/Contents/Info.plist")"
readonly INSTALLED_BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "${DESTINATION}/Contents/Info.plist")"
[[ "$INSTALLED_BUNDLE_ID" == "$JEV_BUNDLE_ID" ]] || fail "installed app has the wrong bundle identifier"

print -- "Installed T3 Code Jev ${VERSION} at ${DESTINATION}."
[[ -d "$OFFICIAL_APP" ]] && print -- "Official T3 app preserved at ${OFFICIAL_APP}."
