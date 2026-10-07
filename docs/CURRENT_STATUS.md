# Estado atual do MCPWhats

> Snapshot operacional: **07/10/2026**.

Este arquivo separa o que já está realmente ativo do que está apenas preparado no repositório.

## Resumo

| Componente | Estado | Observação |
|---|---|---|
| GitHub `Matheuskauanjg/MCPWhats-` | ✅ Ativo | Código, CI e documentação |
| Render Web Service `mcpwhats-personal` | ✅ Ativo | Serviço exclusivo do MCPWhats |
| URL Render | ✅ Ativa | `https://mcpwhats-personal.onrender.com` |
| Endpoint MCP | ✅ Disponível | `https://mcpwhats-personal.onrender.com/mcp` |
| Endpoint de health | ✅ Testado | `/health` respondeu HTTP 200 |
| WhatsApp/Baileys | 🟡 Aguardando pareamento | Estado observado: `waiting_for_qr_scan` |
| Render Postgres `mcpwhats-db` | ✅ Criado | Banco exclusivo, usado como fallback de persistência |
| Supabase exclusivo `MCPWhats` | ⛔ Bloqueado pela conta | A criação Free foi recusada pelo limite de projetos ativos |
| Supabase keepalive | ⏸️ Preparado, não ativo | Só será ativado no projeto Supabase exclusivo |
| GitHub Actions keepalive | ❌ Removido | GitHub **não** deve fazer o ping |
| Recursos MCPWhats no Supabase antigo | ✅ Limpos | Cron, tabelas e secrets removidos; função antiga neutralizada |

## Regra principal deste deploy

O MCPWhats **não deve reutilizar**:

- serviço Render antigo;
- banco Render antigo;
- projeto Supabase antigo;
- cron antigo;
- tabelas de outro projeto;
- keepalive de outro projeto.

A arquitetura final usa recursos próprios.

## Render criado para o MCPWhats

### Web Service

Nome:

```text
mcpwhats-personal
```

URL pública:

```text
https://mcpwhats-personal.onrender.com
```

Endpoints principais:

```text
GET  /health
GET  /qr
POST /mcp
```

O serviço foi validado pelo próprio Render e por uma chamada real ao `/health`, que retornou HTTP 200.

### PostgreSQL

Nome:

```text
mcpwhats-db
```

Esse banco foi criado exclusivamente para o MCPWhats. Ele é um **fallback de persistência**, não o sistema responsável pelo keepalive.

No plano Free criado em 07/10/2026, o Render informou expiração em **06/11/2026**. Se esse banco continuar sendo usado, acompanhe essa data ou migre definitivamente a persistência para o Supabase exclusivo.

## Por que o Supabase ainda não foi criado

A tentativa de criar um projeto novo chamado `MCPWhats` na região `sa-east-1` foi recusada pela própria plataforma.

A resposta do Supabase informou que a conta atingiu o limite de **2 projetos Free ativos** considerando organizações onde o usuário é administrador ou proprietário.

Nenhum projeto existente foi pausado, apagado ou reaproveitado para contornar isso.

### O que precisa acontecer

Para criar o Supabase exclusivo será necessário **uma** destas opções:

1. liberar uma vaga Free pausando ou removendo outro projeto que não seja mais necessário;
2. alterar o plano da organização/conta para permitir outro projeto ativo.

Essas ações não devem ser feitas automaticamente porque podem afetar outros sistemas.

## Keepalive correto

O keepalive desejado é:

```text
Supabase pg_cron
      │
      ▼
Edge Function mcpwhats-keepalive
      │
      ▼
GET https://mcpwhats-personal.onrender.com/health
```

A frequência planejada é:

```text
*/5 * * * *
```

Ou seja: uma execução a cada 5 minutos.

### O GitHub não participa do ping

Foi removido o workflow temporário que fazia ping pelo GitHub Actions.

Portanto, não existe no repositório:

```text
.github/workflows/render-keepalive.yml
```

O GitHub Actions existente serve apenas para CI/validação do código.

## Limpeza feita no Supabase antigo

Durante a preparação inicial chegaram a ser criados recursos `mcpwhats_*` no projeto Supabase antigo. Como a decisão final é isolamento completo, eles foram removidos.

Foi verificado que não existem mais:

- cron `mcpwhats-render-keepalive`;
- tabela `mcpwhats_settings`;
- tabela `mcpwhats_state`;
- tabela `mcpwhats_health`;
- secrets Vault `mcpwhats_project_url`;
- `mcpwhats_anon_key`;
- `mcpwhats_ping_secret`.

A Edge Function antiga foi substituída por uma versão neutralizada que responde como desativada e não faz chamadas ao Render.

## Próximo passo quando houver uma vaga no Supabase

Quando for possível criar o projeto novo:

1. criar `MCPWhats` em `sa-east-1`;
2. executar `supabase/setup.sql`;
3. publicar `supabase/functions/mcpwhats-keepalive`;
4. cadastrar a URL do próprio projeto no Vault;
5. cadastrar `render_service_url` apontando para o Render exclusivo;
6. criar o cron de 5 minutos;
7. testar a Edge Function manualmente;
8. verificar uma linha em `mcpwhats_health`;
9. confirmar nos logs do Render uma requisição com `source=supabase-keepalive`;
10. configurar `SUPABASE_URL` e a chave backend no Render se o Supabase também for usado como persistência.

Consulte [SUPABASE_KEEPALIVE.md](./SUPABASE_KEEPALIVE.md) para o procedimento completo.
