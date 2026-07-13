// MODUL 1 (frontend): "Gorus Bildir" + opsiyonel uyelik. Menu ASLA kayit zorlamaz.
// Google degerlendirme linki HERKESE gosterilir (review-gating YOK). Olumsuzda once iceride telafi.
(function () {
  // Gercek Google degerlendirme linki (Bugra verdi)
  var GOOGLE_REVIEW_URL = "https://g.page/r/CXmH-0MBy7JKEBM/review";

  function getCookie(n){var v='; '+document.cookie;var p=v.split('; '+n+'=');if(p.length===2)return p.pop().split(';').shift();return null;}
  function getTable(){var p=new URLSearchParams(location.search);var t=p.get('masa')||p.get('table');
    if(!t&&location.pathname.indexOf('/menu/')===0)t=decodeURIComponent(location.pathname.replace('/menu/','').replace(/\/$/,''));
    return t&&t.trim()?t.trim():null;}
  var table=getTable();

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
    + "font-family:inherit;font-size:14px;padding:11px;margin-bottom:10px}"
    + ".rf-card textarea{min-height:88px;resize:vertical}"
    + ".rf-row{display:flex;gap:8px;font-size:12px;color:#a0aab2;align-items:flex-start;margin-bottom:12px}"
    + ".rf-row a{color:#f3d573}"
    + ".rf-btn{background:linear-gradient(180deg,#d4af37,#b8912f);color:#05100c;border:0;border-radius:11px;padding:12px;width:100%;"
    + "font-family:inherit;font-weight:600;font-size:14px;cursor:pointer}"
    + ".rf-btn.sec{background:none;color:#a0aab2;border:1px solid rgba(212,175,55,.25);margin-top:8px;font-weight:400}"
    + ".rf-x{float:right;color:#a0aab2;cursor:pointer;font-size:20px;line-height:1;margin-top:-4px}"
    + ".rf-gbtn{display:block;text-align:center;background:#1a73e8;color:#fff;text-decoration:none;border-radius:11px;padding:12px;margin-top:6px;font-weight:600;font-size:14px}"
    + ".rf-note{font-size:12px;color:#8a94a0;margin-top:10px;text-align:center}";
  var st=document.createElement('style'); st.textContent=css; document.head.appendChild(st);

  function ov(){ var o=document.querySelector('.rf-ov'); if(!o){o=document.createElement('div');o.className='rf-ov';document.body.appendChild(o);o.addEventListener('click',function(e){if(e.target===o)o.classList.remove('show');});} return o; }
  function esc(s){return String(s||'').replace(/[<>&]/g,function(c){return({'<':'&lt;','>':'&gt;','&':'&amp;'})[c];});}

  function openFeedback(){
    var o=ov();
    o.innerHTML='<div class="rf-card"><span class="rf-x" data-close>&times;</span>'
      +'<h3>Görüşünüz bizim için değerli</h3>'
      +'<p>Deneyiminizi paylaşın — iyisiyle kötüsüyle her şeyi duymak isteriz.</p>'
      +'<textarea id="rfText" placeholder="Deneyiminiz nasıldı?"></textarea>'
      +'<button class="rf-btn" id="rfSend">Gönder</button>'
      +'<div id="rfResult"></div></div>';
    o.classList.add('show');
    o.querySelector('[data-close]').onclick=function(){o.classList.remove('show');};
    o.querySelector('#rfSend').onclick=async function(){
      var t=(o.querySelector('#rfText').value||'').trim();
      if(t.length<2){o.querySelector('#rfText').focus();return;}
      this.disabled=true;this.textContent='Gönderiliyor...';
      try{
        var r=await fetch('/api/feedback',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({metin:t,masa:table,kaynak:'menu-buton'})});
        var d=await r.json();
        var res=o.querySelector('#rfResult');
        if(d.ok){
          o.querySelector('#rfText').style.display='none';
          this.style.display='none';
          // Google daveti YALNIZCA tekrar gelen misafire ve olumsuz olmayan geri bildirimde (backend karar verir).
          var g = d.googleDavet ? '<a class="rf-gbtn" href="'+GOOGLE_REVIEW_URL+'" target="_blank" rel="noopener">Google\'da değerlendir</a>' : '';
          res.innerHTML='<p style="color:#f5f5f5;margin:8px 0 4px">'+esc(d.mesaj)+'</p>'
            + g
            +'<button class="rf-btn sec" data-close2>Kapat</button>';
          res.querySelector('[data-close2]').onclick=function(){o.classList.remove('show');};
        } else {
          res.innerHTML='<div class="rf-note" style="color:#e8a">'+esc(d.error||'Gönderilemedi')+'</div>';
          this.disabled=false;this.textContent='Gönder';
        }
      }catch(e){this.disabled=false;this.textContent='Gönder';}
    };
  }

  function openMember(){
    var o=ov();
    o.innerHTML='<div class="rf-card"><span class="rf-x" data-close>&times;</span>'
      +'<h3>Republique Ailesine Katılın</h3>'
      +'<p>Telefonunuzu bırakın, ilk ziyaretinizde küçük bir ikramımız olsun. Kampanyalardan ilk siz haberdar olun.</p>'
      +'<input id="rfName" placeholder="Adınız (opsiyonel)" maxlength="80">'
      +'<input id="rfPhone" placeholder="Telefon (5XX XXX XX XX)" inputmode="numeric" maxlength="16">'
      +'<label class="rf-row"><input type="checkbox" id="rfKvkk" style="width:auto;margin:2px 0 0"> '
      +'<span><a href="/gizlilik.html" target="_blank">KVKK ve Çerez Politikası</a>\'nı okudum, iletişim için telefonumun işlenmesini onaylıyorum.</span></label>'
      +'<button class="rf-btn" id="rfJoin">Katıl</button>'
      +'<div id="rfMResult"></div></div>';
    o.classList.add('show');
    o.querySelector('[data-close]').onclick=function(){o.classList.remove('show');};
    o.querySelector('#rfJoin').onclick=async function(){
      var res=o.querySelector('#rfMResult');
      if(!o.querySelector('#rfKvkk').checked){res.innerHTML='<div class="rf-note" style="color:#e8a">Devam etmek için KVKK onayı gerekli.</div>';return;}
      this.disabled=true;this.textContent='Gönderiliyor...';
      try{
        var r=await fetch('/api/member',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({isim:o.querySelector('#rfName').value,telefon:o.querySelector('#rfPhone').value,kvkk:true,masa:table})});
        var d=await r.json();
        if(d.ok){o.querySelector('#rfName').style.display='none';o.querySelector('#rfPhone').style.display='none';
          this.style.display='none';res.innerHTML='<p style="color:#f5f5f5">'+esc(d.mesaj)+'</p><button class="rf-btn sec" data-close3>Kapat</button>';
          res.querySelector('[data-close3]').onclick=function(){o.classList.remove('show');};}
        else{res.innerHTML='<div class="rf-note" style="color:#e8a">'+esc(d.error||'Kayıt alınamadı')+'</div>';this.disabled=false;this.textContent='Katıl';}
      }catch(e){this.disabled=false;this.textContent='Katıl';}
    };
  }

  // Yuzen "Gorus Bildir" butonu
  function addFab(){
    if(document.querySelector('.rf-fab'))return;
    var b=document.createElement('button');b.className='rf-fab';
    b.innerHTML='<span class="material-icons-round" style="font-size:18px">rate_review</span> Görüş Bildir';
    b.onclick=openFeedback;document.body.appendChild(b);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',addFab);else addFab();

  // Disaridan cagirilabilir (ornegin footer linki, ai-chat sonu)
  window.raiFeedback = openFeedback;
  window.raiMember = openMember;
})();
