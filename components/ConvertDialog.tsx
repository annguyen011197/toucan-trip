"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Coins, Languages, Loader2 } from "lucide-react";
import type { Trip } from "@/lib/types";
import { LANG_NAME, type Lang } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n-react";
import { PrimaryButton } from "./ui";

/** What a trip needs to match the current language/currency, or undefined when it already does. */
export function conversionFor(trip: Trip, lang: Lang, currency: string) {
  const from = trip.language ?? "en";
  const language = from !== lang;
  const money = trip.currency !== currency;
  if (!language && !money) return undefined;
  const target = [language && LANG_NAME[lang], money && currency].filter(Boolean).join(" · ");
  return { language, money, from, currency, target, key: `${trip.id}:${lang}:${currency}` };
}

export type Conversion = NonNullable<ReturnType<typeof conversionFor>>;

/** "This itinerary was made in English. Convert it to Tiếng Việt?" */
export function ConvertDialog({ trip, conversion, onConvert, onClose }: {
  trip: Trip;
  conversion: Conversion;
  /** Converts and closes the dialog; errors are shown in it. */
  onConvert: () => Promise<void>;
  /** "Not now" */
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // Snapshot: the trip is saved optimistically while converting, so its currency changes under the open dialog.
  const [fromCurrency] = useState(trip.currency);
  const from = [conversion.language && LANG_NAME[conversion.from], conversion.money && fromCurrency].filter(Boolean).join(" · ");

  const convert = async () => {
    setBusy(true); setError(undefined);
    try { await onConvert(); } catch (e) { setError(e instanceof Error ? e.message : t("common.somethingWrong")); } finally { setBusy(false); }
  };

  // Portal + z above the TabBar (z-[1000]), like ImagePicker.
  return createPortal(
    <div className="fixed inset-0 z-[1100] flex items-end justify-center bg-black/40 sm:items-center" onClick={() => !busy && onClose()}>
      <div role="dialog" aria-modal aria-labelledby="convert-title" onClick={(e) => e.stopPropagation()}
        className="rise w-full max-w-[480px] space-y-4 rounded-t-[28px] bg-white px-5 pt-5 pb-[max(20px,env(safe-area-inset-bottom))] sm:max-w-[400px] sm:rounded-[28px]">
        <div className="flex items-center gap-3">
          <img src="/mascot-avatar.webp" alt="" className="h-12 w-12 shrink-0 rounded-full border-2 border-white object-cover shadow-sm" />
          <h2 id="convert-title" className="text-lg leading-snug font-bold">{t("convert.title", { target: conversion.target })}</h2>
        </div>
        <p className="text-[15px] text-ink-2">{t("convert.body", { from, to: conversion.target })}</p>
        <ul className="space-y-2.5 rounded-2xl bg-primary-soft/60 p-3.5 text-sm text-ink-2">
          {conversion.language && (
            <li className="flex gap-2.5"><Languages className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{t("convert.language")}</li>
          )}
          {conversion.money && (
            <li className="flex gap-2.5"><Coins className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              {t("convert.currency", { from: fromCurrency, to: conversion.currency })}</li>
          )}
        </ul>
        {error && <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        <PrimaryButton onClick={convert} disabled={busy}>
          {busy ? <><Loader2 className="h-5 w-5 animate-spin" /> {t("convert.converting")}</> : t("convert.action")}
        </PrimaryButton>
        <button onClick={onClose} disabled={busy} className="w-full py-1 text-sm font-semibold text-ink-2 disabled:opacity-60">{t("convert.notNow")}</button>
      </div>
    </div>,
    document.body,
  );
}
