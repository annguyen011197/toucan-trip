import type { ItemCategory, Trip } from "../types";
import { supabaseAdmin } from "./auth";

/** What the public page may show: no owner id, names, emails, chat, comments or who paid. */
export interface PublicTrip {
  trip: Omit<Trip, "ownerId">;
  travelerCount: number;
  showExpenses: boolean;
  expenses: { amount: number; currency: string; category: ItemCategory; day?: number; itemId?: string }[];
}

const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;

export async function loadPublicTrip(token: string): Promise<PublicTrip | undefined> {
  if (!TOKEN.test(token)) return undefined;
  const db = supabaseAdmin();
  const { data: link } = await db.from("trip_public_links").select("trip_id, show_expenses").eq("token", token).maybeSingle();
  if (!link) return undefined;
  const [{ data: t }, { count }, expenses] = await Promise.all([
    db.from("trips").select("*").eq("id", link.trip_id).maybeSingle(),
    db.from("trip_travelers").select("id", { count: "exact", head: true }).eq("trip_id", link.trip_id),
    link.show_expenses
      ? db.from("trip_expenses").select("amount, currency, category, day, item_id").eq("trip_id", link.trip_id).limit(2000)
      : Promise.resolve({ data: [] as { amount: number | string; currency: string; category: ItemCategory; day: number | null; item_id: string | null }[] }),
  ]);
  if (!t) return undefined;
  return {
    trip: {
      id: t.id, title: t.title, destination: t.destination ?? undefined, origin: t.origin ?? undefined,
      startDate: t.start_date ?? undefined, endDate: t.end_date ?? undefined, travelers: t.travelers ?? undefined,
      budget: t.budget ?? undefined, interests: t.interests ?? [], status: t.status, coverImageUrl: t.cover_image_url ?? undefined,
      hotel: t.hotel ?? undefined, itinerary: t.itinerary ?? [], currency: t.currency, language: t.language ?? "en",
      createdAt: Date.parse(t.created_at), updatedAt: Date.parse(t.updated_at),
    },
    // The owner is always going; an empty list falls back to the trip's own traveler count.
    travelerCount: count ? count + 1 : t.travelers ?? 1,
    showExpenses: !!link.show_expenses,
    expenses: (expenses.data ?? []).map((e) => ({
      amount: Number(e.amount), currency: e.currency, category: e.category, day: e.day ?? undefined, itemId: e.item_id ?? undefined,
    })),
  };
}
