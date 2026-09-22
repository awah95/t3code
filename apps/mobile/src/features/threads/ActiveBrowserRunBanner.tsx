import type { BrowserRunStatus } from "@t3tools/contracts";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";

function statusLabel(status: BrowserRunStatus): string {
  switch (status) {
    case "observing":
      return "Observing the page";
    case "acting":
      return "Using the browser";
    case "verifying":
      return "Checking the result";
    default:
      return "Browser task running";
  }
}

export function ActiveBrowserRunBanner(props: {
  readonly activeRunCount: number;
  readonly primaryStatus: BrowserRunStatus;
  readonly stopping: boolean;
  readonly onStop: () => void;
}) {
  const title =
    props.activeRunCount === 1
      ? statusLabel(props.primaryStatus)
      : `${props.activeRunCount} browser tasks running`;
  const taskNoun = props.activeRunCount === 1 ? "task" : "tasks";

  return (
    <View className="flex-row items-center gap-3 rounded-2xl border border-border bg-card px-3.5 py-3">
      <View className="size-2 rounded-full bg-warning-foreground" />
      <View className="min-w-0 flex-1">
        <Text className="font-t3-medium text-sm" numberOfLines={1}>
          {props.stopping ? `Stopping browser ${taskNoun}…` : title}
        </Text>
        <Text className="text-xs text-foreground-muted" numberOfLines={2}>
          Browser takeover is available in T3 Code desktop.
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Stop browser ${taskNoun}`}
        className="rounded-full border border-border bg-background px-3 py-1.5 disabled:opacity-50"
        disabled={props.stopping}
        onPress={props.onStop}
      >
        <Text className="font-t3-medium text-xs">{props.stopping ? "Stopping…" : "Stop"}</Text>
      </Pressable>
    </View>
  );
}
