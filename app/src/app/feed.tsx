import { router, Stack, useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { PostCard } from "../components/PostCard";
import { api } from "../lib/api";
import { colors } from "../lib/theme";
import { usePosts } from "../lib/usePosts";

type Sort = "new" | "hot";

export default function Feed() {
  const [sort, setSort] = useState<Sort>("new");
  const { posts, setPosts, vote, more } = usePosts();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [karma, setKarma] = useState<number | null>(null);
  const done = useRef(false);

  const load = useCallback(
    async (s: Sort, append = false) => {
      if (append && done.current) return;
      setLoading(true);
      setError(null);
      try {
        const last = append ? posts[posts.length - 1] : undefined;
        const cursor = !append ? undefined : s === "new" ? { before: last?.createdAt } : { offset: posts.length };
        const { posts: page } = await api.feed(s, cursor);
        done.current = page.length < 50;
        setPosts((prev) => (append ? [...prev, ...page] : page));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [posts, setPosts],
  );

  // Refresh whenever the screen regains focus (e.g. after posting).
  useFocusEffect(
    useCallback(() => {
      void load(sort);
      api.me().then((m) => setKarma(m.karma)).catch(() => {});
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sort]),
  );

  return (
    <View style={styles.flex}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable onPress={() => router.push("/me")} hitSlop={10}>
              <Text style={styles.karma}>{karma ?? "·"} ★</Text>
            </Pressable>
          ),
        }}
      />
      <View style={styles.tabs}>
        {(["new", "hot"] as const).map((s) => (
          <Pressable key={s} onPress={() => setSort(s)} style={[styles.tab, sort === s && styles.tabOn]}>
            <Text style={[styles.tabText, sort === s && styles.tabTextOn]}>{s === "new" ? "New" : "Hot"}</Text>
          </Pressable>
        ))}
      </View>

      <FlatList
        data={posts}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => (
          <PostCard
            post={item}
            onPress={() => router.push(`/post/${item.id}`)}
            onVote={(v) => vote(item, v)}
            onMore={() => more(item)}
          />
        )}
        refreshControl={<RefreshControl refreshing={loading && posts.length === 0} onRefresh={() => load(sort)} />}
        onEndReached={() => posts.length > 0 && !loading && load(sort, true)}
        onEndReachedThreshold={0.5}
        contentContainerStyle={{ paddingBottom: 100 }}
        ListEmptyComponent={
          !loading ? (
            <Text style={styles.empty}>{error ?? "It's quiet around here. Say something."}</Text>
          ) : null
        }
      />

      <Pressable style={styles.fab} onPress={() => router.push("/compose")} accessibilityLabel="New post">
        <Text style={styles.fabText}>＋</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  karma: { fontSize: 16, fontWeight: "700", color: colors.accent },
  tabs: { flexDirection: "row", marginHorizontal: 12, marginBottom: 6, gap: 8 },
  tab: { paddingVertical: 8, paddingHorizontal: 18, borderRadius: 20, backgroundColor: colors.card },
  tabOn: { backgroundColor: colors.text },
  tabText: { fontSize: 15, fontWeight: "600", color: colors.muted },
  tabTextOn: { color: "#fff" },
  empty: { textAlign: "center", color: colors.muted, marginTop: 80, paddingHorizontal: 40, fontSize: 16 },
  fab: {
    position: "absolute", right: 20, bottom: 36, width: 60, height: 60, borderRadius: 30,
    backgroundColor: colors.accent, alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 5,
  },
  fabText: { color: "#fff", fontSize: 30, marginTop: -2 },
});
