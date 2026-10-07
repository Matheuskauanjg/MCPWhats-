# Arquitetura do MCPWhats

## Visão geral

```text
                         Supabase compartilhado
                  ┌─────────────────────────────────┐
                  │ mcpwhats_settings               │
                  │ mcpwhats_state                  │
                  │ mcpwhats_health                 │
                  │                                 │
                  │ mcpwhats-storage                │
                  │ mcpwhats-keepalive              │
                  │ pg_cron / pg_net                │
                  └──────────────┬──────────────────┘
                                 │
                      persistência + keepalive
                                 │
                                 ▼
ChatGPT ── MCP/OAuth ──► Render: mcpwhats-personal ◄──► WhatsApp/Baileys
                                 │
                                 ├── SQLite /tmp (cache)
                                 └── Render Postgres (fallback)
```

## Supabase compartilhado

O MCPWhats **não precisa de um projeto Supabase próprio**.

Ele compartilha o projeto existente, mas seus dados ficam isolados por nomes e autenticação:

- tabelas `mcpwhats_*`;
- Edge Functions `mcpwhats-*`;
- segredo de sync exclusivo;
- segredo de keepalive exclusivo;
- RLS ativado;
- `anon` e `authenticated` sem acesso às tabelas do MCPWhats.

Outros schemas/tabelas do projeto não devem ser modificados por manutenção do MCPWhats.

## Storage proxy

O Render usa:

```text
SUPABASE_URL + MCPWHATS_SYNC_SECRET
```

e chama:

```text
/functions/v1/mcpwhats-storage
```

A função compara o hash SHA-256 do segredo recebido com `sync_secret_sha256`.

Operações permitidas:

- get_setting
- set_setting
- get_state
- set_state
- list_state

Ela não expõe SQL arbitrário nem acesso genérico às outras tabelas.

## Baileys

A sessão continua fisicamente em `/tmp/baileys_auth` durante a execução, mas os arquivos são serializados em base64 e espelhados para:

```text
mcpwhats_state
namespace = baileys_auth
```

Na inicialização, esses arquivos são restaurados antes de abrir o socket Baileys.

## Histórico

SQLite continua sendo cache rápido local.

Chats, contatos, mensagens e mapeamentos são espelhados para `mcpwhats_state` e reidratados no startup.

## Keepalive

```text
pg_cron (5 min)
    ↓
pg_net
    ↓
mcpwhats-keepalive
    ↓
Render /health
    ↓
mcpwhats_health
```

O GitHub Actions não participa desse fluxo.

## OAuth

```text
MCP:      https://mcpwhats-personal.onrender.com/mcp
Client:   chatgpt-mcpwhats
Callback: https://chatgpt.com/connector_platform_oauth_redirect
Scopes:   whatsapp.read whatsapp.send whatsapp.manage
```

## Fallbacks

Persistência:

```text
Supabase direto
  ↓
Supabase proxy  ← produção atual
  ↓
Render/Postgres
  ↓
local-only
```

O Render Postgres `mcpwhats-db` permanece disponível como fallback.
