import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

/** Keep resource operations and their responses bound to one workspace selection. */
export function useDiviWorkspaceControls(scopeKey: string | null) {
  const scope = useMemo(() => ({ key: scopeKey }), [scopeKey]);
  const currentScope = useRef<typeof scope | null>(scope);
  const pending = useRef(new Map<string, typeof scope>());
  const [busy, setBusy] = useState({ scope, resources: {} as Record<string, boolean> });

  useLayoutEffect(() => {
    currentScope.current = scope;
    return () => {
      currentScope.current = null;
    };
  }, [scope]);

  const runResource = useCallback(
    async (resource: string, action: (isCurrent: () => boolean) => Promise<void>) => {
      const isCurrent = () => currentScope.current === scope;
      if (!isCurrent() || pending.current.get(resource) === scope) return;
      pending.current.set(resource, scope);
      setBusy((previous) => ({
        scope,
        resources: { ...(previous.scope === scope ? previous.resources : {}), [resource]: true },
      }));
      try {
        await action(isCurrent);
      } finally {
        if (pending.current.get(resource) === scope) pending.current.delete(resource);
        if (isCurrent())
          setBusy((previous) => {
            if (previous.scope !== scope) return previous;
            const resources = { ...previous.resources };
            delete resources[resource];
            return { scope, resources };
          });
      }
    },
    [scope],
  );

  return { busyResources: busy.scope === scope ? busy.resources : {}, runResource };
}
