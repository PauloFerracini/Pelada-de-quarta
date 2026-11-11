(function () {
  'use strict';

  const CFG = window.PELADA_CONFIG || {};
  const DEMO = !CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY;
  const TZ = 'America/Sao_Paulo';

  // Login por número do WhatsApp: por dentro, o número vira um "e-mail" fixo neste domínio.
  // Não mude este valor depois que houver contas criadas, ou os números deixam de entrar.
  const DOMINIO_TELEFONE = 'peladaquarta.netlify.app';

  // "(21) 99999-8888" -> "5521999998888". Devolve null se não parecer um celular/fixo com DDD.
  function normalizarTelefone(valor) {
    let d = String(valor || '').replace(/\D/g, '').replace(/^0+/, '');
    if (d.length === 10 || d.length === 11) d = '55' + d;
    return /^55\d{10,11}$/.test(d) ? d : null;
  }
  // Aceita e-mail (contas antigas) ou número do WhatsApp e devolve o login usado no banco.
  function loginParaEmail(valor) {
    const v = String(valor || '').trim().toLowerCase();
    if (v.includes('@')) return v;
    const tel = normalizarTelefone(v);
    if (!tel) throw new Error('Informe o número do WhatsApp com DDD, por exemplo (21) 99999-8888.');
    return `${tel}@${DOMINIO_TELEFONE}`;
  }
  function fmtLogin(login) {
    if (!login) return '';
    const m = login.match(new RegExp('^55(\\d{2})(\\d{4,5})(\\d{4})@' + DOMINIO_TELEFONE.replace(/\./g, '\\.') + '$'));
    return m ? `(${m[1]}) ${m[2]}-${m[3]}` : login;
  }
  const $app = document.getElementById('app');
  const $aviso = document.getElementById('aviso');

  // ---------- Utilidades ----------

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtData = (iso) =>
    new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, weekday: 'long', day: '2-digit', month: 'long' }).format(new Date(iso));
  const fmtDiaMes = (iso) =>
    new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit' }).format(new Date(iso));
  const fmtHora = (iso) =>
    new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(iso)).replace(':00', 'h');
  const fmtMes = (mes) => {
    const [a, m] = mes.split('-');
    return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(Date.UTC(+a, +m - 1, 1)));
  };
  const fmtQuando = (iso) =>
    new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
      .format(new Date(iso)).replace('.,', '').replace(',', '');
  const fmtValor = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  let avisoTimer;
  function aviso(msg, erro) {
    $aviso.textContent = msg;
    $aviso.className = 'visivel' + (erro ? ' erro' : '');
    clearTimeout(avisoTimer);
    avisoTimer = setTimeout(() => ($aviso.className = ''), erro ? 6000 : 3500);
  }

  // ---------- Dados: modo demonstração (só neste aparelho) ----------

  function apiDemo() {
    const CHAVE = 'pelada-demo-v1';
    let mem = null;

    function semente() {
      const p = Logica.proximaQuarta(new Date());
      const usuarios = [], presencas = [];
      let n = 0;
      const add = (nome, tipo, goleiro, confirma) => {
        const id = 'demo' + ++n;
        usuarios.push({ id, nome, tipo, goleiro, admin: false, email: id + '@demo', senha: null });
        if (confirma)
          presencas.push({ partida_id: p.data, user_id: id, criado_em: new Date(Date.now() - (100 - n) * 600000).toISOString() });
      };
      ['Carlão', 'Dudu', 'Tico', 'Marcelo', 'Fabinho', 'Léo', 'Rafa', 'Juninho', 'Beto', 'Guga', 'Neto', 'Caio', 'Vitor',
        'Bruno', 'Diego', 'Thiago', 'Alex', 'Igor', 'Renan', 'Samuel'].forEach((nome, i) => add(nome, 'mensalista', false, i < 18));
      add('Paredão', 'mensalista', true, true);
      add('Muralha', 'mensalista', true, true);
      ['Zeca', 'Pingo', 'Mário', 'Tuca', 'Edu'].forEach((nome, i) => add(nome, 'diarista', false, i < 4));
      return {
        usuarios, presencas, pagamentos: [], sessao: null, seq: 1,
        config: { nome_grupo: 'Pelada de Quarta', vagas: 24, valor_mensal: 80, valor_diaria: 25, chave_pix: '' },
      };
    }
    function ler() {
      if (mem) return mem;
      try { mem = JSON.parse(localStorage.getItem(CHAVE)); } catch (e) { mem = null; }
      return (mem = mem || semente());
    }
    function gravar() {
      try { localStorage.setItem(CHAVE, JSON.stringify(mem)); } catch (e) { /* segue só em memória */ }
    }
    const exigirAdmin = (d) => {
      const eu = d.usuarios.find((u) => u.id === d.sessao);
      if (!eu || !eu.admin) throw new Error('Apenas o administrador pode fazer isso.');
    };
    // Mesmo registro que os gatilhos do banco fazem no app publicado.
    const registrar = (d, tipo, partida_id, user_id, detalhe, entrada_em) => {
      const nomeDe = (id) => (d.usuarios.find((u) => u.id === id) || {}).nome || '';
      d.historico = d.historico || [];
      d.historico.push({
        id: d.seq++, criado_em: new Date().toISOString(), tipo, partida_id, user_id, nome: nomeDe(user_id),
        autor_id: d.sessao, autor_nome: nomeDe(d.sessao),
        por_admin: ['perfil', 'pagamento', 'config'].includes(tipo) || d.sessao !== user_id,
        entrada_em: entrada_em || null, detalhe: detalhe || '',
      });
    };

    return {
      aoRecuperarSenha() {},
      async sessao() { return ler().sessao; },
      async entrar(email, senha) {
        const d = ler();
        const u = d.usuarios.find((x) => x.email === email.toLowerCase() && x.senha !== null && x.senha === senha);
        if (!u) throw new Error('E-mail ou senha incorretos.');
        d.sessao = u.id; gravar();
      },
      async cadastrar(nome, email, senha) {
        const d = ler();
        email = email.toLowerCase();
        if (senha.length < 6) throw new Error('A senha precisa ter pelo menos 6 caracteres.');
        if (d.usuarios.some((x) => x.email === email)) throw new Error('Já existe uma conta com esse número.');
        const id = 'u' + Math.random().toString(36).slice(2, 10);
        d.usuarios.push({ id, nome, email, senha, tipo: 'diarista', goleiro: false, admin: !d.usuarios.some((x) => x.admin) });
        d.sessao = id; gravar();
      },
      async sair() { ler().sessao = null; gravar(); },
      async recuperar() { throw new Error('A recuperação de senha por e-mail só funciona com o app publicado.'); },
      async novaSenha() {},
      async carregar(uid) {
        const d = ler();
        const p = Logica.proximaQuarta(new Date());
        const partida = { id: p.data, ...p };
        const eu = d.usuarios.find((u) => u.id === uid);
        return {
          eu: uid, partida, config: { ...d.config },
          perfis: d.usuarios.map(({ senha, email, ...resto }) => resto).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
          presencas: d.presencas.filter((x) => x.partida_id === partida.id),
          pagamentos: d.pagamentos.filter((x) => (eu && eu.admin) || x.user_id === uid),
          movimentos: (d.historico || [])
            .filter((h) => h.partida_id === partida.id && (h.tipo === 'entrou' || h.tipo === 'saiu')).reverse(),
          acoesAdmin: eu && eu.admin ? (d.historico || []).filter((h) => h.por_admin).reverse().slice(0, 80) : [],
          logins: eu && eu.admin ? d.usuarios.map((u) => ({ id: u.id, login: u.email })) : [],
        };
      },
      async redefinirSenha(id, senha) {
        const d = ler(); exigirAdmin(d);
        if (senha.length < 6) throw new Error('A senha precisa ter pelo menos 6 caracteres.');
        d.usuarios.find((u) => u.id === id).senha = senha;
        registrar(d, 'perfil', null, id, 'senha redefinida pelo administrador');
        gravar();
      },
      // A demonstração só guarda a partida atual; para ilustrar o relatório, repete a lista de hoje
      // como se fosse a partida da semana passada.
      async relatorio() {
        const d = ler();
        const semana = 7 * 24 * 3600 * 1000;
        const menos7 = (iso) => new Date(new Date(iso).getTime() - semana).toISOString();
        const p = Logica.proximaQuarta(new Date());
        const partida = { id: 'anterior', data: menos7(p.inicio).slice(0, 10), inicio: menos7(p.inicio), fim: menos7(p.fim), prioridade_ate: menos7(p.prioridade_ate) };
        return {
          partidas: [partida],
          presencas: d.presencas.filter((x) => x.partida_id === p.data)
            .map((x) => ({ ...x, partida_id: 'anterior', criado_em: menos7(x.criado_em) })),
          saidas: (d.historico || []).filter((h) => h.tipo === 'saiu' && h.partida_id === p.data)
            .map((h) => ({ partida_id: 'anterior', user_id: h.user_id, criado_em: menos7(h.criado_em) })),
        };
      },
      async confirmar(partida_id, user_id) {
        const d = ler();
        if (user_id !== d.sessao) exigirAdmin(d);
        if (!d.presencas.some((x) => x.partida_id === partida_id && x.user_id === user_id)) {
          d.presencas.push({ partida_id, user_id, criado_em: new Date().toISOString() });
          registrar(d, 'entrou', partida_id, user_id);
        }
        gravar();
      },
      async cancelar(partida_id, user_id) {
        const d = ler();
        if (user_id !== d.sessao) exigirAdmin(d);
        const atual = d.presencas.find((x) => x.partida_id === partida_id && x.user_id === user_id);
        if (atual) {
          d.presencas = d.presencas.filter((x) => x !== atual);
          registrar(d, 'saiu', partida_id, user_id, '', atual.criado_em);
        }
        gravar();
      },
      async atualizarPerfil(id, campos) {
        const d = ler(); exigirAdmin(d);
        Object.assign(d.usuarios.find((u) => u.id === id), campos);
        const [campo, valor] = Object.entries(campos)[0];
        registrar(d, 'perfil', null, id,
          campo === 'tipo' ? `tipo alterado para ${valor}`
            : campo === 'goleiro' ? (valor ? 'virou goleiro fixo' : 'deixou de ser goleiro fixo')
            : (valor ? 'virou administrador' : 'deixou de ser administrador'));
        gravar();
      },
      async marcarPago(p) {
        const d = ler(); exigirAdmin(d);
        d.pagamentos.push({ id: d.seq++, ...p });
        registrar(d, 'pagamento', p.partida_id || null, p.user_id,
          `${p.tipo === 'mensal' ? 'mensalidade de ' + p.mes : 'diária'} marcada como paga`);
        gravar();
      },
      async desmarcarPago(id) {
        const d = ler(); exigirAdmin(d);
        const p = d.pagamentos.find((x) => x.id === id);
        d.pagamentos = d.pagamentos.filter((x) => x.id !== id);
        if (p) registrar(d, 'pagamento', p.partida_id || null, p.user_id,
          `${p.tipo === 'mensal' ? 'mensalidade de ' + p.mes : 'diária'} desmarcada`);
        gravar();
      },
      async salvarConfig(campos) {
        const d = ler(); exigirAdmin(d);
        Object.assign(d.config, campos);
        registrar(d, 'config', null, null, 'configurações alteradas');
        gravar();
      },
    };
  }

  // ---------- Dados: Supabase (app publicado) ----------

  async function apiSupabase() {
    await new Promise((ok, falha) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4';
      s.onload = ok;
      s.onerror = () => falha(new Error('Não foi possível conectar. Verifique sua internet e recarregue a página.'));
      document.head.appendChild(s);
    });
    const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

    const traducoes = [
      ['Invalid login credentials', 'Número (ou e-mail) ou senha incorretos.'],
      ['User already registered', 'Já existe uma conta com esse número.'],
      ['Password should be at least', 'A senha precisa ter pelo menos 6 caracteres.'],
      ['Email not confirmed', 'Confirme seu e-mail antes de entrar (veja sua caixa de entrada).'],
      ['rate limit', 'Muitas tentativas. Aguarde alguns minutos e tente de novo.'],
      ['row-level security', 'Você não tem permissão para fazer isso.'],
      ['Failed to fetch', 'Sem conexão. Verifique sua internet.'],
    ];
    const ok = ({ data, error }) => {
      if (error) {
        const t = traducoes.find(([trecho]) => error.message.includes(trecho));
        throw new Error(t ? t[1] : error.message);
      }
      return data;
    };

    return {
      aoRecuperarSenha(fn) {
        sb.auth.onAuthStateChange((evento) => { if (evento === 'PASSWORD_RECOVERY') fn(); });
      },
      async sessao() {
        const { session } = ok(await sb.auth.getSession());
        return session ? session.user.id : null;
      },
      async entrar(email, senha) { ok(await sb.auth.signInWithPassword({ email, password: senha })); },
      async cadastrar(nome, email, senha) {
        const r = ok(await sb.auth.signUp({ email, password: senha, options: { data: { nome } } }));
        return r.session ? 'ok' : 'confirmar';
      },
      async sair() { ok(await sb.auth.signOut()); },
      async recuperar(email) {
        ok(await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }));
      },
      async novaSenha(senha) { ok(await sb.auth.updateUser({ password: senha })); },
      async carregar(uid) {
        const partida = ok(await sb.rpc('garantir_partida'));
        const mes = partida.data.slice(0, 7);
        const [perfis, presencas, config, pagamentos] = (await Promise.all([
          sb.from('perfis').select('*').order('nome'),
          sb.from('presencas').select('*').eq('partida_id', partida.id),
          sb.from('config').select('*').eq('id', 1).single(),
          sb.from('pagamentos').select('*').or(`mes.eq.${mes},partida_id.eq.${partida.id}`),
        ])).map(ok);
        // O histórico é opcional: se o historico.sql ainda não foi rodado, o app segue sem ele.
        const [mov, adm] = await Promise.all([
          sb.from('historico').select('*').eq('partida_id', partida.id).in('tipo', ['entrou', 'saiu'])
            .order('criado_em', { ascending: false }).order('id', { ascending: false }).limit(300),
          sb.from('historico').select('*').eq('por_admin', true)
            .order('criado_em', { ascending: false }).order('id', { ascending: false }).limit(80),
        ]);
        // Logins (telefone ou e-mail) só para administradores; depende do telefone.sql.
        let logins = [];
        if ((perfis.find((p) => p.id === uid) || {}).admin) {
          const r = await sb.rpc('admin_logins');
          if (!r.error) logins = r.data;
        }
        return {
          eu: uid, partida, perfis, presencas, config, pagamentos, logins,
          movimentos: mov.error ? null : mov.data,
          acoesAdmin: adm.error ? [] : adm.data,
        };
      },
      async redefinirSenha(id, senha) {
        ok(await sb.rpc('admin_redefinir_senha', { p_user: id, p_senha: senha }));
      },
      async relatorio() {
        const partidas = ok(await sb.from('partidas').select('*').lt('fim', new Date().toISOString())
          .order('data', { ascending: false }).limit(8));
        if (!partidas.length) return { partidas, presencas: [], saidas: [] };
        const ids = partidas.map((p) => p.id);
        const [presencas, saidas] = (await Promise.all([
          sb.from('presencas').select('*').in('partida_id', ids),
          sb.from('historico').select('partida_id,user_id,criado_em').eq('tipo', 'saiu').in('partida_id', ids),
        ])).map(ok);
        return { partidas, presencas, saidas };
      },
      async confirmar(partida_id, user_id) { ok(await sb.from('presencas').insert({ partida_id, user_id })); },
      async cancelar(partida_id, user_id) {
        ok(await sb.from('presencas').delete().eq('partida_id', partida_id).eq('user_id', user_id));
      },
      async atualizarPerfil(id, campos) { ok(await sb.from('perfis').update(campos).eq('id', id)); },
      async marcarPago(p) { ok(await sb.from('pagamentos').insert(p)); },
      async desmarcarPago(id) { ok(await sb.from('pagamentos').delete().eq('id', id)); },
      async salvarConfig(campos) { ok(await sb.from('config').update(campos).eq('id', 1)); },
    };
  }

  // ---------- Estado ----------

  let api = null;
  let dados = null;          // null = deslogado
  let aba = 'jogo';          // jogo | historico | pagamento | admin
  let adminAba = 'pagamentos'; // pagamentos | jogadores | relatorios | config
  let relatorioDados = null; // carregado ao abrir Organizar > Relatórios
  let authModo = 'entrar';   // entrar | cadastrar | esqueci
  let recuperando = false;
  let ocupado = false;

  const perfilDe = (id) => dados.perfis.find((p) => p.id === id);
  const eu = () => perfilDe(dados.eu);
  const mesDaPartida = () => dados.partida.data.slice(0, 7);
  const pagoMensal = (id) => dados.pagamentos.find((p) => p.tipo === 'mensal' && p.user_id === id && p.mes === mesDaPartida());
  const pagoPartida = (id) => dados.pagamentos.find((p) => p.tipo === 'partida' && p.user_id === id && p.partida_id === dados.partida.id);
  const alocacao = () =>
    Logica.alocar({ presencas: dados.presencas, perfis: dados.perfis, partida: dados.partida, vagas: dados.config.vagas, agora: new Date() });

  async function recarregar(silencioso) {
    try {
      const uid = await api.sessao();
      dados = uid ? await api.carregar(uid) : null;
      if (dados && !eu()) throw new Error('Seu cadastro não foi encontrado. Fale com o administrador.');
    } catch (e) {
      if (!silencioso) aviso(e.message, true);
      if (!dados) dados = null;
    }
    render();
  }

  async function executar(fn, mensagem) {
    if (ocupado) return;
    ocupado = true;
    try {
      await fn();
      if (mensagem) aviso(mensagem);
    } catch (e) {
      aviso(e.message, true);
    }
    ocupado = false;
    await recarregar(true);
  }

  // ---------- Telas ----------

  function telaAuth() {
    if (recuperando)
      return `<div class="entrada"><h1>Nova senha</h1><p class="nota">Escolha uma nova senha para sua conta.</p>
        <form class="cartao" data-form="auth">
          <label>Nova senha<input name="senha" type="password" minlength="6" required autocomplete="new-password"></label>
          <button class="primario largo">Salvar senha</button>
        </form></div>`;

    const titulos = { entrar: 'Entrar', cadastrar: 'Criar conta', esqueci: 'Recuperar senha' };
    return `<div class="entrada">
      <img class="logo-grande" src="logo.webp" alt="Escudo da Pelada Futebol Andaraí">
      <h1>Pelada Futebol Andaraí</h1>
      <p class="nota">Toda quarta, das 20h às 22h.</p>
      ${DEMO ? '<div class="faixa">Modo demonstração: as contas e os dados ficam só neste aparelho.</div>' : ''}
      <form class="cartao" data-form="auth">
        <h2>${titulos[authModo]}</h2>
        ${authModo === 'cadastrar' ? '<label>Nome ou apelido<input name="nome" required maxlength="40" autocomplete="nickname"></label>' : ''}
        ${authModo === 'cadastrar'
          ? '<label>WhatsApp (com DDD)<input name="email" type="tel" required autocomplete="tel" placeholder="(21) 99999-8888"></label>'
          : authModo === 'entrar'
          ? '<label>WhatsApp (com DDD) ou e-mail<input name="email" type="text" required autocomplete="username" placeholder="(21) 99999-8888"></label>'
          : `<p class="nota">Cadastrou com o número do WhatsApp? Peça ao organizador para redefinir sua senha.
             Se cadastrou com e-mail, informe-o abaixo para receber o link.</p>
             <label>E-mail<input name="email" type="email" required autocomplete="email"></label>`}
        ${authModo !== 'esqueci'
          ? `<label>Senha<input name="senha" type="password" minlength="6" required autocomplete="${authModo === 'cadastrar' ? 'new-password' : 'current-password'}"></label>`
          : ''}
        <button class="primario largo">${{ entrar: 'Entrar', cadastrar: 'Criar conta', esqueci: 'Enviar link' }[authModo]}</button>
      </form>
      ${authModo === 'entrar'
        ? `<button class="link" data-acao="auth-modo" data-v="cadastrar">Não tenho conta — criar agora</button><br>
           <button class="link" data-acao="auth-modo" data-v="esqueci">Esqueci minha senha</button>`
        : '<button class="link" data-acao="auth-modo" data-v="entrar">Já tenho conta — entrar</button>'}
    </div>`;
  }

  function itemLista(i, admin) {
    const p = i.perfil;
    return `<li class="${p.id === dados.eu ? 'eu' : ''}">
      <span class="nome">${esc(p.nome)}${p.id === dados.eu ? ' (você)' : ''}<small class="quando">entrou ${esc(fmtQuando(i.criado_em))}</small></span>
      <span class="etiqueta ${p.tipo === 'diarista' ? 'cinza' : ''}">${p.tipo === 'mensalista' ? 'Mensalista' : 'Diarista'}</span>
      ${admin ? `<button class="pequeno" data-acao="remover" data-id="${esc(p.id)}" aria-label="Tirar ${esc(p.nome)} da lista">Tirar</button>` : ''}
    </li>`;
  }

  function secaoLista(titulo, contador, itens, vazio, admin) {
    return `<section class="cartao"><h2>${titulo}<span>${contador}</span></h2>
      ${itens.length ? `<ol class="lista">${itens.map((i) => itemLista(i, admin)).join('')}</ol>` : `<p class="vazio">${vazio}</p>`}
    </section>`;
  }

  function telaJogo() {
    const { partida, config } = dados;
    const a = alocacao();
    const meu = eu();
    const minha = dados.presencas.some((p) => p.user_id === dados.eu);
    const pos = (lista) => lista.findIndex((i) => i.user_id === dados.eu) + 1;
    const corte = `${fmtHora(partida.prioridade_ate)} de quarta`;

    let status;
    if (!minha) status = 'Você ainda não confirmou presença.';
    else if (pos(a.goleiros)) status = 'Presença confirmada como goleiro.';
    else if (pos(a.jogadores)) status = `Você está dentro! Vaga ${pos(a.jogadores)} de ${config.vagas}.`;
    else if (!a.passouCorte && meu.tipo === 'diarista')
      status = `Você é o ${pos(a.espera)}º da lista de espera. A convocação sai às ${corte}.`;
    else status = `Lista de espera: você é o ${pos(a.espera)}º.`;

    const livres = Math.max(0, config.vagas - a.jogadores.length);
    const regra = a.passouCorte
      ? `Prioridade dos mensalistas encerrada. ${livres ? `Ainda ${livres === 1 ? 'há 1 vaga' : `há ${livres} vagas`}: quem confirmar agora entra direto.` : 'Jogo completo: novas confirmações vão para a lista de espera.'}`
      : `Mensalistas têm prioridade até as ${corte}. ${livres ? `Se a lista fechasse agora, ${livres === 1 ? 'entraria 1 diarista' : `entrariam ${livres} diaristas`} da espera.` : 'Com 24 mensalistas confirmados, não há convocação de diaristas.'}`;

    return `
      <section class="cartao destaque">
        <p class="data">${esc(fmtData(partida.inicio))}</p>
        <p class="hora">${fmtHora(partida.inicio)} às ${fmtHora(partida.fim)}</p>
        <p class="status">${esc(status)}</p>
        ${minha
          ? '<button class="secundario largo" data-acao="cancelar">Cancelar minha presença</button>'
          : `<button class="primario largo" data-acao="confirmar">${meu.tipo === 'diarista' && !meu.goleiro && !a.passouCorte ? 'Entrar na lista de espera' : 'Confirmar presença'}</button>`}
      </section>
      <p class="faixa">${regra}</p>
      ${secaoLista(a.passouCorte ? 'Jogadores' : 'Mensalistas confirmados', `${a.jogadores.length}/${config.vagas}`, a.jogadores, 'Ninguém confirmou ainda.', meu.admin)}
      ${secaoLista('Goleiros', a.goleiros.length, a.goleiros, 'Nenhum goleiro confirmou ainda.', meu.admin)}
      ${secaoLista('Lista de espera', a.espera.length, a.espera, 'Ninguém na espera.', meu.admin)}
      <button class="link" data-acao="atualizar">Atualizar lista</button>`;
  }

  function telaHistorico() {
    const meu = eu();
    const mov = dados.movimentos;
    const porQuem = (h) => (h.por_admin ? ` — por ${esc(h.autor_nome || 'sistema')}` : '');
    const linhaMov = (h) => `<li class="${h.user_id === dados.eu ? 'eu' : ''}">
      <span class="nome">${esc(h.nome)} ${h.tipo === 'entrou' ? 'entrou na lista' : 'saiu da lista'}${porQuem(h)}
        <small class="quando">${esc(fmtQuando(h.criado_em))}${h.tipo === 'saiu' && h.entrada_em ? ` · estava na lista desde ${esc(fmtQuando(h.entrada_em))}` : ''}</small></span>
      <span class="etiqueta ${h.tipo === 'entrou' ? 'ok' : 'pendente'}">${h.tipo === 'entrou' ? 'Entrada' : 'Saída'}</span>
    </li>`;
    const linhaAdm = (h) => {
      const oQue = h.tipo === 'entrou' ? `pôs ${esc(h.nome)} na lista`
        : h.tipo === 'saiu' ? `tirou ${esc(h.nome)} da lista`
        : h.tipo === 'config' ? esc(h.detalhe)
        : `${esc(h.nome)}: ${esc(h.detalhe)}`;
      return `<li><span class="nome">${esc(h.autor_nome || 'Sistema')} — ${oQue}
        <small class="quando">${esc(fmtQuando(h.criado_em))}</small></span></li>`;
    };
    return `
      <section class="cartao"><h2>Movimentações desta partida<span>${mov ? mov.length : 0}</span></h2>
        <p class="nota">Entradas e saídas da lista de ${esc(fmtDiaMes(dados.partida.inicio))}, da mais recente para a mais antiga.</p>
        ${mov === null ? '<p class="vazio">O histórico ainda não foi ativado no banco de dados.</p>'
          : mov.length ? `<ul class="lista sem-numero">${mov.map(linhaMov).join('')}</ul>`
          : '<p class="vazio">Nenhuma movimentação ainda.</p>'}
      </section>
      ${meu.admin ? `<section class="cartao"><h2>Alterações dos administradores<span>${dados.acoesAdmin.length}</span></h2>
        <p class="nota">Últimas ações feitas por administradores: lista, cadastro de jogadores, pagamentos e configurações.</p>
        ${dados.acoesAdmin.length ? `<ul class="lista sem-numero">${dados.acoesAdmin.map(linhaAdm).join('')}</ul>`
          : '<p class="vazio">Nenhuma alteração registrada.</p>'}
      </section>` : ''}`;
  }

  function telaRelatorios() {
    if (!relatorioDados) return '<section class="cartao"><p class="vazio">Carregando relatórios…</p></section>';
    if (!relatorioDados.partidas.length)
      return '<section class="cartao"><h2>Relatórios</h2><p class="vazio">Ainda não há partidas encerradas. Os relatórios aparecem depois do primeiro jogo.</p></section>';
    const r = Logica.relatorio({ ...relatorioDados, perfis: dados.perfis, vagas: dados.config.vagas });
    const n = r.porPartida.length;
    return `
      <section class="cartao"><h2>Frequência por jogador<span>${n === 1 ? 'última partida' : `últimas ${n} partidas`}</span></h2>
        <div class="rolagem"><table>
          <thead><tr><th>Jogador</th><th>Jogou</th><th>Ficou na espera</th><th>Saiu da lista</th><th>Saiu após 17h</th></tr></thead>
          <tbody>${r.jogadores.map((j) => `<tr><td>${esc(j.perfil.nome)}</td><td>${j.jogou}/${n}</td><td>${j.espera}</td><td>${j.saidas}</td><td>${j.saidasTarde}</td></tr>`).join('')}</tbody>
        </table></div>
      </section>
      <section class="cartao"><h2>Resumo por partida</h2>
        <div class="rolagem"><table>
          <thead><tr><th>Data</th><th>Jogadores</th><th>Goleiros</th><th>Espera</th><th>Saídas</th><th>Após 17h</th></tr></thead>
          <tbody>${r.porPartida.map((p) => `<tr><td>${esc(fmtDiaMes(p.partida.inicio))}</td><td>${p.jogadores}/${dados.config.vagas}</td><td>${p.goleiros}</td><td>${p.espera}</td><td>${p.saidas}</td><td>${p.saidasTarde}</td></tr>`).join('')}</tbody>
        </table></div>
        <p class="nota">Os relatórios usam o cadastro atual de cada jogador e contam as saídas registradas desde a ativação do histórico.</p>
      </section>`;
  }

  function telaPagamento() {
    const { config, partida } = dados;
    const meu = eu();
    const a = alocacao();
    let situacao;
    if (meu.tipo === 'mensalista') {
      situacao = `<p>Mensalidade de ${esc(fmtMes(mesDaPartida()))}: <strong>${fmtValor(config.valor_mensal)}</strong></p>
        <p><span class="etiqueta ${pagoMensal(meu.id) ? 'ok' : 'pendente'}">${pagoMensal(meu.id) ? 'Paga' : 'Pendente'}</span></p>`;
    } else {
      const joga = a.passouCorte && [...a.jogadores, ...a.goleiros].some((i) => i.user_id === meu.id);
      situacao = `<p>Diária por partida: <strong>${fmtValor(config.valor_diaria)}</strong></p>
        ${pagoPartida(meu.id) ? `<p><span class="etiqueta ok">Diária de ${fmtDiaMes(partida.inicio)} paga</span></p>`
          : joga ? `<p><span class="etiqueta pendente">Diária de ${fmtDiaMes(partida.inicio)} pendente</span></p>`
          : '<p class="nota">Você só paga quando for convocado para jogar.</p>'}`;
    }
    return `
      <section class="cartao"><h2>Minha situação<span>${meu.tipo === 'mensalista' ? 'Mensalista' : 'Diarista'}</span></h2>${situacao}</section>
      <section class="cartao"><h2>Como pagar</h2>
        ${config.chave_pix
          ? `<p class="nota">Faça um Pix para a chave abaixo. O organizador marca o pagamento aqui depois de conferir.</p>
             <div class="pix"><code>${esc(config.chave_pix)}</code><button class="pequeno" data-acao="copiar-pix">Copiar</button></div>`
          : '<p class="vazio">O organizador ainda não cadastrou a chave Pix.</p>'}
      </section>
      <section class="cartao"><h2>Minha conta</h2>
        <p class="nota">${esc(meu.nome)}</p>
        <button class="link" data-acao="sair">Sair da conta</button>
      </section>`;
  }

  function telaAdmin() {
    const { config, partida, perfis } = dados;
    const a = alocacao();
    const sub = (v, t) => `<button class="${adminAba === v ? 'ativa' : ''}" data-acao="admin-aba" data-v="${v}">${t}</button>`;
    let corpo;

    if (adminAba === 'pagamentos') {
      const linha = (p, pago, acao) => `<li><span class="nome">${esc(p.nome)}</span>
        <span class="etiqueta ${pago ? 'ok' : 'pendente'}">${pago ? 'Pago' : 'Pendente'}</span>
        <button class="pequeno" data-acao="${acao}" data-id="${esc(p.id)}">${pago ? 'Desfazer' : 'Marcar pago'}</button></li>`;
      const mensalistas = perfis.filter((p) => p.tipo === 'mensalista');
      const diaristas = (a.passouCorte ? [...a.jogadores, ...a.goleiros] : []).map((i) => i.perfil).filter((p) => p.tipo === 'diarista');
      const pagos = mensalistas.filter((p) => pagoMensal(p.id)).length;
      corpo = `
        <section class="cartao"><h2>Mensalidades de ${esc(fmtMes(mesDaPartida()))}<span>${pagos}/${mensalistas.length} pagas</span></h2>
          ${mensalistas.length ? `<ol class="lista">${mensalistas.map((p) => linha(p, pagoMensal(p.id), 'pago-mensal')).join('')}</ol>` : '<p class="vazio">Nenhum mensalista cadastrado.</p>'}
        </section>
        <section class="cartao"><h2>Diárias de ${fmtDiaMes(partida.inicio)}<span>${diaristas.length}</span></h2>
          ${diaristas.length ? `<ol class="lista">${diaristas.map((p) => linha(p, pagoPartida(p.id), 'pago-partida')).join('')}</ol>`
            : `<p class="vazio">${a.passouCorte ? 'Nenhum diarista convocado nesta partida.' : `Os diaristas convocados aparecem aqui depois das ${fmtHora(partida.prioridade_ate)} de quarta.`}</p>`}
        </section>`;
    } else if (adminAba === 'jogadores') {
      corpo = `<section class="cartao"><h2>Jogadores<span>${perfis.length}</span></h2>
        <p class="nota">Quem cria conta entra como diarista. Mude aqui para mensalista ou goleiro fixo.</p>
        ${perfis.map((p) => {
          const naLista = dados.presencas.some((x) => x.user_id === p.id);
          return `<div class="linha-admin">
            <strong>${esc(p.nome)}${p.id === dados.eu ? ' (você)' : ''}<small class="quando">${esc(fmtLogin((dados.logins.find((l) => l.id === p.id) || {}).login))}</small></strong>
            <button class="pequeno" data-acao="${naLista ? 'remover' : 'incluir'}" data-id="${esc(p.id)}">${naLista ? 'Tirar da lista' : 'Pôr na lista'}</button>
            <div class="opcoes">
              <select data-perfil="${esc(p.id)}" data-campo="tipo" aria-label="Tipo de ${esc(p.nome)}">
                <option value="mensalista" ${p.tipo === 'mensalista' ? 'selected' : ''}>Mensalista</option>
                <option value="diarista" ${p.tipo === 'diarista' ? 'selected' : ''}>Diarista</option>
              </select>
              <label class="marca"><input type="checkbox" data-perfil="${esc(p.id)}" data-campo="goleiro" ${p.goleiro ? 'checked' : ''}>Goleiro fixo</label>
              <label class="marca"><input type="checkbox" data-perfil="${esc(p.id)}" data-campo="admin" ${p.admin ? 'checked' : ''} ${p.id === dados.eu ? 'disabled' : ''}>Administrador</label>
              ${p.id === dados.eu ? '' : `<button class="pequeno" data-acao="redefinir-senha" data-id="${esc(p.id)}">Redefinir senha</button>`}
            </div>
          </div>`;
        }).join('')}
      </section>`;
    } else if (adminAba === 'relatorios') {
      corpo = telaRelatorios();
    } else {
      corpo = `<form class="cartao" data-form="config"><h2>Configurações</h2>
        <label>Nome do grupo<input name="nome_grupo" required maxlength="40" value="${esc(config.nome_grupo)}"></label>
        <label>Vagas de linha (sem contar goleiros)<input name="vagas" type="number" min="1" max="99" required value="${esc(config.vagas)}"></label>
        <label>Valor da mensalidade (R$)<input name="valor_mensal" type="number" min="0" step="0.01" required value="${esc(config.valor_mensal)}"></label>
        <label>Valor da diária (R$)<input name="valor_diaria" type="number" min="0" step="0.01" required value="${esc(config.valor_diaria)}"></label>
        <label>Chave Pix<input name="chave_pix" maxlength="120" value="${esc(config.chave_pix)}"></label>
        <button class="primario largo">Salvar</button>
      </form>`;
    }
    return `<div class="subabas">${sub('pagamentos', 'Pagamentos')}${sub('jogadores', 'Jogadores')}${sub('relatorios', 'Relatórios')}${sub('config', 'Ajustes')}</div>${corpo}`;
  }

  function render() {
    if (!dados || recuperando) {
      $app.innerHTML = telaAuth();
      return;
    }
    const meu = eu();
    if (aba === 'admin' && !meu.admin) aba = 'jogo';
    document.title = dados.config.nome_grupo;
    const botaoAba = (v, t) => `<button class="${aba === v ? 'ativa' : ''}" data-acao="aba" data-v="${v}">${t}</button>`;
    $app.innerHTML = `
      <header class="topo"><img class="logo" src="logo.webp" alt=""><div><h1>${esc(dados.config.nome_grupo)}</h1><small>Olá, ${esc(meu.nome)}</small></div></header>
      ${DEMO ? '<div class="faixa">Modo demonstração: os dados ficam só neste aparelho. <button class="link" data-acao="reiniciar-demo">Recomeçar do zero</button></div>' : ''}
      ${aba === 'jogo' ? telaJogo() : aba === 'historico' ? telaHistorico() : aba === 'pagamento' ? telaPagamento() : telaAdmin()}
      <nav class="abas">${botaoAba('jogo', 'Jogo')}${botaoAba('historico', 'Histórico')}${botaoAba('pagamento', 'Pagamento')}${meu.admin ? botaoAba('admin', 'Organizar') : ''}</nav>`;
  }

  // ---------- Ações ----------

  const acoes = {
    'aba': (b) => { aba = b.dataset.v; render(); window.scrollTo(0, 0); },
    'admin-aba': async (b) => {
      adminAba = b.dataset.v;
      render();
      if (adminAba !== 'relatorios') return;
      try { relatorioDados = await api.relatorio(); } catch (e) { aviso(e.message, true); }
      render();
    },
    'auth-modo': (b) => { authModo = b.dataset.v; render(); },
    'atualizar': () => executar(async () => {}, 'Lista atualizada.'),
    'confirmar': () => executar(() => api.confirmar(dados.partida.id, dados.eu)),
    'cancelar': () => {
      if (confirm('Cancelar sua presença? Se confirmar de novo depois, você volta para o fim da fila.'))
        executar(() => api.cancelar(dados.partida.id, dados.eu));
    },
    'remover': (b) => {
      const p = perfilDe(b.dataset.id);
      if (confirm(`Tirar ${p.nome} da lista desta partida?`)) executar(() => api.cancelar(dados.partida.id, p.id));
    },
    'incluir': (b) => executar(() => api.confirmar(dados.partida.id, b.dataset.id)),
    'redefinir-senha': (b) => {
      const p = perfilDe(b.dataset.id);
      const senha = prompt(`Nova senha para ${p.nome} (mínimo de 6 caracteres). Depois, avise a pessoa.`);
      if (senha === null) return;
      if (senha.length < 6) return aviso('A senha precisa ter pelo menos 6 caracteres.', true);
      executar(() => api.redefinirSenha(p.id, senha), `Senha de ${p.nome} redefinida.`);
    },
    'pago-mensal': (b) => {
      const id = b.dataset.id, pg = pagoMensal(id);
      executar(() => pg ? api.desmarcarPago(pg.id)
        : api.marcarPago({ user_id: id, tipo: 'mensal', mes: mesDaPartida(), valor: dados.config.valor_mensal }));
    },
    'pago-partida': (b) => {
      const id = b.dataset.id, pg = pagoPartida(id);
      executar(() => pg ? api.desmarcarPago(pg.id)
        : api.marcarPago({ user_id: id, tipo: 'partida', partida_id: dados.partida.id, valor: dados.config.valor_diaria }));
    },
    'copiar-pix': async () => {
      try { await navigator.clipboard.writeText(dados.config.chave_pix); aviso('Chave Pix copiada.'); }
      catch (e) { aviso('Não foi possível copiar. Selecione a chave e copie manualmente.', true); }
    },
    'sair': () => { authModo = 'entrar'; executar(() => api.sair()); },
    'reiniciar-demo': () => {
      if (!confirm('Apagar as contas e os dados da demonstração neste aparelho?')) return;
      try { localStorage.removeItem('pelada-demo-v1'); } catch (e) { /* nada a apagar */ }
      location.reload();
    },
  };

  $app.addEventListener('click', (e) => {
    const b = e.target.closest('[data-acao]');
    if (b && acoes[b.dataset.acao]) acoes[b.dataset.acao](b);
  });

  $app.addEventListener('change', (e) => {
    const el = e.target;
    if (!el.dataset.perfil) return;
    const valor = el.type === 'checkbox' ? el.checked : el.value;
    executar(() => api.atualizarPerfil(el.dataset.perfil, { [el.dataset.campo]: valor }), 'Jogador atualizado.');
  });

  $app.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    const f = Object.fromEntries(new FormData(form));
    if (form.dataset.form === 'config') {
      executar(() => api.salvarConfig({
        nome_grupo: f.nome_grupo.trim(), vagas: Number(f.vagas), valor_mensal: Number(f.valor_mensal),
        valor_diaria: Number(f.valor_diaria), chave_pix: f.chave_pix.trim(),
      }), 'Configurações salvas.');
      return;
    }
    executar(async () => {
      if (recuperando) {
        await api.novaSenha(f.senha);
        recuperando = false;
        aviso('Senha alterada.');
      } else if (authModo === 'entrar') {
        await api.entrar(loginParaEmail(f.email), f.senha);
      } else if (authModo === 'cadastrar') {
        if (f.email.includes('@')) throw new Error('Informe o número do WhatsApp com DDD, por exemplo (21) 99999-8888.');
        const r = await api.cadastrar(f.nome.trim(), loginParaEmail(f.email), f.senha);
        if (r === 'confirmar') {
          authModo = 'entrar';
          aviso('Conta criada. Confirme pelo link que enviamos ao seu e-mail e depois entre.');
        }
      } else {
        await api.recuperar(f.email.trim());
        authModo = 'entrar';
        aviso('Se esse e-mail tiver conta, enviamos um link para criar uma nova senha.');
      }
    });
  });

  // ---------- Início ----------

  (async function iniciar() {
    try {
      api = DEMO ? apiDemo() : await apiSupabase();
    } catch (e) {
      $app.innerHTML = `<p class="carregando">${esc(e.message)}</p>`;
      return;
    }
    api.aoRecuperarSenha(() => { recuperando = true; render(); });
    await recarregar();
    // Mantém a lista em dia (e vira a regra das 17h) sem atrapalhar quem está digitando.
    const emDia = () => { if (!document.hidden && dados && !ocupado && aba !== 'admin') recarregar(true); };
    setInterval(emDia, 30000);
    document.addEventListener('visibilitychange', emDia);
  })();
})();
