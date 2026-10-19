-- Language the itinerary text was written in, so the app can offer to convert it when the UI language changes.
-- Existing trips were all planned in English.
alter table public.trips
  add column language text not null default 'en' check (language in ('en', 'vi'));
