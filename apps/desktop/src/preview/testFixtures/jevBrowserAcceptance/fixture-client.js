export const fixtureSession = () => {
  const value = new URLSearchParams(location.search).get("session") ?? "default";
  return /^[a-zA-Z0-9_-]{1,64}$/.test(value) ? value : "default";
};

export const fixtureApi = async (path, init = {}) => {
  const url = new URL(path, location.origin);
  url.searchParams.set("session", fixtureSession());
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`Fixture request failed: ${response.status} ${url.pathname}`);
  return response;
};

export const signalFixtureLifecycle = (name, detail = {}) => {
  const sequence = (globalThis.__t3FixtureLifecycle?.sequence ?? 0) + 1;
  const lifecycle = { name, sequence, detail };
  globalThis.__t3FixtureLifecycle = lifecycle;
  document.documentElement.dataset.fixtureLifecycle = name;
  document.documentElement.dataset.fixtureSequence = String(sequence);
  globalThis.dispatchEvent(new CustomEvent("t3-fixture-lifecycle", { detail: lifecycle }));
};

export const resetFixture = async () => {
  const response = await fixtureApi("/api/reset", { method: "POST" });
  signalFixtureLifecycle("fixture.reset", await response.json());
};
