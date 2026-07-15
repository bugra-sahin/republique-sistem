// Republique AI — sohbet widget'i (menu paleti). Yalnizca masada. Alttan karsilama pili + yuvarlak buton;
// ekrani kaplamaz; mobilde alt-sayfa; buton tiklaninca sayfa KAYMAZ (preventScroll).
(function () {
  function getTable() {
    const p = new URLSearchParams(location.search);
    let t = p.get('masa') || p.get('table');
    if (!t && location.pathname.startsWith('/menu/')) t = decodeURIComponent(location.pathname.replace('/menu/', '').replace(/\/$/, ''));
    return (t && t.trim() && t !== 'Bilinmiyor') ? t.trim() : null;
  }
  const table = getTable();
  if (!table) {
    // Masasiz ziyaretci: KOTA KORUMASI -> "Republique AI" butonu HIC gorunmesin (spec #35 / OPUS-GOREV IS2).
    // (Onceki surumde buton gorunup tiklaninca davet mesaji cikiyordu; UX tutarsizdi. Artik buton tamamen gizli.)
    function hideAiBtn() { const b = document.querySelector('.ai-btn'); if (b) b.style.display = 'none'; }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hideAiBtn); else hideAiBtn();
    return;
  }

  // FIX (2026-07-14, Fable): SOHBET KALICILIGI. iPhone'da sekme cokup "sayfa yenilendi"ginde
  // sohbet RAM'de oldugu icin kayboluyordu. Artik her mesaj sessionStorage'a yazilir (masa
  // anahtarli, son 30 mesaj); sayfa yeniden yuklenince sohbet AYNEN geri gelir.
  const HKEY = 'raiHist:' + table;
  let history = [];
  try { history = JSON.parse(sessionStorage.getItem(HKEY) || '[]'); if (!Array.isArray(history)) history = []; } catch (e) { history = []; }
  function saveHist() { try { sessionStorage.setItem(HKEY, JSON.stringify(history.slice(-30))); } catch (e) {} }
  let started = false;

  const css = `
  :root{}
  .rai-fab{position:fixed;right:14px;bottom:14px;z-index:9999;display:flex;align-items:center;gap:0;
    background:linear-gradient(135deg,#0a1f16,#05100c);border:1px solid rgba(212,175,55,.5);color:#f3d573;
    border-radius:30px;box-shadow:0 8px 30px rgba(0,0,0,.5);cursor:pointer;overflow:hidden;transition:.25s;
    font-family:'Outfit',system-ui,sans-serif;max-width:calc(100vw - 28px)}
  .rai-fab .ic{width:52px;height:52px;min-width:52px;display:flex;align-items:center;justify-content:center;font-size:24px;color:#d4af37}
  .rai-fab .greet{padding-right:16px;font-size:13.5px;line-height:1.3;color:#f5f5f5;max-width:210px}
  .rai-fab.round .greet{display:none}
  .rai-fab.hidden{display:none}
  .rai-panel{position:fixed;right:14px;bottom:14px;width:min(380px,calc(100vw - 28px));height:min(560px,72vh);
    background:#05100c;border:1px solid rgba(212,175,55,.25);border-radius:18px;display:none;flex-direction:column;
    z-index:10000;box-shadow:0 20px 60px rgba(0,0,0,.6);overflow:hidden;font-family:'Outfit',system-ui,sans-serif}
  .rai-panel.open{display:flex}
  .rai-head{padding:14px 16px;background:linear-gradient(135deg,#0a1f16,#05100c);color:#f3d573;
    display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(212,175,55,.18)}
  .rai-head b{font-weight:600;letter-spacing:.3px;display:flex;align-items:center;gap:8px;color:#d4af37;font-size:15px}
  .rai-close{background:none;border:none;color:#d4af37;font-size:24px;cursor:pointer;line-height:1}
  .rai-body{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;-webkit-overflow-scrolling:touch}
  .rai-msg{max-width:86%;padding:10px 13px;border-radius:14px;font-size:14px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word}
  .rai-user{align-self:flex-end;background:#d4af37;color:#05100c;border-bottom-right-radius:4px;font-weight:500}
  .rai-ai{align-self:flex-start;background:#0a1f16;color:#f5f5f5;border:1px solid rgba(212,175,55,.15);border-bottom-left-radius:4px}
  .rai-foot{display:flex;gap:8px;padding:12px;border-top:1px solid rgba(212,175,55,.15);background:#040d09}
  .rai-inp{flex:1;background:#0a1f16;border:1px solid rgba(212,175,55,.2);border-radius:12px;color:#f5f5f5;padding:11px 13px;font-size:16px;outline:none}
  .rai-send{background:#d4af37;border:none;color:#05100c;border-radius:12px;padding:0 16px;font-weight:700;cursor:pointer}
  .rai-send:disabled{opacity:.5}
  .rai-wait{align-self:flex-start;color:#d4af37;font-size:13px;font-style:italic}
  .rai-actbtn{align-self:flex-start;background:linear-gradient(135deg,#0a1f16,#05100c);color:#f3d573;
    border:1px solid rgba(212,175,55,.55);border-radius:12px;padding:9px 14px;font-size:13.5px;font-weight:600;
    cursor:pointer;margin-top:-2px;font-family:'Outfit',system-ui,sans-serif;transition:.15s}
  .rai-actbtn:hover{background:#0e2a1e}
  .rai-actbtn:disabled{opacity:.5;cursor:default}
  .rai-typing{align-self:flex-start;color:#a0aab2;font-size:13px;font-style:italic}
  @media(max-width:520px){
    .rai-panel{right:0;left:0;bottom:0;top:auto;width:100%;height:88vh;height:88dvh;border-radius:18px 18px 0 0;border-left:0;border-right:0;border-bottom:0}
  }
  body.rai-lock{overflow:hidden!important}`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  // Alttan karsilama pili (baslamadiysa) / yuvarlak buton (basladiysa)
  const fab = document.createElement('div');
  fab.className = 'rai-fab';
  fab.innerHTML = `<div class="ic"><span class="material-icons-round">auto_awesome</span></div><div class="greet">Hoş geldiniz! Sorularınızı Republique AI'a sorabilirsiniz.</div>`;
  document.body.appendChild(fab);
  if (history.length) fab.classList.add('round'); // onceki sohbeti olan misafire buyuk karsilama balonu tekrar gosterilmez

  const panel = document.createElement('div');
  panel.className = 'rai-panel';
  panel.innerHTML = `
    <div class="rai-head"><b><span class="material-icons-round">auto_awesome</span> Republique AI</b>
      <button class="rai-close" aria-label="Kapat">&times;</button></div>
    <div class="rai-body" id="raiBody"></div>
    <div class="rai-foot">
      <input class="rai-inp" id="raiInp" placeholder="Menüyle ilgili sorun..." maxlength="500" autocomplete="off">
      <button class="rai-send" id="raiSend" type="button">Gönder</button>
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
  // Sohbet icine DOKUNULABILIR eylem butonu (bolum/urun goster). Ekrani otomatik kaydirmaz;
  // sadece kullanici dokununca calisir. Tek kullanimlik (dokununca kendini pasiflestirir).
  function addActionBtn(label, onTap) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'rai-actbtn'; b.textContent = label;
    b.addEventListener('click', function () {
      if (b.disabled) return; b.disabled = true;
      try { onTap(); } catch (e) {}
    });
    body.appendChild(b); body.scrollTop = body.scrollHeight;
    return b;
  }
  const isMobile = () => window.matchMedia('(max-width:520px)').matches;
  let savedScrollY = 0;
  function lockBody() {
    savedScrollY = window.scrollY || window.pageYOffset || 0;
    document.body.classList.add('rai-lock');
    document.body.style.position = 'fixed';
    document.body.style.top = (-savedScrollY) + 'px';
    document.body.style.left = '0'; document.body.style.right = '0'; document.body.style.width = '100%';
  }
  function unlockBody() {
    document.body.classList.remove('rai-lock');
    document.body.style.position = ''; document.body.style.top = '';
    document.body.style.left = ''; document.body.style.right = ''; document.body.style.width = '';
    window.scrollTo(0, savedScrollY);
  }
  // Klavye acilinca paneli gorunur alana (visualViewport) hizala; sayfa KAYMAZ
  function syncVV() {
    if (!isMobile() || !panel.classList.contains('open')) return;
    const vv = window.visualViewport; if (!vv) return;
    panel.style.height = vv.height + 'px';
    panel.style.top = (vv.offsetTop) + 'px';
    panel.style.bottom = 'auto';
  }
  function clearVV() { panel.style.height = ''; panel.style.top = ''; panel.style.bottom = ''; }
  function open() {
    fab.classList.add('hidden');
    panel.classList.add('open');
    if (!started) {
      started = true;
      if (history.length) {
        // Onceki sohbeti (reload/cokme sonrasi) AYNEN geri yukle
        history.forEach(function (h) { if (h && h.content) addMsg(h.role === 'user' ? 'user' : 'assistant', h.content); });
      } else {
        addMsg('assistant', 'Merhaba, hoş geldiniz! Bu akşam için ne önermemi istersiniz?');
      }
    }
    lockBody();
    if (window.visualViewport) { window.visualViewport.addEventListener('resize', syncVV); window.visualViewport.addEventListener('scroll', syncVV); syncVV(); }
    // Mobilde otomatik focus SAYFAYI KAYDIRIR -> masaustunde focus, dokunmatikte kullanici kendi dokunur
    const touch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    if (!touch) { try { inp.focus({ preventScroll: true }); } catch (e) {} }
  }
  function close() {
    panel.classList.remove('open');
    fab.classList.remove('hidden');
    fab.classList.add('round'); // baslamis -> yuvarlak buton (greet gizli)
    if (window.visualViewport) { window.visualViewport.removeEventListener('resize', syncVV); window.visualViewport.removeEventListener('scroll', syncVV); }
    clearVV();
    unlockBody();
  }
  fab.addEventListener('click', function (e) { e.preventDefault(); open(); });
  panel.querySelector('.rai-close').addEventListener('click', close);
  // MOBIL CAKISMA FIX (OPUS-GOREV IS3): genis karsilama balonu ~6sn sonra otomatik YUVARLAGA donsun ki
  // 390px'de sol-alt "Uye Ol/Giris" butonu ile sag-alt balon ust uste binmesin. (Panel acilmadiysa.)
  setTimeout(function () { if (!panel.classList.contains('open')) fab.classList.add('round'); }, 6000);

  // FIX (2026-07-14, Fable): 30sn zaman asimi + tek otomatik yeniden deneme.
  // (Sonnet yanit gecikmesi/gecici ag hatasi "Baglanti sorunu yasadim"a dusuruyordu.)
  function fetchChat(text) {
    const ctl = ('AbortController' in window) ? new AbortController() : null;
    const t = ctl ? setTimeout(function () { try { ctl.abort(); } catch (e) {} }, 30000) : null;
    return fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, table: table, history: history.filter(h => h._sent !== false) }),
      signal: ctl ? ctl.signal : undefined })
      .then(r => r.json())
      .finally(function () { if (t) clearTimeout(t); });
  }
  async function callApi(text) {
    try { return await fetchChat(text); }
    catch (e) { await new Promise(r => setTimeout(r, 1200)); return fetchChat(text); }
  }
  async function send(retryText) {
    const text = retryText || inp.value.trim();
    if (!text) return;
    if (!retryText) { inp.value = ''; addMsg('user', text); history.push({ role: 'user', content: text, _sent: true }); saveHist(); }
    sendBtn.disabled = true;
    const typing = document.createElement('div');
    typing.className = 'rai-typing'; typing.textContent = 'yazıyor...';
    body.appendChild(typing); body.scrollTop = body.scrollHeight;
    try {
      const data = await callApi(text);
      typing.remove();
      if (data && data.queued) {
        let sec = Math.max(1, parseInt(data.waitSeconds) || 5);
        const w = document.createElement('div'); w.className = 'rai-wait'; body.appendChild(w); body.scrollTop = body.scrollHeight;
        const tick = () => { w.textContent = `Republique AI şu an diğer misafirlerimize hizmet veriyor — sıranıza ~${sec} sn`;
          if (sec <= 0) { clearInterval(iv); w.remove(); send(text); return; } sec--; };
        tick(); const iv = setInterval(tick, 1000); return;
      }
      // FIX (2026-07-14, Fable): model bazen SADECE [[SHOW]] etiketi donduruyor -> reply "" (bos).
      // Eski kod bosu "Su an yanit veremiyorum" yapiyordu; altinda "kartini ac" butonu olunca
      // celiskili/bozuk gorunuyordu. Bos + show/goto varsa dogal bir cumle koy.
      let reply = (data && data.reply) || '';
      if (!reply && data && (data.show || data.goto)) reply = 'Buyurun, hemen göstereyim:';
      if (!reply) reply = 'Şu an yanıt veremiyorum.';
      addMsg('assistant', reply); history.push({ role: 'assistant', content: reply, _sent: true }); saveHist();
      // Gorus alindi + tekrar gelen misafir + olumsuz degil -> Google degerlendirme linkini nazikce goster
      if (data && data.googleDavet && data.googleUrl) {
        const g = document.createElement('a');
        g.href = data.googleUrl; g.target = '_blank'; g.rel = 'noopener';
        g.textContent = "Google'da değerlendir";
        g.style.cssText = "align-self:flex-start;display:inline-block;background:#1a73e8;color:#fff;text-decoration:none;border-radius:12px;padding:9px 14px;font-size:13px;font-weight:600;margin-top:-2px";
        body.appendChild(g); body.scrollTop = body.scrollHeight;
      }
      // ONEMLI (UX): Ekrani KULLANICI ADINA otomatik kaydirma/acma YOK. AI bir bolum/urun
      // isaret ederse, sohbete DOKUNULABILIR bir buton koyariz; kullanici isterse dokunur.
      // (Eski davranis: otomatik b.click()/raiShowProduct + gecikmeli setTimeout -> "kendiliginden
      //  kokteyl acildi/sayfa kaydi" sikayeti. Artik sadece kullanici hareketiyle.)
      if (data && data.goto) {
        addActionBtn(data.goto + ' bölümüne git', function () {
          const norm = x => String(x).toLowerCase().replace(/ı/g,'i').replace(/ü/g,'u').replace(/ö/g,'o').replace(/ç/g,'c').replace(/ş/g,'s').replace(/ğ/g,'g').replace(/[^a-z0-9]/g,'');
          const g = norm(data.goto); const btns = [...document.querySelectorAll('.cat-btn')];
          let idx = btns.findIndex(x => norm(x.textContent) === g);
          if (idx < 0) idx = btns.findIndex(x => norm(x.textContent).includes(g) || g.includes(norm(x.textContent)));
          close();
          // Panel kapandiktan sonra (body kilidi cozulunce) HEDEF BOLUME kaydir.
          // NOT: cat-btn.click() programatik cagride kaydirmiyor (app.js davranisi) -> ilgili
          //      #cat-{index} bolumune DOGRUDAN scrollIntoView (guvenilir) + aktif rozet icin click.
          setTimeout(function () {
            try {
              const b = btns[idx];
              if (b) b.click(); // aktif kategori rozeti + tembel render tetigi
              const sec = idx >= 0 ? document.getElementById('cat-' + idx) : null;
              // NOT: behavior:'smooth' tembel-render (content-visibility) ile bu sayfada
              //      calismiyor (0'da kaliyor) -> 'instant' guvenilir sekilde hedefe atlar.
              if (sec) sec.scrollIntoView({ behavior: 'instant', block: 'start' });
              else if (b) b.scrollIntoView({ behavior: 'instant', block: 'start' });
              // Uzak bir noktaya atladik: pencereli render'a "yeni konumuna gore doldur/bosalt" de.
              // (scroll olayi programatik atlamada gec/hic gelmeyebilir -> hedef bolum bos gorunurdu.)
              if (typeof window.__raiEnsureWindow === 'function') window.__raiEnsureWindow();
            } catch (e) {}
          }, 80);
        });
      }
      // AI bir urunu gostermek isterse: DOKUNULABILIR buton -> kullanici dokununca kartini (foto+detay) ac
      if (data && data.show) {
        addActionBtn(data.show + ' kartını aç', function () {
          close();
          setTimeout(function () {
            let ok = false;
            if (typeof window.raiShowProduct === 'function') { try { ok = !!window.raiShowProduct(data.show); } catch (e) { ok = false; } }
            // FIX (2026-07-14, Fable): urun bulunamazsa SESSIZCE hicbir sey olmuyordu
            // ("karta goturmedi"). Artik sohbet yeniden acilip nazik bir aciklama gosterilir.
            if (!ok) {
              open();
              addMsg('assistant', 'Kartı şu an açamadım — menüde "' + data.show + '" adıyla bulamadım. Garsonumuza sorabilirsiniz, yardımcı olacaktır.');
            }
          }, 80);
        });
      }
    } catch (e) { typing.remove(); addMsg('assistant', 'Bağlantı sorunu yaşadım, birazdan tekrar deneyin.'); }
    finally { sendBtn.disabled = false; }
  }
  sendBtn.addEventListener('click', () => send());
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });

  // Header'daki mevcut .ai-btn de acsin (varsa) — ama sayfayi kaydirmadan
  function wire() { const b = document.querySelector('.ai-btn'); if (b) b.addEventListener('click', function(e){ e.preventDefault(); open(); }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();
})();
