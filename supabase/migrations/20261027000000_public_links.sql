-- Public, read-only view of a trip at /p/<token>, no sign-in. Only the owner manages the link. The page reads
-- with the service role by token (anon gets no table access), and shows the itinerary, cost estimate and, if
-- show_expenses, spending totals. Never names, emails, chat, comments or who owes whom.
create table public.trip_public_links (
  trip_id uuid primary key references public.trips(id) on delete cascade,
  token text not null unique check (length(token) >= 20),
  show_expenses boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.trip_public_links enable row level security;

create policy "trip_public_links: owner" on public.trip_public_links for all to authenticated
  using ((select public.is_trip_owner(trip_id)))
  with check ((select public.is_trip_owner(trip_id)));

revoke all on public.trip_public_links from anon, authenticated;
grant select, insert, update, delete on public.trip_public_links to authenticated;
