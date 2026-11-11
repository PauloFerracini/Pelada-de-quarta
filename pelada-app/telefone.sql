-- Login por número do WhatsApp: apoio para os administradores.
-- Cole este arquivo inteiro em: Supabase > SQL Editor > New query > Run.
-- Pode rodar mais de uma vez.

-- Mostra ao administrador com qual login (telefone ou e-mail) cada jogador se cadastrou.
create or replace function public.admin_logins()
returns table (id uuid, login text)
language sql stable security definer set search_path = public as $$
  select u.id, u.email::text from auth.users u where public.is_admin()
$$;
revoke execute on function public.admin_logins() from public, anon;
grant execute on function public.admin_logins() to authenticated;

-- Permite ao administrador definir uma nova senha para um jogador que esqueceu a sua.
create or replace function public.admin_redefinir_senha(p_user uuid, p_senha text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.is_admin() then
    raise exception 'Apenas o administrador pode redefinir senhas.';
  end if;
  if length(coalesce(p_senha, '')) < 6 then
    raise exception 'A senha precisa ter pelo menos 6 caracteres.';
  end if;
  update auth.users
     set encrypted_password = crypt(p_senha, gen_salt('bf')), updated_at = now()
   where id = p_user;
  if not found then
    raise exception 'Jogador não encontrado.';
  end if;
  -- Fica registrado no histórico, se o historico.sql já tiver sido rodado.
  begin
    perform public.registrar_historico('perfil', null, p_user, 'senha redefinida pelo administrador');
  exception when undefined_function then
    null;
  end;
end $$;
revoke execute on function public.admin_redefinir_senha(uuid, text) from public, anon;
grant execute on function public.admin_redefinir_senha(uuid, text) to authenticated;
