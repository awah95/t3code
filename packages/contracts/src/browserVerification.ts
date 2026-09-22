import * as Schema from "effect/Schema";

const BoundedId = Schema.String.check(Schema.isTrimmed())
  .check(Schema.isNonEmpty())
  .check(Schema.isMaxLength(256));
const BoundedText = Schema.String.check(Schema.isMaxLength(20_000));
const BoundedLocator = Schema.String.check(Schema.isTrimmed())
  .check(Schema.isNonEmpty())
  .check(Schema.isMaxLength(4_096));
const BoundedUrl = Schema.String.check(Schema.isTrimmed())
  .check(Schema.isNonEmpty())
  .check(Schema.isMaxLength(2_048));
const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const URL_GUIDANCE =
  "Absolute http(s) URL or a schemeless host such as t3.chat or localhost:5173. Schemeless public hosts use https; loopback hosts use http.";

export const BrowserNavigationTarget = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("url").annotate({
      description: "Selects direct URL navigation.",
    }),
    url: BoundedUrl.annotate({
      description: `Direct website URL. ${URL_GUIDANCE}`,
    }),
  }),
  Schema.Struct({
    kind: Schema.Literal("environment-port").annotate({
      description: "Selects a dev-server port relative to the current execution environment.",
    }),
    port: Schema.Int.check(Schema.isGreaterThan(0))
      .check(Schema.isLessThan(65_536))
      .annotate({ description: "Dev-server TCP port inside the current environment." }),
    protocol: Schema.optional(
      Schema.Literals(["http", "https"]).annotate({
        description: "Dev-server protocol. Defaults to http.",
      }),
    ),
    path: Schema.optional(
      Schema.String.check(Schema.isMaxLength(2_048)).annotate({
        description: "Optional path, query, and fragment, for example /settings?tab=account.",
      }),
    ),
  }),
]);
export type BrowserNavigationTarget = typeof BrowserNavigationTarget.Type;

export const BrowserSemanticFrameSelector = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("semantic"),
    name: BoundedText.annotate({ description: "Exact accessible iframe name." }),
  }),
  Schema.Struct({
    kind: Schema.Literal("locator"),
    locator: BoundedLocator.annotate({
      description: "Stable caller-supplied locator for one iframe element.",
    }),
  }),
]);
export type BrowserSemanticFrameSelector = typeof BrowserSemanticFrameSelector.Type;

export const BrowserSemanticFrameScope = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("main") }),
  Schema.Struct({
    kind: Schema.Literal("frame-path"),
    frames: Schema.Array(BrowserSemanticFrameSelector)
      .check(Schema.isMinLength(1))
      .check(Schema.isMaxLength(8)),
  }),
  Schema.Struct({ kind: Schema.Literal("all-authorized-frames") }),
]);
export type BrowserSemanticFrameScope = typeof BrowserSemanticFrameScope.Type;

export const BrowserSemanticAncestor = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("semantic"),
    role: Schema.Literals(["dialog", "region", "form", "group"]),
    name: BoundedText.annotate({ description: "Exact accessible container name." }),
  }),
  Schema.Struct({
    kind: Schema.Literal("locator"),
    locator: BoundedLocator.annotate({
      description: "Stable caller-supplied locator for one ancestor container.",
    }),
  }),
]);
export type BrowserSemanticAncestor = typeof BrowserSemanticAncestor.Type;

export const BrowserSemanticScope = Schema.Struct({
  frame: Schema.optionalKey(BrowserSemanticFrameScope).annotate({
    description: "Frame search scope. Defaults to the rendered main document.",
  }),
  ancestor: Schema.optionalKey(BrowserSemanticAncestor).annotate({
    description: "Optional unique container that narrows semantic matching.",
  }),
});
export type BrowserSemanticScope = typeof BrowserSemanticScope.Type;

export const BrowserSemanticTarget = Schema.Struct({
  role: BoundedId.annotate({ description: "Exact accessible role." }),
  name: BoundedText.annotate({ description: "Exact accessible name." }),
  scope: Schema.optionalKey(BrowserSemanticScope),
});
export type BrowserSemanticTarget = typeof BrowserSemanticTarget.Type;

/** Opaque host reference bound to one document and frame. Clients must not interpret its fields. */
export const BrowserElementReference = Schema.Struct({
  documentId: BoundedId,
  frameId: BoundedId,
  elementId: BoundedId,
});
export type BrowserElementReference = typeof BrowserElementReference.Type;

export const BrowserVerificationVerdict = Schema.Literals(["passed", "failed", "indeterminate"]);
export type BrowserVerificationVerdict = typeof BrowserVerificationVerdict.Type;

export const BrowserVerificationCoverage = Schema.Struct({
  status: Schema.Literals(["complete", "partial", "unsupported"]),
  searchedScopes: NonNegativeInt,
  omittedScopes: NonNegativeInt,
  omissions: Schema.Array(BoundedText).check(Schema.isMaxLength(64)),
});
export type BrowserVerificationCoverage = typeof BrowserVerificationCoverage.Type;

export const BrowserDocumentFreshness = Schema.Struct({
  documentId: BoundedId,
  revision: BoundedId,
  status: Schema.Literals(["current", "changed", "unknown"]),
});
export type BrowserDocumentFreshness = typeof BrowserDocumentFreshness.Type;
