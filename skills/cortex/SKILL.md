---
name: cortex
description: Usa o CÓRTEX, o segundo cérebro local do usuário (notas do Obsidian, git, sessões do Claude Code e pastas num cérebro 3D). Use quando o usuário disser "córtex", "cortex", "segundo cérebro", "usa o córtex", "mostra no córtex", "registra no córtex", ou pedir contexto do que já foi feito num projeto ("o que eu fiz em glass-pets essa semana").
---
<!-- cortex-skill v:1 -->

# CÓRTEX

O CÓRTEX é um app local do usuário, instalado em `{{CORTEX_DIR}}`. Ele lê as notas do Obsidian, os repositórios git, as sessões do Claude Code e as pastas do usuário e mostra tudo como um cérebro 3D no navegador. Você conversa com ele pelo comando `cortex`, que liga o servidor sozinho se precisar.

**Como chamar:** use `cortex <comando>`. Se der "command not found", **não investigue**: passe direto e para o resto da tarefa ao caminho completo abaixo. No Windows, o PATH novo só vale em terminais (e no app do Claude) abertos depois da instalação.
```bash
"{{CORTEX_BIN}}/cortex" <comando>        # Git Bash, Linux, mac
& "{{CORTEX_BIN}}/cortex.cmd" <comando>  # PowerShell no Windows
```
Todo comando aceita `--json`, que é melhor quando você vai processar a saída. O CÓRTEX pode estar instalado como app de desktop (`CORTEX.exe`, que fica na bandeja do sistema). O CLI liga o app escondido sozinho quando ele não está aberto.

## Skills específicas (use a que bater com o pedido)

| Pedido do usuário | Skill | Atalho no CLI |
|---|---|---|
| "vou trabalhar no X", "me dá o contexto do X" | `cortex-contexto` | `cortex executar cortex-contexto --projeto X` |
| "onde parei no X?", "o que eu tava fazendo?" | `cortex-onde-parei` | `cortex executar cortex-onde-parei --projeto X` |
| "faz a revisão da semana do X (e grava)" | `cortex-revisao-semanal` | `cortex executar cortex-revisao-semanal --projeto X --gravar` |
| "acha notas soltas", "o que devia estar ligado?" | `cortex-ligacoes` | `cortex executar cortex-ligacoes --projeto X` |
| "registra isso no córtex", fim de tarefa relevante | `cortex-registrar` | `cortex registrar ...` |

Esta skill (`cortex`) é a base: comandos, regras e o que fazer nos outros pedidos. Para ver as skills e se estão instaladas: `cortex skills`.

## Passo a passo

1. **Confirme que está de pé:** `cortex status --esperar`.
   - Na primeira vez, o servidor liga e monta o grafo, o que leva de 10 a 60 s. O CLI espera sozinho e escreve "montando o cérebro… N s" no stderr. Isso é normal: **espere, não aborte**.
   - Todo comando que lê dados (resumo, listar, buscar, no, projetos, mostrar) também espera sozinho até o grafo ficar pronto.
   - Se o comando der erro de tempo, **rode o mesmo comando de novo**.
   - A "versão do grafo" (`grafo v73`) sobe a cada mudança detectada nas fontes. Ela não importa: não comente nem compare.
   - Se falhar de verdade, diga ao usuário o erro exato (o CLI mostra onde está o log). **Não invente dados do córtex.**
2. **Descubra o projeto**, nesta ordem:
   1. o nome que o usuário disse ("projeto cortex" → `cortex`);
   2. a pasta atual: o nome da pasta do repositório. As pastas `gp-*` (gp-alce, gp-vfx...) são worktrees do **glass-pets**, então o projeto é `glass-pets`;
   3. `cortex projetos`, que lista os nomes exatos. Confirme ali quando houver dúvida.
3. **Para "o que eu fiz", "o que tem sobre X" ou pedidos de contexto:**
   - sem período ("o que tem sobre X", "me lembra do projeto X"): `cortex resumo X --tudo` (todo o histórico) e depois `cortex listar --projeto X`;
   - com período ("essa semana", "hoje", "esse mês"): use `--dias`/`--desde`, como abaixo:
   - primeiro `cortex resumo <projeto> --dias 7`, que traz totais, últimos commits, sessões, notas mais conectadas e o diário;
   - depois complete com `cortex listar --projeto <projeto> --desde 7d`, que dá a lista cronológica com ids. Filtre com `--tipos commit,sessao,nota` ou `--fontes git,claude,obsidian,pasta,diario`.
   - Leia e resuma para o usuário, sem colar tudo.
4. **Busque detalhes:**
   - `cortex buscar "termo" --projeto <projeto>` (pelo menos 2 caracteres; aceita prefixo e pedaço de palavra);
   - `cortex no <id>` mostra o conteúdo, os vizinhos, as tags da máquina e o caminho;
   - `--completo` mostra o texto inteiro.
   - `no` aceita o idCurto de 6, o id longo de 16 ou o hash git (curto ou longo).
5. **Mostre para o usuário no cérebro.** Quando o pedido diz "me mostra", "mostra" ou "quero ver", faça **as duas coisas**: responda em texto e rode `cortex mostrar ... --abrir`, para o cérebro abrir já filtrado. `cortex mostrar <projeto>` **isola** o projeto: só ele aparece e ocupa o cérebro inteiro, com as subpastas e worktrees virando os lobos.
   ```bash
   cortex mostrar glass-pets                         # só o projeto glass-pets
   cortex mostrar glass-pets --desde 7d              # só o que mudou na última semana
   cortex mostrar glass-pets --fontes git,claude     # só commits e sessões
   cortex mostrar tudo --tipos nota --tags ROTEIRO   # todas as notas com a tag ROTEIRO
   cortex mostrar cortex --desde 7d --abrir          # aplica e abre o navegador nessa visão (use em "me mostra")
   cortex mostrar tudo                               # volta ao cérebro inteiro
   ```
   - Se a saída disser que **nenhuma janela está aberta** (`janelas: 0`), ninguém está olhando. Ofereça ao usuário `cortex abrir <projeto> --desde 7d`, ou rode com `--abrir` se ele já pediu para ver.
   - Se não houver navegador no ambiente, o CLI imprime a URL. Passe a URL ao usuário.
   - Filtros: `--fontes`, `--tipos nota,commit,branch,worktree,sessao,arquivo,doc`, `--desde 7d|24h|2w|AAAA-MM-DD`, `--ate`, `--tags A,B`, `--texto x`, `--grau N` e `--vizinhos 1|2`.
   - Uma visão salva pelo nome: `cortex mostrar "<nome>"`.
6. **Registre o trabalho importante.** Ao terminar uma tarefa que mudou algo de verdade (feature, correção, decisão, pesquisa, revisão pedida pelo usuário), registre no diário:
   ```bash
   cortex registrar --projeto glass-pets --titulo "Corrige colisão do pet no vidro" \
     --tags BUG,FISICA --ligar a3f91c,7be210 --texto - <<'EOF'
   O que mudou: ...
   Por quê: ...
   Arquivos: src/pets/colisao.lua, wiki/fisica.md
   EOF
   ```
   - `--ligar` recebe idCurto ou títulos tirados de `buscar`, `listar` ou `no`.
   - Para texto longo use heredoc (acima) ou `--arquivo nota.md`. No PowerShell, sem heredoc, use `--arquivo`.
   - Vira uma nota no diário do córtex (pasta de dados do app, nunca no cofre) e aparece no cérebro em segundos como fonte **DIÁRIO**.
   - **Não registre trivialidades.** Se o usuário pedir para registrar, sempre registre.
7. **Conecte uma fonte nova** quando o usuário pedir:
   `cortex conectar <obsidian|git|claude|pasta> "<caminho>" --projeto <nome>`.
   O mesmo nome de projeto cai na mesma região. Para ver as fontes, use `cortex fontes`.

## Como citar e o que contar

- **Ids:** cite o **idCurto de 6 caracteres** (ex.: `a3f91c`). É o que o CLI mostra primeiro e o que o usuário acha no app com Ctrl+K.
- **Sessões de agentes** (autor "AGENTE …" ou subagentes) contam como trabalho de IA do usuário.
- **Ignore na resposta** o que é meta ou teste: a sessão da tarefa atual (inclusive esta, que está consultando o córtex) e sessões ou notas de diário com "teste" no título. Isso não é trabalho do usuário.
- **Tags:** `no` e `listar` mostram as **tags do autor** (escritas pelo usuário na nota) separadas das **tags da máquina** (classificação automática). Quando falar de tema, dê preferência às tags do autor. O worktree (`wt gp-alce`) aparece quando houver.
- Resuma em português, por tema (o que foi construído, corrigido, decidido) e não commit por commit, com números quando ajudar.

## Regras

- O córtex **só lê** os cofres, repositórios e pastas do usuário. Nunca edite esses arquivos "pelo córtex". Para guardar algo, use `cortex registrar`.
- Nunca edite à mão a pasta de dados do córtex (config, `data/`, `diario/`). Use os comandos.
- Servidor fora do ar e sem ligar: diga isso. Não responda de memória como se tivesse consultado.

## Exemplo completo

Pedido: "usa o córtex e me mostra o que eu fiz no projeto X essa semana, e registra que você revisou"
```bash
cortex status --esperar
cortex projetos                          # confirma o nome exato de X
cortex resumo X --dias 7                 # visão geral
cortex listar --projeto X --desde 7d     # lista cronológica com ids
cortex mostrar X --desde 7d --abrir      # "me mostra" = texto + cérebro aberto nesse recorte
cortex registrar --projeto X --titulo "Revisão semanal de X" --tags REVISAO --texto "Revisei o que mudou em X nos últimos 7 dias: <resumo em 2-3 linhas>"
```
Depois responda com um resumo curto do que foi feito, por tema e com os idCurto principais. Diga se o cérebro está mostrando a semana do projeto (ou passe o link/comando para abrir) e cite o id da revisão registrada.

## Referência rápida

| Comando | O que faz |
|---|---|
| `cortex status [--esperar]` | rodando? versão do grafo, projetos |
| `cortex abrir [projeto] [filtros]` | abre o navegador já na visão (`?visao=id`) |
| `cortex projetos` | projetos com neurônios, notas, commits, sessões e último pulso |
| `cortex resumo [projeto] [--dias N \| --tudo] [--json]` | markdown curto; `--tudo` = todo o histórico; `--json` estruturado |
| `cortex listar [--projeto X] [--desde 7d] [--tipos ...] [--fontes ...] [--limite N]` | lista cronológica |
| `cortex buscar "texto" [--projeto X] [--limite N]` | busca em títulos e textos |
| `cortex no <id\|título> [--completo]` | um neurônio |
| `cortex mostrar <projeto\|visão\|tudo> [filtros] [--abrir]` | muda a visão nas janelas abertas |
| `cortex registrar --projeto X --titulo T --texto Y [--tags] [--ligar] [--autor]` | grava no diário |
| `cortex conectar <tipo> "<caminho>" [--projeto X]` · `cortex fontes` · `cortex reconstruir` | fontes |
| `cortex skills` · `cortex skill instalar [nome\|todas]` · `cortex skill remover <nome>` | skills do Claude Code |
| `cortex executar <skill> --projeto X [--gravar]` | roda uma skill executável no servidor, sem IA (contexto, onde-parei, revisão, ligações) |

**Porta e config:** o CLI respeita as variáveis `PORT` e `CORTEX_CONFIG`; sem elas, usa a config do app (porta padrão 4747). Para usar a API HTTP com curl, pegue a URL com `cortex status --json` (campo `url`):
```bash
URL=$(cortex status --json | sed -E 's/.*"url":"([^"]+)".*/\1/')
curl -s "$URL/api/projetos"
curl -s "$URL/api/resumo?projeto=glass-pets&dias=7&formato=json"
curl -s "$URL/api/listar?projeto=glass-pets&desde=1730000000000&tipos=commit,sessao"
curl -s "$URL/api/busca?q=colisao"
curl -s "$URL/api/no/<id>"
curl -s -X POST "$URL/api/visao/atual" -H "content-type: application/json" -d '{"projetos":["glass-pets"]}'
curl -s -X POST "$URL/api/registrar" -H "content-type: application/json" -d '{"projeto":"glass-pets","titulo":"...","texto":"...","tags":["BUG"]}'
```
Outros endpoints: `GET /api/status`, `GET/POST /api/visoes`, `GET/POST /api/ajustes`, `GET/POST /api/fontes`, `POST /api/reconstruir`.
