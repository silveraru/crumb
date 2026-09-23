import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Vote } from "../lib/api";
import { colors } from "../lib/theme";

export function Votes(props: { score: number; myVote: Vote; disabled?: boolean; onVote(v: -1 | 0 | 1): void }) {
  const { score, myVote, disabled, onVote } = props;
  return (
    <View style={styles.col}>
      <Pressable
        hitSlop={8}
        disabled={disabled}
        accessibilityLabel="Upvote"
        onPress={() => onVote(myVote === 1 ? 0 : 1)}
      >
        <Text style={[styles.arrow, myVote === 1 && { color: colors.up }, disabled && styles.off]}>▲</Text>
      </Pressable>
      <Text style={styles.score}>{score}</Text>
      <Pressable
        hitSlop={8}
        disabled={disabled}
        accessibilityLabel="Downvote"
        onPress={() => onVote(myVote === -1 ? 0 : -1)}
      >
        <Text style={[styles.arrow, myVote === -1 && { color: colors.down }, disabled && styles.off]}>▼</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  col: { alignItems: "center", width: 44, gap: 2 },
  arrow: { fontSize: 18, color: colors.muted },
  off: { opacity: 0.3 },
  score: { fontSize: 16, fontWeight: "700", color: colors.text },
});
