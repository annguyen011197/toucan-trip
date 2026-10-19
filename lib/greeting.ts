import type { Trip, UserProfile } from "./types";
import { monthName } from "./time";

export interface BotTurn { text: string; quickReplies: string[] }
export const turn = (text: string, quickReplies: string[] = []): BotTurn => ({ text, quickReplies });

/** Opening line for a new trip (same for every engine, so the first screen is instant). */
export function greeting(trip: Trip, profile: UserProfile): BotTurn {
  const name = profile.name && profile.name !== "Traveler" ? ` ${profile.name}` : "";
  const home = profile.homeAirport || "SGN";
  if (trip.destination) {
    return turn(
      `Hi${name}! 🐦 ${trip.destination.split(",")[0]} — what a pick! Where are you flying from, and when are you thinking of going?`,
      [`${home} · 5 days next month`, `${home} · next weekend`, `${home} · 1 week in ${monthName(2)}`],
    );
  }
  return turn(`Hi${name}! 🐦 I'm your Travel AI. Where are we flying to? If you're not sure yet, I've got some great ideas!`,
    ["Kyoto, Japan", "Bali, Indonesia", "Lisbon, Portugal", "Surprise me!"]);
}

