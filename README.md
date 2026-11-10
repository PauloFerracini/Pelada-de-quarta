# Pelada de Quarta

App da lista de presença de uma pelada semanal (quarta, 20h às 22h), com avisos automáticos no
grupo de WhatsApp.

## O que tem aqui

- `pelada-app/` — o app web: login, lista de presença com prioridade dos mensalistas até as 17h,
  lista de espera dos diaristas, goleiros fixos e controle de pagamentos. Veja
  [pelada-app/LEIA-ME.md](pelada-app/LEIA-ME.md).
  - `site/` — a pasta publicada (Netlify).
  - `supabase.sql` e `whatsapp.sql` — banco de dados (Supabase).
- `whatsapp-bot/` — programa que roda no computador do organizador e envia o lembrete (quarta, 10h)
  e a convocação (quarta, 17h) no grupo. Veja [whatsapp-bot/LEIA-ME.md](whatsapp-bot/LEIA-ME.md).

## Instalar o programa de WhatsApp em outro computador

```bash
cd whatsapp-bot
npm install
```

Depois copie `config.example.json` para `config.json`, preencha os dados e siga o LEIA-ME da pasta.

## O que não vai para o GitHub

`whatsapp-bot/config.json` (segredo do banco), `whatsapp-bot/sessao/` (acesso ao WhatsApp) e
`whatsapp-bot/envios.log` ficam só no computador. A chave em `pelada-app/site/config.js` é a chave
pública do Supabase, feita para ficar no site.
