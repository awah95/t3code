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

it("keeps a running checkout stoppable after dependency setup becomes stale", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", { location: { hostname: "localhost" } });
  let setupReady = true;
  let running = true;
  mocks.runRpc.mockImplementation(
    async ({ input }: { input: { operation: string; mainId?: string } }) => {
      if (input.operation === "main-site-stop") running = false;
      return {
        _tag: "Success",
        value: {
          schemaVersion: 1,
          helperVersion: "test",
          operation: input.operation,
          status: "ready",
          ...(input.operation === "main-info"
            ? {
                originalRepositories: [],
                mainCheckouts: [
                  {
                    id: "module-a",
                    status: setupReady ? "ready" : "unavailable",
                    issues: setupReady ? [] : ["prepared dependency input changed"],
                  },
                ],
              }
            : {}),
          ...(input.operation === "list" ? { workspaces: [], operations: [] } : {}),
          ...(input.operation.startsWith("main-site-")
            ? {
                status:
                  input.mainId === "original" ? "not-prepared" : running ? "ready" : "stopped",
                ...(input.mainId === "module-a"
                  ? {
                      runtimeStatus: {
                        website: {
                          state: running ? "running" : "stopped",
                          health: "healthy",
                          containerName: "module-a",
                          port: 8080,
                        },
                      },
                    }
                  : {}),
              }
            : {}),
        },
      };
    },
  );
  await act(async () => {
    renderer = create(<DiviWorkspacesSettings />);
  });
  const checkoutButton = (label: string) =>
    renderer!.root
      .findByProps({ mainId: "module-a" })
      .findAllByType("button")
      .find((node) => node.children.includes(label))!;
  expect(checkoutButton("Stop site").props.disabled).toBe(false);
  setupReady = false;
  await act(async () => {
    renderer!.root
      .findAllByType("button")
      .find((node) => node.children.includes("Refresh"))!
      .props.onClick();
  });
  expect(checkoutButton("Start site").props.disabled).toBe(true);
  expect(checkoutButton("Refresh site").props.disabled).toBe(false);
  expect(checkoutButton("Stop site").props.disabled).toBe(false);
  await act(async () => {
    checkoutButton("Stop site").props.onClick();
  });
  expect(checkoutButton("Stop site").props.disabled).toBe(true);
  expect(checkoutButton("Start site").props.disabled).toBe(true);
});

it.each([{ replicas: [] }, { replicas: ["replica-a"] }])(
  "stops checkout sites with replica list %j and refreshes their controls",
  async ({ replicas }) => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("window", { location: { hostname: "localhost" } });
    let checkoutRunning = true;
    let replicaRunning = true;
    let completeStop: (() => void) | undefined;
    const success = (operation: string, value: object) => ({
      _tag: "Success",
      value: { schemaVersion: 1, helperVersion: "test", operation, ...value },
    });
    const website = (running: boolean) => ({
      state: running ? "running" : "stopped",
      health: "healthy",
      containerName: "test",
      port: 8080,
    });
    mocks.runRpc.mockImplementation(
      async ({ input }: { input: { operation: string; mainId?: string } }) => {
        const operation = input.operation;
        if (operation === "main-info")
          return success(operation, {
            status: "ready",
            originalRepositories: [],
            mainCheckouts: [{ id: "module-a", status: "ready" }],
          });
        if (operation === "list")
          return success(operation, { status: "ready", workspaces: replicas, operations: [] });
        if (operation.startsWith("main-site-")) {
          if (input.mainId === "original") return success(operation, { status: "not-prepared" });
          if (operation === "main-site-stop")
            return new Promise((resolve) => {
              completeStop = () => {
                checkoutRunning = false;
                resolve(
                  success(operation, {
                    status: "stopped",
                    runtimeStatus: { website: website(false) },
                  }),
                );
              };
            });
          return success(operation, {
            status: checkoutRunning ? "ready" : "stopped",
            runtimeStatus: { website: website(checkoutRunning) },
          });
        }
        if (operation === "stop") replicaRunning = false;
        return success(operation, {
          status: "ready",
          changed: false,
          watcherDetails: {},
          runtimeStatus: { website: website(replicaRunning) },
        });
      },
    );
    await act(async () => {
      renderer = create(<DiviWorkspacesSettings />);
    });
    const stopAll = () =>
      renderer!.root.findAllByType("button").find((node) => node.children.includes("Stop all"))!;
    const checkoutButton = (label: string) =>
      renderer!.root
        .findByProps({ mainId: "module-a" })
        .findAllByType("button")
        .find((node) => node.children.includes(label))!;
    expect(stopAll().props.disabled).toBe(false);
    expect(checkoutButton("Stop site").props.disabled).toBe(false);
    await act(async () => {
      stopAll().props.onClick();
    });
    expect(checkoutButton("Start site").props.disabled).toBe(true);
    expect(checkoutButton("Stop site").props.disabled).toBe(true);
    expect(completeStop).toBeDefined();
    await act(async () => {
      completeStop!();
    });
    expect(checkoutButton("Start site").props.disabled).toBe(false);
    expect(checkoutButton("Stop site").props.disabled).toBe(true);
    expect(checkoutRunning).toBe(false);
    if (replicas.length) expect(replicaRunning).toBe(false);
    expect(stopAll().props.disabled).toBe(false);
  },
);
