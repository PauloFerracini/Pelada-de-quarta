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
  function alocar({ presencas, perfis, partida, vagas, agora }) {
    const corte = new Date(partida.prioridade_ate).getTime();
    const passouCorte = agora.getTime() >= corte;
    const porId = new Map(perfis.map((p) => [p.id, p]));

    const itens = presencas
      .map((pr) => ({ ...pr, perfil: porId.get(pr.user_id), t: new Date(pr.criado_em).getTime() }))
      .filter((i) => i.perfil)
      .sort((a, b) => a.t - b.t || String(a.user_id).localeCompare(String(b.user_id)));

    const goleiros = itens.filter((i) => i.perfil.goleiro);
    const linha = itens.filter((i) => !i.perfil.goleiro);
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
    return { passouCorte, jogadores, goleiros, espera };
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

  const api = { alocar, proximaQuarta, relatorio };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Logica = api;
})(typeof window !== 'undefined' ? window : globalThis);
