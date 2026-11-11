---
name: cortex-ligacoes
description: Acha notas soltas (órfãs) e notas que se citam sem link no CÓRTEX e sugere ligações, sem editar o cofre. Use quando o usuário disser "acha notas soltas", "quais notas estão sem ligação", "o que devia estar linkado no glass-pets", "organiza as ligações das notas".
---
<!-- cortex-skill v:1 -->

# CÓRTEX · ligações sugeridas

**Como chamar:** `cortex <comando>`. Se der "command not found", use direto e até o fim da tarefa o caminho completo: `"$HOME/.cortex/bin/cortex" <comando>` (Git Bash no Windows), `& "$env:USERPROFILE\.cortex\bin\cortex.cmd" <comando>` (PowerShell) ou `"$HOME/.local/bin/cortex" <comando>` (Linux e mac). O CLI liga o CÓRTEX sozinho e espera o cérebro montar (até 60 s, avisando "montando o cérebro…"). Se der erro de tempo, rode de novo. Regras gerais, filtros e API estão na skill base `cortex`.

**Projeto:** use 1) o nome que o usuário disse; 2) senão a pasta atual (pastas `gp-*` são worktrees do `glass-pets`); 3) confirme o nome exato com `cortex projetos`. (Também dá para rodar em todos os projetos: omita `--projeto`.)

## Passos
1. `cortex executar cortex-ligacoes --projeto X`. Lista os órfãos (notas sem nenhuma ligação) e os pares de notas que se citam pelo título sem `[[link]]`, com o trecho e uma força.
   - `--gravar` grava a lista de sugestões no diário, para o usuário ver no app.
2. Apresente as **sugestões** agrupadas: órfãos com uma nota-mãe provável e pares para linkar. Cite a nota e o idCurto, por exemplo: "`Vidro` (`a1b2c3`) cita Bosque sem link → sugerir `[[Bosque]]`".
3. **Nunca edite o cofre do Obsidian por conta própria.** Se o usuário pedir para aplicar, edite as notas diretamente nos arquivos do cofre (caminho em `cortex no <id>`), uma por uma, mostrando o que mudou, e só as que ele aprovou.
4. Para ele ver no cérebro: `cortex mostrar X --abrir` e diga que a sobreposição **ÓRFÃOS** (tecla 5 no app) destaca as soltas.
5. Se o comando não existir (servidor antigo), diga que essa skill precisa do CÓRTEX atualizado (versão 4 ou mais nova) e ofereça só a busca manual com `cortex buscar`.
