// Republique AI — bagimsiz sohbet widget'i. Yalnizca MASADA (/menu/:masa) hizmet verir.
(function () {
  function getTable() {
    const p = new URLSearchParams(location.search);
    let t = p.get('masa') || p.get('table');
    if (!t && location.pathname.startsWith('/menu/')) {
      t = decodeURIComponent(location.pathname.replace('/menu/', '').replace(/\/$/, ''));
    }
    return (t && t.trim() && t !== 'Bilinmiyor') ? t.trim() : null;
  }

  const table = getTable();
  const history = [];
  let opened = false;

  const css = `
  .rai-panel{position:fixed;right:16px;bottom:16px;width:min(380px,calc(100vw - 32px));height:min(560px,70vh);
    background:#141210;border:1px solid #3a2f1c;border-radius:16px;display:none;flex-direction:column;z-index:9999;
    box-shadow:0 20px 60px rgba(0,0,0,.5);overflow:hidden;font-family:'Outfit',system-ui,sans-serif}
  .rai-panel.open{display:flex}
  .rai-head{padding:14px 16px;background:linear-gradient(135deg,#1c3b30,#141210);color:#f0e6d2;
    display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #3a2f1c}
  .rai-head b{font-weight:600;letter-spacing:.3px;display:flex;align-items:center;gap:8px}
  .rai-close{background:none;border:none;color:#c9a24b;font-size:22px;cursor:pointer;line-height:1}
  .rai-body{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px}
  .rai-msg{max-width:85%;padding:10px 13px;border-radius:14px;font-size:14px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word}
  .rai-user{align-self:flex-end;background:#c9a24b;color:#1a1410;border-bottom-right-radius:4px}
  .rai-ai{align-self:flex-start;background:#241f18;color:#eADED0;border:1px solid #3a2f1c;border-bottom-left-radius:4px}
  .rai-foot{display:flex;gap:8px;padding:12px;border-top:1px solid #3a2f1c;background:#100e0c}
  .rai-inp{flex:1;background:#241f18;border:1px solid #3a2f1c;border-radius:12px;color:#f0e6d2;padding:10px 12px;font-size:14px;outline:none}
  .rai-send{background:#c9a24b;border:none;color:#1a1410;border-radius:12px;padding:0 16px;font-weight:600;cursor:pointer}
  .rai-send:disabled{opacity:.5;cursor:default}
  .rai-wait{align-self:flex-start;color:#c9a24b;font-size:13px;font-style:italic}
  .rai-typing{align-self:flex-start;color:#8a7d6a;font-size:13px;font-style:italic}
  `;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  const panel = document.createElement('div');
  panel.className = 'rai-panel';
  panel.innerHTML = `
    <div class="rai-head"><b><span class="material-icons-round">auto_awesome</span> Republique AI</b>
      <button class="rai-close" aria-label="Kapat">&times;</button></div>
    <div class="rai-body" id="raiBody"></div>
    <div class="rai-foot">
      <input class="rai-inp" id="raiInp" placeholder="Menuyle ilgili sorun..." maxlength="500" autocomplete="off">
      <button class="rai-send" id="raiSend">Gonder</button>
    </div>`;
  document.body.appendChild(panel);

  const body = panel.querySelector('#raiBody');
  const inp = panel.querySelector('#raiInp');
  const sendBtn = panel.querySelector('#raiSend');

  function addMsg(role, text) {
    const d = document.createElement('div');
    d.className = 'rai-msg ' + (role === 'user' ? 'rai-user' : 'rai-ai');
    d.textContent = text;
    body.appendChild(d); body.scrollTop = body.scrollHeight;
    return d;
  }

  function open() {
    panel.classList.add('open');
    if (!opened) {
      opened = true;
      addMsg('assistant', 'Merhaba! Ben Republique AI. Bu aksam icin ne onermemi istersiniz? 🍸');
    }
    setTimeout(() => inp.focus(), 100);
  }
  function close() { panel.classList.remove('open'); }

  async function callApi(text) {
    const r = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, table: table, history: history.filter(h => h._sent) })
    });
    return r.json();
  }

  async function send(retryText) {
    const text = retryText || inp.value.trim();
    if (!text) return;
    if (!retryText) { inp.value = ''; addMsg('user', text); history.push({ role: 'user', content: text, _sent: true }); }
    sendBtn.disabled = true;
    const typing = document.createElement('div');
    typing.className = 'rai-typing'; typing.textContent = 'yaziyor...';
    body.appendChild(typing); body.scrollTop = body.scrollHeight;
    try {
      const data = await callApi(text);
      typing.remove();
      if (data && data.queued) {
        // Siraya alindi: geri sayim goster, sure sonunda otomatik tekrar dene
        let sec = Math.max(1, parseInt(data.waitSeconds) || 5);
        const w = document.createElement('div'); w.className = 'rai-wait';
        body.appendChild(w); body.scrollTop = body.scrollHeight;
        const tick = () => {
          w.textContent = `Republique AI su an diger misafirlerimize hizmet veriyor — siraniza ~${sec} sn`;
          if (sec <= 0) { clearInterval(iv); w.remove(); send(text); return; }
          sec--;
        };
        tick(); const iv = setInterval(tick, 1000);
        return;
      }
      const reply = (data && data.reply) || 'Su an yanit veremiyorum.';
      addMsg('assistant', reply);
      history.push({ role: 'assistant', content: reply, _sent: true });
    } catch (e) {
      typing.remove();
      addMsg('assistant', 'Baglanti sorunu yasadim, birazdan tekrar deneyin.');
    } finally {
      sendBtn.disabled = false; inp.focus();
    }
  }

  sendBtn.addEventListener('click', () => send());
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
  panel.querySelector('.rai-close').addEventListener('click', close);

  function wire() {
    const btn = document.querySelector('.ai-btn');
    if (!btn) return;
    if (!table) { btn.style.display = 'none'; return; } // masasiz (reklam/genel) -> AI gizli
    btn.addEventListener('click', open);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();
})();
