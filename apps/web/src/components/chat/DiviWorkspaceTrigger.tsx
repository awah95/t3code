import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { FolderKanbanIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { openDiviWorkspacePanel } from "../../diviWorkspacePanelBus";
import { isElectron } from "../../env";
import { diviWorkspaceRun } from "../../state/diviWorkspace";
import { useRightPanelStore } from "../../rightPanelStore";
import { useEnvironment } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { isLocalDiviEnvironment } from "./diviWorkspaceView";

export function DiviWorkspaceTrigger({
  environmentId,
  threadId,
  projectCwd,
}: {
  environmentId: EnvironmentId;
  threadId?: ThreadId;
  projectCwd?: string | undefined;
}) {
  const environment = useEnvironment(environmentId);
  const target = environment?.entry.target;
  const local = isLocalDiviEnvironment(
    window.location.hostname,
    isElectron,
    target?._tag,
    target?._tag === "PrimaryConnectionTarget" ? target.httpBaseUrl : undefined,
  );
  const runRpc = useAtomCommand(diviWorkspaceRun, { reportFailure: false });
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);

  useEffect(() => {
    if (!projectCwd) {
      setWorkspaceId(null);
      return;
    }
    let current = true;
    setWorkspaceId(null);
    void runRpc({
      environmentId,
      input: { operation: "identify", projectPath: projectCwd },
    }).then((response) => {
      if (!current) return;
      setWorkspaceId(
        response._tag === "Success" && response.value.available
          ? (response.value.workspaceId ?? null)
          : null,
      );
    });
    return () => {
      current = false;
    };
  }, [environmentId, projectCwd, runRpc]);

  if (projectCwd && !workspaceId) return null;
  return (
    <Button
      size="xs"
      variant="ghost"
      disabled={!workspaceId && !local}
      title={
        workspaceId
          ? "Manage this Divi workspace in the right panel"
          : local
            ? "Manage Divi workspaces"
            : "Divi workspaces are available only on the local T3 server Mac"
      }
      onClick={() => {
        if (workspaceId && threadId) {
          useRightPanelStore
            .getState()
            .openDiviWorkspace(scopeThreadRef(environmentId, threadId), workspaceId);
          return;
        }
        openDiviWorkspacePanel({ environmentId });
      }}
    >
      <FolderKanbanIcon className="size-3.5" />{" "}
      {workspaceId || local ? "Divi workspace" : "Divi workspace · local only"}
    </Button>
  );
}
