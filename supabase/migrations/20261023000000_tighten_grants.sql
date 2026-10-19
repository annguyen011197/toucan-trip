-- The project's default privileges give `authenticated` every privilege on new public tables, so the
-- narrower grants in earlier migrations were no-ops. Reset to exactly what the app needs.
-- Matters for sharing: invites are matched by profiles.email, so users must not be able to edit it.

revoke all on public.profiles, public.trips, public.messages,
  public.trip_members, public.trip_share_links, public.trip_comments from anon, authenticated;

grant select, update (display_name, preferences, updated_at) on public.profiles to authenticated;
grant select, insert, update, delete on public.trips to authenticated;
grant select, insert, delete on public.messages to authenticated;
grant select, delete on public.trip_members to authenticated;
grant select, insert, update, delete on public.trip_share_links to authenticated;
grant select, insert, delete on public.trip_comments to authenticated;
grant update (status, resolved_at) on public.trip_comments to authenticated;

-- Keep future tables locked down until a migration grants access explicitly.
alter default privileges in schema public revoke all on tables from anon, authenticated;
