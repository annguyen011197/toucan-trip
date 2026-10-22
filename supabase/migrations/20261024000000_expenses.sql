-- Actual spending during a trip. The owner and members (travel buddies) log what they paid; each row keeps
-- the currency it was paid in, and the client converts to the trip currency for totals.

create table public.trip_expenses (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  -- Optional link to the stop it was spent at (ItineraryItem.id in trips.itinerary); day is kept separately so
  -- an expense still groups correctly after its stop is moved or removed.
  item_id text,
  day int check (day is null or day > 0),
  title text not null check (length(title) between 1 and 200),
  amount numeric(16, 2) not null check (amount >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  category text not null default 'other'
    check (category in ('food', 'sight', 'activity', 'transport', 'hotel', 'shopping', 'nightlife', 'other')),
  note text not null default '' check (length(note) <= 1000),
  author_id text not null default public.firebase_uid() references public.profiles(id) on delete cascade,
  author_name text not null default '',
  spent_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index trip_expenses_trip_spent_idx on public.trip_expenses (trip_id, spent_at);
create index trip_expenses_author_idx on public.trip_expenses (author_id);

alter table public.trip_expenses enable row level security;

create policy "trip_expenses: read" on public.trip_expenses for select to authenticated
  using ((select public.is_trip_owner(trip_id)) or (select public.is_trip_member(trip_id)));

create policy "trip_expenses: insert" on public.trip_expenses for insert to authenticated
  with check (
    author_id = (select public.firebase_uid())
    and ((select public.is_trip_owner(trip_id)) or (select public.is_trip_member(trip_id)))
  );

-- Authors edit their own rows (column grants below keep trip_id/author fixed).
create policy "trip_expenses: update own" on public.trip_expenses for update to authenticated
  using (author_id = (select public.firebase_uid()))
  with check (author_id = (select public.firebase_uid()));

create policy "trip_expenses: delete" on public.trip_expenses for delete to authenticated
  using (author_id = (select public.firebase_uid()) or (select public.is_trip_owner(trip_id)));

revoke all on public.trip_expenses from anon, authenticated;
grant select, insert, delete on public.trip_expenses to authenticated;
grant update (item_id, day, title, amount, currency, category, note, spent_at) on public.trip_expenses to authenticated;

alter publication supabase_realtime add table public.trip_expenses;
