# Jev upstream updates

The Jev fork keeps canonical T3 Code and local customizations on separate branches:

- `main` is a fast-forward-only mirror of `upstream/main` and is pushed to `origin/main`.
- `codex/jev-router-mvp` contains Jev customizations and receives explicit merge commits from
  `main`.

Do not rebase the published customization branch. Merge commits preserve the relationship to
upstream, while Git `rerere` retains repeated conflict resolutions on this clone.

## Update monitor

Install the per-user macOS monitor once:

```sh
./scripts/install-jev-upstream-monitor.sh
```

It runs at login and every 12 hours. Each check fetches canonical upstream, fast-forwards the
clean `main` worktree, pushes the fork's `origin/main`, and writes status to
`.t3/upstream-update/status.json`. When the customization branch is behind, macOS shows one
notification for that upstream revision.

The monitor never merges or pushes the customization branch. Inspect it with:

```sh
./scripts/install-jev-upstream-monitor.sh --status
./scripts/check-jev-upstream.sh
```

The interval can be changed without duplicating the LaunchAgent:

```sh
./scripts/install-jev-upstream-monitor.sh --interval-hours 24
```

## Apply an update

Run the updater from either worktree:

```sh
./scripts/update-jev-from-upstream.sh
```

The updater refuses dirty or divergent branches. It updates `main`, checks the prospective merge
for conflicts, creates a timestamped safety branch, merges without committing, and runs the Jev
verification gate. Only a passing merge is committed and pushed. A conflict changes no branch; a
verification failure aborts the uncommitted merge.

The gate covers customized tests, affected package typechecks, formatting, lint, the web build,
the Jev evaluator dry run, evaluation JSON, and maintenance-script syntax. It requires Node.js
`^24.13.1` and installed repository dependencies.

To exercise the updater without pushing either branch:

```sh
./scripts/update-jev-from-upstream.sh --no-push
```

Monitor logs live under `.t3/upstream-update/`. Remove the scheduled check with:

```sh
./scripts/install-jev-upstream-monitor.sh --uninstall
```
