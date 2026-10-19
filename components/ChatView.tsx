"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, BedDouble, CalendarCheck, CalendarDays, ChevronDown, FoldVertical, Loader2, Map as MapIcon, MoreHorizontal, Plane, SendHorizontal, Share2, Star, Utensils, User, BadgeCheck } from "lucide-react";
import { COMPACT_EVERY, compactable, useApp } from "@/lib/app-state";
import type { Card, ChatMessage, Trip } from "@/lib/types";
import { displayTime } from "@/lib/time";
import { money, cn } from "@/lib/util";
import { Chip, MascotAvatar } from "./ui";

export function shareText(trip: Trip) {
  const lines = [`${trip.title} — ${trip.destination ?? "TBD"}`];
  for (const d of trip.itinerary) {
    lines.push("", `Day ${d.day}`);
    for (const i of d.items) lines.push(`• ${displayTime(i.time)}  ${i.title}`);
  }
  lines.push("", "Planned with Toucan Trip 🐦");
  return lines.join("\n");
}

export async function shareTrip(trip: Trip) {
  const text = shareText(trip);
  try {
    if (navigator.share) await navigator.share({ title: trip.title, text });
    else { await navigator.clipboard.writeText(text); alert("Itinerary copied to clipboard"); }
  } catch { /* cancelled */ }
}

export function ChatView({ tripId }: { tripId: string }) {
  const { trips, subscribeMessages, sendChat, compactChat, setTab } = useApp();
  const trip = trips.find((t) => t.id === tripId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [menu, setMenu] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const compactingRef = useRef(false);
  const autoFailedAt = useRef(-1);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => subscribeMessages(tripId, setMessages), [tripId, subscribeMessages]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages.length, thinking]);

  // Grow with the text, up to ~5 lines, then scroll.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [draft]);

  /** Desktop: Enter sends, Shift+Enter adds a line. Touch keyboards: Enter always adds a line (send with the button). */
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;
    e.preventDefault();
    send(draft);
  };

  const compact = async (auto: boolean) => {
    if (!trip || compactingRef.current) return;
    compactingRef.current = true;
    setCompacting(true);
    try {
      await compactChat(trip, messages);
    } catch (e) {
      if (auto) { autoFailedAt.current = messages.length; console.error("[compact]", e); }
      else alert(`Couldn't compact the chat: ${e instanceof Error ? e.message : "unknown error"}`);
    } finally {
      compactingRef.current = false;
      setCompacting(false);
    }
  };

  // Auto-compact every COMPACT_EVERY messages since the last summary (between turns only; no retry loop on failure).
  const sinceSummary = messages.length - 1 - messages.findLastIndex((m) => m.type === "summary");
  useEffect(() => {
    if (sinceSummary >= COMPACT_EVERY && !thinking && autoFailedAt.current !== messages.length) compact(true);
  }, [sinceSummary, thinking]); // eslint-disable-line react-hooks/exhaustive-deps

  const compactCount = compactable(messages).length;
  const manualCompact = () => {
    setMenu(false);
    if (confirm(`Summarize ${compactCount} older messages and delete them? This can't be undone.`)) compact(false);
  };

  const send = async (raw: string) => {
    const text = raw.trim();
    if (!text || thinking || !trip) return;
    setDraft("");
    setThinking(true);
    try { await sendChat(trip, text, messages); } finally { setThinking(false); }
  };

  const last = messages[messages.length - 1];
  const chips = !thinking && last?.role === "bot" ? last.quickReplies : [];
  const first = messages[0];

  return (
    <div className="flex h-[calc(100dvh-76px-env(safe-area-inset-bottom))] flex-col bg-white">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-line/70 px-4 pt-[max(10px,env(safe-area-inset-top))] pb-2.5">
        <MascotAvatar size={48} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xl font-bold">{trip?.title ?? "New Trip"}</div>
          <div className="text-[13px] text-ink-2">AI-Powered Planning</div>
        </div>
        <button aria-label="Share" onClick={() => trip && shareTrip(trip)} className="flex h-11 w-11 items-center justify-center rounded-full bg-surface"><Share2 className="h-5 w-5" /></button>
        <div className="relative">
          <button aria-label="More" onClick={() => setMenu((m) => !m)} className="flex h-11 w-11 items-center justify-center rounded-full bg-surface"><MoreHorizontal className="h-5 w-5" /></button>
          {menu && (
            <div className="absolute right-0 z-20 mt-2 w-48 overflow-hidden rounded-2xl bg-white py-1 shadow-card">
              <MenuItem icon={<CalendarDays className="h-4 w-4" />} onClick={() => setTab("itinerary")}>View itinerary</MenuItem>
              <MenuItem icon={<MapIcon className="h-4 w-4" />} onClick={() => setTab("map")}>Show on map</MenuItem>
              <MenuItem icon={<FoldVertical className="h-4 w-4" />} onClick={manualCompact} disabled={compacting || compactCount < 2}>Compact chat</MenuItem>
              {trip?.status === "dreaming" && (
                <MenuItem icon={<BadgeCheck className="h-4 w-4" />} onClick={() => { setMenu(false); send("Looks good, confirm!"); }}>Confirm trip</MenuItem>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Messages */}
      <div className="no-scrollbar flex-1 space-y-[18px] overflow-y-auto px-4 pb-2" onClick={() => setMenu(false)}>
        {first && (
          <div className="pt-4 text-center text-xs font-semibold tracking-[0.12em] text-muted uppercase">{timestamp(first.createdAt)}</div>
        )}
        {messages.map((m) => (
          <MessageRow key={m.id} message={m} onAction={(c) => c.actionText && send(c.actionText)} onOpenItinerary={() => setTab("itinerary")} />
        ))}
        {thinking && <TypingRow />}
        {compacting && (
          <div className="flex items-center justify-center gap-2 py-1 text-xs font-medium text-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Compacting earlier messages…
          </div>
        )}
        {chips.length > 0 && (
          <div className="no-scrollbar rise flex gap-2.5 overflow-x-auto py-1 pl-[46px]">
            {chips.map((c, i) => <Chip key={c + i} highlighted={i === 0} onClick={() => send(c)}>{c}</Chip>)}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form className="border-t border-line/60 bg-white px-4 py-2.5" onSubmit={(e) => { e.preventDefault(); send(draft); }}>
        <div className="flex items-end gap-2 rounded-[26px] border border-line bg-bg py-1.5 pr-1.5 pl-5">
          <textarea ref={inputRef} rows={1} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKeyDown}
            placeholder="Ask Travel AI..." aria-label="Message"
            className="no-scrollbar min-w-0 flex-1 resize-none self-center bg-transparent py-1.5 text-base leading-6 outline-none placeholder:text-muted" />
          <button type="submit" aria-label="Send" disabled={!draft.trim() || thinking}
            className="flex h-10 w-10 items-center justify-center rounded-full text-primary transition disabled:text-muted">
            <SendHorizontal className="h-6 w-6" fill="currentColor" />
          </button>
        </div>
      </form>
    </div>
  );
}

function MenuItem({ icon, children, onClick, disabled }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm hover:bg-surface disabled:pointer-events-none disabled:opacity-40">
      {icon}{children}
    </button>
  );
}

function timestamp(ms: number) {
  const d = new Date(ms);
  const today = new Date().toDateString() === d.toDateString();
  const day = today ? "Today" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${day}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

function MessageRow({ message, onAction, onOpenItinerary }: { message: ChatMessage; onAction: (c: Card) => void; onOpenItinerary: () => void }) {
  if (message.role === "user") {
    return (
      <div className="rise flex flex-col items-end gap-1.5">
        <span className="pr-[52px] text-sm text-ink-2">You</span>
        <div className="flex items-end gap-2.5 pl-10">
          <div className="rounded-[20px] rounded-br-md bg-primary px-4 py-3 leading-relaxed whitespace-pre-wrap text-white">{message.text}</div>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#FDE7D4] text-cta"><User className="h-4 w-4" fill="currentColor" /></span>
        </div>
      </div>
    );
  }
  if (message.type === "summary") return <SummaryCard text={message.text} />;
  if (message.type === "itineraryUpdate" && message.cards[0]) {
    return <UpdateCard card={message.cards[0]} onOpen={onOpenItinerary} />;
  }
  return (
    <div className="rise flex items-end gap-2.5">
      <MascotAvatar size={36} />
      <div className="min-w-0 flex-1 space-y-1.5 pr-6">
        <span className="text-sm text-ink-2">Travel AI</span>
        {message.text && (
          <div className="w-fit rounded-[20px] rounded-bl-md bg-surface px-4 py-3 leading-relaxed whitespace-pre-wrap">{message.text}</div>
        )}
        {message.cards.length > 0 && (
          <div className="no-scrollbar -mr-10 flex gap-3 overflow-x-auto py-1.5 pr-10">
            {message.cards.map((c) => <ResultCard key={c.id} card={c} onAction={() => onAction(c)} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rise mx-6 rounded-2xl border border-dashed border-line bg-bg px-4 py-3">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="flex w-full items-center gap-2 text-left text-xs font-semibold tracking-wider text-ink-2 uppercase">
        <FoldVertical className="h-3.5 w-3.5" />
        <span className="flex-1">Earlier messages compacted</span>
        <ChevronDown className={cn("h-4 w-4 transition", open && "rotate-180")} />
      </button>
      {open && <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap text-ink-2">{text}</p>}
    </div>
  );
}

function UpdateCard({ card, onOpen }: { card: Card; onOpen: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const changes = card.changes ?? [];
  const shown = expanded ? changes : changes.slice(0, 4);
  return (
    <div className="rise pl-[46px]">
      <div className="max-w-[300px] rounded-bubble border border-primary/15 bg-primary-soft p-4">
        <div className="flex items-center gap-2 font-semibold"><CalendarCheck className="h-4 w-4 text-primary" /> {card.title}</div>
        <ul className="mt-2 space-y-1.5">
          {shown.map((ch, i) => (
            <li key={i} className="flex gap-2 text-sm text-ink-2"><span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />{ch}</li>
          ))}
        </ul>
        {changes.length > 4 && (
          <button onClick={() => setExpanded((e) => !e)} className="mt-1.5 pl-3.5 text-sm text-ink-2 underline-offset-2 hover:underline">
            {expanded ? "Show less" : `+${changes.length - 4} more changes`}
          </button>
        )}
        <button onClick={onOpen} className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-cta">View itinerary <ArrowRight className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

function ResultCard({ card, onAction }: { card: Card; onAction: () => void }) {
  const Icon = card.kind === "flight" ? Plane : card.kind === "hotel" ? BedDouble : Utensils;
  return (
    <div className="flex w-[230px] shrink-0 flex-col gap-2 rounded-bubble bg-white p-3.5 shadow-card ring-1 ring-line/60">
      <div className="flex items-start gap-2">
        <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-primary text-white"><Icon className="h-4 w-4" /></span>
        <div className="line-clamp-2 text-[15px] font-semibold">{card.title}</div>
      </div>
      {card.subtitle && <div className="truncate text-[13px] text-ink-2">{card.subtitle}</div>}
      {card.detail && <div className="line-clamp-2 text-[13px] text-ink-2">{card.detail}</div>}
      <div className="mt-auto flex items-baseline gap-2">
        {!!card.price && <span className="text-[17px] font-bold">{money(card.price, card.currency)}</span>}
        {card.rating && <span className="flex items-center gap-0.5 text-xs font-semibold text-tertiary"><Star className="h-3 w-3" fill="currentColor" />{card.rating.toFixed(1)}</span>}
        <span className="flex-1" />
        {card.isSample && <span className="text-[10px] font-bold tracking-widest text-muted">SAMPLE</span>}
      </div>
      {card.actionText && (
        <button onClick={onAction} className="rounded-full bg-primary-soft py-2 text-sm font-semibold text-cta transition active:scale-95">
          {card.kind === "place" ? "Add to trip" : "Choose"}
        </button>
      )}
    </div>
  );
}

function TypingRow() {
  return (
    <div className="flex items-end gap-2.5" aria-label="Travel AI is typing">
      <MascotAvatar size={36} />
      <div className="flex gap-1.5 rounded-bubble bg-surface px-4 py-4">
        {[0, 1, 2].map((i) => <span key={i} className={cn("typing-dot h-2 w-2 rounded-full bg-muted")} style={{ animationDelay: `${i * 0.15}s` }} />)}
      </div>
    </div>
  );
}
