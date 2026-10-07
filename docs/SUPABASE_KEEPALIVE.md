# Supabase Keepalive do Render

## Regra

**O Supabase é o responsável pelo ping do Render.**

Não usar GitHub Actions, UptimeRobot ou outro serviço como keepalive principal desta instalação.

## Fluxo

```text
Supabase Cron (pg_cron)
        │
        │ a cada 5 minutos
        ▼
pg_net / net.http_post
        │
        ▼
Edge Function: mcpwhats-keepalive
        │
        │ valida x-mcpwhats-ping-secret
        ▼
GET https://mcpwhats-personal.onrender.com/health?source=supabase-keepalive
        │
        ▼
Render responde /health
        │
        ▼
Edge Function registra resultado em mcpwhats_health
```

## Estado em 07/10/2026

A implementação está pronta no GitHub, porém **não está ativa** porque o Supabase recusou a criação de um projeto Free adicional por limite da conta.

Não foi reutilizado nenhum projeto Supabase existente.

## Arquivos

```text
supabase/setup.sql
supabase/functions/mcpwhats-keepalive/index.ts
supabase/functions/mcpwhats-keepalive/deno.json
```

## 1. Criar um projeto Supabase exclusivo

Nome recomendado:

```text
MCPWhats
```

Região:

```text
sa-east-1
```

Não instalar o schema em um projeto de outro sistema.

## 2. Executar o setup

Execute:

```text
supabase/setup.sql
```

Ele prepara:

- `pg_cron`;
- `pg_net`;
- `mcpwhats_settings`;
- `mcpwhats_state`;
- `mcpwhats_health`;
- RLS;
- grants apenas para backend;
- segredo interno `mcpwhats_ping_secret`.

## 3. Salvar a URL do projeto no Vault

Use a URL do próprio projeto Supabase:

```sql
select vault.create_secret(
  'https://SEU-PROJECT-REF.supabase.co',
  'mcpwhats_project_url'
);
```

Nunca coloque chave backend no SQL versionado.

## 4. Configurar a URL do Render

```sql
insert into public.mcpwhats_settings(key, value, updated_at)
values (
  'render_service_url',
  to_jsonb('https://mcpwhats-personal.onrender.com'::text),
  now()
)
on conflict (key)
do update
set value = excluded.value,
    updated_at = now();
```

## 5. Publicar a Edge Function

Função:

```text
mcpwhats-keepalive
```

Ela precisa aceitar POST do cron e fazer GET no Render.

Ela:

1. lê `ping_secret`;
2. valida o header `x-mcpwhats-ping-secret`;
3. lê `render_service_url`;
4. chama `/health?source=supabase-keepalive`;
5. mede latência;
6. grava o resultado em `mcpwhats_health`.

## 6. Criar o cron

Depois que a função estiver publicada:

```sql
select cron.schedule(
  'mcpwhats-render-keepalive',
  '*/5 * * * *',
  $cron$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'mcpwhats_project_url'
    ) || '/functions/v1/mcpwhats-keepalive',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-mcpwhats-ping-secret',
      (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'mcpwhats_ping_secret'
      )
    ),
    body := jsonb_build_object('time', now()),
    timeout_milliseconds := 15000
  );
  $cron$
);
```

## 7. Confirmar que o cron existe

```sql
select jobid, jobname, schedule, active
from cron.job
where jobname = 'mcpwhats-render-keepalive';
```

Esperado:

```text
schedule = */5 * * * *
active   = true
```

## 8. Confirmar resultados

Depois de uma execução:

```sql
select *
from public.mcpwhats_health
order by created_at desc
limit 20;
```

Para uma execução saudável:

```text
source     = supabase-keepalive
ok         = true
status     = 200
latency_ms = ...
```

## 9. Conferir o Render

Nos logs do serviço devem aparecer chamadas ao endpoint de health.

O endpoint usado é:

```text
/health?source=supabase-keepalive
```

## 10. Teste manual

Também é possível invocar a Edge Function manualmente com o secret interno para confirmar o fluxo antes de ativar o cron.

Não publique o valor desse secret em logs, issues ou README.

## 11. Desativar temporariamente

Para manter o job cadastrado e apenas desligar:

```sql
select cron.alter_job(
  job_id := (
    select jobid
    from cron.job
    where jobname = 'mcpwhats-render-keepalive'
  ),
  active := false
);
```

Para reativar:

```sql
select cron.alter_job(
  job_id := (
    select jobid
    from cron.job
    where jobname = 'mcpwhats-render-keepalive'
  ),
  active := true
);
```

## 12. Remover completamente

```sql
select cron.unschedule('mcpwhats-render-keepalive');
```

## Diagnóstico

### Edge Function retorna 401

Confira:

- secret `mcpwhats_ping_secret`;
- header `x-mcpwhats-ping-secret`;
- se o cron aponta para o projeto correto.

### Edge Function retorna 503

Normalmente significa que `render_service_url` não foi configurado.

### Edge Function retorna 502

O Render respondeu com erro, demorou demais ou estava inacessível.

Veja:

```sql
select *
from public.mcpwhats_health
order by created_at desc
limit 20;
```

### Render continua dormindo

Confira se:

1. o job está `active=true`;
2. há execuções em `cron.job_run_details`;
3. `mcpwhats_health` recebe novas linhas;
4. o status salvo é 200;
5. a URL configurada é exatamente o serviço MCPWhats.

## Importante sobre plano Free

O ping a cada 5 minutos pode manter o Web Service ativo e, portanto, consumir as horas gratuitas disponíveis no workspace Render.

O objetivo do keepalive é intencional; acompanhe o consumo do plano.
