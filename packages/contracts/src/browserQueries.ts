import * as Schema from "effect/Schema";

import {
  BrowserDocumentFreshness,
  BrowserSemanticTarget,
  BrowserVerificationCoverage,
} from "./browserVerification.ts";
import {
  JEV_BROWSER_ASSERTIONS_MAX_BYTES,
  JevBrowserAssertion,
  JevBrowserVerificationResult,
} from "./jevBrowser.ts";

const BoundedId = Schema.String.check(Schema.isTrimmed())
  .check(Schema.isNonEmpty())
  .check(Schema.isMaxLength(256));
const BoundedKey = Schema.String.check(Schema.isTrimmed())
  .check(Schema.isNonEmpty())
  .check(Schema.isMaxLength(128));
const BoundedFieldText = Schema.String.check(Schema.isMaxLength(4_000));
const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const utf8Encoder = new TextEncoder();

export const BROWSER_EXTRACTION_MAX_ROWS = 100;
export const BROWSER_EXTRACTION_MAX_FIELDS = 32;
export const BROWSER_EXTRACTION_MAX_FIELD_CHARS = 4_000;
export const BROWSER_QUERY_MAX_WAIT_MS = 60_000;
export const BROWSER_QUERY_MAX_INPUT_BYTES = 24 * 1_024;

export const BrowserExtractionSource = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("region"),
    target: BrowserSemanticTarget,
  }),
  Schema.Struct({
    kind: Schema.Literal("list"),
    target: BrowserSemanticTarget,
    itemRole: Schema.optionalKey(Schema.Literals(["listitem", "option", "row"])),
  }),
  Schema.Struct({
    kind: Schema.Literal("table"),
    target: BrowserSemanticTarget,
  }),
]);
export type BrowserExtractionSource = typeof BrowserExtractionSource.Type;

export const BrowserExtractionProperty = Schema.Literals([
  "name",
  "text",
  "value",
  "checked",
  "href",
]);
export type BrowserExtractionProperty = typeof BrowserExtractionProperty.Type;

export const BrowserExtractionField = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("container"),
    key: BoundedKey,
    property: BrowserExtractionProperty,
  }),
  Schema.Struct({
    kind: Schema.Literal("descendant"),
    key: BoundedKey,
    target: BrowserSemanticTarget,
    property: BrowserExtractionProperty,
  }),
  Schema.Struct({
    kind: Schema.Literal("table-column"),
    key: BoundedKey,
    columnName: BoundedFieldText,
    property: Schema.Literals(["text", "value"]),
  }),
]);
export type BrowserExtractionField = typeof BrowserExtractionField.Type;

export const BrowserExtractQuery = Schema.Struct({
  source: BrowserExtractionSource.annotate({
    description: "Exact semantic region, list, or table to extract.",
  }),
  fields: Schema.Array(BrowserExtractionField)
    .check(Schema.isMinLength(1))
    .check(Schema.isMaxLength(BROWSER_EXTRACTION_MAX_FIELDS))
    .annotate({
      description: "One to thirty-two typed fields to extract from each bounded result row.",
    }),
  maxRows: Schema.optionalKey(
    Schema.Int.check(Schema.isGreaterThan(0)).check(
      Schema.isLessThanOrEqualTo(BROWSER_EXTRACTION_MAX_ROWS),
    ),
  ).annotate({ description: "Maximum returned rows. Defaults to 25 and cannot exceed 100." }),
  maxFieldChars: Schema.optionalKey(
    Schema.Int.check(Schema.isGreaterThan(0)).check(
      Schema.isLessThanOrEqualTo(BROWSER_EXTRACTION_MAX_FIELD_CHARS),
    ),
  ).annotate({
    description: "Maximum characters returned for each string field. Cannot exceed 4000.",
  }),
  expectedDocumentId: Schema.optionalKey(BoundedId).annotate({
    description: "Document identity from a prior observation, when freshness must be enforced.",
  }),
})
  .check(
    Schema.makeFilter(
      (query) =>
        new Set(query.fields.map(({ key }) => key)).size === query.fields.length ||
        "Extraction field keys must be unique.",
    ),
  )
  .check(
    Schema.makeFilter(
      (query) =>
        utf8Encoder.encode(JSON.stringify(query)).length <= BROWSER_QUERY_MAX_INPUT_BYTES ||
        `Extraction query must not exceed ${BROWSER_QUERY_MAX_INPUT_BYTES} UTF-8 bytes.`,
    ),
  );
export type BrowserExtractQuery = typeof BrowserExtractQuery.Type;

export const BrowserExtractValue = Schema.Union([
  BoundedFieldText,
  Schema.Finite,
  Schema.Boolean,
  Schema.Null,
]);
export type BrowserExtractValue = typeof BrowserExtractValue.Type;

export const BrowserExtractResult = Schema.Struct({
  rows: Schema.Array(
    Schema.Struct({
      fields: Schema.Array(
        Schema.Struct({
          key: BoundedKey,
          value: BrowserExtractValue,
        }),
      ).check(Schema.isMaxLength(BROWSER_EXTRACTION_MAX_FIELDS)),
    }),
  ).check(Schema.isMaxLength(BROWSER_EXTRACTION_MAX_ROWS)),
  omittedRows: NonNegativeInt,
  omittedFields: NonNegativeInt,
  omissions: Schema.Array(BoundedFieldText).check(Schema.isMaxLength(64)),
  coverage: BrowserVerificationCoverage,
  document: BrowserDocumentFreshness,
});
export type BrowserExtractResult = typeof BrowserExtractResult.Type;

export const BrowserWaitForAssertionQuery = Schema.Struct({
  assertion: JevBrowserAssertion.annotate({
    description: "One typed assertion to observe until satisfied or the deadline expires.",
  }),
  timeoutMs: Schema.Int.check(Schema.isGreaterThan(0))
    .check(Schema.isLessThanOrEqualTo(BROWSER_QUERY_MAX_WAIT_MS))
    .annotate({ description: "Exact wait deadline in milliseconds, from 1 through 60000." }),
  expectedDocumentId: Schema.optionalKey(BoundedId).annotate({
    description: "Document identity from a prior observation, when freshness must be enforced.",
  }),
}).check(
  Schema.makeFilter(
    (query) =>
      utf8Encoder.encode(JSON.stringify([query.assertion])).length <=
        JEV_BROWSER_ASSERTIONS_MAX_BYTES ||
      `Assertion must not exceed ${JEV_BROWSER_ASSERTIONS_MAX_BYTES} UTF-8 bytes.`,
  ),
);
export type BrowserWaitForAssertionQuery = typeof BrowserWaitForAssertionQuery.Type;

export const BrowserWaitForAssertionResult = Schema.Struct({
  status: Schema.Literals(["satisfied", "timed-out", "indeterminate"]),
  result: JevBrowserVerificationResult,
}).check(
  Schema.makeFilter((output) => {
    if (output.status === "satisfied" && output.result.verdict !== "passed") {
      return "A satisfied wait requires a passed verification result.";
    }
    if (output.status === "indeterminate" && output.result.verdict !== "indeterminate") {
      return "An indeterminate wait requires an indeterminate verification result.";
    }
    if (output.status === "timed-out" && output.result.verdict === "passed") {
      return "A timed-out wait cannot contain a passed verification result.";
    }
    return true;
  }),
);
export type BrowserWaitForAssertionResult = typeof BrowserWaitForAssertionResult.Type;
