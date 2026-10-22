-- Splitwise-style sharing: who paid an expense and how it's split. Keys are Firebase uids or "guest:<name>" for
-- people without an account. Share amounts are in the expense's own currency and add up to its amount.
-- Null paid_by = the author paid (rows from before this migration); null split = the payer's own expense.

alter table public.trip_expenses
  add column paid_by text check (paid_by is null or length(paid_by) between 1 and 200),
  add column paid_by_name text not null default '' check (length(paid_by_name) <= 100),
  add column split jsonb check (split is null or (jsonb_typeof(split) = 'object' and jsonb_typeof(split->'shares') = 'array'));

grant update (paid_by, paid_by_name, split) on public.trip_expenses to authenticated;
