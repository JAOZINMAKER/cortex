# CÓRTEX

Segundo cérebro local, agora como **app de desktop**. Junta suas notas do Obsidian, seus repositórios git, suas conversas do Claude Code e suas pastas num cérebro 3D vivo que se organiza sozinho. Tudo roda no seu computador e nada sai daqui sem você ligar.

## Instalar

1. Extraia `CORTEX-win-x64.zip` onde quiser. A sugestão é `%LOCALAPPDATA%\Programs\CORTEX`: cole isso na barra de endereço do Explorador de Arquivos.
2. Dentro da pasta, rode **`Instalar CORTEX.bat`** uma vez. Ele:
   - cria atalhos na Área de Trabalho e no Menu Iniciar;
   - instala o comando `cortex` no terminal;
   - instala as 6 skills no Claude Code;
   - avisa todas as sessões futuras do Claude Code que o CÓRTEX existe (um bloco no seu `CLAUDE.md` global);
   - abre o app.
3. Daí em diante, abra pelo atalho **CORTEX** ou com **Ctrl+Alt+C**.

Não precisa de Node.js, porque o `CORTEX.exe` roda tudo. Precisa do **Git** instalado para ler repositórios. Os seus dados ficam em `%APPDATA%\CORTEX`, então para atualizar basta trocar a pasta do app.

## O app

| Seção | O que tem |
|---|---|
| **CÉREBRO** (Alt+1) | O cérebro 3D com visões e filtros (V), ajustes rápidos (A), replay (R), sobreposições 1–5 e painel da máquina (M) |
| **PROJETOS** (Alt+2) | Cartões de cada projeto, e por projeto as abas cérebro, atividade, resumo, fontes e diário. Use ← → para passar de um projeto ao outro, e dá para fixar ou ocultar projetos |
| **DIÁRIO** (Alt+3) | O que as sessões do Claude registraram, filtrado por projeto e autor |
| **SKILLS** (Alt+4) | Instalar, atualizar ou remover as skills no Claude Code, e **executar aqui** as que rodam no app |
| **CONFIGURAÇÕES** (Alt+5) | Geral, fontes e apelidos, organização (Claude opcional), aparência com editor de tema próprio, cérebro, desempenho, notificações, dados e sobre |

**Ctrl+K** busca e navega para qualquer coisa. Fechar a janela deixa o app na bandeja, perto do relógio; para sair, clique com o botão direito no ícone e escolha **Sair**.

As pastas `gp-*` (worktrees e clones) caem todas no projeto **glass-pets**. A regra vem do apelido `gp-* → glass-pets` e do próprio git. Os apelidos ficam editáveis em Configurações → Fontes.

## Vários PCs

Cada CÓRTEX só enxerga o que existe no próprio computador. Para juntar os cérebros de vários PCs:

1. Instale o CÓRTEX em cada PC.
2. Em cada um, vá em **Configurações → Sincronização** (ou clique em **SINCRONIZAR** na tela de boas-vindas), ligue e escolha **a mesma pasta** que já sincroniza entre eles. Um exemplo é uma pasta no OneDrive, que já vem no Windows: `OneDrive\CORTEX`.
3. Dê um nome a cada PC (ex.: CASA, ESCRITÓRIO, NOTEBOOK).

Em poucos minutos todos mostram tudo:
- Um commit ou uma sessão que existe em dois PCs vira um neurônio só.
- Neurônios de outro PC mostram **DE: NOME-DO-PC**.
- O diário de cada PC aparece nos outros.

Cada PC só escreve na própria subpasta e só reenvia o que mudou (uma sessão ativa troca cerca de 14 KB). Sem pasta em comum, dá para **exportar** um `.cortexpack` e **importar** no outro PC, por pendrive ou e-mail.

No terminal: `cortex sync`, `cortex sync pasta "C:\Users\voce\OneDrive\CORTEX" --ligar`, `cortex sync nome CASA` e `cortex sync agora`.

## Usar com outras sessões do Claude Code

Basta dizer **"usa o córtex"**, ou pedir naturalmente:

| Você diz | A sessão usa |
|---|---|
| "o que eu fiz no glass-pets essa semana?" / "me mostra o glass-pets" | `cortex` (resumo, listar, e abre a visão no app) |
| "carrega o contexto do projeto antes de começar" | `cortex-contexto` |
| "onde parei?" | `cortex-onde-parei` (prioriza o worktree em que você está) |
| "registra isso no córtex" | `cortex-registrar` (grava no diário do córtex) |
| "faz a revisão da semana do glass-pets e grava" | `cortex-revisao-semanal` |
| "acha notas soltas" | `cortex-ligacoes` (só **sugere**, nunca edita o cofre) |

No terminal: `cortex status`, `cortex projetos`, `cortex resumo glass-pets`, `cortex mostrar glass-pets --abrir`, `cortex executar cortex-onde-parei`, `cortex skills` e `cortex --help`.

## Organização com o Claude (opcional)

Em Configurações → Organização, cole sua chave da API e ligue. A chave fica só no seu PC (`%APPDATA%\CORTEX\.env`). Sem chave, o classificador local faz tudo.

## Para desenvolvedores

`npm install`, depois:
- `npm run app` abre o app a partir do código;
- `npm start` sobe só o servidor, para usar no navegador em http://127.0.0.1:4747;
- `npm run dist:win` gera o zip;
- `npm run bench` faz o benchmark com 20 mil neurônios.

O formato entre as partes está em `CONTRATO.md` e as decisões em `DECISOES.md`.
