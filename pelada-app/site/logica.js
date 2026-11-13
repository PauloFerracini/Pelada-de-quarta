// Regras da lista da pelada. Sem dependências: roda no navegador e no Node (testes).
(function (root) {
  'use strict';

  /**
   * Distribui as presenças em jogadores, goleiros e lista de espera.
   *
   * Antes do horário de corte (17h): só mensalistas ocupam vaga; diaristas aguardam na fila.
   * Depois do corte: mensalistas que confirmaram antes do corte vêm primeiro; em seguida
   * todos os demais (diaristas e mensalistas atrasados) por ordem de confirmação.
   * Goleiros ficam em lista própria e não contam para as vagas.
   */
  function alocar({ presencas, perfis, partida, vagas, agora, bloqueados = [] }) {
    const corte = new Date(partida.prioridade_ate).getTime();
    const passouCorte = agora.getTime() >= corte;
    const porId = new Map(perfis.map((p) => [p.id, p]));

    const itens = presencas
      .map((pr) => ({ ...pr, perfil: porId.get(pr.user_id), t: new Date(pr.criado_em).getTime() }))
      .filter((i) => i.perfil)
      .sort((a, b) => a.t - b.t || String(a.user_id).localeCompare(String(b.user_id)));

    // Depois do corte, quem está na lista de bloqueados (mensalidade em aberto na última pelada
    // do mês) sai da disputa por vaga. Goleiros fixos nunca são bloqueados.
    const fora = new Set(passouCorte ? bloqueados : []);
    const barrados = itens.filter((i) => !i.perfil.goleiro && fora.has(i.user_id));
    const goleiros = itens.filter((i) => i.perfil.goleiro);
    const linha = itens.filter((i) => !i.perfil.goleiro && !fora.has(i.user_id));
    const prioridade = linha.filter(
      (i) => i.perfil.tipo === 'mensalista' && (!passouCorte || i.t < corte)
    );
    const demais = linha.filter((i) => !prioridade.includes(i));

    let jogadores, espera;
    if (!passouCorte) {
      jogadores = prioridade.slice(0, vagas);
      espera = [...prioridade.slice(vagas), ...demais];
    } else {
      const fila = [...prioridade, ...demais];
      jogadores = fila.slice(0, vagas);
      espera = fila.slice(vagas);
    }
    return { passouCorte, jogadores, goleiros, espera, bloqueados: barrados };
  }

  /** A partida ('AAAA-MM-DD') é a última quarta do mês? */
  function ultimaPeladaDoMes(data) {
    const d = new Date(data + 'T12:00:00Z');
    const seguinte = new Date(d.getTime() + 7 * 24 * 3600 * 1000);
    return seguinte.getUTCMonth() !== d.getUTCMonth();
  }

  /**
   * Acréscimo da mensalidade do mês `mes` ('AAAA-MM') se fosse paga em `hoje` ('AAAA-MM-DD'):
   * até o dia 10, nada; do dia 11 ao 20, o primeiro acréscimo; depois do dia 20 (ou em mês
   * já encerrado), o segundo.
   */
  function multaMensalidade({ mes, hoje, config }) {
    const mesHoje = hoje.slice(0, 7), dia = Number(hoje.slice(8, 10));
    if (mes > mesHoje) return 0;
    if (mes < mesHoje || dia > 20) return Number(config.multa_mensal_apos_20 || 0);
    if (dia > 10) return Number(config.multa_mensal_apos_10 || 0);
    return 0;
  }

  /**
   * Assiduidade de um jogador num ano. `partidas`: as que têm súmula ({ partida_id, data }).
   * `linhas`: as partidas em que o jogador entrou na súmula ({ partida_id }).
   */
  function assiduidade({ linhas, partidas, ano }) {
    const doAno = partidas.filter((p) => p.data.startsWith(String(ano))).sort((a, b) => a.data.localeCompare(b.data));
    const jogou = new Set(linhas.map((l) => String(l.partida_id)));
    let atual = 0, maior = 0, jogos = 0;
    doAno.forEach((p) => {
      if (jogou.has(String(p.partida_id))) { jogos++; atual++; maior = Math.max(maior, atual); } else atual = 0;
    });
    return {
      partidas: doAno.length, jogos,
      percentual: doAno.length ? Math.round((jogos / doAno.length) * 100) : 0,
      sequenciaAtual: atual, maiorSequencia: maior,
    };
  }

  /** Texto da prestação de contas do mês, pronto para o WhatsApp. `c` é o resultado de caixa(). */
  function textoPrestacao({ c, titulo, fmt }) {
    const linhas = (itens) => itens.map((i) => `• ${i.descricao}: ${fmt(i.valor)}`).join('\n') || '• —';
    return [
      `*${titulo}*`, '',
      '*Créditos*', linhas(c.creditos), `Total: ${fmt(c.totalCreditos)}`, '',
      '*Despesas*', linhas(c.despesas), `Total: ${fmt(c.totalDespesas)}`, '',
      `Saldo do mês: ${fmt(c.saldoMes)}`,
      `Saldo anterior: ${fmt(c.saldoAnterior)}`,
      `*CAIXA DA PELADA: ${fmt(c.caixa)}*`,
    ].join('\n');
  }

  /** Próxima quarta-feira cujo jogo (20h–22h, horário de Brasília) ainda não terminou. */
  function proximaQuarta(agora) {
    const sp = new Date(agora.getTime() - 3 * 3600 * 1000); // Brasília = UTC-3, sem horário de verão
    let somar = (3 - sp.getUTCDay() + 7) % 7;
    if (somar === 0 && sp.getUTCHours() >= 22) somar = 7;
    const dia = new Date(Date.UTC(sp.getUTCFullYear(), sp.getUTCMonth(), sp.getUTCDate() + somar));
    const data = dia.toISOString().slice(0, 10);
    return {
      data,
      inicio: data + 'T20:00:00-03:00',
      fim: data + 'T22:00:00-03:00',
      prioridade_ate: data + 'T17:00:00-03:00',
    };
  }

  /**
   * Relatório das partidas encerradas: resumo por partida e frequência por jogador.
   * `saidas` são os registros de quem saiu da lista (partida_id, user_id, criado_em).
   * Usa o cadastro atual de cada jogador (mensalista/diarista/goleiro).
   */
  function relatorio({ partidas, presencas, saidas, perfis, vagas }) {
    const porJogador = new Map(
      perfis.map((p) => [p.id, { perfil: p, jogou: 0, espera: 0, saidas: 0, saidasTarde: 0 }])
    );
    const porPartida = partidas.map((pt) => {
      const a = alocar({
        presencas: presencas.filter((x) => x.partida_id === pt.id),
        perfis, partida: pt, vagas, agora: new Date(pt.fim),
      });
      [...a.jogadores, ...a.goleiros].forEach((i) => porJogador.get(i.user_id).jogou++);
      a.espera.forEach((i) => porJogador.get(i.user_id).espera++);

      const corte = new Date(pt.prioridade_ate).getTime();
      const daPartida = saidas.filter((x) => x.partida_id === pt.id);
      let tarde = 0;
      daPartida.forEach((x) => {
        const foiTarde = new Date(x.criado_em).getTime() >= corte;
        if (foiTarde) tarde++;
        const j = porJogador.get(x.user_id);
        if (j) { j.saidas++; if (foiTarde) j.saidasTarde++; }
      });
      return {
        partida: pt, jogadores: a.jogadores.length, goleiros: a.goleiros.length,
        espera: a.espera.length, saidas: daPartida.length, saidasTarde: tarde,
      };
    });
    const jogadores = [...porJogador.values()]
      .filter((j) => j.jogou || j.espera || j.saidas)
      .sort((a, b) => b.jogou - a.jogou || a.perfil.nome.localeCompare(b.perfil.nome, 'pt-BR'));
    return { porPartida, jogadores };
  }

  const centavos = (v) => Math.round(Number(v || 0) * 100);

  /**
   * Prestação de contas de um mês ('AAAA-MM').
   * `lancamentos`: lançamentos manuais ({ id, mes, tipo: 'credito'|'despesa', descricao, valor }).
   * `pagamentos`: somas dos pagamentos marcados no app ({ mes, tipo: 'mensal'|'partida', quantidade, total }).
   * O saldo anterior é tudo o que entrou menos tudo o que saiu nos meses anteriores.
   */
  function caixa({ lancamentos, pagamentos, mes }) {
    const creditos = [], despesas = [];
    pagamentos.filter((p) => p.mes === mes && centavos(p.total) > 0).forEach((p) => {
      const n = p.quantidade;
      creditos.push({
        auto: true, valor: centavos(p.total) / 100,
        descricao: p.tipo === 'mensal'
          ? `Mensalidades — ${n} ${n === 1 ? 'jogador' : 'jogadores'}`
          : p.tipo === 'multa'
          ? `Multas — ${n} ${n === 1 ? 'paga' : 'pagas'}`
          : `Diárias — ${n} ${n === 1 ? 'pagamento' : 'pagamentos'}`,
      });
    });
    lancamentos.filter((l) => l.mes === mes).forEach((l) =>
      (l.tipo === 'credito' ? creditos : despesas).push({ id: l.id, descricao: l.descricao, valor: centavos(l.valor) / 100 }));

    const soma = (lista) => lista.reduce((t, x) => t + centavos(x.valor), 0);
    const totalCreditos = soma(creditos), totalDespesas = soma(despesas);
    const anterior =
      pagamentos.filter((p) => p.mes < mes).reduce((t, p) => t + centavos(p.total), 0) +
      lancamentos.filter((l) => l.mes < mes).reduce((t, l) => t + (l.tipo === 'credito' ? 1 : -1) * centavos(l.valor), 0);
    return {
      creditos, despesas,
      totalCreditos: totalCreditos / 100, totalDespesas: totalDespesas / 100,
      saldoMes: (totalCreditos - totalDespesas) / 100,
      saldoAnterior: anterior / 100,
      caixa: (anterior + totalCreditos - totalDespesas) / 100,
    };
  }

  /** Ordena o ranking por gols ou assistências e numera as posições (empates dividem a posição). */
  function ordenarRanking(linhas, criterio) {
    const outro = criterio === 'gols' ? 'assistencias' : 'gols';
    const ordenado = [...linhas].sort((a, b) =>
      b[criterio] - a[criterio] || b[outro] - a[outro] || a.jogos - b.jogos ||
      String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
    let posicao = 0;
    return ordenado.map((l, i) => {
      if (i === 0 || l[criterio] !== ordenado[i - 1][criterio]) posicao = i + 1;
      return { ...l, posicao };
    });
  }

  const api = {
    alocar, proximaQuarta, relatorio, caixa, ordenarRanking,
    ultimaPeladaDoMes, multaMensalidade, assiduidade, textoPrestacao,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Logica = api;
})(typeof window !== 'undefined' ? window : globalThis);
