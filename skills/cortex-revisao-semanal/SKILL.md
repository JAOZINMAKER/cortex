---
name: cortex-revisao-semanal
description: Faz a revisão semanal de um projeto pelo CÓRTEX e grava no diário. Use quando o usuário disser "faz a revisão da semana do glass-pets", "revisão semanal do projeto X e grava", "o que eu fiz essa semana no X", "resumo da semana".
---
<!-- cortex-skill v:2 -->

# CÓRTEX · revisão semanal

**Como chamar:** `cortex <comando>`. Se der "command not found", use direto e até o fim da tarefa o caminho completo: `"$HOME/.cortex/bin/cortex" <comando>` (Git Bash no Windows), `& "$env:USERPROFILE\.cortex\bin\cortex.cmd" <comando>` (PowerShell) ou `"$HOME/.local/bin/cortex" <comando>` (Linux e mac). O CLI liga o CÓRTEX sozinho e espera o cérebro montar (até 60 s, avisando "montando o cérebro…"). Se der erro de tempo, rode de novo. Regras gerais, filtros e API estão na skill base `cortex`.

**Projeto:** use 1) o nome que o usuário disse; 2) senão a pasta atual (pastas `gp-*` são worktrees do `glass-pets`); 3) confirme o nome exato com `cortex projetos`.

**Projeto chamado "cortex":** o nome é ambíguo com o do app. Confirme com `cortex projetos` que existe um projeto `cortex` antes de usar. Se não existir, pergunte qual projeto o usuário quis dizer ou use o da pasta atual.

## Passos
1. Gere a revisão: `cortex executar cortex-revisao-semanal --projeto X`.
   - Se o usuário disse **grava, registra ou salva**, use `--gravar`: a revisão vai para o diário e o comando devolve o idCurto.
   - Período diferente: `--dias 14`.
   - Se aparecerem sessões ou notas de **teste** da própria construção (títulos com "teste", "teste cego", agentes de verificação), rode de novo com `--ignorar-teste`, que tira tudo isso da revisão.
   - Se o comando não existir (servidor antigo): `cortex resumo X --dias 7` + `cortex listar --projeto X --desde 7d --limite 60` e, para gravar, `cortex registrar --projeto X --titulo "Revisão semanal de X (AAAA-MM-DD)" --tags REVISAO --texto ...`.
2. Escreva a resposta **por tema**, não commit por commit:
   - o que foi construído, o que foi corrigido, decisões e o que ficou pendente;
   - números quando ajudar (commits, linhas, horas de IA, sessões);
   - ids pelo idCurto.
3. Ignore a sessão atual e o que for teste ou meta.
4. Se o usuário pediu para ver ("me mostra"), rode também `cortex mostrar X --desde 7d --abrir`.
5. Termine dizendo onde ficou gravada (idCurto), se gravou.
