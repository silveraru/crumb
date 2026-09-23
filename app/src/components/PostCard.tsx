import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Post } from "../lib/api";
import { colors } from "../lib/theme";
import { timeAgo } from "../lib/time";
import { Votes } from "./Votes";

export function PostCard(props: {
  post: Post;
  onPress?(): void;
  onVote(v: -1 | 0 | 1): void;
  onMore(): void;
}) {
  const { post, onPress, onVote, onMore } = props;
  return (
    <Pressable style={styles.card} onPress={onPress} disabled={!onPress}>
      <View style={styles.main}>
        <Text style={styles.body}>{post.body}</Text>
        <View style={styles.meta}>
          <Text style={styles.metaText}>{timeAgo(post.createdAt)}</Text>
          <Text style={styles.metaText}>
            💬 {post.commentCount} {post.commentCount === 1 ? "reply" : "replies"}
          </Text>
          {post.isMine && <Text style={[styles.metaText, { color: colors.accent }]}>you</Text>}
          <Pressable hitSlop={10} onPress={onMore} accessibilityLabel="More options" style={{ marginLeft: "auto" }}>
            <Text style={styles.metaText}>•••</Text>
          </Pressable>
        </View>
      </View>
      <Votes score={post.score} myVote={post.myVote} disabled={post.isMine} onVote={onVote} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    backgroundColor: colors.card,
    padding: 16,
    marginHorizontal: 12,
    marginVertical: 5,
    borderRadius: 14,
    gap: 12,
  },
  main: { flex: 1, gap: 10 },
  body: { fontSize: 17, lineHeight: 23, color: colors.text },
  meta: { flexDirection: "row", gap: 14, alignItems: "center" },
  metaText: { fontSize: 13, color: colors.muted },
});
