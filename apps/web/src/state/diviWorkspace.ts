import { WS_METHODS } from "@t3tools/contracts";
import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";
import { connectionAtomRuntime } from "../connection/runtime";

export const diviWorkspaceRun = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:divi-workspace:run",
  tag: WS_METHODS.diviWorkspaceRun,
});
