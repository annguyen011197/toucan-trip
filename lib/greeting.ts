import type { Trip, UserProfile } from "./types";
import { monthName } from "./time";
import { translator, type Lang } from "./i18n";

export interface BotTurn { text: string; quickReplies: string[] }
export const turn = (text: string, quickReplies: string[] = []): BotTurn => ({ text, quickReplies });

/** Quick reply prefixed with the home airport when the profile has one, e.g. "SGN · next weekend". */
export const fromHome = (profile: UserProfile, when: string) => (profile.homeAirport ? `${profile.homeAirport} · ${when}` : when);

/** Opening line for a new trip (same for every engine, so the first screen is instant). */
export function greeting(trip: Trip, profile: UserProfile, lang: Lang = "en"): BotTurn {
  const t = translator(lang);
  const name = profile.name ? ` ${profile.name.split(" ")[0]}` : "";
  if (trip.destination) {
    return turn(
      t("greet.withDest", { name, city: trip.destination.split(",")[0] }),
      [fromHome(profile, t("greet.when.month")), fromHome(profile, t("greet.when.weekend")), fromHome(profile, t("greet.when.week", { month: monthName(2, lang) }))],
    );
  }
  const picks = lang === "vi" ? ["Kyoto, Nhật Bản", "Bali, Indonesia", "Lisbon, Bồ Đào Nha"] : ["Kyoto, Japan", "Bali, Indonesia", "Lisbon, Portugal"];
  return turn(t("greet.noDest", { name }), [...picks, t("greet.surprise")]);
}

