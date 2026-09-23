import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { PostCard } from "../components/PostCard";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { colors } from "../lib/theme";
import { usePosts } from "../lib/usePosts";

export default function Me() {
  const { signOut } = useAuth();
  const [karma, setKarma] = useState<number | null>(null);
  const { posts, setPosts, vote, more } = usePosts();

  useEffect(() => {
    api.me().then((m) => setKarma(m.karma)).catch(() => {});
    api.myPosts().then((r) => setPosts(r.posts)).catch(() => {});
  }, [setPosts]);

  async function logout() {
    await signOut();
    router.replace("/login");
  }

  function deleteAccount() {
    Alert.alert("Delete account?", "All your posts and replies will be permanently deleted.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await api.deleteAccount();
          await logout();
        },
      },
    ]);
  }

  return (
    <FlatList
      data={posts}
      keyExtractor={(p) => p.id}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.karma}>{karma ?? "–"}</Text>
          <Text style={styles.label}>karma</Text>
          <Text style={styles.section}>Your posts</Text>
        </View>
      }
      renderItem={({ item }) => (
        <PostCard
          post={item}
          onPress={() => router.push(`/post/${item.id}`)}
          onVote={(v) => vote(item, v)}
          onMore={() => more(item)}
        />
      )}
      ListEmptyComponent={<Text style={styles.empty}>You haven't posted yet.</Text>}
      ListFooterComponent={
        <View style={styles.footer}>
          <Pressable onPress={logout}>
            <Text style={styles.link}>Sign out</Text>
          </Pressable>
          <Pressable onPress={deleteAccount}>
            <Text style={[styles.link, { color: colors.danger }]}>Delete account</Text>
          </Pressable>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  header: { alignItems: "center", paddingVertical: 24 },
  karma: { fontSize: 56, fontWeight: "800", color: colors.accent },
  label: { color: colors.muted, fontSize: 15 },
  section: { alignSelf: "flex-start", marginLeft: 16, marginTop: 28, fontWeight: "700", color: colors.text, fontSize: 16 },
  empty: { textAlign: "center", color: colors.muted, marginTop: 20 },
  footer: { alignItems: "center", gap: 18, paddingVertical: 40 },
  link: { color: colors.muted, fontSize: 15 },
});
