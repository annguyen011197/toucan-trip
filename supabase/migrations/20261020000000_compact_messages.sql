-- Chat compaction: replace older messages of a trip with one `summary` message.

-- Owners may delete their own messages (compaction removes the originals).
create policy "messages: delete own" on public.messages for delete to authenticated
  using (owner_id = (select public.firebase_uid()));

grant delete on public.messages to authenticated;

-- The summary takes the timestamp of the oldest message it replaces, so order by time (seq breaks ties).
drop index public.messages_trip_seq_idx;
create index messages_trip_created_idx on public.messages (trip_id, created_at, seq);

-- Atomic swap. SECURITY INVOKER: RLS still applies, so callers can only touch their own trips.
-- Fails (nothing changes) if any message is already gone, e.g. another tab compacted first.
create function public.compact_messages(p_trip_id uuid, p_message_ids uuid[], p_summary_id uuid, p_summary text)
  returns void
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  first_at timestamptz;
  removed int;
begin
  select min(created_at) into first_at
  from public.messages
  where trip_id = p_trip_id and id = any(p_message_ids);

  with d as (
    delete from public.messages
    where trip_id = p_trip_id and id = any(p_message_ids)
    returning 1
  )
  select count(*) into removed from d;

  if removed is distinct from cardinality(p_message_ids) then
    raise exception 'messages already compacted' using errcode = 'P0001';
  end if;

  insert into public.messages (id, trip_id, role, type, text, created_at)
  values (p_summary_id, p_trip_id, 'bot', 'summary', p_summary, first_at);
end;
$$;

revoke execute on function public.compact_messages(uuid, uuid[], uuid, text) from public, anon;
grant execute on function public.compact_messages(uuid, uuid[], uuid, text) to authenticated;
