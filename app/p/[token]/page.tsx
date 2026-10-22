import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CalendarDays, Lightbulb, MapPin, Users, Wallet } from "lucide-react";
import { loadPublicTrip, type PublicTrip } from "@/lib/server/public-trip";
import { usdRates } from "@/lib/server/rates";
import { estimatedTotal, summarizeExpenses } from "@/lib/expenses";
import { dayCost, googleMapsUrl } from "@/lib/itinerary-engine";
import { money } from "@/lib/currency";
import { displayTime, formatDateRange, formatLongDate } from "@/lib/time";
import { translator, type Lang } from "@/lib/i18n";
import type { ItemCategory, TripExpense } from "@/lib/types";
import { RemoteImage } from "@/components/ui";

// Always fresh: a link the owner turns off must stop working right away.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const data = await loadPublicTrip((await params).token);
  if (!data) return { title: "Toucan Trip", robots: { index: false } };
  const { trip } = data;
  const t = translator(trip.language ?? "en");
  const description = [trip.destination, formatDateRange(trip.startDate, trip.endDate, trip.language), t("public.days", { n: trip.itinerary.length })]
    .filter(Boolean).join(" · ");
  return {
    title: `${trip.title} – Toucan Trip`,
    description,
    // Unlisted: reachable by link only.
    robots: { index: false, follow: false },
    openGraph: { title: trip.title, description, images: trip.coverImageUrl ? [trip.coverImageUrl] : undefined },
  };
}

export default async function PublicTripPage({ params }: Props) {
  const data = await loadPublicTrip((await params).token);
  if (!data) notFound();
  const rates = data.showExpenses && data.expenses.length ? await usdRates() : {};
  return <PublicTripView data={data} rates={rates} />;
}

function PublicTripView({ data, rates }: { data: PublicTrip; rates: Record<string, number> }) {
  const { trip, travelerCount, showExpenses } = data;
  const lang: Lang = trip.language ?? "en";
  const t = translator(lang);
  const cur = trip.currency;
  const spent = summarizeExpenses(
    data.expenses.map((e, i) => ({ ...e, id: String(i), tripId: trip.id, title: "", note: "", authorId: "", authorName: "", spentAt: 0, createdAt: 0 }) satisfies TripExpense),
    cur, rates,
  );
  const perPerson = estimatedTotal(trip);
  const groupEst = perPerson * Math.max(1, travelerCount);
  const hasSpending = showExpenses && data.expenses.length > 0;
  const categories = (Object.entries(spent.byCategory) as [ItemCategory, number][]).sort((a, b) => b[1] - a[1]);

  return (
    <main lang={lang} className="mx-auto min-h-dvh max-w-[640px] bg-white pb-16">
      <div className="relative h-[240px] overflow-hidden">
        <RemoteImage src={trip.coverImageUrl} seed={trip.id} className="absolute inset-0" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/10 from-20% to-black/70" />
        <div className="absolute top-[max(14px,env(safe-area-inset-top))] left-5 flex items-center gap-2 rounded-full bg-white/85 px-3 py-1.5 text-xs font-semibold text-ink backdrop-blur">
          <img src="/mascot-avatar.webp" alt="" className="h-5 w-5 rounded-full" /> {t("public.badge")}
        </div>
        <div className="absolute right-5 bottom-5 left-5 text-white">
          <h1 className="text-[28px] leading-tight font-bold">{trip.title}</h1>
          {trip.destination && trip.destination !== trip.title && <div className="mt-0.5 text-base opacity-95">{trip.destination}</div>}
        </div>
      </div>

      <div className="space-y-6 px-5 pt-5">
        <div className="flex flex-wrap gap-2 text-sm text-ink-2">
          {(trip.startDate || trip.endDate) && <Pill icon={<CalendarDays className="h-4 w-4" />}>{formatDateRange(trip.startDate, trip.endDate, lang)}</Pill>}
          <Pill icon={<MapPin className="h-4 w-4" />}>{t("public.days", { n: trip.itinerary.length })}</Pill>
          <Pill icon={<Users className="h-4 w-4" />}>{t("public.travelers", { n: travelerCount })}</Pill>
        </div>

        {/* Costs */}
        <section className="grid grid-cols-2 gap-3">
          <Stat label={t("public.estPerPerson")} value={money(perPerson, cur, lang)} />
          <Stat label={t("public.estGroup", { n: travelerCount })} value={money(groupEst, cur, lang)} />
          {hasSpending && (
            <div className="col-span-2 rounded-card border border-line p-4">
              <div className="flex items-center gap-2 text-[11px] font-bold tracking-widest text-ink-2 uppercase"><Wallet className="h-4 w-4 text-emerald-700" /> {t("public.spent")}</div>
              <div className="mt-1 text-2xl font-bold">{spent.converted && "≈ "}{money(spent.total, cur, lang)}</div>
              {groupEst > 0 && (
                <>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface">
                    <div className={spent.total > groupEst ? "h-full bg-red-500" : "h-full bg-emerald-500"} style={{ width: `${Math.min(100, (spent.total / groupEst) * 100)}%` }} />
                  </div>
                  <div className="mt-1 text-xs text-ink-2">{t("public.ofEstimate", { pct: Math.round((spent.total / groupEst) * 100) })}</div>
                </>
              )}
              {categories.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {categories.map(([c, v]) => (
                    <span key={c} className="rounded-full bg-surface px-2.5 py-1 text-xs text-ink-2">{t(`expense.cat.${c}`)} · <b className="text-ink">{money(v, cur, lang)}</b></span>
                  ))}
                </div>
              )}
              {spent.converted && <p className="mt-2 text-[11px] text-muted">{t("expense.converted", { currency: cur })}</p>}
            </div>
          )}
          <p className="col-span-2 text-[11px] text-muted">{t("itin.costNote")}</p>
        </section>

        {/* Itinerary */}
        {trip.itinerary.length === 0 ? <p className="text-sm text-ink-2">{t("public.empty")}</p> : trip.itinerary.map((d) => (
          <section key={d.day}>
            <div className="sticky top-0 z-10 -mx-5 flex items-baseline justify-between border-b border-line/70 bg-white/95 px-5 py-2.5 backdrop-blur">
              <h2 className="text-lg font-bold">{t("expense.dayN", { n: d.day })}{d.date && <span className="ml-2 text-sm font-normal text-ink-2">{formatLongDate(d.date, lang)}</span>}</h2>
              <span className="text-xs text-ink-2">
                {money(dayCost(d), cur, lang)}{hasSpending && spent.byDay[d.day] ? ` · ${t("public.spentShort", { amount: money(spent.byDay[d.day], cur, lang) })}` : ""}
              </span>
            </div>
            <ol className="mt-3 space-y-4">
              {d.items.map((i) => (
                <li key={i.id} className="flex gap-3">
                  <span className="w-12 shrink-0 pt-0.5 text-xs font-semibold text-primary">{displayTime(i.time, lang)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-2">
                      <h3 className={i.status === "skipped" ? "min-w-0 flex-1 font-semibold text-muted line-through" : "min-w-0 flex-1 font-semibold"}>
                        {i.status === "done" && <span className="mr-1 text-emerald-600">✓</span>}{i.title}
                      </h3>
                      {i.estCost > 0 && <span className="shrink-0 text-xs text-ink-2">{money(i.estCost, cur, lang)}</span>}
                    </div>
                    {hasSpending && spent.byItem[i.id] ? <div className="text-xs font-semibold text-emerald-700">{t("public.spentShort", { amount: money(spent.byItem[i.id], cur, lang) })}</div> : null}
                    <a href={googleMapsUrl(i, trip.destination)} target="_blank" rel="noopener noreferrer" className="mt-0.5 inline-flex items-start gap-1 text-[13px] text-primary hover:underline">
                      <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span>{i.address ?? t("itin.openMaps")}</span>
                    </a>
                    {i.note && <p className="mt-1 text-sm leading-relaxed text-ink-2">{i.note}</p>}
                    {i.tips?.length ? (
                      <div className="mt-2 rounded-xl bg-primary-soft/60 px-3 py-2">
                        <div className="flex items-center gap-1 text-[11px] font-bold tracking-wider text-cta uppercase"><Lightbulb className="h-3.5 w-3.5" /> {t("itin.prepTips")}</div>
                        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[13px] text-ink-2">{i.tips.map((tip, k) => <li key={k}>{tip}</li>)}</ul>
                      </div>
                    ) : null}
                    {i.imageUrl && <RemoteImage src={i.imageUrl} seed={i.id} alt={i.title} className="mt-2 h-[140px] rounded-2xl" />}
                    {i.imageUrl && i.imageCredit && (i.imageCredit.url
                      ? <a href={i.imageCredit.url} target="_blank" rel="noopener noreferrer" className="mt-1 block truncate text-[11px] text-muted hover:underline">{i.imageCredit.text}</a>
                      : <div className="mt-1 truncate text-[11px] text-muted">{i.imageCredit.text}</div>)}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ))}

        <a href="/" className="flex items-center justify-center gap-2 rounded-full bg-cta py-4 font-semibold text-white shadow-cta">
          {t("public.cta")}
        </a>
        <p className="text-center text-xs text-muted">{t("share.footer")}</p>
      </div>
    </main>
  );
}

function Pill({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return <span className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5">{icon}{children}</span>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card bg-surface p-4">
      <div className="text-[11px] font-bold tracking-widest text-ink-2 uppercase">{label}</div>
      <div className="mt-1 text-xl font-bold">{value}</div>
    </div>
  );
}
