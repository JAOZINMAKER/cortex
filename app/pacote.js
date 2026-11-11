'use strict';
/*
 * CÓRTEX — pacote de atualização do app (.cortexapp).
 * Formato: gzip de um JSON { formato: 1, versao, criadoEm, arquivos: { "rel/caminho": "<base64>" } } com tudo o que vai
 * em resources/app (server, web, skills, app, cli.js, cli-inicio.js, instalar.js, package.json e os node_modules de
 * produção enxutos), sem o Electron. Manifesto ao lado: { versao, sha256, bytes, arquivo, publicadoEm, minElectron }.
 *
 * empacotar(raiz, { deps: 'producao' | 'presentes' })
 *   'producao'  (repositório de desenvolvimento): só as dependências de produção do package.json, recursivamente.
 *   'presentes' (app instalado/baixado): o node_modules que já está lá (já enxuto).
 * extrair(buf, destino, versaoEsperada) grava os arquivos (recusa caminhos fora do destino).
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const RAIZ_ITENS = ['package.json', 'cli.js', 'cli-inicio.js', 'instalar.js', '.env.exemplo', 'app', 'server', 'web', 'skills'];
const EXCLUIR_NOME = /^(\.git|\.DS_Store|Thumbs\.db|test|tests|__tests__|\.github|boot\.json|ok|ruim)$/i;
const EXCLUIR_ARQ = /(\.map|\.d\.ts|\.d\.cts|\.d\.mts|\.tmp)$|^(readme|changelog|history)(\.\w+)?$/i;

// three.js: só o que a interface usa (o pacote inteiro passa de 30 MB)
const THREE_MANTER = new Set(['package.json', 'LICENSE', 'build/three.module.js', 'examples/jsm/controls/OrbitControls.js']);
// fonte: só os arquivos de latin/latin-ext (os outros alfabetos não aparecem na interface)
const filtroModulo = {
  three: (rel) => THREE_MANTER.has(rel),
  '@fontsource-variable/martian-mono': (rel) => !rel.startsWith('files/') || /latin/.test(rel),
};

function andar(dir, base, saida, filtro) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    if (EXCLUIR_NOME.test(e.name)) continue;
    const abs = path.join(dir, e.name);
    const rel = base ? base + '/' + e.name : e.name;
    if (e.isDirectory()) andar(abs, rel, saida, filtro);
    else if (e.isFile() && !EXCLUIR_ARQ.test(e.name) && (!filtro || filtro(rel))) saida.push(rel);
  }
}

// nomes das dependências de produção, recursivo, a partir do package.json da raiz
function depsProducao(raiz) {
  const vistos = new Set();
  const fila = Object.keys((JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8')).dependencies) || {});
  while (fila.length) {
    const n = fila.shift();
    if (vistos.has(n)) continue;
    const pj = path.join(raiz, 'node_modules', n, 'package.json');
    if (!fs.existsSync(pj)) continue; // dependência opcional ausente (ex.: fsevents fora do mac)
    vistos.add(n);
    const p = JSON.parse(fs.readFileSync(pj, 'utf8'));
    for (const d of Object.keys(p.dependencies || {})) fila.push(d);
  }
  return [...vistos];
}

function listar(raiz, { deps = 'producao' } = {}) {
  const arquivos = [];
  for (const item of RAIZ_ITENS) {
    const abs = path.join(raiz, item);
    if (!fs.existsSync(abs)) continue;
    if (fs.statSync(abs).isDirectory()) andar(abs, item, arquivos);
    else arquivos.push(item);
  }
  const nm = path.join(raiz, 'node_modules');
  const modulos = deps === 'presentes'
    ? (() => { const out = []; for (const n of (fs.existsSync(nm) ? fs.readdirSync(nm) : [])) { if (n.startsWith('.')) continue; if (n.startsWith('@')) { for (const s of fs.readdirSync(path.join(nm, n))) out.push(n + '/' + s); } else out.push(n); } return out; })()
    : depsProducao(raiz);
  for (const m of modulos) {
    const f = filtroModulo[m];
    const lst = [];
    andar(path.join(nm, m), '', lst, f || null);
    for (const r of lst) arquivos.push('node_modules/' + m + '/' + r);
  }
  return arquivos.sort();
}

function empacotar(raiz, opcoes = {}) {
  const pkg = JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8'));
  const rels = listar(raiz, opcoes);
  const arquivos = {};
  let bytesBrutos = 0;
  for (const r of rels) { const b = fs.readFileSync(path.join(raiz, ...r.split('/'))); bytesBrutos += b.length; arquivos[r] = b.toString('base64'); }
  const json = Buffer.from(JSON.stringify({ formato: 1, versao: pkg.version, criadoEm: new Date().toISOString(), arquivos }));
  const buf = zlib.gzipSync(json, { level: 9 });
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const manifesto = {
    versao: pkg.version, sha256, bytes: buf.length, arquivo: `cortex-app-${pkg.version}.cortexapp`,
    publicadoEm: new Date().toISOString(), minElectron: (pkg.cortex && pkg.cortex.minElectron) || null, arquivos: rels.length,
  };
  return { buf, manifesto, bytesBrutos };
}

const sha256De = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// confere bytes + sha256 contra o manifesto; devolve o conteúdo já aberto
function abrir(buf, manifesto) {
  if (manifesto && manifesto.bytes && buf.length !== manifesto.bytes) throw new Error(`tamanho errado (${buf.length} ≠ ${manifesto.bytes})`);
  if (manifesto && manifesto.sha256 && sha256De(buf) !== manifesto.sha256) throw new Error('sha256 não confere');
  const dados = JSON.parse(zlib.gunzipSync(buf).toString('utf8'));
  if (!dados || dados.formato !== 1 || typeof dados.arquivos !== 'object') throw new Error('formato de pacote desconhecido');
  if (manifesto && manifesto.versao && dados.versao !== manifesto.versao) throw new Error(`pacote é ${dados.versao}, manifesto diz ${manifesto.versao}`);
  return dados;
}

function extrair(dados, destino) {
  const raiz = path.resolve(destino);
  let n = 0;
  for (const [rel, b64] of Object.entries(dados.arquivos)) {
    const alvo = path.resolve(raiz, ...rel.split('/'));
    if (alvo !== raiz && !alvo.startsWith(raiz + path.sep)) throw new Error(`caminho inválido no pacote: ${rel}`);
    fs.mkdirSync(path.dirname(alvo), { recursive: true });
    fs.writeFileSync(alvo, Buffer.from(b64, 'base64'));
    n++;
  }
  return n;
}

// escrita atômica: tmp na mesma pasta + rename (o OneDrive nunca vê arquivo pela metade)
function gravarAtomico(arq, conteudo) {
  const tmp = `${arq}.${process.pid}.${Date.now()}.tmp`;
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  fs.writeFileSync(tmp, conteudo);
  try { fs.renameSync(tmp, arq); } catch (e) { try { fs.rmSync(arq, { force: true }); fs.renameSync(tmp, arq); } catch { try { fs.rmSync(tmp, { force: true }); } catch { /* ok */ } throw e; } }
}

module.exports = { listar, empacotar, abrir, extrair, sha256De, gravarAtomico, depsProducao };
