'use strict';
/*
 * CÓRTEX — atualização automática do app.
 * Fontes (no boot e a cada 30 min):
 *   a) pasta de sincronização: <pasta>/CORTEX-SYNC/app/manifesto.json + <arquivo>.cortexapp  (pasta vem de GET /api/sync)
 *   b) GitHub: https://raw.githubusercontent.com/<repo>/main/atualizacao/manifesto.json  (repo: config.atualizacao.repo,
 *      padrão JAOZINMAKER/cortex; 404/sem rede = ignorado em silêncio; config.atualizacao.ativo=false desliga as duas)
 * Versão maior que a atual → baixa/copia, confere sha256, extrai em versoes/<v>.tmp, renomeia para versoes/<v>, marca ok.
 * Propagação: se a pasta de sync não tem manifesto ou tem versão menor que a que está rodando, publica a atual lá
 * (escrita atômica). Um PC recebe a versão nova → os outros se atualizam pelo OneDrive.
 * Limpeza: só as 2 versões mais recentes ficam em versoes/ (a que está rodando nunca é apagada).
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const resolver = require('./resolver');
const pacote = require('./pacote');

const REPO_PADRAO = 'JAOZINMAKER/cortex';

function lerJson(arq) { try { return JSON.parse(fs.readFileSync(arq, 'utf8')); } catch { return null; } }
const manifestoValido = (m) => m && resolver.ehVersao(m.versao) && typeof m.sha256 === 'string' && m.sha256.length === 64 && Number(m.bytes) > 0;

function baixar(url, { limite = 200 * 1048576, tempo = 15000, saltos = 3 } = {}) {
  return new Promise((resolve) => {
    const r = https.get(url, { timeout: tempo, headers: { 'user-agent': 'CORTEX-app' } }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && saltos > 0) { res.resume(); resolve(baixar(new URL(res.headers.location, url).toString(), { limite, tempo, saltos: saltos - 1 })); return; }
      if (res.statusCode !== 200) { res.resume(); resolve(null); return; }
      const partes = []; let n = 0;
      res.on('data', (c) => { n += c.length; if (n > limite) { r.destroy(); resolve(null); } else partes.push(c); });
      res.on('end', () => resolve(Buffer.concat(partes)));
      res.on('error', () => resolve(null));
    });
    r.on('timeout', () => { r.destroy(); resolve(null); });
    r.on('error', () => resolve(null));
  });
}

/**
 * opcoes: { versaoAtual, appDir, embutidoDir, pastaVersoes, configPath, podePublicar, obterSync: async () => ({pasta, ativo}),
 *           log(msg), aoMudar(estado) }
 */
function criar(op) {
  const log = op.log || (() => {});
  const estado = { atual: op.versaoAtual, disponivel: null, pronta: false, fonte: null, verificando: false, verificadoEm: null, publicadoEm: null, erro: null };
  const avisar = () => { try { op.aoMudar && op.aoMudar({ ...estado }); } catch { /* ok */ } };

  function configAtualizacao() {
    const c = (lerJson(op.configPath) || {}).atualizacao || {};
    return { ativo: c.ativo !== false, repo: c.repo === undefined ? REPO_PADRAO : c.repo };
  }

  async function manifestos(sync) {
    const lista = [];
    const cfg = configAtualizacao();
    if (!cfg.ativo) return lista;
    if (sync && sync.ativo && sync.pasta) {
      const dir = path.join(sync.pasta, 'CORTEX-SYNC', 'app');
      const m = lerJson(path.join(dir, 'manifesto.json'));
      if (manifestoValido(m)) lista.push({ fonte: 'sincronização', m, obter: async () => fs.readFileSync(path.join(dir, path.basename(m.arquivo || `cortex-app-${m.versao}.cortexapp`))) });
    }
    if (cfg.repo && /^[\w.-]+\/[\w.-]+$/.test(cfg.repo)) {
      const base = `https://raw.githubusercontent.com/${cfg.repo}/main/atualizacao/`;
      const b = await baixar(base + 'manifesto.json', { limite: 65536, tempo: 8000 });
      let m = null; try { m = b && JSON.parse(b.toString('utf8')); } catch { /* não é JSON */ }
      if (manifestoValido(m)) lista.push({ fonte: 'GitHub', m, obter: async () => { const x = await baixar(base + path.basename(m.arquivo || `cortex-app-${m.versao}.cortexapp`)); if (!x) throw new Error('download falhou'); return x; } });
    }
    return lista;
  }

  // versões que falharam no boot: marcador "ruim" na pasta e, depois que a pasta é apagada, ruins.json
  const arqRuins = () => path.join(op.pastaVersoes, 'ruins.json');
  const ruins = () => new Set(lerJson(arqRuins()) || []);
  const ruim = (v) => fs.existsSync(path.join(op.pastaVersoes, v, 'ruim')) || ruins().has(v);
  const instalada = (v) => !resolver.problema(path.join(op.pastaVersoes, v), v);

  async function instalar(c) {
    const v = c.m.versao;
    const final = path.join(op.pastaVersoes, v);
    const tmp = final + '.tmp';
    const buf = await c.obter();
    const dados = pacote.abrir(buf, c.m); // confere tamanho, sha256, formato e versão
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    const n = pacote.extrair(dados, tmp);
    const prob = resolver.problema(tmp, v);
    if (prob && prob !== 'sem marcador ok') throw new Error('pacote incompleto: ' + prob);
    fs.rmSync(final, { recursive: true, force: true });
    fs.renameSync(tmp, final);
    fs.writeFileSync(path.join(final, 'ok'), JSON.stringify({ fonte: c.fonte, sha256: c.m.sha256, em: new Date().toISOString() }));
    log(`atualização ${v} pronta (${n} arquivos, de ${c.fonte})`);
  }

  // publica a versão que está rodando na pasta de sync, se lá não houver uma igual ou maior
  function propagar(sync) {
    if (!op.podePublicar || !sync || !sync.ativo || !sync.pasta || !fs.existsSync(sync.pasta)) return;
    if (configAtualizacao().ativo === false) return;
    const dir = path.join(sync.pasta, 'CORTEX-SYNC', 'app');
    const m = lerJson(path.join(dir, 'manifesto.json'));
    if (manifestoValido(m) && resolver.comparar(m.versao, op.versaoAtual) >= 0) return;
    const { buf, manifesto } = pacote.empacotar(op.appDir, { deps: 'presentes' });
    if (manifesto.versao !== op.versaoAtual) return; // pasta do app não bate com a versão em execução
    pacote.gravarAtomico(path.join(dir, manifesto.arquivo), buf);
    pacote.gravarAtomico(path.join(dir, 'manifesto.json'), JSON.stringify(manifesto, null, 2) + '\n');
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.cortexapp') && f !== manifesto.arquivo) { try { fs.rmSync(path.join(dir, f)); } catch { /* em uso */ } }
    estado.publicadoEm = new Date().toISOString();
    log(`versão ${manifesto.versao} publicada na sincronização (${(buf.length / 1048576).toFixed(2)} MB) para os outros PCs`);
  }

  // mantém só as 2 versões mais recentes (e nunca a que está rodando); limpa .tmp esquecidos
  function limpar() {
    let nomes = [];
    try { nomes = fs.readdirSync(op.pastaVersoes); } catch { return; }
    for (const n of nomes) if (n.endsWith('.tmp')) { try { fs.rmSync(path.join(op.pastaVersoes, n), { recursive: true, force: true }); } catch { /* em uso */ } }
    const vs = nomes.filter(resolver.ehVersao).sort((a, b) => resolver.comparar(b, a));
    const manter = new Set(vs.filter((v) => !ruim(v)).slice(0, 2));
    for (const v of vs) {
      const dir = path.join(op.pastaVersoes, v);
      if (manter.has(v) || path.resolve(dir) === path.resolve(op.appDir)) continue;
      if (fs.existsSync(path.join(dir, 'ruim'))) { const r = ruins(); if (!r.has(v)) { r.add(v); try { fs.writeFileSync(arqRuins(), JSON.stringify([...r])); } catch { /* ok */ } } }
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* arquivos em uso: tenta na próxima */ }
    }
  }

  async function verificar() {
    if (estado.verificando) return { ...estado };
    estado.verificando = true; estado.erro = null; avisar();
    try {
      let sync = null;
      try { sync = op.obterSync ? await op.obterSync() : null; } catch { /* servidor ocupado */ }
      const lista = (await manifestos(sync))
        .filter((c) => resolver.comparar(c.m.versao, op.versaoAtual) > 0 && !ruim(c.m.versao) && resolver.electronAtende(c.m.minElectron))
        .sort((a, b) => resolver.comparar(b.m.versao, a.m.versao));
      for (const c of lista) {
        try {
          if (!instalada(c.m.versao)) await instalar(c);
          estado.disponivel = c.m.versao; estado.fonte = c.fonte; estado.pronta = true;
          break;
        } catch (e) {
          estado.erro = `${c.fonte}: ${e.message}`;
          log(`atualização ${c.m.versao} recusada (${estado.erro})`);
          try { fs.rmSync(path.join(op.pastaVersoes, c.m.versao + '.tmp'), { recursive: true, force: true }); } catch { /* ok */ }
        }
      }
      // uma versão já baixada antes (por exemplo, por outra janela) também conta
      if (!estado.pronta) {
        const melhor = resolver.baixadas(op.pastaVersoes)[0];
        if (melhor && resolver.comparar(melhor.versao, op.versaoAtual) > 0) { estado.disponivel = melhor.versao; estado.pronta = true; estado.fonte = estado.fonte || 'local'; }
      }
      try { propagar(sync); } catch (e) { log('não deu para publicar na sincronização: ' + e.message); }
      limpar();
    } finally {
      estado.verificando = false; estado.verificadoEm = new Date().toISOString(); avisar();
    }
    return { ...estado };
  }

  return { verificar, estado: () => ({ ...estado }), limpar, propagar };
}

module.exports = { criar, REPO_PADRAO };
