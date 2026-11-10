// Grafo SINTÉTICO só para benchmark (?bench=N). Nunca misturado com dados reais.
export function grafoBench(N = 20000, fatorSin = 3) {
  let s = 12345; const R = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const fontes = ['obsidian', 'git', 'claude', 'pasta']; const tipos = { obsidian: 'nota', git: 'commit', claude: 'sessao', pasta: 'doc' };
  const NR = 12, agora = Date.now(), t0 = agora - 400 * 864e5; const regioes = [], nos = [], sinapses = [];
  for (let r = 0; r < NR; r++) { const hem = r % 2 ? 1 : -1; const th = -2.2 + 4.4 * (Math.floor(r / 2) + .5) / (NR / 2); regioes.push({ id: 'r_b' + r, nome: 'BENCH-' + String(r).padStart(2, '0'), serial: 'BX-' + String(r).padStart(4, '0'), hemisferio: hem < 0 ? 'E' : 'D', centro: [0, 0, 0], neuronios: 0, sinapses: 0, ultimoPulso: agora, atividade7d: [1, 2, 3, 2, 4, 5, 6], subregioes: [], _d: [hem * .75, .45 + .3 * Math.sin(r), Math.cos(th)] }); }
  const ND = 400;
  for (let i = 0; i < N - ND; i++) {
    const r = regioes[(R() * NR) | 0]; const d = r._d; let v = [d[0] + (R() - .5) * .7, d[1] + (R() - .5) * .7, d[2] + (R() - .5) * .8]; v[0] = Math.sign(d[0]) * Math.max(.06, Math.abs(v[0])); const L = Math.hypot(...v); v = v.map(x => x / L);
    const dep = .5 + .5 * R(); const f = fontes[(R() * 4) | 0]; const cri = t0 + R() * 400 * 864e5; const id = 'b' + i.toString(16).padStart(7, '0');
    nos.push({ id, idCurto: id.slice(-6), tipo: tipos[f], fonte: f, titulo: 'SINTÉTICO ' + i, regiao: r.id, subregiao: 'bench', pos: [Math.sign(v[0]) * 30 + v[0] * 470 * dep, 60 + v[1] * 320 * dep, v[2] * 420 * dep], criado: cri, modificado: cri + R() * 864e6, palavras: (R() * 2000) | 0, grau: 0, autor: 'BENCH', hash: id.padEnd(12, '0'), caminho: null, tags: ['bench'], cluster: (R() * 12) | 0, orfao: false });
    r.neuronios++;
  }
  const dias = []; for (let i = 0; i < ND; i++) { const t = t0 + i * 864e5; const dia = new Date(t).toISOString().slice(0, 10); dias.push(dia); nos.push({ id: 'd' + i, idCurto: 'd' + String(i).padStart(5, '0'), tipo: 'dia', fonte: 'sistema', titulo: dia, regiao: 'r_tronco', subregiao: 'espinha', pos: [0, -900 + i / ND * 760, -60], criado: t, modificado: t, palavras: 0, grau: 0, autor: 'SISTEMA', hash: 'd' + i, caminho: null, tags: [], cluster: 0, orfao: false }); }
  const M = N * fatorSin; const porReg = regioes.map(r => nos.map((n, i) => n.regiao === r.id ? i : -1).filter(i => i >= 0));
  for (let k = 0; k < M; k++) { const pr = porReg[(R() * NR) | 0]; const a = pr[(R() * pr.length) | 0], b = R() < .85 ? pr[(R() * pr.length) | 0] : (R() * (N - ND)) | 0; if (a === b) continue; sinapses.push({ a, b, tipo: ['LINK', 'TOCA', 'PAI', 'SEQ'][(R() * 4) | 0], peso: R() }); nos[a].grau++; nos[b].grau++; }
  for (const r of regioes) { const pr = porReg[regioes.indexOf(r)]; const c = [0, 0, 0]; for (const i of pr) for (let j = 0; j < 3; j++) c[j] += nos[i].pos[j] / pr.length; r.centro = c; r.sinapses = Math.round(M / NR); delete r._d; }
  regioes.push({ id: 'r_tronco', nome: 'TRONCO / ESPINHA', serial: 'BX-TRNC', hemisferio: 'TRONCO', centro: [0, -500, -60], neuronios: ND, sinapses: 0, ultimoPulso: agora, atividade7d: [0, 0, 0, 0, 0, 0, 0], subregioes: [] });
  return { versao: 0, geradoEm: agora, regioes, nos, sinapses, dias, contadores: { notas: N / 4, commits: N / 4, linhas: N * 30, sessoes: N / 4, horasIA: 0, neuronios: N, sinapses: sinapses.length, arquivos: N / 4, regioes: NR + 1, ferramentas: 0 }, fontes: [{ id: 'bench', tipo: 'bench', caminho: 'SINTÉTICO', projeto: 'bench', status: 'OK', itens: N }] };
}
