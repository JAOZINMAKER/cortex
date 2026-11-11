# DECISÕES

Registro do que foi decidido sem te perguntar, e por quê.

## D-001 · Servidor local + navegador, não Electron/Tauri
Um `node server/index.js` serve a página em `127.0.0.1:4747` e o `abrir-cortex.bat` liga tudo e abre o navegador com um clique. O Electron somaria uns 150 MB e o Tauri exigiria Rust instalado. O navegador já tem WebGL acelerado pela GPU e o servidor escuta só em `127.0.0.1`, então nada fica exposto na rede.

## D-002 · Paleta: sistema de temas, padrão "Grafite"
O primeiro vermelho e o ciano neon ficaram estridentes. A paleta foi trocada por 4 temas, e toda cor sai de um único arquivo, `web/js/tema.js`. O CSS usa variáveis no `:root`, e o canvas, os SVGs, os shaders e os clusters leem os mesmos tokens e se refazem ao trocar de tema, sem recarregar a página. Para trocar: tecla T, Ctrl+K → "tema" ou `?tema=nome`. A escolha fica lembrada em localStorage.
- **Grafite (padrão):** fundo #0c0c0b, painel #141413, grade #22211e, linha #33312c, texto #ece8df, cinza #8f8a80, apagado #55524b, acento #ff6a2b, máquina #9fb4c7, alerta #ff6a2b.
- **Âmbar:** fósforo CRT. **Mono:** cinzas puros com acento verde-ácido. **Violeta:** frio. Os tokens de cada um estão em `tema.js` e em `direcoes-visuais.html`.

Regras:
- **Acento:** é a única cor forte e aparece raramente (alertas, pulsos, números de destaque).
- **Máquina:** marca tudo que é da IA e as tags da máquina.
- **Alerta:** só para erro ou fonte AUSENTE.
- **Massas grandes:** usam o tom de texto e o cinza. O git aparece atenuado e o blending aditivo sai menos saturado.
- **Calor e idade:** usam o gradiente apagado → texto → acento.

A escolha do Grafite tem três motivos. Um acento só, quente e raro, faz o app parecer uma máquina industrial, não um neon. As massas em osso e cinza mantêm milhares de pontos legíveis. O azul-aço frio separa a IA sem gritar.

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

## D-012 · App de desktop com Electron
O usuário pediu um app, não um site. A escolha foi o Electron 33, e não o Tauri, por quatro motivos:
- o servidor já é Node e roda dentro do processo principal;
- o mesmo `CORTEX.exe` também roda o CLI (`ELECTRON_RUN_AS_NODE`), então não precisa de Node.js instalado;
- o build para Windows sai daqui, do Linux, sem Rust;
- o asar fica desligado porque o CLI e o instalador precisam ler os arquivos direto.

Os dados ficam em `%APPDATA%\CORTEX`, para que atualizar o app nunca apague nada.

## D-013 · Uma página por projeto
Os projetos têm página própria (cérebro isolado, atividade, resumo, fontes e diário) porque a pergunta mais comum é "o que está acontecendo neste projeto". O cérebro de um projeto isolado é redesenhado para ocupar o espaço inteiro, com as subpastas e os worktrees como lobos.

## D-014 · Worktrees e clones contam como um projeto
O projeto é descoberto nesta ordem:
1. apelidos (`gp-*` → glass-pets);
2. git (common-dir para worktrees, remote para clones);
3. a fonte que contém o caminho;
4. o nome da pasta.

Arquivos com o mesmo caminho relativo viram um neurônio só, com a lista de worktrees.

## D-015 · Skills ensinam, o servidor executa
As 6 skills são instruções curtas para outra sessão do Claude e usam o CLI. As que dão para calcular sem IA (onde-parei, revisão, ligações, contexto) rodam no servidor de forma determinística, e o Claude só refina se estiver ligado. Assim a resposta não depende de a sessão interpretar bem.

Três testes cegos com agentes novos, que só tinham a skill, guiaram as correções: ids em 3 formatos, espera até o cérebro ficar pronto, `listar`, "me mostra" = texto + app e o worktree atual no "onde parei".

## D-016 · O diário nunca escreve nos seus cofres
O que as sessões registram vai para `%APPDATA%\CORTEX\diario`. Ele aparece como fonte DIÁRIO e nunca sobrescreve uma entrada: títulos repetidos ganham sufixo.

## D-017 · Sincronização por pasta, sem servidor na nuvem
Para juntar 3 PCs sem criar conta nem servidor, o CÓRTEX usa uma pasta que um serviço que o usuário já tem (OneDrive, Google Drive, Dropbox) sincroniza. Cada PC escreve só na própria subpasta, então nunca há conflito. O pacote é dividido por fonte, com hash no manifesto: só se reenvia e só se baixa o que mudou. Os ids dos neurônios usam a chave natural sem caminho absoluto, então o mesmo commit, nota ou sessão é um neurônio só e tem o mesmo `idCurto` em qualquer PC. Ligar a sincronização é sempre escolha do usuário, porque os dados vão para a nuvem dele.
