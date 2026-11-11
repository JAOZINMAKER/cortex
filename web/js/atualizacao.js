// ATUALIZAÇÃO automática do app (window.cortexApp.atualizacao, só no app de desktop).
// Faixa discreta no topo quando a versão nova está pronta, e dados para CONFIGURAÇÕES → ATUALIZAÇÕES.
import { $, esc } from './util.js';

export class Atualizacao {
  constructor(app) {
    this.app = app; this.api = window.cortexApp && window.cortexApp.atualizacao; this.e = null; this.dispensada = null; this.versaoServidor = null;
    const f = document.createElement('div'); f.id = 'faixa-atual'; f.className = 'faixa-atual'; f.hidden = true; document.body.appendChild(f); this.f = f;
    if (this.api) {
      try { this.api.aoMudar(e => this._mudou(e)); } catch {}
      this.ler();
      addEventListener('focus', () => this._faixa());
      document.addEventListener('visibilitychange', () => this._faixa());
    }
  }
  get disponivelNoApp() { return !!this.api; }
  async ler() { if (!this.api) return null; try { this._mudou(await this.api.estado()); } catch (e) { this._mudou({ erro: e.message }); } return this.e; }
  _mudou(e) { this.e = { ...(this.e || {}), ...(e || {}) }; this._faixa(); const pg = this.app.shell?.paginas?.config; if (pg && pg.sub === 'atualizacoes' && pg.box?.isConnected) pg._atualizacoes(pg.box); }
  versaoNova() { const e = this.e || {}; const d = e.disponivel; return (d && (d.versao || d)) || e.versaoNova || e.versaoPronta || ''; }
  // a faixa só aparece com a janela em uso
  _faixa() {
    const e = this.e || {}; const v = this.versaoNova(); const emUso = document.visibilityState === 'visible';
    const mostrar = !!(e.pronta && emUso && this.dispensada !== String(v));
    this.f.hidden = !mostrar; document.body.classList.toggle('com-faixa', mostrar);
    if (mostrar) {
      this.f.innerHTML = `<span class="fa-ic">▲</span><b>CÓRTEX ${esc(v || 'NOVO')} PRONTO</b><span class="fa-t">A VERSÃO NOVA JÁ FOI BAIXADA${e.versaoAtual ? ' · VOCÊ ESTÁ NA ' + esc(e.versaoAtual) : ''} · LEVA POUCOS SEGUNDOS</span><button data-reiniciar>REINICIAR AGORA</button><button class="fa-x" data-depois title="LEMBRAR DEPOIS">DEPOIS</button>`;
      this.f.querySelector('[data-reiniciar]').onclick = () => { this.f.querySelector('[data-reiniciar]').textContent = 'REINICIANDO…'; try { this.api.reiniciarAgora(); } catch {} };
      this.f.querySelector('[data-depois]').onclick = () => { this.dispensada = String(v); this._faixa(); };
    }
  }
  async verificar() { if (!this.api) return; this._mudou({ verificando: true }); try { const r = await this.api.verificarAgora(); this._mudou({ verificando: false, ...(r && typeof r === 'object' ? r : {}) }); } catch (e) { this._mudou({ verificando: false, erro: e.message }); } await this.ler(); }
}
