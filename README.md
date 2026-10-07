# MCPWhats

MCPWhats conecta um WhatsApp pessoal ao ChatGPT por MCP/OAuth e também pode responder automaticamente usando Groq, Gemini ou NVIDIA NIM.

A base veio exclusivamente do bridge WhatsApp do projeto original. O serviço do Discord não faz parte deste repositório.

## Arquitetura

```text
WhatsApp
   │
   ▼
Baileys / REST interno :10001
   │
   ├── SQLite local (cache rápido)
   ├── Supabase (sessão + histórico + estado + configuração)
   ├── Auto Reply
   │     ├── Groq
   │     ├── NVIDIA NIM
   │     └── Gemini
   │
   ▼
MCP/OAuth interno :10002
   │
   ▼
Proxy público :PORT
   │
   ├── /mcp
   ├── /health
   └── OAuth para ChatGPT
```

O serviço de áudio usa a porta interna `10003`.

## O que fica persistido no Supabase

Quando `SUPABASE_URL` e uma chave backend segura estão configuradas:

- credenciais da sessão Baileys são copiadas para `mcpwhats_state`;
- chats, contatos, mensagens de texto/metadados e mapeamentos LID são espelhados no Supabase;
- até 5.000 registros recentes de mensagens são reidratados no SQLite durante a inicialização;
- estado do automático fica persistido: ligado/desligado, pausa, ordens, recados, watchers e agendamentos;
- personalidade, provedor de IA, modelos e temperatura ficam em `mcpwhats_settings`;
- resultados do keepalive ficam em `mcpwhats_health`.

O SQLite continua existindo porque é mais rápido para leitura local. No Render Free ele deve ser tratado como cache, não como armazenamento permanente.

## 1. Preparar o Supabase

Os arquivos reproduzíveis estão em:

```text
supabase/setup.sql
supabase/functions/mcpwhats-keepalive/index.ts
```

No projeto já configurado pelo MCP, foram criadas somente tabelas com prefixo `mcpwhats_`, com RLS ativado e sem acesso para `anon` ou `authenticated`.

Para uma instalação nova:

1. execute `supabase/setup.sql`;
2. cadastre no Vault o segredo `mcpwhats_project_url` com a URL do projeto;
3. publique a Edge Function `mcpwhats-keepalive`;
4. configure o Cron mostrado no final do arquivo SQL.

Para o backend prefira a chave moderna `sb_secret_...`. A variável aceita pelo projeto é:

```env
SUPABASE_SECRET_KEY=sb_secret_...
```

A variável legada `SUPABASE_SERVICE_ROLE_KEY` continua aceita para migração, mas nunca coloque nenhuma dessas chaves no GitHub ou no navegador.

## 2. Variáveis de ambiente

Copie `.env.example` para `.env` quando rodar localmente.

As variáveis mínimas para o bridge são:

```env
PORT=10000
PUBLIC_BASE_URL=http://localhost:10000
API_TOKEN=uma-chave-grande
MCP_LOGIN_SECRET=outra-chave-grande
QR_SECRET=outra-chave-grande
```

Para permanência no Supabase:

```env
SUPABASE_URL=https://SEU-PROJETO.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
```

Para IA, basta configurar um ou mais provedores:

```env
AI_PROVIDER=auto

GROQ_API_KEY=
GROQ_REPLY_MODEL=openai/gpt-oss-20b

GEMINI_API_KEY=
GEMINI_REPLY_MODEL=gemini-3.5-flash-lite

NVIDIA_API_KEY=
NVIDIA_REPLY_MODEL=openai/gpt-oss-20b
```

`AI_PROVIDER` aceita `auto`, `groq`, `gemini` ou `nvidia`.

No modo `auto`, o bridge tenta provedores configurados em sequência e troca para outro quando há erro/timeout.

## 3. Rodar localmente

Requer Node.js 24 ou superior.

```bash
npm install
npm start
```

Abra:

```text
http://localhost:10000/qr
```

Leia o QR Code ou use o código de pareamento pelo número.

O endpoint de status é:

```text
GET /health
```

## 4. Usar um túnel para o ChatGPT

Quando estiver rodando no PC, exponha a porta pública `10000`.

Exemplo com Cloudflare Tunnel:

```bash
cloudflared tunnel --url http://localhost:10000
```

Depois copie a URL HTTPS criada pelo tunnel e configure:

```env
PUBLIC_BASE_URL=https://SUA-URL-DO-TUNNEL
```

O endereço MCP para o ChatGPT será:

```text
https://SUA-URL-DO-TUNNEL/mcp
```

O fluxo OAuth abre a tela privada do MCPWhats. Para autorizar, use o valor configurado em `MCP_LOGIN_SECRET`.

Escopos OAuth:

- `whatsapp.read`: ler chats, mensagens, áudios, status e configuração;
- `whatsapp.send`: enviar, responder, mencionar, reagir e mandar imagem;
- `whatsapp.manage`: mudar personalidade e configuração de IA.

## 5. ChatGPT no Render

O repositório contém `render.yaml` pronto para um Web Service Node.

Configuração equivalente manual:

```text
Runtime: Node
Build: npm install --omit=dev
Start: npm start
Health Check: /health
Branch: main
```

No Render Free o sistema usa `/tmp` apenas como cache e restaura os dados permanentes pelo Supabase.

Depois do deploy:

1. copie a URL `.onrender.com`;
2. defina `PUBLIC_BASE_URL` com essa URL;
3. grave a mesma URL em `mcpwhats_settings.render_service_url`;
4. o Cron do Supabase começará a chamar `/health` a cada 5 minutos;
5. conecte o ChatGPT usando `https://SEU-SERVICO.onrender.com/mcp`.

SQL para informar a URL ao keepalive:

```sql
insert into public.mcpwhats_settings(key, value, updated_at)
values (
  'render_service_url',
  to_jsonb('https://SEU-SERVICO.onrender.com'::text),
  now()
)
on conflict (key)
do update set value = excluded.value, updated_at = now();
```

### Observação sobre Render Free

O keepalive foi pensado para evitar o spin-down por inatividade. Isso mantém o serviço consumindo horas gratuitas continuamente. Se o mesmo workspace tiver outros serviços gratuitos, acompanhe o total mensal do workspace.

## 6. Editar personalidade pelo próprio ChatGPT

O MCP expõe três ferramentas de configuração:

### `get_mcpwhats_settings`

Mostra:

- provedor selecionado;
- modelos configurados;
- temperatura;
- personalidade atual;
- quais chaves de API existem.

Ele nunca retorna o valor das chaves.

### `edit_whatsapp_personality`

Exemplo de pedido ao ChatGPT:

```text
Mude a personalidade do WhatsApp para responder curto, natural,
em português informal, dividir respostas longas em mensagens menores
e ser mais formal quando a conversa for de trabalho.
```

A alteração vale sem precisar redeployar o Render e é persistida no Supabase.

### `configure_whatsapp_ai`

Exemplos:

```text
Use NVIDIA como IA principal do meu WhatsApp.
```

```text
Volte para modo automático e deixe a temperatura em 0.7.
```

```text
Troque o modelo do Gemini para o modelo que eu informar.
```

As ferramentas alteram apenas configuração. Chaves de API precisam continuar em variáveis secretas do Render.

## 7. Auto Reply

O automático é orientado por eventos do Baileys; ele não fica varrendo todos os chats em loop.

Comandos básicos na conversa definida por `AUTO_REPLY_CONTROL_JID` ou `AUTO_REPLY_CONTROL_NUMBER`:

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

Também entende várias ordens em linguagem natural, como agendamento de mensagens e regras temporárias.

## 8. REST API

Todas as rotas `/api/*` exigem:

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

Enviar texto:

```bash
curl -X POST "https://SEU-SERVICO.onrender.com/api/send" \
  -H "Authorization: Bearer SEU_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"to":"5541999999999","message":"Teste do MCPWhats"}'
```

Responder citando uma mensagem:

```json
{
  "to": "5541999999999",
  "message": "beleza",
  "replyToMessageId": "ID_DA_MENSAGEM"
}
```

## 9. Ferramentas MCP do WhatsApp

O ChatGPT recebe ferramentas para:

- verificar status;
- listar chats;
- ler mensagens;
- pesquisar histórico;
- ouvir/transcrever áudio;
- enviar texto;
- responder/citar mensagens;
- mencionar pessoas;
- reagir;
- enviar imagem;
- consultar armazenamento;
- ler configuração;
- editar personalidade;
- escolher provedor/modelos de IA.

## 10. Segurança

Nunca commite:

```text
API_TOKEN
MCP_LOGIN_SECRET
QR_SECRET
GROQ_API_KEY
GEMINI_API_KEY
NVIDIA_API_KEY
SUPABASE_SECRET_KEY
SUPABASE_SERVICE_ROLE_KEY
```

O `.gitignore` já ignora `.env`.

O projeto usa Baileys, um cliente não oficial baseado no protocolo do WhatsApp Web. Mudanças do WhatsApp podem exigir ajustes futuros.

## 11. Diagnóstico

Se o ChatGPT não conseguir conectar:

```text
1. abra /health;
2. confira PUBLIC_BASE_URL;
3. confirme que /mcp está público em HTTPS;
4. confira MCP_LOGIN_SECRET;
5. confirme que API_TOKEN existe.
```

Se o WhatsApp desconectar depois de deploy/restart:

```text
1. confira SUPABASE_URL;
2. confira SUPABASE_SECRET_KEY;
3. veja os logs [Supabase] Session restore;
4. se não houver sessão salva, abra /qr e pareie novamente.
```

Se o auto reply não responder:

```text
1. use auto status;
2. confira se ao menos uma API de IA está configurada;
3. use get_mcpwhats_settings pelo MCP;
4. verifique o provedor/modelo selecionado;
5. veja os logs do Render.
```

## CI

O GitHub Actions valida a sintaxe dos arquivos JavaScript e a instalação das dependências a cada push na branch `main`.
