# Troubleshooting do MCPWhats

## 1. `/health` não abre

Confirme no Render:

```text
Build: npm install --omit=dev
Start: npm start
Runtime: Node
```

Veja os logs de startup.

Mensagens esperadas:

```text
[MCP-PROXY] Public compatibility proxy listening on 0.0.0.0:10000
[MCP] Endpoint: /mcp
[Baileys] Socket iniciado
```

## 2. O Render mostra service live mas `/health` falha

Confirme:

- `PORT` controlado pelo Render;
- proxy público escutando em `0.0.0.0`;
- `PUBLIC_BASE_URL`;
- ausência de crash depois do startup.

## 3. WhatsApp está `waiting_for_qr_scan`

Isso significa que o bridge está funcionando e aguarda pareamento.

Abra:

```text
https://mcpwhats-personal.onrender.com/qr
```

Leia o QR pelo WhatsApp.

## 4. WhatsApp perde sessão após redeploy

Se somente `/tmp` estiver sendo usado, isso é esperado.

Configure uma persistência remota:

```text
Supabase dedicado
ou
DATABASE_URL
```

A preferência final é o Supabase dedicado.

## 5. `[Persistence] Remote sync disabled`

Nenhum backend remoto foi configurado.

Confira:

```text
SUPABASE_URL + SUPABASE_SECRET_KEY
ou
DATABASE_URL
```

## 6. Postgres existe mas não é usado

Criar `mcpwhats-db` não injeta automaticamente a senha no serviço criado manualmente.

O Web Service precisa receber uma `DATABASE_URL` válida ou ser criado por um Blueprint que faça:

```yaml
fromDatabase:
  name: mcpwhats-db
  property: connectionString
```

Nunca copie a connection string para o GitHub.

## 7. Supabase exclusivo não pode ser criado

Erro atual observado:

```text
maximum limits for the number of active free projects
```

Soluções possíveis:

- liberar uma vaga Free;
- ou usar um plano que permita outro projeto.

Não contorne isso reutilizando o Supabase do Giro se o objetivo é isolamento total.

## 8. Cron Supabase não executa

Confira:

```sql
select jobid, jobname, schedule, active
from cron.job
where jobname='mcpwhats-render-keepalive';
```

Depois:

```sql
select *
from cron.job_run_details
where jobid = (
  select jobid
  from cron.job
  where jobname='mcpwhats-render-keepalive'
)
order by start_time desc
limit 20;
```

## 9. Edge Function retorna 401

O header e o secret não coincidem.

Header esperado:

```text
x-mcpwhats-ping-secret
```

O valor deve ser o mesmo de `mcpwhats_ping_secret`.

## 10. Edge Function retorna 503

`render_service_url` provavelmente não foi configurado em `mcpwhats_settings`.

## 11. Edge Function retorna 502

Possibilidades:

- Render indisponível;
- timeout;
- `/health` retornou erro;
- URL incorreta.

Veja `mcpwhats_health`.

## 12. `mcpwhats_health` não recebe linhas

Confira:

1. função publicada;
2. cron ativo;
3. `pg_net`;
4. secret correto;
5. acesso service/backend às tabelas.

## 13. MCP não conecta no ChatGPT

Confira:

```text
https://mcpwhats-personal.onrender.com/mcp
```

Depois:

- HTTPS válido;
- `PUBLIC_BASE_URL`;
- OAuth metadata;
- `MCP_LOGIN_SECRET`;
- callback do ChatGPT;
- cliente `chatgpt-mcpwhats`.

## 14. MCP conecta mas ferramenta falha

Verifique se o WhatsApp está `ready`.

Algumas ferramentas dependem da sessão ativa.

## 15. Auto Reply não responde

Confira:

- `AUTO_REPLY_CONTROL_JID`;
- `AUTO_REPLY_CONTROL_NUMBER`;
- `auto status`;
- chave de pelo menos um provedor;
- modelo configurado;
- logs de timeout;
- estado pausado.

## 16. Groq falha

Confira:

- `GROQ_API_KEY`;
- `GROQ_REPLY_MODEL`;
- rate limit;
- timeout.

## 17. NVIDIA falha

Confira:

- `NVIDIA_API_KEY`;
- `NVIDIA_REPLY_MODEL`;
- endpoint do NIM;
- temperatura suportada;
- rate limit.

## 18. Gemini falha

Confira:

- `GEMINI_API_KEY`;
- modelo disponível para a chave;
- timeout;
- erro retornado pelo provider.

Modelos mudam com o tempo. Não assuma que um nome antigo continuará disponível para sempre.

## 19. Persistência funciona mas fica lenta

O mirror remoto pode gerar uma escrita por mudança.

Se houver volume alto:

- adicionar fila/batch;
- reduzir payload salvo;
- limitar histórico remoto;
- manter SQLite como cache de leitura.

## 20. Segurança

Se uma chave real aparecer em commit ou log:

1. revogue/rotacione a chave;
2. atualize o Render;
3. não confie apenas em remover o texto do arquivo;
4. verifique histórico Git;
5. confirme que a chave antiga deixou de funcionar.

## 21. Diagnóstico rápido

Ordem recomendada:

```text
1. Render deploy
2. /health
3. /qr
4. sessão WhatsApp
5. persistência
6. /mcp
7. OAuth
8. ferramenta MCP
9. IA
10. Supabase cron/keepalive
```
