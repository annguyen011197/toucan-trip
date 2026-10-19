"use client";

import { useEffect, useState, type ButtonHTMLAttributes, type FormEvent } from "react";
import { Check, Loader2, RotateCcw, Send, Trash2, WandSparkles, X } from "lucide-react";
import { useApp } from "@/lib/app-state";
import type { CommentStatus, ItineraryItem, Trip, TripComment } from "@/lib/types";
import { useI18n } from "@/lib/i18n-react";
import { LOCALE } from "@/lib/i18n";
import { cn } from "@/lib/util";
import { ErrorNote, PrimaryButton, Sheet } from "./ui";

/** Live comments of a trip. */
export function useTripComments(tripId: string) {
  const { subscribeComments } = useApp();
  const [comments, setComments] = useState<TripComment[]>([]);
  useEffect(() => subscribeComments(tripId, setComments), [tripId, subscribeComments]);
  return comments;
}

const STATUS_STYLE: Record<CommentStatus, string> = {
  open: "bg-amber-100 text-amber-800",
  approved: "bg-primary-soft text-primary",
  rejected: "bg-slate-100 text-slate-500",
  applied: "bg-emerald-100 text-emerald-700",
};

/** Comments on one stop, plus a box to add one. Members and the owner can comment; the owner also reviews here. */
export function StopComments({ trip, item, day, comments, onClose }: {
  trip: Trip; item: ItineraryItem; day: number; comments: TripComment[]; onClose: () => void;
}) {
  const { addComment, isOwner } = useApp();
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const list = comments.filter((c) => c.itemId === item.id);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true); setError(undefined);
    try { await addComment(trip, item, day, body); setText(""); } catch (err) { setError(err instanceof Error ? err.message : t("common.somethingWrong")); } finally { setSending(false); }
  };

  return (
    <Sheet title={item.title} subtitle={t("comments.dayStop", { n: day })} onClose={onClose}
      footer={
        <form onSubmit={send} className="flex items-end gap-2">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={2000} aria-label={t("comments.placeholder")}
            placeholder={t(isOwner(trip) ? "comments.placeholderOwner" : "comments.placeholder")}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(e); } }}
            className="min-w-0 flex-1 resize-none rounded-2xl bg-surface px-4 py-2.5 text-[15px] outline-none focus:ring-2 focus:ring-primary/30" />
          <button type="submit" aria-label={t("comments.send")} disabled={sending || !text.trim()}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-white disabled:opacity-60">
            {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
          </button>
        </form>
      }>
      {list.length === 0 && <p className="py-4 text-center text-sm text-muted">{t("comments.none")}</p>}
      {list.map((c) => <CommentCard key={c.id} trip={trip} comment={c} />)}
      {error && <ErrorNote>{error}</ErrorNote>}
    </Sheet>
  );
}

type Filter = "open" | "approved" | "done";
const inFilter = (c: TripComment, f: Filter) => (f === "done" ? c.status === "rejected" || c.status === "applied" : c.status === f);

/** Owner: every comment on the trip, approve/reject, then apply the approved ones to the itinerary with AI. */
export function ReviewSheet({ trip, comments, onClose }: { trip: Trip; comments: TripComment[]; onClose: () => void }) {
  const { applyComments, reviewComments } = useApp();
  const { t } = useI18n();
  const [filter, setFilter] = useState<Filter>(() => (comments.some((c) => c.status === "open") ? "open" : "approved"));
  const [busy, setBusy] = useState<"apply" | "approveAll">();
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<string>();
  const approved = comments.filter((c) => c.status === "approved");
  const open = comments.filter((c) => c.status === "open");
  const shown = comments.filter((c) => inFilter(c, filter));

  const run = async (kind: typeof busy, fn: () => Promise<void>) => {
    setBusy(kind); setError(undefined);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : t("common.somethingWrong")); } finally { setBusy(undefined); }
  };

  const apply = () => run("apply", async () => {
    setResult(undefined);
    const res = await applyComments(trip, approved);
    setResult(res.text || t("comments.appliedCount", { n: res.appliedIds.length }));
    if (res.appliedIds.length) setFilter("done");
  });

  const counts: Record<Filter, number> = { open: open.length, approved: approved.length, done: comments.length - open.length - approved.length };

  return (
    <Sheet title={t("comments.reviewTitle")} subtitle={trip.title} onClose={onClose} locked={busy === "apply"}
      footer={
        <PrimaryButton color="primary" onClick={apply} disabled={!approved.length || !!busy}>
          {busy === "apply"
            ? <><Loader2 className="h-5 w-5 animate-spin" /> {t("comments.applying")}</>
            : <><WandSparkles className="h-5 w-5" /> {t("comments.apply", { n: approved.length })}</>}
        </PrimaryButton>
      }>
      <div role="tablist" className="flex gap-2">
        {(["open", "approved", "done"] as Filter[]).map((f) => (
          <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}
            className={cn("rounded-full px-3.5 py-2 text-sm font-semibold transition", filter === f ? "bg-primary text-white" : "bg-surface text-ink-2")}>
            {t(`comments.filter.${f}`)} {counts[f] > 0 && <span className="opacity-75">{counts[f]}</span>}
          </button>
        ))}
      </div>

      {result && (
        <div className="flex gap-2.5 rounded-2xl bg-emerald-50 p-3.5 text-sm text-emerald-800">
          <WandSparkles className="mt-0.5 h-4 w-4 shrink-0" /> <p>{result}</p>
        </div>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}

      {filter === "open" && open.length > 1 && (
        <button onClick={() => run("approveAll", () => reviewComments(trip, open.map((c) => c.id), "approved"))} disabled={!!busy}
          className="flex items-center gap-1.5 text-sm font-semibold text-primary disabled:opacity-60">
          {busy === "approveAll" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {t("comments.approveAll")}
        </button>
      )}
      {filter === "approved" && approved.length > 0 && <p className="text-xs text-muted">{t("comments.applyHint")}</p>}

      {shown.length === 0 && <p className="py-6 text-center text-sm text-muted">{t(`comments.empty.${filter}`)}</p>}
      {shown.map((c) => <CommentCard key={c.id} trip={trip} comment={c} showStop />)}
    </Sheet>
  );
}

function CommentCard({ trip, comment, showStop }: { trip: Trip; comment: TripComment; showStop?: boolean }) {
  const { isOwner, uid, reviewComments, deleteComment } = useApp();
  const { t, lang } = useI18n();
  const [busy, setBusy] = useState(false);
  const owner = isOwner(trip);
  const mine = comment.authorId === uid;
  const stopGone = !trip.itinerary.some((d) => d.items.some((i) => i.id === comment.itemId));

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (e) { alert(e instanceof Error ? e.message : t("common.somethingWrong")); } finally { setBusy(false); }
  };
  const review = (status: CommentStatus) => act(() => reviewComments(trip, [comment.id], status));

  return (
    <div className={cn("space-y-2 rounded-2xl border border-line p-3.5", busy && "opacity-60")}>
      {showStop && (
        <div className="truncate text-xs font-semibold text-primary">
          {t("comments.stopRef", { n: comment.day ?? "?", title: comment.itemTitle })}{stopGone && ` · ${t("comments.stopRemoved")}`}
        </div>
      )}
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface text-xs font-bold text-ink-2 uppercase">
          {(comment.authorName || "?").charAt(0)}
        </span>
        <div className="min-w-0 flex-1 truncate text-sm">
          <span className="font-semibold">{mine ? t("share.you") : comment.authorName || t("share.someone")}</span>
          <span className="text-muted"> · {new Date(comment.createdAt).toLocaleString(LOCALE[lang], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
        </div>
        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase", STATUS_STYLE[comment.status])}>
          {t(`comments.status.${comment.status}`)}
        </span>
      </div>
      <p className="text-[15px] leading-relaxed whitespace-pre-wrap text-ink">{comment.text}</p>
      {(owner || (mine && comment.status === "open")) && (
        <div className="flex items-center gap-1.5 pt-0.5">
          {owner && comment.status === "open" && (
            <>
              <ActionButton onClick={() => review("approved")} disabled={busy} className="bg-primary text-white"><Check className="h-3.5 w-3.5" /> {t("comments.approve")}</ActionButton>
              <ActionButton onClick={() => review("rejected")} disabled={busy} className="bg-surface text-ink-2"><X className="h-3.5 w-3.5" /> {t("comments.reject")}</ActionButton>
            </>
          )}
          {owner && (comment.status === "approved" || comment.status === "rejected") && (
            <ActionButton onClick={() => review("open")} disabled={busy} className="bg-surface text-ink-2"><RotateCcw className="h-3.5 w-3.5" /> {t("comments.undo")}</ActionButton>
          )}
          <span className="flex-1" />
          {(mine || owner) && comment.status !== "applied" && (
            <button aria-label={t("comments.delete")} disabled={busy} onClick={() => act(() => deleteComment(comment))}
              className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-surface hover:text-red-600">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ActionButton({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={cn("flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold transition active:scale-95 disabled:opacity-60", className)} />;
}
