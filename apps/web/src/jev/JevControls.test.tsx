import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../env", () => ({ isElectron: true }));
vi.mock("./JevEvaluation", () => ({ JevEvaluation: () => null }));

import { JevControls } from "./JevControls";
import { useJevStore } from "./jevStore";

let renderer: ReactTestRenderer | undefined;

async function renderControls() {
  await act(() => {
    renderer = create(<JevControls />);
  });
  const current = renderer;
  if (!current) throw new Error("Jev controls did not render");
  return current.root.findByProps({
    "aria-label":
      "Jev Auto: choose a compatible model within the selected provider. Task text, recent chat history and plan context are sent to OpenRouter.",
  });
}

describe("Jev credential preflight", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    useJevStore.setState({
      enabled: false,
      panelOpen: false,
      calls: [],
      notice: null,
      revision: 0,
    });
  });

  afterEach(async () => {
    await act(() => renderer?.unmount());
    renderer = undefined;
    vi.unstubAllGlobals();
  });

  it("keeps Jev off and explains where to add a missing key", async () => {
    const getJevStatus = vi.fn().mockResolvedValue({ hasKey: false, secureStorageAvailable: true });
    vi.stubGlobal("window", { desktopBridge: { getJevStatus } });
    const toggle = await renderControls();

    await act(async () => toggle.props.onClick());

    expect(getJevStatus).toHaveBeenCalledOnce();
    expect(useJevStore.getState()).toMatchObject({
      enabled: false,
      panelOpen: true,
      notice: expect.stringContaining("Settings > General > Jev Auto routing"),
    });
  });

  it("turns off a restored enabled state when its key is missing", async () => {
    useJevStore.setState({ enabled: true });
    vi.stubGlobal("window", {
      desktopBridge: {
        getJevStatus: vi.fn().mockResolvedValue({ hasKey: false, secureStorageAvailable: true }),
        cancelJevRoute: vi.fn(),
      },
    });

    await renderControls();
    await act(async () => Promise.resolve());

    expect(useJevStore.getState()).toMatchObject({
      enabled: false,
      panelOpen: true,
      notice: expect.stringContaining("Settings > General > Jev Auto routing"),
    });
  });

  it("enables Jev after confirming that the encrypted key exists", async () => {
    vi.stubGlobal("window", {
      desktopBridge: {
        getJevStatus: vi.fn().mockResolvedValue({ hasKey: true, secureStorageAvailable: true }),
      },
    });
    const toggle = await renderControls();

    await act(async () => toggle.props.onClick());

    expect(useJevStore.getState().enabled).toBe(true);
  });
});
