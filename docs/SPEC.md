# Toucan Trip – AI Travel Planner (iOS)

## Overview
A chat-first trip planning app. A friendly toucan mascot ("Travel AI") asks the user about their trip, builds a day-by-day itinerary, and suggests flights, hotels, and restaurants. The itinerary updates live as the user chats. LLM: Google Gemini.

## Tech Stack
- SwiftUI (iOS 17+), MVVM
- Firebase: Auth, Firestore, Cloud Functions
- Gemini via Firebase AI Logic. Never ship the API key in the app.
- MapKit for maps; Google Places API for place data

## Screens (bottom tab bar)
1. **Home**
   - Mascot greeting card with a "Start your next trip" button, which creates a new trip and opens Chat.
   - "Hand-picked for you": horizontal carousel of destination cards (image, tag such as NATURE or ADVENTURE, title).
   - "My Itinerary": vertical list of trip cards (cover image, status badge, title, date range, arrow button).
   - Trip status values: `dreaming | upcoming | ongoing | past`.
2. **Chat** (one thread per trip)
   - Header: mascot avatar, trip title, subtitle "AI-Powered Planning", share button, more button.
   - Bot bubbles are left-aligned and gray. User bubbles are right-aligned and blue.
   - Quick-reply chips appear under the latest bot message.
   - Input bar with send button.
   - Message types: `text`, `quickReplies`, `flightCard`, `hotelCard`, `placeCard`, `itineraryUpdate`.
3. **Itinerary**
   - Day tabs; each day shows a timeline of items (time, place, note, travel time to the next item).
   - Drag to reorder items.
   - Estimated total cost.
4. **Map**
   - Pins for the selected day's items, a route line between them, and a hotel pin.
5. **Profile**
   - Interests, budget level, pace (relaxed or packed), diet, home airport.

## Chat Flow
1. Ask for the destination. If the user has none, suggest options based on vibe, season, and budget.
2. Collect origin, dates, travelers, budget, and interests, one or two questions per turn. Offer chips whenever possible.
3. Generate a draft itinerary, then ask what to adjust.
4. Apply edits from chat (for example "add Kinkaku-ji at 9am on Day 2") by calling `updateItinerary`.
5. Offer flights, hotels, and restaurants as cards.
6. Confirm the trip: set status to `upcoming`.

## Gemini Integration
- System prompt: toucan persona, warm and lightly playful, concise. Follow the chat flow above. Use the user's profile to personalize.
- Use function calling. Cloud Functions execute the calls:
  - `updateTripInfo(destination?, origin?, startDate?, endDate?, travelers?, budget?, interests?)`
  - `updateItinerary(ops: [{action: add|remove|move|edit, day, item}])`
  - `searchFlights(origin, destination, date, returnDate?, travelers)`
  - `searchHotels(location, checkIn, checkOut, travelers, budget?)`
  - `searchPlaces(query, near, type)`
- Each bot response returns structured output: `{ text, quickReplies?: [String], cards?: [Card] }`.
- Prices and availability must come only from tool results; never invent them. Mock these functions for the MVP.

## Data Model (Firestore)
users/{uid}: { name, interests[], budgetLevel, pace, diet, homeAirport }
trips/{tripId}: { ownerId, title, destination, origin, startDate, endDate,
                  travelers, budget, status, coverImageUrl,
                  itinerary: [{ day, date, items: [{ id, time, title, placeId?,
                  lat, lng, note, category, estCost }] }] }
trips/{tripId}/messages/{id}: { role: user|bot, type, text, quickReplies[], cards[], createdAt }

## Rules
- The itinerary is the single source of truth. Edits made in Chat and in the Itinerary tab both write to Firestore, and all views update via realtime listeners.
- After every itinerary change, the bot posts an `itineraryUpdate` card summarizing the change.

## Design
- Primary color #1A7FE8, dark blue CTA #0B5CAD, light gray bubbles and cards #F0F3F8.
- Rounded corners (cards 24pt, bubbles 20pt), soft shadows, clean sans-serif font.
- The mascot appears on Home and as the bot avatar.

## MVP Scope
Build Home, Chat (text, chips, itineraryUpdate), Itinerary, and Map using mock flight, hotel, and place data. Flights, hotels, and booking via real APIs come later.