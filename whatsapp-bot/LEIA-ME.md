# Avisos da pelada no WhatsApp

Programa pequeno que roda neste computador e envia os avisos no grupo usando o seu WhatsApp
(conectado como "aparelho conectado", igual ao WhatsApp Web).

- **Quarta, 10h** — lembrete com o número de confirmados.
- **Quarta, 17h** — convocação com a lista final.
- **Todo dia, 9h** — cobrança da mensalidade; só envia nos dias 9, 10, 20 e no último dia do mês,
  e apenas se houver mensalidade em aberto (tarefa "Pelada - Cobranca").

O computador precisa estar ligado nesses horários. Se estiver desligado às 17h, a convocação sai
assim que ele for ligado, desde que ainda seja quarta e antes das 22h.

Aviso: é automação não oficial do WhatsApp. Com dois envios por semana o risco de bloqueio do
número é baixo, mas existe.

## Preparação (uma vez)

1. **Banco**: no Supabase, abra **SQL Editor**, cole o conteúdo de `banco.sql` e clique em **Run**.
   O resultado mostra uma linha com o **segredo**.
2. **Segredo**: abra `config.json` e cole o segredo entre as aspas de `"segredo"`.
   Em `"linkApp"`, coloque o endereço do site da pelada (opcional; vai no fim de cada aviso).
3. **Conectar o WhatsApp**: `node pelada-bot.mjs conectar` e leia o QR code com o celular
   (WhatsApp > Aparelhos conectados > Conectar um aparelho).
4. **Escolher o grupo**: `node pelada-bot.mjs grupo "parte do nome do grupo"`.
5. **Conferir a mensagem sem enviar**: `node pelada-bot.mjs previa convocacao`.
6. **Teste de envio** (manda uma mensagem de verdade no grupo): `node pelada-bot.mjs teste`.

## Dia a dia

- O Agendador de Tarefas do Windows dispara os envios sozinho (tarefas "Pelada - Lembrete" e
  "Pelada - Convocacao").
- O arquivo `envios.log` registra o que foi enviado e os erros.
- Enviar na mão, fora do horário: `node pelada-bot.mjs enviar convocacao --forcar`.

## Se parar de enviar

Veja a última linha do `envios.log`. O mais comum é o WhatsApp ter desconectado o aparelho
(acontece se o celular ficar muitos dias sem internet). Rode `node pelada-bot.mjs conectar` de novo.

## Cuidados

- A pasta `sessao` dá acesso ao seu WhatsApp e o `config.json` guarda o segredo do banco.
  Não envie nenhum dos dois para ninguém.
