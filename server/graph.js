'use strict';
// Monta o grafo público (contrato) a partir das leituras de cada fonte.
const path = require('path');
const { sha1, normPath, baseName, dayKey, slug } = require('./util');
const layout = require('./layout');
const classify = require('./classify');

const ORDEM_TIPO = { obsidian: 0, pasta: 1, git: 2, claude: 3 };
const DIA_MS = 86400000;

function idDe(chave) { return sha1(chave).slice(0, 16); }

function juntarArquivo(v, n, porCaminho) {
  const wts = new Set([...(v.worktrees || []), ...(n.worktrees || [])]);
  v.worktrees = [...wts];
  v.extra.worktrees = v.worktrees;
  v.extra.caminhos = [...new Set([...(v.extra.caminhos || []), ...(n.extra.caminhos || [])])];
  v.extra.candidatos = [...new Set([...(v.extra.candidatos || []), ...(n.extra.candidatos || [])])];
  if (!v.caminho && n.caminho) { v.caminho = n.caminho; v.titulo = n.titulo; }
  if (n.criado < v.criado) v.criado = n.criado;
  if (n.modificado > v.modificado) v.modificado = n.modificado;
  for (const c of n.extra.candidatos || []) { const np = normPath(c); if (!porCaminho.has(np)) porCaminho.set(np, v.chave); }
}

// parciais: [{ fonte: cfg, r: resultado }]
// opcoes.descobrir(caminho) → { projeto, base } (server/projeto.js)
function montar(parciais, statusFontes, opcoes = {}) {
  const t0 = Date.now();
  const ps = parciais.filter((p) => p.r).sort((a, b) => ORDEM_TIPO[a.fonte.tipo] - ORDEM_TIPO[b.fonte.tipo]);

  // caminhos de fonte → projeto (para casar sessões do Claude com projetos)
  const caminhosProj = parciais.filter((p) => p.fonte.tipo !== 'claude')
    .map((p) => ({ n: normPath(p.fonte.caminho), projeto: p.fonte.projeto }))
    .sort((a, b) => b.n.length - a.n.length);
  function projetoDoCwd(cwd, bruto) {
    if (cwd) {
      const n = normPath(cwd);
      for (const c of caminhosProj) if (n === c.n || n.startsWith(c.n + '/')) return c.projeto;
    }
    return bruto || 'sem-projeto';
  }
  // nomes de projeto canônicos (mesmo projeto com caixa diferente cai na mesma região)
  const nomeProj = new Map();
  const canon = (p) => { const k = slug(p); if (!nomeProj.has(k)) nomeProj.set(k, p); return k; };

  // datas reais vindas do git (para notas clonadas, cujo mtime é a data do checkout)
  const datasGit = {};
  const historicoArquivos = new Map();
  for (const p of ps) if (p.r.datasArquivos) {
    Object.assign(datasGit, p.r.datasArquivos);
    for (const [k, v] of p.r.historicoArquivos) historicoArquivos.set(k, (historicoArquivos.get(k) || []).concat(v));
  }

  const nos = [];
  const porChave = new Map();
  const alias = new Map();
  const porCaminho = new Map(); // normPath -> chave (prioridade nota > arquivo > doc)
  const prioridade = { nota: 3, arquivo: 2, doc: 1 };
  const notaDocPorCaminho = new Map(); // normPath -> chave de nota/doc

  for (const p of ps) {
    const projetoFonte = p.fonte.projeto;
    // detecção de "checkout em massa": muitas notas com o mesmo mtime
    let janelaCheckout = null;
    if (p.fonte.tipo === 'obsidian' && p.r.nos.length > 20) {
      const ms = p.r.nos.map((n) => n.modificado).sort((a, b) => a - b);
      const med = ms[Math.floor(ms.length / 2)];
      const perto = ms.filter((m) => Math.abs(m - med) < 120000).length;
      if (perto / ms.length > 0.5) janelaCheckout = [med - 120000, med + 120000];
    }
    for (const n0 of p.r.nos) {
      const n = n0;
      if (n.tipo === 'doc') {
        const ja = porCaminho.get(normPath(n.caminho));
        if (ja) { alias.set(n.chave, ja); continue; }
      }
      if (n.tipo === 'nota' || n.tipo === 'doc') notaDocPorCaminho.set(normPath(n.caminho), n.chave);
      if (porChave.has(n.chave)) {
        // mesmo arquivo visto por outra fonte do projeto (worktree, clone): junta os checkouts num nó só
        const v = nos[porChave.get(n.chave)];
        if (v.tipo === 'arquivo' && n.tipo === 'arquivo') juntarArquivo(v, n, porCaminho);
        continue;
      }
      let projeto = n.projetoNota || projetoFonte;
      if (n.tipo === 'sessao') {
        if (opcoes.descobrir && n.cwd) {
          const d = opcoes.descobrir(n.cwd);
          projeto = d.projeto;
          n.subregiao = d.base || 'SESSOES'; // worktree/pasta original vira sub-setor do lobo
        } else projeto = projetoDoCwd(n.cwd, n.projetoBruto);
      }
      n.projeto = canon(projeto);
      if (n.tipo === 'nota') {
        const g = datasGit[normPath(n.caminho)];
        if (g) {
          if (n.datasDoArquivo) n.criado = g.first;
          const noCheckout = janelaCheckout && n.modificado >= janelaCheckout[0] && n.modificado <= janelaCheckout[1];
          n.modificado = noCheckout ? g.last : Math.max(g.last, n.modificado);
        }
        if (n.criado > n.modificado) n.criado = n.modificado;
      }
      porChave.set(n.chave, nos.length);
      nos.push(n);
      if (prioridade[n.tipo]) {
        const cams = n.tipo === 'arquivo' && n.extra && n.extra.candidatos ? n.extra.candidatos : [n.caminho];
        for (const c of cams) {
          if (!c) continue;
          const np = normPath(c);
          const ja = porCaminho.get(np);
          if (!ja || prioridade[nos[porChave.get(ja)].tipo] < prioridade[n.tipo]) porCaminho.set(np, n.chave);
        }
      }
    }
  }

  // arquivos do git que são notas/docs conhecidas (em qualquer checkout do projeto) viram apelido delas
  const removidos = new Set();
  for (const n of nos) {
    if (n.tipo !== 'arquivo') continue;
    for (const c of (n.extra && n.extra.candidatos) || n.extra.caminhos || [n.caminho]) {
      if (!c) continue;
      const x = notaDocPorCaminho.get(normPath(c));
      if (x) { alias.set(n.chave, x); removidos.add(n.chave); break; }
    }
  }
  if (removidos.size) {
    const resto = nos.filter((n) => !removidos.has(n.chave));
    nos.length = 0;
    porChave.clear();
    for (const n of resto) { porChave.set(n.chave, nos.length); nos.push(n); }
  }

  // regiões + correções do usuário
  const correcoes = classify.todasCorrecoes();
  for (const n of nos) {
    n.id = idDe(n.chave);
    n.idCurto = sha1(n.chave).slice(0, 6);
    let reg = 'r_' + n.projeto;
    const c = correcoes[n.id];
    if (c && c.regiao) reg = c.regiao.startsWith('r_') ? c.regiao : 'r_' + canon(c.regiao);
    n.regiao = reg;
  }

  // nós de dia (espinha)
  const contDia = new Map();
  for (const n of nos) {
    if (n.tipo === 'arquivo' || n.tipo === 'branch' || n.tipo === 'worktree') continue;
    const k = dayKey(n.criado);
    contDia.set(k, (contDia.get(k) || 0) + 1);
    n._dia = k;
  }
  const dias = [...contDia.keys()].sort();
  const idxDia = new Map();
  for (const d of dias) {
    const ini = new Date(d + 'T00:00:00').getTime();
    const chave = 'dia:' + d;
    const n = { chave, id: idDe(chave), idCurto: sha1(chave).slice(0, 6), tipo: 'dia', fonte: 'sistema', titulo: d, regiao: 'r_tronco', subregiao: 'ESPINHA',
      criado: ini, modificado: ini + DIA_MS - 1, palavras: contDia.get(d), autor: 'SISTEMA', hash: sha1(chave).slice(0, 12), caminho: null, texto: '', extra: {} };
    idxDia.set(d, nos.length);
    porChave.set(chave, nos.length);
    nos.push(n);
  }
  nomeProj.set('tronco', 'TRONCO // TEMPO');

  // ordem estável por id
  // (os índices de sinapse referem-se a esta ordem final)
  const ordemFinal = nos.map((_, i) => i).sort((a, b) => (nos[a].id < nos[b].id ? -1 : nos[a].id > nos[b].id ? 1 : 0));
  const novoIdx = new Array(nos.length);
  ordemFinal.forEach((velho, novo) => { novoIdx[velho] = novo; });
  const nosOrd = ordemFinal.map((i) => nos[i]);
  const idxDe = (chave) => {
    let k = chave;
    for (let g = 0; g < 3 && alias.has(k); g++) k = alias.get(k);
    const i = porChave.get(k);
    return i === undefined ? -1 : novoIdx[i];
  };

  const idParaIdx = new Map();
  nosOrd.forEach((n, i) => idParaIdx.set(n.id, i));

  // sinapses
  const sinapses = [];
  const vistos = new Set();
  function add(a, b, tipo, peso) {
    if (a < 0 || b < 0 || a === b) return;
    const k = a * 4194304 + b + ':' + tipo;
    if (vistos.has(k)) return;
    vistos.add(k);
    sinapses.push({ a, b, tipo, peso: Math.round(peso * 100) / 100 });
  }
  for (const p of ps) {
    for (const l of p.r.links) {
      const a = idxDe(l.de);
      let b;
      if (typeof l.para === 'string') b = idxDe(l.para);
      else if (l.para.id) b = idParaIdx.has(l.para.id) ? idParaIdx.get(l.para.id) : -1;
      else {
        const ch = porCaminho.get(normPath(l.para.caminho));
        b = ch ? idxDe(ch) : -1;
      }
      add(a, b, l.tipo, l.peso);
    }
  }
  // SEQ entre sessões consecutivas do mesmo projeto
  const sessPorProj = new Map();
  nosOrd.forEach((n, i) => { if (n.tipo === 'sessao' && !(n.extra && n.extra.agente)) { if (!sessPorProj.has(n.regiao)) sessPorProj.set(n.regiao, []); sessPorProj.get(n.regiao).push(i); } });
  for (const lista of sessPorProj.values()) {
    lista.sort((a, b) => nosOrd[a].criado - nosOrd[b].criado);
    for (let i = 1; i < lista.length; i++) add(lista[i - 1], lista[i], 'SEQ', 0.5);
  }
  // DIA + coluna da espinha
  nosOrd.forEach((n, i) => { if (n._dia) { add(i, novoIdx[idxDia.get(n._dia)], 'DIA', 0.1); delete n._dia; } });
  for (let i = 1; i < dias.length; i++) add(novoIdx[idxDia.get(dias[i - 1])], novoIdx[idxDia.get(dias[i])], 'SEQ', 0.3);

  // grau, órfãos, adjacência
  const N = nosOrd.length;
  const grau = new Int32Array(N);
  const grauReal = new Int32Array(N);
  const adj = Array.from({ length: N }, () => []);
  for (let e = 0; e < sinapses.length; e++) {
    const s = sinapses[e];
    grau[s.a]++; grau[s.b]++;
    if (s.tipo !== 'DIA') {
      grauReal[s.a]++; grauReal[s.b]++;
      if (!(s.tipo === 'SEQ' && nosOrd[s.a].tipo === 'dia')) { adj[s.a].push(s.b, s.peso); adj[s.b].push(s.a, s.peso); }
    }
  }

  // comunidades por propagação de rótulos (determinística)
  const rot = new Int32Array(N);
  for (let i = 0; i < N; i++) rot[i] = i;
  for (let it = 0; it < 12; it++) {
    let mudou = 0;
    for (let i = 0; i < N; i++) {
      const a = adj[i];
      if (!a.length) continue;
      const cont = new Map();
      for (let j = 0; j < a.length; j += 2) cont.set(rot[a[j]], (cont.get(rot[a[j]]) || 0) + a[j + 1]);
      let melhor = rot[i], mv = -1;
      for (const [r, v] of cont) if (v > mv + 1e-9 || (Math.abs(v - mv) < 1e-9 && r < melhor)) { melhor = r; mv = v; }
      if (melhor !== rot[i]) { rot[i] = melhor; mudou++; }
    }
    if (!mudou) break;
  }
  const tam = new Map();
  for (let i = 0; i < N; i++) if (adj[i].length) tam.set(rot[i], (tam.get(rot[i]) || 0) + 1);
  const renum = new Map([...tam.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([r], i) => [r, i]));

  // grau = nº de vizinhos distintos, sem contar a ligação com o dia (para nós "dia", conta tudo)
  const viz = Array.from({ length: N }, () => new Set());
  for (const s of sinapses) {
    const diaA = nosOrd[s.a].tipo === 'dia', diaB = nosOrd[s.b].tipo === 'dia';
    if (s.tipo === 'DIA') { if (diaA) viz[s.a].add(s.b); if (diaB) viz[s.b].add(s.a); continue; }
    viz[s.a].add(s.b); viz[s.b].add(s.a);
  }
  for (let i = 0; i < N; i++) {
    const n = nosOrd[i];
    n.grau = viz[i].size;
    n.orfao = (n.tipo === 'nota' || n.tipo === 'doc' || n.tipo === 'arquivo') && grauReal[i] === 0;
    n.cluster = adj[i].length ? renum.get(rot[i]) : -1;
  }

  // organização automática (tags da máquina)
  classify.classificar(nosOrd);

  const fim = finalizar(nosOrd, sinapses, (id) => nomeProj.get(id.slice(2)) || id.slice(2));

  // eventos históricos (log) com id do nó
  const eventosHist = [];
  for (const p of ps) {
    for (const e of p.r.eventos) {
      const k = e.chave ? idxDe(e.chave) : -1;
      const n = k >= 0 ? nosOrd[k] : null;
      eventosHist.push({ t: e.t, nivel: 'HIST', fonte: e.fonte, msg: e.msg, id: n ? n.id : undefined, hash: e.hash, arquivo: e.arquivo });
    }
  }
  eventosHist.sort((a, b) => a.t - b.t);

  const porId = new Map();
  nosOrd.forEach((n, i) => porId.set(n.id, i));

  return {
    publico: { versao: 0, geradoEm: Date.now(), regioes: fim.regioes, nos: fim.publicos, sinapses, dias, contadores: fim.contadores, fontes: statusFontes },
    interno: { nos: nosOrd, porId, adj, historicoArquivos, eventosHist, nomeProj, msBuild: Date.now() - t0 },
  };
}


// layout + regiões + contadores + nós públicos. Usado no grafo completo e nos recortes (visões).
// nomeRegiao(id) → nome; extras(regiaoId) → campos extras da região (ex.: projeto do lobo)
function finalizar(nosOrd, sinapses, nomeRegiao, opcoesLayout = {}, extras = null) {
  // layout
  const regIds = [...new Set(nosOrd.map((n) => n.regiao))];
  const info = layout.calcular(nosOrd, regIds, opcoesLayout);

  // regiões
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const inicio7 = hoje.getTime() - 6 * DIA_MS;
  const regioes = new Map();
  regIds.sort((a, b) => (a === 'r_tronco') - (b === 'r_tronco') || (a < b ? -1 : 1)).forEach((id, i) => {
    const inf = info.get(id) || { centro: [0, 0, 0], hemisferio: 'D' };
    const nomeBase = nomeRegiao(id);
    regioes.set(id, { id, nome: String(nomeBase).toUpperCase(), serial: 'RG-' + String(i + 1).padStart(4, '0'), hemisferio: inf.hemisferio,
      centro: inf.centro, neuronios: 0, sinapses: 0, ultimoPulso: 0, atividade7d: [0, 0, 0, 0, 0, 0, 0], ...(extras ? extras(id) : {}), _subs: new Map() });
  });
  function marcar(r, t) {
    if (t >= inicio7) { const d = Math.floor((t - inicio7) / DIA_MS); if (d >= 0 && d < 7) r.atividade7d[d]++; }
  }
  for (const n of nosOrd) {
    const r = regioes.get(n.regiao);
    r.neuronios++;
    r._subs.set(n.subregiao, (r._subs.get(n.subregiao) || 0) + 1);
    if (n.tipo !== 'dia') {
      if (n.modificado > r.ultimoPulso) r.ultimoPulso = n.modificado;
      marcar(r, n.criado);
      if (dayKey(n.modificado) !== dayKey(n.criado)) marcar(r, n.modificado);
    }
  }
  for (const s of sinapses) {
    const ra = regioes.get(nosOrd[s.a].regiao), rb = regioes.get(nosOrd[s.b].regiao);
    ra.sinapses++;
    if (rb !== ra) rb.sinapses++;
  }
  // tool_use das sessões contam como atividade
  for (const n of nosOrd) if (n.tipo === 'sessao' && n._eventos) { const r = regioes.get(n.regiao); for (const e of n._eventos) marcar(r, e.t); }

  const regioesArr = [...regioes.values()].map((r) => {
    const subregioes = [...r._subs.entries()].sort((a, b) => b[1] - a[1]).map(([nome, n]) => ({ id: r.id + '/' + slug(nome), nome, n }));
    delete r._subs;
    return { ...r, subregioes };
  });

  // contadores
  const cont = { notas: 0, commits: 0, linhas: 0, sessoes: 0, horasIA: 0, neuronios: nosOrd.length, sinapses: sinapses.length, arquivos: 0, regioes: regioesArr.length, ferramentas: 0 };
  for (const n of nosOrd) {
    if (n.tipo === 'nota') cont.notas++;
    else if (n.tipo === 'commit') { cont.commits++; cont.linhas += n.palavras; }
    else if (n.tipo === 'sessao') { if (!n.extra.agente) cont.sessoes++; cont.horasIA += n.extra.duracaoMs || 0; cont.ferramentas += n.extra.totalFerramentas || 0; }
    else if (n.tipo === 'arquivo' || n.tipo === 'doc') cont.arquivos++;
  }
  cont.horasIA = Math.round(cont.horasIA / 360000) / 10;

  const CAMPOS = ['id', 'idCurto', 'tipo', 'fonte', 'titulo', 'regiao', 'subregiao', 'pos', 'criado', 'modificado', 'palavras', 'grau', 'autor', 'hash', 'caminho', 'tags', 'cluster', 'orfao'];
  const publicos = nosOrd.map((n) => {
    const o = {};
    for (const c of CAMPOS) o[c] = n[c] === undefined ? null : n[c];
    o.criado = Math.round(o.criado || 0); o.modificado = Math.round(o.modificado || 0);
    if (n.fora) o.fora = true;
    if (n.worktrees && n.worktrees.length) o.worktrees = n.worktrees;
    if (n.tagsAutor && n.tagsAutor.length) o.tagsAutor = n.tagsAutor;
    return o;
  });
  return { regioes: regioesArr, contadores: cont, publicos, info };
}

const MAX_LOBOS = 32;

// Recorte de uma visão: filtra, puxa vizinhos (fora: true) e refaz o layout.
// Com um projeto só, as subregiões viram os lobos e ocupam o cérebro inteiro.
function recortar(G, visao) {
  const I = G.interno, P = G.publico;
  const N = I.nos.length;
  const v = visao || {};
  const projSet = v.projetos && v.projetos.length ? new Set(v.projetos.map((x) => slug(String(x).replace(/^r_/, '')))) : null;
  const fontes = v.fontes && v.fontes.length ? new Set(v.fontes) : null;
  const tipos = v.tipos && v.tipos.length ? new Set(v.tipos) : null;
  const tags = v.tags && v.tags.length ? new Set(v.tags.map((t) => String(t).toUpperCase())) : null;
  const texto = v.texto ? String(v.texto).toLowerCase() : '';
  const desde = Number(v.desde) || 0, ate = Number(v.ate) || 0, grauMin = Number(v.grauMin) || 0;
  const sel = new Uint8Array(N); // 1 = no filtro, 2 = vizinho de fora, 3 = dia
  for (let i = 0; i < N; i++) {
    const n = I.nos[i];
    if (n.tipo === 'dia') continue;
    if (projSet && !projSet.has(n.projeto) && !projSet.has(n.regiao.slice(2))) continue;
    if (fontes && !fontes.has(n.fonte)) continue;
    if (tipos && !tipos.has(n.tipo)) continue;
    if (desde && n.modificado < desde) continue;
    if (ate && n.criado > ate) continue;
    if (grauMin && n.grau < grauMin) continue;
    if (tags && !(n.tags || []).some((t) => tags.has(String(t).toUpperCase()))) continue;
    if (texto && !String(n.titulo || '').toLowerCase().includes(texto) && !String(n.caminho || '').toLowerCase().includes(texto)) continue;
    sel[i] = 1;
  }
  const saltos = Math.max(0, Math.min(2, Number(v.vizinhos) || 0));
  let fronteira = [];
  for (let i = 0; i < N; i++) if (sel[i] === 1) fronteira.push(i);
  for (let h = 0; h < saltos; h++) {
    const prox = [];
    for (const i of fronteira) {
      const a = I.adj[i];
      for (let j = 0; j < a.length; j += 2) if (!sel[a[j]] && I.nos[a[j]].tipo !== 'dia') { sel[a[j]] = 2; prox.push(a[j]); }
    }
    fronteira = prox;
  }
  if (!tipos || tipos.has('dia')) {
    for (const s of P.sinapses) {
      if (s.tipo !== 'DIA') continue;
      const na = I.nos[s.a], nb = I.nos[s.b];
      if (na.tipo === 'dia' && sel[s.b] && sel[s.b] !== 3) sel[s.a] = 3;
      else if (nb.tipo === 'dia' && sel[s.a] && sel[s.a] !== 3) sel[s.b] = 3;
    }
  }
  const novo = new Int32Array(N).fill(-1);
  const copias = [];
  for (let i = 0; i < N; i++) if (sel[i]) { novo[i] = copias.length; copias.push({ ...I.nos[i], pos: null, fora: sel[i] === 2 }); }

  // modo lobos: um projeto só no recorte
  const projs = new Set(copias.filter((n) => !n.fora && n.tipo !== 'dia').map((n) => n.regiao));
  const nomes = new Map([['r_tronco', 'TRONCO // TEMPO'], ['r_fora', 'FORA DO RECORTE']]);
  const extrasReg = new Map();
  const nomeProj = (rid) => I.nomeProj.get(rid.slice(2)) || rid.slice(2);
  if (projs.size === 1) {
    const rid = [...projs][0];
    const lobo = (n) => (n.tipo === 'sessao' ? 'SESSÕES' : n.tipo === 'branch' || n.tipo === 'worktree' ? 'BRANCHES' : n.subregiao || '/');
    const cont = new Map();
    for (const n of copias) if (!n.fora && n.tipo !== 'dia' && n.tipo !== 'arquivo') cont.set(lobo(n), (cont.get(lobo(n)) || 0) + 1);
    const ordem = [...cont.entries()].sort((a, b) => b[1] - a[1]);
    const manter = new Set(ordem.slice(0, ordem.length > MAX_LOBOS ? MAX_LOBOS - 1 : MAX_LOBOS).map((e) => e[0]));
    for (const n of copias) {
      if (n.fora || n.tipo === 'dia') continue;
      // arquivos dos repos formam um lobo só (o cerebelo); suas pastas viram sub-setores
      let l = n.tipo === 'arquivo' ? 'ARQUIVOS' : lobo(n);
      if (n.tipo !== 'arquivo' && !manter.has(l)) l = 'OUTROS';
      const id = rid + '/' + slug(l === '/' ? 'raiz' : l);
      n.regiao = id;
      if (!nomes.has(id)) { nomes.set(id, l === '/' ? 'RAIZ' : l); extrasReg.set(id, { projeto: nomeProj(rid), lobo: true }); }
    }
  }
  for (const n of copias) if (n.fora) n.regiao = 'r_fora';

  const sinapses = [];
  for (const s of P.sinapses) {
    const a = novo[s.a], b = novo[s.b];
    if (a >= 0 && b >= 0) sinapses.push({ a, b, tipo: s.tipo, peso: s.peso });
  }
  const fim = finalizar(copias, sinapses, (id) => nomes.get(id) || nomeProj(id), { lobos: projs.size === 1 }, (id) => extrasReg.get(id) || {});
  const dias = copias.filter((n) => n.tipo === 'dia').map((n) => n.titulo).sort();
  return {
    versao: P.versao, geradoEm: Date.now(), regioes: fim.regioes, nos: fim.publicos, sinapses, dias, contadores: fim.contadores,
    fontes: P.fontes, visao: visao || null, total: { neuronios: N, sinapses: P.sinapses.length },
  };
}

module.exports = { montar, finalizar, recortar, idDe };
