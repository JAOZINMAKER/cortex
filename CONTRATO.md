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
