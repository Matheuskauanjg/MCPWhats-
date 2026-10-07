# Troubleshooting do MCPWhats

## `waiting_for_qr_scan`

Abra:

```text
https://mcpwhats-personal.onrender.com/qr
```

A sessão anterior foi perdida antes da persistência remota ser ativada. Depois do novo pareamento, ela será salva no Supabase.

## Confirmar persistência

Pelo MCP:

```text
get_mcpwhats_settings
```

Esperado:

```text
persistenceBackend = supabase-proxy
supabaseEnabled = true
```

No Render, procure:

```text
[RuntimeConfig] Loaded from supabase-proxy.
[Persistence] Hydrated persistent WhatsApp cache from supabase-proxy
[Persistence] Backed up ... Baileys auth file(s) to supabase-proxy.
```

No Supabase:

```sql
select namespace, count(*)
from public.mcpwhats_state
group by namespace;
```

Depois do pareamento deve existir `baileys_auth`.

## `Remote sync disabled`

Confira se existem no Render:

```text
SUPABASE_URL
MCPWHATS_SYNC_SECRET
```

Para o modo atual, não é necessário definir `SUPABASE_SECRET_KEY`.

## Storage retorna 401

O `MCPWHATS_SYNC_SECRET` do Render não corresponde ao hash cadastrado em `mcpwhats_settings.sync_secret_sha256`.

Rotacione o segredo nos dois lados por tooling seguro.

## Keepalive não funciona

Verifique:

```sql
select jobid, jobname, schedule, active
from cron.job
where jobname='mcpwhats-render-keepalive';
```

Depois:

```sql
select *
from public.mcpwhats_health
order by created_at desc
limit 20;
```

## Edge Function keepalive 401

Confira o segredo de ping e o header:

```text
x-mcpwhats-ping-secret
```

## MCP conecta, mas enviar mensagem falha

Confira `whatsapp_status`.

Se `ready=false`, o MCP está funcionando, mas o WhatsApp ainda não está pareado.

## Sessão some depois de restart

1. confirme `supabase-proxy`;
2. confirme registros `baileys_auth`;
3. procure logs de backup antes do restart;
4. procure log de restore no startup.

Não considere `/tmp` persistência.

## Auto Reply

Confira:

- controle JID/número;
- `auto status`;
- provedor;
- API key do provedor;
- modelo;
- estado de pausa.

## Segurança

Nunca copie para GitHub:

- MCPWHATS_SYNC_SECRET
- MCP_LOGIN_SECRET
- QR_SECRET
- API_TOKEN
- service_role / secret key
- DATABASE_URL
- chaves dos provedores de IA

O Supabase é compartilhado: ao diagnosticar MCPWhats, limite consultas e alterações aos recursos `mcpwhats_*` e funções `mcpwhats-*`.
