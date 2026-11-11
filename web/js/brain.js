// Cena WebGL do cérebro: neurônios, sinapses, pulsos, tecido anatômico e grade.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { pontoCortex, pontoCerebelo, pontoEspinha, ALFA_MIN, ALFA_MAX } from './anatomia.js';

import * as tema from './tema.js';
import { tela } from './util.js';
const DIA = 864e5;

const VS_NO = `
attribute vec3 aCor; attribute vec3 aCor2; attribute float aTam; attribute float aCriado; attribute float aRec;
attribute float aNasc; attribute float aFlash; attribute float aEst; attribute vec3 aPos0; attribute float aModo;
uniform float uTempo, uNascDur, uRelogio, uPx, uMix, uGanho, uDist, uExpo, uBrilho, uTamMul, uTrans; uniform vec3 uOrigem, uCorFlash, uCorNasc;
varying vec3 vCor;
void main(){
  float idade = uTempo - aCriado;
  if (idade < 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vCor = vec3(0.0); return; }
  float s = clamp(idade / uNascDur, 0.0, 1.0);
  if (aNasc > 0.0) s = min(s, clamp((uRelogio - aNasc) / 1.8, 0.0, 1.0));
  float e = 1.0 - pow(1.0 - s, 3.0);
  // transição de visão: quem fica voa da posição antiga; quem sai some; quem entra aparece
  float te = uTrans < 0.5 ? 4.0 * uTrans * uTrans * uTrans : 1.0 - pow(-2.0 * uTrans + 2.0, 3.0) / 2.0;
  float vis = aModo > 1.5 ? smoothstep(0.35, 1.0, uTrans) : (aModo > 0.5 ? 1.0 - smoothstep(0.0, 0.55, uTrans) : 1.0);
  if (vis < 0.002) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vCor = vec3(0.0); return; }
  vec3 p = mix(uOrigem, mix(aPos0, position, te), e);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float sz = aTam * uTamMul * (0.5 + 0.5 * vis) * (0.4 + 0.6 * uExpo) * (1.0 + aFlash * 2.2) * (1.0 + (1.0 - e) * 2.0);
  gl_PointSize = clamp(sz * uPx / -mv.z, 1.0, 20.0);
  vec3 c = mix(aCor, aCor2, uMix);
  float prof = clamp(1.35 - (-mv.z - uDist) / uDist * 1.1, 0.3, 1.4);
  vCor = c * (0.3 + 0.7 * aRec) * aEst * uGanho * uBrilho * vis * prof * (0.5 + 0.5 * uExpo) + uCorFlash * aFlash * 0.85 + uCorNasc * (1.0 - e) * 0.6;
}`;
const FS_NO = `
varying vec3 vCor;
void main(){
  vec2 q = abs(gl_PointCoord - 0.5) * 2.0; float m = max(q.x, q.y);
  if (m > 0.5) discard;
  float aro = step(0.34, m) * 0.35;
  gl_FragColor = vec4(min(vCor * (1.0 - aro), vec3(1.0)), 1.0);
}`;
const VS_SIN = `
attribute vec3 aCor; attribute float aA; attribute float aCriado; attribute float aDest;
uniform float uTempo, uNascDur, uFocoAtivo, uAlcance, uMul, uGanhoS, uDist, uZoom, uExpo, uBrilhoS, uTransS; uniform vec3 uFoco, uCorDest;
varying vec3 vC; varying float vA;
void main(){
  float idade = uTempo - aCriado;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  if (idade < 0.0) { vA = 0.0; vC = vec3(0.0); return; }
  float s = clamp(idade / uNascDur, 0.0, 1.0);
  float perto = uFocoAtivo * (1.0 - smoothstep(0.0, uAlcance, distance(position, uFoco)));
  float prof = clamp(1.3 - (-mv.z - uDist) / uDist * 1.2, 0.2, 1.4);
  vA = aA * s * uMul * uGanhoS * uBrilhoS * uTransS * uZoom * uExpo * prof * (1.0 - uFocoAtivo * 0.88 + perto * 1.2) + aDest * 0.38;
  vec3 c = mix(aCor, uCorDest, min(aDest, 1.0) * 0.4);
  float l = dot(c, vec3(0.299, 0.587, 0.114)); vC = mix(vec3(l), c, 0.7); // menos saturação no aditivo
}`;
const FS_SIN = `varying vec3 vC; varying float vA; void main(){ if (vA < 0.002) discard; gl_FragColor = vec4(vC * vA, 1.0); }`;
const VS_PT = `attribute vec3 aCor; attribute float aTam; uniform float uPx; varying vec3 vC;
void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(aTam * uPx / -mv.z, 1.0, 40.0); vC = aCor; }`;
const FS_PT = `varying vec3 vC; void main(){ vec2 q = abs(gl_PointCoord - 0.5) * 2.0; float m = max(q.x, q.y); float l = dot(vC, vec3(0.299, 0.587, 0.114)); gl_FragColor = vec4(mix(vec3(l), vC, 0.75) * (1.0 - smoothstep(0.3, 1.0, m)), 1.0); }`;

function prng(seed) { let x = seed >>> 0 || 1; return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; }; }

export class Cerebro {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

    this.scene = new THREE.Scene();
    this.scene.fog = null;
    this.camera = new THREE.PerspectiveCamera(36, 1, 5, 30000);
    this.camera.position.set(1400, 700, 2200);
    this.controls = new OrbitControls(this.camera, canvas);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.07, rotateSpeed: 0.5, zoomSpeed: 0.9, panSpeed: 0.7, minDistance: 30, maxDistance: 9000 });
    this.controls.addEventListener('start', () => { this.autoGiro = false; this.voo = null; });
    this.relogio = 0; this.autoGiro = true; this.tempo = 1e9; this.nascDur = 1; this.foco = -1; this.focoAtivo = 0; this.modo = null; this.mix = 0;
    this.pulsos = []; this.MAXP = 3600; this.voo = null; this.offset = 0; this.offsetAlvo = 0;
    this.camMudou = true; this._ultCam = new THREE.Matrix4();
    this.u = { uTempo: { value: 1e9 }, uNascDur: { value: 1 }, uRelogio: { value: 0 }, uPx: { value: 600 }, uMix: { value: 0 }, uGanho: { value: 1 }, uDist: { value: 2000 }, uExpo: { value: 1 }, uBrilho: { value: 1 }, uTamMul: { value: 1 }, uTrans: { value: 1 }, uCorFlash: { value: new THREE.Vector3(1, 1, 1) }, uCorNasc: { value: new THREE.Vector3(1, 1, 1) }, uOrigem: { value: new THREE.Vector3(0, -200, -60) } };
    this.us = { uTempo: this.u.uTempo, uNascDur: this.u.uNascDur, uFocoAtivo: { value: 0 }, uAlcance: { value: 260 }, uMul: { value: 1 }, uGanhoS: { value: 1 }, uZoom: { value: 1 }, uDist: this.u.uDist, uExpo: this.u.uExpo, uBrilhoS: { value: 1 }, uTransS: { value: 1 }, uCorDest: { value: new THREE.Vector3(1, 1, 1) }, uFoco: { value: new THREE.Vector3() } };
    this._temaUniforms(); this._pulsosInit();
    tema.aoTrocar(() => this.aplicarTema());
    this.resize();
    addEventListener('resize', () => this.resize());
  }
  resize() {
    const T = tela(); const w = Math.round(T.w), h = Math.round(T.h); this.w = w; this.h = h;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this._offset(); this.camera.updateProjectionMatrix();
    this.u.uPx.value = h * this.renderer.getPixelRatio() * 0.9; if (this.matPulso) this.matPulso.uniforms.uPx.value = this.u.uPx.value; if (this.matTecido) this.matTecido.uniforms.uPx.value = this.u.uPx.value;
    this.camMudou = true;
  }
  _offset() { if (Math.abs(this.offset) > 0.5) this.camera.setViewOffset(this.w, this.h, this.offset, 0, this.w, this.h); else this.camera.clearViewOffset(); }

  // ---------------------------------------------------------------- grafo
  setGrafo(g, opt = {}) {
    const ant = this.g; const antIds = ant ? new Map(ant.nos.map((n, i) => [n.id, i])) : null; const trans = !!(opt.transicao && ant && this.pos);
    const antPos = this.pos, antCor = this.base?.cor, antTam = this.base?.tam;
    const novos = new Set(g.nos.map(n => n.id)); const fantasmas = []; if (trans) ant.nos.forEach((n, i) => { if (!novos.has(n.id)) fantasmas.push(i); });
    const focoId = this.foco >= 0 && ant ? ant.nos[this.foco].id : null;
    this.g = g; const N = g.nos.length, E = g.sinapses.length;
    // laço em vez de spread: cofres muito grandes estouram o limite de argumentos; grafo vazio cai em "hoje − 1 dia"
    let t0 = Infinity, t1 = Date.now();
    for (const n of g.nos) { if (isFinite(n.criado) && n.criado < t0) t0 = n.criado; if (isFinite(n.modificado) && n.modificado > t1) t1 = n.modificado; }
    this.t0 = isFinite(t0) ? t0 : t1 - 864e5; this.t1 = t1;
    this.ids = new Map(g.nos.map((n, i) => [n.id, i]));
    // adjacência CSR
    const deg = new Uint32Array(N); for (const s of g.sinapses) { deg[s.a]++; deg[s.b]++; }
    const st = new Uint32Array(N + 1); for (let i = 0; i < N; i++) st[i + 1] = st[i] + deg[i];
    const viz = new Uint32Array(st[N]), ar = new Uint32Array(st[N]), cur = st.slice(0, N);
    g.sinapses.forEach((s, k) => { viz[cur[s.a]] = s.b; ar[cur[s.a]++] = k; viz[cur[s.b]] = s.a; ar[cur[s.b]++] = k; });
    this.adj = { st, viz, ar };
    // posições
    const G = fantasmas.length, M = N + G; this.N = N;
    const pos = new Float32Array(M * 3); g.nos.forEach((n, i) => { pos[i * 3] = n.pos[0]; pos[i * 3 + 1] = n.pos[1]; pos[i * 3 + 2] = n.pos[2]; });
    const pos0 = new Float32Array(M * 3), modo = new Float32Array(M);
    g.nos.forEach((n, i) => { const j = trans ? antIds.get(n.id) : undefined; if (j != null) { pos0[i * 3] = antPos[j * 3]; pos0[i * 3 + 1] = antPos[j * 3 + 1]; pos0[i * 3 + 2] = antPos[j * 3 + 2]; } else { pos0[i * 3] = pos[i * 3]; pos0[i * 3 + 1] = pos[i * 3 + 1]; pos0[i * 3 + 2] = pos[i * 3 + 2]; if (trans) modo[i] = 2; } });
    fantasmas.forEach((j, k) => { const i = N + k; for (let d = 0; d < 3; d++) pos[i * 3 + d] = pos0[i * 3 + d] = antPos[j * 3 + d]; modo[i] = 1; });
    this.pos = pos;
    const cor = new Float32Array(M * 3), cor2 = new Float32Array(M * 3), tam = new Float32Array(M), cri = new Float32Array(M), rec = new Float32Array(M).fill(0.5), nasc = new Float32Array(M), est = new Float32Array(M).fill(1);
    fantasmas.forEach((j, k) => { const i = N + k; cor.set(antCor.subarray(j * 3, j * 3 + 3), i * 3); tam[i] = antTam[j]; cri[i] = -1e6; });
    this.flash = new Float32Array(M);
    const agora = Date.now();
    g.nos.forEach((n, i) => {
      tam[i] = (n.tipo === 'dia' ? 6 : n.tipo === 'arquivo' || n.tipo === 'commit' ? 3 : 4.2) + Math.min(16, Math.sqrt(n.grau || 0) * (n.tipo === 'arquivo' || n.tipo === 'commit' ? 0.6 : 1.5));
      cri[i] = (n.criado - this.t0) / DIA;
      const idade = (agora - (n.modificado || n.criado)) / DIA; rec[i] = Math.max(0.12, Math.exp(-idade / 45));
      if (antIds && !antIds.has(n.id) && !trans) nasc[i] = this.relogio + 0.001;
    });
    this.base = { cor, tam, rec }; this._coresNos(cor); cor2.set(cor);
    this.trans = trans ? { t0: performance.now(), dur: 1.5 } : null; this.u.uTrans.value = trans ? 0 : 1; this.us.uTransS.value = trans ? 0 : 1;
    this._limpar(this.nosObj); this._limpar(this.sinObj);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aCor', new THREE.BufferAttribute(cor, 3)); geo.setAttribute('aCor2', new THREE.BufferAttribute(cor2, 3));
    geo.setAttribute('aTam', new THREE.BufferAttribute(tam, 1)); geo.setAttribute('aCriado', new THREE.BufferAttribute(cri, 1));
    geo.setAttribute('aRec', new THREE.BufferAttribute(rec, 1)); geo.setAttribute('aNasc', new THREE.BufferAttribute(nasc, 1));
    geo.setAttribute('aFlash', new THREE.BufferAttribute(this.flash, 1).setUsage(THREE.DynamicDrawUsage)); geo.setAttribute('aEst', new THREE.BufferAttribute(est, 1));
    geo.setAttribute('aPos0', new THREE.BufferAttribute(pos0, 3)); geo.setAttribute('aModo', new THREE.BufferAttribute(modo, 1));
    geo.computeBoundingSphere();
    this.nosObj = new THREE.Points(geo, new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: VS_NO, fragmentShader: FS_NO, blending: THREE.NormalBlending, depthWrite: true, depthTest: true, transparent: false }));
    this.nosObj.frustumCulled = false; this.nosObj.renderOrder = 3; this.scene.add(this.nosObj);
    // sinapses
    const sp = new Float32Array(E * 6), sc = new Float32Array(E * 6), sa = new Float32Array(E * 2), scri = new Float32Array(E * 2), sd = new Float32Array(E * 2);
    const recA = new Float32Array(E);
    g.sinapses.forEach((s, k) => {
      for (let j = 0; j < 3; j++) { sp[k * 6 + j] = pos[s.a * 3 + j]; sp[k * 6 + 3 + j] = pos[s.b * 3 + j]; }
      const a = s.tipo === 'DIA' ? 0.025 : s.tipo === 'TOCA' ? 0.04 : 0.06 + 0.2 * (s.peso ?? 0.5); sa[k * 2] = sa[k * 2 + 1] = a;
      scri[k * 2] = scri[k * 2 + 1] = Math.max(cri[s.a], cri[s.b]);
      recA[k] = Math.max(g.nos[s.a].modificado || 0, g.nos[s.b].modificado || 0);
    });
    this.sinBase = { sa }; this._coresSin(sc);
    this.u.uGanho.value = Math.min(1.1, Math.max(0.7, Math.sqrt(5000 / Math.max(1, N))));
    this.us.uGanhoS.value = Math.min(1.2, Math.max(0.06, Math.sqrt(400 / Math.max(1, E)) * 0.14));
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3)); sg.setAttribute('aCor', new THREE.BufferAttribute(sc, 3));
    sg.setAttribute('aA', new THREE.BufferAttribute(sa, 1)); sg.setAttribute('aCriado', new THREE.BufferAttribute(scri, 1)); sg.setAttribute('aDest', new THREE.BufferAttribute(sd, 1));
    this.sinObj = new THREE.LineSegments(sg, new THREE.ShaderMaterial({ uniforms: this.us, vertexShader: VS_SIN, fragmentShader: FS_SIN, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.sinObj.frustumCulled = false; this.sinObj.renderOrder = 2; this.scene.add(this.sinObj);
    // sinapses recentes para pulsos ambientes
    const ord = Array.from({ length: E }, (_, k) => k).sort((x, y) => recA[y] - recA[x]);
    this.recentes = ord.slice(0, Math.min(4000, E));
    this._caixa();
    if (!ant) { this._tecido(); this._grade(); this.enquadrar(false); }
    this.foco = focoId && this.ids.has(focoId) ? this.ids.get(focoId) : -1;
    this.aplicarModo(this.modo, this.caminho);
    this.camMudou = true; this.projVersao = (this.projVersao || 0) + 1;
  }
  // ---------------------------------------------------------------- tema
  _temaUniforms() { const D = tema.d3(); this.renderer.setClearColor(new THREE.Color().setRGB(...D.fundo, THREE.SRGBColorSpace), 1); this.u.uCorFlash.value.set(...D.flash); this.u.uCorNasc.value.set(...D.nascimento); this.us.uCorDest.value.set(...D.destaque); }
  _corNo(n) { const D = tema.d3(); if (n.diario || n.fonte === 'diario') return D.fonte.diario; return D.tipo[n.tipo] || D.fonte[n.fonte] || D.fonte.pasta; }
  _coresNos(arr) { this.g.nos.forEach((n, i) => arr.set(this._corNo(n), i * 3)); }
  emTransicao() { return !!this.trans; }
  _coresSin(arr) { const S = tema.d3().sinapse; this.g.sinapses.forEach((s, k) => { const c = S[s.tipo] || S.TAG; arr.set(c, k * 6); arr.set(c, k * 6 + 3); }); }
  // troca de tema sem recarregar: refaz os buffers de cor, o tecido e a grade
  aplicarTema() {
    this._temaUniforms(); if (!this.g) return;
    this._coresNos(this.base.cor); this.nosObj.geometry.attributes.aCor.needsUpdate = true;
    this._coresSin(this.sinObj.geometry.attributes.aCor.array); this.sinObj.geometry.attributes.aCor.needsUpdate = true;
    this._tecido(); this._grade(); this.aplicarModo(this.modo, this.caminho); this.camMudou = true;
  }
  _limpar(o) { if (!o) return; this.scene.remove(o); o.geometry.dispose(); o.material.dispose(); }
  _caixa() {
    const g = this.g; const xs = [], ys = [], zs = []; const dias = [];
    g.nos.forEach((n, i) => { if (n.tipo === 'dia') dias.push(i); else { xs.push(n.pos[0]); ys.push(n.pos[1]); zs.push(n.pos[2]); } });
    const pc = (a, p) => { if (!a.length) return 0; a.sort((x, y) => x - y); return a[Math.floor((a.length - 1) * p)]; };
    this.bb = { x0: pc(xs, .01), x1: pc(xs, .99), y0: pc(ys, .01), y1: pc(ys, .99), z0: pc(zs, .01), z1: pc(zs, .99) };
    if (!xs.length) this.bb = { x0: -500, x1: 500, y0: -260, y1: 380, z0: -400, z1: 400 };
    let sx = 0, sz = 0, ymin = this.bb.y0 - 600; for (const i of dias) { sx += this.pos[i * 3]; sz += this.pos[i * 3 + 2]; ymin = Math.min(ymin, this.pos[i * 3 + 1]); }
    this.espinha = { x: dias.length ? sx / dias.length : 0, z: dias.length ? sz / dias.length : (this.bb.z0 * 0.15), y0: dias.length ? ymin : -900 };
    this.u.uOrigem.value.set(this.espinha.x, this.bb.y0 + 20, this.espinha.z);
  }
  // tecido anatômico de fundo (só estrutura visual, sem dado): mesma forma de server/layout.js
  _tecido() {
    this._limpar(this.tecidoObj);
    const R = prng(1337); const P = [], C = [];
    const TC = tema.d3().tecido, FC = tema.d3().fissura; const push = (p, k, c = TC) => { P.push(p[0], p[1], p[2]); C.push(k * c[0], k * c[1], k * c[2]); };
    // córtex: superfície com giros (cristas claras, sulcos escuros) e parede medial na fissura
    for (let i = 0; i < 52000; i++) {
      const s = R() < 0.5 ? -1 : 1, u = R(), a = ALFA_MIN - 0.12 + (ALFA_MAX + 0.15 - ALFA_MIN + 0.12) * R();
      const { p, g } = pontoCortex(s, u, a, 0); const crista = (g - 1) / 0.072;
      if (crista < -0.15 && R() < 0.75) continue;
      push(p, 0.05 + 0.28 * Math.pow(Math.max(0, crista), 1.3) + (a < 0 ? 0.03 : 0));
    }
    // contorno da fissura longitudinal (borda medial superior), marcado
    for (let i = 0; i < 2400; i++) { const s = R() < 0.5 ? -1 : 1; const { p } = pontoCortex(s, R(), ALFA_MIN - 0.1, 0); push(p, 0.32, FC); }
    // cerebelo com folhas
    for (let i = 0; i < 9000; i++) { const v = R(), phi = -0.4 * Math.PI + R() * 1.65 * Math.PI; const { p, f } = pontoCerebelo(v, phi, 0); push(p, 0.03 + 0.16 * Math.max(0, (f - 1) / 0.08)); }
    // tronco e espinha com vértebras
    for (let i = 0; i < 5000; i++) push(pontoEspinha(R(), 0.92 + 0.08 * R(), R() * Math.PI * 2), 0.07 + 0.05 * R());
    for (let k = 0; k < 44; k++) { const t = k / 43; for (let j = 0; j < 64; j++) push(pontoEspinha(t * 0.62, 1.25, j / 64 * Math.PI * 2), 0.11); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); geo.setAttribute('aCor', new THREE.Float32BufferAttribute(C, 3));
    geo.setAttribute('aTam', new THREE.Float32BufferAttribute(new Float32Array(P.length / 3).fill(2.6), 1));
    this.matTecido = new THREE.ShaderMaterial({ uniforms: { uPx: { value: this.u.uPx.value } }, vertexShader: VS_PT, fragmentShader: FS_PT, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    this.tecidoObj = new THREE.Points(geo, this.matTecido); this.tecidoObj.frustumCulled = false; this.tecidoObj.renderOrder = 1; this.tecidoObj.visible = this.mostrarTecido !== false; this.scene.add(this.tecidoObj);
  }
  _grade() {
    if (this.gradeObj) { this.scene.remove(this.gradeObj); }
    const grp = new THREE.Group(); const L = [], LC = [];
    const b = this.bb, ext = 1500, yb = this.espinha.y0 - 80, passo = 100;
    const GC = tema.d3().grade.map(v => v * 1.6); const ln = (a, b2, k) => { L.push(...a, ...b2); LC.push(k * GC[0], k * GC[1], k * GC[2], k * GC[0], k * GC[1], k * GC[2]); };
    for (let v = -ext; v <= ext; v += passo) { const k = v === 0 ? 0.08 : (v % 500 === 0 ? 0.035 : 0.014); ln([v, 0, -ext], [v, 0, ext], k); ln([-ext, 0, v], [ext, 0, v], k); }
    for (let v = -ext; v <= ext; v += passo) { const k = v % 500 === 0 ? 0.03 : 0.012; ln([0, yb, v], [0, 900, v], k); }
    for (let y = Math.ceil(yb / passo) * passo; y <= 900; y += passo) { const k = y === 0 ? 0.07 : (y % 500 === 0 ? 0.03 : 0.012); ln([0, y, -ext], [0, y, ext], k); }
    // cruzes de marcação no plano XZ
    for (let x = -ext; x <= ext; x += 250) for (let z = -ext; z <= ext; z += 250) { ln([x - 10, 0, z], [x + 10, 0, z], 0.09); ln([x, 0, z - 10], [x, 0, z + 10], 0.09); ln([x, -10, z], [x, 10, z], 0.05); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(L, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(LC, 3));
    grp.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })));
    // eixos
    const ax = new THREE.BufferGeometry(); ax.setAttribute('position', new THREE.Float32BufferAttribute([-ext, 0, 0, ext, 0, 0, 0, yb, 0, 0, 900, 0, 0, 0, -ext, 0, 0, ext], 3));
    const D = tema.d3(); const cx = D.eixoX.map(v => v * 0.7), cy = D.eixoY.map(v => v * 0.3), cz = D.eixoZ.map(v => v * 0.6);
    ax.setAttribute('color', new THREE.Float32BufferAttribute([...cx, ...cx, ...cy, ...cy, ...cz, ...cz], 3));
    grp.add(new THREE.LineSegments(ax, new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })));
    grp.renderOrder = 0; grp.visible = this.mostrarGrade !== false; this.gradeObj = grp; this.scene.add(grp);
  }
  enquadrar(animar = true) {
    const b = this.bb; const hc = b.y1 - b.y0; const topo = Math.max(b.y1, ...this.g.regioes.filter(r => r.hemisferio !== 'TRONCO').map(r => r.centro[1])) + 50, base = Math.max(this.espinha.y0 - 20, b.y0 - hc * 0.75);
    const W = this.w || tela().w, H = this.h || tela().h; const A = this.area || { l: 312, r: 292, t: 92, b: 58 }; const fv = Math.max(0.4, (H - A.t - A.b) / H), fh = Math.max(0.3, (W - A.l - A.r) / W);
    const tf = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const dV = (topo - base) / fv / (2 * tf), dH = (b.x1 - b.x0) * 1.25 / fh / (2 * tf * (W / H));
    const d = Math.max(dV, dH) * 1.08;
    const alvo = new THREE.Vector3((b.x0 + b.x1) / 2, (topo + base) / 2 + (topo - base) * 0.03, (b.z0 + b.z1) / 2);
    const dir = new THREE.Vector3(0.5, 0.66, 1).normalize();
    const p = alvo.clone().addScaledVector(dir, d);
    if (animar) this.voar(alvo, p, 1.4); else { this.voo = null; this.controls.target.copy(alvo); this.camera.position.copy(p); this.controls.update(); }
    this.distInicial = d;
  }
  voar(alvo, pos, dur = 1.2) { this.voo = { t0: performance.now(), t: 0, dur, a0: this.controls.target.clone(), p0: this.camera.position.clone(), a1: alvo.clone(), p1: pos.clone() }; }
  voarPara(i, dist = 380) {
    const p = new THREE.Vector3(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    if (dir.lengthSq() < 0.5) dir.set(0.5, 0.3, 1).normalize();
    this.voar(p, p.clone().addScaledVector(dir, dist), 1.3); this.autoGiro = false;
  }
  voarRegiao(r) {
    const c = new THREE.Vector3(...r.centro); const dir = c.clone().sub(new THREE.Vector3(0, c.y, 0)); if (dir.lengthSq() < 1) dir.set(0, 0, 1); dir.normalize(); dir.y = 0.35; dir.normalize();
    this.voar(c, c.clone().addScaledVector(dir, 820), 1.4); this.autoGiro = false;
  }
  setOffset(px) { this.offsetAlvo = px; }

  // ---------------------------------------------------------------- foco, sobreposições
  setFoco(i) {
    this.foco = i; const g = this.g; if (!g) return;
    if (i >= 0) this.us.uFoco.value.set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
    this.aplicarModo(this.modo, this.caminho);
  }
  vizinhos(i) { const { st, viz, ar } = this.adj; const r = []; for (let j = st[i]; j < st[i + 1]; j++) r.push([viz[j], ar[j]]); return r; }
  caminhoMaisCurto(a, b) {
    const N = this.g.nos.length, prev = new Int32Array(N).fill(-1), pe = new Int32Array(N).fill(-1); const { st, viz, ar } = this.adj;
    const q = new Int32Array(N); let h = 0, t = 0; q[t++] = a; prev[a] = a;
    while (h < t) { const u = q[h++]; if (u === b) break; for (let j = st[u]; j < st[u + 1]; j++) { const v = viz[j]; if (prev[v] < 0) { prev[v] = u; pe[v] = ar[j]; q[t++] = v; } } }
    if (prev[b] < 0) return null; const nos = [b], ars = []; let u = b; while (u !== a) { ars.push(pe[u]); u = prev[u]; nos.push(u); } return { nos: nos.reverse(), arestas: ars };
  }
  aplicarModo(modo, caminho) {
    this.modo = modo; this.caminho = caminho || null; const g = this.g; if (!g) return;
    const N = g.nos.length, at = this.nosObj.geometry.attributes, c2 = at.aCor2.array, est = at.aEst.array; const agora = Date.now();
    const sd = this.sinObj.geometry.attributes.aDest.array; sd.fill(0);
    est.fill(1); for (let i = 0; i < N; i++) if (g.nos[i].fora) est[i] = 0.32;
    const D = tema.d3(), cz = tema.rgb(tema.ui().cinza), fd = D.fundo;
    if (modo === 'calor') for (let i = 0; i < N; i++) { const n = g.nos[i]; const h = Math.min(1, Math.exp(-(agora - n.modificado) / (DIA * 21)) * 0.8 + Math.min(1, (n.grau || 0) / 40) * 0.2); c2.set(tema.gradiente(h), i * 3); est[i] = 0.45 + 0.75 * h; }
    else if (modo === 'idade') for (let i = 0; i < N; i++) { const n = g.nos[i]; const a = Math.min(1, (agora - n.criado) / (DIA * 365)); c2.set(tema.gradiente(1 - a), i * 3); est[i] = 1.2 - a * 0.6; }
    else if (modo === 'cluster') for (let i = 0; i < N; i++) { const P = D.clusters; c2.set(P[(g.nos[i].cluster >>> 0) % P.length], i * 3); }
    else if (modo === 'orfaos') for (let i = 0; i < N; i++) { const o = g.nos[i].orfao || !g.nos[i].grau; c2.set(o ? D.orfao : cz, i * 3); est[i] = o ? 1.8 : 0.14; }
    else if (modo === 'caminho') { for (let i = 0; i < N; i++) { c2.set(cz, i * 3); est[i] = 0.14; } if (caminho) { for (const i of caminho.nos) { c2.set(D.caminho, i * 3); est[i] = 2.2; } for (const k of caminho.arestas) sd[k * 2] = sd[k * 2 + 1] = 2.2; } }
    else c2.set(this.base.cor);
    if (this.foco >= 0) {
      const f = this.foco; const set = new Set([f]); for (const [v, k] of this.vizinhos(f)) { set.add(v); sd[k * 2] = sd[k * 2 + 1] = Math.max(sd[k * 2], 1); }
      if (modo !== 'caminho' && modo !== 'orfaos') for (let i = 0; i < N; i++) est[i] *= set.has(i) ? (i === f ? 2.6 : 1.9) : 0.28;
    }
    at.aCor2.needsUpdate = true; at.aEst.needsUpdate = true; this.sinObj.geometry.attributes.aDest.needsUpdate = true;
    this.mixAlvo = modo ? 1 : 0; this.us.uMul.value = modo && modo !== 'calor' ? 0.45 : 1;
  }
  setTempo(diasRel, nascDur) { this.tempo = diasRel; this.u.uTempo.value = diasRel; if (nascDur) this.u.uNascDur.value = nascDur; this.projVersao++; this.camMudou = true; }
  nascido(i) { return this.tempo >= (this.g.nos[i].criado - this.t0) / DIA; }

  // ---------------------------------------------------------------- pulsos
  _pulsosInit() {
    const M = this.MAXP * 3; this.pp = new Float32Array(M * 3); this.pc = new Float32Array(M * 3); this.pt = new Float32Array(M);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(this.pp, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aCor', new THREE.BufferAttribute(this.pc, 3).setUsage(THREE.DynamicDrawUsage)); geo.setAttribute('aTam', new THREE.BufferAttribute(this.pt, 1).setUsage(THREE.DynamicDrawUsage));
    this.matPulso = new THREE.ShaderMaterial({ uniforms: { uPx: { value: 600 } }, vertexShader: VS_PT, fragmentShader: FS_PT, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    this.pulsoObj = new THREE.Points(geo, this.matPulso); this.pulsoObj.frustumCulled = false; this.pulsoObj.renderOrder = 4; this.scene.add(this.pulsoObj);
  }
  pulsarAresta(k, de, forca = 1, cor) {
    if (this.pulsos.length >= this.MAXP) return; const s = this.g.sinapses[k]; if (!s) return;
    const a = de === s.b ? s.b : s.a, b = a === s.a ? s.b : s.a;
    const S = tema.d3().sinapse; this.pulsos.push({ a, b, t: 0, dur: 0.5 + Math.random() * 0.9, f: forca, c: cor || S[s.tipo] || S.LINK });
  }
  pulsar(i, nivel = 'PULSO') {
    if (i == null || i < 0 || !this.g) return; this.flash[i] = 1; this.nosObj.geometry.attributes.aFlash.needsUpdate = true;
    const cor = tema.d3().pulso[nivel] || tema.d3().pulso.PULSO;
    const v = this.vizinhos(i); for (let j = 0; j < Math.min(28, v.length); j++) this.pulsarAresta(v[j][1], i, nivel === 'HIST' ? 0.5 : 1.3, cor);
    // propagação de segunda ordem
    for (let j = 0; j < Math.min(6, v.length); j++) { const w = this.vizinhos(v[j][0]); for (let q = 0; q < Math.min(4, w.length); q++) { const P = this.pulsos.length; this.pulsarAresta(w[q][1], v[j][0], 0.6, cor); if (this.pulsos[P]) this.pulsos[P].t = -0.6; } }
  }
  _pulsosTick(dt) {
    if (!this.g) return; const pos = this.pos;
    // ritmo ambiente sobre sinapses recentes
    if (this.recentes.length && !document.hidden) { this._amb = (this._amb || 0) + dt * 26; while (this._amb > 1) { this._amb--; const k = this.recentes[(Math.random() ** 2 * this.recentes.length) | 0]; const s = this.g.sinapses[k]; if (this.nascido(s.a) && this.nascido(s.b)) this.pulsarAresta(k, Math.random() < .5 ? s.a : s.b, 0.35); } }
    let n = 0; const P = this.pulsos;
    for (let j = P.length - 1; j >= 0; j--) {
      const p = P[j]; p.t += dt / p.dur; if (p.t >= 1) { P[j] = P[P.length - 1]; P.pop(); continue; } if (p.t < 0) continue;
      for (let r = 0; r < 3; r++) {
        const tt = Math.max(0, p.t - r * 0.06); const ia = p.a * 3, ib = p.b * 3;
        this.pp[n * 3] = pos[ia] + (pos[ib] - pos[ia]) * tt; this.pp[n * 3 + 1] = pos[ia + 1] + (pos[ib + 1] - pos[ia + 1]) * tt; this.pp[n * 3 + 2] = pos[ia + 2] + (pos[ib + 2] - pos[ia + 2]) * tt;
        const k = p.f * (1 - r * 0.38) * Math.sin(Math.PI * Math.min(1, p.t * 1.05)); this.pc[n * 3] = p.c[0] * k; this.pc[n * 3 + 1] = p.c[1] * k; this.pc[n * 3 + 2] = p.c[2] * k; this.pt[n] = (r === 0 ? 11 : 7) * Math.max(0.5, p.f); n++;
      }
    }
    const geo = this.pulsoObj.geometry; geo.setDrawRange(0, n); geo.attributes.position.needsUpdate = true; geo.attributes.aCor.needsUpdate = true; geo.attributes.aTam.needsUpdate = true;
    // decaimento de flash
    let mud = false; const f = this.flash; if (this._flashAtivos === undefined) this._flashAtivos = 0;
    for (let i = 0; i < f.length; i++) if (f[i] > 0) { f[i] = Math.max(0, f[i] - dt * 0.9); mud = true; }
    if (mud) this.nosObj.geometry.attributes.aFlash.needsUpdate = true;
  }

  // ---------------------------------------------------------------- projeção (rótulos, picking, minimapa)
  projetar() {
    const g = this.g; if (!g) return; const N = g.nos.length;
    if (!this.sx || this.sx.length !== N) { this.sx = new Float32Array(N); this.sy = new Float32Array(N); this.sz = new Float32Array(N); }
    const m = new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse).elements;
    const W = this.w / 2, H = this.h / 2, p = this.pos; const tempo = this.tempo, t0 = this.t0;
    for (let i = 0; i < N; i++) {
      const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
      const w = m[3] * x + m[7] * y + m[11] * z + m[15];
      if (w <= 1 || (tempo < 1e8 && (g.nos[i].criado - t0) / DIA > tempo)) { this.sz[i] = -1; continue; }
      const cx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w, cy = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
      this.sx[i] = (cx + 1) * W; this.sy[i] = (1 - cy) * H; this.sz[i] = w;
    }
  }
  proj3(v) { const p = new THREE.Vector3(...v).project(this.camera); if (p.z > 1) return null; return [(p.x + 1) * this.w / 2, (1 - p.y) * this.h / 2, p.z]; }
  pegar(x, y, raio = 14) {
    if (!this.sx) return -1; let best = -1, bd = raio * raio, bz = 1e9;
    for (let i = 0; i < this.sx.length; i++) { if (this.sz[i] < 0) continue; const dx = this.sx[i] - x, dy = this.sy[i] - y, d = dx * dx + dy * dy; if (d < bd || (d < raio * raio * 0.3 && this.sz[i] < bz && d < bd * 2)) { if (d < bd) bd = d; best = i; bz = this.sz[i]; } }
    return best;
  }
  dist() { return this.camera.position.distanceTo(this.controls.target); }
  // exposição proporcional à densidade de neurônios por pixel na tela
  _exposicao() {
    const d = this.dist(); this.u.uDist.value = d; if (!this.g) return;
    const ppu = (this.h / 2) / (Math.tan(this.camera.fov * Math.PI / 360) * d); // pixels por unidade no alvo
    const area = Math.max(2000, 980 * 760 * ppu * ppu * 0.55); const n = this.nVivos ?? this.g.nos.length;
    this.u.uExpo.value = Math.min(1, Math.max(0.3, Math.sqrt(0.018 / (n / area))));
  }

  // ---------------------------------------------------------------- quadro
  quadro(dt) {
    this.relogio += dt; this.u.uRelogio.value = this.relogio;
    if (this.trans) { const t = Math.min(1, (performance.now() - this.trans.t0) / 1000 / this.trans.dur); this.u.uTrans.value = t; this.us.uTransS.value = Math.max(0, (t - 0.55) / 0.45) ** 2; this.camMudou = true;
      if (t >= 1) { this.trans = null; this.nosObj.geometry.setDrawRange(0, this.N); } }
    if (!this.trans && this.nosObj) { const lim = Math.min(this.N, this.limite || Infinity); if (this.nosObj.geometry.drawRange.count !== lim) this.nosObj.geometry.setDrawRange(0, lim); }
    this.us.uMul.value = (this.modo && this.modo !== 'calor' ? 0.45 : 1) * (this.qualidade === 'baixa' ? 0.35 : this.qualidade === 'media' ? 0.7 : 1);
    if (this.voo) { const v = this.voo; v.t = (performance.now() - v.t0) / 1000 / v.dur; const e = v.t >= 1 ? 1 : 1 - Math.pow(1 - v.t, 4); this.controls.target.lerpVectors(v.a0, v.a1, e); this.camera.position.lerpVectors(v.p0, v.p1, e); if (v.t >= 1) this.voo = null; }
    if (this.autoGiro && !this.voo) { const t = this.controls.target, p = this.camera.position; const a = dt * 0.045; const dx = p.x - t.x, dz = p.z - t.z; p.x = t.x + dx * Math.cos(a) - dz * Math.sin(a); p.z = t.z + dx * Math.sin(a) + dz * Math.cos(a); }
    if (Math.abs(this.offset - this.offsetAlvo) > 0.5) { this.offset += (this.offsetAlvo - this.offset) * Math.min(1, dt * 7); this._offset(); this.camera.updateProjectionMatrix(); this.camMudou = true; }
    this.controls.update();
    this.mix += ((this.mixAlvo || 0) - this.mix) * Math.min(1, dt * 5); this.u.uMix.value = this.mix;
    const fa = this.foco >= 0 ? 1 : 0; this.focoAtivo += (fa - this.focoAtivo) * Math.min(1, dt * 4); this.us.uFocoAtivo.value = this.focoAtivo;
    this._pulsosTick(dt); this._exposicao(); this.us.uZoom.value = Math.min(3, Math.max(1, Math.pow((this.distInicial || 2500) / this.u.uDist.value, 0.7)));
    this.camera.updateMatrixWorld();
    if (!this._ultCam.equals(this.camera.matrixWorld)) { this._ultCam.copy(this.camera.matrixWorld); this.camMudou = true; }
    this.mudouQuadro = this.camMudou; this.camMudou = false; if (this.mudouQuadro) this.projetar();
    this.renderer.render(this.scene, this.camera);
  }
}
