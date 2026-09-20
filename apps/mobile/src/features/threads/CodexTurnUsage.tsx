import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { useNavigation } from "@react-navigation/native";
import {
  ledgerEstimate,
  ledgerTokenCount,
} from "@t3tools/client-runtime/state/codex-ledger-presentation";
import type { EnvironmentId, ThreadId, TurnId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { serverEnvironment } from "../../state/server";

export function CodexTurnUsage({
  environmentId,
  threadId,
  turnId,
  isLatestTurn,
  isUnsettled,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  turnId: TurnId;
  isLatestTurn: boolean;
  isUnsettled: boolean;
}) {
  const navigation = useNavigation();
  const [expanded, setExpanded] = useState(false);
  const query = serverEnvironment.codexLedgerTurns({
    environmentId,
    input: { t3ThreadId: threadId, t3TurnId: turnId, limit: 1 },
  });
  const result = useAtomValue(query);
  const refresh = useAtomRefresh(query);
  const turn = Option.getOrNull(AsyncResult.value(result))?.items[0];

  useEffect(() => {
    if (!isLatestTurn) return;
    let remaining = isUnsettled ? Number.POSITIVE_INFINITY : 20;
    const timer = setInterval(() => {
      refresh();
      remaining -= 1;
      if (remaining <= 0) clearInterval(timer);
    }, 15_000);
    return () => clearInterval(timer);
  }, [isLatestTurn, isUnsettled, refresh]);

  if (!turn) return null;
  return (
    <View className="items-end">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Codex turn usage"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
        className="min-h-8 justify-center px-1"
      >
        <Text className="text-xs text-foreground-secondary">
          Own turn {ledgerEstimate(turn.valuation)} ·{" "}
          {ledgerTokenCount(turn.tokens.processedTokens)} tokens
        </Text>
      </Pressable>
      {expanded ? (
        <>
          <Text className="text-right text-xs text-foreground-secondary">
            {turn.model ?? "Model unknown"} · {turn.responseCount} responses · {turn.childTurnCount}{" "}
            children
            {" · "}
            {turn.coverage.usage} usage · {turn.coverage.pricing} pricing. Child work is excluded.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open Usage, then Ledger"
            onPress={() =>
              navigation.navigate("SettingsSheet", {
                screen: "SettingsContent",
                params: { screen: "SettingsUsage" },
              })
            }
            className="min-h-8 justify-center px-1"
          >
            <Text className="text-xs text-foreground-secondary underline">Open Usage → Ledger</Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}
