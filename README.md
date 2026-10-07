# MCPWhats

MCPWhats conecta um WhatsApp pessoal ao ChatGPT por **MCP + OAuth**, expõe uma API REST própria, permite automações/respostas com IA e foi preparado para rodar em um serviço Render exclusivo com persistência separada.

> **Decisão de arquitetura:** o keepalive do Render deve ser feito pelo **Supabase**, não pelo GitHub Actions.

## Estado atual

Snapshot: **07/10/2026**.

| Item | Estado |
|---|---|
| Repositório GitHub | ✅ Ativo |
| Render `mcpwhats-personal` | ✅ Criado e funcionando |
| `https://mcpwhats-personal.onrender.com/health` | ✅ HTTP 200 validado |
| MCP público `/mcp` | ✅ Disponível |
| WhatsApp/Baileys | 🟡 Aguardando leitura do QR |
| Render Postgres `mcpwhats-db` | ✅ Criado e separado |
| Supabase exclusivo `MCPWhats` | ⛔ Ainda não pôde ser criado |
| Supabase keepalive | ⏸️ Código pronto, não ativado |
| GitHub keepalive | ❌ Removido |

A criação de um novo projeto Supabase Free foi recusada pela própria plataforma porque a conta atingiu o limite de projetos Free ativos. **Nenhum Supabase antigo será reutilizado para o MCPWhats.**

Leia antes de alterar infraestrutura:

- [Estado atual](docs/CURRENT_STATUS.md)
- [Arquitetura completa](docs/ARCHITECTURE.md)
- [Supabase Keepalive](docs/SUPABASE_KEEPALIVE.md)

---

## Arquitetura final

```text
Supabase MCPWhats NOVO
   │
   ├── pg_cron a cada 5 min
   │       │
   │       ▼
   │   Edge Function
   │   mcpwhats-keepalive
   │       │
   │       ▼
   │   GET /health
   │
   ├── mcpwhats_settings
   ├── mcpwhats_state
   └── mcpwhats_health
           │
           ▼
Render exclusivo
mcpwhats-personal
   │
   ├── WhatsApp/Baileys
   ├── MCP/OAuth
   ├── REST API
   ├── Auto Reply
   └── SQLite local/cache
           │
           ▼
Render Postgres
mcpwhats-db
(fallback de persistência)
```

O GitHub contém código, configuração, CI e documentação. **O GitHub não é responsável por manter o Render acordado.**

---

## Recursos já criados

### Render Web Service

```text
Nome: mcpwhats-personal
URL:  https://mcpwhats-personal.onrender.com
```

Principais endpoints:

```text
GET  /health
GET  /qr
POST /mcp
GET  /api/status
GET  /api/chats
POST /api/send
...
```

### Render PostgreSQL

```text
Nome: mcpwhats-db
Banco: mcpwhats_db
```

Esse banco é exclusivo do MCPWhats e pode ser usado quando `DATABASE_URL` estiver configurado.

Ele **não substitui o Supabase no keepalive**.

---

## Por que o Supabase ainda não está ativo

Foi tentada a criação de um novo projeto:

```text
Nome: MCPWhats
Região: sa-east-1
Plano: Free
```

O Supabase recusou a criação porque a conta já atingiu o limite de projetos Free ativos.

Para manter o isolamento solicitado:

- nenhum projeto existente foi reutilizado;
- nenhum projeto foi pausado automaticamente;
- nenhum projeto foi apagado automaticamente;
- nenhum cron antigo foi reaproveitado.

Quando uma vaga de projeto estiver disponível, o Supabase exclusivo poderá ser criado e o keepalive será ativado nele.

---

# 1. Supabase

## Arquivos

```text
supabase/setup.sql
supabase/functions/mcpwhats-keepalive/index.ts
supabase/functions/mcpwhats-keepalive/deno.json
```

## O que o projeto exclusivo vai armazenar

Quando configurado, o Supabase pode armazenar:

- sessão Baileys;
- configurações do MCPWhats;
- personalidade;
- estado do auto reply;
- chats;
- contatos;
- mensagens/metadados;
- mapeamentos LID/JID;
- histórico do keepalive.

## Tabelas

```text
mcpwhats_settings
mcpwhats_state
mcpwhats_health
```

As tabelas são criadas com RLS e não devem conceder acesso a `anon` ou `authenticated`.

## Chave backend

Preferência:

```env
SUPABASE_SECRET_KEY=sb_secret_...
```

Compatibilidade legada:

```env
SUPABASE_SERVICE_ROLE_KEY=...
```

Nunca envie essas chaves para frontend e nunca faça commit delas.

---

# 2. Keepalive: Supabase → Render

O fluxo correto é:

```text
pg_cron
   │
   ▼
net.http_post
   │
   ▼
mcpwhats-keepalive
   │
   ▼
GET https://mcpwhats-personal.onrender.com/health?source=supabase-keepalive
```

Frequência:

```text
*/5 * * * *
```

A Edge Function registra cada tentativa em:

```text
public.mcpwhats_health
```

Com:

- sucesso/erro;
- status HTTP;
- latência;
- detalhe;
- data/hora.

O procedimento completo está em [docs/SUPABASE_KEEPALIVE.md](docs/SUPABASE_KEEPALIVE.md).

## Importante

Não recrie:

```text
.github/workflows/render-keepalive.yml
```

Esse workflow foi removido de propósito.

---

# 3. Persistência

O MCPWhats aceita três níveis.

## Supabase

Backend preferido quando o projeto exclusivo estiver disponível.

## PostgreSQL pelo `DATABASE_URL`

Fallback remoto, inclusive para o `mcpwhats-db` criado no Render.

Schema:

```text
render-postgres/setup.sql
```

Tabela principal:

```text
mcpwhats_kv
```

## SQLite local

Cache rápido:

```text
/tmp/whatsapp.sqlite
```

No Render Free, `/tmp` é efêmero.

Prioridade:

```text
Supabase
   ↓
PostgreSQL / DATABASE_URL
   ↓
SQLite/arquivos locais
```

---

# 4. Render

O repositório possui:

```text
render.yaml
```

Ele descreve:

- web service `mcpwhats-personal`;
- PostgreSQL `mcpwhats-db`;
- `DATABASE_URL` via vínculo do banco;
- variáveis não secretas;
- variáveis secretas como `sync: false`.

Configuração principal:

```text
Runtime: Node
Branch: main
Build: npm install --omit=dev
Start: npm start
Health: /health
```

---

# 5. Variáveis de ambiente

Use [.env.example](.env.example).

## Bridge/MCP

```env
PORT=10000
PUBLIC_BASE_URL=https://mcpwhats-personal.onrender.com

API_TOKEN=
MCP_LOGIN_SECRET=
QR_SECRET=
```

## Persistência PostgreSQL

```env
DATABASE_URL=
PERSISTENCE_BACKUP_INTERVAL_MS=120000
```

## Supabase

Somente quando existir o projeto Supabase exclusivo:

```env
SUPABASE_URL=https://SEU-PROJETO.supabase.co
SUPABASE_SECRET_KEY=
```

## IA

```env
AI_PROVIDER=auto
AI_TEMPERATURE=0.82

GROQ_API_KEY=
GROQ_REPLY_MODEL=openai/gpt-oss-20b

GEMINI_API_KEY=
GEMINI_REPLY_MODEL=gemini-3.5-flash-lite

NVIDIA_API_KEY=
NVIDIA_REPLY_MODEL=openai/gpt-oss-20b
```

`AI_PROVIDER`:

```text
auto
groq
gemini
nvidia
```

---

# 6. Portas

| Porta | Função |
|---|---|
| `10000` | proxy público do Render |
| `10001` | WhatsApp/Baileys + REST interno |
| `10002` | MCP/OAuth interno |
| `10003` | proxy de áudio |

---

# 7. Parear WhatsApp

Depois do deploy:

```text
https://mcpwhats-personal.onrender.com/qr
```

O endpoint `/health` indica, entre outras coisas:

- estado do WhatsApp;
- se existe QR;
- quantidade de chats;
- caminho do cache SQLite;
- último erro.

Um estado esperado antes do pareamento é:

```text
waiting_for_qr_scan
```

---

# 8. MCP + ChatGPT

Endpoint:

```text
https://mcpwhats-personal.onrender.com/mcp
```

Cliente OAuth interno:

```text
chatgpt-mcpwhats
```

Callback:

```text
https://chatgpt.com/connector_platform_oauth_redirect
```

Escopos:

- `whatsapp.read`;
- `whatsapp.send`;
- `whatsapp.manage`.

---

# 9. Ferramentas MCP

Entre as ferramentas disponíveis:

- status do WhatsApp;
- listar chats;
- ler mensagens;
- pesquisar histórico;
- ler/transcrever áudio;
- enviar mensagens;
- responder citando;
- mencionar;
- reagir;
- enviar imagem;
- consultar armazenamento;
- consultar configuração;
- editar personalidade;
- configurar IA.

## Configuração dinâmica

### `get_mcpwhats_settings`

Consulta:

- provedor de IA;
- modelos;
- temperatura;
- personalidade;
- presença das chaves.

Nunca retorna a chave secreta em si.

### `edit_whatsapp_personality`

Permite alterar comportamento sem redeploy.

Exemplo:

```text
Mude a personalidade para responder curto, natural e informal,
mas use tom profissional quando a conversa for de trabalho.
```

### `configure_whatsapp_ai`

Exemplo:

```text
Use NVIDIA como principal e temperatura 0.7.
```

---

# 10. Auto Reply

O sistema é orientado por eventos do Baileys.

Controle por:

```env
AUTO_REPLY_CONTROL_JID=
AUTO_REPLY_CONTROL_NUMBER=
```

Exemplos de comando:

```text
auto on
auto off
auto status

ordem: <instrução>
recado: <contexto>

ordens
recados
agenda

pausa o automático por 1 hora
retomar automático
```

---

# 11. REST API

Rotas `/api/*` usam:

```http
Authorization: Bearer SEU_API_TOKEN
```

ou:

```http
x-api-key: SEU_API_TOKEN
```

Principais endpoints:

```text
GET  /api/status
GET  /api/chats?limit=30
GET  /api/chats/:chatId/messages?limit=30
GET  /api/search?q=texto
GET  /api/db-stats
POST /api/send
POST /api/react
POST /api/send-image
POST /api/audio
```

---

# 12. Segurança

Nunca commite:

```text
API_TOKEN
MCP_LOGIN_SECRET
QR_SECRET
DATABASE_URL
GROQ_API_KEY
GEMINI_API_KEY
NVIDIA_API_KEY
SUPABASE_SECRET_KEY
SUPABASE_SERVICE_ROLE_KEY
```

Também não coloque secrets em:

- Issues;
- README;
- logs públicos;
- screenshots;
- commits.

O `.gitignore` ignora `.env`.

---

# 13. Rodar localmente

Requer Node.js 24+.

```bash
npm install
npm start
```

Local:

```text
http://localhost:10000/health
http://localhost:10000/qr
http://localhost:10000/mcp
```

Para expor temporariamente:

```bash
cloudflared tunnel --url http://localhost:10000
```

Então use a URL HTTPS gerada em `PUBLIC_BASE_URL`.

---

# 14. CI

Workflow:

```text
.github/workflows/ci.yml
```

O CI valida:

- sintaxe JavaScript;
- instalação de dependências;
- compatibilidade básica do projeto a cada push.

O CI **não faz keepalive**.

---

# 15. Troubleshooting

## Render está online mas WhatsApp não está conectado

Abra:

```text
/health
/qr
```

Se aparecer `waiting_for_qr_scan`, pareie o aparelho.

## Auto Reply não funciona

Confira:

1. `auto status`;
2. `AUTO_REPLY_CONTROL_JID` ou `AUTO_REPLY_CONTROL_NUMBER`;
3. ao menos uma chave de IA;
4. modelo/provedor;
5. logs do Render.

## Configuração não sobrevive ao restart

Confira o backend de persistência:

```text
Supabase?
DATABASE_URL?
somente /tmp?
```

Se estiver somente em `/tmp`, não existe permanência garantida.

## Supabase não faz ping

Enquanto o projeto exclusivo não existir, isso é esperado.

Depois da criação, confira:

```sql
select jobid, jobname, schedule, active
from cron.job
where jobname = 'mcpwhats-render-keepalive';
```

E:

```sql
select *
from public.mcpwhats_health
order by created_at desc
limit 20;
```

---

# 16. Estrutura importante

```text
.
├── .github/workflows/ci.yml
├── docs/
│   ├── ARCHITECTURE.md
│   ├── CURRENT_STATUS.md
│   └── SUPABASE_KEEPALIVE.md
├── render-postgres/
│   └── setup.sql
├── supabase/
│   ├── setup.sql
│   └── functions/
│       └── mcpwhats-keepalive/
│           ├── deno.json
│           └── index.ts
├── src/
│   ├── auto-reply-service.js
│   ├── gateway-entry.js
│   ├── mcp-gateway-v5.js
│   ├── persistent-store.js
│   ├── public-mcp-proxy.js
│   ├── runtime-config.js
│   ├── server-media-v2.js
│   └── supabase-sync.js
├── .env.example
├── package.json
└── render.yaml
```

---

## Resumo da regra operacional

Para evitar confusão futura:

```text
Render: roda o MCPWhats.
Supabase: mantém o Render acordado e pode guardar estado.
Render Postgres: fallback de persistência.
SQLite: cache local.
GitHub: código + CI.
GitHub NÃO faz ping.
```
