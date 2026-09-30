import { act, type ReactNode, type ComponentProps } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { DiviWorkspacesSettings } from "./DiviWorkspacesSettings";

const mocks = vi.hoisted(() => ({
  runRpc: vi.fn(),
  environment: {
    entry: { target: { _tag: "PrimaryConnectionTarget", httpBaseUrl: "http://localhost:3773" } },
  },
  projects: [],
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => mocks.runRpc }));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => [] }));
vi.mock("../../state/environments", () => ({
  usePrimaryEnvironmentId: () => "local",
  useEnvironment: () => mocks.environment,
}));
vi.mock("../../state/entities", () => ({ useProjects: () => mocks.projects }));
vi.mock("../../state/diviWorkspace", () => ({ diviWorkspaceRun: {} }));
vi.mock("../../state/projects", () => ({ projectEnvironment: { create: {} } }));
vi.mock("../../state/server", () => ({
  primaryServerAvailableEditorsAtom: {},
  primaryServerKeybindingsAtom: {},
}));
vi.mock("../../state/shell", () => ({ shellEnvironment: { openInEditor: {} } }));
vi.mock("../../hooks/useHandleNewThread", () => ({ useNewThreadHandler: () => vi.fn() }));
vi.mock("../../lib/utils", () => ({ newProjectId: () => "new-project" }));
vi.mock("../../env", () => ({ isElectron: true }));
vi.mock("../chat/OpenInPicker", () => ({ OpenInPicker: () => null }));
vi.mock("../ui/button", () => ({
  Button: ({ children, disabled, onClick }: ComponentProps<"button">) => (
    <button disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}));
vi.mock("./settingsLayout", () => ({
  SettingsPageContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SettingsSection: ({
    children,
    headerAction,
  }: {
    children: ReactNode;
    headerAction: ReactNode;
  }) => (
    <div>
      {headerAction}
      {children}
    </div>
  ),
}));
let renderer: ReactTestRenderer | undefined;
afterEach(() => {
  if (renderer) act(() => renderer!.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("enables destruction after stopping a site without a manual refresh", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", { location: { hostname: "localhost" } });
  let running = true;
  mocks.runRpc.mockImplementation(async ({ input }: { input: { operation: string } }) => {
    const { operation } = input;
    if (operation === "stop") running = false;
    return {
      _tag: "Success",
      value: {
        schemaVersion: 1,
        helperVersion: "test",
        operation,
        status: "ready",
        ...(operation === "list" ? { workspaces: ["replica-a"], operations: [] } : {}),
        ...(operation === "main-info" ? { originalRepositories: [], mainCheckouts: [] } : {}),
        ...(["inspect", "status", "stop"].includes(operation)
          ? {
              workspaceId: "replica-a",
              runtimeStatus: {
                website: { state: running ? "running" : "stopped", health: "healthy" },
              },
              watcherDetails: {},
              ...(operation === "inspect"
                ? { changed: false, issues: running ? ["Stop website before deletion"] : [] }
                : {}),
            }
          : {}),
      },
    };
  });
  await act(async () => {
    renderer = create(<DiviWorkspacesSettings />);
  });
  function button(label: string) {
    return renderer!.root.findAllByType("button").find((node) => node.children.includes(label))!;
  }
  act(() => button("Review deletion").props.onClick());
  act(() =>
    renderer!.root
      .findByProps({ "aria-label": "Type replica-a to confirm deletion" })
      .props.onChange({ target: { value: "replica-a" } }),
  );
  expect(button("Destroy replica").props.disabled).toBe(true);
  await act(async () => {
    button("Stop").props.onClick();
  });
  expect(button("Destroy replica").props.disabled).toBe(false);
  expect(button("Start").props.disabled).toBe(false);
});
