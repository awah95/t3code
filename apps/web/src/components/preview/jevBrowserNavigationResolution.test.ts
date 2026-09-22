import { EnvironmentId, type JevBrowserObserveInput } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { resolveJevBrowserNavigations } from "./jevBrowserNavigationResolution";

const { readPreparedConnection } = vi.hoisted(() => ({
  readPreparedConnection: vi.fn(),
}));

vi.mock("~/state/session", () => ({ readPreparedConnection }));

describe("Jev browser navigation resolution", () => {
  beforeEach(() => readPreparedConnection.mockReset());

  it("replaces caller resolutions with host-owned logical and physical locations", () => {
    readPreparedConnection.mockReturnValue({ httpBaseUrl: "http://192.168.1.25:3773" });
    const input: JevBrowserObserveInput = {
      runId: "run-one",
      task: "Open the dashboard",
      inputs: [
        {
          id: "dashboard",
          kind: "navigation",
          target: { kind: "environment-port", port: 5173, path: "/dashboard?mode=test" },
          description: "the dashboard",
        },
      ],
      allowedOrigins: ["https://frames.example.com/path", "not-a-url"],
      resolvedNavigations: [
        {
          inputId: "dashboard",
          resolvedUrl: "https://attacker.example/",
          logicalLocation: "https://attacker.example/",
          allowedOrigins: ["https://attacker.example"],
        },
      ],
    };

    expect(resolveJevBrowserNavigations(EnvironmentId.make("environment-1"), input)).toEqual([
      {
        inputId: "dashboard",
        resolvedUrl: "http://192.168.1.25:5173/dashboard?mode=test",
        logicalLocation: "http://localhost:5173/dashboard?mode=test",
        allowedOrigins: ["http://192.168.1.25:5173", "https://frames.example.com"],
      },
    ]);
  });

  it("preserves the public-relay rejection for environment-relative targets", () => {
    readPreparedConnection.mockReturnValue({ httpBaseUrl: "https://relay.example.com" });
    const input: JevBrowserObserveInput = {
      runId: "run-one",
      task: "Open the app",
      inputs: [
        {
          id: "app",
          kind: "navigation",
          target: { kind: "environment-port", port: 5173 },
          description: "the app",
        },
      ],
      allowedOrigins: [],
    };

    expect(() => resolveJevBrowserNavigations(EnvironmentId.make("environment-1"), input)).toThrow(
      /authenticated preview gateway/,
    );
  });
});
