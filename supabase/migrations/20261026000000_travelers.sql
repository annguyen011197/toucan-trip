-- Who is actually going on the trip, separate from who can see it. The owner always goes (not stored).
-- user_id set = a member with the app; user_id null = a virtual traveler (name only) the owner added, which can
-- later be linked to a real member (/api/trips/travelers/link rewrites their expenses to the new key).
-- Expense keys: user id for real travelers, "traveler:<id>" for virtual ones.

create table public.trip_travelers (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id text references public.profiles(id) on delete set null,
  name text not null default '' check (length(name) <= 60),
  created_by text not null default public.firebase_uid(),
  created_at timestamptz not null default now(),
  check (user_id is not null or length(trim(name)) > 0)
);

create unique index trip_travelers_trip_user_idx on public.trip_travelers (trip_id, user_id) where user_id is not null;
create index trip_travelers_trip_idx on public.trip_travelers (trip_id, created_at);
create index trip_travelers_user_idx on public.trip_travelers (user_id);

alter table public.trip_travelers enable row level security;

create policy "trip_travelers: read" on public.trip_travelers for select to authenticated
  using ((select public.is_trip_owner(trip_id)) or (select public.is_trip_member(trip_id)));

-- Owner adds virtual travelers or members of the trip; a member can add themselves ("I'm going").
create policy "trip_travelers: insert" on public.trip_travelers for insert to authenticated
  with check (
    created_by = (select public.firebase_uid())
    and (
      ((select public.is_trip_owner(trip_id)) and (
        user_id is null
        or exists (select 1 from public.trip_members m where m.trip_id = trip_travelers.trip_id and m.user_id = trip_travelers.user_id)))
      or (user_id = (select public.firebase_uid()) and (select public.is_trip_member(trip_id)))
    )
  );

-- Owner renames (column grant below: name only).
create policy "trip_travelers: update" on public.trip_travelers for update to authenticated
  using ((select public.is_trip_owner(trip_id)))
  with check ((select public.is_trip_owner(trip_id)));

create policy "trip_travelers: delete" on public.trip_travelers for delete to authenticated
  using ((select public.is_trip_owner(trip_id)) or user_id = (select public.firebase_uid()));

revoke all on public.trip_travelers from anon, authenticated;
grant select, insert, delete on public.trip_travelers to authenticated;
grant update (name) on public.trip_travelers to authenticated;

alter publication supabase_realtime add table public.trip_travelers;
