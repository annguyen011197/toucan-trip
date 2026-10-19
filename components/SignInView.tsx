"use client";

import { useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from "react";
import { FirebaseError } from "firebase/app";
import { Compass, Eye, EyeOff, Loader2, Lock, Mail, PlaneTakeoff, User } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { PrimaryButton } from "./ui";
import { cn } from "@/lib/util";

type Mode = "signIn" | "signUp";

const ERRORS: Record<string, string> = {
  "auth/invalid-credential": "That email and password don't match.",
  "auth/invalid-email": "Please enter a valid email address.",
  "auth/email-already-in-use": "An account with this email already exists — try signing in.",
  "auth/weak-password": "Use at least 6 characters for your password.",
  "auth/too-many-requests": "Too many attempts. Please wait a moment and try again.",
  "auth/popup-closed-by-user": "",
  "auth/cancelled-popup-request": "",
};

const message = (e: unknown) =>
  e instanceof FirebaseError ? (ERRORS[e.code] ?? e.message) : e instanceof Error ? e.message : "Something went wrong.";

export function SignInView() {
  const auth = useAuth();
  const [mode, setMode] = useState<Mode>("signIn");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const syncing = auth.status === "syncing";

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(undefined); setNotice(undefined);
    try { await fn(); } catch (e) { setError(message(e) || undefined); } finally { setBusy(false); }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(() => (mode === "signIn" ? auth.signIn(email.trim(), password, remember) : auth.signUp(name, email.trim(), password)));
  };

  const forgot = () => {
    if (!email.trim()) { setError("Enter your email address first."); return; }
    run(async () => { await auth.resetPassword(email.trim()); setNotice("Check your inbox for a password reset link."); });
  };

  const shownError = error ?? auth.error;

  return (
    <div className="mx-auto min-h-dvh max-w-[480px] bg-bg px-6 pt-[max(16px,env(safe-area-inset-top))] pb-10">
      <div className="flex items-center gap-2 py-3 text-sm">
        <span className="font-bold tracking-widest text-ink-2 uppercase">Toucan</span>
        <span className="h-1 w-1 rounded-full bg-muted" />
        <span className="font-semibold">{mode === "signIn" ? "Sign In" : "Sign Up"}</span>
      </div>

      <section className="mt-2 flex items-center gap-3 rounded-card bg-white p-5 shadow-card">
        <img src="/mascot.webp" alt="" className="h-28 w-28 shrink-0 object-contain" />
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#ffe1cf] px-3 py-1.5 text-[11px] font-bold tracking-widest text-tertiary uppercase">
            <Compass className="h-3.5 w-3.5" /> Ready for departure
          </span>
          <h1 className="mt-2 text-2xl font-bold">{mode === "signIn" ? "Welcome back!" : "Join the flock!"}</h1>
          <p className="mt-1 text-sm text-ink-2">Your cheerful travel companion is ready to plan your next journey.</p>
        </div>
      </section>

      <form onSubmit={submit} className="mt-7 space-y-5">
        {mode === "signUp" && (
          <Field label="Your name" icon={<User className="h-5 w-5" />}>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Alex" />
          </Field>
        )}
        <Field label="Email address" icon={<Mail className="h-5 w-5" />}>
          <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" />
        </Field>
        <Field label="Password" icon={<Lock className="h-5 w-5" />}
          trailing={
            <button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((s) => !s)} className="text-ink-2">
              {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
          }>
          <Input type={showPassword ? "text" : "password"} required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "signIn" ? "current-password" : "new-password"} placeholder="••••••••" />
        </Field>

        {mode === "signIn" && (
          <div className="flex items-center justify-between text-sm">
            <label className="flex items-center gap-2 text-ink-2">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 accent-cta" /> Remember me
            </label>
            <button type="button" onClick={forgot} className="font-semibold text-cta">Forgot password?</button>
          </div>
        )}

        {shownError && <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{shownError}</p>}
        {notice && <p role="status" className="rounded-2xl bg-primary-soft px-4 py-3 text-sm text-cta">{notice}</p>}

        <PrimaryButton type="submit" disabled={busy || syncing}>
          {busy || syncing ? <Loader2 className="h-5 w-5 animate-spin" /> : <>{mode === "signIn" ? "Sign In" : "Create account"} <PlaneTakeoff className="h-5 w-5" /></>}
        </PrimaryButton>
      </form>

      <div className="my-7 flex items-center gap-4 text-xs font-semibold tracking-widest text-muted uppercase">
        <span className="h-px flex-1 bg-line" /> Or continue with <span className="h-px flex-1 bg-line" />
      </div>

      <button type="button" disabled={busy || syncing} onClick={() => run(auth.signInWithGoogle)}
        className="flex w-full items-center justify-center gap-3 rounded-full bg-white py-4 font-semibold shadow-card transition active:scale-[0.98] disabled:opacity-60">
        <GoogleLogo /> Continue with Google
      </button>

      <p className="mt-8 text-center text-sm text-ink-2">
        {mode === "signIn" ? "Don't have an account?" : "Already have an account?"}{" "}
        <button type="button" className="font-semibold text-cta"
          onClick={() => { setMode(mode === "signIn" ? "signUp" : "signIn"); setError(undefined); setNotice(undefined); }}>
          {mode === "signIn" ? "Sign up" : "Sign in"}
        </button>
      </p>
    </div>
  );
}

function Field({ label, icon, trailing, children }: { label: string; icon: ReactNode; trailing?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-ink-2">{label}</span>
      <div className="mt-2 flex items-center gap-3 rounded-2xl bg-primary-soft/70 px-4 py-3.5 text-ink-2 focus-within:ring-2 focus-within:ring-primary/40">
        {icon}
        {children}
        {trailing}
      </div>
    </label>
  );
}

function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn("min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-muted", className)} />;
}

function GoogleLogo() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
