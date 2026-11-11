'use strict';
/*
 * CÓRTEX — escolha da versão do app a rodar (embutida em resources/app ou baixada em versoes/<versao>).
 * Usado pelo bootstrap (app/inicio.js) e pelo CLI (cli-inicio.js). ESTÁVEL: este arquivo vive na instalação
 * e não é trocado por atualizações; só node built-ins, sem estado global.
 *
 * Pasta de versões: env CORTEX_VERSOES → Windows %LOCALAPPDATA%\CORTEX\versoes · mac ~/Library/Application Support/CORTEX/versoes
 *                   · Linux $XDG_DATA_HOME/CORTEX/versoes (~/.local/share/...).
 * Uma versão baixada é válida quando: <pasta>/<versao>/ tem package.json com essa versão, app/main.js, cli.js,
 * o marcador `ok`, NÃO tem o marcador `ruim`, e a exigência minElectron (package.json → cortex.minElectron) é atendida.
 * boot.json { tentativas } conta boots não confirmados: 2 seguidos = a versão é marcada como ruim.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

function pastaVersoes() {
  if (process.env.CORTEX_VERSOES) return path.resolve(process.env.CORTEX_VERSOES);
  const home = os.homedir();
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'CORTEX', 'versoes');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'CORTEX', 'versoes');
  return path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'CORTEX', 'versoes');
}

// semver simples: "2.10.0" > "2.9.3"; sufixos (-beta) são ignorados
function partes(v) { return String(v || '0').split('-')[0].split('.').map((x) => parseInt(x, 10) || 0); }
function comparar(a, b) {
  const x = partes(a), y = partes(b);
  for (let i = 0; i < Math.max(x.length, y.length, 3); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0 ? 1 : -1; }
  return 0;
}
const ehVersao = (v) => /^\d+\.\d+\.\d+$/.test(String(v || ''));

function lerJson(arq) { try { return JSON.parse(fs.readFileSync(arq, 'utf8')); } catch { return null; } }
function lerPkg(dir) { const p = lerJson(path.join(dir, 'package.json')); return p && ehVersao(p.version) ? p : null; }

function electronAtende(minimo) {
  if (!minimo || !process.versions.electron) return true;
  return comparar(process.versions.electron, minimo) >= 0;
}

// motivo pelo qual uma pasta de versão não serve (null = serve)
function problema(dir, versao) {
  const pkg = lerPkg(dir);
  if (!pkg) return 'sem package.json válido';
  if (versao && pkg.version !== versao) return `package.json diz ${pkg.version}`;
  if (!fs.existsSync(path.join(dir, 'app', 'main.js'))) return 'sem app/main.js';
  if (!fs.existsSync(path.join(dir, 'cli.js'))) return 'sem cli.js';
  if (fs.existsSync(path.join(dir, 'ruim'))) return 'marcada como ruim';
  if (!fs.existsSync(path.join(dir, 'ok'))) return 'sem marcador ok';
  if (!electronAtende(pkg.cortex && pkg.cortex.minElectron)) return `exige Electron ${pkg.cortex.minElectron}`;
  return null;
}

// versões baixadas válidas, da maior para a menor
function baixadas(pasta = pastaVersoes()) {
  let nomes = [];
  try { nomes = fs.readdirSync(pasta); } catch { return []; }
  return nomes.filter(ehVersao).map((v) => ({ versao: v, dir: path.join(pasta, v), embutido: false }))
    .filter((c) => !problema(c.dir, c.versao))
    .sort((a, b) => comparar(b.versao, a.versao));
}

// candidatas em ordem de preferência: maior versão primeiro; empate fica com a embutida
function candidatos(embutidoDir, pasta = pastaVersoes()) {
  const lista = baixadas(pasta);
  const pkg = lerPkg(embutidoDir);
  const emb = { versao: pkg ? pkg.version : '0.0.0', dir: embutidoDir, embutido: true };
  const i = lista.findIndex((c) => comparar(c.versao, emb.versao) <= 0);
  if (i < 0) lista.push(emb); else lista.splice(i, 0, emb);
  return lista;
}

const arqBoot = (dir) => path.join(dir, 'boot.json');
function lerBoot(dir) { return lerJson(arqBoot(dir)) || { tentativas: 0 }; }
function gravarBoot(dir, b) { try { fs.writeFileSync(arqBoot(dir), JSON.stringify(b)); } catch { /* pasta só leitura */ } }
function marcarRuim(dir, motivo) {
  try { fs.writeFileSync(path.join(dir, 'ruim'), JSON.stringify({ motivo: String(motivo || ''), em: new Date().toISOString() })); } catch { /* ok */ }
}

/**
 * Escolhe a versão a rodar. Versões baixadas com 2+ boots não confirmados são marcadas ruins e puladas.
 * opcoes.contarBoot (padrão true): soma 1 em boot.json da escolhida (o app confirma depois com confirmarBoot).
 * Devolve { versao, dir, embutido, embutidoDir, pastaVersoes, descartadas: [{versao, motivo}] }.
 */
function escolher(embutidoDir, opcoes = {}) {
  const pasta = opcoes.pastaVersoes || pastaVersoes();
  const contar = opcoes.contarBoot !== false;
  const descartadas = [];
  if (process.env.CORTEX_SO_EMBUTIDO) {
    const pkg = lerPkg(embutidoDir);
    return { versao: pkg ? pkg.version : '0.0.0', dir: embutidoDir, embutido: true, embutidoDir, pastaVersoes: pasta, descartadas };
  }
  for (const c of candidatos(embutidoDir, pasta)) {
    if (!c.embutido && contar) {
      const b = lerBoot(c.dir);
      if ((b.tentativas || 0) >= 2) { marcarRuim(c.dir, `${b.tentativas} boots seguidos sem confirmar`); descartadas.push({ versao: c.versao, motivo: 'boots sem confirmar' }); continue; }
      gravarBoot(c.dir, { tentativas: (b.tentativas || 0) + 1, em: new Date().toISOString() });
    }
    return { ...c, embutidoDir, pastaVersoes: pasta, descartadas };
  }
  const pkg = lerPkg(embutidoDir);
  return { versao: pkg ? pkg.version : '0.0.0', dir: embutidoDir, embutido: true, embutidoDir, pastaVersoes: pasta, descartadas };
}

function confirmarBoot(dir) { gravarBoot(dir, { tentativas: 0, confirmadoEm: new Date().toISOString() }); }

module.exports = { pastaVersoes, comparar, ehVersao, lerPkg, problema, baixadas, candidatos, escolher, confirmarBoot, marcarRuim, lerBoot, electronAtende };
