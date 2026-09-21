import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { JevBrowserControl } from "./JevBrowserControl";
import { resetJevBrowserStoreForTests } from "./jevBrowserStore";

const scope: ScopedThreadRef = {
  environmentId: EnvironmentId.make("environment-one"),
  threadId: ThreadId.make("thread-one"),
};

let renderer: ReactTestRenderer | undefined;

describe("JevBrowserControl host availability", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("window", { desktopBridge: undefined });
    resetJevBrowserStoreForTests();
  });

  afterEach(async () => {
    await act(() => renderer?.unmount());
    renderer = undefined;
    vi.unstubAllGlobals();
  });

  it("keeps the thread control visible when a web host cannot run Jev", async () => {
    await act(() => {
      renderer = create(<JevBrowserControl scope={scope} />);
    });
    const root = renderer!.root;
    const trigger = root.findByProps({ "aria-label": "Jev browser: off" });

    expect(trigger).toBeDefined();
    expect(JSON.stringify(renderer!.toJSON())).toContain("Direct");
  });
});
