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
  currency: string;
  createdAt: number;
  updatedAt: number;
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
export interface HotelOffer { name: string; area: string; rating: number; pricePerNight: number; currency: string; lat: number; lng: number; imageUrl?: string }
export interface PlaceResult {
  placeId: string; name: string; type: string; lat: number; lng: number;
  rating?: number; priceLevel?: number; estCost?: number; note?: string; imageUrl?: string;
}

/** /api/chat contract */
export interface ChatRequest {
  text: string;
  trip: Trip;
  history: ChatMessage[];
  profile: UserProfile;
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
