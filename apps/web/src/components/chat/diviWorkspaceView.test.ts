import { describe, expect, it } from "@effect/vitest";
import type { DiviWorkspaceRunResult } from "@t3tools/contracts";
import {
  cleanLogTail,
  elapsedLabel,
  isLocalDiviEnvironment,
  needsBuildFollowup,
  setupProgress,
  setupStageLabel,
  watcherFollowupLabel,
  watcherLabel,
  workspaceHeading,
} from "./diviWorkspaceView";

describe("Divi workspace dashboard view", () => {
  it("counts only requested setup stages and honors current readiness", () => {
    const result = {
      schemaVersion: 1,
      helperVersion: "test",
      operation: "status",
      status: "degraded",
      readiness: {
        code: "ready",
        website: "ready",
        tests: "prepared-unverified",
        watchers: "running-unverified",
      },
      prepareProfiles: ["php-vendor"],
      prepareReceipts: { "php-vendor": { status: "passed" } },
      testProfiles: ["fluent-jest"],
      watcherDetails: { builder: { enabled: true, state: "running-unverified" } },
      milestones: { watchers: { readyAt: "2026-09-29T12:00:00Z" } },
    } as DiviWorkspaceRunResult;
    expect(setupProgress(result)).toEqual({ completed: 3, requested: 4 });
    expect(setupStageLabel(result)).toBe("Waiting for live build");
    expect(workspaceHeading(result.readiness)).toBe("Ready to work");
    expect(needsBuildFollowup(result)).toBe(false);
    expect(
      needsBuildFollowup({
        ...result,
        watcherDetails: {
          builder: { enabled: true, state: "running-unverified", canVerifyBuild: true },
        },
      }),
    ).toBe(true);
    expect(
      needsBuildFollowup(
        {
          ...result,
          watcherDetails: {
            builder5: { enabled: false, state: "running-unverified", canVerifyBuild: true },
          },
        },
        "builder5",
      ),
    ).toBe(true);
    expect(watcherLabel("builder5")).toBe("Builder 5");
    expect(watcherFollowupLabel("builder5", true)).toBe("Waiting for Builder 5 build");
    expect(watcherFollowupLabel("npm-dev", false)).toBe("Waiting for npm-dev task");
    expect(
      workspaceHeading({ code: "ready", website: "not-requested", tests: "not-requested" }),
    ).toBe("Ready to work");
  });

  it("keeps remote environments out of laptop-only controls", () => {
    expect(
      isLocalDiviEnvironment(
        "127.0.0.1",
        false,
        "PrimaryConnectionTarget",
        "http://127.0.0.1:14290",
      ),
    ).toBe(true);
    expect(
      isLocalDiviEnvironment("", true, "PrimaryConnectionTarget", "https://remote.example"),
    ).toBe(false);
    expect(
      isLocalDiviEnvironment(
        "remote.example",
        false,
        "PrimaryConnectionTarget",
        "http://127.0.0.1:14290",
      ),
    ).toBe(false);
    expect(elapsedLabel(126)).toBe("2:06");
    expect(cleanLogTail("\u001b[32mOld\rBuilt\u001b[0m\n")).toBe("Built\n");
    expect(cleanLogTail("API_KEY=private Bearer abc.def")).toBe(
      "API_KEY=[redacted] Bearer [redacted]",
    );
  });
});
