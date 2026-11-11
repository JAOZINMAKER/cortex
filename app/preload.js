'use strict';
// Ponte segura entre a interface (web/) e a casca. A interface deve funcionar igual sem isto (navegador).
const { contextBridge, ipcRenderer } = require('electron');

const ouvir = (canal) => (cb) => {
  if (typeof cb !== 'function') return () => {};
  const f = (_e, dados) => cb(dados);
  ipcRenderer.on(canal, f);
  return () => ipcRenderer.removeListener(canal, f);
};

const arg = (k) => { const a = (process.argv || []).find((x) => x.startsWith(`--cortex-${k}=`)); return a ? a.slice(k.length + 10) : null; };

contextBridge.exposeInMainWorld('cortexApp', {
  janela: {
    min: () => ipcRenderer.invoke('janela:min'),
    max: () => ipcRenderer.invoke('janela:max'),       // alterna maximizar/restaurar; devolve se ficou maximizada
    fechar: () => ipcRenderer.invoke('janela:fechar'), // respeita "fechar para a bandeja"
    estado: () => ipcRenderer.invoke('janela:estado'), // { maximizada, focada }
    aoMudar: ouvir('janela:estado'),
  },
  escolherPasta: (opcoes) => ipcRenderer.invoke('dialogo:pasta', opcoes || {}), // → caminho | null
  abrirCaminho: (p) => ipcRenderer.invoke('abrir:caminho', p),                 // arquivo/pasta no sistema ou URL externa
  mostrarNoExplorador: (p) => ipcRenderer.invoke('mostrar:no-explorador', p),
  info: () => ipcRenderer.invoke('app:info'),                                  // { versao, plataforma, modo, porta, dados, appDir, exe, empacotado }
  configMudou: () => ipcRenderer.invoke('app:config-mudou'),                   // chame depois de salvar /api/config
  sair: () => ipcRenderer.invoke('app:sair'),
  aoMudarBandeja: ouvir('bandeja'),                                            // { acao: 'projeto', projeto }
  versao: arg('versao'),
  plataforma: process.platform,
});
