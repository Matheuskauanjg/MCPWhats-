# Arquitetura do MCPWhats

## Objetivo

O MCPWhats conecta um WhatsApp pessoal ao ChatGPT usando MCP + OAuth e também pode executar respostas automáticas com provedores externos de IA.

O projeto é isolado dos serviços anteriores.

## Arquitetura final desejada

```text
                         ┌─────────────────────────────┐
                         │       Supabase MCPWhats     │
                         │   projeto EXCLUSIVO novo    │
                         │                             │
                         │  pg_cron ──► Edge Function │
                         │      │          │            │
                         │      │          └────────────┼────► GET /health
                         │      │                       │
                         │  settings/state/health      │
                         └─────────────┬───────────────┘
                                       │
                                       │ persistência
                                       ▼
┌──────────┐      ┌────────────────────────────────────────────┐
│ WhatsApp │◄────►│ Render: mcpwhats-personal                 │
└──────────┘      │                                            │
                  │ Baileys / REST interno          :10001     │
                  │ Audio proxy                     :10003     │
                  │ MCP/OAuth interno               :10002     │
                  │ Proxy público / Render PORT     :10000     │
                  │                                            │
                  │ /health  /qr  /mcp  /api/*                 │
                  └──────────────┬─────────────────────────────┘
                                 │
                                 │ fallback de persistência
                                 ▼
                  ┌────────────────────────────────────────────┐
                  │ Render Postgres: mcpwhats-db              │
                  │ recurso EXCLUSIVO                         │
                  └────────────────────────────────────────────┘
```

## Responsabilidade de cada componente

### GitHub

O GitHub é a fonte do código.

Ele contém:

- bridge WhatsApp;
- MCP/OAuth;
- proxy público;
- auto reply;
- camada de persistência;
- schema Supabase;
- Edge Function;
- schema do Render Postgres;
- `render.yaml`;
- CI;
- documentação.

O GitHub **não é o keepalive**.

### Render Web Service

O Render executa o processo Node.js continuamente enquanto a instância estiver ativa.

Serviço:

```text
mcpwhats-personal
```

URL:

```text
https://mcpwhats-personal.onrender.com
```

### Portas

| Porta | Uso |
|---|---|
| `10000` | Proxy HTTP público ligado ao `PORT` do Render |
| `10001` | Bridge WhatsApp/Baileys e REST interno |
| `10002` | MCP/OAuth interno |
| `10003` | Proxy de áudio/transcrição |

Somente a porta pública do Render deve ser exposta externamente.

## Fluxo MCP

```text
ChatGPT
   │
   │ HTTPS + OAuth
   ▼
https://mcpwhats-personal.onrender.com/mcp
   │
   ▼
public-mcp-proxy.js
   │
   ▼
mcp-gateway-v5.js
   │
   ▼
Bridge WhatsApp
   │
   ▼
Baileys
   │
   ▼
WhatsApp
```

## OAuth

O cliente interno dedicado usa:

```text
chatgpt-mcpwhats
```

Callback esperado:

```text
https://chatgpt.com/connector_platform_oauth_redirect
```

Escopos:

- `whatsapp.read`;
- `whatsapp.send`;
- `whatsapp.manage`.

`MCP_LOGIN_SECRET` protege a autorização do conector.

## Persistência

Existem três níveis possíveis.

### 1. Supabase

É o backend persistente preferido quando o projeto exclusivo existir.

Pode armazenar:

- sessão do Baileys;
- configurações;
- personalidade;
- estado do auto reply;
- chats;
- contatos;
- mensagens/metadados;
- mapeamentos de JID;
- histórico do keepalive.

### 2. Render Postgres

É o fallback persistente independente.

O código usa a tabela:

```text
mcpwhats_kv
```

O schema está em:

```text
render-postgres/setup.sql
```

Quando `DATABASE_URL` está configurado e o Supabase não está configurado, essa persistência pode assumir o armazenamento remoto.

### 3. SQLite local

O arquivo local continua sendo utilizado como cache de alta velocidade:

```text
/tmp/whatsapp.sqlite
```

No Render Free, `/tmp` é efêmero e nunca deve ser considerado a única fonte permanente.

## Prioridade do backend

A camada `src/supabase-sync.js` seleciona o backend nesta ordem:

```text
1. Supabase configurado
2. DATABASE_URL / PostgreSQL
3. somente arquivos/SQLite locais
```

O nome histórico do arquivo `supabase-sync.js` foi mantido, mas hoje ele também contém o fallback PostgreSQL.

## Keepalive

O keepalive pertence ao Supabase.

Fluxo:

```text
pg_cron
  │
  ▼
net.http_post
  │
  ▼
Supabase Edge Function
  │
  ▼
GET /health?source=supabase-keepalive
  │
  ▼
Render
```

A Edge Function registra o resultado em `mcpwhats_health`.

## Auto Reply e IA

Provedores suportados:

- Groq;
- NVIDIA NIM;
- Gemini.

No modo `auto`, somente provedores com chave configurada são tentados.

A personalidade e os modelos podem ser alterados pelo MCP sem gravar chaves de API no banco.

## Segurança

Nunca colocar no GitHub:

- `API_TOKEN`;
- `MCP_LOGIN_SECRET`;
- `QR_SECRET`;
- `SUPABASE_SECRET_KEY`;
- `SUPABASE_SERVICE_ROLE_KEY`;
- `GROQ_API_KEY`;
- `GEMINI_API_KEY`;
- `NVIDIA_API_KEY`;
- `DATABASE_URL` com senha.

O repositório deve conter apenas placeholders e código reproduzível.
