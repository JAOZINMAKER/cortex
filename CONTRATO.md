# CÓRTEX — contrato interno entre servidor e interface

Este arquivo é a fonte da verdade para quem mexe no código. Servidor e interface só conversam pelo que está aqui.

## Estrutura de pastas

```
cortex/
  package.json            (versões fixas; não adicionar dependência sem fixar versão)
  abrir-cortex.bat        (Windows: um clique → npm install se faltar → node server → abre navegador)
  cortex.config.json      (criado no primeiro boot; fontes conectadas)
  .env                    (opcional: ANTHROPIC_API_KEY=...; .env.exemplo no repo)
  data/                   (gerado; ignorado no git)
    maquina.json          (interpretação da máquina: tags/região/cluster por neurônio)
    correcoes.json        (correções do usuário; sobrepõem maquina.json)
    cache/                (cache de parsing por fonte)
  server/
    index.js              (HTTP + WebSocket na porta 4747, 127.0.0.1 apenas)
    config.js  graph.js  layout.js  watch.js  classify.js  telemetry.js  snapshot.js
    sources/obsidian.js git.js claude.js folder.js
  web/
    index.html  css/  js/  (ES modules, sem bundler)
  tools/shots.js (prints com Playwright)  tools/bench.js (benchmark 20k neurônios)
  direcoes-visuais.html   (folha com 3 direções)
  README.md  DECISOES.md
```

O servidor serve `web/` em `/`, `node_modules/three/` em `/vendor/three/`, `node_modules/marked/lib/marked.esm.js` em `/vendor/marked.esm.js`, e a fonte em `/vendor/fonts/` (`node_modules/@fontsource-variable/martian-mono/files/`).

## Config (`cortex.config.json`)

```json
{
  "porta": 4747,
  "fontes": [
    { "id": "src_xxx", "tipo": "obsidian", "caminho": "C:\\...\\wiki", "projeto": "glass-pets", "ativo": true },
    { "id": "src_yyy", "tipo": "git", "caminho": "C:\\...\\glass-pets", "projeto": "glass-pets", "ativo": true },
    { "id": "src_zzz", "tipo": "claude", "caminho": "C:\\Users\\jaozin\\.claude\\projects", "ativo": true },
    { "id": "src_www", "tipo": "pasta", "caminho": "C:\\...\\Roteiros", "projeto": "roteiros", "ativo": true }
  ],
  "claude": { "ativo": false, "modelo": "claude-haiku-5-5" },
  "som": false
}
```

Padrão no primeiro boot: o cofre `%USERPROFILE%\Documents\Claude Builder\glass-pets\wiki`, o repo `%USERPROFILE%\Documents\Claude Builder\glass-pets` e as conversas em `%USERPROFILE%\.claude\projects`. Fontes cujo caminho não existe ficam com status `AUSENTE`, sem derrubar o app. Variável de ambiente `CORTEX_CONFIG` aponta para outro arquivo de config (usada nos testes).

A organização com o Claude só roda quando `claude.ativo === true` **e** existe `ANTHROPIC_API_KEY` no `.env`. Sem isso, o classificador local por regras faz tudo. Nada sai da máquina por padrão.

## Grafo (`GET /api/graph`)

```ts
{
  versao: number,                 // incrementa a cada reconstrução
  geradoEm: number,               // epoch ms
  regioes: Regiao[],
  nos: No[],
  sinapses: Sinapse[],
  dias: string[],                 // "2026-11-10", em ordem; vértebras da espinha
  contadores: Contadores,
  fontes: FonteStatus[]
}

Regiao = {
  id: string,                     // "r_glass-pets"
  nome: string,                   // "GLASS-PETS" (caixa alta)
  serial: string,                 // "RG-0007"
  hemisferio: "E" | "D" | "TRONCO",
  centro: [x,y,z],                // posição do rótulo
  neuronios: number, sinapses: number,
  ultimoPulso: number,            // epoch ms
  atividade7d: number[7],         // eventos por dia, do mais antigo ao de hoje
  subregioes: { id: string, nome: string, n: number }[]
}

No = {
  id: string,                     // estável entre reconstruções: hash curto da chave natural
  idCurto: string,                // 6 chars hex, ex. "a3f91c"
  tipo: "nota" | "commit" | "branch" | "worktree" | "sessao" | "arquivo" | "doc" | "dia",
  fonte: "obsidian" | "git" | "claude" | "pasta" | "sistema",
  titulo: string,
  regiao: string, subregiao: string,
  pos: [x,y,z],                   // calculada no servidor (layout.js), cérebro de ~1000 unidades de largura
  criado: number, modificado: number,   // epoch ms
  palavras: number,               // tamanho em palavras (commit: linhas alteradas; sessão: nº de mensagens)
  grau: number,
  autor: string,                  // "EU", "CLAUDE", "CLAUDE CODE", nome do git, etc.
  hash: string,                   // sha do commit ou sha1 do conteúdo (12 chars)
  caminho: string | null,
  tags: string[],                 // tags da MÁQUINA (separadas do texto original)
  cluster: number,                // comunidade detectada
  orfao: boolean
}

Sinapse = {
  a: number, b: number,           // índices em nos[]
  tipo: "LINK" | "EMBED" | "PAI" | "TOCA" | "SEQ" | "DIA" | "BRANCH" | "TAG",
  peso: number                    // 0..1
}

Contadores = { notas, commits, linhas, sessoes, horasIA, neuronios, sinapses, arquivos, regioes, ferramentas }

FonteStatus = { id, tipo, caminho, projeto, status: "OK"|"AUSENTE"|"ERRO"|"LENDO", itens: number, erro?: string }
```

### Forma do cérebro (layout.js)
- Eixo Y para cima. Cérebro centrado na origem, cerca de 1000 de largura (X), 800 de profundidade (Z), 650 de altura (Y).
- Dois hemisférios (X<0 = E, X>0 = D) com fissura entre eles e giros (ruído na superfície). Cerebelo atrás/embaixo. Tronco encefálico e espinha descem pelo eixo -Y até cerca de Y=-900.
- Cada projeto recebe um setor contíguo do córtex (lobo). Subregiões são subsetores dentro dele.
- Profundidade pela idade: o mais antigo fica mais para dentro e o mais novo na superfície (o cérebro "cresce para fora").
- Nós `dia` ficam na espinha em ordem cronológica: o mais antigo embaixo e hoje no topo do tronco.
- Determinístico: a mesma entrada gera a mesma posição (PRNG com semente no id).

## Conteúdo (`GET /api/no/:id`)
```ts
{ no: No, entrada: {id,titulo,tipo,peso}[], saida: {...}[], vizinhos: {id,titulo,forca}[] /*top 12 por força*/,
  historico: { t: number, evento: string, hash?: string }[],
  conteudo: { formato: "markdown" | "texto" | "commit" | "sessao", corpo: string, extra?: any },
  maquina: { tags: string[], regiao: string, cluster: number, por: "regras"|"claude", em: number, nota?: string },
  correcao: { tags?: string[], regiao?: string } | null }
```
`POST /api/no/:id/correcao` com `{tags?, regiao?}` salva em `correcoes.json`.

## Outros endpoints
- `GET /api/busca?q=` → `{ resultados: {id,titulo,tipo,fonte,regiao,trecho}[] }` (até 50; título e texto)
- `GET /api/fontes` · `POST /api/fontes` `{tipo,caminho,projeto}` · `DELETE /api/fontes/:id` · `POST /api/reconstruir`
- `GET /api/maquina` → `{ ativos: Sessao[], arquivosPorMinuto: number[60], fila: number, telemetria: Linha[] /*últimas 200*/ }`

## WebSocket (`/ws`), mensagens JSON `{tipo, ...}`
- `ola` → `{ versao }` ao conectar
- `grafo` → `{ versao }` quando o grafo muda: o cliente busca `/api/graph` de novo e faz diff por `id` (mantém câmera; nós novos nascem com animação)
- `evento` → `{ t, nivel: "INFO"|"PULSO"|"ALERTA"|"HIST", fonte, msg, id?: string /*nó*/, hash?: string }`; cada evento com `id` dispara um pulso nas sinapses daquele nó
- `status` → a cada 1 s: `{ cpu: number /*% do processo*/, memMB: number, fila: number, uptime: number, eventosSeg: number }`
- `maquina` → a cada 2 s: o mesmo formato de `/api/maquina` sem telemetria

## Tokens visuais (sistema de temas; padrão "grafite")
A única fonte de cor é `web/js/tema.js` (`TEMAS`). Não deixar nenhuma cor fixa em CSS, canvas, rótulos, shaders ou na paleta de clusters.
```text
tokens de interface: fundo painel grade linha texto cinza apagado acento maquina alerta  → CSS: var(--<token>) no :root
tokens 3D:           obsidian git claude pasta dia                                       → tema.d3() (RGB 0..1, derivados)
grafite: fundo #0c0c0b painel #141413 grade #22211e linha #33312c texto #ece8df cinza #8f8a80 apagado #55524b
         acento #ff6a2b maquina #9fb4c7 alerta #ff6a2b · 3D obsidian #ece8df git #ff6a2b claude #9fb4c7 pasta #8f8a80 dia #7a3a1e
outros: ambar · mono · violeta (valores em tema.js)
fonte: "Martian Mono Variable"; números gigantes: font-stretch 75%, peso 800; rótulos: caixa alta, letter-spacing .08em.
zero border-radius; bordas 1px sólidas; scanlines e ruído sutis.
```
Troca: `tema.aplicar(nome)` dispara `aoTrocar`; o 3D refaz os buffers de cor (`Cerebro.aplicarTema`). Pela interface: tecla T, Ctrl+K → "tema", `?tema=nome` e localStorage `cortex.tema`.
O **acento** é raro (alertas, pulsos, destaques); **maquina** marca o que é da IA; **alerta** só aparece em erro ou AUSENTE.

## Desempenho
Meta: 20.000 neurônios e 60.000 sinapses a 60 fps. Neurônios desenhados num único `THREE.Points` com shader; sinapses num único `LineSegments`; pulsos num `Points` de buffer fixo. Rótulos em DOM limitados por orçamento (no máximo ~180 visíveis), escolhidos por proximidade da câmera e importância. `tools/bench.js` gera um grafo sintético **só para benchmark** (`?bench=20000`), nunca misturado com dados reais.

## V3: personalização, visões e uso por outras sessões

### Projeto certo para worktrees e clones
O PC do usuário tem `glass-pets` e mais de 100 pastas `gp-*` (worktrees/clones das sessões). Tudo isso é **um projeto só**. Ordem para descobrir o projeto de um caminho (sessão do Claude ou fonte):
1. `apelidos` na config: `{ "gp-*": "glass-pets" }` (glob simples em cima do basename; a config padrão já traz esse);
2. se o caminho estiver dentro de um repo git: `git rev-parse --git-common-dir` → basename do repo principal (pega worktrees); se for clone separado, basename do `remote.origin.url` sem `.git`;
3. basename do caminho.
O resultado é cacheado por caminho. A subregião de uma sessão é o basename original (`gp-alce`), assim o lobo do glass-pets mostra seus worktrees como sub-setores.

### Visões (filtros salvos)
```ts
Visao = {
  id: string, nome: string,
  projetos?: string[],        // vazio/ausente = todos
  fontes?: ("obsidian"|"git"|"claude"|"pasta")[],
  tipos?: No["tipo"][],
  desde?: number, ate?: number,    // epoch ms
  tags?: string[],                  // qualquer uma
  grauMin?: number,
  texto?: string,                   // filtro por título/caminho
  vizinhos?: 0|1|2                  // inclui vizinhos de fora do filtro até N saltos (esmaecidos)
}
```
- `GET /api/graph?visao=<id>` ou com os mesmos campos como query (`projetos=a,b&fontes=git&desde=...`) devolve o grafo filtrado **com layout refeito**: o(s) projeto(s) escolhido(s) ocupam o cérebro inteiro (subregiões viram os lobos). Os contadores e as regiões são do recorte. Campo extra na resposta: `visao: Visao|null`, `total: { neuronios, sinapses }` (do grafo completo). Nós de fora puxados por `vizinhos` vêm com `fora: true`.
- `GET /api/visoes` · `POST /api/visoes` (cria/atualiza por id) · `DELETE /api/visoes/:id` → `data/visoes.json`. Visões padrão criadas no boot: "TUDO" e uma por projeto ("SÓ GLASS-PETS", ...).
- `GET /api/visao/atual` · `POST /api/visao/atual` `{ id } | Visao` → muda a visão de **todas as janelas abertas** (WS `visao` → `{ visao }`). É assim que outra sessão "mostra" algo para o usuário.
- `GET /api/projetos` → `{ projetos: { nome, neuronios, notas, commits, sessoes, ultimoPulso, subregioes: string[] }[] }`

### Ajustes de interface (persistidos)
`GET/POST /api/ajustes` → `data/ajustes.json`:
```ts
{ tema: string, brilho: number /*0.3..2*/, tamanhoPonto: number, orcamentoRotulos: number /*0..400*/,
  densidadeRotulos: "minima"|"normal"|"maxima", mostrarSinapses: boolean, mostrarTecido: boolean,
  mostrarGrade: boolean, rotacaoAuto: boolean, paineis: { log, status, contadores, minimapa, linhaTempo: boolean },
  coresFonte?: { obsidian?, git?, claude?, pasta? },  // sobrepõe o tema
  som: boolean, visaoInicial: string }
```

### Diário das sessões
Outras sessões registram trabalho com `POST /api/registrar` `{ projeto, titulo, texto, tags?, autor?, ligar?: string[] /*ids ou títulos*/ }`. Isso grava um .md em `cortex/diario/<projeto>/AAAA-MM-DD-<slug>.md` com frontmatter (projeto, autor, tags, criado) e `[[links]]`. O `diario/` é uma fonte tipo `obsidian` interna, sempre ligada, com `projeto` = pasta. **Nunca escreve nos cofres do usuário.** Retorna `{ id, caminho }`.

### Resumo para agentes
`GET /api/resumo?projeto=<nome>&dias=7` → texto em markdown curto (máx. ~4 KB) para uma IA ler: contadores, últimos commits (msg, hash curto, data), últimas sessões (título, duração, ferramentas, arquivos), notas mais conectadas, notas mudadas no período, órfãos, entradas do diário. Sem projeto = visão geral de todos.

### CLI (`cortex` no terminal, para humanos e outras sessões)
`node <cortex>/cli.js <comando>`; o instalador cria `cortex.cmd` em `%USERPROFILE%\.cortex\bin` e põe no PATH do usuário. Se o servidor não estiver rodando, o CLI o liga em segundo plano (detached, sem janela) e espera até 30 s.
```
cortex status                         # rodando? porta, versão do grafo, contadores
cortex abrir [projeto]                # abre o navegador, já na visão do projeto
cortex projetos
cortex resumo [projeto] [--dias N]
cortex buscar "<texto>" [--projeto X] [--json]
cortex no <id|titulo> [--json]
cortex mostrar <projeto|visao> [--fontes git,claude] [--desde 7d]   # muda a visão nas janelas abertas
cortex registrar --projeto X --titulo "..." --texto "..." [--tags a,b] [--ligar id1,id2]
cortex conectar <obsidian|git|claude|pasta> "<caminho>" [--projeto X]
cortex reconstruir
cortex skill instalar                 # copia a skill para %USERPROFILE%\.claude\skills\cortex
```
Saída em português, curta, sem cor quando não for TTY; `--json` para máquinas.

### Skill do Claude Code
`skill/cortex/SKILL.md` (frontmatter `name: cortex`, `description` que dispara com "córtex", "cortex", "segundo cérebro", "registra no córtex", "mostra no córtex", "o que eu fiz em <projeto>"). O conteúdo ensina a sessão a: checar `cortex status`; ler contexto com `cortex resumo <projeto>` antes de trabalhar; buscar com `cortex buscar`; mostrar coisas para o usuário com `cortex mostrar`/`cortex abrir`; registrar o que fez com `cortex registrar` ao terminar uma tarefa importante; descobrir o projeto pela pasta atual (`cortex projetos`). Caminho real da instalação é preenchido pelo instalador (placeholder `{{CORTEX_DIR}}`). O `abrir-cortex.bat` e `cortex skill instalar` instalam/atualizam a skill e o CLI a cada execução (idempotente).
