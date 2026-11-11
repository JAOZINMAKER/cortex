'use strict';
/*
 * CÓRTEX — bootstrap do app (o "main" do package.json). ESTÁVEL: fica em resources/app e nunca é trocado.
 * Escolhe a versão mais nova (embutida ou baixada em versoes/) e carrega o app/main.js DELA. Tudo o que vem depois
 * (servidor, interface, skills, CLI) sai da pasta escolhida.
 * Rollback: se a versão baixada lança erro antes de confirmar o boot (janela carregada), ela é marcada como ruim
 * e o app reinicia na anterior. Crash duro 2 vezes seguidas sem confirmar = ruim também (contado em boot.json).
 */
const path = require('path');
const { app } = require('electron');
const resolver = require('./resolver');

const EMBUTIDO = path.resolve(__dirname, '..');
const escolha = resolver.escolher(EMBUTIDO);

function voltarParaAnterior(motivo) {
  if (escolha.embutido || boot.confirmado) return false;
  resolver.marcarRuim(escolha.dir, motivo);
  try { console.error(`[CÓRTEX] versão ${escolha.versao} falhou no boot (${motivo}); voltando para a anterior`); } catch { /* sem console */ }
  app.relaunch();
  app.exit(0);
  return true;
}

const aoErro = (e) => {
  const msg = (e && (e.stack || e.message)) || String(e);
  if (!voltarParaAnterior(String(msg).split('\n')[0])) { try { console.error('[CÓRTEX]', msg); } catch { /* ok */ } }
};

const boot = {
  versao: escolha.versao,
  dir: escolha.dir,
  embutido: escolha.embutido,
  embutidoDir: EMBUTIDO,
  pastaVersoes: escolha.pastaVersoes,
  descartadas: escolha.descartadas,
  confirmado: false,
  // o main.js chama quando a interface carregou: zera o contador e solta os ganchos de rollback
  confirmar() {
    if (boot.confirmado) return;
    boot.confirmado = true;
    if (!escolha.embutido) resolver.confirmarBoot(escolha.dir);
    process.removeListener('uncaughtException', aoErro);
    process.removeListener('unhandledRejection', aoErro);
  },
  falhou: voltarParaAnterior,
};
global.__cortexBoot = boot;

if (!escolha.embutido) {
  process.on('uncaughtException', aoErro);
  process.on('unhandledRejection', aoErro);
}

try {
  require(path.join(escolha.dir, 'app', 'main.js'));
} catch (e) {
  if (!voltarParaAnterior('erro ao carregar: ' + (e && e.message))) throw e;
}
