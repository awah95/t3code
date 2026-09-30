import { act, type ComponentProps } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";
import type { EnvironmentId } from "@t3tools/contracts";
import { CheckoutSiteControls } from "./CheckoutSiteControls";

const mocks = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => mocks.run }));
vi.mock("../../state/diviWorkspace", () => ({ diviWorkspaceRun: {} }));
vi.mock("../ui/button", () => ({
  Button: ({ children, disabled, onClick }: ComponentProps<"button">) => (
    <button disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}));
let renderer: ReactTestRenderer | undefined;
afterEach(() => {
  if (renderer) act(() => renderer!.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

it("keeps the checkout site stopped after a late initial status response", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let initialStatus: ((value: unknown) => void) | undefined;
  const response = (running: boolean) => ({
    _tag: "Success",
    value: {
      schemaVersion: 1,
      helperVersion: "test",
      operation: "main-site-status",
      status: running ? "ready" : "stopped",
      runtimeStatus: {
        website: {
          state: running ? "running" : "stopped",
          health: "healthy",
          containerName: "checkout",
          port: 1234,
        },
      },
    },
  });
  mocks.run.mockImplementation(({ input }: { input: { operation: string; mainId: string } }) => {
    if (input.operation === "main-site-status")
      return new Promise((resolve) => {
        initialStatus = resolve;
      });
    return Promise.resolve(response(input.operation === "main-site-start"));
  });
  await act(async () => {
    renderer = create(
      <CheckoutSiteControls environmentId={"local" as EnvironmentId} mainId="module-a" />,
    );
  });
  const button = (label: string) =>
    renderer!.root.findAllByType("button").find((node) => node.children.includes(label))!;
  await act(async () => {
    button("Start site").props.onClick();
  });
  expect(button("Start site").props.disabled).toBe(true);
  expect(button("Stop site").props.disabled).toBe(false);
  await act(async () => {
    button("Stop site").props.onClick();
  });
  await act(async () => {
    initialStatus!(response(true));
  });
  expect(button("Start site").props.disabled).toBe(false);
  expect(button("Stop site").props.disabled).toBe(true);
  expect(mocks.run.mock.calls.map(([args]) => args.input.mainId)).toEqual([
    "module-a",
    "module-a",
    "module-a",
  ]);
});
