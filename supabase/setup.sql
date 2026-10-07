-- MCPWhats - schema para Supabase compartilhado
-- Este arquivo foi desenhado para coexistir com outros sistemas no mesmo projeto.
-- Ele cria/altera SOMENTE recursos mcpwhats_* e habilita pg_cron/pg_net.
-- Não coloque segredos reais neste arquivo versionado.

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

create index if not exists mcpwhats_state_namespace_updated_idx
  on public.mcpwhats_state(namespace, updated_at desc);

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

-- Configuração feita por tooling seguro, fora do Git:
--
-- sync_secret_sha256:
--   SHA-256 do MCPWHATS_SYNC_SECRET do Render.
--
-- ping_secret:
--   segredo exclusivo que autentica pg_cron -> mcpwhats-keepalive.
--
-- render_service_url:
--   URL base do Render.
--
-- Exemplo SEM valores reais:
--
-- insert into public.mcpwhats_settings(key, value)
-- values ('render_service_url', to_jsonb('https://SEU-SERVICO.onrender.com'::text))
-- on conflict (key) do update set value=excluded.value, updated_at=now();

-- Edge Functions necessárias:
--
-- supabase/functions/mcpwhats-storage/index.ts
-- supabase/functions/mcpwhats-keepalive/index.ts
--
-- Ambas usam autenticação própria do MCPWhats.

-- Cron de keepalive, depois de cadastrar ping_secret:
--
-- select cron.schedule(
--   'mcpwhats-render-keepalive',
--   '*/5 * * * *',
--   $cron$
--   select net.http_post(
--     url := 'https://SEU-PROJETO.supabase.co/functions/v1/mcpwhats-keepalive',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'x-mcpwhats-ping-secret',
--       (select value #>> '{}' from public.mcpwhats_settings where key='ping_secret')
--     ),
--     body := jsonb_build_object('time', now()),
--     timeout_milliseconds := 15000
--   );
--   $cron$
-- );
