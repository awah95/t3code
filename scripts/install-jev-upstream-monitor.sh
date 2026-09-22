#!/bin/zsh

# Install a per-user launchd monitor that keeps the fork's main mirror current and
# notifies when the Jev customization branch has upstream commits ready to merge.

set -euo pipefail

readonly SCRIPT_DIR="${0:A:h}"
readonly REPO_ROOT="${T3CODE_JEV_REPO_ROOT:-${SCRIPT_DIR:h}}"
readonly LABEL="com.t3tools.t3code-jev-upstream"
readonly DOMAIN="gui/$(id -u)"
readonly LAUNCH_AGENTS_DIR="${HOME}/Library/LaunchAgents"
readonly PLIST_PATH="${LAUNCH_AGENTS_DIR}/${LABEL}.plist"
readonly STATE_DIR="${REPO_ROOT}/.t3/upstream-update"

MODE="install"
INTERVAL_HOURS=12

usage() {
  cat <<'USAGE'
Usage: scripts/install-jev-upstream-monitor.sh [options]

Options:
  --interval-hours N  Check every N hours (default: 12; allowed: 1-48).
  --status            Show launchd and last-check status.
  --uninstall         Remove the per-user monitor.
  --help              Show this help.
USAGE
}

while (( $# > 0 )); do
  case "$1" in
    --interval-hours)
      shift
      [[ $# -gt 0 ]] || { usage >&2; exit 2; }
      INTERVAL_HOURS="$1"
      ;;
    --status) MODE="status" ;;
    --uninstall) MODE="uninstall" ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      usage >&2
      print -u2 -- "Unknown option: $1"
      exit 2
      ;;
  esac
  shift
done

if [[ "$MODE" == "status" ]]; then
  if launchctl print "${DOMAIN}/${LABEL}" >/dev/null 2>&1; then
    print -- "Monitor: loaded (${LABEL})"
    launchctl print "${DOMAIN}/${LABEL}" | grep -E '^\s*(state|runs|last exit code) = ' || true
  else
    print -- "Monitor: not loaded"
  fi
  if [[ -f "${STATE_DIR}/status.json" ]]; then
    print -- "Last check:"
    jq . "${STATE_DIR}/status.json"
  else
    print -- "Last check: none"
  fi
  exit 0
fi

if [[ "$MODE" == "uninstall" ]]; then
  launchctl bootout "$DOMAIN" "$PLIST_PATH" >/dev/null 2>&1 || true
  if [[ -f "$PLIST_PATH" ]]; then
    rm -f "$PLIST_PATH"
  fi
  print -- "Removed ${LABEL}."
  exit 0
fi

[[ "$INTERVAL_HOURS" == <-> ]] || {
  print -u2 -- "--interval-hours must be a whole number."
  exit 2
}
(( INTERVAL_HOURS >= 1 && INTERVAL_HOURS <= 48 )) || {
  print -u2 -- "--interval-hours must be between 1 and 48."
  exit 2
}
[[ -x "${SCRIPT_DIR}/check-jev-upstream.sh" ]] || {
  print -u2 -- "The upstream checker is missing or not executable."
  exit 1
}

xml_escape() {
  print -r -- "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'
}

readonly INTERVAL_SECONDS="$(( INTERVAL_HOURS * 60 * 60 ))"
readonly XML_REPO_ROOT="$(xml_escape "$REPO_ROOT")"
readonly XML_CHECKER="$(xml_escape "${SCRIPT_DIR}/check-jev-upstream.sh")"
readonly XML_STDOUT="$(xml_escape "${STATE_DIR}/monitor.log")"
readonly XML_STDERR="$(xml_escape "${STATE_DIR}/monitor-error.log")"

mkdir -p "$LAUNCH_AGENTS_DIR" "$STATE_DIR"
temporary_plist="$(mktemp "${STATE_DIR}/launch-agent.XXXXXX")"
trap 'rm -f "$temporary_plist"' EXIT INT TERM
cat >"$temporary_plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>${XML_CHECKER}</string>
    <string>--notify</string>
    <string>--sync-main</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${XML_REPO_ROOT}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>${INTERVAL_SECONDS}</integer>
  <key>StandardOutPath</key>
  <string>${XML_STDOUT}</string>
  <key>StandardErrorPath</key>
  <string>${XML_STDERR}</string>
  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
PLIST
plutil -lint "$temporary_plist" >/dev/null
mv "$temporary_plist" "$PLIST_PATH"
trap - EXIT INT TERM

launchctl bootout "$DOMAIN" "$PLIST_PATH" >/dev/null 2>&1 || true
launchctl bootstrap "$DOMAIN" "$PLIST_PATH"
launchctl enable "${DOMAIN}/${LABEL}"
launchctl kickstart -k "${DOMAIN}/${LABEL}"

print -- "Installed ${LABEL}."
print -- "Checks: every ${INTERVAL_HOURS} hour(s), plus once now"
print -- "Status: ${SCRIPT_DIR}/install-jev-upstream-monitor.sh --status"
print -- "Manual update: ${SCRIPT_DIR}/update-jev-from-upstream.sh"
