"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  browserLocalPersistence, browserSessionPersistence, createUserWithEmailAndPassword, GoogleAuthProvider, onAuthStateChanged,
  sendPasswordResetEmail, setPersistence, signInWithEmailAndPassword, signInWithPopup, signOut as fbSignOut, updateProfile, type User,
} from "firebase/auth";
import { firebaseAuth } from "./firebase";

type Status = "loading" | "signedOut" | "syncing" | "signedIn";

interface AuthContextValue {
  status: Status;
  user: User | null;
  error?: string;
  signIn: (email: string, password: string, remember: boolean) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Firebase ID token for our own API routes. */
  idToken: () => Promise<string>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Gives the Firebase user the Supabase role claim and mirrors them into `profiles`. */
async function syncToSupabase(user: User) {
  const res = await fetch("/api/auth/sync", { method: "POST", headers: { Authorization: `Bearer ${await user.getIdToken()}` } });
  const data = (await res.json().catch(() => ({}))) as { refreshToken?: boolean; error?: string };
  if (!res.ok) throw new Error(data.error ?? `Sync failed (HTTP ${res.status})`);
  if (data.refreshToken) await user.getIdToken(true); // pick up the new `role` claim
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => onAuthStateChanged(firebaseAuth(), async (u) => {
    setUser(u);
    if (!u) { setStatus("signedOut"); return; }
    setStatus("syncing");
    try {
      await syncToSupabase(u);
      setError(undefined);
      setStatus("signedIn");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not sign in");
      await fbSignOut(firebaseAuth());
    }
  }), []);

  const value = useMemo<AuthContextValue>(() => ({
    status, user, error,
    signIn: async (email, password, remember) => {
      const auth = firebaseAuth();
      await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
      await signInWithEmailAndPassword(auth, email, password);
    },
    signUp: async (name, email, password) => {
      const { user: u } = await createUserWithEmailAndPassword(firebaseAuth(), email, password);
      if (name.trim()) await updateProfile(u, { displayName: name.trim() });
    },
    signInWithGoogle: async () => { await signInWithPopup(firebaseAuth(), new GoogleAuthProvider()); },
    resetPassword: (email) => sendPasswordResetEmail(firebaseAuth(), email),
    signOut: () => fbSignOut(firebaseAuth()),
    idToken: async () => {
      const current = firebaseAuth().currentUser;
      if (!current) throw new Error("Not signed in");
      return current.getIdToken();
    },
  }), [status, user, error]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
