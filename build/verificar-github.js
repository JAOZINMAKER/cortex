#!/usr/bin/env node
'use strict';
// node build/verificar-github.js [dono/repo] → lê o manifesto no GitHub como o app lê e diz o que o app desta pasta faria.
const path = require('path');
const { criar, REPO_PADRAO } = require('../app/atualizador');
const resolver = require('../app/resolver');
const os = require('os');
const fs = require('fs');

const repo = process.argv[2] || REPO_PADRAO;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-gh-'));
const cfg = path.join(tmp, 'cortex.config.json');
fs.writeFileSync(cfg, JSON.stringify({ atualizacao: { repo } }));
const versao = require('../package.json').version;
const at = criar({ versaoAtual: versao, appDir: path.join(__dirname, '..'), embutidoDir: path.join(__dirname, '..'), pastaVersoes: path.join(tmp, 'versoes'),
  configPath: cfg, podePublicar: false, obterSync: async () => null, log: (m) => console.log('  ' + m) });
(async () => {
  const https = require('https');
  const url = `https://raw.githubusercontent.com/${repo}/main/atualizacao/manifesto.json`;
  const m = await new Promise((r) => https.get(url, { headers: { 'user-agent': 'CORTEX-app' } }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => { try { r(res.statusCode === 200 ? JSON.parse(b) : { status: res.statusCode }); } catch { r({ status: 'não é JSON' }); } }); }).on('error', (e) => r({ erro: e.message })));
  console.log(`[córtex] ${url}\n  →`, JSON.stringify(m));
  const e = await at.verificar();
  const cmp = m && m.versao ? resolver.comparar(m.versao, versao) : null;
  console.log(`[córtex] app local ${versao}: ${cmp === null ? 'nada no GitHub (o app ignora em silêncio)' : cmp > 0 ? `atualizaria para ${m.versao} → ${e.pronta ? 'pacote baixado e conferido (sha256 ok)' : 'FALHOU: ' + e.erro}` : cmp === 0 ? 'mesma versão: não faz nada' : 'GitHub tem versão menor: não faz nada'}`);
  fs.rmSync(tmp, { recursive: true, force: true });
})();
