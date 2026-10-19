"use client";

import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Compass, Mountain } from "lucide-react";
import type { TripStatus } from "@/lib/types";
import { cn } from "@/lib/util";

export function MascotAvatar({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <img src="/mascot-avatar.webp" alt="Travel AI" width={size} height={size}
      className={cn("shrink-0 rounded-full border-2 border-white object-cover shadow-sm", className)}
      style={{ width: size, height: size }} />
  );
}

const PALETTES = [
  ["#1A7FE8", "#6FC3FF"], ["#0B5CAD", "#2BB3A3"], ["#CE6000", "#FFB36B"], ["#3D4E81", "#8E9EEA"],
];

/** Remote photo with a graceful gradient fallback for missing or broken URLs. */
export function RemoteImage({ src, seed = "", alt = "", className }: { src?: string; seed?: string; alt?: string; className?: string }) {
  // Tracked per URL, so a new src after a failed/loaded one is shown (e.g. a replaced trip cover).
  const [failedSrc, setFailedSrc] = useState<string>();
  const [loadedSrc, setLoadedSrc] = useState<string>();
  const failed = failedSrc === src;
  const loaded = loadedSrc === src;
  const [a, b] = PALETTES[[...seed].reduce((s, c) => s + c.charCodeAt(0), 0) % PALETTES.length];
  // Only default to `relative`: combined with a caller's `absolute inset-0`, Tailwind's CSS order makes
  // `relative` win, the box collapses to 0px and the image disappears.
  const positioned = /\b(absolute|fixed|sticky)\b/.test(className ?? "");
  return (
    <div className={cn(!positioned && "relative", "overflow-hidden", className)} style={{ background: `linear-gradient(135deg, ${a}, ${b})` }}>
      {!failed && src ? (
        <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedSrc(src)} onLoad={() => setLoadedSrc(src)}
          className={cn("absolute inset-0 h-full w-full object-cover transition-opacity duration-300", loaded ? "opacity-100" : "opacity-0")} />
      ) : (
        <Mountain className="absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 text-white/40" />
      )}
    </div>
  );
}

const STATUS_STYLE: Record<TripStatus, string> = {
  upcoming: "bg-cta text-white",
  ongoing: "bg-emerald-600 text-white",
  dreaming: "bg-white/75 text-ink-2 backdrop-blur",
  past: "bg-slate-500 text-white",
};

export function StatusBadge({ status }: { status: TripStatus }) {
  return <span className={cn("rounded-full px-3 py-1.5 text-[11px] font-bold tracking-widest uppercase", STATUS_STYLE[status])}>{status}</span>;
}

export function TagPill({ children }: { children: ReactNode }) {
  return <span className="rounded-full bg-cta px-2.5 py-1 text-[11px] font-bold tracking-widest text-white uppercase">{children}</span>;
}

export function Chip({ highlighted, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { highlighted?: boolean }) {
  return (
    <button {...props}
      className={cn(
        "shrink-0 rounded-full border px-4 py-2.5 text-[15px] font-medium whitespace-nowrap transition active:scale-95",
        highlighted ? "border-primary/35 bg-primary-soft text-primary" : "border-[#dde3ec] bg-white text-ink hover:bg-surface",
        className,
      )} />
  );
}

export function PrimaryButton({ className, color = "cta", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { color?: "cta" | "primary" }) {
  return (
    <button {...props}
      className={cn(
        "flex w-full items-center justify-center gap-2.5 rounded-full py-4 text-base font-semibold text-white transition active:scale-[0.98] disabled:opacity-60",
        color === "cta" ? "bg-cta shadow-cta" : "bg-primary shadow-[0_8px_20px_rgb(26_127_232/0.3)]",
        className,
      )} />
  );
}

export function IconButton({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props}
      className={cn("flex h-10 w-10 items-center justify-center rounded-full bg-white text-ink shadow-[0_2px_8px_rgb(0_0_0/0.06)] transition active:scale-95", className)} />
  );
}

export function NoTrip({ title, message, onStart }: { title: string; message: string; onStart: () => void }) {
  return (
    <div className="flex min-h-[80dvh] flex-col items-center justify-center gap-4 px-8 text-center">
      <img src="/mascot.webp" alt="" className="w-40" />
      <h2 className="text-2xl font-bold">{title}</h2>
      <p className="text-ink-2">{message}</p>
      <PrimaryButton className="mt-2 max-w-xs" onClick={onStart}><Compass className="h-5 w-5" /> Start your next trip</PrimaryButton>
    </div>
  );
}
