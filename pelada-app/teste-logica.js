// Testes das regras da lista. Rodar com: node teste-logica.js
const assert = require('assert');
const { alocar, proximaQuarta } = require('./site/logica.js');

const partida = { prioridade_ate: '2026-11-11T17:00:00-03:00' };
const antes = new Date('2026-11-11T12:00:00-03:00');
const depois = new Date('2026-11-11T17:00:01-03:00');
const hora = (h, m = 0) =>
  `2026-11-11T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-03:00`;

function cenario({ mensalistas = 0, diaristas = 0, goleiros = 0, extras = [] }) {
  const perfis = [], presencas = [];
  let minuto = 0;
  const add = (id, tipo, goleiro, quando) => {
    perfis.push({ id, nome: id, tipo, goleiro });
    presencas.push({ user_id: id, criado_em: quando || hora(8, minuto++) });
  };
  for (let i = 1; i <= mensalistas; i++) add('m' + i, 'mensalista', false);
  for (let i = 1; i <= diaristas; i++) add('d' + i, 'diarista', false);
  for (let i = 1; i <= goleiros; i++) add('g' + i, 'mensalista', true);
  extras.forEach((e) => add(e.id, e.tipo, false, e.quando));
  return { perfis, presencas, partida, vagas: 24 };
}
const ids = (l) => l.map((i) => i.user_id);

// 1. Antes das 17h: diaristas ficam na espera mesmo com vaga sobrando; goleiros não contam.
let r = alocar({ ...cenario({ mensalistas: 20, diaristas: 5, goleiros: 2 }), agora: antes });
assert.equal(r.jogadores.length, 20);
assert.deepEqual(ids(r.espera), ['d1', 'd2', 'd3', 'd4', 'd5']);
assert.equal(r.goleiros.length, 2);

// 2. Depois das 17h: diaristas completam até 24, pela ordem da fila.
r = alocar({ ...cenario({ mensalistas: 20, diaristas: 5, goleiros: 2 }), agora: depois });
assert.equal(r.jogadores.length, 24);
assert.deepEqual(ids(r.jogadores).slice(20), ['d1', 'd2', 'd3', 'd4']);
assert.deepEqual(ids(r.espera), ['d5']);
assert.equal(r.goleiros.length, 2);

// 3. 24 ou mais mensalistas: nenhum diarista é convocado.
r = alocar({ ...cenario({ mensalistas: 25, diaristas: 3 }), agora: depois });
assert.ok(ids(r.jogadores).every((id) => id.startsWith('m')));
assert.deepEqual(ids(r.espera), ['m25', 'd1', 'd2', 'd3']);

// 4. Diarista que entrou na fila cedo passa na frente de mensalista que confirmou depois das 17h.
r = alocar({
  ...cenario({
    mensalistas: 23,
    diaristas: 2,
    extras: [{ id: 'atrasado', tipo: 'mensalista', quando: hora(17, 30) }],
  }),
  agora: new Date(hora(18)),
});
assert.deepEqual(ids(r.jogadores).slice(23), ['d1']);
assert.deepEqual(ids(r.espera), ['d2', 'atrasado']);

// 5. Desistência depois das 17h: o primeiro da espera sobe.
const c = cenario({ mensalistas: 24, diaristas: 2 });
c.presencas = c.presencas.filter((p) => p.user_id !== 'm3');
r = alocar({ ...c, agora: depois });
assert.equal(r.jogadores.length, 24);
assert.equal(ids(r.jogadores)[23], 'd1');
assert.deepEqual(ids(r.espera), ['d2']);

// 6. Data da próxima partida.
assert.equal(proximaQuarta(new Date('2026-11-09T10:00:00-03:00')).data, '2026-11-11'); // segunda
assert.equal(proximaQuarta(new Date('2026-11-11T21:00:00-03:00')).data, '2026-11-11'); // quarta, durante o jogo
assert.equal(proximaQuarta(new Date('2026-11-11T22:30:00-03:00')).data, '2026-11-18'); // quarta, depois do jogo
assert.equal(proximaQuarta(new Date('2026-11-12T00:30:00-03:00')).data, '2026-11-18'); // quinta de madrugada

console.log('Todos os testes passaram.');

// 7. Relatório: frequência por jogador e resumo por partida.
{
  const { relatorio } = require('./site/logica.js');
  const perfis = [
    { id: 'a', nome: 'Ana', tipo: 'mensalista', goleiro: false },
    { id: 'b', nome: 'Bia', tipo: 'diarista', goleiro: false },
    { id: 'c', nome: 'Caio', tipo: 'mensalista', goleiro: true },
    { id: 'd', nome: 'Davi', tipo: 'diarista', goleiro: false },
  ];
  const p1 = { id: 1, data: '2026-11-04', prioridade_ate: '2026-11-04T17:00:00-03:00', fim: '2026-11-04T22:00:00-03:00' };
  const p2 = { id: 2, data: '2026-11-11', prioridade_ate: '2026-11-11T17:00:00-03:00', fim: '2026-11-11T22:00:00-03:00' };
  const rel = relatorio({
    partidas: [p2, p1], perfis, vagas: 1,
    presencas: [
      { partida_id: 1, user_id: 'a', criado_em: '2026-11-03T10:00:00-03:00' },
      { partida_id: 1, user_id: 'b', criado_em: '2026-11-03T11:00:00-03:00' },
      { partida_id: 1, user_id: 'c', criado_em: '2026-11-03T12:00:00-03:00' },
      { partida_id: 2, user_id: 'b', criado_em: '2026-11-10T09:00:00-03:00' },
    ],
    saidas: [
      { partida_id: 2, user_id: 'a', criado_em: '2026-11-11T18:00:00-03:00' }, // depois das 17h
      { partida_id: 2, user_id: 'd', criado_em: '2026-11-10T08:00:00-03:00' }, // antes das 17h
    ],
  });
  assert.deepEqual(rel.porPartida.map((r) => [r.partida.id, r.jogadores, r.goleiros, r.espera, r.saidas, r.saidasTarde]),
    [[2, 1, 0, 0, 2, 1], [1, 1, 1, 1, 0, 0]]);
  const j = Object.fromEntries(rel.jogadores.map((x) => [x.perfil.id, [x.jogou, x.espera, x.saidas, x.saidasTarde]]));
  assert.deepEqual(j, { a: [1, 0, 1, 1], b: [1, 1, 0, 0], c: [1, 0, 0, 0], d: [0, 0, 1, 0] });
  console.log('Relatório: ok.');
}

// 8. Caixa: reproduz a prestação de contas de outubro de 2026 da pelada.
{
  const { caixa } = require('./site/logica.js');
  const lancamentos = [
    { id: 1, mes: '2026-09', tipo: 'credito', descricao: 'saldo inicial', valor: 832.83 },
    { id: 2, mes: '2026-10', tipo: 'credito', descricao: 'multas de mensalidade', valor: 60 },
    { id: 3, mes: '2026-10', tipo: 'credito', descricao: 'juros do saldo anterior', valor: 4.16 },
    { id: 4, mes: '2026-10', tipo: 'despesa', descricao: 'Arena Physical - campo', valor: 1900 },
    { id: 5, mes: '2026-10', tipo: 'despesa', descricao: 'auxílio transporte - goleiros', valor: 45 },
    { id: 6, mes: '2026-11', tipo: 'despesa', descricao: 'campo', valor: 1900 },
  ];
  const pagamentos = [
    { mes: '2026-10', tipo: 'mensal', quantidade: 30, total: 2100 },
    { mes: '2026-11', tipo: 'mensal', quantidade: 1, total: 70 },
  ];
  const out = caixa({ lancamentos, pagamentos, mes: '2026-10' });
  assert.equal(out.creditos[0].descricao, 'Mensalidades — 30 jogadores');
  assert.equal(out.totalCreditos, 2164.16);
  assert.equal(out.totalDespesas, 1945);
  assert.equal(out.saldoMes, 219.16);
  assert.equal(out.saldoAnterior, 832.83);
  assert.equal(out.caixa, 1051.99);
  const nov = caixa({ lancamentos, pagamentos, mes: '2026-11' });
  assert.equal(nov.saldoAnterior, 1051.99);
  assert.equal(nov.caixa, -778.01);
  console.log('Caixa: ok.');
}

// 9. Ranking: ordenação e posições com empate.
{
  const { ordenarRanking } = require('./site/logica.js');
  const linhas = [
    { nome: 'Ana', jogos: 3, gols: 5, assistencias: 1 },
    { nome: 'Bia', jogos: 2, gols: 5, assistencias: 4 },
    { nome: 'Caio', jogos: 3, gols: 7, assistencias: 0 },
    { nome: 'Davi', jogos: 1, gols: 0, assistencias: 4 },
  ];
  assert.deepEqual(ordenarRanking(linhas, 'gols').map((l) => [l.nome, l.posicao]),
    [['Caio', 1], ['Bia', 2], ['Ana', 2], ['Davi', 4]]);
  assert.deepEqual(ordenarRanking(linhas, 'assistencias').map((l) => [l.nome, l.posicao]),
    [['Bia', 1], ['Davi', 1], ['Ana', 3], ['Caio', 4]]);
  console.log('Ranking: ok.');
}

// 10. Bloqueio por mensalidade em aberto: só vale depois das 17h e não atinge goleiro.
{
  const c = cenario({ mensalistas: 24, diaristas: 2, goleiros: 1 });
  let r2 = alocar({ ...c, agora: antes, bloqueados: ['m2', 'g1'] });
  assert.equal(r2.bloqueados.length, 0);
  assert.equal(r2.jogadores.length, 24);
  r2 = alocar({ ...c, agora: depois, bloqueados: ['m2', 'g1'] });
  assert.deepEqual(ids(r2.bloqueados), ['m2']);
  assert.equal(r2.jogadores.length, 24);
  assert.ok(!ids(r2.jogadores).includes('m2'));
  assert.equal(ids(r2.jogadores)[23], 'd1'); // a vaga do bloqueado vai para o primeiro da espera
  assert.deepEqual(ids(r2.espera), ['d2']);
  assert.equal(r2.goleiros.length, 1);
  console.log('Bloqueio: ok.');
}

// 11. Última pelada do mês, acréscimo da mensalidade e assiduidade.
{
  const { ultimaPeladaDoMes, multaMensalidade, assiduidade, caixa, textoPrestacao } = require('./site/logica.js');
  assert.equal(ultimaPeladaDoMes('2026-11-18'), false);
  assert.equal(ultimaPeladaDoMes('2026-11-25'), true);
  assert.equal(ultimaPeladaDoMes('2026-12-30'), true);

  const config = { multa_mensal_apos_10: 5, multa_mensal_apos_20: 10 };
  assert.equal(multaMensalidade({ mes: '2026-11', hoje: '2026-11-10', config }), 0);
  assert.equal(multaMensalidade({ mes: '2026-11', hoje: '2026-11-11', config }), 5);
  assert.equal(multaMensalidade({ mes: '2026-11', hoje: '2026-11-20', config }), 5);
  assert.equal(multaMensalidade({ mes: '2026-11', hoje: '2026-11-21', config }), 10);
  assert.equal(multaMensalidade({ mes: '2026-11', hoje: '2026-12-02', config }), 10);
  assert.equal(multaMensalidade({ mes: '2026-12', hoje: '2026-11-25', config }), 0);

  const partidas = ['2026-10-07', '2026-10-14', '2026-10-21', '2026-10-28', '2026-11-04']
    .map((data, i) => ({ partida_id: i + 1, data }));
  const a = assiduidade({ linhas: [{ partida_id: 1 }, { partida_id: 2 }, { partida_id: 4 }, { partida_id: 5 }], partidas, ano: 2026 });
  assert.deepEqual(a, { partidas: 5, jogos: 4, percentual: 80, sequenciaAtual: 2, maiorSequencia: 2 });
  assert.equal(assiduidade({ linhas: [], partidas: [], ano: 2026 }).percentual, 0);

  const c = caixa({
    lancamentos: [{ id: 1, mes: '2026-11', tipo: 'despesa', descricao: 'campo', valor: 1900 }],
    pagamentos: [{ mes: '2026-11', tipo: 'mensal', quantidade: 30, total: 2100 }, { mes: '2026-11', tipo: 'multa', quantidade: 2, total: 20 }],
    mes: '2026-11',
  });
  assert.equal(c.creditos[1].descricao, 'Multas — 2 pagas');
  assert.equal(c.caixa, 220);
  const texto = textoPrestacao({ c, titulo: 'Contas de novembro', fmt: (v) => 'R$' + v });
  assert.ok(texto.includes('*CAIXA DA PELADA: R$220*') && texto.includes('• campo: R$1900'));
  console.log('Mensalidade, assiduidade e prestação: ok.');
}
