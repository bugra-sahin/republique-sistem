// MODUL 1 (frontend) — ARTIK: Uyelik + OTP giris. "Gorus Bildir" butonu KALDIRILDI;
// gorusleri Republique AI garson topluyor (ai-chat.js + backend [[GORUS:]]).
// Uyelik: ad, soyad, dogum gunu (18+), telefon VEYA e-posta + KVKK -> tek kullanimlik kod ile giris.
(function () {
  function esc(s){return String(s||'').replace(/[<>&]/g,function(c){return({'<':'&lt;','>':'&gt;','&':'&amp;'})[c];});}

  var css = ""
    + ".rf-fab{position:fixed;left:16px;bottom:18px;z-index:9998;background:#0a1f16;color:#f3d573;border:1px solid rgba(212,175,55,.5);"
    + "padding:11px 15px;border-radius:30px;font-family:'Outfit',system-ui,sans-serif;font-size:13px;cursor:pointer;box-shadow:0 8px 22px rgba(0,0,0,.45);display:flex;align-items:center;gap:7px}"
    + ".rf-fab:hover{background:#0d2a1e}"
    + ".rf-ov{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:10000;display:none;align-items:center;justify-content:center;padding:18px}"
    + ".rf-ov.show{display:flex}"
    + ".rf-card{background:#0a1f16;border:1px solid rgba(212,175,55,.35);border-radius:18px;max-width:420px;width:100%;padding:20px;"
    + "font-family:'Outfit',system-ui,sans-serif;color:#f5f5f5;box-shadow:0 20px 50px rgba(0,0,0,.6)}"
    + ".rf-card h3{font-size:18px;color:#f3d573;margin:0 0 4px}"
    + ".rf-card p{font-size:13px;color:#a0aab2;margin:0 0 14px;line-height:1.5}"
    + ".rf-card textarea,.rf-card input{width:100%;background:#05100c;border:1px solid rgba(212,175,55,.25);border-radius:11px;color:#f5f5f5;"
    + "font-family:inherit;font-size:16px;padding:11px;margin-bottom:10px;box-sizing:border-box}"
    + ".rf-row{display:flex;gap:8px;font-size:12px;color:#a0aab2;align-items:flex-start;margin-bottom:12px}"
    + ".rf-row a{color:#f3d573}"
    + ".rf-tabs{display:flex;gap:8px;margin-bottom:14px}"
    + ".rf-tab{flex:1;text-align:center;padding:9px;border-radius:10px;border:1px solid rgba(212,175,55,.25);cursor:pointer;font-size:13px;color:#a0aab2}"
    + ".rf-tab.on{background:rgba(212,175,55,.15);color:#f3d573;border-color:rgba(212,175,55,.5)}"
    + ".rf-seg{display:flex;gap:8px;margin-bottom:10px}"
    + ".rf-seg button{flex:1;padding:9px;border-radius:10px;border:1px solid rgba(212,175,55,.25);background:none;color:#a0aab2;cursor:pointer;font-family:inherit;font-size:13px}"
    + ".rf-seg button.on{background:rgba(212,175,55,.15);color:#f3d573;border-color:rgba(212,175,55,.5)}"
    + ".rf-btn{background:linear-gradient(180deg,#d4af37,#b8912f);color:#05100c;border:0;border-radius:11px;padding:12px;width:100%;"
    + "font-family:inherit;font-weight:600;font-size:15px;cursor:pointer}"
    + ".rf-btn.sec{background:none;color:#a0aab2;border:1px solid rgba(212,175,55,.25);margin-top:8px;font-weight:400}"
    + ".rf-x{float:right;color:#a0aab2;cursor:pointer;font-size:20px;line-height:1;margin-top:-4px}"
    + ".rf-note{font-size:12px;color:#8a94a0;margin-top:10px;text-align:center}"
    + ".rf-err{font-size:12px;color:#e8a;margin:2px 0 8px}"
    + ".rf-lbl{font-size:12px;color:#a0aab2;margin:2px 0 4px}";
  var st=document.createElement('style'); st.textContent=css; document.head.appendChild(st);

  function ov(){ var o=document.querySelector('.rf-ov'); if(!o){o=document.createElement('div');o.className='rf-ov';document.body.appendChild(o);o.addEventListener('click',function(e){if(e.target===o)o.classList.remove('show');});} return o; }
  function api(url, body){ return fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})}).then(function(r){return r.json();}); }

  var state = { girisli:false, ad:null };

  // OTP dogrulama ekrani (kanal: sms/email, hedef alanlari kayittan tasinir)
  function otpEkrani(o, ctx){
    o.innerHTML='<div class="rf-card"><span class="rf-x" data-close>&times;</span>'
      +'<h3>Doğrulama Kodu</h3>'
      +'<p>'+esc(ctx.mesaj||('Gönderilen 6 haneli kodu girin.'))+'</p>'
      +'<input id="rfKod" placeholder="6 haneli kod" inputmode="numeric" maxlength="6" autocomplete="one-time-code">'
      +'<div class="rf-err" id="rfErr" style="display:none"></div>'
      +'<button class="rf-btn" id="rfDog">Doğrula ve Giriş Yap</button>'
      +'<button class="rf-btn sec" id="rfTekrar">Kodu tekrar gönder</button></div>';
    o.querySelector('[data-close]').onclick=function(){o.classList.remove('show');};
    function err(m){var e=o.querySelector('#rfErr');e.style.display='block';e.textContent=m;}
    o.querySelector('#rfDog').onclick=async function(){
      var kod=(o.querySelector('#rfKod').value||'').replace(/[^0-9]/g,'');
      if(kod.length!==6){err('6 haneli kodu girin.');return;}
      this.disabled=true;this.textContent='Kontrol ediliyor...';
      var d=await api('/api/uye/dogrula',{telefon:ctx.telefon,email:ctx.email,kod:kod});
      if(d.ok){o.querySelector('.rf-card').innerHTML='<h3>Hoş geldiniz '+esc(d.uye.ad||'')+'!</h3><p>Üyeliğiniz aktif. Doğum gününüzde ve kampanyalarda sizi hatırlayacağız.</p><button class="rf-btn" data-close4>Kapat</button>';
        o.querySelector('[data-close4]').onclick=function(){o.classList.remove('show');};
        state.girisli=true; state.ad=d.uye.ad; renderFab();}
      else{this.disabled=false;this.textContent='Doğrula ve Giriş Yap';err(d.error||'Kod hatalı.');}
    };
    o.querySelector('#rfTekrar').onclick=async function(){
      this.disabled=true;this.textContent='Gönderiliyor...';
      var fn = ctx.mode==='kayit' ? null : '/api/uye/giris';
      // Tekrar gonderim: girişte /api/uye/giris; kayıtta yeniden /api/uye/giris de kod uretir (uye artik var)
      var d=await api('/api/uye/giris',{telefon:ctx.telefon,email:ctx.email});
      this.disabled=false;this.textContent='Kodu tekrar gönder';
      if(!d.ok)err(d.error||'Gönderilemedi.');
    };
  }

  function acModal(mode){
    var o=ov(); o.classList.add('show');
    var kanal='sms';
    function draw(){
      var isKayit = mode==='kayit';
      o.innerHTML='<div class="rf-card"><span class="rf-x" data-close>&times;</span>'
        +'<div class="rf-tabs"><div class="rf-tab '+(isKayit?'on':'')+'" data-m="kayit">Üye Ol</div><div class="rf-tab '+(!isKayit?'on':'')+'" data-m="giris">Giriş</div></div>'
        +'<h3>'+(isKayit?'Republique Tunalı Üyeliği':'Üye Girişi')+'</h3>'
        +'<p>'+(isKayit?'Üyelere doğum günü sürprizleri ve kampanyalar. Üyelik 18 yaş ve üzeri içindir.':'Telefon veya e-postanıza tek kullanımlık kod gönderelim.')+'</p>'
        +(isKayit?('<input id="rfAd" placeholder="Adınız" maxlength="60"><input id="rfSoyad" placeholder="Soyadınız" maxlength="60">'
            +'<div class="rf-lbl">Doğum tarihiniz (18+ doğrulaması için)</div><input id="rfDogum" type="date">'):'')
        +'<div class="rf-seg"><button data-k="sms" class="'+(kanal==='sms'?'on':'')+'">Telefon</button><button data-k="email" class="'+(kanal==='email'?'on':'')+'">E-posta</button></div>'
        +(kanal==='sms'?'<input id="rfHedef" placeholder="Telefon (5XX XXX XX XX)" inputmode="numeric" maxlength="16">':'<input id="rfHedef" placeholder="E-posta adresiniz" inputmode="email" maxlength="120">')
        +(isKayit?('<label class="rf-row"><input type="checkbox" id="rfKvkk" style="width:auto;margin:2px 0 0"> <span><a href="/gizlilik.html" target="_blank">KVKK ve Çerez Politikası</a>\'nı okudum, üyelik ve iletişim için bilgilerimin işlenmesini onaylıyorum.</span></label>'):'')
        +'<div class="rf-err" id="rfErr" style="display:none"></div>'
        +'<button class="rf-btn" id="rfGo">'+(isKayit?'Kodu Gönder':'Giriş Kodu Gönder')+'</button></div>';
      o.querySelector('[data-close]').onclick=function(){o.classList.remove('show');};
      [].forEach.call(o.querySelectorAll('.rf-tab'),function(t){t.onclick=function(){mode=t.getAttribute('data-m');draw();};});
      [].forEach.call(o.querySelectorAll('.rf-seg button'),function(b){b.onclick=function(){kanal=b.getAttribute('data-k');draw();};});
      function err(m){var e=o.querySelector('#rfErr');e.style.display='block';e.textContent=m;}
      o.querySelector('#rfGo').onclick=async function(){
        var hedef=(o.querySelector('#rfHedef').value||'').trim();
        if(!hedef){err('Telefon veya e-posta girin.');return;}
        var payload={}; if(kanal==='sms')payload.telefon=hedef; else payload.email=hedef;
        if(isKayit){
          var ad=(o.querySelector('#rfAd').value||'').trim(), soyad=(o.querySelector('#rfSoyad').value||'').trim(), dogum=(o.querySelector('#rfDogum').value||'');
          if(ad.length<2||soyad.length<2){err('Ad ve soyad girin.');return;}
          if(!dogum){err('Doğum tarihinizi girin.');return;}
          if(!o.querySelector('#rfKvkk').checked){err('Devam için KVKK onayı gerekli.');return;}
          payload.ad=ad;payload.soyad=soyad;payload.dogum_gunu=dogum;payload.kvkk=true;
        }
        this.disabled=true;this.textContent='Gönderiliyor...';
        var d=await api(isKayit?'/api/uye/kayit':'/api/uye/giris',payload);
        if(d.ok){ otpEkrani(o,{mode:isKayit?'kayit':'giris',telefon:payload.telefon,email:payload.email,mesaj:d.mesaj}); }
        else{this.disabled=false;this.textContent=isKayit?'Kodu Gönder':'Giriş Kodu Gönder';err(d.error||'İşlem başarısız.');}
      };
    }
    draw();
  }

  function hesapModal(){
    var o=ov(); o.classList.add('show');
    o.innerHTML='<div class="rf-card"><span class="rf-x" data-close>&times;</span>'
      +'<h3>Merhaba '+esc(state.ad||'')+'</h3>'
      +'<p>Republique Tunalı üyesisiniz.'+(state.dogumGunuBugun?' 🎉 Doğum gününüz kutlu olsun — bugün masanızda bizi hatırlatın, size küçük bir sürprizimiz olsun!':'')+'</p>'
      +'<button class="rf-btn sec" id="rfCikis">Çıkış Yap</button></div>';
    o.querySelector('[data-close]').onclick=function(){o.classList.remove('show');};
    o.querySelector('#rfCikis').onclick=async function(){ await api('/api/uye/cikis',{}); state.girisli=false; state.ad=null; renderFab(); o.classList.remove('show'); };
  }

  function renderFab(){
    var b=document.querySelector('.rf-fab');
    if(!b){ b=document.createElement('button'); b.className='rf-fab'; document.body.appendChild(b); }
    if(state.girisli){ b.innerHTML='<span class="material-icons-round" style="font-size:18px">person</span> '+esc(state.ad||'Hesabım'); b.onclick=hesapModal; }
    else { b.innerHTML='<span class="material-icons-round" style="font-size:18px">person_add</span> Üye Ol / Giriş'; b.onclick=function(){acModal('kayit');}; }
  }

  async function init(){
    try{ var d=await fetch('/api/uye/ben').then(function(r){return r.json();});
      if(d&&d.girisli){state.girisli=true;state.ad=d.ad;state.dogumGunuBugun=d.dogumGunuBugun;} }catch(e){}
    renderFab();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();

  // Disaridan cagirilabilir
  window.raiUyelik = function(){ acModal('kayit'); };
})();
