# Estado atual do MCPWhats

> Snapshot operacional: **07/10/2026**.

## Resumo

| Componente | Estado | Observação |
|---|---|---|
| GitHub | ✅ | `Matheuskauanjg/MCPWhats-` |
| Render | ✅ | `mcpwhats-personal` live |
| MCP/OAuth | ✅ | endpoint público e plugin configurado |
| Supabase compartilhado | ✅ | reutiliza o projeto existente |
| Persistência | ✅ | backend `supabase-proxy` |
| Leitura Supabase | ✅ | runtime config carregada |
| Escrita Supabase | ✅ | `runtime_config` persistido |
| Keepalive | ✅ | cron ativo, teste HTTP 200 |
| WhatsApp | 🟡 | precisa parear novamente |
| Baileys auth persistido | ⏳ | será criado após o novo pareamento |
| GitHub keepalive | ❌ | não existe |

## Correção de arquitetura

A versão anterior da documentação dizia que o MCPWhats precisaria de um projeto Supabase exclusivo. Isso estava incorreto.

A arquitetura desejada é reutilizar o **Supabase compartilhado já existente**, mantendo isolamento lógico:

```text
Supabase compartilhado
├── recursos de outros sistemas
└── MCPWhats
    ├── mcpwhats_settings
    ├── mcpwhats_state
    ├── mcpwhats_health
    ├── mcpwhats-storage
    └── mcpwhats-keepalive
```

Não foi criado outro projeto Supabase.

## Persistência comprovada

Os logs do Render confirmaram:

```text
[RuntimeConfig] Loaded from supabase-proxy.
[Persistence] Hydrated persistent WhatsApp cache from supabase-proxy
```

A ferramenta `get_mcpwhats_settings` confirmou:

```text
persistenceBackend: supabase-proxy
supabaseEnabled: true
postgresEnabled: false
```

Também foi feita uma escrita de configuração, que retornou `persisted: true`, e a linha `runtime_config` foi confirmada no banco.

## Sessão do WhatsApp

A sessão antiga não pode ser recuperada porque ela já tinha sido perdida quando o serviço ainda dependia de `/tmp`.

Próximo passo:

1. abrir `https://mcpwhats-personal.onrender.com/qr`;
2. parear o WhatsApp;
3. aguardar o backup de `baileys_auth`;
4. confirmar registros em `mcpwhats_state`;
5. fazer um restart/redeploy controlado;
6. confirmar que o serviço volta `ready` sem outro QR.

## Keepalive

Cron:

```text
mcpwhats-render-keepalive
*/5 * * * *
```

Fluxo testado:

```text
Supabase Cron → Edge Function → Render /health → mcpwhats_health
```

Último teste manual observado:

```text
ok: true
status: 200
```
