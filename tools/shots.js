// Prints de verificação com Playwright. Uso: node tools/shots.js [url]  (padrão http://127.0.0.1:4747)
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const URL = process.argv[2] || process.env.URL || 'http://127.0.0.1:4747';
const OUT = path.join(__dirname, '..', 'prints');
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'];
const espera = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  let browser; try { browser = await chromium.launch({ args: ARGS }); } catch { browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ARGS }); }
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  const erros = []; page.on('console', m => { if (m.type() === 'error') erros.push(m.text()); }); page.on('pageerror', e => erros.push(String(e)));
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__cortex && window.__cortex.pronto(), null, { timeout: 120000 });
  await page.evaluate(() => { __cortex.pararGiro(); __cortex.enquadrar(); });
  await espera(5000);
  const so = process.env.SO ? process.env.SO.split(',') : null; const quer = n => !so || so.includes(n);
  const shot = async n => { await page.screenshot({ path: path.join(OUT, n) }); console.log('print', n); };
  if (quer('01')) await shot('01-cerebro.png');
  if (quer('02')) { const r = await page.evaluate(() => __cortex.regiao(0)); console.log('região', r); await espera(3200); await shot('02-regiao.png'); }
  if (quer('03')) { await page.evaluate(t => __cortex.focarMaisLigado(t), process.env.TIPO || 'nota'); await espera(3600); await shot('03-neuronio.png'); await page.keyboard.press('Escape'); await espera(400); }
  if (quer('04')) { await page.evaluate(() => { __cortex.enquadrar(); __cortex.replay(0.62); }); await espera(2600); await shot('04-replay.png'); await page.evaluate(() => __cortex.pararReplay()); await espera(300); }
  if (quer('05')) { await page.evaluate(() => __cortex.abrirMaquina()); await espera(2600); await shot('05-maquina.png'); await page.evaluate(() => __cortex.fecharMaquina()); }
  if (quer('06')) { await page.evaluate(() => __cortex.comando('')); await page.keyboard.type(process.env.BUSCA || 'link', { delay: 40 }); await espera(1400); await page.keyboard.press('ArrowDown'); await espera(300); await shot('06-comando.png'); await page.keyboard.press('Escape'); }
  if (quer('07')) { await page.evaluate(() => __cortex.conectar()); await espera(1200); await shot('07-conectar.png'); await page.evaluate(() => __cortex.fecharConectar()); }
  console.log('fps', await page.evaluate(() => __cortex.fps().toFixed(1)), 'ms/quadro(js)', await page.evaluate(() => __cortex.ms().toFixed(2)));
  if (erros.length) console.log('ERROS DO CONSOLE:\n' + [...new Set(erros)].slice(0, 20).join('\n')); else console.log('console limpo');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
