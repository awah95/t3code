import { describe, expect, it } from "vite-plus/test";
import type { JevRoutingContext } from "@t3tools/contracts";
import {
  describeJevCandidate,
  isJevCandidateAllowed,
  sanitizeJevContext,
  sanitizeJevText,
} from "./jevRouting.ts";

const context: JevRoutingContext = {
  existingSession: true,
  hasAttachments: false,
  interactionMode: "default",
};
describe("Jev capability and effort guard", () => {
  it("does not treat extra thinking on a smaller model as equal capability", () => {
    const unresolved = {
      ...context,
      failure: {
        unresolved: true,
        signals: ["same issue"],
        model: "gpt-5.6-sol",
        effort: "medium",
      },
    };
    expect(
      isJevCandidateAllowed(
        { key: "a", description: "", model: "gpt-6-luna", effort: "xhigh" },
        unresolved,
      ),
    ).toBe(false);
    expect(
      isJevCandidateAllowed(
        { key: "b", description: "", model: "gpt-6-sol", effort: "low" },
        unresolved,
      ),
    ).toBe(false);
    expect(
      isJevCandidateAllowed(
        { key: "c", description: "", model: "gpt-6-astra", effort: "low" },
        unresolved,
      ),
    ).toBe(true);
  });
  it("allows a fresh simple task to use a smaller model without a forced escalation ladder", () => {
    expect(
      isJevCandidateAllowed(
        { key: "a", description: "", model: "gpt-6-luna", effort: "low" },
        context,
      ),
    ).toBe(true);
  });
  it("keeps unresolved 5.6 work at its previous capability floor", () => {
    const unresolved = {
      ...context,
      failure: {
        unresolved: true,
        signals: ["same issue"],
        model: "gpt-5.6-terra",
        effort: "medium",
      },
    };
    expect(
      isJevCandidateAllowed(
        { key: "a", description: "", model: "gpt-6-luna", effort: "xhigh" },
        unresolved,
      ),
    ).toBe(false);
    expect(
      isJevCandidateAllowed(
        { key: "b", description: "", model: "gpt-6-sol", effort: "medium" },
        unresolved,
      ),
    ).toBe(true);
  });
  it("rejects unprofiled models and invalid effort pairs", () => {
    expect(
      isJevCandidateAllowed(
        { key: "a", description: "", model: "unknown", effort: "low" },
        context,
      ),
    ).toBe(false);
    expect(
      isJevCandidateAllowed({ key: "b", description: "", model: "gpt-6-astra" }, context),
    ).toBe(false);
  });
  it("does not lower an unresolved manual max effort to xhigh on the same model", () => {
    expect(
      isJevCandidateAllowed(
        { key: "a", description: "", model: "gpt-6-astra", effort: "xhigh" },
        {
          ...context,
          failure: { unresolved: true, signals: [], model: "gpt-6-astra", effort: "max" },
        },
      ),
    ).toBe(false);
  });
  it("includes both model identity and effort guidance in candidate descriptions", () => {
    expect(describeJevCandidate("gpt-6-luna", "low")).toContain("gpt-6-luna, effort low");
  });
});
describe("Jev context sanitization", () => {
  it("redacts credentials throughout history without shortening task text", () => {
    const long = "a".repeat(13_000) + " preserve this requirement";
    expect(sanitizeJevText(long)).toBe(long);
    const secret = "Bearer private-example-secret";
    const clean = sanitizeJevContext({
      ...context,
      originalTask: secret,
      activePlan: secret,
      history: [{ role: "user", text: secret }],
      failure: { unresolved: true, signals: [secret] },
      omissions: [secret],
      budget: {
        checkedAt: "2026-09-20",
        windows: [{ label: secret, remainingPercent: 10 }],
        unavailableReason: secret,
      },
    });
    expect(JSON.stringify(clean)).not.toContain("private-example-secret");
    expect(clean.history?.[0]?.text).toBe("Bearer [redacted]");
  });
});
