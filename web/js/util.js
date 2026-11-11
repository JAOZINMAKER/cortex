// utilitários de formatação e DOM
export const $ = (s, r = document) => r.querySelector(s);
export const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmtN = n => (n == null || !isFinite(n)) ? '—' : Math.round(n).toLocaleString('pt-BR');
export const fmtK = n => n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 1 : 2).replace('.', ',') + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1).replace('.', ',') + 'k' : fmtN(n);
const p2 = n => String(n).padStart(2, '0');
export const fmtData = t => { if (!t) return '—'; const d = new Date(t); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
export const fmtDataHora = t => { if (!t) return '—'; const d = new Date(t); return `${fmtData(t)} ${p2(d.getHours())}:${p2(d.getMinutes())}`; };
export const fmtMs = t => { const d = new Date(t); return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`; };
export const fmtRel = t => { if (!t) return '—'; const s = (Date.now() - t) / 1000; if (s < 0) return 'AGORA'; if (s < 60) return Math.round(s) + 'S'; if (s < 3600) return Math.round(s / 60) + 'MIN'; if (s < 86400) return Math.round(s / 3600) + 'H'; if (s < 86400 * 60) return Math.round(s / 86400) + 'D'; if (s < 86400 * 730) return Math.round(s / 86400 / 30) + 'MÊS'; return (s / 86400 / 365).toFixed(1).replace('.', ',') + 'A'; };
export const FONTE_ROT = { obsidian: 'OBS', git: 'GIT', claude: 'IA', pasta: 'PST', sistema: 'SYS', diario: 'DIÁRIO' };
export const rotFonte = n => n.diario ? 'DIÁRIO' : (FONTE_ROT[n.fonte] || String(n.fonte || '').toUpperCase());
export const TIPO_ROT = { nota: 'NOTA', commit: 'COMMIT', branch: 'BRANCH', worktree: 'WTREE', sessao: 'SESSÃO', arquivo: 'ARQ', doc: 'DOC', dia: 'DIA' };
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export function spark(vals, w = 56, h = 12) {
  const m = Math.max(1, ...vals); const bw = w / vals.length;
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` + vals.map((v, i) => { const bh = Math.max(1, (v / m) * h); return `<rect x="${(i * bw).toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${(bw - 1).toFixed(1)}" height="${bh.toFixed(1)}" class="sp${i === vals.length - 1 ? ' u' : ''}"/>`; }).join('') + '</svg>';
}
export function hash6(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).padStart(8, '0').slice(0, 6); }
