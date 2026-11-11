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
  fonte: "obsidian" | "git" | "claude" | "pasta" | "diario" | "sistema",   // "diario" = registros de sessões (cortex/diario)
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
  fontes?: ("obsidian"|"git"|"claude"|"pasta"|"diario")[],
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
  coresFonte?: { obsidian?, git?, claude?, pasta?, diario? },  // sobrepõe o tema
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

### V3.1: correções do teste cego da skill
- **Ids:** `/api/no/:id`, `/api/busca`, `ligar` do `/api/registrar` e as correções aceitam id (16 hex), `idCurto` (6 hex) ou hash/sha do git (prefixo de 7+). Toda saída que lista neurônios traz `idCurto`, que é o formato "para citar".
- **Diário:** os neurônios do diário têm `fonte: "diario"` (tipo continua `nota`) e `autor` = quem registrou. `POST /api/registrar` devolve `{ id, idCurto, caminho, ligados, naoEncontrados }`.
- **`GET /api/status`** → `{ pronto: boolean, fase: "MONTANDO"|"PRONTO", versao, porta, neuronios, sinapses, contadores|null, cpu, memMB, fila, uptime, eventosSeg }`. A mensagem WS `status` também leva `pronto` e `fase`. Enquanto `fase` = MONTANDO, `/api/busca` responde `pronto: false` e `/api/listar`, `/api/no` e `/api/resumo` respondem 503 `{ erro: "carregando", pronto, fase }`.
- **`GET /api/busca?q=&projeto=&limite=50`**: termos de 2+ caracteres. Ordem: id/idCurto/hash > título exato > prefixo > substring no título > substring no caminho > texto > tag > nome de tipo ("commit", "sessões"…). Itens: `{ id, idCurto, titulo, tipo, fonte, regiao, projeto, hash, modificado, trecho }`.
- **`GET /api/listar?projeto=&desde=7d&ate=&tipos=commit,sessao&fontes=&limite=200&ordem=recente|antigo|criado|grau|titulo`** → `{ total, limite, ordem, itens: { id, idCurto, tipo, fonte, titulo, regiao, projeto, criado, modificado, autor, hash }[] }`. Forma oficial de listar tudo de um projeto num período (`desde` filtra por `modificado`, `ate` por `criado`; sem `tipos`, os nós `dia` ficam de fora).
- **`GET /api/resumo`**: seções sempre presentes (escrevem "nenhum" quando vazias); listas cortadas dizem "N de M" e apontam `cortex listar …`; sessões principais e de agentes contadas e listadas separadamente. `?formato=json` → `{ encontrado, projeto, dias, desde, geradoEm, versao, contadores: { neuronios, notas, commits, linhas, sessoes, agentes, horasIA, ferramentas, diario, mudaramNoPeriodo }, commits, sessoes, agentes, diario, maisConectados, mudados, orfaos, projetos? }`, onde cada lista é `{ total, itens[] }` e cada item tem `id`, `idCurto`, `tipo`, `titulo`, `criado`, `modificado` + campos próprios (commits: `hash` de 7, `mais`, `menos`, `autor`; sessões/agentes: `pasta`, `duracaoMs`, `ferramentas`, `arquivos`, `autor`, `agente?`; maisConectados: `grau`). Projeto inexistente: `{ encontrado: false, projetosConhecidos }`.

## V4: CÓRTEX vira app de desktop

### Casca (Electron 33.4.11, electron-builder fixado)
- `app/main.js`: o processo principal do Electron **roda o servidor dentro dele** (`require('../server')` exporta `iniciar({ porta, dadosDir, configPath }) → Promise<{ porta, parar }>`; `node server/index.js` continua funcionando sozinho). Janela própria **sem moldura do sistema** (barra de título brutalista desenhada pela interface, com minimizar/maximizar/fechar via preload), ícone próprio, instância única (abrir de novo foca a janela), bandeja do sistema (abrir, mostrar projeto…, reconstruir, pausar vigilância, sair), fechar = minimizar para a bandeja (configurável), iniciar com o Windows (configurável, `app.setLoginItemSettings`), atalho global configurável para mostrar/esconder (padrão Ctrl+Alt+C).
- `app/preload.js` expõe `window.cortexApp = { janela: {min,max,fechar}, escolherPasta(), abrirCaminho(p), versao, plataforma, aoMudarBandeja(cb) }`. A interface funciona igual no navegador (sem `cortexApp`) para desenvolvimento.
- Se outra instância (ou um `node server/index.js`) já estiver na porta, o app se conecta a ela em vez de subir outra.
- Sem dependência de Node instalado: o CLI roda com o próprio executável (`ELECTRON_RUN_AS_NODE=1 "<CORTEX.exe>" "<app>\cli.js"`); o `cortex.cmd` gerado pelo instalador usa isso. O CLI, se o servidor não responde, liga o **app** (escondido na bandeja) quando instalado; senão cai no `node server/index.js`.
- Entrega Windows: `dist/CORTEX-win-x64.zip` (pasta portátil com `CORTEX.exe`) gerado com electron-builder no Linux (`signAndEditExecutable: false` se precisar). Dados do usuário ficam em `%APPDATA%\CORTEX\` (config, data/, diario/) — não dentro da pasta do app — para atualizar o app sem perder nada. Migração: se existir `cortex.config.json`/`data/`/`diario/` ao lado do app (instalação antiga), copia na primeira execução.
- `Instalar CORTEX.bat` (ou o próprio app na primeira execução): atalho na Área de Trabalho e no Menu Iniciar, `cortex` no PATH, skills no Claude Code, bloco no CLAUDE.md.

### Navegação do app (interface)
Barra lateral fixa com seções: **CÉREBRO** (a vista 3D atual), **PROJETOS**, **DIÁRIO**, **SKILLS**, **CONFIGURAÇÕES**. Barra de título com breadcrumb (`CÓRTEX / PROJETOS / GLASS-PETS / CÉREBRO`) e Ctrl+K global.
- **PROJETOS**: grade de cartões (nome, serial, neurônios, commits, sessões, horas IA, último pulso, minigráfico 30d, mini-silhueta do cérebro do projeto). Clicar abre a **página do projeto**: cabeçalho com contadores, abas `CÉREBRO` (visão isolada do projeto), `ATIVIDADE` (linha do tempo de commits/sessões/notas/diário), `RESUMO` (render de `/api/resumo?projeto=`), `FONTES` (fontes desse projeto + apelidos), `DIÁRIO`. Navegação entre projetos com ← → e lista lateral; favoritar projetos (fixados no topo); esconder projetos.
- **DIÁRIO**: lista de entradas de todas as sessões, filtro por projeto/autor, abrir no cérebro.
- **SKILLS**: ver abaixo.
- **CONFIGURAÇÕES** com sub-seções: GERAL (idioma fixo PT, iniciar com Windows, fechar para bandeja, atalho global, porta), FONTES (lista + adicionar com seletor de pasta nativo + apelidos de projeto `gp-* → glass-pets` editáveis + ignorar padrões), ORGANIZAÇÃO (regras locais ligadas, Claude liga/desliga, chave da API guardada só localmente, modelo, limite por hora, botão "testar"), APARÊNCIA (temas prontos + **editor de tema próprio** com color pickers para todos os tokens, salvar/duplicar/exportar/importar JSON; intensidade de scanlines, ruído, brilho, tamanho dos pontos, densidade/orçamento de rótulos, fonte da interface: tamanho base e largura; animações reduzidas), CÉREBRO (forma: profundidade por idade, espaçamento de lobos, mostrar tecido/grade/sinapses, rotação automática, velocidade do replay padrão), DESEMPENHO (limite de neurônios desenhados, FPS máximo, qualidade de sinapses), NOTIFICAÇÕES (toast quando sessão registra no diário / commit novo), DADOS (abrir pasta de dados, exportar grafo JSON, limpar cache, reconstruir), SOBRE (versão, caminhos).

### Configuração ampliada
`GET/POST /api/config` → `{ geral, organizacao, cerebro, desempenho, notificacoes }` (seções; validação no servidor; mudança que exige reconstrução avisa). `GET/POST/DELETE /api/temas` → temas próprios em `data/temas.json` (`{ id, nome, base, tokens: {...todos os tokens de tema.js} }`). Chave do Claude: `POST /api/config/chave { chave }` grava em `<dados>/.env`, nunca volta inteira na API (só `"sk-...ab12"`). `/api/ajustes` continua para o que é visual.

### Skills dentro do app
Pasta `skills/` no app (substitui `skill/`), cada uma `skills/<nome>/SKILL.md` + `meta.json` `{ nome, titulo, descricao, executavel: boolean, parametros: [{nome, tipo, opcoes?}] }`:
- `cortex` — base (a skill atual).
- `cortex-contexto` — antes de começar a trabalhar num projeto, carregar contexto (resumo, últimas sessões, diário, notas centrais).
- `cortex-registrar` — ao terminar uma tarefa relevante, registrar no diário com ligações.
- `cortex-onde-parei` — "onde parei?": última sessão do projeto, arquivos tocados, último commit, entradas pendentes do diário.
- `cortex-revisao-semanal` — revisão semanal de um projeto, gravada no diário.
- `cortex-ligacoes` — acha órfãos e notas que se citam sem link e **sugere** ligações (grava sugestão no diário; nunca edita o cofre).
Na seção SKILLS: cartão por skill com descrição, status no Claude Code (instalada / desatualizada / não instalada), botões INSTALAR/ATUALIZAR/REMOVER (em `%USERPROFILE%\.claude\skills\<nome>`), VER SKILL.md, e **EXECUTAR AQUI** para as executáveis (onde-parei, revisao-semanal, ligacoes, contexto): roda no servidor de forma determinística (sem IA) e mostra o resultado; se o Claude estiver ligado nas configurações, pode refinar o texto.
- `GET /api/skills` → `[{ ...meta, instalada, versaoInstalada, versaoApp, caminho }]` · `POST /api/skills/:nome/instalar|remover` · `POST /api/skills/:nome/executar { projeto, ... }` → `{ markdown, dados, registradoEm? }`.
- CLI: `cortex skills`, `cortex skill instalar [nome|todas]`, `cortex executar <skill> --projeto X`.

### V3.2: ajustes do segundo teste cego
- **`grau`** = nº de vizinhos distintos, **sem** a ligação com o nó `dia` e sem contar duas vezes sinapses de tipos diferentes entre o mesmo par. Bate com o tamanho de `vizinhos` quando há ≤ 12. Para nós `dia`, o grau conta os neurônios daquele dia.
- **Arquivos do git:** um nó por caminho relativo no projeto, mesmo vindo de vários worktrees ou clones. `caminho` é o checkout real onde o arquivo existe (o repo principal primeiro). Campo extra `worktrees: string[]` (pastas onde existe) no nó, em `/api/listar` e em `/api/busca`. Se só existir no worktree: título `"bosque.lua · gp-b"`. Se só existir numa branch sem worktree (ou tiver sido apagado): `caminho: null` e título `"fantasma.lua @ so-branch"`. Arquivo que é uma nota do Obsidian em qualquer checkout vira a própria nota.
- **Branches de clone separado** levam o nome do clone: `"main · gp-clone"`.
- **Subregião da raiz** de um cofre, pasta ou repo chama `"raiz"` (antes era `"/"`, o que gerava "glass-pets//").
- **`tagsAutor: string[]`**: tags de quem escreveu (frontmatter `tags` e `#inline`, incluindo as de `/api/registrar`) no nó (quando não vazias), no topo da resposta de `/api/no` e na busca (que acha por elas). `tags` continua sendo só a interpretação da máquina.
- **`/api/resumo?dias=0`** ou **`?tudo=1`**: todo o histórico; o cabeçalho diz "todo o histórico" e o JSON traz `dias: 0, desde: 0`.

### V4: servidor (implementado)
- **`require('./server').iniciar({ porta?, dadosDir?, configPath?, appDir? })` → `Promise<{ porta, url, dadosDir, configPath, parar(): Promise<void> }>`**. Sem `process.exit`, sem abrir navegador e sem efeito colateral no `require`. `porta: 0` = porta livre qualquer. Se a porta estiver ocupada, a promessa rejeita com `err.code === 'EADDRINUSE'` (o app então se conecta à instância existente). Retorna logo; o grafo monta em segundo plano (`/api/status` → `fase: "MONTANDO"` → `"PRONTO"`). `node server/index.js [--abrir]` continua igual.
- **Diretórios:** `dadosDir` = `iniciar({dadosDir})` → env `CORTEX_DADOS` → env `CORTEX_DATA` (apelido antigo) → `appDir`. Dentro dele ficam `cortex.config.json`, `data/`, `diario/`, `.env`. `configPath` = `iniciar({configPath})` → env `CORTEX_CONFIG` → `<dadosDir>/cortex.config.json`. **Migração única:** se `dadosDir` ≠ `appDir`, não tem config e o `appDir` tem `cortex.config.json`/`data/`/`diario/`/`.env`, tudo é copiado (os originais ficam) e é criado `<dadosDir>/.migrado-de-instalacao-antiga`.
- **`GET /api/config`** → `{ geral{porta,iniciarComWindows,fecharParaBandeja,atalhoGlobal,idioma}, organizacao{regrasLocais,limitePorHora,claudeAtivo,modelo,temChave,chave(mascarada),claudeLigado}, cerebro{profundidadeIdade 0..3,espacamentoLobos 0..4,mostrarTecido,mostrarGrade,mostrarSinapses,rotacaoAuto,velocidadeReplay}, desempenho{limiteNeuronios,fpsMax,qualidadeSinapses baixa|media|alta}, notificacoes{registroDiario,commitNovo,sessaoNova}, fontes{apelidos{glob:projeto},ignorar[globs]}, caminhos{appDir,dadosDir,configPath,dataDir,diarioDir} }`. **`POST /api/config`** com qualquer subconjunto → `{ ok, mudancas[], precisaReconstruir, precisaReiniciar, config }` ou 400 `{ erro, erros:[{campo,erro}] }` (nada é gravado se algo for inválido). `precisaReconstruir` para apelidos, ignorar, profundidadeIdade, espacamentoLobos e regrasLocais; `precisaReiniciar` para a porta. WS `config` → `{ config, mudancas }`.
- **`fontes.ignorar`**: globs testados contra cada pasta/arquivo do caminho de notas, docs e arquivos do git (padrão: `*.tmp`, `~$*`, `Thumbs.db`, `.DS_Store`).
- **Chave:** `GET /api/config/chave` → `{ temChave, chave: "sk-...ab12" }`; `POST { chave }` grava em `<dadosDir>/.env`; `DELETE` apaga; `POST /api/config/chave/testar { chave?, modelo? }` → `{ ok, modelo } | { ok:false, erro, status? }`. A chave inteira nunca sai da API.
- **Temas:** `GET /api/temas` → `{ temas[], prontos[] }`; `POST { id?, nome, base, tokens }` (tokens: texto ≤64, número ou lista de textos; ids dos temas prontos viram `meu-<id>`); `DELETE /api/temas/:id`. WS `temas` quando muda.
- **Skills:** `GET /api/skills` → `[{ nome, titulo, descricao, executavel, parametros, versaoApp, versaoInstalada, instalada, status: "instalada"|"desatualizada"|"nao-instalada", caminho, origem, executor }]`; `GET /api/skills/:nome` → o mesmo + `conteudo` (SKILL.md renderizado); `POST /api/skills/:nome|todas/instalar|remover` → `{ ok, resultados[], skills[] }`. `remover` só apaga pastas com o marcador `cortex-skill`. Env `CORTEX_HOME` troca a home (testes).
- **`POST /api/skills/:nome/executar`** (`onde-parei`, `revisao-semanal`, `ligacoes`, `contexto`; aceita com ou sem `cortex-`) corpo `{ projeto, dias?, gravar?, limite?, refinar? }` → `{ skill, markdown, dados, ms, refinado, registradoEm?: { id, idCurto, caminho }, aviso?, markdownDeterministico? }`. Erros: 400/404 `{ erro, projetos[] }`. `refinar: true` só usa o Claude se ele estiver ligado com chave; senão volta o determinístico com `aviso`.
- **Projetos:** `GET /api/projetos` → `{ projetos: [{ nome, slug, regiao, serial, neuronios, notas, commits, linhas, sessoes, agentes, horasIA, ferramentas, diario, ultimoPulso, atividade30d[30], subregioes, caminhos, favorito, oculto }] }` (favoritos primeiro; ocultos vêm com `oculto: true`). `GET /api/projetos/:nome` → um cartão. `POST /api/projetos/:nome { favorito?, oculto? }` → grava em `data/projetos.json`; WS `projetos`. `GET /api/projetos/:nome/atividade?limite=100&desde=7d` → `{ projeto, total, itens: [{ t, tipo: commit|sessao|agente|diario|nota-criada|nota-editada|doc-criado|doc-editado, id, idCurto, titulo, autor, fonte, ... }] }`.
- `/api/listar` e `/api/busca` trazem `tags`, `tagsAutor` e `worktrees` quando existirem.
- **Vigilância (bandeja do app):** `GET /api/vigilancia` → `{ pausada }`; `POST /api/vigilancia { pausada: boolean }` → `{ ok, pausada, mudou }`. Pausar fecha todos os watchers. Retomar religa os watchers e reconstrói tudo, para pegar o que mudou durante a pausa. As duas ações emitem um `evento` no log e a mensagem WS `vigilancia` → `{ pausada }`. `/api/status` traz `vigilanciaPausada`. O estado não persiste: o app sempre abre vigiando.
- **Skill `onde-parei`:** aceita `pasta` (o cwd de quem chama). Sem `projeto`, o projeto vem de `pasta` (apelidos, git, fontes). Se a pasta for um worktree ou clone, primeiro vem o que aconteceu ali: sessões com aquele cwd e commits da branch dele (`git log` do checkout). Depois vem o resto do projeto. Cada item leva o rótulo "arquivo · worktree · branch" (sessões: `worktree · branch`; commits: o worktree/branch onde estão, ou a ref pela qual o git os alcançou). Em `dados`: `pasta{caminho,worktree,branch,sessoesAqui,commitsAqui}`, `ultimaSessaoDoProjeto`, `commits[].rotulo`, `ultimaSessao.arquivos[{caminho,rotulo}]`.
- **Skill `revisao-semanal`:** `ignorarTeste` (padrão false) tira as sessões e notas com "teste" no título e informa quantas saíram (`dados.tirados{sessoes,notas}`).
- Tags da máquina de worktrees e branches usam só os nomes relativos (o caminho absoluto acima da raiz da fonte não entra).
- **Diário nunca sobrescreve:** se o arquivo `AAAA-MM-DD-<slug>.md` já existir, o registro vira `-2`, `-3`… A escrita usa a flag `wx`, que também protege contra dois registros simultâneos.
- **`POST /api/cache/limpar`** apaga `data/cache/` e a interpretação da máquina (`data/maquina.json` e o cache em memória do classificador); as correções do usuário ficam. Depois reconstrói tudo e responde `{ ok, liberadoMB, versao, ms }`.

## V5: sincronização entre PCs

O usuário usa o CÓRTEX em mais de um PC. Cada instalação só enxerga o disco local; a V5 junta os cérebros.

### Modelo
- Cada instalação tem `maquina = { id (uuid estável em <dados>/maquina.json), nome (padrão: hostname, editável) }`.
- **Pasta de sincronização** escolhida pelo usuário (qualquer pasta que um serviço já sincroniza: OneDrive, Google Drive, Dropbox, rede ou pendrive). Estrutura:
  ```
  <pasta>/CORTEX-SYNC/
    LEIA-ME.txt
    maquinas/<id>/manifesto.json   { id, nome, versaoApp, geradoEm, contadores, projetos[], fontes[{tipo,projeto,caminho}] }
    maquinas/<id>/pacote.json.gz   { formato: 1, maquina, geradoEm, nos[], sinapses[], conteudos{ id: {formato, corpo} } }
  ```
  Cada máquina **só escreve na própria pasta** (sem conflitos de sincronização). Escrita atômica (tmp + rename), no máximo a cada `intervaloMin` (padrão 2) e logo depois de uma reconstrução; ao fechar o app, publica uma última vez.
- O pacote leva **só o que veio das fontes locais** dessa máquina (nunca reexporta o que leu de outra máquina), mais o diário local. Opções do que compartilhar: `notas: "conteudo" | "metadados"` (padrão conteudo), `git`, `sessoes`, `pastas`, `diario` (padrão todas true). Conteúdos grandes cortados (nota > 200 KB → só os primeiros 200 KB).
- Ler: todas as `maquinas/*` com id ≠ o meu viram fontes internas `remoto` (status visível em /api/fontes com `maquina`). Vigia `<pasta>/CORTEX-SYNC/maquinas/` (chokidar, com debounce de 5 s, tolerante a arquivo parcial/corrompido: ignora e tenta de novo depois).
- **Junção**: tudo cai no projeto pelo nome (as regras de apelido valem também para o que vem de fora). Duplicatas viram um nó só, com `maquinas: [nomes]`:
  - commit: projeto + sha;
  - nota de cofre: projeto + caminho relativo ao cofre (fica a versão com `modificado` mais recente; o conteúdo vem dela);
  - arquivo do git: projeto + caminho relativo;
  - sessão do Claude: sessionId;
  - diário: projeto + nome do arquivo;
  - dia: data.
  Os ids dos nós são estáveis entre máquinas (hash da chave natural acima, sem caminho absoluto), assim citar `idCurto` funciona em qualquer PC.
- Todo nó ganha `maquina` (nome de onde veio; se veio de várias, a primeira) e `maquinas` (lista). `/api/no/:id` funciona para nós remotos (conteúdo do pacote). "Abrir no disco" só aparece se o caminho existir nesta máquina.
- Visões ganham o filtro `maquinas?: string[]`.

### API
- `GET /api/sync` → `{ ativo, pasta, maquina, compartilhar, intervaloMin, ultimaPublicacao, erro?, sugestoes: [{rotulo, caminho}] /*OneDrive, Google Drive, Dropbox detectados*/, maquinas: [{ id, nome, eu, geradoEm, neuronios, projetos, status: "OK"|"ANTIGO"|"ERRO" }] }`
- `POST /api/sync` `{ ativo?, pasta?, nome?, compartilhar?, intervaloMin? }` · `POST /api/sync/agora` (publica e relê) · `POST /api/sync/exportar` `{ caminho }` (grava um `.cortexpack` avulso) · `POST /api/sync/importar` `{ caminho }` (copia o pacote para `<dados>/importados/` e trata como máquina remota, mesmo sem pasta sincronizada) · `DELETE /api/sync/maquinas/:id` (esquecer uma máquina: só para de ler; não apaga arquivos alheios, exceto pacotes importados).
- WS `sync` → o mesmo objeto de `GET /api/sync` quando muda. Eventos no log: "PUBLICADO", "RECEBIDO DE <PC>".
- Config: seção `sync` em `/api/config`.

### CLI
`cortex sync` (status) · `cortex sync pasta "<caminho>"` · `cortex sync ligar|desligar` · `cortex sync agora` · `cortex sync nome "<nome>"` · `cortex sync exportar <arquivo>` · `cortex sync importar <arquivo>`.

### Interface
- CONFIGURAÇÕES → **SINCRONIZAÇÃO** (nova subseção): liga/desliga, escolher pasta (seletor nativo + botões das sugestões detectadas), nome deste PC, o que compartilhar, intervalo, tabela de máquinas (nome, última publicação, neurônios, projetos, status, esquecer), "sincronizar agora", exportar/importar pacote, aviso claro de que ligar envia dados para a pasta escolhida (e, portanto, para o serviço de nuvem dela).
- **Cérebro vazio** (zero neurônios ou só fontes AUSENTE): tela de boas-vindas com 2 caminhos grandes: "CONECTAR FONTES DESTE PC" e "SINCRONIZAR COM OUTRO PC" (atalho para a subseção, com as sugestões de pasta já listadas).
- Indicador na barra de título: `SYNC ● 2 PCs` (clicar abre a subseção). Neurônios remotos têm marca de máquina nos rótulos/anel/painel ("DE: PC-ESCRITORIO"), e o painel VISÃO ganha filtro por máquina. Página do projeto mostra de quais PCs vieram os dados.

### V5: servidor (implementado)
- **Ids estáveis entre PCs:** as chaves deixaram de usar caminho absoluto. Nota `nota:<projeto>:<pasta-do-cofre>/<caminho relativo>`, diário `diario:<projeto>/<arquivo>`, doc `doc:<projeto>:<pasta>/<relativo>`, arquivo do git `arquivo:p:<projeto>:<relativo>`, branch `branch:p:<projeto>:<repo>:<ref>`, worktree `worktree:p:<projeto>:<pasta>`; commit, sessão e dia não mudaram. Tudo em minúsculas, para Windows e Linux darem o mesmo id. Na primeira montagem, `correcoes.json` e `maquina.json` (interpretações) migram dos ids antigos para os novos uma vez só (marca `data/.ids-v5`). `projetos.json` é por nome de projeto e não precisou migrar.
- **Máquina:** `<dados>/maquina.json` `{ id (uuid), nome (hostname) }`. Todo nó público tem `maquina` (de onde veio; nos nós locais, este PC) e `maquinas` (todas). Nós só remotos têm `remoto: true`. `/api/listar` e `/api/busca` trazem `maquinas` e `remoto`. `/api/no/:id` ganha `origem: { maquina, maquinas, remoto, conteudoDe, existeAqui }` e, para nota/doc vindos de fora (ou cuja versão mais nova é remota), o conteúdo sai do pacote. `/api/projetos` traz `maquinas[]` em cada cartão.
- **Junção:** duplicatas por chave viram um nó, com `maquinas` somadas. Em nota/doc vale o `modificado` mais recente (título, hash e conteúdo dele), e a versão local é guardada à parte para o pacote nunca reexportar dado alheio. Remotos entram depois das fontes locais e seguem os apelidos de projeto. Caminhos de outro PC não resolvem ligações locais.
- **Pacote:** `pacote.json.gz` `{ formato: 1, maquina, versaoApp, geradoEm, nos[], sinapses: [a, b, tipoIdx, peso][], conteudos{chave: texto} }`. Leva só nós e sinapses das fontes locais (sem dias, DIA e SEQ calculados). `texto` só vai quando não há conteúdo; notas > 200 KB são cortadas. Publica só se o hash do conteúdo local mudou (sem pingue-pongue entre PCs), no máximo a cada `intervaloMin`, e uma última vez ao `parar()`. Medido com obsidian-help (10.621 neurônios, 48.761 sinapses): **2,4–2,6 s, 12,2 MB gzip (44 MB sem compressão)**; com `notas: "metadados"`, **0,3 s e 1,4 MB**.
- **Leitura:** `<pasta>/CORTEX-SYNC/maquinas/*` (≠ eu, fora das `esquecidas`) e `<dados>/importados/*.cortexpack`. O chokidar vigia com debounce de 5 s, e uma varredura roda a cada `intervaloMin` (nem todo serviço de nuvem gera eventos). Pacote ilegível (gzip/JSON cortado): mantém a última versão boa, status `ERRO` com `erro`, um `ALERTA` só por arquivo e nova tentativa em 30 s. Pacote com `geradoEm` de mais de 14 dias fica `ANTIGO`. `/api/fontes` lista cada máquina como `{ id: "rem_<id>", tipo: "remoto", maquina, origem: "pasta"|"importado", status, itens, erro? }`.
- **API:** como no contrato acima. `POST /api/sync` valida (`pasta` precisa existir, `intervaloMin` de 0,5 a 1440, `nome` de 1 a 40 caracteres, `compartilhar.notas` = conteudo|metadados) e devolve `{ ok, mudancas, ...estado }`. `POST /api/sync/agora` → `{ publicado, recebidos, ...estado }`. `exportar { caminho }` acrescenta `.cortexpack` se faltar e devolve `{ caminho, bytes, neuronios, sinapses }`. `importar { caminho }` recusa o pacote do próprio PC e devolve `{ maquina, neuronios, geradoEm, caminho }`. `DELETE /api/sync/maquinas/:id`: pacote importado é apagado; máquina da pasta vai para `sync.esquecidas` (os arquivos alheios ficam).
- **Config:** a seção `sync` `{ ativo, pasta, nome, compartilhar, intervaloMin }` aparece em `GET /api/config` e é aceita em `POST /api/config`. Visões aceitam `maquinas` (também em `?maquinas=PC-A,PC-B`).
- **Sugestões de pasta:** Windows: `%OneDrive%`, `%OneDriveConsumer%`, `%OneDriveCommercial%`, `<HOME>\Google Drive`, `G:\My Drive`, `G:\Meu Drive`, `<HOME>\Dropbox`, `%USERPROFILE%\iCloudDrive`. Linux/mac: `~/OneDrive`, `~/Google Drive`, `~/GoogleDrive`, `~/google-drive`, `~/Dropbox`, `~/iCloudDrive` e `~/Library/Mobile Documents/com~apple~CloudDocs`. Só as que existem.
- **V5.1: pacote dividido por fonte.** A pasta de cada máquina passa a ter `manifesto.json` `{ formato: 2, id, nome, versaoApp, geradoEm, contadores, projetos, fontes, partes: [{ arquivo, fonte, tipo, projeto, hash, neuronios, sinapses, bytes, geradoEm, contadores, projetos }] }` e um `<fonteId>.json.gz` por fonte local, mais `src-diario.json.gz`. Cada parte: `{ formato: 2, maquina, fonte{id,tipo,projeto}, hash, geradoEm, nos[], sinapses[], conteudos{} }`. Nas sinapses, `a`/`b` é um índice nesta parte ou a **chave** de um nó de outra parte. O `hash` vem do conteúdo antes de serializar, e só a parte cujo hash mudou é reescrita. O manifesto é escrito por último, e quem lê só baixa as partes com hash diferente do que já tem. Parte com hash diferente do manifesto conta como "ainda sincronizando": mantém a versão anterior e tenta de novo em 30 s. Ao reabrir, o app aproveita o manifesto que já está na pasta. O `pacote.json.gz` único (formato 1) continua sendo lido quando não há manifesto formato 2, e o `.cortexpack` exportado continua um arquivo só (formato 1). Em `/api/sync`, `maquinas[].partes` e `ultimaPublicacao{ bytes, bytesEscritos, partesEscritas[], partes, ms }`; em `/api/fontes`, uma entrada `rem_<id>` por máquina com `partes`. Medido: a publicação inicial do obsidian-help manda 12,2 MB em 8 partes, e a **publicação típica com uma sessão ativa troca só a parte das sessões: ~9 KB + manifesto de ~5 KB (14 KB, 74 ms)**. Quem lê baixa só esses 9 KB.
