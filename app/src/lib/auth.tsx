import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { auth } from "./api";

interface AuthState {
  ready: boolean;
  signedIn: boolean;
  signIn(token: string): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    auth.onUnauthenticated(() => setSignedIn(false));
    auth.load().then((t) => {
      setSignedIn(Boolean(t));
      setReady(true);
    });
  }, []);

  const value: AuthState = {
    ready,
    signedIn,
    async signIn(token) {
      await auth.save(token);
      setSignedIn(true);
    },
    async signOut() {
      await auth.clear();
      setSignedIn(false);
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
