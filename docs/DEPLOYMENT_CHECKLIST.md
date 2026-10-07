# Checklist de implantação do MCPWhats

Use este checklist para uma instalação limpa e isolada.

## Fase A — GitHub

- [x] Repositório separado: `Matheuskauanjg/MCPWhats-`
- [x] Branch de deploy: `main`
- [x] CI em `.github/workflows/ci.yml`
- [x] Sem secrets commitados
- [x] Sem workflow de keepalive no GitHub

## Fase B — Render Web Service

- [x] Criar um Web Service novo
- [x] Nome: `mcpwhats-personal`
- [x] Runtime: Node
- [x] Branch: `main`
- [x] Build: `npm install --omit=dev`
- [x] Start: `npm start`
- [x] Plano Free
- [x] URL atual: `https://mcpwhats-personal.onrender.com`
- [x] Validar `GET /health`
- [x] Confirmar HTTP 200

## Fase C — Render PostgreSQL

- [x] Criar banco novo
- [x] Nome: `mcpwhats-db`
- [x] Não reutilizar banco de outro serviço
- [ ] Confirmar `DATABASE_URL` no Web Service se o fallback PostgreSQL for utilizado
- [ ] Confirmar criação automática de `mcpwhats_kv`
- [ ] Testar restart e restauração

## Fase D — Segredos Render

Configurar no painel, nunca no GitHub:

- [x] `PUBLIC_BASE_URL`
- [x] `API_TOKEN`
- [x] `MCP_LOGIN_SECRET`
- [x] `QR_SECRET`
- [ ] `DATABASE_URL`, quando necessário
- [ ] `GROQ_API_KEY`, se usar Groq
- [ ] `GEMINI_API_KEY`, se usar Gemini
- [ ] `NVIDIA_API_KEY`, se usar NVIDIA

As chaves Supabase só entram depois da criação do projeto exclusivo.

## Fase E — WhatsApp

- [x] Bridge inicia
- [x] QR é gerado
- [ ] Abrir `/qr`
- [ ] Parear o WhatsApp
- [ ] Confirmar `ready=true` em `/health`
- [ ] Reiniciar o serviço
- [ ] Confirmar que a sessão volta pela persistência remota

## Fase F — Supabase exclusivo

Estado atual: **bloqueado pelo limite Free da conta**.

Quando houver vaga:

- [ ] Criar um projeto novo `MCPWhats`
- [ ] Região `sa-east-1`
- [ ] Não reutilizar projeto do Giro
- [ ] Não reutilizar projeto de outro bot
- [ ] Executar `supabase/setup.sql`
- [ ] Confirmar `pg_cron`
- [ ] Confirmar `pg_net`
- [ ] Confirmar tabelas `mcpwhats_*`
- [ ] Confirmar RLS
- [ ] Confirmar ausência de grants para `anon` e `authenticated`
- [ ] Publicar `mcpwhats-keepalive`
- [ ] Criar secret `mcpwhats_project_url`
- [ ] Confirmar secret `mcpwhats_ping_secret`
- [ ] Inserir `render_service_url`
- [ ] Criar cron `mcpwhats-render-keepalive`
- [ ] Ativar cron
- [ ] Testar uma chamada manual
- [ ] Verificar `mcpwhats_health`
- [ ] Verificar logs do Render

## Fase G — Ligar Supabase ao Render

Depois do Supabase dedicado existir:

- [ ] `SUPABASE_URL`
- [ ] `SUPABASE_SECRET_KEY`
- [ ] Redeploy
- [ ] Confirmar log de restore
- [ ] Confirmar backup da sessão Baileys
- [ ] Confirmar persistência de runtime config
- [ ] Confirmar persistência do auto reply
- [ ] Confirmar mirror de chats/contatos/mensagens

## Fase H — MCP / ChatGPT

- [ ] Confirmar `https://mcpwhats-personal.onrender.com/mcp`
- [ ] Completar OAuth
- [ ] Usar `MCP_LOGIN_SECRET`
- [ ] Autorizar `whatsapp.read`
- [ ] Autorizar `whatsapp.send`
- [ ] Autorizar `whatsapp.manage`
- [ ] Testar status
- [ ] Listar chats
- [ ] Ler mensagens
- [ ] Enviar uma mensagem de teste
- [ ] Testar reação
- [ ] Testar resposta citada
- [ ] Testar edição de personalidade

## Fase I — IA

Configure somente os provedores desejados.

- [ ] Groq
- [ ] Gemini
- [ ] NVIDIA
- [ ] `AI_PROVIDER=auto` ou provedor fixo
- [ ] testar timeout/fallback
- [ ] validar `get_mcpwhats_settings`
- [ ] validar `configure_whatsapp_ai`

## Fase J — Keepalive definitivo

A regra é:

```text
Supabase → Edge Function → Render /health
```

- [ ] Confirmar que não existe GitHub Actions de keepalive
- [ ] Confirmar cron de 5 minutos no Supabase
- [ ] Confirmar novas linhas em `mcpwhats_health`
- [ ] Confirmar status HTTP 200
- [ ] Confirmar `source=supabase-keepalive`

Quando todos os itens estiverem concluídos, a instalação está totalmente isolada e reproduzível.
