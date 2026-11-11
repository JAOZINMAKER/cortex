#!/usr/bin/env node
'use strict';
// npm run pacote → dist/atualizacao/manifesto.json + dist/atualizacao/cortex-app-<versao>.cortexapp
// (o mesmo par que o app publica na pasta de sincronização e que vai para o GitHub em atualizacao/)
// Grava em dist/atualizacao/ e também em atualizacao/ na raiz do repositório (versionada: é o que o app lê no GitHub,
// https://raw.githubusercontent.com/<repo>/main/atualizacao/manifesto.json).
// Opções: --raiz <pasta do app> (padrão: este repositório) · --saida <pasta> (só essa pasta)
const fs = require('fs');
const path = require('path');
const { empacotar } = require('../app/pacote');

const argv = process.argv.slice(2);
const opt = (n, pad) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : pad; };
const raiz = path.resolve(opt('raiz', path.join(__dirname, '..')));
const saidas = opt('saida') ? [path.resolve(opt('saida'))]
  : [path.join(raiz, 'dist', 'atualizacao'), ...(fs.existsSync(path.join(raiz, '.git')) ? [path.join(raiz, 'atualizacao')] : [])];
const deps = fs.existsSync(path.join(raiz, 'node_modules', 'electron')) ? 'producao' : 'presentes';

const t0 = Date.now();
const { buf, manifesto, bytesBrutos } = empacotar(raiz, { deps });
for (const saida of saidas) {
  fs.mkdirSync(saida, { recursive: true });
  for (const f of fs.readdirSync(saida)) if (f.endsWith('.cortexapp') && f !== manifesto.arquivo) fs.rmSync(path.join(saida, f));
  fs.writeFileSync(path.join(saida, manifesto.arquivo), buf);
  fs.writeFileSync(path.join(saida, 'manifesto.json'), JSON.stringify(manifesto, null, 2) + '\n');
}
const mb = (b) => (b / 1048576).toFixed(2) + ' MB';
console.log(`[córtex] pacote ${manifesto.versao}: ${manifesto.arquivos} arquivos, ${mb(bytesBrutos)} → ${mb(buf.length)} (gzip) em ${Date.now() - t0} ms`);
for (const saida of saidas) console.log(`[córtex] ${path.join(saida, manifesto.arquivo)}`);
console.log(`[córtex] sha256 ${manifesto.sha256}`);
