import { router } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { locationHeader } from "../lib/location";
import { colors } from "../lib/theme";

/** Accepts "+1 (415) 555-1234" style input and returns E.164, defaulting to +1 when no country code is given. */
function normalizePhone(input: string): string {
  const digits = input.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  return digits.length === 10 ? `+1${digits}` : `+${digits}`;
}

export default function Login() {
  const { signIn } = useAuth();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const sendCode = () =>
    run(async () => {
      await api.startAuth(normalizePhone(phone));
      setStep("code");
    });

  const verify = () =>
    run(async () => {
      const { token } = await api.verifyAuth(normalizePhone(phone), code);
      await signIn(token);
      // Ask for location up front so the feed doesn't open on a permission prompt.
      await locationHeader(true);
      router.replace("/feed");
    });

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.wrap}>
        <Text style={styles.logo}>crumb</Text>
        <Text style={styles.tagline}>Anonymous. Local. Just what's around you.</Text>

        {step === "phone" ? (
          <>
            <TextInput
              style={styles.input}
              placeholder="Phone number"
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              value={phone}
              onChangeText={setPhone}
            />
            <Text style={styles.fine}>
              We only use your number to keep out spam and bots. It's never shown to anyone, and your posts
              can't be traced back to it.
            </Text>
          </>
        ) : (
          <>
            <TextInput
              style={styles.input}
              placeholder="6-digit code"
              keyboardType="number-pad"
              autoComplete="sms-otp"
              textContentType="oneTimeCode"
              maxLength={8}
              value={code}
              onChangeText={setCode}
              autoFocus
            />
            <Pressable onPress={() => setStep("phone")}>
              <Text style={styles.link}>Use a different number</Text>
            </Pressable>
          </>
        )}

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable
          style={[styles.button, busy && { opacity: 0.6 }]}
          disabled={busy}
          onPress={step === "phone" ? sendCode : verify}
        >
          {busy ? <ActivityIndicator color="#fff" /> : (
            <Text style={styles.buttonText}>{step === "phone" ? "Send code" : "Verify"}</Text>
          )}
        </Pressable>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  wrap: { flex: 1, justifyContent: "center", padding: 28, gap: 14 },
  logo: { fontSize: 48, fontWeight: "800", color: colors.accent, letterSpacing: -1 },
  tagline: { fontSize: 16, color: colors.muted, marginBottom: 20 },
  input: {
    backgroundColor: colors.card, borderRadius: 12, padding: 16, fontSize: 18,
    borderWidth: 1, borderColor: colors.border, color: colors.text,
  },
  fine: { fontSize: 13, color: colors.muted, lineHeight: 18 },
  link: { color: colors.accent, fontSize: 14 },
  error: { color: colors.danger, fontSize: 14 },
  button: { backgroundColor: colors.accent, borderRadius: 12, padding: 16, alignItems: "center", marginTop: 8 },
  buttonText: { color: "#fff", fontSize: 17, fontWeight: "700" },
});
