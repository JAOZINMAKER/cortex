# DECISÕES

Registro do que foi decidido sem te perguntar, e por quê.

## D-001 · Servidor local + navegador, não Electron/Tauri
Um `node server/index.js` serve a página em `127.0.0.1:4747` e o `abrir-cortex.bat` liga tudo e abre o navegador com um clique. O Electron somaria uns 150 MB e o Tauri exigiria Rust instalado. O navegador já tem WebGL acelerado pela GPU e o servidor escuta só em `127.0.0.1`, então nada fica exposto na rede.

## D-002 · Direção visual B, "Terminal de Alarme"
A folha `direcoes-visuais.html` compara três direções: A Concreto, B Terminal de Alarme e C Criogênico. A escolhida foi a B:
- **Contraste:** luz sobre preto é o que mais aguenta milhares de pontos e rótulos ao mesmo tempo.
- **Vermelho:** é alarme e só funciona porque é raro (pulsos, commits, avisos).
- **Ciano:** fica reservado ao que é da máquina e da IA (sessões do Claude e tags da máquina), o que separa a interpretação da máquina do original.

A A perde legibilidade com muitos pontos. A C fica com cara de ficção científica genérica e intimida menos.

## D-003 · Tipografia: Martian Mono Variable, servida localmente
É monoespaçada e tem eixo de largura, que vai de 75% (condensada, para os números gigantes) até a largura normal (texto). Vem do npm com versão fixa, sem CDN.

## D-004 · Anatomia com significado
- **Córtex:** cada projeto ocupa um lobo, e as subpastas viram sub-setores dentro dele.
- **Profundidade = idade:** o antigo fica por dentro e o novo na superfície, então o cérebro cresce para fora.
- **Cerebelo:** os arquivos tocados pelo git ficam aqui, para não poluir o córtex de ideias.
- **Tronco e espinha:** são a linha do tempo. Cada dia com atividade é uma vértebra, o mais antigo embaixo e hoje no topo. O replay mostra o cérebro nascendo pela espinha.
- **Mesma região:** fontes com o mesmo nome de projeto caem juntas. O cofre `glass-pets\wiki`, o repo `glass-pets` e as sessões abertas na pasta `glass-pets` formam um lobo só.

## D-005 · O que vira neurônio
| Neurônio | Origem |
|---|---|
| Nota | nota do Obsidian; `[[links]]` e `![[embeds]]` viram sinapses |
| Commit | commit de qualquer branch; liga ao pai, aos arquivos tocados e à branch |
| Branch e worktree | branches e worktrees do repositório |
| Arquivo | arquivo tocado no git; no máximo 3.000 por repo, os mais tocados primeiro |
| Sessão | sessão do Claude Code; liga aos arquivos que tocou e à próxima sessão do mesmo projeto |
| Agente | subagente do Claude Code; vira sessão com autor "AGENTE" |
| Dia | dia com atividade; é a vértebra da espinha |

Quando o arquivo tocado é uma nota do cofre, a ligação vai direto para a nota, sem criar um neurônio duplicado.

## D-006 · Organização automática em duas camadas
O classificador local por regras e TF-IDF está sempre ligado e roda offline. O Claude é **opcional**: só entra com `"claude": { "ativo": true }` no `cortex.config.json` **e** com `ANTHROPIC_API_KEY` no `.env`. Mesmo assim, só envia título e trecho de neurônios novos ou alterados, e qualquer falha cai de volta nas regras.

A interpretação da máquina fica em `data/maquina.json` e as suas correções em `data/correcoes.json`, que sempre vencem. O texto original nunca é tocado.

## D-007 · Atualização ao vivo
O chokidar vigia os cofres, as pastas, os `.git` (HEAD, refs, logs) e a pasta de projetos do Claude. O debounce é de 1,5 s, ou 4 s no git, que grava vários refs por operação. Sob atividade contínua há um teto de 10 s. Só a fonte afetada é relida. Mensagens novas numa sessão atualizam os metadados no lugar, sem remontar o grafo.

## D-008 · Desempenho
A meta é 20 mil neurônios e 60 mil sinapses a 60 fps:
- **Desenho:** um único `Points` com shader para os neurônios, um `LineSegments` para as sinapses e um buffer fixo de pulsos.
- **Rótulos:** em DOM, com orçamento de cerca de 180 e colisão por importância.
- **Medição:** `npm run bench` mede com um grafo sintético, marcado em tela como "BENCH — DADOS SINTÉTICOS", que nunca se mistura aos dados reais.

No container sem GPU onde foi construído, o JavaScript gastou 4,7 ms por quadro com 20 mil neurônios, dentro do limite de 16,7 ms para 60 fps. O fps real depende da sua placa de vídeo: rode `npm run bench` no PC para confirmar.

## D-009 · Só dados reais
Nenhum dado de exemplo é inventado. Fonte que não existe aparece como **AUSENTE**. Os eventos HIST no log são commits e chamadas de ferramenta reais, com o horário original.

## D-010 · Versões fixas
Todas as dependências estão fixadas: three 0.169.0, chokidar 3.6.0, ws 8.18.0, marked 14.1.2 e @fontsource-variable/martian-mono 5.1.0. O `package-lock.json` vai junto.

## D-011 · Referência conceitual
Do mindcorpus veio só a ideia: um cérebro que nasce do tronco e uma barra de comando. Código, layout, textos e arte são próprios.
