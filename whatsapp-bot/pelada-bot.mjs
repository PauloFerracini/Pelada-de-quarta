// Envia os avisos da pelada no grupo de WhatsApp, usando o seu próprio WhatsApp
// (conectado como "aparelho conectado", igual ao WhatsApp Web).
//
// Comandos:
//   node pelada-bot.mjs conectar            mostra o QR code para ligar o WhatsApp (uma vez)
//   node pelada-bot.mjs grupos              lista os grupos do WhatsApp
//   node pelada-bot.mjs grupo "nome"        escolhe o grupo que recebe os avisos
//   node pelada-bot.mjs previa <tipo>       mostra a mensagem sem enviar
//   node pelada-bot.mjs teste               envia uma mensagem de teste no grupo
//   node pelada-bot.mjs enviar <tipo>       envia o aviso; <tipo> = lembrete | convocacao | cobranca
//                                           (só envia na quarta, no horário certo; --forcar ignora isso)

import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } from 'baileys';
import QRCode from 'qrcode';
import pino from 'pino';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ARQ_CONFIG = path.join(DIR, 'config.json');
const DIR_SESSAO = path.join(DIR, 'sessao');
const ARQ_LOG = path.join(DIR, 'envios.log');
const pausa = (ms) => new Promise((ok) => setTimeout(ok, ms));

function log(msg) {
  const linha = `[${new Date().toLocaleString('pt-BR')}] ${msg}`;
  console.log(linha);
  try { fs.appendFileSync(ARQ_LOG, linha + '\n'); } catch { /* sem log em arquivo */ }
}

function lerConfig() {
  return JSON.parse(fs.readFileSync(ARQ_CONFIG, 'utf8'));
}
function salvarConfig(cfg) {
  fs.writeFileSync(ARQ_CONFIG, JSON.stringify(cfg, null, 2) + '\n');
}

// Dia da semana e hora em Brasília, independentemente do fuso do computador.
export function agoraEmBrasilia(data = new Date()) {
  const sp = new Date(data.getTime() - 3 * 3600 * 1000);
  return { diaSemana: sp.getUTCDay(), hora: sp.getUTCHours() };
}

// Regra de horário: lembrete só na quarta antes das 17h; convocação só na quarta a partir das 17h.
export function podeEnviar(tipo, data = new Date()) {
  const { diaSemana, hora } = agoraEmBrasilia(data);
  // A cobrança da mensalidade roda todo dia: é o banco que decide se hoje há aviso (dias 9, 10, 20 e último do mês).
  if (tipo === 'cobranca') return null;
  if (diaSemana !== 3) return 'hoje não é quarta-feira';
  if (tipo === 'lembrete' && hora >= 17) return 'já passou das 17h (o lembrete perdeu o sentido)';
  if (tipo === 'convocacao' && hora < 17) return 'ainda não são 17h';
  if (tipo === 'convocacao' && hora >= 22) return 'o jogo já acabou';
  return null;
}

async function buscarMensagem(cfg, tipo) {
  if (!cfg.segredo) throw new Error('Falta preencher "segredo" no config.json (veja o LEIA-ME).');
  const r = await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/mensagem_whatsapp`, {
    method: 'POST',
    headers: { apikey: cfg.chavePublica, Authorization: `Bearer ${cfg.chavePublica}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_tipo: tipo, p_segredo: cfg.segredo }),
  });
  const corpo = await r.text();
  if (!r.ok) throw new Error(`O banco recusou o pedido (${r.status}): ${corpo}`);
  let texto = JSON.parse(corpo);
  if (texto && cfg.linkApp) texto += '\n' + cfg.linkApp;
  return texto;
}

// Abre a conexão com o WhatsApp. Com permitirQr = false, falha se a sessão não estiver ligada.
function conectar({ permitirQr }) {
  return new Promise((resolver, rejeitar) => {
    let pronto = false;
    let tentativas = 0;
    const limite = setTimeout(
      () => falhar(new Error(permitirQr ? 'O QR code não foi lido a tempo. Rode o comando de novo.' : 'Não consegui conectar ao WhatsApp (sem internet?).')),
      permitirQr ? 180000 : 90000
    );
    let sockAtual = null;
    function falhar(erro) {
      if (pronto) return;
      pronto = true;
      clearTimeout(limite);
      try { sockAtual?.end(undefined); } catch { /* já fechado */ }
      rejeitar(erro);
    }

    async function abrir() {
      const { state, saveCreds } = await useMultiFileAuthState(DIR_SESSAO);
      const opcoes = {
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: Browsers.windows('Desktop'),
        markOnlineOnConnect: false,
        syncFullHistory: false,
      };
      try { opcoes.version = (await fetchLatestBaileysVersion()).version; } catch { /* usa a versão padrão */ }

      const sock = makeWASocket(opcoes);
      sockAtual = sock;
      sock.ev.on('creds.update', saveCreds);
      sock.ev.on('connection.update', async (u) => {
        if (pronto) return;
        if (u.qr) {
          if (!permitirQr) return falhar(new Error('O WhatsApp está desconectado. Rode: node pelada-bot.mjs conectar'));
          console.log(await QRCode.toString(u.qr, { type: 'terminal', small: true }));
          console.log('No celular: WhatsApp > Aparelhos conectados > Conectar um aparelho, e aponte para o QR code acima.\n');
        }
        if (u.connection === 'open') {
          pronto = true;
          clearTimeout(limite);
          resolver(sock);
        }
        if (u.connection === 'close') {
          const codigo = u.lastDisconnect?.error?.output?.statusCode;
          if (codigo === DisconnectReason.loggedOut) {
            fs.rmSync(DIR_SESSAO, { recursive: true, force: true });
            if (!permitirQr) return falhar(new Error('O WhatsApp foi desconectado pelo celular. Rode: node pelada-bot.mjs conectar'));
          }
          // Logo depois de ler o QR code o WhatsApp pede para reconectar (código 515): é normal.
          if (++tentativas > 6) return falhar(new Error(`A conexão caiu repetidas vezes (código ${codigo}).`));
          setTimeout(() => abrir().catch(falhar), 2000);
        }
      });
    }
    abrir().catch(falhar);
  });
}

async function fechar(sock) {
  await pausa(4000); // dá tempo de a mensagem sair antes de desligar
  try { sock.end(undefined); } catch { /* já fechado */ }
}

async function listarGrupos(sock) {
  const grupos = Object.values(await sock.groupFetchAllParticipating());
  return grupos.map((g) => ({ id: g.id, nome: g.subject })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

async function enviarTexto(cfg, texto) {
  if (!cfg.grupoId) throw new Error('Nenhum grupo escolhido. Rode: node pelada-bot.mjs grupo "nome do grupo"');
  const sock = await conectar({ permitirQr: false });
  try {
    await sock.sendMessage(cfg.grupoId, { text: texto });
  } finally {
    await fechar(sock);
  }
}

async function principal() {
  const [comando, ...resto] = process.argv.slice(2);
  const forcar = resto.includes('--forcar');
  const arg = resto.find((a) => !a.startsWith('--'));
  const cfg = lerConfig();

  if (comando === 'conectar') {
    const sock = await conectar({ permitirQr: true });
    log(`WhatsApp conectado (${sock.user?.name || sock.user?.id || 'conta'}).`);
    await fechar(sock);
  } else if (comando === 'grupos' || comando === 'grupo') {
    const sock = await conectar({ permitirQr: false });
    let grupos;
    try { grupos = await listarGrupos(sock); } finally { await fechar(sock); }
    if (comando === 'grupos') {
      grupos.forEach((g) => console.log(`${g.nome}${g.id === cfg.grupoId ? '   <-- grupo dos avisos' : ''}`));
      console.log(`\n${grupos.length} grupos. Para escolher: node pelada-bot.mjs grupo "parte do nome"`);
    } else {
      if (!arg) throw new Error('Informe parte do nome do grupo, entre aspas.');
      const exatos = grupos.filter((g) => g.nome.toLowerCase() === arg.toLowerCase());
      const achados = exatos.length ? exatos : grupos.filter((g) => g.nome.toLowerCase().includes(arg.toLowerCase()));
      if (achados.length !== 1)
        throw new Error(achados.length
          ? `Mais de um grupo combina com "${arg}": ${achados.map((g) => g.nome).join(' | ')}. Use um trecho mais específico.`
          : `Nenhum grupo combina com "${arg}".`);
      salvarConfig({ ...cfg, grupoId: achados[0].id, grupoNome: achados[0].nome });
      log(`Grupo dos avisos definido: ${achados[0].nome}`);
    }
  } else if (comando === 'previa') {
    console.log(await buscarMensagem(cfg, arg || 'convocacao'));
  } else if (comando === 'teste') {
    await enviarTexto(cfg, 'Teste do app da pelada ✅');
    log(`Mensagem de teste enviada para "${cfg.grupoNome}".`);
  } else if (comando === 'enviar') {
    if (!['lembrete', 'convocacao', 'cobranca'].includes(arg)) throw new Error('Use: enviar lembrete, enviar convocacao ou enviar cobranca');
    const motivo = forcar ? null : podeEnviar(arg);
    if (motivo) return log(`Aviso "${arg}" não enviado: ${motivo}.`);
    const texto = await buscarMensagem(cfg, arg);
    if (!texto) return log(`Aviso "${arg}" não enviado: o banco não devolveu mensagem.`);
    await enviarTexto(cfg, texto);
    log(`Aviso "${arg}" enviado para "${cfg.grupoNome}".`);
  } else {
    console.log('Comandos: conectar | grupos | grupo "nome" | previa <tipo> | teste | enviar <lembrete|convocacao> [--forcar]');
  }
}

// Só executa quando chamado direto (os testes importam as funções sem disparar nada).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  principal().then(() => process.exit(0)).catch((e) => { log('ERRO: ' + e.message); process.exit(1); });
}
