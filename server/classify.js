'use strict';
// Organização automática. Regras locais sempre; Claude só se ligado e com chave.
// A interpretação da máquina vive em data/maquina.json; o texto original nunca é tocado.
const path = require('path');
const { readJSON, writeJSON } = require('./util');
const config = require('./config');

const ARQ_MAQ = () => path.join(config.DATA_DIR, 'maquina.json');
const ARQ_COR = () => path.join(config.DATA_DIR, 'correcoes.json');

const REGRAS = [
  ['CODIGO', /\b(function|const|class|import|export|return|script|lua|luau|código|codigo|javascript|typescript|python|refactor|refatora|implementa|module|api|endpoint|\.js|\.ts|\.py|\.lua|server|cliente|client)\b/i],
  ['DESIGN', /\b(design|layout|ui|ux|interface|figma|cor(es)?|paleta|tipografia|fonte|estética|estetica|visual|mockup|icone|ícone|brutalis\w*)\b/i],
  ['ROTEIRO', /\b(roteiro|script de vídeo|cena|narração|narracao|falas?|storyboard|cortes?|hook|gancho)\b/i],
  ['VIDEO', /\b(vídeo|video|edição|edicao|premiere|after effects|davinci|render|mp4|mov|timeline|transição|transicao|motion)\b/i],
  ['BUG', /\b(bug|erro|error|falha|crash|fix|corrige|corrigir|quebrado|exception|traceback)\b/i],
  ['DOCS', /\b(readme|docs?|documenta\w*|guia|manual|wiki|tutorial|help|ajuda)\b/i],
  ['PLANO', /\b(plano|plan|roadmap|todo|tarefa|próximos passos|proximos passos|meta|objetivo|sprint|backlog)\b/i],
  ['ROBLOX', /\b(roblox|studio|rbx|rbxl|luau|datastore|remoteevent|workspace|humanoid)\b/i],
  ['IA', /\b(claude|llm|gpt|agente|agentes|agent|agents|prompt|prompts|anthropic|subagent|intelig[êe]ncia artificial|artificial intelligence)\b/i],
  ['CONFIG', /\b(config|configura\w*|settings|\.json|\.ya?ml|\.env|package\.json|setup|instal\w*)\b/i],
  ['TESTE', /\b(test(e|es|s)?|spec|jest|vitest|playwright|assert|benchmark|bench)\b/i],
  ['ASSET', /\b(asset|png|jpe?g|svg|wav|mp3|ogg|textura|sprite|modelo 3d|fbx|blend|imagem|image)\b/i],
];

for (const r of REGRAS) r.push(new RegExp(r[1].source, 'gi'));

const STOP = new Set(('a o os as de da do das dos em no na nos nas um uma uns umas e ou que se por para com sem como mais menos muito pouco este esta isso isto esse essa ele ela eles elas eu voce você nos nós ser estar ter fazer pode podem tem são sao foi era como quando onde qual quais porque pois também tambem já ja não nao sim ainda mesmo cada todo toda todos todas sobre entre até ate depois antes the of and to in is it for on with as by be this that are from at or an not can you your will have has was were which their they them there then than but if so all any more most other some such only also into out up use used using how what when where who why file files note notes link links página pagina obsidian md https http www com').split(/\s+/));

function tokens(txt) {
  return String(txt || '').toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-zà-ÿ0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w.length >= 4 && w.length <= 24 && !STOP.has(w) && !/^\d+$/.test(w));
}

function semAcento(s) { return s.normalize('NFD').replace(/[̀-ͯ]/g, ''); }

const cacheTexto = new Map(); // id -> { k, tf, regras }
let maquina = null;
let correcoes = null;
const fila = [];
let rodando = 0;
let aoAtualizar = null;

function carregar() {
  if (!maquina) maquina = readJSON(ARQ_MAQ(), {});
  if (!correcoes) correcoes = readJSON(ARQ_COR(), {});
}

// nos: lista de nós completos (com .id, .texto, .titulo, .caminho, .tipo, .hash, .regiao, .cluster)
function classificar(nos) {
  carregar();
  const N = nos.length || 1;
  const df = new Map();
  const tfs = new Array(nos.length);
  const regrasDe = new Array(nos.length);
  for (let i = 0; i < nos.length; i++) {
    const n = nos[i];
    if (n.tipo === 'dia') { tfs[i] = null; continue; }
    // cache por conteúdo: tokens e regras só são recalculados quando o texto muda
    const chaveCache = n.hash + '|' + n.titulo + '|' + (n.texto || '').length;
    let c = cacheTexto.get(n.id);
    if (!c || c.k !== chaveCache) {
      const tf = new Map();
      for (const w of tokens(n.titulo + ' ' + n.titulo + ' ' + (n.texto || ''))) tf.set(w, (tf.get(w) || 0) + 1);
      const curto = `${n.titulo}\n${(n.extra && n.extra.rel) || ''}`;
      const texto = (n.texto || '').slice(0, 4000);
      const regras = [];
      for (const [tag, re, reG] of REGRAS) {
        if (re.test(curto)) { regras.push(tag); continue; }
        // no corpo, exige recorrência (textos longos citam de tudo um pouco)
        const m = texto.match(reG);
        const lim = texto.length < 400 ? 1 : 3;
        if (m && m.length >= lim) regras.push(tag);
      }
      c = { k: chaveCache, tf, regras };
      cacheTexto.set(n.id, c);
    }
    tfs[i] = c.tf;
    regrasDe[i] = c.regras;
    for (const w of c.tf.keys()) df.set(w, (df.get(w) || 0) + 1);
  }
  const limiteDf = Math.max(3, N * 0.25);
  const org = config.get().organizacao || {};
  const regrasLigadas = org.regrasLocais !== false;
  const agora = Date.now();
  for (let i = 0; i < nos.length; i++) {
    const n = nos[i];
    if (n.tipo === 'dia') { n.tags = ['TEMPO']; continue; }
    // CONFIGURAÇÕES → ORGANIZAÇÃO → regras locais desligadas: sobra só o que o Claude classificar
    const tags = regrasLigadas ? regrasDe[i].slice() : [];
    if (n.tipo === 'commit') tags.push('COMMIT');
    if (n.tipo === 'sessao') tags.push('SESSAO');
    const tf = tfs[i];
    if (tf) {
      const pont = [];
      for (const [w, c] of tf) {
        const d = df.get(w) || 1;
        if (d < 2 || d > limiteDf) continue;
        pont.push([w, (1 + Math.log(c)) * Math.log(N / d)]);
      }
      pont.sort((a, b) => b[1] - a[1]);
      if (regrasLigadas) for (const [w] of pont.slice(0, 3)) tags.push(semAcento(w).toUpperCase());
    }
    const anterior = maquina[n.id];
    if (anterior && anterior.por === 'claude' && anterior.hash === n.hash) {
      n.tags = anterior.tags.slice(0, 10);
      anterior.regiao = n.regiao; anterior.cluster = n.cluster;
    } else {
      const uniq = [...new Set(tags)].slice(0, 10);
      const mudou = !anterior || anterior.hash !== n.hash;
      maquina[n.id] = { tags: uniq, regiao: n.regiao, cluster: n.cluster, por: 'regras', em: mudou || !anterior ? agora : anterior.em, hash: n.hash };
      n.tags = uniq;
      if (mudou && (n.tipo === 'nota' || n.tipo === 'doc' || n.tipo === 'sessao')) enfileirarClaude(n);
    }
    const c = correcoes[n.id];
    if (c && Array.isArray(c.tags)) n.tags = c.tags.slice(0, 20);
  }
  salvarMaquina();
  processarFila();
}

let salvarTimer = null;
function salvarMaquina() {
  clearTimeout(salvarTimer);
  salvarTimer = setTimeout(() => { try { writeJSON(ARQ_MAQ(), maquina); } catch { /* opcional */ } }, 500);
}

function claudeLigado() {
  const c = config.get();
  return !!(c.claude && c.claude.ativo && config.chaveClaude());
}

const MAX_FILA = 200;
function enfileirarClaude(n) {
  if (!claudeLigado()) return;
  if (fila.length >= MAX_FILA) return;
  if (fila.some((x) => x.id === n.id)) return;
  fila.push({ id: n.id, hash: n.hash, titulo: n.titulo, tipo: n.tipo, texto: (n.texto || '').slice(0, 2500) });
}

async function chamarClaude(item) {
  const c = config.get();
  const corpo = {
    model: c.claude.modelo || 'claude-haiku-5-5',
    max_tokens: 200,
    messages: [{ role: 'user', content:
      'Classifique este registro de um segundo cérebro pessoal. Responda APENAS um JSON {"tags":[até 6 tags curtas em MAIÚSCULAS sem acento],"nota":"uma frase curta em português"}.\n' +
      `TIPO: ${item.tipo}\nTÍTULO: ${item.titulo}\nTEXTO:\n${item.texto}` }],
  };
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': config.chaveClaude(), 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  const txt = (j.content || []).map((b) => b.text || '').join('');
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('resposta sem JSON');
  const o = JSON.parse(m[0]);
  return { tags: (o.tags || []).map((t) => semAcento(String(t)).toUpperCase().replace(/[^A-Z0-9_\-]/g, '')).filter(Boolean).slice(0, 8), nota: String(o.nota || '').slice(0, 200) };
}

const chamadas = []; // timestamps da última hora (limitePorHora)
function processarFila() {
  if (!claudeLigado()) { fila.length = 0; return; }
  const lim = Number((config.get().organizacao || {}).limitePorHora);
  const agora = Date.now();
  while (chamadas.length && chamadas[0] < agora - 3600000) chamadas.shift();
  if (Number.isFinite(lim) && lim >= 0 && chamadas.length >= lim) {
    if (!processarFila.agendado) { processarFila.agendado = setTimeout(() => { processarFila.agendado = null; processarFila(); }, 60000); processarFila.agendado.unref(); }
    return;
  }
  while (rodando < 2 && fila.length && !(Number.isFinite(lim) && chamadas.length >= lim)) {
    chamadas.push(Date.now());
    const item = fila.shift();
    rodando++;
    chamarClaude(item).then((res) => {
      const ant = maquina[item.id] || {};
      maquina[item.id] = { ...ant, tags: res.tags.length ? res.tags : ant.tags || [], nota: res.nota, por: 'claude', em: Date.now(), hash: item.hash };
      salvarMaquina();
      if (aoAtualizar) aoAtualizar({ ok: true, id: item.id, tags: maquina[item.id].tags });
    }).catch((e) => {
      if (aoAtualizar) aoAtualizar({ ok: false, id: item.id, erro: e.message });
    }).finally(() => { rodando--; processarFila(); });
  }
}

function tamanhoFila() { return fila.length + rodando; }

function interpretacao(id) {
  carregar();
  return maquina[id] || null;
}

function correcao(id) {
  carregar();
  return correcoes[id] || null;
}

function todasCorrecoes() { carregar(); return correcoes; }

function salvarCorrecao(id, { tags, regiao }) {
  carregar();
  const c = correcoes[id] || {};
  if (Array.isArray(tags)) c.tags = tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 20);
  if (typeof regiao === 'string' && regiao.trim()) c.regiao = regiao.trim();
  if (tags === null) delete c.tags;
  if (regiao === null) delete c.regiao;
  c.em = Date.now();
  correcoes[id] = c;
  writeJSON(ARQ_COR(), correcoes);
  return c;
}

function onAtualizar(fn) { aoAtualizar = fn; }

// V5: ids passaram a usar a chave natural sem caminho absoluto. Move correções e interpretação dos ids antigos
// para os novos, uma vez só (marca em data/.ids-v5). mapa: Map idAntigo -> idNovo
function migrarIds(mapa) {
  const marca = path.join(config.DATA_DIR, '.ids-v5');
  if (require('fs').existsSync(marca)) return null;
  carregar();
  let nc = 0, nm = 0;
  for (const [antigo, novo] of mapa) {
    if (antigo === novo) continue;
    if (correcoes[antigo] && !correcoes[novo]) { correcoes[novo] = correcoes[antigo]; delete correcoes[antigo]; nc++; }
    if (maquina[antigo] && !maquina[novo]) { maquina[novo] = maquina[antigo]; delete maquina[antigo]; nm++; }
  }
  if (nc) writeJSON(ARQ_COR(), correcoes);
  if (nm) salvarMaquina();
  writeJSON(marca, { em: Date.now(), correcoes: nc, interpretacoes: nm });
  return { correcoes: nc, interpretacoes: nm };
}

// apaga a interpretação da máquina (maquina.json + cache em memória). As correções do usuário ficam.
function limparCache() {
  cacheTexto.clear();
  maquina = {};
  fila.length = 0;
  try { require('fs').rmSync(ARQ_MAQ(), { force: true }); } catch { /* já não existe */ }
}

module.exports = { migrarIds, limparCache, classificar, interpretacao, correcao, todasCorrecoes, salvarCorrecao, tamanhoFila, onAtualizar, claudeLigado };
