# Supabase Keepalive do Render

## Estado

**Ativo e testado em 07/10/2026.**

O keepalive roda no mesmo Supabase compartilhado usado pela infraestrutura existente.

Não há GitHub Actions de keepalive.

## Fluxo

```text
pg_cron
  */5 * * * *
       ↓
pg_net
       ↓
mcpwhats-keepalive
       ↓
GET https://mcpwhats-personal.onrender.com/health?source=supabase-keepalive
       ↓
mcpwhats_health
```

Um teste manual já registrou:

```text
ok = true
status = 200
```

## Recursos

```text
public.mcpwhats_settings
public.mcpwhats_health
Edge Function: mcpwhats-keepalive
Cron: mcpwhats-render-keepalive
```

## Autenticação

O cron envia:

```text
x-mcpwhats-ping-secret
```

A Edge Function compara esse valor com `mcpwhats_settings.ping_secret`.

O valor do segredo não deve aparecer em GitHub, logs ou documentação.

## Cron reproduzível

Depois de cadastrar o segredo por tooling seguro:

```sql
select cron.schedule(
  'mcpwhats-render-keepalive',
  '*/5 * * * *',
  $cron$
  select net.http_post(
    url := 'https://SEU-PROJETO.supabase.co/functions/v1/mcpwhats-keepalive',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-mcpwhats-ping-secret',
      (select value #>> '{}' from public.mcpwhats_settings where key='ping_secret')
    ),
    body := jsonb_build_object('time', now()),
    timeout_milliseconds := 15000
  );
  $cron$
);
```

## Verificação

```sql
select jobid, jobname, schedule, active
from cron.job
where jobname='mcpwhats-render-keepalive';
```

```sql
select *
from public.mcpwhats_health
order by created_at desc
limit 20;
```

## Desativar

```sql
select cron.alter_job(
  job_id := (
    select jobid from cron.job
    where jobname='mcpwhats-render-keepalive'
  ),
  active := false
);
```

## Remover

```sql
select cron.unschedule('mcpwhats-render-keepalive');
```

## Observação

O projeto Supabase usado é compartilhado. Não altere jobs, funções ou tabelas de outros sistemas ao fazer manutenção deste keepalive.
