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
