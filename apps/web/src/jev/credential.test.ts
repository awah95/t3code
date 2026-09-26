import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { requireJevCredential } from "./credential";

afterEach(() => vi.unstubAllGlobals());

describe("Jev credential preflight", () => {
  it("accepts a saved key", async () => {
    vi.stubGlobal("window", {
      desktopBridge: { getJevStatus: vi.fn().mockResolvedValue({ hasKey: true }) },
    });
    await expect(requireJevCredential()).resolves.toBeUndefined();
  });

  it("directs a chat with no key to the setting", async () => {
    vi.stubGlobal("window", {
      desktopBridge: {
        getJevStatus: vi.fn().mockResolvedValue({ hasKey: false, secureStorageAvailable: true }),
      },
    });
    await expect(requireJevCredential()).rejects.toThrow("Settings > General > Jev Auto routing");
  });

  it("explains unavailable secure storage and credential checks", async () => {
    vi.stubGlobal("window", {
      desktopBridge: {
        getJevStatus: vi.fn().mockResolvedValue({ hasKey: false, secureStorageAvailable: false }),
      },
    });
    await expect(requireJevCredential()).rejects.toThrow("secure OS credential storage");
    vi.stubGlobal("window", {
      desktopBridge: { getJevStatus: vi.fn().mockRejectedValue(new Error("IPC failed")) },
    });
    await expect(requireJevCredential()).rejects.toThrow(
      "Could not verify Jev's OpenRouter credential",
    );
  });
});
