import type { DiviWorkspaceRunResult } from "@t3tools/contracts";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function isLocalDiviEnvironment(
  browserHostname: string,
  electron: boolean,
  targetTag: string | undefined,
  httpBaseUrl: string | undefined,
): boolean {
  if (targetTag !== "PrimaryConnectionTarget" || !httpBaseUrl) return false;
  try {
    return (
      LOOPBACK_HOSTS.has(new URL(httpBaseUrl).hostname) &&
      (electron || LOOPBACK_HOSTS.has(browserHostname))
    );
  } catch {
    return false;
  }
}

export function readinessLabel(value: unknown): string {
  const labels: Record<string, string> = {
    ready: "Ready",
    preparing: "Setting up",
    degraded: "Needs attention",
    failed: "Failed",
    stopped: "Stopped",
    "not-requested": "Not started",
    "running-unverified": "Build not verified",
    "stopping-unverified": "Stopping",
    "ownership-uncertain": "Needs attention",
    "prepared-unverified": "Ready to test",
    unverified: "Not tested yet",
    stale: "Needs rerun",
    partial: "More checks needed",
    passed: "Passed",
  };
  return labels[String(value ?? "")] ?? "Status unavailable";
}

export function workspaceHeading(
  readiness: DiviWorkspaceRunResult["readiness"],
  inProgress?: boolean,
): string {
  if (inProgress) return "Workspace busy";
  if (Object.values(readiness ?? {}).some((status) => status === "failed" || status === "degraded"))
    return "Needs attention";
  if (readiness?.code === "ready" && readiness.website === "ready") return "Ready to work";
  if (readiness?.code === "ready" && readiness.website === "not-requested") return "Ready to work";
  if (readiness?.code === "ready" && readiness.website === "stopped") return "Website stopped";
  return "Setting up workspace";
}

export function setupProgress(result: DiviWorkspaceRunResult | null): {
  completed: number;
  requested: number;
} | null {
  if (!result?.readiness) return null;
  const readiness = result.readiness;
  const stages = [readiness.code === "ready"];
  if (readiness.website && readiness.website !== "not-requested")
    stages.push(readiness.website === "ready");
  if (result.prepareProfiles?.length) {
    const receipts = result.prepareReceipts;
    const receiptMap =
      receipts && typeof receipts === "object" && !Array.isArray(receipts)
        ? (receipts as Record<string, unknown>)
        : {};
    stages.push(
      !["stale", "failed", "preparing"].includes(String(readiness.tests)) &&
        result.prepareProfiles.every((id) => {
          const receipt = receiptMap[id];
          return (
            receipt &&
            typeof receipt === "object" &&
            "status" in receipt &&
            receipt.status === "passed"
          );
        }),
    );
  }
  if (
    result.watcherDetails
      ? Object.values(result.watcherDetails).some((detail) => detail.enabled)
      : readiness.watchers !== "not-requested"
  ) {
    stages.push(readiness.watchers === "ready");
  }
  return { completed: stages.filter(Boolean).length, requested: stages.length };
}

export function setupStageLabel(result: DiviWorkspaceRunResult | null): string {
  const readiness = result?.readiness;
  if (!readiness) return "Starting setup";
  if (readiness.code === "failed" || readiness.code === "degraded")
    return "Code setup needs attention";
  if (readiness.code !== "ready") return "Preparing code";
  if (readiness.website === "failed" || readiness.website === "degraded")
    return "Website needs attention";
  if (readiness.website && readiness.website !== "not-requested" && readiness.website !== "ready")
    return "Starting website";
  if (
    result.prepareProfiles?.length &&
    !result.prepareProfiles.every((id) => {
      const receipt = result.prepareReceipts;
      if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return false;
      const item = (receipt as Record<string, unknown>)[id];
      return item && typeof item === "object" && "status" in item && item.status === "passed";
    })
  )
    return "Preparing check dependencies";
  if (result.watcherDetails) {
    const watchers = Object.values(result.watcherDetails).filter((detail) => detail.enabled);
    if (watchers.some((detail) => ["degraded", "ownership-uncertain"].includes(detail.state)))
      return readiness.website === "not-requested"
        ? "Background task needs attention"
        : "Live build needs attention";
    if (watchers.some((detail) => detail.state !== "ready"))
      return readiness.website === "not-requested"
        ? "Waiting for background task"
        : "Waiting for live build";
  }
  return "Setup complete";
}

export function elapsedLabel(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return Math.floor(whole / 60) + ":" + String(whole % 60).padStart(2, "0");
}

export function watcherLabel(id: string): string {
  if (id === "builder") return "Builder";
  if (id === "builder5") return "Builder 5";
  return id;
}

export function watcherFollowupLabel(id: string, hasWebsite: boolean): string {
  return `Waiting for ${watcherLabel(id)} ${hasWebsite ? "build" : "task"}`;
}

export function needsBuildFollowup(result: DiviWorkspaceRunResult, profileId?: string): boolean {
  if (profileId) {
    const detail = result.watcherDetails?.[profileId];
    return detail?.canVerifyBuild === true && detail.state === "running-unverified";
  }
  return Object.values(result.watcherDetails ?? {}).some(
    (detail) => detail.enabled && detail.canVerifyBuild && detail.state === "running-unverified",
  );
}

export function cleanLogTail(value: string): string {
  return value
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .split("\n")
    .map((line) => line.split("\r").at(-1) ?? "")
    .join("\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(
      /\b((?:api[_-]?key|token|password|secret|authorization)\s*[:=]\s*)\S+/gi,
      "$1[redacted]",
    );
}
