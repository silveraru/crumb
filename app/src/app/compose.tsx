import { router, Stack } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { api } from "../lib/api";
import { colors } from "../lib/theme";

const MAX = 200;

export default function Compose() {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = body.trim();

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.createPost(trimmed);
      router.back();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable onPress={submit} disabled={busy || !trimmed} hitSlop={10}>
              <Text style={[styles.post, (busy || !trimmed) && { opacity: 0.4 }]}>Post</Text>
            </Pressable>
          ),
        }}
      />
      <TextInput
        style={styles.input}
        placeholder="What's happening nearby?"
        placeholderTextColor={colors.muted}
        multiline
        autoFocus
        maxLength={MAX}
        value={body}
        onChangeText={setBody}
      />
      <Text style={styles.count}>{MAX - body.length}</Text>
      {error && <Text style={styles.error}>{error}</Text>}
      <Text style={styles.fine}>Posts are anonymous and visible to people within about 5 miles.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16, gap: 10 },
  post: { color: colors.accent, fontSize: 17, fontWeight: "700" },
  input: {
    backgroundColor: colors.card, borderRadius: 14, padding: 16, fontSize: 18, minHeight: 140,
    textAlignVertical: "top", color: colors.text,
  },
  count: { alignSelf: "flex-end", color: colors.muted },
  error: { color: colors.danger },
  fine: { color: colors.muted, fontSize: 13 },
});
