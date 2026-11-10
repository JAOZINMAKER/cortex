// Som de máquina opcional (WebAudio). Desligado por padrão.
export class Som {
  constructor() { this.ligado = false; this.ctx = null; this.ult = 0; }
  ligar() {
    if (!this.ctx) {
      const c = this.ctx = new AudioContext(); this.mestre = c.createGain(); this.mestre.gain.value = 0; this.mestre.connect(c.destination);
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420; f.Q.value = 6; f.connect(this.mestre);
      for (const [hz, g] of [[49, 0.16], [98, 0.07], [147.3, 0.035], [196.4, 0.02]]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz; const gg = c.createGain(); gg.gain.value = g; o.connect(gg).connect(f); o.start(); }
      const lfo = c.createOscillator(); lfo.frequency.value = 0.13; const lg = c.createGain(); lg.gain.value = 140; lfo.connect(lg).connect(f.frequency); lfo.start();
      const len = c.sampleRate * 0.03; this.ruido = c.createBuffer(1, len, c.sampleRate); const d = this.ruido.getChannelData(0); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 6);
    }
    this.ctx.resume(); this.mestre.gain.setTargetAtTime(0.22, this.ctx.currentTime, 0.4); this.ligado = true;
  }
  desligar() { if (this.ctx) this.mestre.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2); this.ligado = false; }
  alternar() { this.ligado ? this.desligar() : this.ligar(); return this.ligado; }
  clique(nivel) {
    if (!this.ligado || !this.ctx) return; const t = this.ctx.currentTime; if (t - this.ult < 0.045) return; this.ult = t;
    const s = this.ctx.createBufferSource(); s.buffer = this.ruido; const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = nivel === 'ALERTA' ? 900 : 2600 + Math.random() * 1800; f.Q.value = 8;
    const g = this.ctx.createGain(); g.gain.value = nivel === 'ALERTA' ? 0.9 : 0.35; s.connect(f).connect(g).connect(this.mestre); s.start(t);
  }
}
