-- Notificações automáticas no grupo de WhatsApp.
-- Cole este arquivo inteiro em: Supabase > SQL Editor > New query > Run.
-- Depois siga o WHATSAPP.md para preencher os dados do serviço de envio e ativar.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Esquema fora da API do site: nada aqui é acessível pelo app ou por quem tem a chave pública.
create schema if not exists privado;
revoke all on schema privado from public, anon, authenticated;

create table if not exists privado.whatsapp_config (
  id int primary key default 1 check (id = 1),
  ativo boolean not null default false,
  url text not null default '',              -- endereço de envio do serviço (contém o token)
  cabecalhos jsonb not null default '{}',     -- ex.: {"Client-Token": "..."}
  campo_destino text not null default 'phone',
  campo_texto text not null default 'message',
  destino text not null default '',           -- id do grupo, ex.: 120363019502650977-group
  link_app text not null default ''           -- endereço do site da pelada
);
-- Sem nenhuma regra de acesso: só o próprio banco (SQL Editor e agendador) lê e altera.
alter table privado.whatsapp_config enable row level security;
insert into privado.whatsapp_config (id) values (1) on conflict (id) do nothing;

-- Mesma regra do app: quem joga, quem é goleiro e quem está na espera.
create or replace function privado.lista_partida(p_partida bigint, p_apos_corte boolean)
returns table (grupo text, posicao int, nome text, tipo text)
language sql stable set search_path = public as $$
  with base as (
    select pe.nome, pe.tipo, pe.goleiro, pr.criado_em, pr.user_id,
           (pe.tipo = 'mensalista' and (not p_apos_corte or pr.criado_em < pt.prioridade_ate)) as prio
    from presencas pr
    join perfis pe on pe.id = pr.user_id
    join partidas pt on pt.id = pr.partida_id
    where pr.partida_id = p_partida
  ),
  linha as (
    select b.*, row_number() over (order by b.prio desc, b.criado_em, b.user_id) as n
    from base b where not b.goleiro
  ),
  classificada as (
    select l.*,
           case when l.n <= (select vagas from config where id = 1) and (p_apos_corte or l.prio)
                then 'jogador' else 'espera' end as g
    from linha l
  )
  select 'goleiro', (row_number() over (order by b.criado_em, b.user_id))::int, b.nome, b.tipo
  from base b where b.goleiro
  union all
  select c.g, (row_number() over (partition by c.g order by c.n))::int, c.nome, c.tipo
  from classificada c
$$;

create or replace function privado.bloco(p_partida bigint, p_apos_corte boolean, p_grupo text)
returns text language sql stable as $$
  select coalesce(
    string_agg(l.posicao || '. ' || l.nome || case when l.tipo = 'diarista' then ' (diarista)' else '' end,
               chr(10) order by l.posicao),
    '—')
  from privado.lista_partida(p_partida, p_apos_corte) l
  where l.grupo = p_grupo
$$;

-- Envia um texto para o grupo. Devolve o número do pedido (ver net._http_response) ou null se desativado.
create or replace function privado.enviar_whatsapp(p_texto text)
returns bigint language plpgsql as $$
declare
  c privado.whatsapp_config;
begin
  select * into c from privado.whatsapp_config where id = 1;
  if not c.ativo or c.url = '' or c.destino = '' then
    return null;
  end if;
  return net.http_post(
    url := c.url,
    body := jsonb_build_object(c.campo_destino, c.destino, c.campo_texto, p_texto),
    headers := c.cabecalhos || '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 10000
  );
end $$;

-- Monta e envia a mensagem. p_tipo: 'lembrete' (antes das 17h) ou 'convocacao' (lista final das 17h).
create or replace function privado.notificar(p_tipo text)
returns bigint language plpgsql as $$
declare
  pt public.partidas;
  c privado.whatsapp_config;
  v_vagas int;
  v_nome text;
  v_dia text;
  n_jog int; n_gol int; n_esp int;
  apos boolean := (p_tipo = 'convocacao');
  nl text := chr(10);
  txt text;
begin
  select * into pt from public.garantir_partida();
  select * into c from privado.whatsapp_config where id = 1;
  select vagas, nome_grupo into v_vagas, v_nome from public.config where id = 1;
  v_dia := to_char(pt.inicio at time zone 'America/Sao_Paulo', 'DD/MM');

  select count(*) filter (where grupo = 'jogador'),
         count(*) filter (where grupo = 'goleiro'),
         count(*) filter (where grupo = 'espera')
    into n_jog, n_gol, n_esp
  from privado.lista_partida(pt.id, apos);

  if p_tipo = 'convocacao' then
    txt := '⚽ *' || v_nome || '* — quarta ' || v_dia || ', 20h às 22h' || nl || nl
        || '*Convocados (' || n_jog || '/' || v_vagas || ')*' || nl
        || privado.bloco(pt.id, true, 'jogador') || nl || nl
        || '*Goleiros*' || nl || privado.bloco(pt.id, true, 'goleiro');
    if n_esp > 0 then
      txt := txt || nl || nl || '*Lista de espera*' || nl || privado.bloco(pt.id, true, 'espera');
    end if;
    if n_jog < v_vagas then
      txt := txt || nl || nl || 'Ainda há ' || (v_vagas - n_jog) || ' vaga(s): quem confirmar agora entra direto.';
    end if;
    txt := txt || nl || nl || 'Não vai poder ir? Cancele no app para liberar a vaga.';
  elsif p_tipo = 'lembrete' then
    txt := '⚽ *' || v_nome || '* — quarta ' || v_dia || ', 20h às 22h' || nl || nl
        || 'Mensalistas confirmados: ' || n_jog || '/' || v_vagas || nl
        || 'Goleiros: ' || n_gol || nl
        || 'Na lista de espera: ' || n_esp || nl || nl
        || 'Mensalistas têm prioridade até as 17h de hoje. Depois disso, as vagas que sobrarem vão para a lista de espera.';
  else
    raise exception 'Tipo de notificação desconhecido: %', p_tipo;
  end if;

  if c.link_app <> '' then
    txt := txt || nl || c.link_app;
  end if;
  return privado.enviar_whatsapp(txt);
end $$;

-- Agenda (o relógio do agendador é UTC: 13h UTC = 10h de Brasília; 20h UTC = 17h de Brasília).
select cron.schedule('pelada-lembrete', '0 13 * * 3', $$select privado.notificar('lembrete')$$);
select cron.schedule('pelada-convocacao', '0 20 * * 3', $$select privado.notificar('convocacao')$$);
