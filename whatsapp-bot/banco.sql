-- Ajuste do banco para o envio pelo programa no seu computador.
-- Cole este arquivo inteiro em: Supabase > SQL Editor > New query > Run.
-- (Requer que o whatsapp.sql já tenha sido rodado antes.)
-- No final aparece uma linha com o "segredo": copie para o config.json do programa.

-- Senha que só o programa conhece, para o banco entregar a mensagem.
alter table privado.whatsapp_config add column if not exists segredo text not null default '';
update privado.whatsapp_config
   set segredo = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
 where id = 1 and segredo = '';

-- Monta o texto do aviso. p_tipo: 'lembrete' (antes das 17h) ou 'convocacao' (lista final das 17h).
create or replace function privado.montar_mensagem(p_tipo text)
returns text language plpgsql as $$
declare
  pt public.partidas;
  v_vagas int;
  v_nome text;
  v_dia text;
  n_jog int; n_gol int; n_esp int;
  apos boolean := (p_tipo = 'convocacao');
  nl text := chr(10);
  txt text;
begin
  select * into pt from public.garantir_partida();
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
        || '*Mensalistas confirmados (' || n_jog || '/' || v_vagas || ')*' || nl
        || privado.bloco(pt.id, false, 'jogador') || nl || nl
        || '*Goleiros (' || n_gol || ')*' || nl
        || privado.bloco(pt.id, false, 'goleiro');
    if n_esp > 0 then
      txt := txt || nl || nl || '*Lista de espera (' || n_esp || ')*' || nl
          || privado.bloco(pt.id, false, 'espera');
    end if;
    txt := txt || nl || nl
        || 'Mensalistas têm prioridade até as 17h de hoje. Depois disso, as vagas que sobrarem vão para a lista de espera.';
  else
    raise exception 'Tipo de notificação desconhecido: %', p_tipo;
  end if;
  return txt;
end $$;

-- Porta de entrada do programa: só entrega a mensagem para quem informa o segredo.
create or replace function public.mensagem_whatsapp(p_tipo text, p_segredo text)
returns text language plpgsql security definer set search_path = public, privado as $$
begin
  if coalesce(p_segredo, '') = ''
     or p_segredo is distinct from (select segredo from privado.whatsapp_config where id = 1) then
    raise exception 'Acesso negado.';
  end if;
  return privado.montar_mensagem(p_tipo);
end $$;
revoke execute on function public.mensagem_whatsapp(text, text) from public;
grant execute on function public.mensagem_whatsapp(text, text) to anon, authenticated;

-- O envio agora parte do seu computador: desliga os agendamentos do banco.
select cron.unschedule(jobname) from cron.job where jobname in ('pelada-lembrete', 'pelada-convocacao');

-- Resultado: copie este valor para "segredo" no config.json.
select segredo from privado.whatsapp_config where id = 1;
