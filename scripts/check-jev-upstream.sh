#!/bin/zsh

# Fetch canonical T3 Code updates, optionally fast-forward the local/fork main mirror,
# and notify when the Jev customization branch needs a manual merge.

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
export GIT_TERMINAL_PROMPT=0

readonly SCRIPT_DIR="${0:A:h}"
readonly REPO_ROOT="${T3CODE_JEV_REPO_ROOT:-${SCRIPT_DIR:h}}"
readonly MAIN_BRANCH="${T3CODE_JEV_MAIN_BRANCH:-main}"
readonly CUSTOM_BRANCH="${T3CODE_JEV_CUSTOM_BRANCH:-codex/jev-router-mvp}"
readonly STATE_DIR="${REPO_ROOT}/.t3/upstream-update"
readonly STATUS_FILE="${STATE_DIR}/status.json"
readonly LAST_NOTIFICATION_FILE="${STATE_DIR}/last-notified-upstream"

NOTIFY=false
SYNC_MAIN=false
FETCH=true
PUSH=true

usage() {
  cat <<'USAGE'
Usage: scripts/check-jev-upstream.sh [options]

Options:
  --notify     Show a macOS notification once for each new upstream main SHA.
  --sync-main  Fast-forward local main and push the fork's origin/main when safe.
  --no-push    With --sync-main, keep the fast-forward local.
  --no-fetch   Report from the current remote-tracking refs without network access.
  --help       Show this help.
USAGE
}

while (( $# > 0 )); do
  case "$1" in
    --notify) NOTIFY=true ;;
    --sync-main) SYNC_MAIN=true ;;
    --no-push) PUSH=false ;;
    --no-fetch) FETCH=false ;;
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

notify() {
  local title="$1"
  local message="$2"
  [[ "$NOTIFY" == true && "$(uname -s)" == "Darwin" ]] || return 0
  /usr/bin/osascript - "$title" "$message" <<'APPLESCRIPT' >/dev/null 2>&1 || true
on run argv
  display notification (item 2 of argv) with title (item 1 of argv)
end run
APPLESCRIPT
}

fail() {
  local message="$1"
  print -u2 -- "Jev upstream check failed: ${message}"
  notify "T3 Code Jev update check needs attention" "$message"
  exit 1
}

[[ -d "${REPO_ROOT}/.git" || -f "${REPO_ROOT}/.git" ]] || \
  fail "Repository not found at ${REPO_ROOT}."
mkdir -p "$STATE_DIR"

readonly GIT_COMMON_DIR="$(git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-common-dir)"
readonly LOCK_DIR="${GIT_COMMON_DIR}/jev-upstream-update.lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  print -- "Another Jev upstream check or update is already running."
  exit 0
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT INT TERM

git -C "$REPO_ROOT" remote get-url upstream >/dev/null 2>&1 || \
  fail "The canonical upstream remote is missing."
git -C "$REPO_ROOT" remote get-url origin >/dev/null 2>&1 || \
  fail "The fork origin remote is missing."
git -C "$REPO_ROOT" show-ref --verify --quiet "refs/heads/${MAIN_BRANCH}" || \
  fail "Local ${MAIN_BRANCH} does not exist."
git -C "$REPO_ROOT" show-ref --verify --quiet "refs/heads/${CUSTOM_BRANCH}" || \
  fail "Local ${CUSTOM_BRANCH} does not exist."

if [[ "$FETCH" == true ]]; then
  git -C "$REPO_ROOT" fetch --prune upstream \
    "+refs/heads/${MAIN_BRANCH}:refs/remotes/upstream/${MAIN_BRANCH}" || \
    fail "Could not fetch upstream/${MAIN_BRANCH}."
  git -C "$REPO_ROOT" fetch --prune origin \
    "+refs/heads/${MAIN_BRANCH}:refs/remotes/origin/${MAIN_BRANCH}" \
    "+refs/heads/${CUSTOM_BRANCH}:refs/remotes/origin/${CUSTOM_BRANCH}" || \
    fail "Could not refresh the fork branches."
fi

git -C "$REPO_ROOT" show-ref --verify --quiet "refs/remotes/upstream/${MAIN_BRANCH}" || \
  fail "upstream/${MAIN_BRANCH} is unavailable."
git -C "$REPO_ROOT" show-ref --verify --quiet "refs/remotes/origin/${MAIN_BRANCH}" || \
  fail "origin/${MAIN_BRANCH} is unavailable."

find_worktree() {
  local branch="$1"
  git -C "$REPO_ROOT" worktree list --porcelain | awk -v target="refs/heads/${branch}" '
    $1 == "worktree" { path = substr($0, 10) }
    $1 == "branch" && $2 == target { print path; exit }
  '
}

MAIN_UPDATED=false
MAIN_WORKTREE="$(find_worktree "$MAIN_BRANCH")"
main_behind="$(git -C "$REPO_ROOT" rev-list --count "${MAIN_BRANCH}..upstream/${MAIN_BRANCH}")"
main_ahead="$(git -C "$REPO_ROOT" rev-list --count "upstream/${MAIN_BRANCH}..${MAIN_BRANCH}")"

if [[ "$SYNC_MAIN" == true && "$main_behind" -gt 0 ]]; then
  [[ "$main_ahead" -eq 0 ]] || \
    fail "Local ${MAIN_BRANCH} diverged from upstream; refusing an automatic update."
  [[ -n "$MAIN_WORKTREE" ]] || \
    fail "No worktree has ${MAIN_BRANCH} checked out."
  [[ -z "$(git -C "$MAIN_WORKTREE" status --porcelain --untracked-files=normal)" ]] || \
    fail "The ${MAIN_BRANCH} worktree is dirty; automatic fast-forward was skipped."
  git -C "$MAIN_WORKTREE" merge --ff-only "upstream/${MAIN_BRANCH}" || \
    fail "Could not fast-forward local ${MAIN_BRANCH}."
  MAIN_UPDATED=true
fi

if [[ "$SYNC_MAIN" == true && "$PUSH" == true ]]; then
  local_main_sha="$(git -C "$REPO_ROOT" rev-parse "$MAIN_BRANCH")"
  origin_main_sha="$(git -C "$REPO_ROOT" rev-parse "origin/${MAIN_BRANCH}")"
  if [[ "$local_main_sha" != "$origin_main_sha" ]]; then
    git -C "${MAIN_WORKTREE:-$REPO_ROOT}" push origin "${MAIN_BRANCH}:${MAIN_BRANCH}" || \
      fail "Local ${MAIN_BRANCH} is current, but pushing origin/${MAIN_BRANCH} failed."
  fi
fi

readonly CHECKED_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
readonly UPSTREAM_SHA="$(git -C "$REPO_ROOT" rev-parse "upstream/${MAIN_BRANCH}")"
readonly MAIN_SHA="$(git -C "$REPO_ROOT" rev-parse "$MAIN_BRANCH")"
readonly ORIGIN_MAIN_SHA="$(git -C "$REPO_ROOT" rev-parse "origin/${MAIN_BRANCH}")"
readonly CUSTOM_SHA="$(git -C "$REPO_ROOT" rev-parse "$CUSTOM_BRANCH")"
readonly MAIN_BEHIND="$(git -C "$REPO_ROOT" rev-list --count "${MAIN_BRANCH}..upstream/${MAIN_BRANCH}")"
readonly MAIN_AHEAD="$(git -C "$REPO_ROOT" rev-list --count "upstream/${MAIN_BRANCH}..${MAIN_BRANCH}")"
readonly CUSTOM_BEHIND="$(git -C "$REPO_ROOT" rev-list --count "${CUSTOM_BRANCH}..upstream/${MAIN_BRANCH}")"

STATUS="up-to-date"
if [[ "$MAIN_BEHIND" -gt 0 ]]; then
  STATUS="main-update-available"
elif [[ "$MAIN_AHEAD" -gt 0 || "$MAIN_SHA" != "$ORIGIN_MAIN_SHA" ]]; then
  STATUS="main-needs-attention"
elif [[ "$CUSTOM_BEHIND" -gt 0 ]]; then
  STATUS="customization-update-available"
fi

temporary_status="$(mktemp "${STATE_DIR}/status.XXXXXX")"
cat >"$temporary_status" <<JSON
{
  "checkedAt": "${CHECKED_AT}",
  "status": "${STATUS}",
  "upstreamMainSha": "${UPSTREAM_SHA}",
  "localMainSha": "${MAIN_SHA}",
  "originMainSha": "${ORIGIN_MAIN_SHA}",
  "customBranchSha": "${CUSTOM_SHA}",
  "mainBehind": ${MAIN_BEHIND},
  "mainAhead": ${MAIN_AHEAD},
  "customBehind": ${CUSTOM_BEHIND},
  "mainUpdated": ${MAIN_UPDATED},
  "updateCommand": "${REPO_ROOT}/scripts/update-jev-from-upstream.sh"
}
JSON
mv "$temporary_status" "$STATUS_FILE"

if [[ "$CUSTOM_BEHIND" -gt 0 ]]; then
  last_notified=""
  [[ -f "$LAST_NOTIFICATION_FILE" ]] && last_notified="$(<"$LAST_NOTIFICATION_FILE")"
  if [[ "$NOTIFY" == true && "$last_notified" != "$UPSTREAM_SHA" ]]; then
    notify "T3 Code Jev update ready" \
      "${CUSTOM_BEHIND} upstream commit(s) are ready. Run scripts/update-jev-from-upstream.sh."
    print -r -- "$UPSTREAM_SHA" >"$LAST_NOTIFICATION_FILE"
  fi
elif [[ -f "$LAST_NOTIFICATION_FILE" ]]; then
  : >"$LAST_NOTIFICATION_FILE"
fi

print -- "Upstream main: ${UPSTREAM_SHA}"
if [[ "$MAIN_UPDATED" == true ]]; then
  print -- "Main mirror: fast-forwarded; ${MAIN_BEHIND} behind, ${MAIN_AHEAD} ahead"
else
  print -- "Main mirror: ${MAIN_BEHIND} behind, ${MAIN_AHEAD} ahead"
fi
print -- "Jev customizations: ${CUSTOM_BEHIND} upstream commit(s) waiting"
print -- "Status: ${STATUS}"
print -- "Details: ${STATUS_FILE}"
