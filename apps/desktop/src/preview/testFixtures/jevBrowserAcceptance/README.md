# Jev browser acceptance fixtures

These disposable pages keep browser-visible status separate from the authoritative server state and event log. Every run should use a distinct `session` query value and call `POST /api/reset?session=...` before its first observation.

Run the focused fixture tests from the repository root:

```sh
vp test run apps/desktop/src/preview/testFixtures/jevBrowserAcceptance/fixture-harness.test.mjs
```

For an acceptance run, copy the self-contained harness outside the worktree and start it there. The harness prints its two origins as one JSON line; keep the process PID so the primary agent can stop exactly that process.

```sh
fixture_source="$PWD/apps/desktop/src/preview/testFixtures/jevBrowserAcceptance"
fixture_run_dir="$(mktemp -d /tmp/t3-jev-browser-fixtures.XXXXXX)"
cp -R "$fixture_source"/. "$fixture_run_dir"/
cd "$fixture_run_dir"
node server.mjs --primary-port 0 --cross-origin-port 0
```

Open the printed `primaryOrigin` with `?session=<unique-id>`. The primary origin is `127.0.0.1`; the cross-origin iframe uses `localhost` on its own port. Confirm `localhost` resolves to loopback on the browser host. A distinct origin is only an OOPIF candidate: acceptance must prove an out-of-process frame from the actual browser/CDP target tree.

Visible lifecycle signals are published through `window.__t3FixtureLifecycle`, `data-fixture-lifecycle` on the root element, and the `t3-fixture-lifecycle` event. Consequential effects are proven from `/api/state` and `/api/events`; page text alone is not authoritative. A download request event proves only that the server sent bytes, so the browser's completed-download receipt is still required.
