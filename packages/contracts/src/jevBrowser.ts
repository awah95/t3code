import * as Schema from "effect/Schema";

import { EnvironmentId } from "./baseSchemas.ts";
import {
  BrowserDocumentFreshness,
  BrowserElementReference,
  BrowserNavigationTarget,
  BrowserSemanticTarget,
  BrowserVerificationCoverage,
  BrowserVerificationVerdict,
} from "./browserVerification.ts";
import { PreviewTabId } from "./preview.ts";

const BoundedId = Schema.String.check(Schema.isTrimmed())
  .check(Schema.isNonEmpty())
  .check(Schema.isMaxLength(256));
const BoundedTask = Schema.String.check(Schema.isTrimmed())
  .check(Schema.isNonEmpty())
  .check(Schema.isMaxLength(20_000));
const BoundedText = Schema.String.check(Schema.isMaxLength(20_000));
const BoundedDescription = Schema.String.check(Schema.isMaxLength(1_000));
const BoundedStringArray = Schema.Array(BoundedText).check(Schema.isMaxLength(128));
const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const utf8Encoder = new TextEncoder();

export const JEV_BROWSER_ASSERTIONS_MAX_BYTES = 16 * 1_024;

export const JEV_BROWSER_AUTOMATION_OPERATIONS = [
  "jevBrowserObserve",
  "jevBrowserVerify",
  "jevBrowserDecide",
  "jevBrowserExecute",
  "jevBrowserCancel",
] as const;

export const JEV_BROWSER_VERIFICATION_OPERATIONS = ["jevBrowserVerify"] as const;

export class JevBrowserRunConflictError extends Schema.TaggedError<JevBrowserRunConflictError>()(
  "JevBrowserRunConflictError",
  {
    environmentId: EnvironmentId,
    tabId: PreviewTabId,
    activeRunId: BoundedId,
  },
) {
  override get message(): string {
    return `Preview tab ${this.tabId} already has an active Jev browser run.`;
  }
}

export class JevBrowserRunError extends Schema.TaggedError<JevBrowserRunError>()(
  "JevBrowserRunError",
  {
    environmentId: EnvironmentId,
    stage: Schema.Literals(["status", "run"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Jev browser automation failed during ${this.stage}.`;
  }
}

export const JevBrowserMode = Schema.Literals(["disabled", "idle", "running"]);
export type JevBrowserMode = typeof JevBrowserMode.Type;

export const JevBrowserStatus = Schema.Struct({
  available: Schema.Boolean,
  mode: JevBrowserMode,
  runId: Schema.optionalKey(Schema.String),
});
export type JevBrowserStatus = typeof JevBrowserStatus.Type;

export const JevBrowserValue = Schema.Union([
  Schema.String,
  Schema.Number,
  Schema.Boolean,
  Schema.Array(Schema.String),
  Schema.Null,
]);
export type JevBrowserValue = typeof JevBrowserValue.Type;

export const JevBrowserOption = Schema.Struct({
  value: Schema.String,
  label: Schema.String,
  disabled: Schema.optionalKey(Schema.Boolean),
  selected: Schema.optionalKey(Schema.Boolean),
});
export type JevBrowserOption = typeof JevBrowserOption.Type;

export const JevBrowserControl = Schema.Struct({
  id: BoundedId,
  reference: Schema.optionalKey(BrowserElementReference),
  role: BoundedId,
  name: Schema.optionalKey(Schema.String),
  text: Schema.optionalKey(BoundedText),
  description: Schema.optionalKey(Schema.String),
  value: Schema.optionalKey(JevBrowserValue),
  checked: Schema.optionalKey(Schema.Boolean),
  disabled: Schema.optionalKey(Schema.Boolean),
  options: Schema.optionalKey(Schema.Array(JevBrowserOption)),
});
export type JevBrowserControl = typeof JevBrowserControl.Type;

export const JevBrowserOperation = Schema.Literals([
  "activate",
  "set-text",
  "select-option",
  "set-checked",
  "hover",
  "navigate",
  "scroll",
  "press-key",
]);
export type JevBrowserOperation = typeof JevBrowserOperation.Type;

export const JevBrowserInputKind = Schema.Literals([
  "text",
  "url",
  "navigation",
  "option",
  "scroll",
  "key",
]);
export type JevBrowserInputKind = typeof JevBrowserInputKind.Type;

const JevBrowserValueInput = Schema.Struct({
  id: BoundedId,
  kind: Schema.Literals(["text", "url", "option", "scroll", "key"]),
  value: BoundedText,
  description: BoundedDescription,
});

const JevBrowserNavigationInput = Schema.Struct({
  id: BoundedId,
  kind: Schema.Literal("navigation"),
  target: BrowserNavigationTarget,
  description: BoundedDescription,
});

export const JevBrowserInput = Schema.Union([JevBrowserValueInput, JevBrowserNavigationInput]);
export type JevBrowserInput = typeof JevBrowserInput.Type;

export const JevBrowserResolvedNavigation = Schema.Struct({
  inputId: BoundedId,
  resolvedUrl: Schema.String.check(Schema.isTrimmed())
    .check(Schema.isNonEmpty())
    .check(Schema.isMaxLength(2_048)),
  logicalLocation: Schema.String.check(Schema.isMaxLength(2_048)),
  allowedOrigins: Schema.Array(
    Schema.String.check(Schema.isTrimmed())
      .check(Schema.isNonEmpty())
      .check(Schema.isMaxLength(2_048)),
  ).check(Schema.isMaxLength(64)),
});
export type JevBrowserResolvedNavigation = typeof JevBrowserResolvedNavigation.Type;

export const JevBrowserCandidate = Schema.Struct({
  id: BoundedId,
  operation: JevBrowserOperation,
  targetId: Schema.optionalKey(Schema.String),
  inputId: Schema.optionalKey(Schema.String),
  checked: Schema.optionalKey(Schema.Boolean),
  description: BoundedDescription,
});
export type JevBrowserCandidate = typeof JevBrowserCandidate.Type;

export const JevBrowserObservation = Schema.Struct({
  revision: BoundedId,
  document: Schema.optionalKey(BrowserDocumentFreshness),
  surface: Schema.Literals(["browser", "computer"]),
  location: Schema.optionalKey(Schema.String),
  title: Schema.optionalKey(Schema.String),
  visibleText: Schema.optionalKey(BoundedText),
  omissions: Schema.optionalKey(BoundedStringArray),
  inputs: Schema.optionalKey(Schema.Array(JevBrowserInput).check(Schema.isMaxLength(512))),
  controls: Schema.Array(JevBrowserControl).check(Schema.isMaxLength(512)),
  candidates: Schema.Array(JevBrowserCandidate).check(Schema.isMaxLength(2_048)),
});
export type JevBrowserObservation = typeof JevBrowserObservation.Type;

export const JevBrowserAction = Schema.Struct({
  candidateId: BoundedId,
  operation: JevBrowserOperation,
  targetId: Schema.optionalKey(Schema.String),
  inputId: Schema.optionalKey(Schema.String),
  value: Schema.optionalKey(Schema.String),
  navigationTarget: Schema.optionalKey(BrowserNavigationTarget),
  checked: Schema.optionalKey(Schema.Boolean),
});
export type JevBrowserAction = typeof JevBrowserAction.Type;

export const JevBrowserExecutionResult = Schema.Union([
  Schema.Struct({ status: Schema.Literal("executed"), detail: Schema.optionalKey(Schema.String) }),
  Schema.Struct({ status: Schema.Literal("stale"), detail: Schema.optionalKey(Schema.String) }),
  Schema.Struct({ status: Schema.Literal("rejected"), detail: Schema.String }),
]);
export type JevBrowserExecutionResult = typeof JevBrowserExecutionResult.Type;

const JevBrowserControlAssertionFields = {
  kind: Schema.Literal("control"),
  property: Schema.Literals([
    "value",
    "selectedLabel",
    "disabled",
    "checked",
    "name",
    "text",
  ]).annotate({
    description:
      "Property to verify. value is the raw control value; selectedLabel is the human-readable label of the one selected option.",
  }),
  operator: Schema.Literals(["equals", "contains"]),
  expected: JevBrowserValue,
};

export const JevBrowserAssertion = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("location"),
    property: Schema.Literals(["location", "title", "visibleText"]),
    operator: Schema.Literals(["equals", "contains"]),
    expected: Schema.String,
  }),
  Schema.Struct({ kind: Schema.Literal("control-exists"), targetId: BoundedId }),
  Schema.Struct({ kind: Schema.Literal("control-exists"), target: BrowserSemanticTarget }),
  Schema.Struct({
    ...JevBrowserControlAssertionFields,
    targetId: BoundedId,
  }),
  Schema.Struct({
    ...JevBrowserControlAssertionFields,
    target: BrowserSemanticTarget,
  }),
  Schema.Struct({
    kind: Schema.Literal("control-count"),
    target: BrowserSemanticTarget,
    operator: Schema.Literals(["equals", "at-least", "at-most"]),
    expected: NonNegativeInt,
  }),
]);
export type JevBrowserAssertion = typeof JevBrowserAssertion.Type;

export const JevBrowserAssertions = Schema.Array(JevBrowserAssertion)
  .check(Schema.isMaxLength(128))
  .check(
    Schema.makeFilter(
      (assertions) =>
        utf8Encoder.encode(JSON.stringify(assertions)).length <= JEV_BROWSER_ASSERTIONS_MAX_BYTES ||
        `Assertions must not exceed ${JEV_BROWSER_ASSERTIONS_MAX_BYTES} UTF-8 bytes in total.`,
    ),
  );
export type JevBrowserAssertions = typeof JevBrowserAssertions.Type;

export const JevBrowserAssertionResult = Schema.Struct({
  assertion: JevBrowserAssertion,
  passed: Schema.Boolean,
  verdict: Schema.optionalKey(BrowserVerificationVerdict),
  actual: Schema.optionalKey(JevBrowserValue),
  reason: Schema.optionalKey(BoundedDescription),
  matchCount: Schema.optionalKey(NonNegativeInt),
  coverage: Schema.optionalKey(BrowserVerificationCoverage),
  document: Schema.optionalKey(BrowserDocumentFreshness),
});
export type JevBrowserAssertionResult = typeof JevBrowserAssertionResult.Type;

export const JevBrowserVerificationResult = Schema.Struct({
  assertion: JevBrowserAssertion,
  verdict: BrowserVerificationVerdict,
  passed: Schema.Boolean,
  actual: Schema.optionalKey(JevBrowserValue),
  reason: Schema.optionalKey(BoundedDescription),
  matchCount: NonNegativeInt,
  matches: Schema.optionalKey(Schema.Array(BrowserElementReference).check(Schema.isMaxLength(16))),
  coverage: BrowserVerificationCoverage,
  document: BrowserDocumentFreshness,
}).check(
  Schema.makeFilter((result) => {
    if (result.passed !== (result.verdict === "passed")) {
      return "Verification passed must agree with its tri-state verdict.";
    }
    if (
      result.verdict === "passed" &&
      (result.coverage.status !== "complete" || result.document.status !== "current")
    ) {
      return "Passed verification requires complete coverage of the current document.";
    }
    return true;
  }),
);
export type JevBrowserVerificationResult = typeof JevBrowserVerificationResult.Type;

export const JevBrowserAccounting = Schema.Struct({
  inputTokens: Schema.NullOr(Schema.Number),
  outputTokens: Schema.NullOr(Schema.Number),
  costUsd: Schema.NullOr(Schema.Number),
  responseModel: Schema.optionalKey(Schema.String),
  provider: Schema.optionalKey(Schema.String),
});
export type JevBrowserAccounting = typeof JevBrowserAccounting.Type;

export const JevBrowserDecision = Schema.Union([
  Schema.Struct({
    outcome: Schema.Literal("act"),
    candidateId: BoundedId,
  }),
  Schema.Struct({ outcome: Schema.Literal("done") }),
  Schema.Struct({
    outcome: Schema.Literal("needs-agent"),
    reason: Schema.Literals([
      "novel-text",
      "visual-understanding",
      "unsupported-operation",
      "ambiguous-state",
    ]),
  }),
  Schema.Struct({ outcome: Schema.Literal("unavailable"), reason: Schema.String }),
]);
export type JevBrowserDecision = typeof JevBrowserDecision.Type;

export const JevBrowserDecisionResult = Schema.Struct({
  decision: JevBrowserDecision,
  accounting: JevBrowserAccounting,
});
export type JevBrowserDecisionResult = typeof JevBrowserDecisionResult.Type;

export const JevBrowserReceipt = Schema.Struct({
  iteration: NonNegativeInt,
  revision: Schema.String,
  decision: JevBrowserDecision,
  accounting: JevBrowserAccounting,
  candidateId: Schema.optionalKey(Schema.String),
  status: Schema.Literals([
    "proposed",
    "executed",
    "rejected",
    "stale",
    "needs-agent",
    "unavailable",
  ]),
  detail: Schema.optionalKey(Schema.String),
});
export type JevBrowserReceipt = typeof JevBrowserReceipt.Type;

const RunFields = {
  runId: BoundedId,
  tabId: Schema.optionalKey(PreviewTabId),
};

export const JevBrowserObserveInput = Schema.Struct({
  ...RunFields,
  task: BoundedTask,
  inputs: Schema.Array(JevBrowserInput).check(Schema.isMaxLength(128)),
  allowedOrigins: Schema.Array(Schema.String.check(Schema.isMaxLength(2_048))).check(
    Schema.isMaxLength(64),
  ),
  resolvedNavigations: Schema.optionalKey(
    Schema.Array(JevBrowserResolvedNavigation).check(Schema.isMaxLength(128)),
  ),
});
export type JevBrowserObserveInput = typeof JevBrowserObserveInput.Type;

export const JevBrowserObserveResult = Schema.Struct({ observation: JevBrowserObservation });
export type JevBrowserObserveResult = typeof JevBrowserObserveResult.Type;

export const JevBrowserVerifyInput = Schema.Struct({
  ...RunFields,
  assertions: JevBrowserAssertions,
  expectedDocumentId: Schema.optionalKey(BoundedId),
});
export type JevBrowserVerifyInput = typeof JevBrowserVerifyInput.Type;

export const JevBrowserVerifyResult = Schema.Struct({
  results: Schema.Array(JevBrowserVerificationResult).check(Schema.isMaxLength(128)),
});
export type JevBrowserVerifyResult = typeof JevBrowserVerifyResult.Type;

export const JevBrowserDecideInput = Schema.Struct({
  ...RunFields,
  iteration: NonNegativeInt,
  task: Schema.String,
  observation: JevBrowserObservation,
  inputs: Schema.Array(JevBrowserInput).check(Schema.isMaxLength(640)),
  unmetConditions: Schema.Array(JevBrowserAssertionResult).check(Schema.isMaxLength(128)),
  priorReceipts: Schema.Array(JevBrowserReceipt).check(Schema.isMaxLength(128)),
});
export type JevBrowserDecideInput = typeof JevBrowserDecideInput.Type;

export const JevBrowserDecideResult = JevBrowserDecisionResult;
export type JevBrowserDecideResult = typeof JevBrowserDecideResult.Type;

export const JevBrowserExecuteInput = Schema.Struct({
  ...RunFields,
  revision: Schema.String,
  action: JevBrowserAction,
});
export type JevBrowserExecuteInput = typeof JevBrowserExecuteInput.Type;

export const JevBrowserExecuteResult = JevBrowserExecutionResult;
export type JevBrowserExecuteResult = typeof JevBrowserExecuteResult.Type;

export const JevBrowserCancelInput = Schema.Struct({
  ...RunFields,
  reason: Schema.Literals([
    "completed",
    "caller-cancelled",
    "timeout",
    "failed",
    "policy-disabled",
  ]),
});
export type JevBrowserCancelInput = typeof JevBrowserCancelInput.Type;

export const JevBrowserCancelResult = Schema.Struct({ cancelled: Schema.Boolean });
export type JevBrowserCancelResult = typeof JevBrowserCancelResult.Type;

export const JevBrowserRunTaskInput = Schema.Struct({
  task: BoundedTask.annotate({
    description: "The caller's exact natural-language browser task.",
  }),
  tabId: Schema.optionalKey(PreviewTabId).annotate({
    description: "Specific collaborative preview tab to control.",
  }),
  resumeFromRunId: Schema.optionalKey(BoundedId).annotate({
    description:
      "Prior handed-off run to continue. Continuation always starts with a fresh observation and never replays prior actions.",
  }),
  inputs: Schema.optionalKey(Schema.Array(JevBrowserInput).check(Schema.isMaxLength(128))).annotate(
    {
      description:
        "Caller-supplied exact text, destination URLs, options, keys, or scroll values. Jev cannot invent values.",
    },
  ),
  assertions: Schema.optionalKey(JevBrowserAssertions)
    .annotate({
      description:
        "Optional observable success conditions, including semantic control role and exact accessible name.",
    })
    .annotateKey({
      description:
        "Optional observable success conditions, including semantic control role and exact accessible name.",
    }),
  allowedOrigins: Schema.optionalKey(
    Schema.Array(Schema.String.check(Schema.isMaxLength(2_048))).check(Schema.isMaxLength(64)),
  ).annotate({
    description:
      "Explicit HTTP(S) origin allowlist. By default the current origin and supplied URL-input origins are allowed.",
  }),
  maxSteps: Schema.optionalKey(NonNegativeInt.check(Schema.isLessThanOrEqualTo(50))).annotate({
    description: "Maximum executed browser actions; defaults to 12 and cannot exceed 50.",
  }),
  maxDecisionCalls: Schema.optionalKey(
    NonNegativeInt.check(Schema.isLessThanOrEqualTo(64)),
  ).annotate({
    description: "Maximum paid Jev decisions; defaults to 16 and cannot exceed 64.",
  }),
  maxDurationMs: Schema.optionalKey(
    Schema.Int.check(Schema.isGreaterThan(0)).check(Schema.isLessThanOrEqualTo(60_000)),
  ).annotate({
    description: "Whole-run deadline in milliseconds; defaults to 45000 and cannot exceed 60000.",
  }),
  maxCostUsd: Schema.optionalKey(
    Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)).check(Schema.isLessThanOrEqualTo(10)),
  ).annotate({
    description:
      "Reported-cost stopping threshold in US dollars, checked between decisions; one paid decision may overshoot it. Not a provider-enforced hard spending cap. Cannot exceed 10.",
  }),
});
export type JevBrowserRunTaskInput = typeof JevBrowserRunTaskInput.Type;

const JevBrowserHandoffAction = Schema.Struct({
  iteration: NonNegativeInt,
  operation: JevBrowserOperation,
});

export const JevBrowserHandoff = Schema.Struct({
  reason: BoundedDescription,
  lastConfirmedAction: Schema.optionalKey(JevBrowserHandoffAction),
  uncertainEffects: Schema.Array(JevBrowserHandoffAction).check(Schema.isMaxLength(16)),
  outstandingAssertionIndexes: Schema.Array(NonNegativeInt).check(Schema.isMaxLength(128)),
});
export type JevBrowserHandoff = typeof JevBrowserHandoff.Type;

export const JevBrowserRunTaskResult = Schema.Struct({
  runId: BoundedId,
  continuedFromRunId: Schema.optionalKey(BoundedId),
  status: Schema.Literals([
    "disabled",
    "completed",
    "needs-agent",
    "cancelled",
    "budget-exhausted",
    "failed",
  ]),
  reason: Schema.String,
  observation: Schema.NullOr(JevBrowserObservation),
  assertions: Schema.Array(JevBrowserAssertionResult),
  receipts: Schema.Array(JevBrowserReceipt),
  decisionCalls: NonNegativeInt,
  executedSteps: NonNegativeInt,
  billedCostUsd: Schema.NullOr(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
  handoff: Schema.optionalKey(JevBrowserHandoff),
});
export type JevBrowserRunTaskResult = typeof JevBrowserRunTaskResult.Type;
