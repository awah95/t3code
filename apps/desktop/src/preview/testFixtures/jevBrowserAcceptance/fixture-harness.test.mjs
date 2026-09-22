import * as NodeFSP from "node:fs/promises";

import { describe, expect, it } from "vite-plus/test";

import {
  FIXTURE_VERSION,
  LIMIT_CONTROL_COUNT,
  LIMIT_OPTION_COUNT,
  LIMIT_TEXT_LENGTH,
  renderFramesPage,
  renderScopesLimitsPage,
  renderWorkflowsPage,
} from "./fixtures.mjs";
import { FixtureState, createFixtureHandler } from "./server.mjs";

const fixtureUrl = new URL("./", import.meta.url);
const readJsonFixture = async (name) =>
  JSON.parse(await NodeFSP.readFile(new URL(name, fixtureUrl), "utf8"));
const request = (path, init) => new Request(`http://127.0.0.1:4100${path}`, init);
const jsonRequest = (path, body) =>
  request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("Jev browser acceptance fixture definitions", () => {
  it("keeps manifest cases unique and tied to declared pages", async () => {
    const manifest = await readJsonFixture("fixture-manifest.json");
    expect(manifest.fixtureVersion).toBe(FIXTURE_VERSION);
    expect(new Set(manifest.cases.map(({ id }) => id)).size).toBe(manifest.cases.length);
    const pages = new Set(manifest.pages.map(({ id }) => id));
    expect(manifest.cases.every(({ page }) => pages.has(page))).toBe(true);
    expect(manifest.hostRequirements.crossOrigin.requirements).toContain(
      "OOPIF status is proven from the browser/CDP target tree; a distinct origin alone is not OOPIF proof",
    );
  });

  it("renders deterministic over-limit controls, text and options", () => {
    const page = renderScopesLimitsPage();
    expect(page.match(/data-limit-control=/g)).toHaveLength(LIMIT_CONTROL_COUNT);
    expect(page.match(/<option value="option-/g)).toHaveLength(LIMIT_OPTION_COUNT);
    const longText = page.match(/<p id="long-page-text"[^>]*>([^<]+)<\/p>/)?.[1];
    expect(longText).toHaveLength(LIMIT_TEXT_LENGTH);
    expect(page).toContain(">Apply advanced preference</button>");
    expect(page.match(/data-save-section=/g)).toHaveLength(2);
  });

  it("pins same-origin and cross-origin frame addresses independently", () => {
    const page = renderFramesPage({ crossOrigin: "http://localhost:4200" });
    expect(page).toContain('src = "/same-origin-frame?session="');
    expect(page).toContain('src = "http://localhost:4200" + "/cross-origin-frame?session="');
    expect(page).toContain('title="Same-origin preferences"');
    expect(page).toContain('title="Cross-origin preferences"');
  });

  it("exposes lifecycle milestones instead of requiring blind waits", () => {
    const pages = [renderScopesLimitsPage(), renderWorkflowsPage()];
    expect(pages.join("\n")).toContain('signalFixtureLifecycle("scopes-limits.ready"');
    expect(pages.join("\n")).toContain('signalFixtureLifecycle("workflows.ready"');
    expect(pages.join("\n")).toContain('signalFixtureLifecycle("submission.settled"');
    expect(pages.join("\n")).toContain('signalFixtureLifecycle("save.committed"');
  });

  it("defines the complete benchmark accounting boundary", async () => {
    const schema = await readJsonFixture("benchmark-result.schema.json");
    expect(schema.required).toEqual(
      expect.arrayContaining([
        "fixtureVersion",
        "revision",
        "runtime",
        "runs",
        "summary",
        "measurements",
      ]),
    );
    expect(schema.$defs.run.required).toEqual(
      expect.arrayContaining([
        "status",
        "assertions",
        "interventionCount",
        "decisionCalls",
        "cost",
        "bytes",
        "latencyMs",
      ]),
    );
    expect(schema.$defs.run.properties.status.enum).toEqual([
      "success",
      "indeterminate",
      "failure",
    ]);
  });
});

describe("Jev browser acceptance fixture state", () => {
  it("resets state and keeps browser text separate from authoritative effects", async () => {
    const handler = createFixtureHandler({
      state: new FixtureState({ delayMs: 0 }),
      crossOrigin: "http://localhost:4200",
    });
    await handler(jsonRequest("/api/save?session=alpha", { section: "profile", value: "Alice" }));
    const saved = await (await handler(request("/api/state?session=alpha"))).json();
    expect(saved.saved).toEqual({ profile: "Alice" });
    expect((await (await handler(request("/api/events?session=alpha"))).json()).events).toEqual([
      expect.objectContaining({ type: "save.committed" }),
    ]);

    await handler(request("/api/reset?session=alpha", { method: "POST" }));
    const reset = await (await handler(request("/api/state?session=alpha"))).json();
    expect(reset.saved).toEqual({});
    expect(reset.submissionCount).toBe(0);
    expect((await (await handler(request("/api/events?session=alpha"))).json()).events).toEqual([
      expect.objectContaining({ sequence: 1, type: "fixture.reset" }),
    ]);
  });

  it("deduplicates concurrent and later submissions by action identity", async () => {
    const handler = createFixtureHandler({
      state: new FixtureState({ delayMs: 0 }),
      crossOrigin: "http://localhost:4200",
    });
    const [first, duplicate] = await Promise.all([
      handler(jsonRequest("/api/delayed-submit?session=submit", { actionId: "action-1" })),
      handler(jsonRequest("/api/delayed-submit?session=submit", { actionId: "action-1" })),
    ]);
    const results = [await first.json(), await duplicate.json()];
    expect(results.map(({ duplicate: repeated }) => repeated).sort()).toEqual([false, true]);

    const later = await handler(
      jsonRequest("/api/delayed-submit?session=submit", { actionId: "action-1" }),
    );
    expect((await later.json()).duplicate).toBe(true);
    const state = await (await handler(request("/api/state?session=submit"))).json();
    expect(state.submissionCount).toBe(1);
    const events = await (await handler(request("/api/events?session=submit"))).json();
    expect(events.events.map(({ type }) => type)).toEqual([
      "submission.accepted",
      "submission.settled",
    ]);
  });

  it("records upload bytes and download requests without claiming browser completion", async () => {
    const handler = createFixtureHandler({
      state: new FixtureState({ delayMs: 0 }),
      crossOrigin: "http://localhost:4200",
    });
    const uploadBytes = await NodeFSP.readFile(new URL("upload-sample.txt", fixtureUrl));
    const upload = await handler(
      request("/api/upload?session=artifacts", {
        method: "POST",
        headers: { "x-fixture-filename": "upload-sample.txt" },
        body: uploadBytes,
      }),
    );
    expect(await upload.json()).toEqual({
      filename: "upload-sample.txt",
      bytes: 36,
      sha256: "f01d50767e67c03ae81d229b831862516ac42d721a61ed557af431bccc70c74c",
    });

    const download = await handler(
      request("/api/download?session=artifacts&token=deterministic-download"),
    );
    expect(download.headers.get("content-disposition")).toBe(
      'attachment; filename="jev-browser-acceptance.txt"',
    );
    expect(Buffer.from(await download.arrayBuffer()).toString("utf8")).toBe(
      "T3 Jev deterministic download fixture\n",
    );
    const state = await (await handler(request("/api/state?session=artifacts"))).json();
    expect(state.uploads).toHaveLength(1);
    expect(state.downloadRequests).toEqual([
      expect.objectContaining({ token: "deterministic-download", bytes: 38 }),
    ]);
  });

  it("isolates sessions for concurrent tab ownership", async () => {
    const handler = createFixtureHandler({
      state: new FixtureState({ delayMs: 0 }),
      crossOrigin: "http://localhost:4200",
    });
    await handler(jsonRequest("/api/save?session=agent-a", { section: "workspace", value: "A" }));
    await handler(jsonRequest("/api/save?session=agent-b", { section: "workspace", value: "B" }));
    const agentA = await (await handler(request("/api/state?session=agent-a"))).json();
    const agentB = await (await handler(request("/api/state?session=agent-b"))).json();
    expect(agentA.saved.workspace).toBe("A");
    expect(agentB.saved.workspace).toBe("B");
  });
});
