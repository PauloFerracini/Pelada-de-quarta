-- Estatísticas (gols e assistências) e financeiro da pelada.
-- Cole este arquivo inteiro em: Supabase > SQL Editor > New query > Run.
-- Rode depois do historico.sql. Pode rodar mais de uma vez.

-- ---------- Histórico: novos tipos de registro e visibilidade só para administradores ----------

do $$
begin
  if to_regclass('public.historico') is not null then
    alter table public.historico drop constraint if exists historico_tipo_check;
    alter table public.historico add constraint historico_tipo_check
      check (tipo in ('entrou', 'saiu', 'perfil', 'pagamento', 'config', 'financeiro', 'estatistica'));
    drop policy if exists historico_ver on public.historico;
    create policy historico_ver on public.historico for select to authenticated
      using (public.is_admin());
  end if;
end $$;

-- Registra no histórico sem quebrar nada se o historico.sql ainda não tiver sido rodado.
create or replace function public.registrar_se_possivel(p_tipo text, p_partida bigint, p_detalhe text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform registrar_historico(p_tipo, p_partida, null, p_detalhe);
exception when undefined_function or check_violation then
  null;
end $$;
revoke execute on function public.registrar_se_possivel(text, bigint, text) from public, anon, authenticated;

-- ---------- Estatísticas ----------

-- Uma linha por jogador que participou da partida (mesmo com 0 gol e 0 assistência).
create table if not exists public.estatisticas (
  partida_id bigint not null references public.partidas (id) on delete cascade,
  user_id uuid not null references public.perfis (id) on delete cascade,
  gols int not null default 0 check (gols between 0 and 99),
  assistencias int not null default 0 check (assistencias between 0 and 99),
  primary key (partida_id, user_id)
);
alter table public.estatisticas enable row level security;
grant select on public.estatisticas to authenticated;
drop policy if exists estatisticas_ver on public.estatisticas;
create policy estatisticas_ver on public.estatisticas for select to authenticated using (true);
-- Sem regra de escrita: só a função salvar_sumula grava.

-- Grava a súmula de uma partida inteira de uma vez. p_linhas: [{"user_id": "...", "gols": 2, "assistencias": 1}, ...]
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
end $$;
revoke execute on function public.salvar_sumula(bigint, jsonb) from public, anon;
grant execute on function public.salvar_sumula(bigint, jsonb) to authenticated;

-- Ranking de um ano: jogos, gols e assistências por jogador.
create or replace function public.ranking_ano(p_ano int)
returns table (user_id uuid, jogos int, gols int, assistencias int)
language sql stable set search_path = public as $$
  select e.user_id, count(*)::int, coalesce(sum(e.gols), 0)::int, coalesce(sum(e.assistencias), 0)::int
  from estatisticas e
  join partidas p on p.id = e.partida_id
  where extract(year from p.data) = p_ano
  group by e.user_id
$$;
revoke execute on function public.ranking_ano(int) from public, anon;
grant execute on function public.ranking_ano(int) to authenticated;

-- ---------- Financeiro (só administradores) ----------

-- Lançamentos manuais: despesas e créditos que não vêm dos pagamentos marcados no app.
create table if not exists public.lancamentos (
  id bigint generated always as identity primary key,
  mes text not null check (mes ~ '^\d{4}-\d{2}$'),
  tipo text not null check (tipo in ('credito', 'despesa')),
  descricao text not null check (length(trim(descricao)) > 0),
  valor numeric(10, 2) not null check (valor >= 0),
  criado_em timestamptz not null default now()
);
alter table public.lancamentos enable row level security;
grant select, insert, delete on public.lancamentos to authenticated;
drop policy if exists lancamentos_admin on public.lancamentos;
create policy lancamentos_admin on public.lancamentos for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create or replace function public.hist_lancamento() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r lancamentos;
begin
  if tg_op = 'INSERT' then r := new; else r := old; end if;
  perform registrar_se_possivel('financeiro', null,
    case when r.tipo = 'credito' then 'crédito' else 'despesa' end || ' de ' || r.mes || ': ' || r.descricao
    || ' (R$ ' || replace(to_char(r.valor, 'FM999990.00'), '.', ',') || ')'
    || case when tg_op = 'INSERT' then ' lançado' else ' excluído' end);
  return r;
end $$;
drop trigger if exists hist_lancamento on public.lancamentos;
create trigger hist_lancamento after insert or delete on public.lancamentos
  for each row execute function public.hist_lancamento();

-- Soma, por mês, dos pagamentos marcados no app (mensalidades e diárias). Só administradores veem
-- valores, porque as regras de acesso da tabela de pagamentos continuam valendo aqui.
create or replace function public.financeiro_pagamentos()
returns table (mes text, tipo text, quantidade int, total numeric)
language sql stable set search_path = public as $$
  select coalesce(pg.mes, to_char(pt.data, 'YYYY-MM')), pg.tipo, count(*)::int, sum(pg.valor)
  from pagamentos pg
  left join partidas pt on pt.id = pg.partida_id
  where public.is_admin()
  group by 1, 2
$$;
revoke execute on function public.financeiro_pagamentos() from public, anon;
grant execute on function public.financeiro_pagamentos() to authenticated;
