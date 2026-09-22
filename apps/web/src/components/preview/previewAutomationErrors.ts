import {
  BrowserObservedDialog,
  EnvironmentId,
  PreviewAutomationArtifactTransferError,
  type PreviewAutomationHost,
  PreviewAutomationOperation,
  PreviewAutomationRecordingTransferError,
  PreviewAutomationRecordingDesktopUpdateRequiredError,
  PreviewAutomationRecordingTooLargeError,
  PreviewAutomationRecordingDeadlineExpiredError,
  type PreviewAutomationRequest,
  type PreviewAutomationResponse,
  PreviewTabId,
  ThreadId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export interface PreviewAutomationOperationContext {
  readonly requestId: PreviewAutomationRequest["requestId"];
  readonly operation: PreviewAutomationRequest["operation"];
  readonly environmentId: PreviewAutomationHost["environmentId"];
  readonly threadId: PreviewAutomationRequest["threadId"];
  readonly tabId: Exclude<PreviewAutomationRequest["tabId"], undefined> | null;
}

export class PreviewAutomationOverlayTimeoutError extends Schema.TaggedError<PreviewAutomationOverlayTimeoutError>()(
  "PreviewAutomationOverlayTimeoutError",
  {
    requestId: TrimmedNonEmptyString,
    environmentId: EnvironmentId,
    threadId: ThreadId,
    timeoutMs: Schema.Int,
  },
) {
  get responseTag() {
    return "PreviewAutomationTimeoutError" as const;
  }

  override get message(): string {
    return `Preview webview for request ${this.requestId} on environment ${this.environmentId} thread ${this.threadId} did not register within ${this.timeoutMs}ms.`;
  }
}

export class PreviewAutomationNavigationTimeoutError extends Schema.TaggedError<PreviewAutomationNavigationTimeoutError>()(
  "PreviewAutomationNavigationTimeoutError",
  {
    requestId: TrimmedNonEmptyString,
    environmentId: EnvironmentId,
    threadId: ThreadId,
    tabId: PreviewTabId,
    readiness: Schema.Literals(["domContentLoaded", "load"]),
    timeoutMs: Schema.Int,
  },
) {
  get responseTag() {
    return "PreviewAutomationTimeoutError" as const;
  }

  override get message(): string {
    return `Preview navigation for request ${this.requestId} on environment ${this.environmentId} thread ${this.threadId} tab ${this.tabId} did not reach ${this.readiness} readiness within ${this.timeoutMs}ms.`;
  }
}

export class PreviewAutomationViewportTimeoutError extends Schema.TaggedError<PreviewAutomationViewportTimeoutError>()(
  "PreviewAutomationViewportTimeoutError",
  {
    requestId: TrimmedNonEmptyString,
    environmentId: EnvironmentId,
    threadId: ThreadId,
    tabId: PreviewTabId,
    timeoutMs: Schema.Int,
  },
) {
  get responseTag() {
    return "PreviewAutomationTimeoutError" as const;
  }

  override get message(): string {
    return `Preview viewport for request ${this.requestId} on environment ${this.environmentId} thread ${this.threadId} tab ${this.tabId} was not rendered within ${this.timeoutMs}ms.`;
  }
}

export class PreviewAutomationTargetUnavailableError extends Schema.TaggedError<PreviewAutomationTargetUnavailableError>()(
  "PreviewAutomationTargetUnavailableError",
  {
    requestId: TrimmedNonEmptyString,
    operation: PreviewAutomationOperation,
    environmentId: EnvironmentId,
    threadId: ThreadId,
    tabId: Schema.NullOr(PreviewTabId),
    bridgeAvailable: Schema.Boolean,
  },
) {
  get responseTag() {
    return "PreviewAutomationTabNotFoundError" as const;
  }

  override get message(): string {
    return `Preview automation target for ${this.operation} request ${this.requestId} is unavailable on environment ${this.environmentId} thread ${this.threadId} (tab ${this.tabId ?? "unassigned"}, bridge ${this.bridgeAvailable ? "available" : "unavailable"}).`;
  }
}

export class PreviewAutomationRecordingNotActiveError extends Schema.TaggedError<PreviewAutomationRecordingNotActiveError>()(
  "PreviewAutomationRecordingNotActiveError",
  {
    requestId: TrimmedNonEmptyString,
    environmentId: EnvironmentId,
    threadId: ThreadId,
    tabId: Schema.NullOr(PreviewTabId),
  },
) {
  get responseTag() {
    return "PreviewAutomationExecutionError" as const;
  }

  override get message(): string {
    return `Preview automation request ${this.requestId} found no active recording for tab ${this.tabId ?? "unassigned"} on environment ${this.environmentId} thread ${this.threadId}.`;
  }
}

export class PreviewAutomationTargetNotEditableHostError extends Schema.TaggedError<PreviewAutomationTargetNotEditableHostError>()(
  "PreviewAutomationTargetNotEditableHostError",
  {
    requestId: TrimmedNonEmptyString,
    operation: PreviewAutomationOperation,
    environmentId: EnvironmentId,
    threadId: ThreadId,
    tabId: Schema.NullOr(PreviewTabId),
    selectorKind: Schema.optional(Schema.Literals(["focused-element", "locator", "selector"])),
    selectorLength: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  },
) {
  get responseTag() {
    return "PreviewAutomationTargetNotEditableError" as const;
  }

  override get message(): string {
    return `Preview automation ${this.operation} request ${this.requestId} requires an editable target in tab ${this.tabId ?? "unassigned"}.`;
  }
}

/** The exact dialog that interrupted an action after it may have taken effect. */
export class PreviewAutomationDialogPendingHostError extends Schema.TaggedError<PreviewAutomationDialogPendingHostError>()(
  "PreviewAutomationDialogPendingHostError",
  { dialog: BrowserObservedDialog },
) {
  get responseTag() {
    return "PreviewAutomationDialogPendingError" as const;
  }

  override get message(): string {
    return "The browser action is paused by a JavaScript dialog. Handle this exact dialog with preview_dialog. Do not repeat the original action; it may already have executed.";
  }
}

const targetNotEditableDiagnostics = (
  cause: unknown,
): {
  readonly selectorKind?: "focused-element" | "locator" | "selector";
  readonly selectorLength?: number;
} | null => {
  if (
    typeof cause !== "object" ||
    cause === null ||
    !("_tag" in cause) ||
    cause._tag !== "PreviewAutomationTargetNotEditableError"
  ) {
    return null;
  }
  const selectorKind =
    "selectorKind" in cause &&
    (cause.selectorKind === "focused-element" ||
      cause.selectorKind === "locator" ||
      cause.selectorKind === "selector")
      ? cause.selectorKind
      : undefined;
  const selectorLength =
    "selectorLength" in cause &&
    typeof cause.selectorLength === "number" &&
    Number.isInteger(cause.selectorLength) &&
    cause.selectorLength >= 0
      ? cause.selectorLength
      : undefined;
  return {
    ...(selectorKind === undefined ? {} : { selectorKind }),
    ...(selectorLength === undefined ? {} : { selectorLength }),
  };
};

const decodeBrowserObservedDialog = Schema.decodeUnknownOption(BrowserObservedDialog);

const dialogPendingDiagnostics = (
  input: PreviewAutomationOperationContext & { readonly cause: unknown },
): typeof BrowserObservedDialog.Type | null => {
  const visited = new Set<object>();
  let candidate = input.cause;
  for (let depth = 0; depth < 3; depth += 1) {
    if (typeof candidate !== "object" || candidate === null || visited.has(candidate)) return null;
    visited.add(candidate);
    if (
      "_tag" in candidate &&
      candidate._tag === "PreviewAutomationDialogPendingError" &&
      "dialog" in candidate
    ) {
      const decoded = decodeBrowserObservedDialog(candidate.dialog);
      if (Option.isNone(decoded)) return null;
      const dialog = decoded.value;
      return dialog.environmentId === input.environmentId &&
        input.tabId !== null &&
        dialog.tabId === input.tabId &&
        dialog.actionId === input.requestId
        ? dialog
        : null;
    }
    if (!("cause" in candidate)) return null;
    candidate = candidate.cause;
  }
  return null;
};

export class PreviewAutomationOperationError extends Schema.TaggedError<PreviewAutomationOperationError>()(
  "PreviewAutomationOperationError",
  {
    requestId: TrimmedNonEmptyString,
    operation: PreviewAutomationOperation,
    environmentId: EnvironmentId,
    threadId: ThreadId,
    tabId: Schema.NullOr(PreviewTabId),
    cause: Schema.Defect(),
  },
) {
  static fromCause(
    input: PreviewAutomationOperationContext & { readonly cause: unknown },
  ): PreviewAutomationHostError {
    if (isPreviewAutomationHostError(input.cause)) {
      if (
        input.cause._tag === "PreviewAutomationArtifactTransferError" &&
        (input.cause.environmentId !== input.environmentId ||
          input.cause.threadId !== input.threadId ||
          input.cause.operation !== input.operation)
      ) {
        return new PreviewAutomationOperationError(input);
      }
      if (
        input.cause._tag === "PreviewAutomationDialogPendingHostError" &&
        (input.cause.dialog.environmentId !== input.environmentId ||
          input.tabId === null ||
          input.cause.dialog.tabId !== input.tabId)
      ) {
        return new PreviewAutomationOperationError(input);
      }
      return input.cause;
    }
    const pendingDialog = dialogPendingDiagnostics(input);
    if (pendingDialog) {
      return new PreviewAutomationDialogPendingHostError({ dialog: pendingDialog });
    }
    const diagnostics = targetNotEditableDiagnostics(input.cause);
    return diagnostics
      ? new PreviewAutomationTargetNotEditableHostError({
          requestId: input.requestId,
          operation: input.operation,
          environmentId: input.environmentId,
          threadId: input.threadId,
          tabId: input.tabId,
          ...diagnostics,
        })
      : new PreviewAutomationOperationError(input);
  }

  get responseTag() {
    return "PreviewAutomationExecutionError" as const;
  }

  override get message(): string {
    return `Preview automation ${this.operation} request ${this.requestId} failed on environment ${this.environmentId} thread ${this.threadId} (tab ${this.tabId ?? "unassigned"}).`;
  }
}

export const PreviewAutomationHostError = Schema.Union([
  PreviewAutomationArtifactTransferError,
  PreviewAutomationRecordingTransferError,
  PreviewAutomationRecordingDesktopUpdateRequiredError,
  PreviewAutomationRecordingTooLargeError,
  PreviewAutomationRecordingDeadlineExpiredError,
  PreviewAutomationOverlayTimeoutError,
  PreviewAutomationNavigationTimeoutError,
  PreviewAutomationViewportTimeoutError,
  PreviewAutomationTargetUnavailableError,
  PreviewAutomationRecordingNotActiveError,
  PreviewAutomationTargetNotEditableHostError,
  PreviewAutomationDialogPendingHostError,
  PreviewAutomationOperationError,
]);
export type PreviewAutomationHostError = typeof PreviewAutomationHostError.Type;

const isPreviewAutomationHostError = Schema.is(PreviewAutomationHostError);

export function serializePreviewAutomationHostError(
  error: PreviewAutomationHostError,
): NonNullable<PreviewAutomationResponse["error"]> {
  const detail = Object.fromEntries(
    Object.entries(error).filter(
      ([key]) =>
        key !== "_tag" && key !== "cause" && key !== "name" && key !== "message" && key !== "stack",
    ),
  );
  return {
    _tag: "responseTag" in error ? error.responseTag : error._tag,
    message: error.message,
    ...(Object.keys(detail).length === 0 ? {} : { detail }),
  };
}
