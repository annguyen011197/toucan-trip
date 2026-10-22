import type { Lang } from "./i18n";

export type TripStatus = "dreaming" | "upcoming" | "ongoing" | "past";
export const TRIP_STATUSES: TripStatus[] = ["dreaming", "upcoming", "ongoing", "past"];

export type ItemCategory = "food" | "sight" | "activity" | "transport" | "hotel" | "shopping" | "nightlife" | "other";
export const ITEM_CATEGORIES: ItemCategory[] = ["food", "sight", "activity", "transport", "hotel", "shopping", "nightlife", "other"];

export interface ItineraryItem {
  id: string;
  /** 24h "HH:mm" */
  time: string;
  title: string;
  placeId?: string;
  /** Street address or neighborhood, when known. */
  address?: string;
  lat: number;
  lng: number;
  note: string;
  /** Practical prep for this stop: what to wear, bring, book ahead, etiquette. */
  tips?: string[];
  category: ItemCategory;
  estCost: number;
  imageUrl?: string;
  /** Attribution for `imageUrl` (required for Wikimedia Commons photos; marks AI-generated ones). */
  imageCredit?: { text: string; url?: string };
  /** A photo lookup already ran for this stop (hit or miss), so it isn't repeated. */
  imageSearched?: boolean;
  tags?: string[];
}

export interface ItineraryDay {
  day: number;
  /** yyyy-MM-dd */
  date?: string;
  items: ItineraryItem[];
}

export interface Place {
  name: string;
  lat: number;
  lng: number;
  address?: string;
}

export interface Trip {
  id: string;
  ownerId: string;
  title: string;
  destination?: string;
  origin?: string;
  /** yyyy-MM-dd */
  startDate?: string;
  endDate?: string;
  travelers?: number;
  budget?: string;
  interests?: string[];
  status: TripStatus;
  coverImageUrl?: string;
  hotel?: Place;
  itinerary: ItineraryDay[];
  /** Currency of every `estCost` in the itinerary. */
  currency: string;
  /** Language the itinerary text was written in (trips from before this field are English). */
  language?: Lang;
  createdAt: number;
  updatedAt: number;
}

// ───────────── Sharing ─────────────

/** The owner edits the trip; members invited by email or share link can read it and comment on stops. */
export type TripRole = "owner" | "commenter";

export interface TripMember {
  id: string;
  tripId: string;
  /** Unset for an email invite whose person hasn't signed up yet. */
  userId?: string;
  email?: string;
  displayName?: string;
  role: Exclude<TripRole, "owner">;
  createdAt: number;
}

/** open → approved | rejected by the owner → applied once AI merged it into the itinerary. */
export type CommentStatus = "open" | "approved" | "rejected" | "applied";

export interface TripComment {
  id: string;
  tripId: string;
  /** ItineraryItem.id; `day` and `itemTitle` are snapshots so the comment reads well after the stop changes. */
  itemId: string;
  day?: number;
  itemTitle: string;
  authorId: string;
  authorName: string;
  text: string;
  status: CommentStatus;
  createdAt: number;
  resolvedAt?: number;
}

/** Someone actually going on the trip (the owner always is and isn't stored). */
export interface TripTraveler {
  id: string;
  tripId: string;
  /** A member with the app; unset = virtual traveler (name only) until the owner links them to a member. */
  userId?: string;
  name: string;
  createdAt: number;
}

/** Key a traveler has in expenses (payer / split shares). */
export const travelerKey = (t: Pick<TripTraveler, "id" | "userId">) => t.userId ?? `traveler:${t.id}`;

// ───────────── Expenses ─────────────

/** Someone an expense is paid by or split with: a user (Firebase uid) or a guest without an account ("guest:<name>"). */
export interface ExpensePerson { key: string; name: string }

/** How an expense is shared. Share amounts are in the expense's currency and add up to its amount. */
export interface ExpenseSplit {
  /** equal: amount ÷ the listed people; exact: amounts typed per person. */
  mode: "equal" | "exact";
  shares: (ExpensePerson & { amount: number })[];
}

/** Money actually spent on the trip, logged by the owner or a member. */
export interface TripExpense {
  id: string;
  tripId: string;
  /** ItineraryItem.id it was spent at, if any. */
  itemId?: string;
  /** Unset = not tied to a day (e.g. a SIM card bought before the trip). */
  day?: number;
  title: string;
  amount: number;
  /** Currency it was paid in; may differ from the trip's. */
  currency: string;
  category: ItemCategory;
  note: string;
  /** Who paid; unset on older rows = the author. */
  paidBy?: ExpensePerson;
  /** Unset = the payer's own expense, nobody owes anything. */
  split?: ExpenseSplit;
  authorId: string;
  authorName: string;
  spentAt: number;
  createdAt: number;
}

export type MessageRole = "user" | "bot";
/** `summary` replaces older messages after compaction. */
export type MessageType = "text" | "quickReplies" | "flightCard" | "hotelCard" | "placeCard" | "itineraryUpdate" | "summary";
export type CardKind = "flight" | "hotel" | "place" | "itineraryUpdate";

export interface Card {
  id: string;
  kind: CardKind;
  title: string;
  subtitle?: string;
  detail?: string;
  price?: number;
  currency?: string;
  imageUrl?: string;
  rating?: number;
  lat?: number;
  lng?: number;
  changes?: string[];
  /** Text sent to chat when the card's button is tapped, e.g. "Add Nishiki Market". */
  actionText?: string;
  isSample?: boolean;
  /** Real place from web search; its price is a typical amount, not a quote. */
  isEstimate?: boolean;
  /** Google Maps link for the place. */
  url?: string;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  type: MessageType;
  text: string;
  quickReplies: string[];
  cards: Card[];
  createdAt: number;
}

export type BudgetLevel = "budget" | "midRange" | "luxury";
export const BUDGET_LABEL: Record<BudgetLevel, string> = { budget: "Budget", midRange: "Mid-range", luxury: "Luxury" };
export type Pace = "relaxed" | "packed";

export interface UserProfile {
  name: string;
  interests: string[];
  budgetLevel: BudgetLevel;
  pace: Pace;
  diet: string;
  homeAirport: string;
  /** Supabase Storage URL */
  avatarUrl?: string;
  /** UI + planner language; unset until chosen (the browser language is used meanwhile). */
  language?: Lang;
  /** Currency for new trips and conversions; unset → the language's default. */
  currency?: string;
}

export const DEFAULT_PROFILE: UserProfile = {
  name: "",
  interests: ["Food", "Culture"],
  budgetLevel: "midRange",
  pace: "relaxed",
  diet: "No restrictions",
  homeAirport: "",
};

export const ALL_INTERESTS = ["Food", "Culture", "Nature", "Adventure", "Temples & History", "Nightlife", "Shopping", "Beaches", "Art & Museums", "Photography"];
export const DIET_OPTIONS = ["No restrictions", "Vegetarian", "Vegan", "Halal", "Kosher", "Gluten-free"];

/** Partial item used by add/edit ops. */
export interface ItineraryItemPatch {
  id?: string;
  time?: string;
  title?: string;
  placeId?: string;
  address?: string;
  lat?: number;
  lng?: number;
  note?: string;
  tips?: string[];
  category?: string;
  estCost?: number;
  imageUrl?: string;
  tags?: string[];
}

export interface ItineraryOp {
  action: "add" | "remove" | "move" | "edit";
  day: number;
  item?: ItineraryItemPatch;
  itemId?: string;
  toDay?: number;
  toIndex?: number;
}

export interface TripInfoPatch {
  destination?: string;
  origin?: string;
  startDate?: string;
  endDate?: string;
  travelers?: number;
  budget?: string;
  interests?: string[];
  title?: string;
  status?: TripStatus;
}

// Search tool types
export interface FlightQuery { origin: string; destination: string; date: string; returnDate?: string; travelers: number }
export interface HotelQuery { location: string; checkIn: string; checkOut: string; travelers: number; budget?: string }
export interface PlaceQuery { query: string; near: string; type?: string }

export interface FlightOffer {
  airline: string; flightNumber: string; origin: string; destination: string;
  departure: string; arrival: string; stops: number; durationMinutes: number; price: number; currency: string;
}
export interface HotelOffer {
  name: string; area: string; rating: number; pricePerNight: number; currency: string; lat: number; lng: number; imageUrl?: string;
  address?: string; note?: string; url?: string;
}
export interface PlaceResult {
  placeId: string; name: string; type: string; lat: number; lng: number;
  rating?: number; priceLevel?: number; estCost?: number; note?: string; imageUrl?: string;
  address?: string; currency?: string; url?: string;
}

/** /api/chat contract */
export interface ChatRequest {
  text: string;
  trip: Trip;
  history: ChatMessage[];
  profile: UserProfile;
  /** Language the user is chatting in. */
  lang: Lang;
}

export interface ChatResponse {
  text: string;
  quickReplies: string[];
  cards: Card[];
  /** Trip after tool calls (updateTripInfo / updateItinerary). Client persists it. */
  trip: Trip;
  itineraryChanges: string[];
  engine: "gemini" | "offline";
}

/** /api/trips/convert contract */
export interface ConvertRequest {
  trip: Trip;
  language: Lang;
  currency: string;
}

/** /api/trips/revise contract: the owner applies approved comments with AI. */
export interface ReviseRequest {
  trip: Trip;
  comments: TripComment[];
  lang: Lang;
}

export interface ReviseResponse {
  /** Short summary for the owner (also posted to chat). */
  text: string;
  trip: Trip;
  itineraryChanges: string[];
  /** Comments the planner could act on; the rest stay approved. */
  appliedIds: string[];
  engine: "gemini" | "offline";
}

/** /api/trips/expenses/categorize contract (owner re-categorizes every expense with AI). */
export interface CategorizeResponse {
  /** Expenses whose category changed. */
  changed: { id: string; title: string; from: ItemCategory; to: ItemCategory }[];
  total: number;
  engine: "gemini" | "offline";
}
