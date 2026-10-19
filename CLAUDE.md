# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Toucan Trip: a chat-first AI travel planner. Next.js 15 App Router, React 19, TypeScript, Tailwind 4, Firebase Auth, Supabase (Postgres + Realtime), Gemini via `@google/genai`. It's a mobile-first single page (`app/page.tsx`, 5 tabs), and the UI ships in English and Vietnamese. The README is in Vietnamese.

## Commands

```bash
npm run dev          # http://localhost:3000
npm run build
npm run lint         # actually `tsc --noEmit` (there is no ESLint)
npm test             # tsx --test lib/*.test.ts (node:test runner)
npx tsx --test --test-name-pattern="offline revise" lib/engine.test.ts   # single test
```

Tests cover only the pure/offline parts: itinerary engine, time parsing, currency, the offline chat flow and offline revise. They need no env vars or network.

Env: copy `.env.example` → `.env.local`. Firebase and Supabase are required. `GEMINI_API_KEY` is optional; without it every AI route falls back to the rule-based offline engine.

## Architecture

**Auth bridge (Firebase → Supabase).**
- Users sign in with Firebase. The browser Supabase client (`lib/supabase.ts`) sends the Firebase ID token as its `accessToken` (Supabase third-party auth).
- `POST /api/auth/sync` runs after every sign-in. It adds the `role: "authenticated"` custom claim (without it Supabase treats the user as `anon`), upserts `profiles`, and claims pending email invites.
- In SQL the user id is the Firebase uid, a **text** value from `public.firebase_uid()` (`auth.jwt()->>'sub'`). Never use `auth.uid()`.
- API routes verify the token with `verifyRequest()` (`lib/server/auth.ts`). `supabaseAdmin()` is the service-role client and bypasses RLS; use it server-side only.

**The itinerary is the single source of truth, and the server is stateless.**
- AI routes (`/api/chat`, `/api/trips/convert`, `/api/trips/revise`) receive the whole `Trip` from the client and run tools on an in-memory copy (`ToolExecutor` in `lib/tools.ts`). They return the new trip.
- **The client persists it** through the store, and RLS decides whether that save is allowed.
- Every itinerary change goes through `applyOps` (`lib/itinerary-engine.ts`, pure) and produces a change log. The client posts that log to chat as an `itineraryUpdate` card *before* the bot's reply, so quick-reply chips stay on the latest message.

**AI engines (`lib/engines/`).**
- `gemini.ts`: the system prompt, function declarations and `runToolLoop`, a function-calling loop that ends when the model calls a "finish" tool (`reply` for chat, `finish` for revise).
- `mock.ts`: the offline rule-based planner (`handleEdit` parses edits like "add X at 9am on Day 2", "remove X", "move X to Day 3").
- Also `revise.ts` (apply approved comments), `translate.ts`, `summarize.ts` (chat compaction).
- Prices and cards come only from tool results (`lib/search.ts` is mock data, labeled SAMPLE). The model never writes prices into reply text.

**Client state.**
- `lib/app-state.tsx` (`AppProvider` / `useApp`) holds every action.
- `lib/store/supabase-store.ts` implements `TripStore`. Writes update a local cache first (optimistic), then Supabase. Realtime keeps other tabs and devices in sync.
- Under RLS, Realtime DELETE events can't be filtered and carry only the primary key. The store handles that by dropping rows by id.

**Sharing (`supabase/migrations/*_sharing.sql`).**
- Roles: the trip owner, and members with the `commenter` role (`trip_members`). Members can read the trip and comment on stops (`trip_comments`, keyed by `ItineraryItem.id`). They can't edit the trip or see its chat (`messages` is owner-only).
- Policies use the SECURITY DEFINER helpers `is_trip_owner` / `is_trip_member` so the policies on `trips` and `trip_members` don't recurse into each other.
- Member rows are created only server-side: `/api/trips/members` (invite by email), `/api/trips/join` (share link `/?join=<token>`), and invite claiming in auth sync (verified emails only).
- In the UI, gate edit controls with `isOwner(trip)`.
- Comment status flow: `open → approved | rejected → applied`.

**i18n.**
- `lib/i18n.ts` holds the `en` dictionary, which defines `MessageKey`, and a `vi: Record<MessageKey, string>`. Adding a key to `en` without adding it to `vi` fails the typecheck.
- `t(key, vars)` substitutes `{var}` placeholders.
- `Trip.language` / `Trip.currency` record what the itinerary text and costs were written in, and `ConvertDialog` offers to convert a trip when they differ from the UI language/currency.

**Database changes** go in a new timestamped file in `supabase/migrations/`. Enable RLS on every new table and grant `authenticated` exactly what it needs (`anon` gets nothing). Default privileges were revoked in `*_tighten_grants.sql`, so a new table is unreachable from the client until a migration grants access. Add the table to the `supabase_realtime` publication if the client subscribes to it. The remote project is `toucan-trip` (ref `tihtufpjwidnkpyawgxb`).

**Images.**
- Uploads go to Vercel Blob by default (`NEXT_PUBLIC_IMAGE_STORAGE=supabase` switches to the Supabase `media` bucket). Paths are `{uid}/{folder}/…`.
- `removeImage` ignores URLs the app didn't store.
- Place photos come from Wikimedia, and their `imageCredit` must be displayed.

## Conventions

- UI overlays (sheets and dialogs) are rendered through a portal at `z-[1100]` so they sit above the TabBar (`z-[1000]`). Reuse `Sheet` from `components/ui.tsx`.
- Colors come from the Tailwind theme tokens in `app/globals.css` (`primary`, `cta`, `ink`, `ink-2`, `muted`, `surface`, `line`, `primary-soft`).
- Comments in the code are terse and explain *why*. Match that density.
