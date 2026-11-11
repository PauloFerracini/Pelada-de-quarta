# Pelada de Quarta

App da lista de presença da pelada: login por e-mail e senha, prioridade dos mensalistas até as 17h,
lista de espera dos diaristas, goleiros fixos à parte e controle de pagamentos.

## O que tem aqui

- `site/` — o app (é esta pasta que vai para a internet).
- `supabase.sql` — cria o banco de dados e as regras de acesso.
- `historico.sql` — rode depois do `supabase.sql`: registra entradas e saídas da lista e as
  alterações dos administradores (abas Histórico e Organizar > Relatórios).
- `teste-logica.js` — testes das regras da lista (`node teste-logica.js`).

Com `site/config.js` vazio, o app roda em **modo demonstração**: tudo fica só no aparelho, com
jogadores fictícios. Serve para conhecer as telas, não para uso real.

## Como publicar

1. Crie uma conta em supabase.com e um projeto novo (região São Paulo).
2. No projeto, abra **SQL Editor**, cole o conteúdo de `supabase.sql` e clique em **Run**.
3. Em **Authentication > Sign In / Providers > Email**, desligue **Confirm email**.
   (O envio de e-mails do plano gratuito é bem limitado e travaria o cadastro do grupo.)
4. Em **Project Settings > API**, copie a **Project URL** e a chave pública (**anon** / **publishable**)
   para `site/config.js`. Essa chave é feita para ficar no site; nunca use a chave **service_role**.
5. Publique a pasta `site`: em app.netlify.com/drop, arraste a pasta inteira. Guarde o endereço gerado.
6. De volta ao Supabase, em **Authentication > URL Configuration**, ponha esse endereço em **Site URL**
   (é para onde vai o link de "esqueci minha senha").
7. Abra o endereço e **crie a sua conta primeiro**: a primeira conta vira administradora.
8. Em **Organizar > Configurações**, preencha valores e chave Pix. Depois mande o link no grupo.
9. Conforme o pessoal criar conta, marque em **Organizar > Jogadores** quem é mensalista e quem é goleiro fixo.

## Regras que o app aplica

- Jogo toda quarta, 20h às 22h (horário de Brasília). A lista da semana seguinte abre quando o jogo termina.
- Até as 17h de quarta só mensalistas ocupam as 24 vagas; diaristas entram na lista de espera.
- Às 17h, se houver menos de 24 mensalistas, os diaristas sobem pela ordem da espera até completar 24.
- Com 24 ou mais mensalistas confirmados até as 17h, nenhum diarista é convocado.
- Mensalista que confirma depois das 17h perde a prioridade e entra atrás de quem já estava na fila.
- Se alguém desiste, o primeiro da espera sobe automaticamente.
- Goleiros fixos têm lista própria e não contam nas 24 vagas.
- Pagamento: o organizador marca manualmente a mensalidade (mensalistas) e a diária (diaristas convocados).
