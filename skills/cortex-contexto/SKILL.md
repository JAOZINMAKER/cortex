---
name: cortex-contexto
description: Carrega o contexto de um projeto pelo CÓRTEX antes de começar a trabalhar. Use quando o usuário disser "vou trabalhar no glass-pets", "me dá o contexto do projeto X", "o que eu preciso saber antes de mexer em X", "relembra o projeto X", ou no início de uma tarefa num projeto que o córtex conhece.
---
<!-- cortex-skill v:1 -->

# CÓRTEX · contexto do projeto

Antes de mexer num projeto, leia o que já existe sobre ele no segundo cérebro do usuário. Isso inclui commits e sessões recentes, o diário das sessões anteriores e as notas centrais.

**Como chamar:** `cortex <comando>`. Se der "command not found", use direto e até o fim da tarefa o caminho completo: `"$HOME/.cortex/bin/cortex" <comando>` (Git Bash no Windows), `& "$env:USERPROFILE\.cortex\bin\cortex.cmd" <comando>` (PowerShell) ou `"$HOME/.local/bin/cortex" <comando>` (Linux e mac). O CLI liga o CÓRTEX sozinho e espera o cérebro montar (até 60 s, avisando "montando o cérebro…"). Se der erro de tempo, rode de novo. Regras gerais, filtros e API estão na skill base `cortex`.

**Projeto:** use 1) o nome que o usuário disse; 2) senão a pasta atual (pastas `gp-*` são worktrees do `glass-pets`); 3) confirme o nome exato com `cortex projetos`.

## Passos
1. `cortex executar cortex-contexto --projeto X`. Devolve em markdown o resumo recente, as últimas sessões, as entradas do diário e as notas mais conectadas.
   - Se o comando não existir (servidor antigo), use `cortex resumo X --dias 14` + `cortex listar --projeto X --tipos sessao --limite 5` + `cortex listar --projeto X --fontes diario --limite 5`.
2. Para algo citado que pareça importante para a tarefa, abra com `cortex no <idCurto>`. Vale para uma decisão no diário, uma nota central ou o último commit.
3. **Use isto como contexto seu.** Não cole tudo para o usuário: diga em 3 a 6 linhas o que vai levar em conta (estado atual, decisões anteriores, pendências) e siga com a tarefa.

## Cuidados
- Ignore sessões e notas de teste ou meta (títulos com "teste", a sessão atual).
- Cite ids pelo idCurto de 6 caracteres.
- Se o córtex não responder, diga isso e siga sem ele. Não invente histórico.
- Ao terminar a tarefa, se algo relevante mudou, use a skill `cortex-registrar`.
