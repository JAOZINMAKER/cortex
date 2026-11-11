'use strict';
// Telemetria: buffer circular de eventos, CPU/memória do processo e arquivos tocados por minuto.
const MAX = 2000;
const buffer = [];
const ouvintes = new Set();
const toquesArquivo = []; // timestamps de arquivos tocados (2 h)
let contSeg = 0;
let eventosSeg = 0;
let fila = () => 0;

function emitir(ev) {
  const e = { t: ev.t || Date.now(), nivel: ev.nivel || 'INFO', fonte: ev.fonte || 'sistema', msg: String(ev.msg || '') };
  if (ev.id) e.id = ev.id;
  if (ev.hash) e.hash = ev.hash;
  buffer.push(e);
  if (buffer.length > MAX) buffer.splice(0, buffer.length - MAX);
  contSeg++;
  for (const fn of ouvintes) { try { fn(e); } catch { /* ouvinte quebrado */ } }
  return e;
}

function tocouArquivo(t) {
  toquesArquivo.push(t || Date.now());
  const lim = Date.now() - 2 * 3600 * 1000;
  while (toquesArquivo.length && toquesArquivo[0] < lim) toquesArquivo.shift();
}

function arquivosPorMinuto() {
  const agora = Date.now();
  const minAtual = Math.floor(agora / 60000);
  const out = new Array(60).fill(0);
  for (const t of toquesArquivo) {
    const d = minAtual - Math.floor(t / 60000);
    if (d >= 0 && d < 60) out[59 - d]++;
  }
  return out;
}

let ultimoCpu = process.cpuUsage();
let ultimoT = process.hrtime.bigint();
let cpuPct = 0;
// amostragem de CPU começa só quando o servidor sobe (require sem efeito colateral); devolve a função que para
function iniciarAmostragem() {
  ultimoCpu = process.cpuUsage();
  ultimoT = process.hrtime.bigint();
  const t = setInterval(() => {
    const agoraT = process.hrtime.bigint();
    const uso = process.cpuUsage(ultimoCpu);
    const dtUs = Number(agoraT - ultimoT) / 1000;
    cpuPct = dtUs > 0 ? Math.round(((uso.user + uso.system) / dtUs) * 1000) / 10 : 0;
    ultimoCpu = process.cpuUsage();
    ultimoT = agoraT;
    eventosSeg = contSeg;
    contSeg = 0;
  }, 1000);
  t.unref();
  return () => clearInterval(t);
}

function status() {
  return {
    cpu: cpuPct,
    memMB: Math.round(process.memoryUsage().rss / 1048576),
    fila: fila(),
    uptime: Math.round(process.uptime()),
    eventosSeg,
  };
}

function ultimos(n) { return buffer.slice(-n); }
function ouvir(fn) { ouvintes.add(fn); return () => ouvintes.delete(fn); }
function definirFila(fn) { fila = fn; }

module.exports = { iniciarAmostragem, emitir, tocouArquivo, arquivosPorMinuto, status, ultimos, ouvir, definirFila };
