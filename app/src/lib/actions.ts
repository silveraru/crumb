import { Alert } from "react-native";

const REASONS = ["Bullying or harassment", "Threats or violence", "Spam", "Sharing private info", "Other"];

/** Shows the ••• menu: delete for your own content, report for everyone else's. */
export function showContentActions(opts: {
  isMine: boolean;
  onDelete(): Promise<unknown>;
  onReport(reason: string): Promise<unknown>;
}) {
  if (opts.isMine) {
    Alert.alert("Delete this?", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void run(opts.onDelete) },
    ]);
    return;
  }
  Alert.alert("Report", "Why are you reporting this?", [
    ...REASONS.map((reason) => ({
      text: reason,
      onPress: () => void run(() => opts.onReport(reason), "Thanks — we'll take a look."),
    })),
    { text: "Cancel", style: "cancel" as const },
  ]);
}

async function run(fn: () => Promise<unknown>, success?: string) {
  try {
    await fn();
    if (success) Alert.alert(success);
  } catch (e) {
    Alert.alert("Couldn't do that", (e as Error).message);
  }
}
