import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { BotIcon, CircleAlertIcon, Globe2Icon, LoaderCircleIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "~/components/ui/popover";
import { Switch } from "~/components/ui/switch";
import { cn } from "~/lib/utils";

import { useJevBrowserStore } from "./jevBrowserStore";

function formatUsd(value: number): string {
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}

function statusLabel(status: "pending" | "succeeded" | "failed" | "cancelled") {
  switch (status) {
    case "pending":
      return "Running";
    case "succeeded":
      return "Done";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
  }
}

export function JevBrowserControl({ scope }: { readonly scope: ScopedThreadRef }) {
  const key = scopedThreadKey(scope);
  const state = useJevBrowserStore((store) => store.byScope[key]);
  const enable = useJevBrowserStore((store) => store.enable);
  const disable = useJevBrowserStore((store) => store.disable);
  const setNotice = useJevBrowserStore((store) => store.setNotice);
  const clearHistory = useJevBrowserStore((store) => store.clearHistory);
  const [checkingCredential, setCheckingCredential] = useState(false);
  const enableGenerationRef = useRef(0);
  const jevHostAvailable =
    window.desktopBridge?.getJevStatus !== undefined &&
    window.desktopBridge.observeJevBrowser !== undefined &&
    window.desktopBridge.decideJevBrowser !== undefined &&
    window.desktopBridge.executeJevBrowser !== undefined &&
    window.desktopBridge.cancelJevBrowser !== undefined;
  const enabled = state?.enabled ?? false;
  const history = state?.history ?? [];
  const pendingCount = history.filter((entry) => entry.status === "pending").length;
  const cost = useMemo(
    () => ({
      reportedUsd: history.reduce(
        (total, entry) => total + (entry.cost.kind === "reported" ? entry.cost.usd : 0),
        0,
      ),
      unknownCount: history.filter(
        (entry) => entry.status !== "pending" && entry.cost.kind === "unknown",
      ).length,
    }),
    [history],
  );
  useEffect(() => {
    enableGenerationRef.current += 1;
    setCheckingCredential(false);
    return () => {
      enableGenerationRef.current += 1;
    };
  }, [key]);

  const setEnabled = async (nextEnabled: boolean) => {
    const generation = ++enableGenerationRef.current;
    if (!nextEnabled) {
      setCheckingCredential(false);
      disable(scope);
      return;
    }
    setCheckingCredential(true);
    try {
      const getCredentialStatus = window.desktopBridge?.getJevStatus;
      if (
        !getCredentialStatus ||
        !window.desktopBridge?.observeJevBrowser ||
        !window.desktopBridge.decideJevBrowser ||
        !window.desktopBridge.executeJevBrowser ||
        !window.desktopBridge.cancelJevBrowser
      ) {
        setNotice(scope, "Jev is unavailable on this client. Regular browser tools still work.");
        return;
      }
      const credentialStatus = await getCredentialStatus();
      if (generation !== enableGenerationRef.current) return;
      if (!credentialStatus.hasKey) {
        setNotice(
          scope,
          credentialStatus.secureStorageAvailable
            ? "Add an OpenRouter key in Settings > General > Jev Auto routing first."
            : "Secure OS credential storage is unavailable.",
        );
        return;
      }
      enable(scope);
    } catch {
      if (generation !== enableGenerationRef.current) return;
      setNotice(scope, "The Jev credential could not be verified.");
    } finally {
      if (generation === enableGenerationRef.current) setCheckingCredential(false);
    }
  };

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost-muted"
            size="compact"
            aria-label={`Jev browser: ${pendingCount > 0 ? `${pendingCount} action${pendingCount === 1 ? "" : "s"} running` : enabled ? "on for this thread" : "off"}`}
          />
        }
      >
        <Globe2Icon className="size-3.5" />
        <span>Browser</span>
        <span
          aria-hidden
          className={cn(
            "size-1.5 rounded-full",
            pendingCount > 0 ? "bg-warning" : enabled ? "bg-success" : "bg-muted-foreground/50",
          )}
        />
        <span className="text-[11px] font-normal">
          {pendingCount > 0 ? "Running" : enabled ? "Jev" : "Direct"}
        </span>
      </PopoverTrigger>
      <PopoverPopup
        side="bottom"
        align="end"
        className="w-80 max-w-[calc(100vw-2rem)]"
        aria-label="Jev browser controls"
      >
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <PopoverTitle className="flex items-center gap-2 text-sm leading-5">
                <BotIcon className="size-4" />
                Jev browser
              </PopoverTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Let Jev choose browser actions for this thread only.
              </p>
            </div>
            <Switch
              size="sm"
              checked={enabled}
              disabled={checkingCredential || !jevHostAvailable}
              aria-label="Use Jev for browser actions in this thread"
              onCheckedChange={(checked) => void setEnabled(checked)}
            />
          </div>

          {!jevHostAvailable ? (
            <div className="flex items-start gap-2 rounded-md bg-muted/60 px-2.5 py-2 text-xs">
              <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <span>
                Jev is unavailable on this client. Regular browser tools still use Direct mode.
              </span>
            </div>
          ) : checkingCredential ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
              <LoaderCircleIcon className="size-3.5 animate-spin" />
              Checking credential…
            </div>
          ) : state?.notice ? (
            <div className="flex items-start gap-2 rounded-md bg-muted/60 px-2.5 py-2 text-xs">
              <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <span>{state.notice}</span>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-md border border-border/70 px-2.5 py-2">
              <div className="text-muted-foreground">Status</div>
              <div className="mt-0.5 font-medium">
                {pendingCount > 0 ? `${pendingCount} running` : enabled ? "Ready" : "Off"}
              </div>
            </div>
            <div className="rounded-md border border-border/70 px-2.5 py-2">
              <div className="text-muted-foreground">Recent reported cost</div>
              <div className="mt-0.5 font-medium">Reported {formatUsd(cost.reportedUsd)}</div>
              <div className="text-[11px] text-muted-foreground">{cost.unknownCount} unknown</div>
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-medium">Recent actions</span>
              {history.length > 0 ? (
                <Button
                  type="button"
                  variant="ghost-muted"
                  size="xs"
                  onClick={() => clearHistory(scope)}
                >
                  Clear
                </Button>
              ) : null}
            </div>
            {history.length === 0 ? (
              <p className="rounded-md border border-dashed border-border/70 px-2.5 py-3 text-center text-xs text-muted-foreground">
                No Jev browser actions yet.
              </p>
            ) : (
              <ul className="max-h-48 space-y-1 overflow-y-auto" aria-label="Jev browser history">
                {history.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-start justify-between gap-3 rounded-md px-2 py-1.5 text-xs hover:bg-muted/50"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{entry.label}</div>
                      {entry.detail ? (
                        <div className="truncate text-[11px] text-muted-foreground">
                          {entry.detail}
                        </div>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-right">
                      <div>{statusLabel(entry.status)}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {entry.cost.kind === "reported"
                          ? formatUsd(entry.cost.usd)
                          : entry.cost.kind === "unknown"
                            ? "Cost unknown"
                            : "No decision cost"}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1.5 text-[10px] text-muted-foreground">
              Clearing this list does not remove durable billing receipts.
            </p>
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
