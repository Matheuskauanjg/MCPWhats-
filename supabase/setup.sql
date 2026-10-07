-- MCPWhats - Supabase setup
-- Execute ONLY in the dedicated MCPWhats Supabase project. Do not apply this schema to Giro or any other existing project.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create table if not exists public.mcpwhats_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.mcpwhats_state (
  namespace text not null,
  key text not null,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (namespace, key)
);

create table if not exists public.mcpwhats_health (
  id bigint generated always as identity primary key,
  source text not null default 'supabase-keepalive',
  ok boolean not null default false,
  status integer,
  latency_ms integer,
  detail text,
  created_at timestamptz not null default now()
);

alter table public.mcpwhats_settings enable row level security;
alter table public.mcpwhats_state enable row level security;
alter table public.mcpwhats_health enable row level security;

revoke all on table public.mcpwhats_settings from anon, authenticated;
revoke all on table public.mcpwhats_state from anon, authenticated;
revoke all on table public.mcpwhats_health from anon, authenticated;
revoke all on sequence public.mcpwhats_health_id_seq from anon, authenticated;

grant select, insert, update, delete on table public.mcpwhats_settings to service_role;
grant select, insert, update, delete on table public.mcpwhats_state to service_role;
grant select, insert on table public.mcpwhats_health to service_role;
grant usage, select on sequence public.mcpwhats_health_id_seq to service_role;

-- Keepalive secrets are intentionally generated server-side.
do $$
declare
  ping_secret text := encode(gen_random_bytes(32), 'hex');
begin
  if not exists (select 1 from vault.secrets where name = 'mcpwhats_ping_secret') then
    perform vault.create_secret(ping_secret, 'mcpwhats_ping_secret');
    insert into public.mcpwhats_settings(key, value, updated_at)
    values ('ping_secret', to_jsonb(ping_secret), now())
    on conflict (key) do update set value = excluded.value, updated_at = now();
  end if;
end $$;

-- Replace this placeholder only after the dedicated MCPWhats Supabase project exists.
-- select vault.create_secret('https://SEU-PROJETO.supabase.co', 'mcpwhats_project_url');

-- After deploying the mcpwhats-keepalive Edge Function in the dedicated project, schedule it.
-- This cron is the ONLY intended keepalive source for the Render service:
-- select cron.schedule(
--   'mcpwhats-render-keepalive',
--   '*/5 * * * *',
--   $cron$
--   select net.http_post(
--     url := (select decrypted_secret from vault.decrypted_secrets where name = 'mcpwhats_project_url')
--            || '/functions/v1/mcpwhats-keepalive',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'x-mcpwhats-ping-secret',
--       (select decrypted_secret from vault.decrypted_secrets where name = 'mcpwhats_ping_secret')
--     ),
--     body := jsonb_build_object('time', now()),
--     timeout_milliseconds := 15000
--   );
--   $cron$
-- );
