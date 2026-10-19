-- Toucan Trip schema. Users sign in with Firebase Auth (Supabase third-party auth),
-- so the user id is the Firebase uid in the JWT `sub` claim (text, not a uuid: don't use auth.uid()).

create or replace function public.firebase_uid()
  returns text
  language sql
  stable
  set search_path = ''
  return auth.jwt()->>'sub';

-- ───────────── profiles: one row per Firebase user, synced by /api/auth/sync ─────────────
create table public.profiles (
  id text primary key,
  email text,
  display_name text,
  photo_url text,
  -- App preferences (UserProfile): name, interests, budget, pace, diet, home airport, avatar.
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_sign_in_at timestamptz
);

alter table public.profiles enable row level security;

create policy "profiles: read own" on public.profiles for select to authenticated
  using (id = (select public.firebase_uid()));

create policy "profiles: update own" on public.profiles for update to authenticated
  using (id = (select public.firebase_uid()))
  with check (id = (select public.firebase_uid()));

-- ───────────── trips ─────────────
create table public.trips (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default public.firebase_uid() references public.profiles(id) on delete cascade,
  title text not null,
  destination text,
  origin text,
  start_date date,
  end_date date,
  travelers int,
  budget text,
  interests text[] not null default '{}',
  status text not null default 'dreaming' check (status in ('dreaming', 'upcoming', 'ongoing', 'past')),
  cover_image_url text,
  hotel jsonb,
  itinerary jsonb not null default '[]'::jsonb,
  currency text not null default 'USD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index trips_owner_updated_idx on public.trips (owner_id, updated_at desc);

alter table public.trips enable row level security;

create policy "trips: read own" on public.trips for select to authenticated
  using (owner_id = (select public.firebase_uid()));

create policy "trips: insert own" on public.trips for insert to authenticated
  with check (owner_id = (select public.firebase_uid()));

create policy "trips: update own" on public.trips for update to authenticated
  using (owner_id = (select public.firebase_uid()))
  with check (owner_id = (select public.firebase_uid()));

create policy "trips: delete own" on public.trips for delete to authenticated
  using (owner_id = (select public.firebase_uid()));

-- ───────────── messages: append-only chat log per trip ─────────────
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  trip_id uuid not null references public.trips(id) on delete cascade,
  owner_id text not null default public.firebase_uid(),
  role text not null check (role in ('user', 'bot')),
  type text not null,
  text text not null default '',
  quick_replies text[] not null default '{}',
  cards jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index messages_trip_seq_idx on public.messages (trip_id, seq);
create index messages_owner_idx on public.messages (owner_id);

alter table public.messages enable row level security;

create policy "messages: read own" on public.messages for select to authenticated
  using (owner_id = (select public.firebase_uid()));

create policy "messages: insert into own trips" on public.messages for insert to authenticated
  with check (
    owner_id = (select public.firebase_uid())
    and exists (select 1 from public.trips t where t.id = trip_id and t.owner_id = (select public.firebase_uid()))
  );

-- ───────────── Data API grants (new tables aren't exposed by default) ─────────────
revoke all on public.profiles, public.trips, public.messages from anon;
grant select, update (display_name, preferences, updated_at) on public.profiles to authenticated;
grant select, insert, update, delete on public.trips to authenticated;
grant select, insert on public.messages to authenticated;

-- ───────────── Realtime ─────────────
alter publication supabase_realtime add table public.trips, public.messages;

-- ───────────── Storage: trip covers + avatars, one folder per user ─────────────
-- Public bucket: files are readable by URL (paths contain random ids); writes are owner-only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

create policy "media: read own" on storage.objects for select to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select public.firebase_uid()));

create policy "media: upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = (select public.firebase_uid()));

create policy "media: update own" on storage.objects for update to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select public.firebase_uid()))
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = (select public.firebase_uid()));

create policy "media: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select public.firebase_uid()));
