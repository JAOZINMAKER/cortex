---
name: cortex-onde-parei
description: Responde "onde parei?" num projeto usando o CÓRTEX (última sessão, arquivos tocados, último commit, pendências do diário). Use quando o usuário disser "onde parei no glass-pets?", "o que eu tava fazendo no X?", "continua de onde parei", "qual foi a última coisa que fiz no X".
---
<!-- cortex-skill v:1 -->

# CÓRTEX · onde parei

**Como chamar:** `cortex <comando>`. Se der "command not found", use direto e até o fim da tarefa `"{{CORTEX_BIN}}/cortex" <comando>` (Git Bash, Linux, mac) ou `& "{{CORTEX_BIN}}/cortex.cmd" <comando>` (PowerShell). O CLI liga o CÓRTEX sozinho e espera o cérebro montar (até 60 s, avisando "montando o cérebro…"). Se der erro de tempo, rode de novo. Regras gerais, filtros e API estão na skill base `cortex`.

**Projeto:** use 1) o nome que o usuário disse; 2) senão a pasta atual (pastas `gp-*` são worktrees do `glass-pets`); 3) confirme o nome exato com `cortex projetos`.

## Passos
1. `cortex executar cortex-onde-parei --projeto X`. Devolve a última sessão (quando, quanto tempo, ferramentas, arquivos tocados), o último commit, o worktree ou branch em uso e as entradas do diário com PENDENTE ou próximos passos.
   - Se o comando não existir (servidor antigo):
     - `cortex listar --projeto X --tipos sessao --limite 3`
     - `cortex no <idCurto da sessão mais recente>` (mostra arquivos e ferramentas)
     - `cortex listar --projeto X --tipos commit --limite 3`
     - `cortex listar --projeto X --fontes diario --limite 5`
2. **Pule** a sessão atual (a que está rodando agora) e as sessões ou notas de teste. "Onde parei" é a última sessão de trabalho de verdade.
3. Responda curto:
   - **Última vez:** quando, em qual worktree ou branch, o que estava sendo feito (pelo título da sessão e pelos arquivos).
   - **Último commit:** idCurto + mensagem.
   - **Pendências:** do diário (PENDENTE, "próximo passo", "falta").
   - **Sugestão:** a próxima ação concreta.
4. Se o usuário disse "continua", siga a próxima ação sugerida depois de confirmar o estado real dos arquivos (git status e o arquivo citado), porque o córtex mostra o histórico e não substitui olhar o código.
5. Se o pedido incluir "me mostra", rode `cortex mostrar X --desde 3d --abrir`.
