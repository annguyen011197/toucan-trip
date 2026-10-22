"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Check, Copy, ExternalLink, Globe, Link2, Loader2, Mail, RefreshCw, Send, UserMinus } from "lucide-react";
import { useApp } from "@/lib/app-state";
import type { Trip, TripMember } from "@/lib/types";
import { useI18n } from "@/lib/i18n-react";
import { cn } from "@/lib/util";
import { ErrorNote, Sheet } from "./ui";
import { shareTrip } from "./ChatView";

/** Owner: invite people by email, turn the share link on/off, and see who has access. */
export function ShareSheet({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const { listMembers, inviteMember, removeMember, getShareLink, resetShareLink, getPublicLink, setPublicLink, profile } = useApp();
  const { t, lang } = useI18n();
  const [members, setMembers] = useState<TripMember[]>();
  const [link, setLink] = useState<string | null>(); // undefined: loading, null: off
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<"invite" | "link" | string>(); // string: member id being removed
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<{ text: string; email?: string }>();
  const [copied, setCopied] = useState<string>();
  const [pub, setPub] = useState<{ url: string; showExpenses: boolean } | null>(); // undefined: loading, null: off

  useEffect(() => {
    listMembers(trip).then(setMembers).catch((e) => { setMembers([]); setError(String(e?.message ?? e)); });
    getShareLink(trip).then((l) => setLink(l ?? null)).catch(() => setLink(null));
    getPublicLink(trip).then((p) => setPub(p ?? null)).catch(() => setPub(null));
  }, [trip.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (kind: string, fn: () => Promise<void>) => {
    setBusy(kind); setError(undefined);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : t("common.somethingWrong")); } finally { setBusy(undefined); }
  };

  const invite = (e: FormEvent) => {
    e.preventDefault();
    const address = email.trim();
    if (!address) return;
    run("invite", async () => {
      const { member, existing } = await inviteMember(trip, address);
      setMembers((list) => [...(list ?? []).filter((m) => m.id !== member.id), member]);
      setEmail("");
      setNotice(existing ? { text: t("share.alreadyMember", { email: address }) }
        : member.userId ? { text: t("share.added", { name: member.displayName || address }), email: address }
        : { text: t("share.pending", { email: address }), email: address });
    });
  };

  const toggleLink = (on: boolean) => run("link", async () => { setLink((await resetShareLink(trip, on)) ?? null); });

  const copy = async (url?: string) => {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); setCopied(url); setTimeout(() => setCopied(undefined), 1500); } catch { /* ignore */ }
  };

  const updatePublic = (opts: { enabled: boolean; showExpenses: boolean; reset?: boolean }) =>
    run("public", async () => { setPub((await setPublicLink(trip, opts)) ?? null); });

  // No email service yet: the owner's mail app sends the heads-up.
  const mailto = (to: string) => {
    const subject = t("share.mailSubject", { title: trip.title });
    const body = t("share.mailBody", { name: profile.name || "", title: trip.title, url: link ?? window.location.origin });
    return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  return (
    <Sheet title={t("share.title")} subtitle={trip.title} onClose={onClose}>
      {/* Invite by email */}
      <form onSubmit={invite} className="space-y-2">
        <label htmlFor="invite-email" className="text-xs font-bold tracking-widest text-ink-2 uppercase">{t("share.inviteLabel")}</label>
        <div className="flex gap-2">
          <input id="invite-email" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder={t("share.emailPlaceholder")}
            className="min-w-0 flex-1 rounded-full bg-surface px-4 py-3 text-[15px] outline-none focus:ring-2 focus:ring-primary/30" />
          <button type="submit" disabled={busy === "invite" || !email.trim()}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 font-semibold text-white disabled:opacity-60">
            {busy === "invite" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {t("share.invite")}
          </button>
        </div>
        <p className="text-xs text-muted">{t("share.inviteHint")}</p>
      </form>

      {notice && (
        <div className="space-y-2 rounded-2xl bg-primary-soft/60 p-3.5 text-sm text-ink-2">
          <p>{notice.text}</p>
          {notice.email && (
            <a href={mailto(notice.email)} className="inline-flex items-center gap-1.5 font-semibold text-primary">
              <Mail className="h-4 w-4" /> {t("share.notify")}
            </a>
          )}
        </div>
      )}

      {/* Share link */}
      <div className="space-y-2.5 rounded-2xl border border-line p-3.5">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary"><Link2 className="h-4 w-4" /></span>
          <div className="min-w-0 flex-1">
            <div className="font-semibold">{t("share.link")}</div>
            <div className="text-xs text-ink-2">{t(link ? "share.linkOn" : "share.linkOff")}</div>
          </div>
          <button role="switch" aria-checked={!!link} aria-label={t("share.link")} disabled={link === undefined || busy === "link"}
            onClick={() => toggleLink(!link)}
            className={cn("relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-60", link ? "bg-primary" : "bg-line")}>
            <span className={cn("absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all", link ? "left-[22px]" : "left-0.5")} />
          </button>
        </div>
        {link && (
          <>
            <div className="flex items-center gap-2">
              <input readOnly value={link} aria-label={t("share.link")} onFocus={(e) => e.target.select()}
                className="min-w-0 flex-1 truncate rounded-full bg-surface px-3.5 py-2.5 text-[13px] text-ink-2 outline-none" />
              <button onClick={() => copy(link)} className="flex shrink-0 items-center gap-1.5 rounded-full bg-primary-soft px-3.5 py-2.5 text-sm font-semibold text-primary">
                {copied === link ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {t(copied === link ? "share.copiedShort" : "share.copy")}
              </button>
            </div>
            <button onClick={() => toggleLink(true)} disabled={busy === "link"}
              className="flex items-center gap-1.5 text-xs font-semibold text-ink-2 disabled:opacity-60">
              <RefreshCw className={cn("h-3.5 w-3.5", busy === "link" && "animate-spin")} /> {t("share.resetLink")}
            </button>
          </>
        )}
      </div>

      {/* Public read-only page */}
      <div className="space-y-2.5 rounded-2xl border border-line p-3.5">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700"><Globe className="h-4 w-4" /></span>
          <div className="min-w-0 flex-1">
            <div className="font-semibold">{t("share.public")}</div>
            <div className="text-xs text-ink-2">{t(pub ? "share.publicOn" : "share.publicOff")}</div>
          </div>
          <button role="switch" aria-checked={!!pub} aria-label={t("share.public")} disabled={pub === undefined || busy === "public"}
            onClick={() => updatePublic({ enabled: !pub, showExpenses: pub?.showExpenses ?? true })}
            className={cn("relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-60", pub ? "bg-emerald-600" : "bg-line")}>
            <span className={cn("absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all", pub ? "left-[22px]" : "left-0.5")} />
          </button>
        </div>
        {pub && (
          <>
            <div className="flex items-center gap-2">
              <input readOnly value={pub.url} aria-label={t("share.public")} onFocus={(e) => e.target.select()}
                className="min-w-0 flex-1 truncate rounded-full bg-surface px-3.5 py-2.5 text-[13px] text-ink-2 outline-none" />
              <button onClick={() => copy(pub.url)} className="flex shrink-0 items-center gap-1.5 rounded-full bg-primary-soft px-3.5 py-2.5 text-sm font-semibold text-primary">
                {copied === pub.url ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {t(copied === pub.url ? "share.copiedShort" : "share.copy")}
              </button>
              <a href={pub.url} target="_blank" rel="noopener noreferrer" aria-label={t("share.open")}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface text-ink-2"><ExternalLink className="h-4 w-4" /></a>
            </div>
            <label className="flex items-center gap-2.5 text-sm">
              <input type="checkbox" checked={pub.showExpenses} disabled={busy === "public"} className="h-4 w-4"
                onChange={(e) => updatePublic({ enabled: true, showExpenses: e.target.checked })} />
              {t("share.publicExpenses")}
            </label>
            <p className="text-xs text-muted">{t("share.publicHint")}</p>
            <button onClick={() => updatePublic({ enabled: true, showExpenses: pub.showExpenses, reset: true })} disabled={busy === "public"}
              className="flex items-center gap-1.5 text-xs font-semibold text-ink-2 disabled:opacity-60">
              <RefreshCw className={cn("h-3.5 w-3.5", busy === "public" && "animate-spin")} /> {t("share.resetLink")}
            </button>
          </>
        )}
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      {/* People with access */}
      <div className="space-y-1">
        <div className="text-xs font-bold tracking-widest text-ink-2 uppercase">{t("share.people")}</div>
        <PersonRow name={profile.name || t("share.you")} detail={t("share.owner")} />
        {members === undefined && <div className="flex justify-center py-3"><Loader2 className="h-5 w-5 animate-spin text-muted" /></div>}
        {members?.map((m) => (
          <PersonRow key={m.id} name={m.displayName || m.email || t("share.someone")}
            detail={[m.displayName && m.email, m.userId ? t("share.canComment") : t("share.invited")].filter(Boolean).join(" · ")}
            action={
              <button aria-label={t("share.removePerson", { name: m.displayName || m.email || "" })} disabled={busy === m.id}
                onClick={() => run(m.id, async () => { await removeMember(m); setMembers((list) => list?.filter((x) => x.id !== m.id)); })}
                className="flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-surface hover:text-red-600 disabled:opacity-60">
                {busy === m.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserMinus className="h-4 w-4" />}
              </button>
            } />
        ))}
        {members?.length === 0 && <p className="py-1 text-sm text-muted">{t("share.nobody")}</p>}
      </div>

      <button onClick={() => shareTrip(trip, lang)} className="w-full py-1 text-sm font-semibold text-ink-2">{t("share.asText")}</button>
    </Sheet>
  );
}

function PersonRow({ name, detail, action }: { name: string; detail: string; action?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-sm font-bold text-ink-2 uppercase">{name.charAt(0)}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-semibold">{name}</div>
        <div className="truncate text-xs text-ink-2">{detail}</div>
      </div>
      {action}
    </div>
  );
}
