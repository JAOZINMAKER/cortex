---
name: cortex-registrar
description: Registra no diário do CÓRTEX o trabalho feito numa sessão. Use quando o usuário disser "registra isso no córtex", "anota no córtex", "grava no segundo cérebro", "salva o que a gente fez", ou ao terminar uma tarefa relevante (feature, correção, decisão, pesquisa) num projeto que o córtex conhece.
---
<!-- cortex-skill v:1 -->

# CÓRTEX · registrar no diário

O diário é onde as sessões do Claude deixam o que fizeram. Cada registro vira um neurônio (fonte **DIÁRIO**) ligado aos commits, notas e arquivos citados. O registro **nunca** edita o cofre do usuário.

**Como chamar:** `cortex <comando>`. Se der "command not found", use direto e até o fim da tarefa `"{{CORTEX_BIN}}/cortex" <comando>` (Git Bash, Linux, mac) ou `& "{{CORTEX_BIN}}/cortex.cmd" <comando>` (PowerShell). O CLI liga o CÓRTEX sozinho e espera o cérebro montar (até 60 s, avisando "montando o cérebro…"). Se der erro de tempo, rode de novo. Regras gerais, filtros e API estão na skill base `cortex`.

**Projeto:** use 1) o nome que o usuário disse; 2) senão a pasta atual (pastas `gp-*` são worktrees do `glass-pets`); 3) confirme o nome exato com `cortex projetos`.

## Quando registrar
- **Sempre** quando o usuário pedir.
- Por conta própria só no fim de algo que mudou de verdade: feature, correção, decisão de design, pesquisa com conclusão, refatoração.
- **Não** registre trivialidades: pergunta respondida, comando rodado, leitura de arquivo.

## Como
1. Ache 1 a 5 neurônios para ligar: `cortex listar --projeto X --desde 1d` (commits e arquivos de agora) ou `cortex buscar "termo" --projeto X`. Guarde os idCurto.
2. Grave com título curto e texto em 3 partes:
   ```bash
   cortex registrar --projeto X --titulo "Verbo + o quê (ex.: Corrige colisão do pet no vidro)" \
     --tags BUG,FISICA --ligar a3f91c,7be210 --texto - <<'TXT'
   O que mudou: ...
   Por quê: ...
   Arquivos / próximos passos: ...
   TXT
   ```
   - No PowerShell, sem heredoc, salve o texto num arquivo e use `--arquivo nota.md`.
   - Tags em CAIXA ALTA e curtas: BUG, FEATURE, DECISAO, PESQUISA, REVISAO, PENDENTE.
   - Use **PENDENTE** quando ficar algo para depois. A skill `cortex-onde-parei` procura essa tag.
3. Responda ao usuário com o idCurto devolvido ("registrado no córtex como `31d09a`").

## Cuidados
- Um registro por tarefa, não um por arquivo.
- Não registre em nome do usuário o que você não fez. Para algo que ele fez, use `--autor EU`.
