"use client";

import { useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from "react";
import { FirebaseError } from "firebase/app";
import { Compass, Eye, EyeOff, Loader2, Lock, Mail, PlaneTakeoff, User } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { PrimaryButton } from "./ui";
import { cn } from "@/lib/util";
import { useI18n } from "@/lib/i18n-react";
import { LANGS, type MessageKey, type Translate } from "@/lib/i18n";

type Mode = "signIn" | "signUp";

const ERRORS: Record<string, MessageKey | ""> = {
  "auth/invalid-credential": "auth.err.invalid-credential",
  "auth/invalid-email": "auth.err.invalid-email",
  "auth/email-already-in-use": "auth.err.email-already-in-use",
  "auth/weak-password": "auth.err.weak-password",
  "auth/too-many-requests": "auth.err.too-many-requests",
  "auth/popup-closed-by-user": "",
  "auth/cancelled-popup-request": "",
};

const message = (e: unknown, t: Translate) => {
  if (e instanceof FirebaseError) {
    const key = ERRORS[e.code];
    return key === undefined ? e.message : key && t(key);
  }
  return e instanceof Error ? e.message : t("common.somethingWrong");
};

export function SignInView() {
  const auth = useAuth();
  const { t, lang, setLang } = useI18n();
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
    try { await fn(); } catch (e) { setError(message(e, t) || undefined); } finally { setBusy(false); }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(() => (mode === "signIn" ? auth.signIn(email.trim(), password, remember) : auth.signUp(name, email.trim(), password)));
  };

  const forgot = () => {
    if (!email.trim()) { setError(t("auth.enterEmail")); return; }
    run(async () => { await auth.resetPassword(email.trim()); setNotice(t("auth.resetSent")); });
  };

  const shownError = error ?? auth.error;

  return (
    <div className="mx-auto min-h-dvh max-w-[480px] bg-bg px-6 pt-[max(16px,env(safe-area-inset-top))] pb-10">
      <div className="flex items-center gap-2 py-3 text-sm">
        <span className="font-bold tracking-widest text-ink-2 uppercase">Toucan</span>
        <span className="h-1 w-1 rounded-full bg-muted" />
        <span className="font-semibold">{mode === "signIn" ? t("auth.signIn") : t("auth.signUp")}</span>
        <span className="flex-1" />
        <div className="flex rounded-full bg-white p-0.5 shadow-card" role="group" aria-label={t("profile.language")}>
          {LANGS.map((l) => (
            <button key={l} type="button" onClick={() => setLang(l)} aria-pressed={l === lang}
              className={cn("rounded-full px-2.5 py-1 text-xs font-bold uppercase transition", l === lang ? "bg-primary text-white" : "text-ink-2")}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <section className="mt-2 flex items-center gap-3 rounded-card bg-white p-5 shadow-card">
        <img src="/mascot.webp" alt="" className="h-28 w-28 shrink-0 object-contain" />
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#ffe1cf] px-3 py-1.5 text-[11px] font-bold tracking-widest text-tertiary uppercase">
            <Compass className="h-3.5 w-3.5" /> {t("auth.ready")}
          </span>
          <h1 className="mt-2 text-2xl font-bold">{mode === "signIn" ? t("auth.welcomeBack") : t("auth.join")}</h1>
          <p className="mt-1 text-sm text-ink-2">{t("auth.tagline")}</p>
        </div>
      </section>

      <form onSubmit={submit} className="mt-7 space-y-5">
        {mode === "signUp" && (
          <Field label={t("auth.name")} icon={<User className="h-5 w-5" />}>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Alex" />
          </Field>
        )}
        <Field label={t("auth.email")} icon={<Mail className="h-5 w-5" />}>
          <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" />
        </Field>
        <Field label={t("auth.password")} icon={<Lock className="h-5 w-5" />}
          trailing={
            <button type="button" aria-label={showPassword ? t("auth.hidePassword") : t("auth.showPassword")} onClick={() => setShowPassword((s) => !s)} className="text-ink-2">
              {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
          }>
          <Input type={showPassword ? "text" : "password"} required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "signIn" ? "current-password" : "new-password"} placeholder="••••••••" />
        </Field>

        {mode === "signIn" && (
          <div className="flex items-center justify-between text-sm">
            <label className="flex items-center gap-2 text-ink-2">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 accent-cta" /> {t("auth.remember")}
            </label>
            <button type="button" onClick={forgot} className="font-semibold text-cta">{t("auth.forgot")}</button>
          </div>
        )}

        {shownError && <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{shownError}</p>}
        {notice && <p role="status" className="rounded-2xl bg-primary-soft px-4 py-3 text-sm text-cta">{notice}</p>}

        <PrimaryButton type="submit" disabled={busy || syncing}>
          {busy || syncing ? <Loader2 className="h-5 w-5 animate-spin" /> : <>{mode === "signIn" ? t("auth.signIn") : t("auth.create")} <PlaneTakeoff className="h-5 w-5" /></>}
        </PrimaryButton>
      </form>

      <div className="my-7 flex items-center gap-4 text-xs font-semibold tracking-widest text-muted uppercase">
        <span className="h-px flex-1 bg-line" /> {t("auth.orContinue")} <span className="h-px flex-1 bg-line" />
      </div>

      <button type="button" disabled={busy || syncing} onClick={() => run(auth.signInWithGoogle)}
        className="flex w-full items-center justify-center gap-3 rounded-full bg-white py-4 font-semibold shadow-card transition active:scale-[0.98] disabled:opacity-60">
        <GoogleLogo /> {t("auth.google")}
      </button>

      <p className="mt-8 text-center text-sm text-ink-2">
        {mode === "signIn" ? t("auth.noAccount") : t("auth.haveAccount")}{" "}
        <button type="button" className="font-semibold text-cta"
          onClick={() => { setMode(mode === "signIn" ? "signUp" : "signIn"); setError(undefined); setNotice(undefined); }}>
          {mode === "signIn" ? t("auth.signUpLink") : t("auth.signInLink")}
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
