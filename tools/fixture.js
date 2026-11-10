// Fixture de DESENVOLVIMENTO da interface: lê arquivos reais (cofre + git + sessões)
// e grava no formato do CONTRATO.md. Só é usado por tools/devserver.js.
const fs = require('fs'), path = require('path'), cp = require('child_process'), crypto = require('crypto');
const VAULT = process.argv[2] || '/home/claude/testdata/obsidian-help';
const SESS = process.argv[3] || path.join(require('os').homedir(), '.claude/projects');
const OUT = path.join(__dirname, '.fixture.json');
const h = s => crypto.createHash('sha1').update(s).digest('hex');
const nos = [], idx = new Map(), sin = [];
function add(key, n) { if (idx.has(key)) return idx.get(key); const id = h(key).slice(0, 16); n.id = id; n.idCurto = id.slice(0, 6); n.tags = n.tags || []; n.grau = 0; n.cluster = 0; nos.push(n); idx.set(key, nos.length - 1); return nos.length - 1; }
function walk(d, out = []) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { if (f.name.startsWith('.')) continue; const p = path.join(d, f.name); f.isDirectory() ? walk(p, out) : f.name.endsWith('.md') && out.push(p); } return out; }
const files = walk(VAULT); const byName = new Map();
for (const f of files) {
  const rel = path.relative(VAULT, f); const top = rel.includes('/') ? rel.split('/')[0] : 'raiz';
  const st = fs.statSync(f); const txt = fs.readFileSync(f, 'utf8');
  const i = add('nota:' + rel, { tipo: 'nota', fonte: 'obsidian', titulo: path.basename(f, '.md'), regiao: 'r_' + top.toLowerCase().replace(/\W+/g, '-'), subregiao: rel.split('/').slice(0, 2).join('/'), criado: st.mtimeMs, modificado: st.mtimeMs, palavras: txt.split(/\s+/).length, autor: 'EU', hash: h(txt).slice(0, 12), caminho: f, _txt: txt });
  byName.set(path.basename(f, '.md').toLowerCase() + '|' + top, i);
}
for (const n of nos.slice()) { const top = n.regiao; for (const m of n._txt.matchAll(/(!?)\[\[([^\]|#]+)/g)) { const t = byName.get(m[2].trim().toLowerCase() + '|' + top.slice(2)); if (t != null) sin.push({ a: idx.get('nota:' + path.relative(VAULT, n.caminho)), b: t, tipo: m[1] ? 'EMBED' : 'LINK', peso: .6 }); } }
// git
const log = cp.execSync(`git -C "${VAULT}" log --numstat --format='@@%H|%an|%at|%P|%s' -n 1500`, { maxBuffer: 1e9 }).toString();
let cur = null; const commits = [];
for (const l of log.split('\n')) { if (l.startsWith('@@')) { const [H, an, at, P, ...s] = l.slice(2).split('|'); cur = { H, an, at: +at * 1000, P: P.split(' ').filter(Boolean), s: s.join('|'), f: [] }; commits.push(cur); } else if (l.trim() && cur) { const [a, d, ...p] = l.split('\t'); cur.f.push([+a || 0, +d || 0, p.join('\t').replace(/^"|"$/g, '')]); } }
for (const c of commits) { const lin = c.f.reduce((s, x) => s + x[0] + x[1], 0); add('commit:' + c.H, { tipo: 'commit', fonte: 'git', titulo: c.s, regiao: 'r_git', subregiao: 'main', criado: c.at, modificado: c.at, palavras: lin, autor: c.an.toUpperCase(), hash: c.H.slice(0, 12), caminho: null }); }
for (const c of commits) { const i = idx.get('commit:' + c.H); for (const p of c.P) if (idx.has('commit:' + p)) sin.push({ a: i, b: idx.get('commit:' + p), tipo: 'PAI', peso: .9 }); for (const [a, d, p] of c.f.slice(0, 6)) { const t = idx.get('nota:' + p); if (t != null) { nos[t].criado = Math.min(nos[t].criado, c.at); nos[t].modificado = Math.max(c.at, nos[t].modificado === nos[t]._m0 ? 0 : nos[t].modificado); } if (t != null) sin.push({ a: i, b: t, tipo: 'TOCA', peso: Math.min(1, (a + d) / 60) }); } }
// sessões
for (const dir of fs.existsSync(SESS) ? fs.readdirSync(SESS) : []) for (const f of fs.readdirSync(path.join(SESS, dir)).filter(x => x.endsWith('.jsonl'))) {
  const L = fs.readFileSync(path.join(SESS, dir, f), 'utf8').split('\n').filter(Boolean).map(x => { try { return JSON.parse(x) } catch { return null } }).filter(Boolean);
  const ts = L.map(x => Date.parse(x.timestamp)).filter(Boolean); if (!ts.length) continue; let tools = 0;
  for (const x of L) for (const c of (x.message && Array.isArray(x.message.content) ? x.message.content : [])) if (c.type === 'tool_use') tools++;
  add('sessao:' + f, { tipo: 'sessao', fonte: 'claude', titulo: 'SESSÃO ' + f.slice(0, 8), regiao: 'r_sessoes', subregiao: dir, criado: Math.min(...ts), modificado: Math.max(...ts), palavras: L.length, autor: 'CLAUDE CODE', hash: f.slice(0, 12), caminho: path.join(SESS, dir, f), _tools: tools });
}
for (const n of nos) { if (!isFinite(n.criado)) n.criado = Date.now(); if (!isFinite(n.modificado)) n.modificado = n.criado; }
// dias
const dia = t => { try { return new Date(t).toISOString().slice(0, 10) } catch { console.error("bad", t); return "1970-01-01" } };
const dias = [...new Set(nos.map(n => dia(n.criado)))].sort();
const di = new Map(dias.map(d => [d, add('dia:' + d, { tipo: 'dia', fonte: 'sistema', titulo: d, regiao: 'r_tronco', subregiao: 'espinha', criado: Date.parse(d), modificado: Date.parse(d), palavras: 0, autor: 'SISTEMA', hash: h(d).slice(0, 12), caminho: null })]));
for (let i = 0; i < nos.length; i++) if (nos[i].tipo === 'commit' || nos[i].tipo === 'sessao') sin.push({ a: i, b: di.get(dia(nos[i].criado)), tipo: 'DIA', peso: .15 });
for (let i = 1; i < dias.length; i++) sin.push({ a: di.get(dias[i - 1]), b: di.get(dias[i]), tipo: 'SEQ', peso: 1 });
// regiões + layout em forma de cérebro
function rng(s) { let x = parseInt(h(s).slice(0, 8), 16); return () => (x = (x * 1664525 + 1013904223) >>> 0) / 4294967296; }
const reg = new Map(); for (const n of nos) { if (!reg.has(n.regiao)) reg.set(n.regiao, []); reg.get(n.regiao).push(n); }
const cortex = [...reg.keys()].filter(r => r !== 'r_tronco').sort((a, b) => reg.get(b).length - reg.get(a).length);
const regioes = []; const now = Date.now();
cortex.forEach((r, k) => {
  const hem = k % 2 ? 1 : -1; const j = Math.floor(k / 2), m = Math.ceil(cortex.length / 2);
  const th = -2.4 + 4.8 * (j + .5) / m; // ângulo frente→trás
  const ph = .5 + .5 * Math.sin(k * 2.3);
  const dir = [Math.cos(ph) * .8 * hem + .2 * hem, Math.sin(ph) * .9, Math.cos(th) * .9];
  const list = reg.get(r).sort((a, b) => a.criado - b.criado); const sp = .25 + .45 * Math.sqrt(list.length / nos.length);
  list.forEach((n, q) => { const R = rng(n.id); let v = [dir[0] + (R() - .5) * sp * 2, dir[1] + (R() - .5) * sp * 2, dir[2] + (R() - .5) * sp * 2.4]; v[0] = hem * Math.max(.08, Math.abs(v[0])); const L = Math.hypot(...v); v = v.map(x => x / L);
    const depth = .55 + .45 * (q / list.length) ** .7; const g = 1 + .05 * Math.sin(v[0] * 23) * Math.sin(v[1] * 19) * Math.sin(v[2] * 17);
    n.pos = [hem * 30 + v[0] * 470 * depth * g, 60 + v[1] * 320 * depth * g * (v[1] < 0 ? .7 : 1), v[2] * 420 * depth * g]; });
  const c = list.reduce((s, n) => s.map((x, i) => x + n.pos[i] / list.length), [0, 0, 0]);
  regioes.push({ id: r, nome: r.slice(2).toUpperCase(), serial: 'RG-' + String(k + 1).padStart(4, '0'), hemisferio: hem < 0 ? 'E' : 'D', centro: c, neuronios: list.length, sinapses: 0, ultimoPulso: Math.max(...list.map(n => n.modificado)), atividade7d: [0, 0, 0, 0, 0, 0, 0], subregioes: [] });
});
dias.forEach((d, i) => { const n = nos[di.get(d)]; const t = i / Math.max(1, dias.length - 1); n.pos = [Math.sin(i * .7) * 6, -900 + t * 760, -60 + Math.cos(i * .5) * 6 - t * 30]; });
regioes.push({ id: 'r_tronco', nome: 'TRONCO / ESPINHA', serial: 'RG-0000', hemisferio: 'TRONCO', centro: [0, -500, -70], neuronios: dias.length, sinapses: 0, ultimoPulso: Date.parse(dias.at(-1)), atividade7d: [0, 0, 0, 0, 0, 0, 0], subregioes: [] });
for (const s of sin) { nos[s.a].grau++; nos[s.b].grau++; for (const r of regioes) if (r.id === nos[s.a].regiao) r.sinapses++; }
for (const n of nos) { n.orfao = n.grau === 0; n.cluster = parseInt(n.hash.slice(0, 2), 16) % 9; const ag = (now - n.modificado) / 864e5; if (ag < 7) { const r = regioes.find(x => x.id === n.regiao); r.atividade7d[6 - Math.floor(ag)]++; } n.tags = [n.tipo.toUpperCase(), n.subregiao.split('/').pop().toLowerCase().slice(0, 14)]; }
const conteudo = {}; for (const n of nos) { conteudo[n.id] = n._txt ? n._txt.slice(0, 20000) : n._tools != null ? `ferramentas: ${n._tools}` : n.titulo; delete n._txt; delete n._tools; }
const cont = { notas: nos.filter(n => n.tipo === 'nota').length, commits: commits.length, linhas: commits.reduce((s, c) => s + c.f.reduce((a, x) => a + x[0] + x[1], 0), 0), sessoes: nos.filter(n => n.tipo === 'sessao').length, horasIA: 1.2, neuronios: nos.length, sinapses: sin.length, arquivos: files.length, regioes: regioes.length, ferramentas: 64 };
fs.writeFileSync(OUT, JSON.stringify({ grafo: { versao: 1, geradoEm: now, regioes, nos, sinapses: sin, dias, contadores: cont, fontes: [{ id: 'src_dev', tipo: 'obsidian', caminho: VAULT, projeto: 'obsidian-help', status: 'OK', itens: files.length }, { id: 'src_dev2', tipo: 'git', caminho: VAULT, projeto: 'obsidian-help', status: 'OK', itens: commits.length }, { id: 'src_dev3', tipo: 'claude', caminho: SESS, status: 'OK', itens: cont.sessoes }] }, conteudo }));
console.log('fixture', nos.length, 'nós', sin.length, 'sinapses', regioes.length, 'regiões');
