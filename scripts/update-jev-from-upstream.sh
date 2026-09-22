#!/bin/zsh

# Safely merge canonical upstream main into the long-lived Jev customization branch.
# Main is fast-forwarded first; the customization merge is preflighted and verified
# before its merge commit is pushed.

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
export GIT_TERMINAL_PROMPT=0

readonly SCRIPT_DIR="${0:A:h}"
readonly REPO_ROOT="${T3CODE_JEV_REPO_ROOT:-${SCRIPT_DIR:h}}"
readonly MAIN_BRANCH="${T3CODE_JEV_MAIN_BRANCH:-main}"
readonly CUSTOM_BRANCH="${T3CODE_JEV_CUSTOM_BRANCH:-codex/jev-router-mvp}"
PUSH=true

usage() {
  cat <<'USAGE'
Usage: scripts/update-jev-from-upstream.sh [--no-push]

The updater:
  1. fetches canonical upstream and fast-forwards the main mirror;
  2. refuses dirty, divergent, or conflicting worktrees;
  3. creates a local safety branch;
  4. merges main without committing;
  5. runs the Jev-focused verification gate;
  6. commits and pushes only after the gate passes.

Options:
  --no-push  Keep successful main/customization updates local.
  --help     Show this help.
USAGE
}

while (( $# > 0 )); do
  case "$1" in
    --no-push) PUSH=false ;;
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

fail() {
  print -u2 -- "Jev upstream update stopped safely: $1"
  exit 1
}

find_worktree() {
  local branch="$1"
  git -C "$REPO_ROOT" worktree list --porcelain | awk -v target="refs/heads/${branch}" '
    $1 == "worktree" { path = substr($0, 10) }
    $1 == "branch" && $2 == target { print path; exit }
  '
}

[[ -x "${SCRIPT_DIR}/check-jev-upstream.sh" ]] || \
  fail "The upstream checker is missing or not executable."
[[ -x "${SCRIPT_DIR}/verify-jev-upstream-update.sh" ]] || \
  fail "The verification script is missing or not executable."

checker_args=(--sync-main)
[[ "$PUSH" == false ]] && checker_args+=(--no-push)
"${SCRIPT_DIR}/check-jev-upstream.sh" "${checker_args[@]}"

readonly MAIN_WORKTREE="$(find_worktree "$MAIN_BRANCH")"
readonly CUSTOM_WORKTREE="$(find_worktree "$CUSTOM_BRANCH")"
[[ -n "$MAIN_WORKTREE" ]] || fail "No worktree has ${MAIN_BRANCH} checked out."
[[ -n "$CUSTOM_WORKTREE" ]] || fail "No worktree has ${CUSTOM_BRANCH} checked out."
[[ -z "$(git -C "$MAIN_WORKTREE" status --porcelain --untracked-files=normal)" ]] || \
  fail "The ${MAIN_BRANCH} worktree is dirty."
[[ -z "$(git -C "$CUSTOM_WORKTREE" status --porcelain --untracked-files=normal)" ]] || \
  fail "The ${CUSTOM_BRANCH} worktree is dirty."

git -C "$REPO_ROOT" config rerere.enabled true
git -C "$REPO_ROOT" config rerere.autoupdate false
git -C "$REPO_ROOT" config merge.conflictStyle zdiff3

if git -C "$REPO_ROOT" merge-base --is-ancestor "$MAIN_BRANCH" "$CUSTOM_BRANCH"; then
  print -- "${CUSTOM_BRANCH} already contains ${MAIN_BRANCH}; nothing to merge."
  exit 0
fi

readonly GIT_COMMON_DIR="$(git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-common-dir)"
readonly LOCK_DIR="${GIT_COMMON_DIR}/jev-upstream-update.lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  fail "Another Jev upstream check or update is already running."
fi
temporary_merge="$(mktemp "${TMPDIR:-/tmp}/t3code-jev-merge-tree.XXXXXX")"
cleanup() {
  rm -f "$temporary_merge"
  rmdir "$LOCK_DIR" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

if ! git -C "$REPO_ROOT" merge-tree --write-tree "$CUSTOM_BRANCH" "$MAIN_BRANCH" \
  >"$temporary_merge" 2>&1; then
  print -u2 -- "The upstream merge has conflicts. No branch was changed."
  cat "$temporary_merge" >&2
  exit 1
fi

readonly BACKUP_BRANCH="backup/jev-router-mvp-pre-upstream-$(date -u '+%Y%m%d-%H%M%S')"
git -C "$REPO_ROOT" branch "$BACKUP_BRANCH" "$CUSTOM_BRANCH"

if ! git -C "$CUSTOM_WORKTREE" merge --no-ff --no-commit "$MAIN_BRANCH"; then
  git -C "$CUSTOM_WORKTREE" merge --abort || true
  fail "The preflight and real merge disagreed; the merge was aborted."
fi

if ! "${SCRIPT_DIR}/verify-jev-upstream-update.sh"; then
  git -C "$CUSTOM_WORKTREE" merge --abort || true
  fail "Verification failed; the customization merge was aborted. Safety branch: ${BACKUP_BRANCH}."
fi

git -C "$CUSTOM_WORKTREE" commit -m "chore: merge upstream main into Jev customizations"
if [[ "$PUSH" == true ]]; then
  git -C "$CUSTOM_WORKTREE" push origin "${CUSTOM_BRANCH}:${CUSTOM_BRANCH}" || \
    fail "Verification passed and the merge is committed locally, but the push failed."
fi

cleanup
trap - EXIT INT TERM
"${SCRIPT_DIR}/check-jev-upstream.sh" --no-fetch

print -- "Jev update complete."
print -- "Safety branch: ${BACKUP_BRANCH}"
print -- "Main: $(git -C "$REPO_ROOT" rev-parse --short "$MAIN_BRANCH")"
print -- "Customizations: $(git -C "$REPO_ROOT" rev-parse --short "$CUSTOM_BRANCH")"
