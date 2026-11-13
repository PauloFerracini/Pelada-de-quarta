-- Multas, cobrança da mensalidade, bloqueio por mensalidade em aberto e avisos novos no WhatsApp.
-- Cole este arquivo inteiro em: Supabase > SQL Editor > New query > Run.
-- Rode depois de: supabase.sql, historico.sql, financeiro-estatisticas.sql, whatsapp.sql e banco.sql.
-- Pode rodar mais de uma vez. O Supabase pode avisar sobre "operação destrutiva" (o arquivo recria
-- uma função interna): pode confirmar.

-- ---------- Configurações novas ----------

alter table public.config
  add column if not exists multa_mensal_apos_10 numeric(10, 2) not null default 5,   -- acréscimo do dia 11 ao 20
  add column if not exists multa_mensal_apos_20 numeric(10, 2) not null default 10,  -- acréscimo depois do dia 20
  add column if not exists multa_falta numeric(10, 2) not null default 0,            -- falta sem tirar o nome (0 = desligada)
  add column if not exists multa_saida numeric(10, 2) not null default 0,            -- saída da lista após as 17h (0 = desligada)
  add column if not exists rebaixar_automatico boolean not null default false;       -- virar diarista na virada do mês

-- ---------- Funções de apoio ----------

create or replace function public.fmt_valor(v numeric) returns text
language sql immutable as $$
  select 'R$ ' || replace(to_char(coalesce(v, 0), 'FM999990.00'), '.', ',')
$$;

-- A partida é a última quarta do mês?
create or replace function public.ultima_pelada_do_mes(p_data date) returns boolean
language sql immutable as $$
  select extract(month from p_data + 7) <> extract(month from p_data)
$$;

-- Mensalistas (goleiros fixos ficam de fora) sem a mensalidade do mês marcada como paga.
create or replace function public.mensalistas_em_aberto(p_mes text)
returns table (id uuid, nome text)
language sql stable security definer set search_path = public as $$
  select pe.id, pe.nome
  from perfis pe
  where pe.tipo = 'mensalista' and not pe.goleiro
    and not exists (select 1 from pagamentos pg
                    where pg.user_id = pe.id and pg.tipo = 'mensal' and pg.mes = p_mes)
  order by pe.nome
$$;
revoke execute on function public.mensalistas_em_aberto(text) from public, anon, authenticated;

-- O mês só conta para bloqueio e perda de vaga se teve ao menos uma mensalidade marcada no app.
-- Sem isso, um mês que ninguém controlou pelo app puniria todos os mensalistas de uma vez.
create or replace function public.mes_controlado(p_mes text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from pagamentos where tipo = 'mensal' and mes = p_mes)
$$;
revoke execute on function public.mes_controlado(text) from public, anon, authenticated;

-- Mesma lista, para a tela do administrador.
create or replace function public.inadimplentes(p_mes text)
returns table (id uuid, nome text)
language sql stable security definer set search_path = public as $$
  select m.id, m.nome from mensalistas_em_aberto(p_mes) m
  where public.is_admin() and public.mes_controlado(p_mes)
$$;
revoke execute on function public.inadimplentes(text) from public, anon;
grant execute on function public.inadimplentes(text) to authenticated;

-- Quem não pode jogar a partida: na última pelada do mês, mensalista com a mensalidade em aberto.
-- (O app aplica o bloqueio depois das 17h; antes disso, usa a lista para avisar o jogador.)
create or replace function public.bloqueados_partida(p_partida bigint)
returns setof uuid
language sql stable security definer set search_path = public as $$
  select m.id
  from partidas pt, lateral mensalistas_em_aberto(to_char(pt.data, 'YYYY-MM')) m
  where pt.id = p_partida and ultima_pelada_do_mes(pt.data)
    and mes_controlado(to_char(pt.data, 'YYYY-MM'))
$$;
revoke execute on function public.bloqueados_partida(bigint) from public, anon;
grant execute on function public.bloqueados_partida(bigint) to authenticated;

-- Acréscimo da mensalidade de um mês, se fosse paga hoje.
create or replace function public.multa_mensalidade_hoje(p_mes text) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  mes_hoje text := to_char(hoje, 'YYYY-MM');
  c config;
begin
  select * into c from config where id = 1;
  if p_mes > mes_hoje then return 0; end if;
  if p_mes < mes_hoje or extract(day from hoje) > 20 then return c.multa_mensal_apos_20; end if;
  if extract(day from hoje) > 10 then return c.multa_mensal_apos_10; end if;
  return 0;
end $$;
revoke execute on function public.multa_mensalidade_hoje(text) from public, anon;
grant execute on function public.multa_mensalidade_hoje(text) to authenticated;

-- ---------- Lista da partida (usada pelos avisos e pelas multas), agora com os bloqueados ----------

create schema if not exists privado;
drop function if exists privado.lista_partida(bigint, boolean);
create function privado.lista_partida(p_partida bigint, p_apos_corte boolean)
returns table (grupo text, posicao int, nome text, tipo text, user_id uuid)
language sql stable set search_path = public as $$
  with base as (
    select pe.nome, pe.tipo, pe.goleiro, pr.criado_em, pr.user_id as uid,
           (pe.tipo = 'mensalista' and (not p_apos_corte or pr.criado_em < pt.prioridade_ate)) as prio,
           (p_apos_corte and not pe.goleiro
            and pr.user_id in (select public.bloqueados_partida(p_partida))) as bloq
    from presencas pr
    join perfis pe on pe.id = pr.user_id
    join partidas pt on pt.id = pr.partida_id
    where pr.partida_id = p_partida
  ),
  linha as (
    select b.*, row_number() over (order by b.prio desc, b.criado_em, b.uid) as n
    from base b where not b.goleiro and not b.bloq
  ),
  classificada as (
    select l.*,
           case when l.n <= (select vagas from config where id = 1) and (p_apos_corte or l.prio)
                then 'jogador' else 'espera' end as g
    from linha l
  )
  select 'goleiro', (row_number() over (order by b.criado_em, b.uid))::int, b.nome, b.tipo, b.uid
  from base b where b.goleiro
  union all
  select 'bloqueado', (row_number() over (order by b.criado_em, b.uid))::int, b.nome, b.tipo, b.uid
  from base b where b.bloq
  union all
  select c.g, (row_number() over (partition by c.g order by c.n))::int, c.nome, c.tipo, c.uid
  from classificada c
$$;

-- ---------- Multas ----------

create table if not exists public.multas (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.perfis (id) on delete cascade,
  motivo text not null check (motivo in ('mensalidade', 'falta', 'saida', 'outro')),
  descricao text not null,
  partida_id bigint references public.partidas (id) on delete cascade,
  mes text,
  valor numeric(10, 2) not null check (valor >= 0),
  status text not null default 'pendente' check (status in ('pendente', 'paga', 'abonada')),
  justificativa text not null default '',
  criado_em timestamptz not null default now(),
  resolvido_em timestamptz
);
alter table public.multas enable row level security;
grant select, insert, update, delete on public.multas to authenticated;
drop policy if exists multas_ver on public.multas;
create policy multas_ver on public.multas for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists multas_admin on public.multas;
create policy multas_admin on public.multas for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Registro no histórico de tudo o que acontece com uma multa.
create or replace function public.hist_multa() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r multas;
  o_que text;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  if not exists (select 1 from perfis where id = r.user_id) then return r; end if;
  if tg_op = 'INSERT' then
    o_que := case r.status when 'paga' then 'lançada já paga' else 'lançada' end;
  elsif tg_op = 'DELETE' then
    o_que := 'excluída';
  elsif new.status is distinct from old.status then
    o_que := case new.status
      when 'paga' then 'paga'
      when 'abonada' then 'abonada' || case when new.justificativa <> '' then ' (' || new.justificativa || ')' else '' end
      else 'voltou a pendente' end;
  else
    return r;
  end if;
  perform registrar_se_possivel('financeiro', r.partida_id,
    'multa de ' || (select nome from perfis where id = r.user_id) || ' — ' || r.descricao
    || ' (' || fmt_valor(r.valor) || '): ' || o_que);
  return r;
end $$;
drop trigger if exists hist_multa on public.multas;
create trigger hist_multa after insert or update or delete on public.multas
  for each row execute function public.hist_multa();

-- Multa automática: o próprio jogador saiu da lista depois das 17h estando convocado.
create or replace function public.multa_saida_tardia() returns trigger
language plpgsql security definer set search_path = public, privado as $$
declare
  pt partidas;
  v numeric;
  g text;
begin
  begin
    if auth.uid() is null or auth.uid() <> old.user_id then return old; end if;
    select * into pt from partidas where id = old.partida_id;
    if pt.id is null or now() < pt.prioridade_ate or now() >= pt.fim then return old; end if;
    select multa_saida into v from config where id = 1;
    if coalesce(v, 0) <= 0 then return old; end if;
    select l.grupo into g from privado.lista_partida(old.partida_id, true) l where l.user_id = old.user_id;
    if g in ('jogador', 'goleiro') then
      insert into multas (user_id, motivo, descricao, partida_id, valor)
      values (old.user_id, 'saida', 'Saída da lista após as 17h em ' || to_char(pt.data, 'DD/MM'), pt.id, v);
    end if;
  exception when others then
    null; -- sair da lista nunca pode falhar por causa da multa
  end;
  return old;
end $$;
drop trigger if exists multa_saida_tardia on public.presencas;
create trigger multa_saida_tardia before delete on public.presencas
  for each row execute function public.multa_saida_tardia();

-- Multa automática: estava convocado no fim da lista e não entrou na súmula (faltou sem tirar o nome).
create or replace function public.gerar_multas_falta(p_partida bigint) returns void
language plpgsql security definer set search_path = public, privado as $$
declare
  v numeric;
  v_data date;
begin
  select multa_falta into v from config where id = 1;
  select data into v_data from partidas where id = p_partida;
  -- Quem entrou na súmula depois de uma correção deixa de dever a multa de falta ainda pendente.
  delete from multas m
   where m.partida_id = p_partida and m.motivo = 'falta' and m.status = 'pendente'
     and exists (select 1 from estatisticas e where e.partida_id = p_partida and e.user_id = m.user_id);
  if coalesce(v, 0) <= 0 or not exists (select 1 from estatisticas where partida_id = p_partida) then
    return;
  end if;
  insert into multas (user_id, motivo, descricao, partida_id, valor)
  select l.user_id, 'falta', 'Falta sem aviso em ' || to_char(v_data, 'DD/MM'), p_partida, v
  from privado.lista_partida(p_partida, true) l
  where l.grupo in ('jogador', 'goleiro')
    and not exists (select 1 from estatisticas e where e.partida_id = p_partida and e.user_id = l.user_id)
    and not exists (select 1 from multas m where m.partida_id = p_partida and m.user_id = l.user_id and m.motivo = 'falta');
end $$;
revoke execute on function public.gerar_multas_falta(bigint) from public, anon, authenticated;

-- A súmula passa a gerar as multas de falta ao ser salva.
create or replace function public.salvar_sumula(p_partida bigint, p_linhas jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_data date;
begin
  if not is_admin() then
    raise exception 'Apenas o administrador pode lançar estatísticas.';
  end if;
  select data into v_data from partidas where id = p_partida;
  if v_data is null then
    raise exception 'Partida não encontrada.';
  end if;
  delete from estatisticas where partida_id = p_partida;
  insert into estatisticas (partida_id, user_id, gols, assistencias)
  select p_partida, (l ->> 'user_id')::uuid,
         coalesce((l ->> 'gols')::int, 0), coalesce((l ->> 'assistencias')::int, 0)
  from jsonb_array_elements(coalesce(p_linhas, '[]'::jsonb)) l;
  perform registrar_se_possivel('estatistica', p_partida,
    'súmula de ' || to_char(v_data, 'DD/MM') || ' salva: '
    || (select count(*) from estatisticas where partida_id = p_partida) || ' jogadores, '
    || (select coalesce(sum(gols), 0) from estatisticas where partida_id = p_partida) || ' gols');
  perform gerar_multas_falta(p_partida);
end $$;

-- ---------- Mensalidade com acréscimo por atraso ----------

create or replace function public.marcar_mensalidade(p_user uuid, p_mes text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_extra numeric := multa_mensalidade_hoje(p_mes);
begin
  if not is_admin() then
    raise exception 'Apenas o administrador pode marcar pagamentos.';
  end if;
  insert into pagamentos (user_id, tipo, mes, valor)
  values (p_user, 'mensal', p_mes, (select valor_mensal from config where id = 1));
  if v_extra > 0 then
    insert into multas (user_id, motivo, descricao, mes, valor, status, resolvido_em)
    values (p_user, 'mensalidade', 'Atraso da mensalidade de ' || p_mes, p_mes, v_extra, 'paga', now());
  end if;
end $$;
revoke execute on function public.marcar_mensalidade(uuid, text) from public, anon;
grant execute on function public.marcar_mensalidade(uuid, text) to authenticated;

create or replace function public.desmarcar_mensalidade(p_user uuid, p_mes text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Apenas o administrador pode desmarcar pagamentos.';
  end if;
  delete from pagamentos where user_id = p_user and tipo = 'mensal' and mes = p_mes;
  delete from multas where user_id = p_user and motivo = 'mensalidade' and mes = p_mes;
end $$;
revoke execute on function public.desmarcar_mensalidade(uuid, text) from public, anon;
grant execute on function public.desmarcar_mensalidade(uuid, text) to authenticated;

-- ---------- Virada do mês: quem não pagou vira diarista ----------

create or replace function public.rebaixar_inadimplentes(p_mes text) returns int
language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  if auth.uid() is not null and not is_admin() then
    raise exception 'Apenas o administrador pode fazer isso.';
  end if;
  if not mes_controlado(p_mes) then
    return 0;
  end if;
  update perfis set tipo = 'diarista'
   where id in (select m.id from mensalistas_em_aberto(p_mes) m);
  get diagnostics n = row_count;
  if n > 0 then
    perform registrar_se_possivel('perfil', null,
      n || ' mensalista(s) viraram diaristas: mensalidade de ' || p_mes || ' em aberto');
  end if;
  return n;
end $$;
revoke execute on function public.rebaixar_inadimplentes(text) from public, anon;
grant execute on function public.rebaixar_inadimplentes(text) to authenticated;

-- Roda sozinha no dia 1º; só age se a opção estiver ligada em Organizar > Ajustes.
create or replace function public.virada_do_mes() returns void
language plpgsql security definer set search_path = public as $$
begin
  if (select rebaixar_automatico from config where id = 1) then
    perform rebaixar_inadimplentes(
      to_char(((now() at time zone 'America/Sao_Paulo')::date - interval '1 month'), 'YYYY-MM'));
  end if;
end $$;
revoke execute on function public.virada_do_mes() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- 03:05 UTC do dia 1º = 00:05 de Brasília.
    perform cron.schedule('pelada-virada-mes', '5 3 1 * *', 'select public.virada_do_mes()');
  end if;
end $$;

-- ---------- Financeiro: as multas pagas entram nos créditos do mês em que foram pagas ----------

create or replace function public.financeiro_pagamentos()
returns table (mes text, tipo text, quantidade int, total numeric)
language sql stable set search_path = public as $$
  select coalesce(pg.mes, to_char(pt.data, 'YYYY-MM')), pg.tipo, count(*)::int, sum(pg.valor)
  from pagamentos pg
  left join partidas pt on pt.id = pg.partida_id
  where public.is_admin()
  group by 1, 2
  union all
  select to_char(m.resolvido_em at time zone 'America/Sao_Paulo', 'YYYY-MM'), 'multa', count(*)::int, sum(m.valor)
  from multas m
  where public.is_admin() and m.status = 'paga' and m.resolvido_em is not null
  group by 1
$$;

-- Assiduidade: partidas que têm súmula lançada.
create or replace function public.partidas_com_sumula()
returns table (partida_id bigint, data date)
language sql stable set search_path = public as $$
  select p.id, p.data from partidas p
  where exists (select 1 from estatisticas e where e.partida_id = p.id)
  order by p.data
$$;
revoke execute on function public.partidas_com_sumula() from public, anon;
grant execute on function public.partidas_com_sumula() to authenticated;

-- ---------- Avisos do WhatsApp: cobrança, artilharia e bloqueio ----------

create or replace function privado.bloco(p_partida bigint, p_apos_corte boolean, p_grupo text)
returns text language sql stable as $$
  select coalesce(
    string_agg(l.posicao || '. ' || l.nome || case when l.tipo = 'diarista' then ' (diarista)' else '' end,
               chr(10) order by l.posicao),
    '—')
  from privado.lista_partida(p_partida, p_apos_corte) l
  where l.grupo = p_grupo
$$;

-- p_tipo: 'lembrete' (quarta, 10h), 'convocacao' (quarta, 17h) ou 'cobranca' (todo dia; só devolve
-- texto nos dias 9, 10, 20 e no último dia do mês, e apenas se houver mensalidade em aberto).
create or replace function privado.montar_mensagem(p_tipo text)
returns text language plpgsql as $$
declare
  pt public.partidas;
  c public.config;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  meses text[] := array['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto',
                        'setembro', 'outubro', 'novembro', 'dezembro'];
  v_dia text;
  n_jog int; n_gol int; n_esp int; n_bloq int;
  apos boolean := (p_tipo = 'convocacao');
  nl text := chr(10);
  txt text;
  abertos text;
  n_abertos int;
  artilharia text;
  ultimo_dia boolean;
  mes_txt text;
begin
  select * into c from public.config where id = 1;

  if p_tipo = 'cobranca' then
    select string_agg('• ' || m.nome, nl order by m.nome), count(*)
      into abertos, n_abertos
    from public.mensalistas_em_aberto(to_char(hoje, 'YYYY-MM')) m;
    if coalesce(n_abertos, 0) = 0 then return null; end if;
    mes_txt := meses[extract(month from hoje)::int];
    ultimo_dia := extract(month from hoje + 1) <> extract(month from hoje);
    if extract(day from hoje) = 9 then
      txt := '💰 *Mensalidade de ' || mes_txt || '*' || nl
          || 'Vence amanhã, dia 10: ' || public.fmt_valor(c.valor_mensal) || '.';
    elsif extract(day from hoje) = 10 then
      txt := '💰 *Mensalidade de ' || mes_txt || '*' || nl
          || 'Hoje é o último dia para pagar sem multa: ' || public.fmt_valor(c.valor_mensal) || '.';
    elsif extract(day from hoje) = 20 then
      txt := '💰 *Mensalidade de ' || mes_txt || ' em atraso*' || nl
          || 'A partir de amanhã o valor passa para '
          || public.fmt_valor(c.valor_mensal + c.multa_mensal_apos_20) || '.';
    elsif ultimo_dia then
      txt := '💰 *Mensalidade de ' || mes_txt || ' em atraso*' || nl
          || 'Hoje é o último dia do mês: quem não pagar perde a vaga fixa e vira diarista.';
    else
      return null;
    end if;
    txt := txt || nl || nl || '*Em aberto (' || n_abertos || ')*' || nl || abertos;
    if c.chave_pix <> '' then
      txt := txt || nl || nl || 'Chave Pix: ' || c.chave_pix;
    end if;
    return txt;
  end if;

  select * into pt from public.garantir_partida();
  v_dia := to_char(pt.inicio at time zone 'America/Sao_Paulo', 'DD/MM');

  select count(*) filter (where grupo = 'jogador'),
         count(*) filter (where grupo = 'goleiro'),
         count(*) filter (where grupo = 'espera'),
         count(*) filter (where grupo = 'bloqueado')
    into n_jog, n_gol, n_esp, n_bloq
  from privado.lista_partida(pt.id, apos);

  if p_tipo = 'convocacao' then
    txt := '⚽ *' || c.nome_grupo || '* — quarta ' || v_dia || ', 20h às 22h' || nl || nl
        || '*Convocados (' || n_jog || '/' || c.vagas || ')*' || nl
        || privado.bloco(pt.id, true, 'jogador') || nl || nl
        || '*Goleiros*' || nl || privado.bloco(pt.id, true, 'goleiro');
    if n_esp > 0 then
      txt := txt || nl || nl || '*Lista de espera*' || nl || privado.bloco(pt.id, true, 'espera');
    end if;
    if n_bloq > 0 then
      txt := txt || nl || nl || '*Fora por mensalidade em aberto*' || nl || privado.bloco(pt.id, true, 'bloqueado');
    end if;
    if n_jog < c.vagas then
      txt := txt || nl || nl || 'Ainda há ' || (c.vagas - n_jog) || ' vaga(s): quem confirmar agora entra direto.';
    end if;
    txt := txt || nl || nl || 'Não vai poder ir? Cancele no app para liberar a vaga.';
  elsif p_tipo = 'lembrete' then
    txt := '⚽ *' || c.nome_grupo || '* — quarta ' || v_dia || ', 20h às 22h' || nl || nl
        || '*Mensalistas confirmados (' || n_jog || '/' || c.vagas || ')*' || nl
        || privado.bloco(pt.id, false, 'jogador') || nl || nl
        || '*Goleiros (' || n_gol || ')*' || nl
        || privado.bloco(pt.id, false, 'goleiro');
    if n_esp > 0 then
      txt := txt || nl || nl || '*Lista de espera (' || n_esp || ')*' || nl
          || privado.bloco(pt.id, false, 'espera');
    end if;
    txt := txt || nl || nl
        || 'Mensalistas têm prioridade até as 17h de hoje. Depois disso, as vagas que sobrarem vão para a lista de espera.';

    -- Última pelada do mês: quem está com a mensalidade em aberto não joga.
    if public.ultima_pelada_do_mes(pt.data) then
      select string_agg('• ' || m.nome, nl order by m.nome), count(*)
        into abertos, n_abertos
      from public.mensalistas_em_aberto(to_char(pt.data, 'YYYY-MM')) m;
      if coalesce(n_abertos, 0) > 0 then
        txt := txt || nl || nl || '⚠️ *Última pelada do mês*: quem não pagar a mensalidade até as 17h não joga hoje.'
            || nl || abertos;
      end if;
    end if;

    -- Artilharia do ano (três primeiros).
    select string_agg(pos || '. ' || nome || ' (' || gols || ')', nl order by pos)
      into artilharia
    from (
      select row_number() over (order by sum(e.gols) desc, pe.nome) as pos, pe.nome, sum(e.gols) as gols
      from public.estatisticas e
      join public.partidas p on p.id = e.partida_id
      join public.perfis pe on pe.id = e.user_id
      where extract(year from p.data) = extract(year from pt.data)
      group by pe.id, pe.nome
      having sum(e.gols) > 0
      order by sum(e.gols) desc, pe.nome
      limit 3
    ) t;
    if artilharia is not null then
      txt := txt || nl || nl || '*Artilharia de ' || extract(year from pt.data)::int || '*' || nl || artilharia;
    end if;
  else
    raise exception 'Tipo de notificação desconhecido: %', p_tipo;
  end if;
  return txt;
end $$;
