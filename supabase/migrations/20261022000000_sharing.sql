-- Sharing: the owner invites people by email or with a share link. Members can read the trip and
-- comment on its stops; only the owner edits the trip and reviews (approves/rejects) comments.

-- ───────────── trip_members ─────────────
-- Rows are created server-side only (/api/trips/members, /api/trips/join). An email invite for someone
-- without an account has user_id null until they sign in with that (verified) email (/api/auth/sync).
create table public.trip_members (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id text references public.profiles(id) on delete cascade,
  email text,
  display_name text,
  role text not null default 'commenter' check (role in ('commenter')),
  invited_by text not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (user_id is not null or email is not null)
);

create unique index trip_members_trip_user_idx on public.trip_members (trip_id, user_id);
create unique index trip_members_trip_email_idx on public.trip_members (trip_id, lower(email));
create index trip_members_user_idx on public.trip_members (user_id);
create index trip_members_pending_email_idx on public.trip_members (lower(email)) where user_id is null;

-- SECURITY DEFINER helpers: policies on trips and trip_members reference each other, which would recurse.
create function public.is_trip_owner(p_trip_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
  return exists (select 1 from public.trips t where t.id = p_trip_id and t.owner_id = (select public.firebase_uid()));

create function public.is_trip_member(p_trip_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
  return exists (select 1 from public.trip_members m where m.trip_id = p_trip_id and m.user_id = (select public.firebase_uid()));

revoke execute on function public.is_trip_owner(uuid), public.is_trip_member(uuid) from public, anon;
grant execute on function public.is_trip_owner(uuid), public.is_trip_member(uuid) to authenticated;

alter table public.trip_members enable row level security;

-- Owner and every member see the member list.
create policy "trip_members: read" on public.trip_members for select to authenticated
  using ((select public.is_trip_owner(trip_id)) or (select public.is_trip_member(trip_id)));

-- Owner removes anyone; a member can leave.
create policy "trip_members: delete" on public.trip_members for delete to authenticated
  using ((select public.is_trip_owner(trip_id)) or user_id = (select public.firebase_uid()));

-- ───────────── trips: members can read ─────────────
create policy "trips: read shared" on public.trips for select to authenticated
  using ((select public.is_trip_member(id)));

-- ───────────── trip_share_links: one "anyone with the link can comment" token per trip ─────────────
create table public.trip_share_links (
  trip_id uuid primary key references public.trips(id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now()
);

alter table public.trip_share_links enable row level security;

create policy "trip_share_links: owner" on public.trip_share_links for all to authenticated
  using ((select public.is_trip_owner(trip_id)))
  with check ((select public.is_trip_owner(trip_id)));

-- ───────────── trip_comments: feedback on one stop ─────────────
create table public.trip_comments (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  -- ItineraryItem.id (lives in trips.itinerary jsonb). Day and title are snapshots, so a comment still
  -- reads well after its stop is moved or removed.
  item_id text not null,
  day int,
  item_title text not null default '',
  author_id text not null default public.firebase_uid() references public.profiles(id) on delete cascade,
  author_name text not null default '',
  text text not null check (length(text) between 1 and 2000),
  -- open → approved | rejected (owner review) → applied (approved and merged into the itinerary by AI)
  status text not null default 'open' check (status in ('open', 'approved', 'rejected', 'applied')),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index trip_comments_trip_created_idx on public.trip_comments (trip_id, created_at);
create index trip_comments_author_idx on public.trip_comments (author_id);

alter table public.trip_comments enable row level security;

create policy "trip_comments: read" on public.trip_comments for select to authenticated
  using ((select public.is_trip_owner(trip_id)) or (select public.is_trip_member(trip_id)));

create policy "trip_comments: insert" on public.trip_comments for insert to authenticated
  with check (
    author_id = (select public.firebase_uid())
    and status = 'open'
    and ((select public.is_trip_owner(trip_id)) or (select public.is_trip_member(trip_id)))
  );

-- Only the owner reviews (column grants below limit updates to status + resolved_at).
create policy "trip_comments: review" on public.trip_comments for update to authenticated
  using ((select public.is_trip_owner(trip_id)))
  with check ((select public.is_trip_owner(trip_id)));

create policy "trip_comments: delete" on public.trip_comments for delete to authenticated
  using (author_id = (select public.firebase_uid()) or (select public.is_trip_owner(trip_id)));

-- ───────────── Data API grants ─────────────
revoke all on public.trip_members, public.trip_share_links, public.trip_comments from anon;
grant select, delete on public.trip_members to authenticated;
grant select, insert, update, delete on public.trip_share_links to authenticated;
grant select, insert, delete on public.trip_comments to authenticated;
grant update (status, resolved_at) on public.trip_comments to authenticated;

-- ───────────── Realtime ─────────────
alter publication supabase_realtime add table public.trip_members, public.trip_comments;
