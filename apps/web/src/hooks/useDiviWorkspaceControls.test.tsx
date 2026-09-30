import { act, useLayoutEffect, useState } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { useDiviWorkspaceControls } from "./useDiviWorkspaceControls";

let renderer: ReactTestRenderer;
let controls: ReturnType<typeof useDiviWorkspaceControls>;
let displayed: string;
let updateDisplayed: (value: string) => void;
function Probe({ selection }: { selection: string }) {
  const value = useDiviWorkspaceControls(selection);
  const [result, setResult] = useState("");
  useLayoutEffect(() => {
    controls = value;
    displayed = result;
    updateDisplayed = setResult;
  });
  return null;
}
function pending() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  act(() => {
    renderer = create(<Probe selection="A" />);
  });
});
afterEach(() => {
  act(() => renderer.unmount());
  vi.unstubAllGlobals();
});
it("ignores a late response after selecting another replica", async () => {
  const response = pending();
  let operation!: Promise<void>;
  act(() => {
    operation = controls.runResource("site", async (isCurrent) => {
      await response.promise;
      if (isCurrent()) updateDisplayed("A");
    });
  });
  expect(controls.busyResources.site).toBe(true);
  act(() => renderer.update(<Probe selection="B" />));
  expect(controls.busyResources).toEqual({});
  await act(async () => {
    response.resolve();
    await operation;
  });
  expect(displayed).toBe("");
  expect(controls.busyResources).toEqual({});
});
it("does not let an old completion unlock a new operation after returning to A", async () => {
  const oldResponse = pending();
  const newResponse = pending();
  let oldOperation!: Promise<void>;
  let newOperation!: Promise<void>;
  act(() => {
    oldOperation = controls.runResource("site", async (isCurrent) => {
      await oldResponse.promise;
      if (isCurrent()) updateDisplayed("old A");
    });
  });
  act(() => renderer.update(<Probe selection="B" />));
  act(() => renderer.update(<Probe selection="A" />));
  act(() => {
    newOperation = controls.runResource("site", async (isCurrent) => {
      await newResponse.promise;
      if (isCurrent()) updateDisplayed("new A");
    });
  });
  await act(async () => {
    oldResponse.resolve();
    await oldOperation;
  });
  expect(displayed).toBe("");
  expect(controls.busyResources.site).toBe(true);
  await act(async () => {
    newResponse.resolve();
    await newOperation;
  });
  expect(displayed).toBe("new A");
  expect(controls.busyResources).toEqual({});
});
it("blocks duplicate controls while allowing another resource to run", async () => {
  const response = pending();
  let operation!: Promise<void>;
  const duplicate = vi.fn(async () => {});
  act(() => {
    operation = controls.runResource("site", () => response.promise);
  });
  await act(async () => {
    await controls.runResource("site", duplicate);
    await controls.runResource("watcher-builder", async () => updateDisplayed("watcher finished"));
  });
  expect(duplicate).not.toHaveBeenCalled();
  expect(displayed).toBe("watcher finished");
  expect(controls.busyResources.site).toBe(true);
  await act(async () => {
    response.resolve();
    await operation;
  });
  expect(controls.busyResources).toEqual({});
});
it("releases controls after a rejected operation", async () => {
  await act(async () => {
    await expect(
      controls.runResource("site", async () => {
        throw new Error("failed");
      }),
    ).rejects.toThrow("failed");
  });
  expect(controls.busyResources).toEqual({});
});
