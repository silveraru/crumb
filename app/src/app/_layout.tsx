import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AuthProvider } from "../lib/auth";
import { colors } from "../lib/theme";

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerShadowVisible: false,
          headerTintColor: colors.text,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="feed" options={{ title: "Crumb", headerBackVisible: false }} />
        <Stack.Screen name="compose" options={{ presentation: "modal", title: "New post" }} />
        <Stack.Screen name="post/[id]" options={{ title: "" }} />
        <Stack.Screen name="me" options={{ title: "You" }} />
      </Stack>
    </AuthProvider>
  );
}
