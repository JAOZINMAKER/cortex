#!/usr/bin/env node
'use strict';
// CÓRTEX — entrada estável do comando `cortex`. O cortex.cmd aponta para resources/app/cli-inicio.js da instalação;
// este arquivo acha a versão mais nova do app (embutida ou baixada em versoes/) e roda o cli.js dela.
const path = require('path');
const resolver = require('./app/resolver');

const escolha = resolver.escolher(__dirname, { contarBoot: false });
process.env.CORTEX_APP_DIR = escolha.dir;
require(path.join(escolha.dir, 'cli.js'));
