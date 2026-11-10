# CÓRTEX

Segundo cérebro local. Junta suas notas do Obsidian, seus repositórios git, suas conversas do Claude Code e suas pastas num cérebro 3D vivo que se organiza sozinho. Tudo roda no seu computador. Nada sai daqui sem você ligar.

## Instalar (uma vez)

1. Instale o **Node.js LTS** (versão 18 ou mais nova): https://nodejs.org
2. Instale o **Git**, se ainda não tiver: https://git-scm.com
3. Extraia esta pasta onde quiser. A sugestão é `C:\Users\jaozin\Documents\Claude Builder\cortex`.

## Abrir

Dê dois cliques em **`abrir-cortex.bat`**.

Na primeira vez ele instala as dependências (todas com versão fixa no `package-lock.json`). Depois liga a máquina e abre o navegador em `http://127.0.0.1:4747`. Para desligar, feche a janela preta.

Se preferir o terminal: `npm install` e depois `npm start`.

## Fontes que já vêm conectadas

No primeiro boot o CÓRTEX cria o `cortex.config.json` apontando para:

| Fonte | Caminho |
|---|---|
| Cofre Obsidian | `%USERPROFILE%\Documents\Claude Builder\glass-pets\wiki` |
| Repositório git | `%USERPROFILE%\Documents\Claude Builder\glass-pets` |
| Conversas do Claude Code | `%USERPROFILE%\.claude\projects` |

Se algum caminho não existir, a fonte aparece como **AUSENTE** e o resto continua funcionando.

## Conectar mais fontes

Aperte **Ctrl+K** e digite `conectar`, ou clique em **CONECTAR** no topo. Escolha o tipo (Obsidian, git, Claude Code ou pasta comum), cole o caminho e dê um nome de projeto. Fontes com o **mesmo nome de projeto** caem na mesma região do cérebro: o cofre, o repo e as sessões do glass-pets ficam juntos.

Também dá para editar o `cortex.config.json` à mão com o app fechado.

## Usar

| Tecla | O que faz |
|---|---|
| `Ctrl+K` | barra de comando: busca em tudo, pula para neurônio, roda ações |
| clique | abre o neurônio e voa até ele |
| `Shift+clique` | caminho mais curto entre o neurônio aberto e este |
| `1` a `5` | sobreposições: calor, idade, clusters, caminho, órfãos |
| `M` | painel da máquina |
| `R` | replay do crescimento |
| `Esc` | fecha painéis e volta |

## Organização automática

Cada entrada nova recebe tags e região de um classificador local por regras. O texto original nunca é alterado. A interpretação da máquina fica em `data/maquina.json` e as suas correções em `data/correcoes.json`, que sempre têm prioridade.

**Opcional, com o Claude:** copie `.env.exemplo` para `.env`, cole sua `ANTHROPIC_API_KEY` e troque `"claude": { "ativo": false }` para `true` no `cortex.config.json`. Só os neurônios novos ou alterados são enviados (título e trecho). Sem chave, tudo continua funcionando pelas regras.

## Problemas comuns

- **"Node.js não encontrado"**: instale o Node e abra o `.bat` de novo.
- **Porta ocupada**: troque `"porta"` no `cortex.config.json`.
- **Tela preta**: o navegador precisa de WebGL. Use o Chrome ou o Edge atualizados.
- **Repositório sem pulsos**: confirme que o `git` funciona no terminal (`git --version`).
