#!/bin/zsh

# Install a checkout-backed, headless Jev CLI without modifying the official t3 command.
set -euo pipefail

readonly SCRIPT_DIR="${0:A:h}"
readonly REPO_ROOT="${SCRIPT_DIR:h}"
readonly PREFIX="${T3JEV_CLI_PREFIX:-${HOME}/.local}"
readonly LAUNCHER="${PREFIX}/bin/t3jev"
readonly ENTRY="${REPO_ROOT}/apps/server/dist/bin.mjs"

case "${1:-}" in
  --help|-h)
    print -- "Usage: T3JEV_CLI_PREFIX=/install/prefix ./scripts/install-jev-cli-macos.sh [--uninstall]"
    print -- "Build first with: cd apps/server && vp run build:bundle"
    print -- "Set T3CODE_NODE to a Node.js 24+ executable if the default Node is older."
    print -- "The launcher uses T3JEV_HOME (default: ~/.t3-jev) for its separate runtime state."
    exit 0 ;;
  --uninstall)
    if [[ -f "$LAUNCHER" ]] && /usr/bin/grep -Fq '# t3code-jev checkout launcher' "$LAUNCHER"; then
      /bin/rm -- "$LAUNCHER"
      print -- "Removed ${LAUNCHER}"
    else
      print -u2 -- "Refusing to remove a launcher not installed by this script: ${LAUNCHER}"
      exit 1
    fi
    exit 0 ;;
  '') ;;
  *) print -u2 -- "Unknown option: $1"; exit 1 ;;
esac

[[ "$(uname -s)" == "Darwin" ]] || { print -u2 -- "This installer supports macOS only"; exit 1; }
[[ -f "$ENTRY" ]] || { print -u2 -- "Missing ${ENTRY}; run cd apps/server && vp run build:bundle first"; exit 1; }
node_bin="${T3CODE_NODE:-${commands[node]:-}}"
if [[ -z "$node_bin" || ! -x "$node_bin" || "$("$node_bin" -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null)" -lt 24 ]]; then
  node_bin="${HOME}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
fi
[[ -x "$node_bin" && "$("$node_bin" -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null)" -ge 24 ]] || {
  print -u2 -- "Node.js 24 or newer is required; set T3CODE_NODE to its executable"
  exit 1
}
[[ ! -e "$LAUNCHER" && ! -L "$LAUNCHER" ]] || {
  if ! /usr/bin/grep -Fq '# t3code-jev checkout launcher' "$LAUNCHER" 2>/dev/null; then
    print -u2 -- "Refusing to replace existing ${LAUNCHER}"
    exit 1
  fi
}

/bin/mkdir -p -- "${PREFIX}/bin"
temporary="$(/usr/bin/mktemp "${PREFIX}/bin/.t3jev.XXXXXX")"
trap '/bin/rm -f -- "$temporary"' EXIT
cat > "$temporary" <<EOF
#!/bin/zsh
# t3code-jev checkout launcher
set -euo pipefail
export T3CODE_HOME="\${T3JEV_HOME:-\${HOME}/.t3-jev}"
export T3JEV_CLI_NAME=t3jev
exec "\${T3CODE_NODE:-${node_bin}}" ${(q)ENTRY} "\$@"
EOF
/bin/chmod 755 "$temporary"
/bin/mv -f -- "$temporary" "$LAUNCHER"
print -- "Installed ${LAUNCHER} (add ${PREFIX}/bin to PATH if needed)"
