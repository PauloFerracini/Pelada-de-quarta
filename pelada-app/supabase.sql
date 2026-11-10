-- Banco de dados da pelada (Supabase / Postgres).
-- Cole este arquivo inteiro em: Supabase > SQL Editor > New query > Run.

-- ---------- Tabelas ----------

create table public.perfis (
  id uuid primary key references auth.users (id) on delete cascade,
  nome text not null,
  tipo text not null default 'diarista' check (tipo in ('mensalista', 'diarista')),
  goleiro boolean not null default false,
  admin boolean not null default false,
  criado_em timestamptz not null default now()
);

create table public.partidas (
  id bigint generated always as identity primary key,
  data date not null unique,
  inicio timestamptz not null,
  fim timestamptz not null,
  prioridade_ate timestamptz not null
);

create table public.presencas (
  partida_id bigint not null references public.partidas (id) on delete cascade,
  user_id uuid not null references public.perfis (id) on delete cascade,
  criado_em timestamptz not null default now(),
  primary key (partida_id, user_id)
);

create table public.pagamentos (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.perfis (id) on delete cascade,
  tipo text not null check (tipo in ('mensal', 'partida')),
  mes text,                                   -- 'AAAA-MM', quando tipo = 'mensal'
  partida_id bigint references public.partidas (id) on delete cascade, -- quando tipo = 'partida'
  valor numeric(10, 2) not null default 0,
  criado_em timestamptz not null default now(),
  check ((tipo = 'mensal' and mes is not null) or (tipo = 'partida' and partida_id is not null))
);
create unique index pagamentos_mensal_unico on public.pagamentos (user_id, mes) where tipo = 'mensal';
create unique index pagamentos_partida_unico on public.pagamentos (user_id, partida_id) where tipo = 'partida';

create table public.config (
  id int primary key default 1 check (id = 1),
  nome_grupo text not null default 'Pelada de Quarta',
  vagas int not null default 24 check (vagas > 0),
  valor_mensal numeric(10, 2) not null default 0,
  valor_diaria numeric(10, 2) not null default 0,
  chave_pix text not null default ''
);
insert into public.config (id) values (1);

-- ---------- Funções ----------

create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select admin from perfis where id = auth.uid()), false)
$$;

-- Cria o perfil quando alguém se cadastra. A primeira conta criada vira administradora.
create function public.novo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into perfis (id, nome, admin)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'nome'), ''), split_part(new.email, '@', 1)),
    not exists (select 1 from perfis)
  );
  return new;
end $$;
create trigger ao_criar_usuario after insert on auth.users
  for each row execute function public.novo_usuario();

-- Só administrador muda tipo, goleiro e admin de um perfil.
create function public.proteger_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not is_admin()
     and (new.tipo is distinct from old.tipo
       or new.goleiro is distinct from old.goleiro
       or new.admin is distinct from old.admin) then
    raise exception 'Apenas o administrador pode alterar esses dados.';
  end if;
  return new;
end $$;
create trigger antes_de_alterar_perfil before update on public.perfis
  for each row execute function public.proteger_perfil();

-- O horário da confirmação é sempre o do servidor (ninguém consegue furar a fila).
create function public.carimbar_presenca() returns trigger
language plpgsql as $$
begin
  new.criado_em := now();
  return new;
end $$;
create trigger antes_de_confirmar before insert on public.presencas
  for each row execute function public.carimbar_presenca();

-- Devolve a partida da vez (próxima quarta, 20h–22h de Brasília), criando se ainda não existir.
create function public.garantir_partida() returns public.partidas
language plpgsql security definer set search_path = public as $$
declare
  agora_sp timestamp := now() at time zone 'America/Sao_Paulo';
  d date := agora_sp::date;
  p partidas;
begin
  d := d + ((3 - extract(dow from d)::int + 7) % 7);
  if d = agora_sp::date and agora_sp::time >= time '22:00' then
    d := d + 7;
  end if;
  insert into partidas (data, inicio, fim, prioridade_ate)
  values (
    d,
    (d + time '20:00') at time zone 'America/Sao_Paulo',
    (d + time '22:00') at time zone 'America/Sao_Paulo',
    (d + time '17:00') at time zone 'America/Sao_Paulo'
  )
  on conflict (data) do nothing;
  select * into p from partidas where data = d;
  return p;
end $$;
revoke execute on function public.garantir_partida() from public, anon;
grant execute on function public.garantir_partida() to authenticated;
grant execute on function public.is_admin() to authenticated;

-- ---------- Permissões (só quem está logado acessa) ----------

grant select, update on public.perfis to authenticated;
grant select on public.partidas to authenticated;
grant select, insert, delete on public.presencas to authenticated;
grant select, insert, delete on public.pagamentos to authenticated;
grant select, update on public.config to authenticated;

alter table public.perfis enable row level security;
alter table public.partidas enable row level security;
alter table public.presencas enable row level security;
alter table public.pagamentos enable row level security;
alter table public.config enable row level security;

create policy perfis_ver on public.perfis for select to authenticated using (true);
create policy perfis_alterar on public.perfis for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

create policy partidas_ver on public.partidas for select to authenticated using (true);

create policy presencas_ver on public.presencas for select to authenticated using (true);
create policy presencas_confirmar on public.presencas for insert to authenticated
  with check (
    (user_id = auth.uid() or public.is_admin())
    and exists (select 1 from public.partidas p where p.id = partida_id and now() < p.fim)
  );
create policy presencas_cancelar on public.presencas for delete to authenticated
  using (
    public.is_admin()
    or (user_id = auth.uid()
        and exists (select 1 from public.partidas p where p.id = partida_id and now() < p.fim))
  );

create policy pagamentos_ver on public.pagamentos for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy pagamentos_marcar on public.pagamentos for insert to authenticated
  with check (public.is_admin());
create policy pagamentos_desmarcar on public.pagamentos for delete to authenticated
  using (public.is_admin());

create policy config_ver on public.config for select to authenticated using (true);
create policy config_alterar on public.config for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
