---
name: cortex
description: Usa o CÓRTEX, o segundo cérebro local do usuário (notas do Obsidian, git, sessões do Claude Code e pastas num cérebro 3D). Use quando o usuário disser "córtex", "cortex", "segundo cérebro", "usa o córtex", "mostra no córtex", "registra no córtex", ou pedir contexto do que já foi feito num projeto ("o que eu fiz em glass-pets essa semana").
---

# CÓRTEX

O CÓRTEX é um app local do usuário, instalado em `{{CORTEX_DIR}}`. Ele lê as notas do Obsidian, os repositórios git, as sessões do Claude Code e as pastas do usuário e mostra tudo como um cérebro 3D no navegador (`http://127.0.0.1:4747`). Você conversa com ele pelo comando `cortex`, que liga o servidor sozinho se precisar.

**Como chamar:** use `cortex <comando>`. Se der "command not found" (o PATH só é atualizado depois de reiniciar o app), use sempre:
```bash
node "{{CORTEX_DIR}}/cli.js" <comando>
```
Todo comando aceita `--json`, que é melhor quando você vai processar a saída.

## Passo a passo

1. **Confirme que está de pé:** `cortex status`. Na primeira vez pode levar uns 10 a 30 s, porque o servidor é ligado e o grafo é montado. Se falhar, diga ao usuário o erro exato e onde está o log (`{{CORTEX_DIR}}/data/servidor.log`). **Não invente dados do córtex.**
2. **Descubra o projeto:** rode `cortex projetos` e compare com a pasta atual.
   - As pastas `gp-*` (gp-alce, gp-vfx...) são worktrees do **glass-pets**: o projeto é `glass-pets`.
   - Nos demais casos, o projeto costuma ser o nome da pasta do repositório.
   - Se o usuário disser o nome do projeto, use esse.
3. **Pegue contexto antes de trabalhar:** `cortex resumo <projeto> --dias 7`. Esse comando traz os últimos commits, as últimas sessões, as notas mais conectadas e o diário. Leia o resumo e use como contexto, sem colar tudo para o usuário.
4. **Busque detalhes:**
   - `cortex buscar "termo" --projeto <projeto>` lista resultados com id;
   - `cortex no <id>` mostra o conteúdo, os vizinhos, as tags da máquina e o caminho do arquivo;
   - `cortex no <id> --completo` mostra o texto inteiro.
5. **Mostre para o usuário no cérebro:** o comando `mostrar` muda a visão de todas as janelas abertas do córtex, e `abrir` abre o navegador já filtrado.
   ```bash
   cortex mostrar glass-pets                         # só o projeto glass-pets
   cortex mostrar glass-pets --desde 7d              # só o que mudou na última semana
   cortex mostrar glass-pets --fontes git,claude     # só commits e sessões
   cortex mostrar tudo --tipos nota --tags ROTEIRO   # todas as notas com a tag ROTEIRO
   cortex mostrar cortex --desde 7d --abrir          # aplica e abre o navegador
   cortex mostrar tudo                               # volta ao cérebro inteiro
   ```
   Filtros: `--fontes obsidian,git,claude,pasta`, `--tipos nota,commit,branch,worktree,sessao,arquivo,doc`, `--desde 7d|24h|2w|AAAA-MM-DD`, `--ate`, `--tags A,B`, `--texto x`, `--grau N` e `--vizinhos 1|2`, que inclui vizinhos de fora do filtro. Se o usuário pedir uma visão salva pelo nome, `cortex mostrar "<nome>"` também funciona.
6. **Registre o trabalho importante:** ao terminar uma tarefa que mudou algo de verdade (feature, correção, decisão, pesquisa), registre no diário:
   ```bash
   cortex registrar --projeto glass-pets --titulo "Corrige colisão do pet no vidro" \
     --tags BUG,FISICA --ligar a3f91c,7be210 --texto - <<'EOF'
   O que mudou: ...
   Por quê: ...
   Arquivos: src/pets/colisao.lua, wiki/fisica.md
   EOF
   ```
   - `--ligar` recebe ids ou títulos de neurônios relacionados, tirados de `buscar` ou de `no`.
   - Para texto longo, use `--texto -` com heredoc (como acima) ou `--arquivo nota.md`. Isso evita problemas com aspas.
   - O registro vira uma nota `.md` em `{{CORTEX_DIR}}/diario/<projeto>/` e aparece como neurônio em segundos.
   - **Não registre trivialidades** (uma pergunta respondida, um comando rodado).
   - Se o usuário pedir para registrar, sempre registre.
7. **Conecte uma fonte nova** quando o usuário pedir:
   `cortex conectar <obsidian|git|claude|pasta> "<caminho>" --projeto <nome>`.
   Fontes com o mesmo nome de projeto caem na mesma região do cérebro. Para ver o que já está conectado, use `cortex fontes`.

## Regras

- O córtex **só lê** os cofres, repositórios e pastas do usuário. Nunca edite esses arquivos "pelo córtex". Para guardar algo, use `cortex registrar`.
- Nunca edite à mão nada em `{{CORTEX_DIR}}/data/` nem o `cortex.config.json`. Use os comandos.
- Se o servidor estiver fora do ar e não ligar, diga isso ao usuário. Não responda de memória como se tivesse consultado.
- Ao responder ao usuário, resuma em português e cite os ids curtos dos neurônios quando for útil, para ele achar no cérebro com Ctrl+K.

## Exemplo completo

Pedido: "usa o córtex e me mostra o que eu fiz no projeto X essa semana, e registra que você revisou"
```bash
cortex status
cortex projetos                        # confirma o nome exato do projeto
cortex resumo X --dias 7               # lê e resume para o usuário
cortex mostrar X --desde 7d            # o cérebro aberto passa a mostrar só isso
cortex registrar --projeto X --titulo "Revisão semanal de X" --tags REVISAO --texto "Revisei o que mudou em X nos últimos 7 dias: ..."
```
Depois responda com um resumo curto: os commits, as sessões e as notas principais, e diga que o cérebro está mostrando a semana do projeto e que a revisão foi registrada (com o id devolvido).

## Referência rápida

| Comando | O que faz |
|---|---|
| `cortex status` | rodando? versão do grafo, projetos |
| `cortex abrir [projeto]` | abre o navegador, já filtrado |
| `cortex projetos` | projetos com neurônios, notas, commits, sessões e último pulso |
| `cortex resumo [projeto] [--dias N]` | markdown curto para ler como contexto |
| `cortex buscar "texto" [--projeto X] [--limite N]` | busca em títulos e textos |
| `cortex no <id\|título> [--completo]` | um neurônio |
| `cortex mostrar <projeto\|visão\|tudo> [filtros] [--abrir]` | muda a visão nas janelas abertas |
| `cortex registrar --projeto X --titulo T --texto Y [--tags] [--ligar] [--autor]` | grava no diário |
| `cortex conectar <tipo> "<caminho>" [--projeto X]` · `cortex fontes` · `cortex reconstruir` | fontes |
| `cortex skill instalar` | reinstala esta skill e o comando |

API HTTP, se até o `node` falhar:
```bash
curl -s http://127.0.0.1:4747/api/status
curl -s http://127.0.0.1:4747/api/projetos
curl -s "http://127.0.0.1:4747/api/resumo?projeto=glass-pets&dias=7"
curl -s "http://127.0.0.1:4747/api/busca?q=colisao"
curl -s http://127.0.0.1:4747/api/no/<id>
curl -s -X POST http://127.0.0.1:4747/api/visao/atual -H "content-type: application/json" -d '{"projetos":["glass-pets"],"desde":1730000000000}'
curl -s -X POST http://127.0.0.1:4747/api/registrar -H "content-type: application/json" -d '{"projeto":"glass-pets","titulo":"...","texto":"...","tags":["BUG"]}'
curl -s -X POST http://127.0.0.1:4747/api/fontes -H "content-type: application/json" -d '{"tipo":"git","caminho":"C:/...","projeto":"x"}'
```
Outros endpoints: `GET/POST /api/visoes`, `GET/POST /api/ajustes`, `POST /api/reconstruir`. Se a porta não for 4747, ela está em `{{CORTEX_DIR}}/cortex.config.json` (campo `porta`).
