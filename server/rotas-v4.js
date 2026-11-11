'use strict';
// Rotas V4 (app de desktop): configuração por seções, chave do Claude, temas próprios, skills e projetos.
// Chamado por server/index.js: tratar(p, req, res, url, ctx) → true se respondeu.
const path = require('path');
const { readJSON, writeJSON, slug, sha1 } = require('./util');
const config = require('./config');
const projeto = require('./projeto');
const classify = require('./classify');
const diario = require('./diario');
const graph = require('./graph');
const skillsInst = require('./skills-instalar');
const executores = require('./skills');

const ARQ_TEMAS = () => path.join(config.DATA_DIR, 'temas.json');
const ARQ_PROJ = () => path.join(config.DATA_DIR, 'projetos.json');
const TEMAS_PRONTOS = new Set(['grafite', 'ambar', 'mono', 'violeta']);

// ------------------------------------------------------------ config por seções
const B = (v) => (typeof v === 'boolean' ? { ok: v } : { erro: 'precisa ser verdadeiro/falso' });
const N = (min, max, inteiro) => (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || (inteiro && !Number.isInteger(n))) return { erro: `precisa ser ${inteiro ? 'inteiro' : 'número'}` };
  if (n < min || n > max) return { erro: `fora do intervalo ${min}..${max}` };
  return { ok: n };
};
const E = (...ops) => (v) => (ops.includes(v) ? { ok: v } : { erro: `use um de: ${ops.join(', ')}` });
const S = (re, max = 80) => (v) => (typeof v === 'string' && v.length <= max && re.test(v) ? { ok: v } : { erro: 'formato inválido' });

const ESQUEMA = {
  geral: { porta: N(1024, 65535, true), iniciarComWindows: B, fecharParaBandeja: B, atalhoGlobal: S(/^[A-Za-z0-9+ ]{1,40}$/), idioma: E('pt') },
  organizacao: { regrasLocais: B, claudeAtivo: B, modelo: S(/^[a-z0-9][a-z0-9.\-]{2,60}$/), limitePorHora: N(0, 10000, true) },
  cerebro: { profundidadeIdade: N(0, 3), espacamentoLobos: N(0, 4), mostrarTecido: B, mostrarGrade: B, mostrarSinapses: B, rotacaoAuto: B, velocidadeReplay: N(0.1, 50) },
  desempenho: { limiteNeuronios: N(1000, 200000, true), fpsMax: N(15, 240, true), qualidadeSinapses: E('baixa', 'media', 'alta') },
  notificacoes: { registroDiario: B, commitNovo: B, sessaoNova: B },
};
// mudanças que só valem depois de reconstruir o grafo / reiniciar o servidor
const RECONSTRUIR = new Set(['fontes.apelidos', 'fontes.ignorar', 'cerebro.profundidadeIdade', 'cerebro.espacamentoLobos', 'organizacao.regrasLocais']);
const REINICIAR = new Set(['geral.porta']);

function mascarar(k) { return k ? `${k.slice(0, 3)}...${k.slice(-4)}` : null; }

function configPublica() {
  const c = config.get();
  const chave = config.chaveClaude();
  return {
    geral: { ...c.geral, porta: c.porta },
    organizacao: { ...c.organizacao, claudeAtivo: !!c.claude.ativo, modelo: c.claude.modelo, temChave: !!chave, chave: mascarar(chave), claudeLigado: classify.claudeLigado() },
    cerebro: { ...c.cerebro },
    desempenho: { ...c.desempenho },
    notificacoes: { ...c.notificacoes },
    fontes: { apelidos: { ...c.apelidos }, ignorar: [...c.ignorar] },
    caminhos: { appDir: config.APP_DIR, dadosDir: config.DADOS_DIR, configPath: config.CONFIG_PATH, dataDir: config.DATA_DIR, diarioDir: config.DIARIO_DIR },
  };
}

function aplicarConfig(corpo) {
  const erros = [];
  const mudancas = [];
  const novo = {};
  for (const [secao, campos] of Object.entries(corpo || {})) {
    if (secao === 'caminhos') continue;
    if (secao === 'fontes') {
      if (!campos || typeof campos !== 'object') { erros.push({ campo: 'fontes', erro: 'precisa ser objeto' }); continue; }
      if (campos.apelidos !== undefined) {
        const a = campos.apelidos;
        if (!a || typeof a !== 'object' || Array.isArray(a)) erros.push({ campo: 'fontes.apelidos', erro: 'precisa ser { "glob": "projeto" }' });
        else {
          const ok = {};
          for (const [k, v] of Object.entries(a)) {
            if (!k.trim() || k.length > 80 || typeof v !== 'string' || !v.trim() || v.length > 80) erros.push({ campo: `fontes.apelidos.${k}`, erro: 'glob e projeto: texto de 1 a 80 caracteres' });
            else ok[k.trim()] = v.trim();
          }
          novo['fontes.apelidos'] = ok;
        }
      }
      if (campos.ignorar !== undefined) {
        const l = campos.ignorar;
        if (!Array.isArray(l) || l.length > 100 || l.some((x) => typeof x !== 'string' || !x.trim() || x.length > 120)) erros.push({ campo: 'fontes.ignorar', erro: 'lista de até 100 padrões (texto)' });
        else novo['fontes.ignorar'] = [...new Set(l.map((x) => x.trim()))];
      }
      continue;
    }
    const esq = ESQUEMA[secao];
    if (!esq) { erros.push({ campo: secao, erro: 'seção desconhecida' }); continue; }
    if (!campos || typeof campos !== 'object') { erros.push({ campo: secao, erro: 'precisa ser objeto' }); continue; }
    for (const [k, v] of Object.entries(campos)) {
      if (secao === 'organizacao' && (k === 'temChave' || k === 'chave' || k === 'claudeLigado')) continue; // só leitura
      const val = esq[k];
      if (!val) { erros.push({ campo: `${secao}.${k}`, erro: 'campo desconhecido' }); continue; }
      const r = val(v);
      if (r.erro) erros.push({ campo: `${secao}.${k}`, erro: r.erro });
      else novo[`${secao}.${k}`] = r.ok;
    }
  }
  if (erros.length) return { erros };
  const c = config.get();
  for (const [campo, v] of Object.entries(novo)) {
    const [secao, k] = campo.split('.');
    let antes;
    if (campo === 'fontes.apelidos') { antes = c.apelidos; c.apelidos = v; }
    else if (campo === 'fontes.ignorar') { antes = c.ignorar; c.ignorar = v; }
    else if (campo === 'organizacao.claudeAtivo') { antes = c.claude.ativo; c.claude.ativo = v; }
    else if (campo === 'organizacao.modelo') { antes = c.claude.modelo; c.claude.modelo = v; }
    else if (campo === 'geral.porta') { antes = c.porta; c.porta = v; c.geral.porta = v; }
    else { antes = c[secao][k]; c[secao][k] = v; }
    if (JSON.stringify(antes) !== JSON.stringify(v)) mudancas.push(campo);
  }
  config.salvar();
  if (mudancas.includes('fontes.apelidos')) projeto.limparCache();
  return {
    mudancas,
    precisaReconstruir: mudancas.some((m) => RECONSTRUIR.has(m)),
    precisaReiniciar: mudancas.some((m) => REINICIAR.has(m)),
  };
}

async function testarChave(chave, modelo) {
  if (!chave) return { ok: false, erro: 'nenhuma chave gravada' };
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': chave, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: modelo, max_tokens: 1, messages: [{ role: 'user', content: 'ok' }] }),
      signal: AbortSignal.timeout(15000),
    });
    if (r.ok) return { ok: true, modelo };
    let msg = 'HTTP ' + r.status;
    try { const j = await r.json(); if (j.error && j.error.message) msg += ': ' + j.error.message; } catch { /* sem corpo */ }
    return { ok: false, erro: msg, status: r.status };
  } catch (e) { return { ok: false, erro: e.name === 'TimeoutError' ? 'sem resposta em 15 s' : e.message }; }
}

// ------------------------------------------------------------ temas
const temasTodos = () => readJSON(ARQ_TEMAS(), { temas: [] }).temas || [];
function gravarTema(t) {
  if (!t || typeof t !== 'object') throw new Error('tema inválido');
  const nome = String(t.nome || '').trim().slice(0, 60);
  if (!nome) throw new Error('o tema precisa de nome');
  let id = slug(t.id || nome);
  if (TEMAS_PRONTOS.has(id)) id = 'meu-' + id; // não sobrescreve os temas prontos
  const base = TEMAS_PRONTOS.has(String(t.base || '')) ? String(t.base) : 'grafite';
  if (!t.tokens || typeof t.tokens !== 'object' || Array.isArray(t.tokens)) throw new Error('tokens precisa ser objeto { token: valor }');
  const tokens = {};
  for (const [k, v] of Object.entries(t.tokens).slice(0, 200)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,40}$/.test(k)) throw new Error(`token com nome inválido: ${k}`);
    if (typeof v === 'number' && Number.isFinite(v)) tokens[k] = v;
    else if (typeof v === 'string' && v.length <= 64 && !/[;{}<>]/.test(v)) tokens[k] = v.trim();
    else if (Array.isArray(v) && v.length <= 16 && v.every((x) => typeof x === 'string' && x.length <= 64 && !/[;{}<>]/.test(x))) tokens[k] = v;
    else throw new Error(`valor inválido no token ${k}`);
  }
  const lista = temasTodos();
  const i = lista.findIndex((x) => x.id === id);
  const tema = { id, nome, base, tokens, atualizado: Date.now(), ...(i < 0 ? { criado: Date.now() } : { criado: lista[i].criado }) };
  if (i >= 0) lista[i] = tema; else lista.push(tema);
  writeJSON(ARQ_TEMAS(), { temas: lista });
  return tema;
}

// ------------------------------------------------------------ projetos (favorito/oculto)
function prefsProjetos() { return readJSON(ARQ_PROJ(), {}); }
function gravarPrefs(k, o) {
  const p = prefsProjetos();
  const atual = p[k] || {};
  if (typeof o.favorito === 'boolean') atual.favorito = o.favorito;
  if (typeof o.oculto === 'boolean') atual.oculto = o.oculto;
  atual.em = Date.now();
  p[k] = atual;
  writeJSON(ARQ_PROJ(), p);
  return atual;
}

function atividade(G, chave, { limite = 100, desde = 0 } = {}) {
  const itens = [];
  const add = (n, t, tipo, extra = {}) => { if (t >= desde) itens.push({ t: Math.round(t), tipo, id: n.id, idCurto: n.idCurto, titulo: n.titulo, autor: n.autor, fonte: n.fonte, ...extra }); };
  for (const n of G.interno.nos) {
    if (n.projeto !== chave) continue;
    if (n.tipo === 'commit') add(n, n.criado, 'commit', { hash: n.hash.slice(0, 7), mais: n.extra.mais, menos: n.extra.menos });
    else if (n.tipo === 'sessao') add(n, n.criado, n.extra.agente ? 'agente' : 'sessao', { fim: Math.round(n.modificado), duracaoMs: n.extra.duracaoMs || 0, ferramentas: n.extra.totalFerramentas || 0, pasta: n.subregiao, arquivos: (n.extra.arquivos || []).length });
    else if (n.tipo === 'nota' && n.fonte === 'diario') add(n, n.criado, 'diario', { tagsAutor: n.tagsAutor || [] });
    else if (n.tipo === 'nota' || n.tipo === 'doc') {
      add(n, n.criado, n.tipo === 'nota' ? 'nota-criada' : 'doc-criado');
      if (n.modificado - n.criado > 60000) add(n, n.modificado, n.tipo === 'nota' ? 'nota-editada' : 'doc-editado');
    }
  }
  itens.sort((a, b) => b.t - a.t);
  return { total: itens.length, itens: itens.slice(0, limite) };
}

// ------------------------------------------------------------ skills: executar e refinar
async function refinar(markdown) {
  const c = config.get();
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': config.chaveClaude(), 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: c.claude.modelo || 'claude-haiku-5-5', max_tokens: 1500,
      messages: [{ role: 'user', content: 'Reescreva este relatório em português, mais claro e direto, em markdown. Mantenha TODOS os fatos, números, datas e ids entre crases exatamente como estão. Não invente nada. Responda só com o markdown.\n\n' + markdown }],
    }),
    signal: AbortSignal.timeout(45000),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  const txt = (j.content || []).map((b) => b.text || '').join('').trim();
  if (!txt) throw new Error('resposta vazia');
  return txt;
}

function registrador(ctx) {
  return async ({ projeto: proj, titulo, texto, tags, autor, ligar }) => {
    const G = ctx.G;
    const ligacoes = [];
    for (const x of ligar || []) {
      const i = ctx.resolverId(x);
      if (i !== undefined) ligacoes.push({ id: G.interno.nos[i].id, titulo: G.interno.nos[i].titulo });
    }
    const r = diario.escrever({ projeto: proj, titulo, texto, tags, autor, ligacoes });
    const id = graph.idDe(r.chave);
    ctx.telemetry.emitir({ nivel: 'PULSO', fonte: 'diario', msg: `REGISTRO ${String(proj).toUpperCase()} · ${titulo}`.slice(0, 160), id });
    try { await ctx.aoMudar(diario.FONTE, [{ caminho: r.caminho, tipo: 'add' }]); } catch { /* o watch tenta de novo */ }
    return { id, idCurto: sha1(r.chave).slice(0, 6), caminho: r.caminho };
  };
}

// ------------------------------------------------------------ roteador
async function tratar(p, req, res, url, ctx) {
  const { json, lerCorpo } = ctx;
  const m = req.method;
  const naoPronto = () => json(res, 503, { erro: 'carregando', pronto: ctx.pronto, fase: ctx.fase() });

  // ---- config
  if (p === '/api/config' && m === 'GET') { json(res, 200, configPublica()); return true; }
  if (p === '/api/config' && m === 'POST') {
    const corpo = await lerCorpo(req);
    if (!corpo) { json(res, 400, { erro: 'JSON inválido' }); return true; }
    const r = aplicarConfig(corpo);
    if (r.erros) { json(res, 400, { erro: 'valores inválidos', erros: r.erros }); return true; }
    if (r.mudancas.length) {
      ctx.telemetry.emitir({ nivel: 'INFO', fonte: 'sistema', msg: `CONFIG ${r.mudancas.join(' ')}${r.precisaReconstruir ? ' · PRECISA RECONSTRUIR' : ''}` });
      ctx.broadcast({ tipo: 'config', config: configPublica(), mudancas: r.mudancas });
    }
    json(res, 200, { ok: true, ...r, config: configPublica() });
    return true;
  }
  if (p === '/api/config/chave') {
    if (m === 'GET') { const k = config.chaveClaude(); json(res, 200, { temChave: !!k, chave: mascarar(k) }); return true; }
    if (m === 'POST') {
      const corpo = await lerCorpo(req);
      const k = corpo && typeof corpo.chave === 'string' ? corpo.chave.trim() : '';
      if (!/^sk-[A-Za-z0-9_\-]{16,300}$/.test(k)) { json(res, 400, { erro: 'chave inválida (esperado algo como sk-ant-...)' }); return true; }
      config.gravarEnv('ANTHROPIC_API_KEY', k);
      ctx.telemetry.emitir({ nivel: 'INFO', fonte: 'sistema', msg: `CHAVE DO CLAUDE GRAVADA ${mascarar(k)}` });
      json(res, 200, { ok: true, temChave: true, chave: mascarar(k), claudeLigado: classify.claudeLigado() });
      return true;
    }
    if (m === 'DELETE') { config.gravarEnv('ANTHROPIC_API_KEY', null); json(res, 200, { ok: true, temChave: !!config.chaveClaude() }); return true; }
  }
  if (p === '/api/config/chave/testar' && m === 'POST') {
    const corpo = (await lerCorpo(req)) || {};
    const k = typeof corpo.chave === 'string' && corpo.chave.trim() ? corpo.chave.trim() : config.chaveClaude();
    json(res, 200, await testarChave(k, corpo.modelo || config.get().claude.modelo));
    return true;
  }

  // ---- temas
  if (p === '/api/temas' && m === 'GET') { json(res, 200, { temas: temasTodos(), prontos: [...TEMAS_PRONTOS] }); return true; }
  if (p === '/api/temas' && m === 'POST') {
    const corpo = await lerCorpo(req);
    try { const t = gravarTema(corpo); ctx.broadcast({ tipo: 'temas' }); json(res, 200, { ok: true, tema: t }); } catch (e) { json(res, 400, { erro: e.message }); }
    return true;
  }
  if (p.startsWith('/api/temas/') && m === 'DELETE') {
    const id = slug(p.slice('/api/temas/'.length));
    const lista = temasTodos();
    const resto = lista.filter((t) => t.id !== id);
    if (resto.length === lista.length) { json(res, 404, { erro: 'tema não encontrado' }); return true; }
    writeJSON(ARQ_TEMAS(), { temas: resto });
    ctx.broadcast({ tipo: 'temas' });
    json(res, 200, { ok: true });
    return true;
  }

  // ---- skills
  // CORTEX_HOME: pasta "home" alternativa para as skills do Claude Code (testes); padrão = home do usuário
  const op = { appDir: ctx.appDir, home: process.env.CORTEX_HOME || undefined };
  if (p === '/api/skills' && m === 'GET') {
    json(res, 200, skillsInst.listar(op).map((s) => ({ ...s, executor: !!executores.executor(s.nome) })));
    return true;
  }
  const ms = p.match(/^\/api\/skills\/([a-z0-9-]+)(?:\/(instalar|remover|executar))?$/);
  if (ms) {
    const [, nome, acao] = ms;
    if (!acao && m === 'GET') {
      const s = skillsInst.listar(op).find((x) => x.nome === nome || x.nome === 'cortex-' + nome);
      if (!s) { json(res, 404, { erro: 'skill não encontrada' }); return true; }
      const fs = require('fs');
      const conteudo = skillsInst.renderizar(fs.readFileSync(path.join(s.origem, 'SKILL.md'), 'utf8'), ctx.appDir);
      json(res, 200, { ...s, executor: !!executores.executor(s.nome), conteudo });
      return true;
    }
    if (m !== 'POST') return false;
    if (acao === 'instalar' || acao === 'remover') {
      try {
        const r = skillsInst[acao](nome, op);
        ctx.telemetry.emitir({ nivel: 'INFO', fonte: 'sistema', msg: `SKILL ${acao.toUpperCase()} ${r.resultados.map((x) => x.nome).join(' ')}` });
        json(res, 200, { ok: true, ...r, skills: skillsInst.listar(op) });
      } catch (e) { json(res, e.code === 'ENOENT' ? 404 : 500, { erro: e.message }); }
      return true;
    }
    if (acao === 'executar') {
      const ex = executores.executor(nome);
      if (!ex) { json(res, 404, { erro: `skill sem executor no app: ${nome} (executáveis: ${executores.nomes.join(', ')})` }); return true; }
      if (!ctx.G) { naoPronto(); return true; }
      const corpo = (await lerCorpo(req)) || {};
      const t0 = Date.now();
      try {
        const r = await ex.executar(ctx.G, corpo, { registrar: registrador(ctx) });
        const out = { skill: ex.nome, markdown: r.markdown, dados: r.dados, ms: Date.now() - t0, refinado: false };
        if (r.registradoEm) out.registradoEm = r.registradoEm;
        if (corpo.refinar) {
          if (!classify.claudeLigado()) out.aviso = 'refinar pedido, mas o Claude está desligado nas configurações: resultado determinístico';
          else {
            try { out.markdown = await refinar(r.markdown); out.refinado = true; out.markdownDeterministico = r.markdown; } catch (e) { out.aviso = `refinamento falhou (${e.message}): resultado determinístico`; }
          }
        }
        ctx.telemetry.emitir({ nivel: 'INFO', fonte: 'sistema', msg: `SKILL ${ex.nome.toUpperCase()} EXECUTADA${corpo.projeto ? ' · ' + String(corpo.projeto).toUpperCase() : ''} · ${out.ms} MS${out.registradoEm ? ' · NO DIÁRIO' : ''}` });
        json(res, 200, out);
      } catch (e) {
        json(res, e.status || 500, { erro: e.message, ...(e.projetos ? { projetos: e.projetos } : {}) });
      }
      return true;
    }
  }

  // ---- projetos
  const mp = p.match(/^\/api\/projetos\/([^/]+)(?:\/(atividade))?$/);
  if (mp) {
    if (!ctx.G) { naoPronto(); return true; }
    const nome = decodeURIComponent(mp[1]);
    const chave = slug(nome);
    const card = ctx.listaProjetos().find((x) => x.slug === chave);
    if (!card) { json(res, 404, { erro: `projeto "${nome}" não encontrado` }); return true; }
    if (!mp[2] && m === 'GET') { json(res, 200, card); return true; }
    if (!mp[2] && m === 'POST') {
      const corpo = await lerCorpo(req);
      if (!corpo || (typeof corpo.favorito !== 'boolean' && typeof corpo.oculto !== 'boolean')) { json(res, 400, { erro: 'envie { favorito?: boolean, oculto?: boolean }' }); return true; }
      gravarPrefs(chave, corpo);
      const novo = ctx.listaProjetos().find((x) => x.slug === chave);
      ctx.broadcast({ tipo: 'projetos', projeto: novo });
      json(res, 200, { ok: true, projeto: novo });
      return true;
    }
    if (mp[2] === 'atividade' && m === 'GET') {
      const limite = Math.max(1, Math.min(2000, parseInt(url.searchParams.get('limite'), 10) || 100));
      const desdeQ = url.searchParams.get('desde');
      const desde = desdeQ ? require('./visoes').tempo(desdeQ) || 0 : 0;
      json(res, 200, { projeto: card.nome, ...atividade(ctx.G, chave, { limite, desde }) }, req);
      return true;
    }
  }
  return false;
}

module.exports = { tratar, prefsProjetos, configPublica };
