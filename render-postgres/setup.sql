-- MCPWhats isolated Render Postgres schema.
-- The application also creates this table automatically on first DATABASE_URL connection.

create table if not exists mcpwhats_kv (
  namespace text not null,
  key text not null,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (namespace, key)
);

create index if not exists mcpwhats_kv_namespace_updated_idx
  on mcpwhats_kv(namespace, updated_at desc);
