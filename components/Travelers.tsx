"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Check, ChevronRight, Link2, Loader2, Pencil, Plus, UserCheck, UserMinus, X } from "lucide-react";
import { useApp } from "@/lib/app-state";
import type { Trip, TripMember, TripTraveler } from "@/lib/types";
import { useI18n } from "@/lib/i18n-react";
import { cn } from "@/lib/util";
import { ErrorNote, Sheet } from "./ui";

/** Live list of who is going (the owner is implicit and not in it). */
export function useTripTravelers(tripId: string) {
  const { subscribeTravelers } = useApp();
  const [travelers, setTravelers] = useState<TripTraveler[]>([]);
  useEffect(() => subscribeTravelers(tripId, setTravelers), [tripId, subscribeTravelers]);
  return travelers;
}

/** Owner + everyone on the list (a member who is also the owner isn't counted twice). */
export const travelerCount = (trip: Trip, travelers: TripTraveler[]) => 1 + travelers.filter((t) => t.userId !== trip.ownerId).length;

function useMembers(trip: Trip) {
  const { listMembers } = useApp();
  const [members, setMembers] = useState<TripMember[]>();
  useEffect(() => {
    let live = true;
    listMembers(trip).then((m) => live && setMembers(m)).catch(() => live && setMembers([]));
    return () => { live = false; };
  }, [trip.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return members;
}

const initial = (name: string) => (name.trim().charAt(0) || "?").toUpperCase();

function Avatar({ name, virtual, className }: { name: string; virtual?: boolean; className?: string }) {
  return (
    <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ring-2 ring-white",
      virtual ? "border border-dashed border-ink-2/40 bg-surface text-ink-2" : "bg-primary-soft text-primary", className)}>
      {initial(name)}
    </span>
  );
}

/** Row on the itinerary: who's going, opens the sheet. */
export function TravelersCard({ trip, travelers, ownerName, onOpen }: { trip: Trip; travelers: TripTraveler[]; ownerName: string; onOpen: () => void }) {
  const { t } = useI18n();
  const { isOwner } = useApp();
  const n = travelerCount(trip, travelers);
  const names = [ownerName, ...travelers.filter((x) => x.userId !== trip.ownerId).map((x) => x.name)];
  return (
    <button onClick={onOpen} className="mx-5 flex w-[calc(100%-40px)] items-center gap-3 rounded-card border border-line px-4 py-3 text-left">
      <div className="flex -space-x-2">
        {names.slice(0, 4).map((name, i) => <Avatar key={i} name={name} virtual={i > 0 && !travelers.filter((x) => x.userId !== trip.ownerId)[i - 1]?.userId} />)}
        {names.length > 4 && <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface text-[11px] font-bold text-ink-2 ring-2 ring-white">+{names.length - 4}</span>}
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{t("travelers.count", { n })}</div>
        <div className="truncate text-xs text-muted">{names.join(", ")}</div>
      </div>
      <span className="flex items-center gap-0.5 text-sm font-semibold text-primary">
        {t(isOwner(trip) ? "travelers.manage" : "travelers.view")} <ChevronRight className="h-4 w-4" />
      </span>
    </button>
  );
}

export function TravelersSheet({ trip, travelers, ownerName, onClose }: { trip: Trip; travelers: TripTraveler[]; ownerName: string; onClose: () => void }) {
  const { t } = useI18n();
  const { uid, isOwner, profile, addTraveler, removeTraveler } = useApp();
  const owner = isOwner(trip);
  const members = useMembers(trip);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const list = travelers.filter((x) => x.userId !== trip.ownerId);
  const me = list.find((x) => x.userId === uid);
  const memberName = (m: TripMember) => m.displayName || m.email?.split("@")[0] || t("share.someone");
  // Members who joined the app but aren't on the list yet; pending email invites can't be added until they sign in.
  const notGoing = (members ?? []).filter((m) => m.userId && !list.some((x) => x.userId === m.userId));

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setError(undefined);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : t("common.somethingWrong")); } finally { setBusy(undefined); }
  };

  const addVirtual = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    run("virtual", async () => { await addTraveler(trip, { name: n }); setName(""); });
  };

  return (
    <Sheet title={t("travelers.title")} subtitle={t("travelers.subtitle", { n: travelerCount(trip, travelers) })} onClose={onClose}>
      <p className="text-sm text-ink-2">{t("travelers.hint")}</p>

      <div className="space-y-2">
        <TravelerRow name={trip.ownerId === uid ? `${profile.name || t("share.you")}` : ownerName} badge={t("travelers.ownerBadge")} />
        {list.map((x) => (
          <TravelerItem key={x.id} trip={trip} traveler={x} owner={owner} mine={x.userId === uid}
            members={(members ?? []).filter((m) => m.userId && !list.some((y) => y.userId === m.userId))}
            memberName={memberName} busy={busy === x.id} onBusy={(b) => setBusy(b ? x.id : undefined)} onError={setError} />
        ))}
      </div>

      {!owner && (
        me ? (
          <button disabled={!!busy} onClick={() => run("me", () => removeTraveler(me))}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-surface py-3 text-sm font-semibold text-ink-2 disabled:opacity-60">
            {busy === "me" ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserMinus className="h-4 w-4" />} {t("travelers.notGoing")}
          </button>
        ) : (
          <button disabled={!!busy} onClick={() => run("me", () => addTraveler(trip, { userId: uid, name: profile.name || "" }))}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3 text-sm font-semibold text-white disabled:opacity-60">
            {busy === "me" ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserCheck className="h-4 w-4" />} {t("travelers.imGoing")}
          </button>
        )
      )}

      {owner && notGoing.length > 0 && (
        <section className="space-y-2">
          <div className="text-[11px] font-bold tracking-widest text-ink-2 uppercase">{t("travelers.fromShared")}</div>
          {notGoing.map((m) => (
            <div key={m.id} className="flex items-center gap-3 rounded-2xl border border-line px-3.5 py-2.5">
              <Avatar name={memberName(m)} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{memberName(m)}</span>
              <button disabled={!!busy} onClick={() => run(m.id, () => addTraveler(trip, { userId: m.userId, name: memberName(m) }))}
                className="flex items-center gap-1 rounded-full bg-primary-soft px-3 py-1.5 text-xs font-semibold text-primary disabled:opacity-60">
                {busy === m.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} {t("travelers.add")}
              </button>
            </div>
          ))}
        </section>
      )}

      {owner && (
        <form onSubmit={addVirtual} className="space-y-1.5">
          <label htmlFor="virtual-name" className="text-[11px] font-bold tracking-widest text-ink-2 uppercase">{t("travelers.addVirtual")}</label>
          <div className="flex gap-2">
            <input id="virtual-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder={t("travelers.namePlaceholder")}
              className="min-w-0 flex-1 rounded-2xl bg-surface px-4 py-3 text-[15px] outline-none focus:ring-2 focus:ring-primary/30" />
            <button type="submit" disabled={!name.trim() || !!busy} className="flex items-center gap-1 rounded-2xl bg-primary px-4 text-sm font-semibold text-white disabled:opacity-60">
              {busy === "virtual" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} {t("travelers.add")}
            </button>
          </div>
          <p className="text-xs text-muted">{t("travelers.virtualHint")}</p>
        </form>
      )}

      {error && <ErrorNote>{error}</ErrorNote>}
    </Sheet>
  );
}

function TravelerRow({ name, badge, virtual, children }: { name: string; badge?: string; virtual?: boolean; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-line px-3.5 py-2.5">
      <Avatar name={name} virtual={virtual} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{name}</div>
        {badge && <div className="text-[11px] text-muted">{badge}</div>}
      </div>
      {children}
    </div>
  );
}

function TravelerItem({ trip, traveler: x, owner, mine, members, memberName, busy, onBusy, onError }: {
  trip: Trip; traveler: TripTraveler; owner: boolean; mine: boolean; members: TripMember[]; memberName: (m: TripMember) => string;
  busy: boolean; onBusy: (b: boolean) => void; onError: (e?: string) => void;
}) {
  const { t } = useI18n();
  const { renameTraveler, removeTraveler, linkTraveler } = useApp();
  const [mode, setMode] = useState<"rename" | "link">();
  const [draft, setDraft] = useState(x.name);
  const [linkTo, setLinkTo] = useState<string>("");
  const virtual = !x.userId;

  const act = async (fn: () => Promise<void>) => {
    onBusy(true); onError(undefined);
    try { await fn(); setMode(undefined); } catch (e) { onError(e instanceof Error ? e.message : t("common.somethingWrong")); } finally { onBusy(false); }
  };

  if (mode === "rename") {
    return (
      <form onSubmit={(e) => { e.preventDefault(); if (draft.trim()) act(() => renameTraveler(x, draft)); }} className="flex gap-2">
        <input autoFocus value={draft} maxLength={60} onChange={(e) => setDraft(e.target.value)} aria-label={t("travelers.rename")}
          className="min-w-0 flex-1 rounded-2xl bg-surface px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
        <button type="submit" aria-label={t("travelers.save")} disabled={busy} className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-white"><Check className="h-4 w-4" /></button>
        <button type="button" aria-label={t("common.cancel")} onClick={() => setMode(undefined)} className="flex h-10 w-10 items-center justify-center rounded-full bg-surface"><X className="h-4 w-4" /></button>
      </form>
    );
  }

  return (
    <div className="space-y-2">
      <TravelerRow name={x.name || t("share.someone")} virtual={virtual} badge={virtual ? t("travelers.virtualBadge") : mine ? t("share.you") : t("travelers.memberBadge")}>
        {busy && <Loader2 className="h-4 w-4 animate-spin text-muted" />}
        {owner && virtual && (
          <>
            <button aria-label={t("travelers.rename")} onClick={() => { setDraft(x.name); setMode("rename"); }} className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-surface hover:text-ink"><Pencil className="h-3.5 w-3.5" /></button>
            <button aria-label={t("travelers.link")} onClick={() => setMode(mode === "link" ? undefined : "link")}
              className={cn("flex h-8 w-8 items-center justify-center rounded-full hover:bg-surface", mode === "link" ? "text-primary" : "text-muted hover:text-ink")}><Link2 className="h-3.5 w-3.5" /></button>
          </>
        )}
        {(owner || mine) && (
          <button aria-label={t("travelers.remove", { name: x.name })} disabled={busy}
            onClick={() => { if (confirm(t("travelers.removeConfirm", { name: x.name }))) act(() => removeTraveler(x)); }}
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-surface hover:text-red-600"><UserMinus className="h-3.5 w-3.5" /></button>
        )}
      </TravelerRow>
      {mode === "link" && (
        <div className="space-y-2 rounded-2xl bg-primary-soft/50 p-3">
          <p className="text-xs text-ink-2">{t("travelers.linkHint", { name: x.name })}</p>
          {members.length === 0 ? <p className="text-xs font-semibold text-ink-2">{t("travelers.linkNone")}</p> : (
            <div className="flex gap-2">
              <select value={linkTo} onChange={(e) => setLinkTo(e.target.value)} aria-label={t("travelers.link")}
                className="min-w-0 flex-1 rounded-xl bg-white px-3 py-2 text-sm outline-none">
                <option value="">{t("travelers.pickMember")}</option>
                {members.map((m) => <option key={m.id} value={m.userId}>{memberName(m)}</option>)}
              </select>
              <button disabled={!linkTo || busy} onClick={() => act(() => linkTraveler(x, linkTo))}
                className="rounded-xl bg-primary px-3 text-sm font-semibold text-white disabled:opacity-60">{t("travelers.linkOk")}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

