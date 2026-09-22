import {
  PreviewAutomationExtractInput,
  PreviewAutomationExtractResult,
  PreviewAutomationWaitForAssertionInput,
  PreviewAutomationWaitForAssertionResult,
  PreviewAutomationCheckInput,
  PreviewAutomationError,
  PreviewAutomationHoverInput,
  PreviewAutomationSelectInput,
  PreviewAutomationVerifyInput,
  PreviewAutomationVerifyResult,
  ToolActivityIcon,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool } from "effect/unstable/ai";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as PreviewAutomationBroker from "../../PreviewAutomationBroker.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  PreviewAutomationBroker.PreviewAutomationBroker,
];
const ActionResult = Schema.Struct({ toolIcon: Schema.optional(ToolActivityIcon) });

export const PreviewExtractTool = Tool.make("preview_extract", {
  description:
    "Extract bounded typed fields from one exact semantic region, list, or table. Declare the fields and row limit; returned coverage and omissions distinguish incomplete results from empty content. This does not accept executable code.",
  parameters: PreviewAutomationExtractInput,
  success: PreviewAutomationExtractResult,
  failure: PreviewAutomationError,
  dependencies,
})
  .annotate(Tool.Title, "Extract browser data")
  .annotate(Tool.OpenWorld, true)
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

export const PreviewWaitForAssertionTool = Tool.make("preview_wait_for_assertion", {
  description:
    "Wait for one typed assertion using page events and a bounded deadline. Returns satisfied, timed-out, or indeterminate with independent verification coverage. Do not retry a mutation because a wait times out; inspect the state first.",
  parameters: PreviewAutomationWaitForAssertionInput,
  success: PreviewAutomationWaitForAssertionResult,
  failure: PreviewAutomationError,
  dependencies,
})
  .annotate(Tool.Title, "Wait for browser assertion")
  .annotate(Tool.OpenWorld, true)
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

export const PreviewVerifyTool = Tool.make("preview_verify", {
  description:
    "Verify assertions against the live document independently of the compact snapshot. Reports passed, failed, or indeterminate, with scope coverage and document freshness. Use an exact semantic target and optional frame/container scope when labels repeat. An incomplete search never proves absence.",
  parameters: PreviewAutomationVerifyInput,
  success: PreviewAutomationVerifyResult,
  failure: PreviewAutomationError,
  dependencies,
})
  .annotate(Tool.Title, "Verify browser assertions")
  .annotate(Tool.OpenWorld, true)
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

export const PreviewSelectTool = Tool.make("preview_select", {
  description:
    "Select one exact option by value or label on one uniquely matched native select. Use a semantic target with scope or a snapshot locator. Duplicate controls or option labels are rejected; verify the resulting application state separately.",
  parameters: PreviewAutomationSelectInput,
  success: ActionResult,
  failure: PreviewAutomationError,
  dependencies,
})
  .annotate(Tool.Title, "Select browser option")
  .annotate(Tool.OpenWorld, true)
  .annotate(Tool.Destructive, true);

export const PreviewCheckTool = Tool.make("preview_check", {
  description:
    "Set one uniquely matched checkbox or radio to an explicit checked state. Already matching controls are left unchanged. Use a semantic target with scope or a snapshot locator; verify application effects separately.",
  parameters: PreviewAutomationCheckInput,
  success: ActionResult,
  failure: PreviewAutomationError,
  dependencies,
})
  .annotate(Tool.Title, "Set browser checked state")
  .annotate(Tool.OpenWorld, true)
  .annotate(Tool.Destructive, true);

export const PreviewHoverTool = Tool.make("preview_hover", {
  description:
    "Hover one uniquely matched target using a semantic target with scope or a snapshot locator. Observe or verify the revealed UI before acting on it.",
  parameters: PreviewAutomationHoverInput,
  success: ActionResult,
  failure: PreviewAutomationError,
  dependencies,
})
  .annotate(Tool.Title, "Hover browser control")
  .annotate(Tool.OpenWorld, true)
  .annotate(Tool.Destructive, true);

export const browserCapabilityTools = [
  PreviewExtractTool,
  PreviewWaitForAssertionTool,
  PreviewVerifyTool,
  PreviewSelectTool,
  PreviewCheckTool,
  PreviewHoverTool,
] as const;
