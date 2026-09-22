export const FIXTURE_VERSION = "2026-09-22.1";
export const LIMIT_CONTROL_COUNT = 185;
export const LIMIT_OPTION_COUNT = 105;
export const LIMIT_TEXT_LENGTH = 12_500;

const html = (title, body, script = "") => `<!doctype html>
<html lang="en" data-fixture-version="${FIXTURE_VERSION}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      :root { color-scheme: light; font: 16px/1.4 system-ui, sans-serif; }
      body { margin: 24px; max-width: 960px; }
      section { border: 1px solid #777; margin: 16px 0; padding: 16px; }
      button, input, select { font: inherit; margin: 4px; }
      .scroll-box { border: 2px solid #555; height: 160px; overflow: auto; position: relative; }
      .scroll-space { height: 900px; padding: 8px; position: relative; }
      .scroll-target { bottom: 8px; position: absolute; }
      [role="listbox"][hidden] { display: none; }
      [role="listbox"] { border: 1px solid #555; list-style: none; margin: 0; padding: 4px; width: 240px; }
      [role="option"] { cursor: default; padding: 4px; }
      [contenteditable] { border: 1px solid #555; min-height: 60px; padding: 8px; }
      iframe { border: 2px solid #555; height: 260px; width: 90%; }
      output { display: block; margin: 8px 0; min-height: 1.4em; }
    </style>
  </head>
  <body>
    ${body}
    <script type="module">${script}</script>
  </body>
</html>`;

const controls = Array.from({ length: LIMIT_CONTROL_COUNT }, (_, index) => {
  const number = index + 1;
  const label =
    number === LIMIT_CONTROL_COUNT
      ? "Apply advanced preference"
      : `Control ${String(number).padStart(3, "0")}`;
  return `<button type="button" data-limit-control="${number}">${label}</button>`;
}).join("\n");

const options = Array.from(
  { length: LIMIT_OPTION_COUNT },
  (_, index) =>
    `<option value="option-${index + 1}">Option ${String(index + 1).padStart(3, "0")}</option>`,
).join("\n");

const longText = "target verification context ".repeat(600).slice(0, LIMIT_TEXT_LENGTH);

export const renderIndexPage = () =>
  html(
    "Jev browser acceptance fixtures",
    `<main>
      <h1>Jev browser acceptance fixtures</h1>
      <nav aria-label="Fixture pages">
        <ul>
          <li><a href="/scopes-limits">Scopes, limits, shadow and scrolling</a></li>
          <li><a href="/frames">Same-origin and cross-origin frames</a></li>
          <li><a href="/workflows">State, artifacts, dialogs and popups</a></li>
        </ul>
      </nav>
    </main>`,
    `import { signalFixtureLifecycle } from "/fixture-client.js";
     signalFixtureLifecycle("index.ready");`,
  );

export const renderScopesLimitsPage = () =>
  html(
    "Scopes and bounded observations",
    `<main>
      <h1>Scopes and bounded observations</h1>
      <button id="reset" type="button">Reset fixture</button>
      <section aria-labelledby="profile-heading" data-scope="profile">
        <h2 id="profile-heading">Profile settings</h2>
        <label>Display name <input id="profile-value" value="Profile draft" /></label>
        <button type="button" data-save-section="profile">Save</button>
      </section>
      <section aria-labelledby="billing-heading" data-scope="billing">
        <h2 id="billing-heading">Billing settings</h2>
        <label>Invoice label <input id="billing-value" value="Billing draft" /></label>
        <button type="button" data-save-section="billing">Save</button>
      </section>
      <section aria-labelledby="limit-heading">
        <h2 id="limit-heading">Observation limits</h2>
        <div id="limit-controls">${controls}</div>
        <p id="long-page-text" data-character-count="${LIMIT_TEXT_LENGTH}">${longText}</p>
        <label>Large option set <select id="large-option-set">${options}</select></label>
      </section>
      <section aria-labelledby="shadow-heading">
        <h2 id="shadow-heading">Shadow boundaries</h2>
        <div id="open-shadow-host"></div>
        <div id="closed-shadow-host"></div>
        <canvas id="visual-only-control" width="240" height="60" aria-label="Visual-only chart control"></canvas>
      </section>
      <section aria-labelledby="scroll-heading">
        <h2 id="scroll-heading">Nested scrolling and custom menu</h2>
        <div class="scroll-box" id="nested-scroll-container" tabindex="0">
          <div class="scroll-space"><button class="scroll-target" type="button">Bottom action</button></div>
        </div>
        <button id="menu-trigger" type="button" role="combobox" aria-controls="custom-options" aria-expanded="false">Choose channel</button>
        <ul id="custom-options" role="listbox" aria-label="Channel" hidden>
          <li role="option" data-value="email">Email</li>
          <li role="option" data-value="sms">SMS</li>
          <li role="option" data-value="push">Push notification</li>
        </ul>
        <output id="menu-result" aria-live="polite"></output>
        <label for="editor">Release notes</label>
        <div id="editor" contenteditable="true" role="textbox" aria-multiline="true">Initial release note</div>
        <output id="editor-result" aria-live="polite"></output>
      </section>
      <output id="save-result" aria-live="polite"></output>
    </main>`,
    `import { fixtureApi, resetFixture, signalFixtureLifecycle } from "/fixture-client.js";
     document.querySelector("#reset").addEventListener("click", async () => { await resetFixture(); location.reload(); });
     for (const button of document.querySelectorAll("[data-save-section]")) {
       button.addEventListener("click", async () => {
         const section = button.dataset.saveSection;
         const value = document.querySelector("#" + section + "-value").value;
         const response = await fixtureApi("/api/save", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ section, value }) });
         const result = await response.json();
         document.querySelector("#save-result").textContent = "Saved " + result.section + ": " + result.value;
         signalFixtureLifecycle("save.committed", result);
       });
     }
     const openRoot = document.querySelector("#open-shadow-host").attachShadow({ mode: "open" });
     openRoot.innerHTML = '<button id="shadow-action" type="button">Apply shadow preference</button><output id="shadow-result"></output>';
     openRoot.querySelector("button").addEventListener("click", () => { openRoot.querySelector("output").textContent = "Shadow preference applied"; signalFixtureLifecycle("shadow.applied"); });
     const closedRoot = document.querySelector("#closed-shadow-host").attachShadow({ mode: "closed" });
     closedRoot.innerHTML = '<button type="button">Closed shadow action</button>';
     const canvas = document.querySelector("#visual-only-control");
     canvas.getContext("2d").fillText("Canvas action", 20, 30);
     const trigger = document.querySelector("#menu-trigger");
     const listbox = document.querySelector("#custom-options");
     trigger.addEventListener("mouseenter", () => { listbox.hidden = false; trigger.ariaExpanded = "true"; signalFixtureLifecycle("menu.opened"); });
     trigger.addEventListener("click", () => { listbox.hidden = false; trigger.ariaExpanded = "true"; signalFixtureLifecycle("menu.opened"); });
     for (const option of listbox.querySelectorAll('[role="option"]')) option.addEventListener("click", () => {
       document.querySelector("#menu-result").textContent = option.dataset.value;
       listbox.hidden = true; trigger.ariaExpanded = "false"; signalFixtureLifecycle("menu.selected", { value: option.dataset.value });
     });
     document.querySelector("#editor").addEventListener("input", event => {
       document.querySelector("#editor-result").textContent = event.currentTarget.textContent;
       signalFixtureLifecycle("editor.changed", { value: event.currentTarget.textContent });
     });
     signalFixtureLifecycle("scopes-limits.ready", { controls: ${LIMIT_CONTROL_COUNT}, options: ${LIMIT_OPTION_COUNT}, textCharacters: ${LIMIT_TEXT_LENGTH} });`,
  );

export const renderFramesPage = ({ crossOrigin }) =>
  html(
    "Frame identity",
    `<main>
      <h1>Frame identity</h1>
      <section aria-labelledby="same-frame-heading">
        <h2 id="same-frame-heading">Same-origin nested frame</h2>
        <iframe id="same-origin-frame" title="Same-origin preferences"></iframe>
      </section>
      <section aria-labelledby="cross-frame-heading">
        <h2 id="cross-frame-heading">Cross-origin frame candidate</h2>
        <iframe id="cross-origin-frame" title="Cross-origin preferences"></iframe>
      </section>
      <output id="frame-events" aria-live="polite"></output>
    </main>`,
    `import { fixtureSession, signalFixtureLifecycle } from "/fixture-client.js";
     const session = encodeURIComponent(fixtureSession());
     document.querySelector("#same-origin-frame").src = "/same-origin-frame?session=" + session;
     document.querySelector("#cross-origin-frame").src = ${JSON.stringify(crossOrigin)} + "/cross-origin-frame?session=" + session;
     globalThis.addEventListener("message", event => {
       if (!event.data || event.data.fixture !== "jev-browser-acceptance") return;
       document.querySelector("#frame-events").textContent = event.data.name;
       signalFixtureLifecycle(event.data.name, { origin: event.origin });
     });
     signalFixtureLifecycle("frames.ready", { crossOrigin: ${JSON.stringify(crossOrigin)} });`,
  );

const frameBody = (kind) =>
  html(
    `${kind} frame fixture`,
    `<main>
      <h1>${kind} frame</h1>
      <div class="scroll-box" id="frame-scroll"><div class="scroll-space"><button class="scroll-target" id="frame-action" type="button">Apply frame preference</button></div></div>
      <output id="frame-result" aria-live="polite"></output>
    </main>`,
    `import { signalFixtureLifecycle } from "/fixture-client.js";
     document.querySelector("#frame-action").addEventListener("click", () => {
       document.querySelector("#frame-result").textContent = "${kind} frame preference applied";
       parent.postMessage({ fixture: "jev-browser-acceptance", name: "frame.applied", kind: ${JSON.stringify(kind)} }, "*");
       signalFixtureLifecycle("frame.applied", { kind: ${JSON.stringify(kind)} });
     });
     parent.postMessage({ fixture: "jev-browser-acceptance", name: "frame.ready", kind: ${JSON.stringify(kind)} }, "*");
     signalFixtureLifecycle("frame.ready", { kind: ${JSON.stringify(kind)} });`,
  );

export const renderSameOriginFramePage = () => frameBody("same-origin");
export const renderCrossOriginFramePage = () => frameBody("cross-origin");

export const renderWorkflowsPage = () =>
  html(
    "Stateful workflow fixtures",
    `<main>
      <h1>Stateful workflow fixtures</h1>
      <button id="reset" type="button">Reset fixture</button>
      <section aria-labelledby="delayed-heading">
        <h2 id="delayed-heading">Delayed submission</h2>
        <button id="delayed-submit" type="button">Submit once</button>
        <output id="delayed-result" aria-live="polite"></output>
      </section>
      <section aria-labelledby="persist-heading">
        <h2 id="persist-heading">Save and reopen</h2>
        <label>Workspace label <input id="persistent-value" /></label>
        <button id="persistent-save" type="button">Save workspace label</button>
        <output id="persistent-result" aria-live="polite"></output>
      </section>
      <section aria-labelledby="artifact-heading">
        <h2 id="artifact-heading">Artifacts</h2>
        <label>Acceptance artifact <input id="artifact-input" type="file" /></label>
        <button id="upload" type="button">Upload selected artifact</button>
        <a id="download" download href="#">Download deterministic artifact</a>
        <output id="artifact-result" aria-live="polite"></output>
      </section>
      <section aria-labelledby="window-heading">
        <h2 id="window-heading">Dialog and popup</h2>
        <button id="dialog" type="button">Open confirmation dialog</button>
        <button id="popup" type="button">Open owned popup</button>
        <output id="window-result" aria-live="polite"></output>
      </section>
    </main>`,
    `import { fixtureApi, fixtureSession, resetFixture, signalFixtureLifecycle } from "/fixture-client.js";
     const stateResponse = await fixtureApi("/api/state");
     const state = await stateResponse.json();
     document.querySelector("#persistent-value").value = state.saved.workspace ?? "";
     document.querySelector("#persistent-result").textContent = state.saved.workspace ? "Reopened: " + state.saved.workspace : "No saved value";
     document.querySelector("#download").href = "/api/download?session=" + encodeURIComponent(fixtureSession()) + "&token=deterministic-download";
     document.querySelector("#reset").addEventListener("click", async () => { await resetFixture(); location.reload(); });
     document.querySelector("#delayed-submit").addEventListener("click", async () => {
       signalFixtureLifecycle("submission.waiting");
       const response = await fixtureApi("/api/delayed-submit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ actionId: "delayed-submit-1" }) });
       const result = await response.json();
       document.querySelector("#delayed-result").textContent = "Completed; server count " + result.submissionCount;
       signalFixtureLifecycle("submission.settled", result);
     });
     document.querySelector("#persistent-save").addEventListener("click", async () => {
       const value = document.querySelector("#persistent-value").value;
       const response = await fixtureApi("/api/save", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ section: "workspace", value }) });
       const result = await response.json();
       document.querySelector("#persistent-result").textContent = "Saved: " + result.value;
       signalFixtureLifecycle("save.committed", result);
     });
     document.querySelector("#upload").addEventListener("click", async () => {
       const file = document.querySelector("#artifact-input").files[0];
       if (!file) { document.querySelector("#artifact-result").textContent = "No artifact selected"; signalFixtureLifecycle("upload.missing"); return; }
       const response = await fixtureApi("/api/upload", { method: "POST", headers: { "content-type": file.type || "application/octet-stream", "x-fixture-filename": file.name }, body: file });
       const result = await response.json();
       document.querySelector("#artifact-result").textContent = "Uploaded " + result.filename + " (" + result.bytes + " bytes)";
       signalFixtureLifecycle("upload.received", result);
     });
     document.querySelector("#dialog").addEventListener("click", async () => {
       signalFixtureLifecycle("dialog.opening");
       const accepted = confirm("Apply the deterministic dialog action?");
       const response = await fixtureApi("/api/dialog-result", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accepted }) });
       const result = await response.json();
       document.querySelector("#window-result").textContent = accepted ? "Dialog accepted" : "Dialog dismissed";
       signalFixtureLifecycle("dialog.resolved", result);
     });
     document.querySelector("#popup").addEventListener("click", () => {
       const popup = open("/popup?session=" + encodeURIComponent(fixtureSession()), "fixture-owned-popup", "width=480,height=360");
       document.querySelector("#window-result").textContent = popup ? "Popup requested" : "Popup blocked";
       signalFixtureLifecycle("popup.requested", { opened: Boolean(popup) });
     });
     signalFixtureLifecycle("workflows.ready", { restoredValue: state.saved.workspace ?? null, submissionCount: state.submissionCount });`,
  );

export const renderPopupPage = () =>
  html(
    "Owned popup",
    `<main><h1>Owned fixture popup</h1><button id="popup-action" type="button">Confirm popup action</button><output id="popup-result" aria-live="polite"></output></main>`,
    `import { fixtureApi, signalFixtureLifecycle } from "/fixture-client.js";
     await fixtureApi("/api/popup-opened", { method: "POST" });
     document.querySelector("#popup-action").addEventListener("click", async () => {
       await fixtureApi("/api/popup-action", { method: "POST" });
       document.querySelector("#popup-result").textContent = "Popup action confirmed";
       if (opener) opener.postMessage({ fixture: "jev-browser-acceptance", name: "popup.confirmed" }, "*");
       signalFixtureLifecycle("popup.confirmed");
     });
     signalFixtureLifecycle("popup.ready");`,
  );
