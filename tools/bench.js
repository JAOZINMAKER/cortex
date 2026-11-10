// Benchmark de render: abre ?bench=N (grafo SINTÉTICO, só para medir) e mede fps médio em 10 s.
// Uso: node tools/bench.js [url] [N]   (padrão http://127.0.0.1:4747, 20000)
// Obs.: sem GPU (ex.: servidor sem placa de vídeo) o Chromium usa SwiftShader (render em CPU) e o fps
// medido fica muito abaixo do real; nesses casos vale olhar o tempo de JS por quadro (ms/quadro).
const { chromium } = require('playwright');
const URL = process.argv[2] || process.env.URL || 'http://127.0.0.1:4747';
const N = +(process.argv[3] || 20000);
const GPU = process.env.GPU === '1';
const ARGS = GPU ? ['--ignore-gpu-blocklist', '--enable-gpu-rasterization'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
(async () => {
  let b; try { b = await chromium.launch({ args: ARGS, headless: !GPU }); } catch { b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ARGS, headless: !GPU }); }
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  await p.goto(`${URL}/?bench=${N}`); await p.waitForFunction(() => window.__cortex && __cortex.pronto(), null, { timeout: 120000 });
  const info = await p.evaluate(() => ({ nos: __cortex.app.g.nos.length, sin: __cortex.app.g.sinapses.length, gl: (() => { const g = document.createElement('canvas').getContext('webgl2'); const d = g.getExtension('WEBGL_debug_renderer_info'); return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER); })() }));
  await new Promise(r => setTimeout(r, 3000));
  const r = await p.evaluate(() => new Promise(res => {
    let n = 0, js = 0; const t0 = performance.now(); const ms0 = [];
    const f = () => { n++; ms0.push(__cortex.ms()); if (performance.now() - t0 < 10000) requestAnimationFrame(f); else res({ fps: n / ((performance.now() - t0) / 1000), msJs: ms0.reduce((a, b) => a + b, 0) / ms0.length }); };
    requestAnimationFrame(f);
  }));
  console.log(`BENCH ${info.nos} neurônios · ${info.sin} sinapses · ${info.gl}`);
  console.log(`fps médio (10 s): ${r.fps.toFixed(1)} · JS por quadro: ${r.msJs.toFixed(2)} ms (orçamento de 60 fps: 16,7 ms)`);
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
