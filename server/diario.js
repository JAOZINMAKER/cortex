'use strict';
// Diário das sessões: .md em cortex/diario/<projeto>/AAAA-MM-DD-<slug>.md.
// É uma fonte "obsidian" interna, sempre ligada. Nunca escreve nos cofres do usuário.
const fs = require('fs');
const path = require('path');
const { slug, dayKey, normPath } = require('./util');
const config = require('./config');

// objeto estável (o watch e o servidor usam por referência); o caminho acompanha o dadosDir atual
const FONTE = {
  id: 'src_diario', tipo: 'obsidian', projeto: 'diario', projetoPorPasta: true, ativo: true, interno: true,
  get caminho() { return config.DIARIO_DIR; },
};

function garantirPasta() {
  fs.mkdirSync(config.DIARIO_DIR, { recursive: true });
  const leia = path.join(config.DIARIO_DIR, 'LEIA-ME.txt');
  if (!fs.existsSync(leia)) {
    fs.writeFileSync(leia, 'Diário do CÓRTEX: registros gravados por sessões via `cortex registrar` ou POST /api/registrar.\r\nUma pasta por projeto. Pode editar ou apagar à vontade.\r\n');
  }
}

const yamlStr = (s) => JSON.stringify(String(s)); // aspas duplas escapadas = YAML válido
const linhaWiki = (t) => String(t).replace(/[\[\]|#^]/g, ' ').replace(/\s+/g, ' ').trim();

// ligacoes: [{ id, titulo }] já resolvidas pelo servidor
function escrever({ projeto, titulo, texto, tags, autor, ligacoes }) {
  garantirPasta();
  const agora = new Date();
  const dir = path.join(config.DIARIO_DIR, slug(projeto));
  fs.mkdirSync(dir, { recursive: true });
  const base = `${dayKey(agora.getTime())}-${slug(titulo).slice(0, 60)}`;
  const tagsL = (tags || []).map((t) => String(t).trim().replace(/^#/, '')).filter(Boolean).slice(0, 20);
  const lig = (ligacoes || []).slice(0, 50);
  const fm = [
    '---',
    `projeto: ${yamlStr(projeto)}`,
    `titulo: ${yamlStr(titulo)}`,
    `autor: ${yamlStr(autor || 'CLAUDE CODE')}`,
    `tags: [${tagsL.map(yamlStr).join(', ')}]`,
    `criado: ${agora.toISOString()}`,
    `ligar: [${lig.map((l) => yamlStr(l.id)).join(', ')}]`,
    '---',
  ];
  const corpo = [`# ${titulo}`, '', String(texto || '').trim(), ''];
  if (lig.length) {
    corpo.push('## Ligações', '');
    for (const l of lig) corpo.push(`- [[${linhaWiki(l.titulo)}]] \`${l.id.slice(0, 6)}\``);
    corpo.push('');
  }
  // nunca sobrescreve: flag 'wx' falha se o arquivo existir (inclusive em corrida); aí tenta -2, -3...
  const conteudo = fm.concat(corpo).join('\n');
  let arq;
  for (let i = 1; i < 1000; i++) {
    arq = path.join(dir, i === 1 ? base + '.md' : `${base}-${i}.md`);
    try { fs.writeFileSync(arq, conteudo, { encoding: 'utf8', flag: 'wx' }); return { caminho: arq, chave: 'nota:' + normPath(arq) }; }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  throw new Error('nomes esgotados para ' + base);
}

module.exports = { FONTE, garantirPasta, escrever };
