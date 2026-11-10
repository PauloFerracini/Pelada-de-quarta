# Notificações automáticas no grupo de WhatsApp

O banco de dados (Supabase) monta a mensagem e pede o envio à **Evolution API**, um programa gratuito
que fica conectado ao seu WhatsApp. A Evolution API não é um site pronto: ela precisa rodar num
servidor seu, ligado 24 horas e acessível pela internet.

Aviso: isso é automação não oficial do WhatsApp. O risco de bloqueio do número é baixo para duas
mensagens por semana, mas existe. Um chip separado, adicionado ao grupo, elimina o risco para o seu número.

## O que é enviado

- **Quarta, 10h** — lembrete: quantos mensalistas confirmaram, goleiros e tamanho da espera.
- **Quarta, 17h** — convocação: lista final dos 24, goleiros e lista de espera.

## Parte 1 — Banco (já feito se você rodou o whatsapp.sql)

No Supabase, abra **SQL Editor**, cole o conteúdo de `whatsapp.sql` e clique em **Run**.
Nada é enviado ainda: o envio começa desativado.

## Parte 2 — Servidor da Evolution API

Servidor gratuito na Oracle Cloud (plano "Always Free"). Ao final você terá o **endereço do servidor**,
a **chave da API** e uma **instância** chamada `pelada` conectada ao seu WhatsApp.

### 2.1 Conta

Crie a conta em oracle.com/cloud/free. O cadastro pede um cartão de crédito para verificação; o plano
Always Free não gera cobrança. Em **Home Region**, escolha **Brazil East (Sao Paulo)**: não dá para
trocar depois.

### 2.2 Chave de acesso

No painel da Oracle, abra o **Cloud Shell** (ícone de terminal `>_` no canto superior direito) e rode:

```bash
ssh-keygen -t rsa -b 4096 -N "" -f ~/.ssh/pelada && cat ~/.ssh/pelada.pub
```

Copie a linha que começa com `ssh-rsa` (é a chave pública; a próxima etapa pede ela).

### 2.3 Criar o servidor

Menu **Compute > Instances > Create instance**:

- **Name**: `pelada`
- **Image**: Canonical Ubuntu 24.04
- **Shape**: `VM.Standard.E2.1.Micro` (marcada como *Always Free-eligible*)
- **Networking**: deixe criar a rede nova e confirme que **Assign a public IPv4 address** está ligado
- **SSH keys**: escolha **Paste public key** e cole a linha copiada na etapa 2.2

Clique em **Create**. Quando o estado ficar **Running**, anote o **Public IP address**.

### 2.4 Liberar a porta 8080

Na página do servidor, clique no nome da **Subnet** e depois em **Default Security List**.
Em **Add Ingress Rules**, preencha:

- **Source CIDR**: `0.0.0.0/0`
- **IP Protocol**: TCP
- **Destination Port Range**: `8080`

### 2.5 Instalar a Evolution API

De volta ao Cloud Shell, entre no servidor (troque `IP_DO_SERVIDOR`; responda `yes` na primeira vez):

```bash
ssh -i ~/.ssh/pelada ubuntu@IP_DO_SERVIDOR
```

Crie o instalador dentro do servidor:

```bash
nano instalar.sh
```

Abra o arquivo `instalar-evolution.sh` no seu computador, copie todo o conteúdo e cole nessa tela.
Salve com `Ctrl+O`, `Enter`, e saia com `Ctrl+X`. Depois rode:

```bash
bash instalar.sh
```

Leva alguns minutos. No final ele mostra o **Endereço do servidor** e a **Chave da API**: anote os dois.

### 2.6 Conectar o WhatsApp

1. No navegador, abra `ENDERECO_DO_SERVIDOR/manager` e entre com o endereço do servidor e a chave da API.
2. Crie uma instância com o nome `pelada` (canal Baileys).
3. Na instância, peça o QR code e leia com o celular: WhatsApp > Aparelhos conectados > Conectar um aparelho.

### Se algo não funcionar

- **O `/manager` não abre**: espere dois minutos (a primeira subida é lenta). Se continuar, no servidor rode
  `cd ~/evolution && sudo docker compose logs --tail 40 api` e veja o erro.
- **Continua sem abrir**: confira a regra da etapa 2.4. Se estiver certa, libere a porta também no servidor:
  `sudo iptables -I INPUT -p tcp --dport 8080 -j ACCEPT && sudo netfilter-persistent save`
- **Servidor parado**: a Oracle pode desligar máquinas gratuitas que considera ociosas. Religue em
  **Compute > Instances > Start**; a Evolution API volta sozinha.

### Segurança

O servidor fica aberto na internet por HTTP (sem cadeado). Quem tiver a chave da API pode mandar
mensagens pelo seu WhatsApp, então não compartilhe a chave nem o arquivo `.env`.

## Parte 3 — Ligar o banco ao servidor

1. **Salve os dados no banco** (SQL Editor; troque os valores em maiúsculas):

   ```sql
   update privado.whatsapp_config set
     url = 'ENDERECO_DO_SERVIDOR/message/sendText/pelada',
     cabecalhos = '{"apikey": "CHAVE_DA_API"}',
     campo_destino = 'number',
     campo_texto = 'text',
     link_app = 'https://SEU-SITE.netlify.app'
   where id = 1;
   ```

2. **Descubra o ID do grupo**. Rode:

   ```sql
   select net.http_get(
     url := replace(url, '/message/sendText/', '/group/fetchAllGroups/') || '?getParticipants=false',
     headers := cabecalhos,
     timeout_milliseconds := 30000
   ) from privado.whatsapp_config;
   ```

   Espere uns segundos e rode:

   ```sql
   select g ->> 'subject' as grupo, g ->> 'id' as id
   from net._http_response r, jsonb_array_elements(r.content::jsonb) g
   where r.id = (select max(id) from net._http_response);
   ```

   Copie o `id` do grupo da pelada (termina em `@g.us`). Se essa consulta der erro, veja a resposta
   crua com `select status_code, content from net._http_response order by id desc limit 1;`.

3. **Salve o grupo e ative**:

   ```sql
   update privado.whatsapp_config set destino = 'ID_DO_GRUPO@g.us', ativo = true where id = 1;
   ```

4. **Teste** (isto envia uma mensagem de verdade no grupo):

   ```sql
   select privado.enviar_whatsapp('Teste do app da pelada ✅');
   ```

   Se não chegar, veja a resposta do servidor:

   ```sql
   select status_code, content from net._http_response order by id desc limit 1;
   ```

## Comandos úteis

- Enviar a convocação agora: `select privado.notificar('convocacao');`
- Pausar tudo: `update privado.whatsapp_config set ativo = false where id = 1;`
- Mudar o horário do lembrete (o agendador usa UTC, 3 horas à frente de Brasília):
  `select cron.schedule('pelada-lembrete', '0 13 * * 3', $$select privado.notificar('lembrete')$$);`
- Ver se os agendamentos rodaram:
  `select j.jobname, d.status, d.start_time from cron.job_run_details d join cron.job j using (jobid) order by d.start_time desc limit 10;`

## Se parar de enviar

O mais comum é o WhatsApp ter desconectado da Evolution API (troca de aparelho, muito tempo sem abrir
o WhatsApp no celular) ou o servidor ter sido desligado. Abra o `/manager` do servidor e leia o QR code de novo.
