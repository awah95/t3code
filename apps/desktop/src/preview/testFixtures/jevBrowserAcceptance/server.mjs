import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import {
  FIXTURE_VERSION,
  renderCrossOriginFramePage,
  renderFramesPage,
  renderIndexPage,
  renderPopupPage,
  renderSameOriginFramePage,
  renderScopesLimitsPage,
  renderWorkflowsPage,
} from "./fixtures.mjs";

const fixtureRoot = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const clientScriptPath = NodePath.join(fixtureRoot, "fixture-client.js");
const uploadSamplePath = NodePath.join(fixtureRoot, "upload-sample.txt");
const downloadBody = Buffer.from("T3 Jev deterministic download fixture\n", "utf8");

const json = (value, status = 200) =>
  new Response(JSON.stringify(value, null, 2), {
    status,
    headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" },
  });

const page = (value) =>
  new Response(value, {
    headers: {
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8",
      "cross-origin-opener-policy": "same-origin-allow-popups",
    },
  });

const validateSession = (url) => {
  const session = url.searchParams.get("session") ?? "default";
  return /^[a-zA-Z0-9_-]{1,64}$/.test(session) ? session : "default";
};

const safeFilename = (value) => {
  const base = NodePath.basename(value || "artifact.bin").replaceAll(/[^a-zA-Z0-9._-]/g, "_");
  return base.slice(0, 120) || "artifact.bin";
};

const initialSession = () => ({
  sequence: 0,
  saved: {},
  submissionCount: 0,
  submissions: new Map(),
  uploads: [],
  downloadRequests: [],
  dialogResults: [],
  popupOpenedCount: 0,
  popupActionCount: 0,
  events: [],
});

export class FixtureState {
  #sessions = new Map();
  #delayMs;

  constructor({ delayMs = 150 } = {}) {
    this.#delayMs = delayMs;
  }

  session(id) {
    const existing = this.#sessions.get(id);
    if (existing) return existing;
    const created = initialSession();
    this.#sessions.set(id, created);
    return created;
  }

  event(id, type, detail = {}) {
    const state = this.session(id);
    const event = { sequence: ++state.sequence, type, detail };
    state.events.push(event);
    return event;
  }

  reset(id) {
    this.#sessions.set(id, initialSession());
    return this.event(id, "fixture.reset", { fixtureVersion: FIXTURE_VERSION });
  }

  snapshot(id) {
    const state = this.session(id);
    return {
      fixtureVersion: FIXTURE_VERSION,
      sequence: state.sequence,
      saved: { ...state.saved },
      submissionCount: state.submissionCount,
      uploads: [...state.uploads],
      downloadRequests: [...state.downloadRequests],
      dialogResults: [...state.dialogResults],
      popupOpenedCount: state.popupOpenedCount,
      popupActionCount: state.popupActionCount,
    };
  }

  delayedSubmit(id, actionId) {
    const state = this.session(id);
    const existing = state.submissions.get(actionId);
    if (existing) return existing.then((result) => ({ ...result, duplicate: true }));
    state.submissionCount += 1;
    this.event(id, "submission.accepted", { actionId, submissionCount: state.submissionCount });
    const pending = new Promise((resolve) => {
      setTimeout(() => {
        const result = { actionId, submissionCount: state.submissionCount, duplicate: false };
        this.event(id, "submission.settled", result);
        resolve(result);
      }, this.#delayMs);
    });
    state.submissions.set(actionId, pending);
    return pending;
  }
}

const readJson = async (request) => {
  try {
    return await request.json();
  } catch {
    return {};
  }
};

export const createFixtureHandler =
  ({ state = new FixtureState(), crossOrigin }) =>
  async (request) => {
    const url = new URL(request.url);
    const session = validateSession(url);

    if (request.method === "GET" && url.pathname === "/") return page(renderIndexPage());
    if (request.method === "GET" && url.pathname === "/scopes-limits")
      return page(renderScopesLimitsPage());
    if (request.method === "GET" && url.pathname === "/frames")
      return page(renderFramesPage({ crossOrigin }));
    if (request.method === "GET" && url.pathname === "/same-origin-frame")
      return page(renderSameOriginFramePage());
    if (request.method === "GET" && url.pathname === "/cross-origin-frame")
      return page(renderCrossOriginFramePage());
    if (request.method === "GET" && url.pathname === "/workflows")
      return page(renderWorkflowsPage());
    if (request.method === "GET" && url.pathname === "/popup") return page(renderPopupPage());
    if (request.method === "GET" && url.pathname === "/fixture-client.js")
      return new Response(await NodeFSP.readFile(clientScriptPath), {
        headers: { "cache-control": "no-store", "content-type": "text/javascript; charset=utf-8" },
      });
    if (request.method === "GET" && url.pathname === "/upload-sample.txt")
      return new Response(await NodeFSP.readFile(uploadSamplePath), {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    if (request.method === "GET" && url.pathname === "/api/state")
      return json(state.snapshot(session));
    if (request.method === "GET" && url.pathname === "/api/events") {
      const after = Number(url.searchParams.get("after") ?? 0);
      const events = state.session(session).events.filter((event) => event.sequence > after);
      return json({ fixtureVersion: FIXTURE_VERSION, events });
    }
    if (request.method === "POST" && url.pathname === "/api/reset") {
      const event = state.reset(session);
      return json({ reset: true, event, state: state.snapshot(session) });
    }
    if (request.method === "POST" && url.pathname === "/api/save") {
      const body = await readJson(request);
      if (typeof body.section !== "string" || typeof body.value !== "string")
        return json({ error: "section and value are required" }, 400);
      const sessionState = state.session(session);
      sessionState.saved[body.section] = body.value;
      const result = { section: body.section, value: body.value };
      state.event(session, "save.committed", result);
      return json(result);
    }
    if (request.method === "POST" && url.pathname === "/api/delayed-submit") {
      const body = await readJson(request);
      if (typeof body.actionId !== "string" || !body.actionId)
        return json({ error: "actionId is required" }, 400);
      return json(await state.delayedSubmit(session, body.actionId));
    }
    if (request.method === "POST" && url.pathname === "/api/upload") {
      const bytes = new Uint8Array(await request.arrayBuffer());
      const receipt = {
        filename: safeFilename(request.headers.get("x-fixture-filename") ?? "artifact.bin"),
        bytes: bytes.byteLength,
        sha256: NodeCrypto.createHash("sha256").update(bytes).digest("hex"),
      };
      state.session(session).uploads.push(receipt);
      state.event(session, "upload.received", receipt);
      return json(receipt);
    }
    if (request.method === "GET" && url.pathname === "/api/download") {
      const receipt = {
        token: url.searchParams.get("token") ?? "missing",
        filename: "jev-browser-acceptance.txt",
        bytes: downloadBody.byteLength,
        sha256: NodeCrypto.createHash("sha256").update(downloadBody).digest("hex"),
      };
      state.session(session).downloadRequests.push(receipt);
      state.event(session, "download.requested", receipt);
      return new Response(downloadBody, {
        headers: {
          "cache-control": "no-store",
          "content-disposition": 'attachment; filename="jev-browser-acceptance.txt"',
          "content-length": String(downloadBody.byteLength),
          "content-type": "text/plain; charset=utf-8",
        },
      });
    }
    if (request.method === "POST" && url.pathname === "/api/dialog-result") {
      const body = await readJson(request);
      if (typeof body.accepted !== "boolean") return json({ error: "accepted is required" }, 400);
      const result = { accepted: body.accepted };
      state.session(session).dialogResults.push(result);
      state.event(session, "dialog.resolved", result);
      return json(result);
    }
    if (request.method === "POST" && url.pathname === "/api/popup-opened") {
      state.session(session).popupOpenedCount += 1;
      const result = { popupOpenedCount: state.session(session).popupOpenedCount };
      state.event(session, "popup.opened", result);
      return json(result);
    }
    if (request.method === "POST" && url.pathname === "/api/popup-action") {
      state.session(session).popupActionCount += 1;
      const result = { popupActionCount: state.session(session).popupActionCount };
      state.event(session, "popup.action", result);
      return json(result);
    }
    return json({ error: "not found", path: url.pathname }, 404);
  };

const toRequest = async (incoming, origin) => {
  const chunks = [];
  for await (const chunk of incoming) chunks.push(chunk);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  return new Request(new URL(incoming.url ?? "/", origin), {
    method: incoming.method,
    headers: incoming.headers,
    ...(body ? { body } : {}),
  });
};

const sendResponse = async (response, outgoing) => {
  outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  outgoing.end(Buffer.from(await response.arrayBuffer()));
};

const listen = (server, host, port) =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

export const startFixtureHarness = async ({ primaryPort = 0, crossOriginPort = 0 } = {}) => {
  const state = new FixtureState();
  let primaryOrigin = "";
  let crossOrigin = "";
  const secondary = NodeHttp.createServer(async (request, response) => {
    try {
      await sendResponse(
        await createFixtureHandler({ state, crossOrigin })(await toRequest(request, crossOrigin)),
        response,
      );
    } catch (error) {
      response.writeHead(500).end(String(error));
    }
  });
  await listen(secondary, "localhost", crossOriginPort);
  const secondaryAddress = secondary.address();
  crossOrigin = `http://localhost:${secondaryAddress.port}`;

  const primary = NodeHttp.createServer(async (request, response) => {
    try {
      await sendResponse(
        await createFixtureHandler({ state, crossOrigin })(await toRequest(request, primaryOrigin)),
        response,
      );
    } catch (error) {
      response.writeHead(500).end(String(error));
    }
  });
  await listen(primary, "127.0.0.1", primaryPort);
  const primaryAddress = primary.address();
  primaryOrigin = `http://127.0.0.1:${primaryAddress.port}`;

  return {
    primaryOrigin,
    crossOrigin,
    close: async () => {
      await Promise.all([
        new Promise((resolve, reject) =>
          primary.close((error) => (error ? reject(error) : resolve())),
        ),
        new Promise((resolve, reject) =>
          secondary.close((error) => (error ? reject(error) : resolve())),
        ),
      ]);
    },
  };
};

const parsePort = (name) => {
  const index = process.argv.indexOf(name);
  if (index < 0) return 0;
  const value = Number(process.argv[index + 1]);
  if (!Number.isInteger(value) || value < 0 || value > 65_535)
    throw new Error(`${name} must be a valid port`);
  return value;
};

if (
  process.argv[1] &&
  NodePath.resolve(process.argv[1]) === NodeURL.fileURLToPath(import.meta.url)
) {
  const harness = await startFixtureHarness({
    primaryPort: parsePort("--primary-port"),
    crossOriginPort: parsePort("--cross-origin-port"),
  });
  process.stdout.write(
    `${JSON.stringify({ fixtureVersion: FIXTURE_VERSION, primaryOrigin: harness.primaryOrigin, crossOrigin: harness.crossOrigin })}\n`,
  );
  const stop = async () => {
    await harness.close();
    process.exitCode = 0;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
