#!/bin/zsh

# Focused verification gate for the Jev customization surface. This intentionally
# avoids repo-wide checks; upstream CI owns the untouched upstream suite.

set -euo pipefail

readonly SCRIPT_DIR="${0:A:h}"
readonly REPO_ROOT="${T3CODE_JEV_REPO_ROOT:-${SCRIPT_DIR:h}}"
readonly BASE_BRANCH="${T3CODE_JEV_BASE_BRANCH:-main}"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'USAGE'
Usage: scripts/verify-jev-upstream-update.sh

Run the focused Jev update gate using Node.js ^24.13.1.
USAGE
  exit 0
fi
(( $# == 0 )) || {
  print -u2 -- "Unknown option: $1"
  exit 2
}

node_is_supported() {
  local candidate="$1"
  [[ -n "$candidate" && -x "$candidate" ]] || return 1
  "$candidate" -e '
    const [major, minor, patch] = process.versions.node.split(".").map(Number);
    process.exit(major === 24 && (minor > 13 || (minor === 13 && patch >= 1)) ? 0 : 1);
  ' >/dev/null 2>&1
}

resolve_node() {
  local candidate
  local -a candidates herd_candidates
  herd_candidates=(
    "${HOME}"/Library/Application\ Support/Herd/config/nvm/versions/node/v24*/bin/node(N)
  )
  candidates=(
    "${T3CODE_NODE:-}"
    "${commands[node]:-}"
    "${herd_candidates[@]}"
    "${HOME}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
  )
  for candidate in "${candidates[@]}"; do
    if node_is_supported "$candidate"; then
      print -r -- "$candidate"
      return 0
    fi
  done
  return 1
}

NODE_BIN="$(resolve_node)" || {
  print -u2 -- "Node.js ^24.13.1 is required for Jev update verification."
  print -u2 -- "Set T3CODE_NODE to a compatible executable and retry."
  exit 1
}
readonly NODE_BIN
export PATH="${NODE_BIN:h}:${REPO_ROOT}/node_modules/.bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

cd "$REPO_ROOT"
[[ -x node_modules/.bin/vp ]] || {
  print -u2 -- "Dependencies are missing; run vp i first."
  exit 1
}

changed_output="$(git diff --diff-filter=ACMR --name-only "${BASE_BRANCH}...HEAD" | sort -u)"
changed_files=("${(@f)changed_output}")
existing_files=()
for file in "${changed_files[@]}"; do
  [[ -f "$file" ]] && existing_files+=("$file")
done
(( ${#existing_files[@]} > 0 )) || {
  print -u2 -- "No Jev customization files were found against ${BASE_BRANCH}."
  exit 1
}

print -- "[verify] formatting ${#existing_files[@]} customization files"
vp fmt "${existing_files[@]}" --check

print -- "[verify] linting customization files"
vp lint "${existing_files[@]}" --quiet

test_output="$(print -rl -- "${existing_files[@]}" | rg '\.test\.(ts|tsx)$' || true)"
test_files=("${(@f)test_output}")
for extra in \
  apps/desktop/src/preview/RecordingInput.test.ts \
  apps/web/src/components/chat/ChatHeader.test.ts; do
  [[ -f "$extra" ]] && test_files+=("$extra")
done
test_files=("${(@f)$(print -rl -- "${test_files[@]}" | sort -u)}")

print -- "[verify] running ${#test_files[@]} focused test files"
vp test run "${test_files[@]}"

print -- "[verify] typechecking affected packages"
for package in \
  @t3tools/desktop \
  t3 \
  @t3tools/web \
  @t3tools/mobile \
  @t3tools/client-runtime \
  @t3tools/contracts \
  @t3tools/shared; do
  pnpm --filter "$package" typecheck >/dev/null
done

print -- "[verify] building the web client"
pnpm --filter @t3tools/web build >/dev/null

print -- "[verify] validating Jev evaluation and maintenance assets"
json_files=(JEV_*.json(N))
for file in "${json_files[@]}"; do
  jq empty "$file"
done
zsh -n \
  scripts/check-jev-upstream.sh \
  scripts/install-jev-upstream-monitor.sh \
  scripts/update-jev-from-upstream.sh \
  scripts/verify-jev-upstream-update.sh \
  scripts/install-jev-desktop-macos.sh
scripts/install-jev-desktop-macos.sh --help >/dev/null
"$NODE_BIN" --experimental-strip-types scripts/evaluate-jev.ts \
  --dry-run \
  --max-calls 1 \
  --budget-usd 0.01 >/dev/null

git diff --check
untracked="$(git ls-files --others --exclude-standard)"
[[ -z "$untracked" ]] || {
  print -u2 -- "Verification created unexpected untracked files:"
  print -u2 -- "$untracked"
  exit 1
}

print -- "Jev upstream verification passed."
