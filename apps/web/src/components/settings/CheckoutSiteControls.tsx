import type {
  DiviWorkspaceOperation,
  DiviWorkspaceRunResult,
  EnvironmentId,
} from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { ExternalLinkIcon, PlayIcon, RotateCwIcon, SquareIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { diviWorkspaceRun } from "../../state/diviWorkspace";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";

export function CheckoutSiteControls({
  environmentId,
  mainId,
  canStart = true,
  disabled = false,
  refreshVersion = 0,
}: {
  environmentId: EnvironmentId;
  mainId: string;
  canStart?: boolean;
  disabled?: boolean;
  refreshVersion?: number;
}) {
  const runRpc = useAtomCommand(diviWorkspaceRun, { reportFailure: false });
  const [result, setResult] = useState<{
    scope: string;
    site?: DiviWorkspaceRunResult;
    error?: string;
  } | null>(null);
  const scope = `${environmentId}:${mainId}:${refreshVersion}`;
  const site = result?.scope === scope ? result.site : null;
  const error = result?.scope === scope ? result.error : null;
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const pending = useRef(false);

  useEffect(() => {
    const current = ++generation.current;
    void runRpc({ environmentId, input: { operation: "main-site-status", mainId } }).then(
      (response) => {
        if (generation.current !== current) return;
        if (response._tag === "Success") setResult({ scope, site: response.value });
        else setResult({ scope, error: String(squashAtomCommandFailure(response)) });
      },
    );
    return () => {
      generation.current += 1;
    };
  }, [environmentId, mainId, runRpc, scope]);

  async function run(operation: DiviWorkspaceOperation) {
    if (pending.current || disabled) return;
    pending.current = true;
    const current = ++generation.current;
    setBusy(true);
    setResult({ scope, ...(site ? { site } : {}) });
    try {
      const response = await runRpc({ environmentId, input: { operation, mainId } });
      if (generation.current !== current) return;
      if (response._tag === "Success") setResult({ scope, site: response.value });
      else
        setResult({
          scope,
          ...(site ? { site } : {}),
          error: String(squashAtomCommandFailure(response)),
        });
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  const running = site?.runtimeStatus?.website?.state === "running";
  const url = site?.previewUrl;
  const safeUrl = url && /^https?:\/\//i.test(url) ? url : null;
  return (
    <div className="mt-3 space-y-2 border-t border-border/40 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">
          Website ·{" "}
          {running
            ? "Running"
            : site?.status === "stopped"
              ? "Stopped"
              : site?.status === "not-prepared"
                ? "Not started"
                : "Status unavailable"}
        </span>
        <Button
          size="xs"
          variant="outline"
          disabled={disabled || busy || running || !canStart}
          onClick={() => void run("main-site-start")}
        >
          <PlayIcon aria-hidden />
          Start site
        </Button>
        <Button
          size="xs"
          variant="outline"
          disabled={disabled || busy || !running}
          onClick={() => void run("main-site-stop")}
        >
          <SquareIcon aria-hidden />
          Stop site
        </Button>
        <Button
          size="xs"
          variant="outline"
          disabled={disabled || busy}
          onClick={() => void run("main-site-status")}
        >
          <RotateCwIcon aria-hidden />
          Refresh site
        </Button>
        {safeUrl && (
          <Button
            size="xs"
            variant="outline"
            render={<a href={safeUrl} target="_blank" rel="noreferrer" />}
          >
            <ExternalLinkIcon aria-hidden />
            Open site
          </Button>
        )}
        {busy && (
          <span role="status" className="text-xs text-muted-foreground">
            Working…
          </span>
        )}
      </div>
      {site?.issues?.map((issue) => (
        <p key={issue} className="text-xs text-muted-foreground">
          {issue}
        </p>
      ))}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
