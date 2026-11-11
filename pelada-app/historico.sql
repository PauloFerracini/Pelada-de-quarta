-- Histórico de movimentações da lista e das alterações dos administradores.
-- Cole este arquivo inteiro em: Supabase > SQL Editor > New query > Run.
-- Pode rodar mais de uma vez sem duplicar nada.

create table if not exists public.historico (
  id bigint generated always as identity primary key,
  criado_em timestamptz not null default now(),
  tipo text not null check (tipo in ('entrou', 'saiu', 'perfil', 'pagamento', 'config')),
  partida_id bigint,
  user_id uuid,                               -- quem foi afetado
  nome text not null default '',              -- nome de quem foi afetado, na hora do registro
  autor_id uuid,                              -- quem fez (vazio = feito direto no painel do banco)
  autor_nome text not null default '',
  por_admin boolean not null default false,   -- ação feita por outra pessoa que não o próprio jogador
  entrada_em timestamptz,                     -- nas saídas: quando a pessoa tinha entrado na lista
  detalhe text not null default ''
);
create index if not exists historico_partida on public.historico (partida_id, criado_em desc);
create index if not exists historico_admin on public.historico (criado_em desc) where por_admin;

-- Ninguém escreve aqui pelo app: só os gatilhos abaixo. Todos veem entradas e saídas da lista;
-- o restante (perfil, pagamento, configurações) só os administradores.
alter table public.historico enable row level security;
grant select on public.historico to authenticated;
drop policy if exists historico_ver on public.historico;
create policy historico_ver on public.historico for select to authenticated
  using (tipo in ('entrou', 'saiu') or public.is_admin());

create or replace function public.registrar_historico(
  p_tipo text, p_partida bigint, p_user uuid, p_detalhe text, p_entrada timestamptz default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_autor uuid := auth.uid();
begin
  insert into historico (tipo, partida_id, user_id, nome, autor_id, autor_nome, por_admin, entrada_em, detalhe)
  values (
    p_tipo, p_partida, p_user,
    coalesce((select nome from perfis where id = p_user), ''),
    v_autor,
    coalesce((select nome from perfis where id = v_autor), ''),
    p_tipo in ('perfil', 'pagamento', 'config') or v_autor is distinct from p_user,
    p_entrada,
    coalesce(p_detalhe, '')
  );
end $$;
revoke execute on function public.registrar_historico(text, bigint, uuid, text, timestamptz)
  from public, anon, authenticated;

-- Entradas e saídas da lista.
create or replace function public.hist_presenca() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform registrar_historico('entrou', new.partida_id, new.user_id, '');
    return new;
  end if;
  -- Não registra quando a saída é efeito de apagar a conta ou a partida.
  if exists (select 1 from perfis where id = old.user_id)
     and exists (select 1 from partidas where id = old.partida_id) then
    perform registrar_historico('saiu', old.partida_id, old.user_id, '', old.criado_em);
  end if;
  return old;
end $$;
drop trigger if exists hist_presenca on public.presencas;
create trigger hist_presenca after insert or delete on public.presencas
  for each row execute function public.hist_presenca();

-- Mudanças no cadastro de um jogador.
create or replace function public.hist_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  d text := '';
begin
  if new.nome is distinct from old.nome then
    d := d || 'nome: ' || old.nome || ' → ' || new.nome || '; ';
  end if;
  if new.tipo is distinct from old.tipo then
    d := d || 'tipo: ' || old.tipo || ' → ' || new.tipo || '; ';
  end if;
  if new.goleiro is distinct from old.goleiro then
    d := d || case when new.goleiro then 'virou goleiro fixo' else 'deixou de ser goleiro fixo' end || '; ';
  end if;
  if new.admin is distinct from old.admin then
    d := d || case when new.admin then 'virou administrador' else 'deixou de ser administrador' end || '; ';
  end if;
  if d <> '' then
    perform registrar_historico('perfil', null, new.id, rtrim(d, '; '));
  end if;
  return new;
end $$;
drop trigger if exists hist_perfil on public.perfis;
create trigger hist_perfil after update on public.perfis
  for each row execute function public.hist_perfil();

-- Pagamentos marcados e desmarcados.
create or replace function public.hist_pagamento() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r pagamentos;
  d text;
begin
  if tg_op = 'INSERT' then r := new; else r := old; end if;
  if not exists (select 1 from perfis where id = r.user_id) then
    return r;
  end if;
  if r.tipo = 'mensal' then
    d := 'mensalidade de ' || r.mes;
  else
    d := 'diária de ' || coalesce((select to_char(data, 'DD/MM') from partidas where id = r.partida_id), '?');
  end if;
  if tg_op = 'INSERT' then
    d := d || ' marcada como paga (R$ ' || replace(to_char(r.valor, 'FM999990.00'), '.', ',') || ')';
  else
    d := d || ' desmarcada';
  end if;
  perform registrar_historico('pagamento', r.partida_id, r.user_id, d);
  return r;
end $$;
drop trigger if exists hist_pagamento on public.pagamentos;
create trigger hist_pagamento after insert or delete on public.pagamentos
  for each row execute function public.hist_pagamento();

-- Mudanças nas configurações.
create or replace function public.hist_config() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  d text := '';
begin
  if new.nome_grupo is distinct from old.nome_grupo then
    d := d || 'nome do grupo: ' || old.nome_grupo || ' → ' || new.nome_grupo || '; ';
  end if;
  if new.vagas is distinct from old.vagas then
    d := d || 'vagas: ' || old.vagas || ' → ' || new.vagas || '; ';
  end if;
  if new.valor_mensal is distinct from old.valor_mensal then
    d := d || 'mensalidade: ' || old.valor_mensal || ' → ' || new.valor_mensal || '; ';
  end if;
  if new.valor_diaria is distinct from old.valor_diaria then
    d := d || 'diária: ' || old.valor_diaria || ' → ' || new.valor_diaria || '; ';
  end if;
  if new.chave_pix is distinct from old.chave_pix then
    d := d || 'chave Pix alterada; ';
  end if;
  if d <> '' then
    perform registrar_historico('config', null, null, rtrim(d, '; '));
  end if;
  return new;
end $$;
drop trigger if exists hist_config on public.config;
create trigger hist_config after update on public.config
  for each row execute function public.hist_config();

-- Primeira vez: registra como "entrou" quem já está nas listas, com o horário original.
insert into public.historico (criado_em, tipo, partida_id, user_id, nome, autor_id, autor_nome, por_admin)
select pr.criado_em, 'entrou', pr.partida_id, pr.user_id, pe.nome, pr.user_id, pe.nome, false
from public.presencas pr
join public.perfis pe on pe.id = pr.user_id
where not exists (select 1 from public.historico);
