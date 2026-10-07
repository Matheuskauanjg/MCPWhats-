# MCPWhats

MCPWhats conecta um WhatsApp pessoal ao ChatGPT por **MCP + OAuth**, com leitura e envio de mensagens, áudio, imagens, respostas citadas, reações, configuração de personalidade/IA e persistência remota.

## Estado atual — 07/10/2026

| Componente | Estado |
|---|---|
| GitHub `Matheuskauanjg/MCPWhats-` | ✅ Ativo |
| Render `mcpwhats-personal` | ✅ Live |
| MCP `https://mcpwhats-personal.onrender.com/mcp` | ✅ Ativo |
| QR `https://mcpwhats-personal.onrender.com/qr` | ✅ Ativo |
| Plugin privado ChatGPT `MCPWhats` | ✅ v1.3.0 |
| Supabase compartilhado | ✅ Conectado |
| Backend de persistência | ✅ `supabase-proxy` |
| Escrita de configuração | ✅ Testada |
| Keepalive Supabase → Render | ✅ Ativo e HTTP 200 |
| WhatsApp | 🟡 Aguardando novo pareamento |
| GitHub Actions keepalive | ❌ Não usado |

> **Arquitetura correta:** MCPWhats reutiliza o Supabase compartilhado já existente. O isolamento é feito por tabelas, Edge Functions e segredos com prefixo/escopo MCPWhats. Não é necessário criar outro projeto Supabase.

## Arquitetura

```text
ChatGPT
   │ MCP + OAuth
   ▼
Render: mcpwhats-personal
   │
   ├── Baileys / WhatsApp
   ├── REST API
   ├── Auto Reply / IA
   ├── SQLite em /tmp (cache)
   │
   └── persistência
          │
          ▼
Supabase compartilhado
   │
   ├── mcpwhats_settings
   ├── mcpwhats_state
   ├── mcpwhats_health
   ├── Edge Function mcpwhats-storage
   ├── Edge Function mcpwhats-keepalive
   └── pg_cron → /health a cada 5 min
```

O Supabase é compartilhado com outros sistemas, mas o MCPWhats não reutiliza as tabelas deles.

## Persistência

O modo usado em produção é:

```text
SUPABASE_URL
      +
MCPWHATS_SYNC_SECRET
      │
      ▼
mcpwhats-storage
      │
      ▼
mcpwhats_settings / mcpwhats_state
```

O Render **não precisa receber a service_role do Supabase**. A Edge Function `mcpwhats-storage` possui autenticação própria e usa as credenciais internas do runtime Supabase.

A prioridade do código é:

```text
1. Supabase direto, se SUPABASE_SECRET_KEY estiver configurado
2. Supabase proxy, se MCPWHATS_SYNC_SECRET estiver configurado
3. PostgreSQL por DATABASE_URL
4. somente cache/arquivos locais
```

Na instalação atual, `get_mcpwhats_settings` já confirmou:

```text
persistenceBackend = supabase-proxy
supabaseEnabled = true
postgresEnabled = false
```

Uma escrita real de `runtime_config` também foi confirmada no Supabase.

### Sessão Baileys

Os arquivos da sessão são salvos no namespace:

```text
mcpwhats_state.namespace = baileys_auth
```

A sessão anterior foi perdida antes da ligação do Supabase, porque estava apenas em `/tmp`. Portanto é necessário escanear o QR **uma última vez**. Depois do pareamento, o backup da sessão será enviado ao Supabase e poderá ser restaurado após restart/redeploy.

## Supabase compartilhado

Recursos MCPWhats:

```text
public.mcpwhats_settings
public.mcpwhats_state
public.mcpwhats_health

functions/v1/mcpwhats-storage
functions/v1/mcpwhats-keepalive

cron: mcpwhats-render-keepalive
```

Todas as tabelas possuem RLS. O acesso de `anon` e `authenticated` foi revogado.

O projeto também possui tabelas e funções de outros sistemas. **Não altere recursos não prefixados com `mcpwhats_` ao fazer manutenção do MCPWhats.**

## Keepalive

O GitHub **não** faz keepalive.

Fluxo:

```text
Supabase pg_cron
   │ */5 * * * *
   ▼
pg_net
   ▼
mcpwhats-keepalive
   ▼
GET https://mcpwhats-personal.onrender.com/health?source=supabase-keepalive
   ▼
mcpwhats_health
```

O fluxo foi testado e registrou:

```text
ok = true
status = 200
```

## Render

Serviço:

```text
mcpwhats-personal
https://mcpwhats-personal.onrender.com
```

Rotas:

```text
GET  /health
GET  /qr
POST /mcp
GET  /api/status
GET  /api/chats
GET  /api/search
POST /api/send
POST /api/react
POST /api/send-image
POST /api/audio
```

Portas internas:

| Porta | Uso |
|---|---|
| 10000 | proxy público |
| 10001 | Baileys + REST |
| 10002 | MCP/OAuth |
| 10003 | áudio/transcrição |

## Variáveis do Render

Obrigatórias do serviço:

```env
PUBLIC_BASE_URL=https://mcpwhats-personal.onrender.com
API_TOKEN=
MCP_LOGIN_SECRET=
QR_SECRET=

SUPABASE_URL=
MCPWHATS_SYNC_SECRET=
```

Alternativas de persistência:

```env
# acesso Supabase direto, opcional:
SUPABASE_SECRET_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# PostgreSQL fallback:
DATABASE_URL=
```

Nunca commite valores reais de segredos.

## OAuth / Plugin ChatGPT

Endpoint:

```text
https://mcpwhats-personal.onrender.com/mcp
```

Cliente:

```text
chatgpt-mcpwhats
```

Callback:

```text
https://chatgpt.com/connector_platform_oauth_redirect
```

Escopos:

- `whatsapp.read`
- `whatsapp.send`
- `whatsapp.manage`

O plugin privado existente foi atualizado em vez de duplicado.

## Ferramentas MCP

- `whatsapp_status`
- `list_whatsapp_chats`
- `read_whatsapp_messages`
- `read_whatsapp_audio`
- `search_whatsapp_messages`
- `whatsapp_storage_stats`
- `send_whatsapp_message`
- `react_whatsapp_message`
- `send_whatsapp_image`
- `get_mcpwhats_settings`
- `edit_whatsapp_personality`
- `configure_whatsapp_ai`

## QR

Abra:

```text
https://mcpwhats-personal.onrender.com/qr
```

A página do QR pode ser lida sem colocar `QR_SECRET` na URL. Ações administrativas, como resetar sessão e gerar código de pareamento, continuam protegidas.

## IA

Provedores suportados:

- Groq
- NVIDIA NIM
- Gemini

Configuração:

```env
AI_PROVIDER=auto
AI_TEMPERATURE=0.82
GROQ_API_KEY=
GEMINI_API_KEY=
NVIDIA_API_KEY=
```

As chaves continuam em variáveis secretas do Render; as ferramentas MCP alteram somente provedor, modelos, temperatura e personalidade.

## Render Postgres

O banco `mcpwhats-db` existe como fallback. Na instalação atual ele **não é o backend primário**, porque o Supabase compartilhado está ativo.

## Segurança

Nunca colocar no GitHub:

```text
API_TOKEN
MCP_LOGIN_SECRET
QR_SECRET
MCPWHATS_SYNC_SECRET
SUPABASE_SECRET_KEY
SUPABASE_SERVICE_ROLE_KEY
DATABASE_URL
GROQ_API_KEY
GEMINI_API_KEY
NVIDIA_API_KEY
```

## Documentação

- [Estado atual](docs/CURRENT_STATUS.md)
- [Arquitetura](docs/ARCHITECTURE.md)
- [Keepalive Supabase](docs/SUPABASE_KEEPALIVE.md)
- [Checklist de implantação](docs/DEPLOYMENT_CHECKLIST.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)

## Regra operacional

```text
GitHub       = código + CI
Render       = executa MCPWhats
Supabase     = persistência + keepalive
SQLite /tmp  = cache
Render DB    = fallback

GitHub NÃO faz o ping.
O Supabase é compartilhado, mas os dados do MCPWhats são isolados.
```
