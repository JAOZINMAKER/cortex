# CÓRTEX — app de desktop (Windows)

1. Baixe `CORTEX-win-x64.zip` e extraia **onde quiser**. Sugestão: `%LOCALAPPDATA%\Programs\CORTEX` (cole na barra de endereço do Explorador).
2. Dentro da pasta, rode **`Instalar CORTEX.bat`** uma vez: cria atalhos na Área de Trabalho e no Menu Iniciar, o comando `cortex` no terminal, instala as skills no Claude Code e abre o app.
3. Daí em diante, abra pelo atalho **CORTEX**.

- **Não precisa de Node.js**: o `CORTEX.exe` roda o servidor e o CLI (`ELECTRON_RUN_AS_NODE`). Precisa do **Git** para ler repositórios.
- **Seus dados** ficam em `%APPDATA%\CORTEX` (config, `data/`, `diario/`, `.env`). Para atualizar, apague a pasta do app e extraia a nova no mesmo lugar — os dados continuam. Se você usava a versão antiga (`abrir-cortex.bat`), os dados dela são copiados na primeira abertura.
- **Fechar a janela** deixa o CÓRTEX na bandeja (perto do relógio); para sair: clique direito no ícone → Sair. Dá para desligar isso em Configurações → Geral, assim como iniciar com o Windows e o atalho global (padrão **Ctrl+Alt+C**).
- **Uma instância só**: abrir de novo apenas traz a janela para a frente. Se já houver um CÓRTEX rodando na porta (por exemplo, `node server/index.js`), o app se conecta nele.
- O ícone do `CORTEX.exe` é o padrão do Electron (o build é feito no Linux, sem editar o exe); os atalhos usam o ícone do CÓRTEX.

Para desenvolvedores: `npm run app` abre o app a partir do código; `npm run dist:win` gera `dist/CORTEX-win-x64.zip`; `npm run icones` refaz os ícones.
