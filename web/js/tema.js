// Sistema de temas do CÓRTEX: a ÚNICA fonte de cor do app inteiro.
// CSS lê variáveis aplicadas no :root; canvas, SVG e shaders leem daqui e refazem ao trocar.
// Troca: Ctrl+K → "tema", tecla T, ?tema=nome, lembrado em localStorage. Padrão: grafite.

export const TEMAS = {
  grafite: {
    nome: 'GRAFITE', desc: 'Industrial quente, painel de instrumento',
    ui: { fundo: '#0c0c0b', painel: '#141413', grade: '#22211e', linha: '#33312c', texto: '#ece8df', cinza: '#8f8a80', apagado: '#55524b', acento: '#ff6a2b', maquina: '#9fb4c7', alerta: '#ff6a2b' },
    d3: { obsidian: '#ece8df', git: '#ff6a2b', claude: '#9fb4c7', pasta: '#8f8a80', dia: '#7a3a1e', diario: '#b8b4c4' },
    clusters: ['#ece8df', '#ff6a2b', '#9fb4c7', '#c9b48a', '#7d8f7a', '#b07a5a', '#6f7f96', '#d9d2c3'],
  },
  ambar: {
    nome: 'ÂMBAR', desc: 'Fósforo CRT monocromático',
    ui: { fundo: '#0a0806', painel: '#120e0a', grade: '#241c13', linha: '#3a2d1e', texto: '#f3d9b1', cinza: '#a08560', apagado: '#5e4c36', acento: '#ffa23a', maquina: '#ffd58a', alerta: '#ff5a36' },
    d3: { obsidian: '#f3d9b1', git: '#ffa23a', claude: '#ffd58a', pasta: '#a08560', dia: '#6b3d14', diario: '#ffcd84' },
  },
  mono: {
    nome: 'MONO', desc: 'Cinzas puros, um acento verde-ácido',
    ui: { fundo: '#0a0a0a', painel: '#121212', grade: '#202020', linha: '#303030', texto: '#f0f0f0', cinza: '#8c8c8c', apagado: '#4d4d4d', acento: '#c8f53c', maquina: '#d8d8d8', alerta: '#ff4d4d' },
    d3: { obsidian: '#f0f0f0', git: '#c8f53c', claude: '#a8a8a8', pasta: '#6a6a6a', dia: '#4f6620', diario: '#e1cfc1' },
  },
  violeta: {
    nome: 'VIOLETA', desc: 'Frio e elegante',
    ui: { fundo: '#0b0a10', painel: '#12111a', grade: '#211f2e', linha: '#322f45', texto: '#ecebf5', cinza: '#8d8aa3', apagado: '#514e66', acento: '#8f7cff', maquina: '#c9c2ff', alerta: '#ff5d73' },
    d3: { obsidian: '#ecebf5', git: '#8f7cff', claude: '#c9c2ff', pasta: '#8d8aa3', dia: '#3c3170', diario: '#d5bee0' },
  },
};
export const NOMES = Object.keys(TEMAS);
const PADRAO = 'grafite', CHAVE = 'cortex.tema';

// ---------------------------------------------------------------- utilidades de cor
export const rgb = h => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
export const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const esc = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
export const hex = c => '#' + c.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('');
export const rgba = (h, a) => { const c = rgb(h); return `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`; };
// gradiente apagado → texto → acento (calor, idade)
export function gradiente(t, T = atual()) { const a = rgb(T.ui.apagado), b = rgb(T.ui.texto), c = rgb(T.ui.acento); return t < 0.6 ? mix(a, b, t / 0.6) : mix(b, c, (t - 0.6) / 0.4); }

// clusters: os temas sem lista própria derivam 8 tons dos seus tokens
function clustersDe(T) {
  if (T.clusters) return T.clusters;
  const u = T.ui; const t = rgb(u.texto), a = rgb(u.acento), m = rgb(u.maquina), c = rgb(u.cinza);
  return [u.texto, u.acento, u.maquina, hex(mix(t, a, 0.45)), hex(mix(m, c, 0.5)), hex(mix(a, c, 0.55)), hex(mix(t, c, 0.5)), hex(mix(m, t, 0.5))];
}

// ---------------------------------------------------------------- 3D derivado
function derivar3d(T) {
  const u = T.ui, d = { ...T.d3, ...sobreFonte }; const fundo = rgb(u.fundo), tx = rgb(u.texto), ac = rgb(u.acento), cz = rgb(u.cinza);
  const git = rgb(d.git);
  return {
    fundo,
    fonte: { obsidian: rgb(d.obsidian), git: mix(git, cz, 0.35), claude: rgb(d.claude), pasta: rgb(d.pasta), diario: rgb(d.diario || u.maquina), sistema: rgb(d.dia) },
    // massas grandes de git (arquivos e commits) atenuadas para não virar mancha
    tipo: { arquivo: mix(mix(git, cz, 0.6), fundo, 0.55), commit: mix(git, cz, 0.45), branch: git, worktree: git, dia: rgb(d.dia) },
    sinapse: { LINK: mix(tx, cz, 0.35), EMBED: tx, PAI: mix(mix(git, cz, 0.5), fundo, 0.3), TOCA: mix(mix(git, cz, 0.55), fundo, 0.5), SEQ: rgb(u.maquina), DIA: mix(rgb(d.dia), fundo, 0.3), BRANCH: git, TAG: cz },
    flash: ac, nascimento: tx, destaque: ac, pulso: { PULSO: tx, ALERTA: ac, HIST: cz, INFO: rgb(u.maquina) },
    tecido: mix(cz, tx, 0.3), fissura: mix(ac, cz, 0.55), grade: mix(cz, fundo, 0.2), eixoX: mix(ac, fundo, 0.45), eixoY: cz, eixoZ: mix(rgb(u.maquina), fundo, 0.4),
    clusters: clustersDe(T).map(rgb), orfao: rgb(u.alerta), caminho: tx,
  };
}

// ---------------------------------------------------------------- estado
let sobreFonte = {}; // cores por fonte escolhidas nos AJUSTES, sobrepondo o tema
let nomeAtual = PADRAO; let T = TEMAS[PADRAO]; let D3 = derivar3d(T); const ouvintes = new Set();
export const atual = () => T;
export const nome = () => nomeAtual;
export const d3 = () => D3;
export const ui = () => T.ui;
export function aoTrocar(fn) { ouvintes.add(fn); return () => ouvintes.delete(fn); }

function aplicarCss() {
  const r = document.documentElement.style; const u = T.ui;
  for (const k in u) r.setProperty('--' + k, u[k]);
  // variações translúcidas usadas pelo CSS
  r.setProperty('--fundo-90', rgba(u.fundo, 0.9)); r.setProperty('--fundo-80', rgba(u.fundo, 0.8)); r.setProperty('--fundo-60', rgba(u.fundo, 0.6)); r.setProperty('--fundo-40', rgba(u.fundo, 0.4));
  r.setProperty('--acento-15', rgba(u.acento, 0.15)); r.setProperty('--maquina-30', rgba(u.maquina, 0.3)); r.setProperty('--texto-03', rgba(u.texto, 0.025));
  const d = { ...T.d3, ...sobreFonte }; for (const k of ['obsidian', 'git', 'claude', 'pasta', 'dia', 'diario']) r.setProperty('--d3-' + k, d[k]);
  document.documentElement.dataset.tema = nomeAtual;
  const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = u.fundo;
}
export function aplicar(n, lembrar = true) {
  if (!TEMAS[n]) n = PADRAO; nomeAtual = n; T = TEMAS[n]; D3 = derivar3d(T); aplicarCss();
  if (lembrar) { try { localStorage.setItem(CHAVE, n); } catch {} }
  for (const f of ouvintes) { try { f(T, n); } catch (e) { console.warn('tema', e); } }
  return n;
}
export function coresFonte(c) { sobreFonte = {}; for (const k in c || {}) if (/^#[0-9a-f]{6}$/i.test(c[k] || '')) sobreFonte[k] = c[k]; return aplicar(nomeAtual, false); }
export const corFonte = k => ({ ...T.d3, ...sobreFonte })[k];
export function ciclar() { return aplicar(NOMES[(NOMES.indexOf(nomeAtual) + 1) % NOMES.length]); }
export function iniciar() {
  let n = null; try { n = new URLSearchParams(location.search).get('tema'); } catch {}
  if (!n || !TEMAS[n]) { try { n = localStorage.getItem(CHAVE); } catch { n = null; } }
  aplicar(TEMAS[n] ? n : PADRAO, false);
}
iniciar(); // aplica antes de qualquer desenho
