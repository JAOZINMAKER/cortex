// Acesso a dados das páginas (projetos, diário, skills, configurações) com cache simples.
export async function obter(url, opt) { const r = await fetch(url, opt); if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; try { e.corpo = await r.json(); } catch {} throw e; } const ct = r.headers.get('content-type') || ''; return ct.includes('json') ? r.json() : r.text(); }
export async function enviar(url, corpo, metodo = 'POST') { return obter(url, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: corpo == null ? undefined : JSON.stringify(corpo) }); }
const DIA = 864e5;
let gTudo = null, gVer = -1, gProm = null;
// grafo completo (sem visão) para estatísticas e silhuetas dos projetos
export async function grafoTudo(app) {
  if (app.g && !app.g.visao && (!app.visoes || app.visoes.atual.id === 'tudo')) { gTudo = app.g; gVer = app.g.versao; return gTudo; }
  if (gTudo && app.g && gVer === app.g.versao) return gTudo;
  if (!gProm) gProm = obter('/api/graph').then(g => { gTudo = g; gVer = g.versao; gProm = null; return g; }).catch(e => { gProm = null; throw e; });
  return gProm;
}
export const projDe = n => n.projeto || String(n.regiao || '').replace(/^r_/, '').split('/')[0];
// estatísticas por projeto a partir do grafo completo
export function estatisticas(g) {
  const m = new Map(); const agora = Date.now(); const ini = agora - 30 * DIA;
  const b = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity, y0: Infinity, y1: -Infinity };
  for (const n of g.nos) { if (n.tipo === 'dia') continue; const p = n.pos; b.x0 = Math.min(b.x0, p[0]); b.x1 = Math.max(b.x1, p[0]); b.z0 = Math.min(b.z0, p[2]); b.z1 = Math.max(b.z1, p[2]); b.y0 = Math.min(b.y0, p[1]); b.y1 = Math.max(b.y1, p[1]); }
  for (const n of g.nos) {
    if (n.tipo === 'dia') continue; const k = projDe(n);
    let o = m.get(k); if (!o) m.set(k, o = { nome: k, neuronios: 0, notas: 0, commits: 0, sessoes: 0, diario: 0, horasIA: 0, ultimoPulso: 0, d30: new Array(30).fill(0), pts: [], regiao: n.regiao, pcs: new Map() });
    o.neuronios++; for (const pc of (n.maquinas && n.maquinas.length ? n.maquinas : n.maquina ? [n.maquina] : [])) o.pcs.set(pc, (o.pcs.get(pc) || 0) + 1); if (n.tipo === 'nota') o.notas++; if (n.tipo === 'commit') o.commits++; if (n.tipo === 'sessao') { o.sessoes++; o.horasIA += Math.max(0, Math.min(12 * 3600e3, (n.modificado || 0) - (n.criado || 0))) / 3600e3; } if (n.fonte === 'diario' || n.diario) o.diario++;
    const t = n.modificado || n.criado; o.ultimoPulso = Math.max(o.ultimoPulso, t || 0); if (t >= ini) o.d30[Math.min(29, Math.floor((t - ini) / DIA))]++;
    if (o.pts.length < 900 || Math.random() < 900 / o.neuronios) o.pts.push(n.pos);
  }
  return { porProjeto: m, caixa: b };
}
// silhueta do cérebro (vista de cima) com o projeto em destaque
export function silhueta(cv, est, nome, cores) {
  const d = Math.min(devicePixelRatio, 2); const W = cv.clientWidth || 120, H = cv.clientHeight || 90; cv.width = W * d; cv.height = H * d; const c = cv.getContext('2d'); c.scale(d, d);
  c.fillStyle = cores.fundo; c.fillRect(0, 0, W, H); const b = est.caixa; const s = Math.min((W - 10) / (b.x1 - b.x0), (H - 10) / (b.z1 - b.z0));
  const X = x => W / 2 + (x - (b.x0 + b.x1) / 2) * s, Z = z => H / 2 - (z - (b.z0 + b.z1) / 2) * s;
  c.fillStyle = cores.apagado; for (const [k, o] of est.porProjeto) if (k !== nome) for (let i = 0; i < o.pts.length; i += 3) { const p = o.pts[i]; c.fillRect(X(p[0]), Z(p[2]), 1, 1); }
  const o = est.porProjeto.get(nome); if (o) { c.fillStyle = cores.texto; for (const p of o.pts) c.fillRect(X(p[0]) - 0.5, Z(p[2]) - 0.5, 1.5, 1.5); }
  c.strokeStyle = cores.linha; c.strokeRect(0.5, 0.5, W - 1, H - 1);
}
export function barras(vals, w = 120, h = 18) {
  const m = Math.max(1, ...vals); const bw = w / vals.length;
  return `<svg class="barras" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${vals.map((v, i) => { const bh = v ? Math.max(1.5, v / m * h) : 0.6; return `<rect x="${(i * bw).toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${Math.max(0.8, bw - 1).toFixed(1)}" height="${bh.toFixed(1)}" class="${i === vals.length - 1 ? 'u' : v ? '' : 'z'}"/>`; }).join('')}</svg>`;
}
