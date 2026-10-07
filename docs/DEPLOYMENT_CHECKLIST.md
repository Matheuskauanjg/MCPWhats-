# Checklist de implantação do MCPWhats

## GitHub

- [x] Repositório `Matheuskauanjg/MCPWhats-`
- [x] Branch `main`
- [x] CI ativo
- [x] Nenhum secret versionado
- [x] Nenhum workflow GitHub de keepalive

## Render

- [x] `mcpwhats-personal` criado
- [x] `/health` funcional
- [x] `/qr` funcional
- [x] `/mcp` funcional
- [x] OAuth configurado
- [x] `SUPABASE_URL` configurado
- [x] `MCPWHATS_SYNC_SECRET` configurado
- [x] backend observado como `supabase-proxy`

## Supabase compartilhado

- [x] Reutilizar o projeto existente
- [x] Criar `mcpwhats_settings`
- [x] Criar `mcpwhats_state`
- [x] Criar `mcpwhats_health`
- [x] RLS ativado
- [x] Revogar `anon` e `authenticated`
- [x] Publicar `mcpwhats-storage`
- [x] Publicar `mcpwhats-keepalive`
- [x] Configurar segredo de sync
- [x] Configurar segredo de ping
- [x] Configurar URL do Render
- [x] Criar cron a cada 5 minutos
- [x] Testar keepalive: HTTP 200
- [x] Testar leitura pelo Render
- [x] Testar escrita pelo Render

## WhatsApp

- [x] Baileys inicia
- [x] QR é gerado
- [ ] Escanear QR após a correção da persistência
- [ ] Confirmar `ready=true`
- [ ] Confirmar linhas `namespace='baileys_auth'`
- [ ] Aguardar backup
- [ ] Reiniciar/redeployar
- [ ] Confirmar restauração sem novo QR

## Plugin ChatGPT

- [x] Plugin existente reaproveitado
- [x] Nome de exibição `MCPWhats`
- [x] versão 1.3.0
- [x] endpoint novo do Render
- [x] ferramentas de configuração incluídas
- [x] `get_mcpwhats_settings` funcionando
- [ ] Testar envio após WhatsApp ficar `ready`

## IA

- [ ] Configurar ao menos uma API externa, se Auto Reply com IA for desejado
- [ ] Validar fallback entre provedores

## Conclusão

O único passo essencial pendente para comprovar persistência da sessão de ponta a ponta é parear o WhatsApp novamente e executar um restart controlado depois do backup.
