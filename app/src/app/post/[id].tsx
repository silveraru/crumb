import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PostCard } from "../../components/PostCard";
import { Votes } from "../../components/Votes";
import { showContentActions } from "../../lib/actions";
import { api, type Comment, type Post } from "../../lib/api";
import { colors } from "../../lib/theme";
import { timeAgo } from "../../lib/time";

export default function Thread() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [post, setPost] = useState<Post | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const t = await api.thread(id);
      setPost(t.post);
      setComments(t.comments);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function votePost(value: -1 | 0 | 1) {
    if (!post) return;
    const prev = post;
    setPost({ ...post, score: post.score - (post.myVote ?? 0) + value, myVote: value || null });
    try {
      setPost({ ...prev, ...(await api.votePost(prev.id, value)) });
    } catch (e) {
      setPost(prev);
      Alert.alert("Couldn't vote", (e as Error).message);
    }
  }

  async function voteComment(c: Comment, value: -1 | 0 | 1) {
    const set = (p: Partial<Comment>) => setComments((cs) => cs.map((x) => (x.id === c.id ? { ...x, ...p } : x)));
    set({ score: c.score - (c.myVote ?? 0) + value, myVote: value || null });
    try {
      set(await api.voteComment(c.id, value));
    } catch (e) {
      set({ score: c.score, myVote: c.myVote });
      Alert.alert("Couldn't vote", (e as Error).message);
    }
  }

  async function send() {
    const body = reply.trim();
    if (!body || !post) return;
    setSending(true);
    try {
      const { comment } = await api.comment(post.id, body);
      setComments((cs) => [...cs, comment]);
      setPost({ ...post, commentCount: post.commentCount + 1 });
      setReply("");
    } catch (e) {
      Alert.alert("Couldn't reply", (e as Error).message);
    } finally {
      setSending(false);
    }
  }

  if (error) return <Text style={styles.empty}>{error}</Text>;
  if (!post) return null;

  return (
    <SafeAreaView style={styles.flex} edges={["bottom"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={90}
      >
        <FlatList
          data={comments}
          keyExtractor={(c) => c.id}
          ListHeaderComponent={
            <PostCard
              post={post}
              onVote={votePost}
              onMore={() =>
                showContentActions({
                  isMine: post.isMine,
                  onDelete: async () => {
                    await api.deletePost(post.id);
                    router.back();
                  },
                  onReport: async (reason) => {
                    await api.reportPost(post.id, reason);
                    router.back();
                  },
                })
              }
            />
          }
          renderItem={({ item }) => (
            <View style={styles.comment}>
              <View style={styles.flex}>
                <Text style={styles.body}>{item.body}</Text>
                <View style={styles.meta}>
                  {item.isOp && <Text style={styles.op}>OP</Text>}
                  <Text style={styles.metaText}>{timeAgo(item.createdAt)}</Text>
                  {item.isMine && <Text style={[styles.metaText, { color: colors.accent }]}>you</Text>}
                  <Pressable
                    hitSlop={10}
                    style={{ marginLeft: "auto" }}
                    onPress={() =>
                      showContentActions({
                        isMine: item.isMine,
                        onDelete: async () => {
                          await api.deleteComment(item.id);
                          setComments((cs) => cs.filter((x) => x.id !== item.id));
                        },
                        onReport: async (reason) => {
                          await api.reportComment(item.id, reason);
                          setComments((cs) => cs.filter((x) => x.id !== item.id));
                        },
                      })
                    }
                  >
                    <Text style={styles.metaText}>•••</Text>
                  </Pressable>
                </View>
              </View>
              <Votes score={item.score} myVote={item.myVote} disabled={item.isMine} onVote={(v) => voteComment(item, v)} />
            </View>
          )}
          ListEmptyComponent={<Text style={styles.empty}>No replies yet.</Text>}
        />
        <View style={styles.replyBar}>
          <TextInput
            style={styles.replyInput}
            placeholder="Reply anonymously"
            placeholderTextColor={colors.muted}
            value={reply}
            onChangeText={setReply}
            maxLength={200}
            multiline
          />
          <Pressable onPress={send} disabled={sending || !reply.trim()} hitSlop={8}>
            <Text style={[styles.send, (sending || !reply.trim()) && { opacity: 0.4 }]}>Send</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  comment: {
    flexDirection: "row", gap: 12, paddingVertical: 12, paddingHorizontal: 16, marginHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  body: { fontSize: 16, lineHeight: 22, color: colors.text },
  meta: { flexDirection: "row", gap: 12, marginTop: 8, alignItems: "center" },
  metaText: { fontSize: 13, color: colors.muted },
  op: { fontSize: 12, fontWeight: "800", color: "#fff", backgroundColor: colors.accent, paddingHorizontal: 6, borderRadius: 4, overflow: "hidden" },
  empty: { textAlign: "center", color: colors.muted, marginTop: 30 },
  replyBar: {
    flexDirection: "row", alignItems: "center", gap: 10, padding: 12, backgroundColor: colors.card,
    borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  replyInput: { flex: 1, fontSize: 16, maxHeight: 100, color: colors.text },
  send: { color: colors.accent, fontWeight: "700", fontSize: 16 },
});
