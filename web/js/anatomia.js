// Espelho da forma anatômica de server/layout.js (mesmas constantes e fórmulas).
// Só desenha o tecido de fundo; as posições dos neurônios vêm sempre do servidor.
// Se mudar a forma em server/layout.js, mude aqui também.
export const HEMI = { cx: 262, cy: 110, rx: 248, ryTopo: 300, ryBase: 205, rz: 410 };
export const CEREBELO = { cx: 0, cy: -175, cz: -285, rx: 235, ry: 105, rz: 135 };
export const TRONCO = { topo: -40, base: -430, zTopo: -40, zBase: -120, rTopo: 58, rBase: 34 };
export const ESPINHA = { topo: -430, base: -920, r: 24 };
export const ALFA_MIN = -0.5, ALFA_MAX = 2.45;

export function giros(u, a, s) {
  return 1 + 0.038 * Math.sin(u * 41 + a * 7.3 + s * 1.7) * Math.cos(a * 11.2 - u * 23) + 0.022 * Math.sin(u * 97 + a * 29 + s) + 0.012 * Math.cos(u * 173 - a * 53);
}
export function pontoCortex(s, u, a, prof) {
  const uu = 0.03 + u * 0.94; const zN = 1 - 2 * uu; const k = Math.max(0.16, Math.sqrt(1 - zN * zN)); const z = HEMI.rz * zN;
  const ry = Math.cos(a) >= 0 ? HEMI.ryTopo : HEMI.ryBase;
  const temporal = a > 1.6 ? 1 + 0.12 * Math.exp(-Math.pow((zN - 0.15) / 0.35, 2)) : 1;
  const cy = HEMI.cy + 35 * zN - (a > 1.9 ? 40 * Math.exp(-Math.pow((zN - 0.1) / 0.4, 2)) : 0);
  const gv = giros(uu, a, s); const g = gv * (1 - prof);
  return { p: [s * HEMI.cx + s * HEMI.rx * k * Math.sin(a) * g * temporal, cy + ry * k * Math.cos(a) * g, z * (0.9 + 0.1 * g)], g: gv };
}
export function pontoCerebelo(v, phi, prof) {
  const xN = 2 * v - 1; const k = Math.max(0.2, Math.sqrt(1 - xN * xN * 0.92));
  const folia = 1 + 0.06 * Math.sin(phi * 26 + v * 3) + 0.02 * Math.sin(phi * 61); const f = folia * (1 - prof);
  const xs = CEREBELO.rx * xN * 0.97 + Math.sign(xN || 1) * 8;
  return { p: [xs, CEREBELO.cy + CEREBELO.ry * k * Math.cos(phi) * f, CEREBELO.cz + CEREBELO.rz * k * Math.sin(phi) * f * -1], f: folia };
}
export function pontoEspinha(t, r01, ang) {
  const y = ESPINHA.base + t * (TRONCO.topo - ESPINHA.base); let raio, zc;
  if (y >= TRONCO.base) { const q = (y - TRONCO.base) / (TRONCO.topo - TRONCO.base); raio = TRONCO.rBase + (TRONCO.rTopo - TRONCO.rBase) * q; zc = TRONCO.zBase + (TRONCO.zTopo - TRONCO.zBase) * q; }
  else { const q = (y - ESPINHA.base) / (ESPINHA.topo - ESPINHA.base); raio = ESPINHA.r; zc = TRONCO.zBase - 45 * Math.sin(q * Math.PI) - 20 * (1 - q); }
  const rr = raio * r01; return [Math.cos(ang) * rr, y, zc + Math.sin(ang) * rr];
}
