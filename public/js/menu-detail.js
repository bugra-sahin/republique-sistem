// Menu urunlerini tiklanabilir yapar: detay + buyuk foto, ve tiklamayi loglar (en cok bakilanlar icin).
// app.js'i degistirmeden, olay delegasyonu ile calisir.
(function () {
  function getCookie(n){const v='; '+document.cookie;const p=v.split('; '+n+'=');if(p.length===2)return p.pop().split(';').shift();return null;}
  function getTable(){const p=new URLSearchParams(location.search);let t=p.get('masa')||p.get('table');
    if(!t&&location.pathname.startsWith('/menu/'))t=decodeURIComponent(location.pathname.replace('/menu/','').replace(/\/$/,''));
    return t&&t.trim()?t.trim():null;}

  const css=`
  .pd-overlay{position:fixed;inset:0;background:rgba(0,0,0,.72);display:none;align-items:center;justify-content:center;z-index:9998;padding:18px}
  .pd-overlay.open{display:flex}
  .pd-box{background:#141210;border:1px solid #3a2f1c;border-radius:18px;max-width:460px;width:100%;max-height:88vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.6)}
  .pd-img{width:100%;height:min(56vh,340px);object-fit:cover;background:#0a0a0a;display:block;border-radius:18px 18px 0 0}
  .pd-body{padding:18px 20px 22px}
  .pd-name{font-size:21px;color:#f0e6d2;font-weight:700;margin-bottom:6px;font-family:'Outfit',system-ui,sans-serif}
  .pd-price{font-size:18px;color:#d4af37;font-weight:700;margin:6px 0 12px}
  .pd-desc{color:#c9beac;font-size:15px;line-height:1.55;white-space:pre-wrap}
  .pd-close{position:sticky;top:8px;float:right;margin:8px;background:rgba(0,0,0,.5);border:0;color:#fff;width:34px;height:34px;border-radius:50%;font-size:20px;cursor:pointer}
  `;
  const st=document.createElement('style');st.textContent=css;document.head.appendChild(st);
  const ov=document.createElement('div');ov.className='pd-overlay';
  ov.innerHTML=`<div class="pd-box"><button class="pd-close" aria-label="Kapat">&times;</button><img class="pd-img" alt=""><div class="pd-body"><div class="pd-name"></div><div class="pd-price"></div><div class="pd-desc"></div></div></div>`;
  document.body.appendChild(ov);
  const box=ov.querySelector('.pd-box');
  ov.addEventListener('click',e=>{if(e.target===ov||e.target.classList.contains('pd-close'))ov.classList.remove('open');});

  function openCard(card){
    const img=card.querySelector('.product-img'), name=card.querySelector('.product-name'), desc=card.querySelector('.product-desc'), price=card.querySelector('.product-price');
    if(!name)return;
    ov.querySelector('.pd-img').src=img?img.src:'';
    ov.querySelector('.pd-name').textContent=name.textContent;
    ov.querySelector('.pd-price').innerHTML=price?price.innerHTML:'';
    ov.querySelector('.pd-desc').textContent=(desc&&desc.textContent.trim())?desc.textContent:'Detay icin garsonumuza sorabilirsiniz.';
    box.scrollTop=0; ov.classList.add('open');
    // Loglama (arka planda; en cok bakilanlar icin)
    try{fetch('/api/track-view',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({product:name.textContent.trim(),table:getTable(),rep_id:getCookie('rep_id')})}).catch(()=>{});}catch(e){}
  }

  // AI [[SHOW:UrunAdi]] icin: urunu ADIYLA bul ve kartini (foto+detay) ac
  function norm(x){return String(x||'').toLowerCase().replace(/ı/g,'i').replace(/İ/g,'i').replace(/ş/g,'s').replace(/ğ/g,'g').replace(/ü/g,'u').replace(/ö/g,'o').replace(/ç/g,'c').replace(/[^a-z0-9]/g,'').trim();}
  window.raiShowProduct=function(name){
    try{
      const target=norm(name); if(!target)return false;
      // Tembel-render: urun cizilmemis bir kategoride olabilir -> SADECE o kategoriyi doldur
      // (413 kartin hepsini birden cizmek mobilde cokme yaratiyordu). Sonra kart ara.
      if(typeof window.raiFillForProduct==='function'){ try{ window.raiFillForProduct(name); }catch(e){} }
      const cards=[...document.querySelectorAll('.product-card')];
      let card=cards.find(c=>{const n=c.querySelector('.product-name');return n&&norm(n.textContent)===target;});
      if(!card) card=cards.find(c=>{const n=c.querySelector('.product-name');return n&&(norm(n.textContent).includes(target)||target.includes(norm(n.textContent)));});
      if(!card) return false;
      // FIX (2026-07-14, Fable): "karta goturmedi + sayfa yenilendi" kok cozumu.
      // 1) MODALI ONCE AC: scroll ne yaparsa yapsin misafir karti ANINDA gorur.
      // 2) behavior:'smooth' BU SAYFADA CALISMIYOR (tembel/pencereli render animasyon sirasinda
      //    yukseklikleri degistiriyor; WebKit smooth'u iptal ediyor -> masaustunde 0'da kaliyor,
      //    iPhone'da buyuk fill + smooth kompozit birlesince sekme cokup yenileniyordu).
      //    Cozum: layout otursun diye 2x rAF bekle, konumu OLC, tek INSTANT atlayisla git.
      // 3) Pencereli render'a hedefi PINLE (unfill hedef kartin kategorisini bosaltmasin)
      //    ve atlama sonrasi pencereyi tazele.
      openCard(card);
      if(typeof window.raiPinCategory==='function'){try{window.raiPinCategory(card.closest('.category-section'));}catch(e){}}
      // FIX (2026-07-15, §79): SAFARI/iPhone-12'de kart EKRANA GELMIYORDU.
      // Denetim (webkit) bulmustu: [iPhone-12-SAFARI][ai-kart] "kart ekranda degil".
      // iPhone-SE Safari'de ve TUM Chromium'da sorun YOKTU -> motor + viewport farki.
      // NEDEN: tek seferlik "olc + window.scrollTo" atlayisi, pencereli render atlama SIRASINDA
      //   yukseklikleri degistirdigi icin WebKit'te hedefi kacirabiliyor (olculen y bayatliyor).
      // COZUM: KOR ATLAYIS YOK -> scrollIntoView ile git, SONRA OLC, ekranda DEGILSE TEKRAR DENE.
      //   Kendi kendini duzeltir; motor farkini tahmin etmeye gerek kalmaz. En fazla 3 deneme.
      //   (scrollIntoView'in ayni sayfada WebKit'te CALISTIGI kanitli: denetimin kategori testi
      //    bunu kullaniyor ve Safari'de [ok] veriyor. behavior verilmez -> ANINDA, smooth DEGIL.)
      // ============================================================================
      // FIX (2026-07-15, §80-C): **KOK NEDEN BULUNDU - SORUN KAYDIRMA DEGIL, rAF.**
      //
      // OLCUM (tests/webkit-teshis.js, sarmalayicisiz sayac turu):
      //   iPhone-12-SAFARI : rAF 1 KEZ tetiklendi -> scrollIntoView 0 KEZ -> scrollY 0  (HATA)
      //   iPhone-SE-SAFARI : rAF 5 KEZ tetiklendi -> scrollIntoView 3 KEZ -> scrollY 62242 (GECER)
      //
      // ESKI KOD IC ICE 2 rAF ile basliyordu. iPhone-12 WebKit'te IKINCI rAF geri cagrisi
      // HIC KOSMADI -> git() hic cagrilmadi -> sayfa HIC kaymadi. Yani kaydirma mantigi
      // bozuk DEGILDI; O KOD HIC CALISMIYORDU. (Bu yuzden §80/§80-B duzeltmeleri -sira ve
      // reflow- hicbir sey degistirmedi: duzelttikleri satirlara HIC ULASILMIYORDU.)
      //
      // Bu, PROJE-DEVIR §67-H ve §69-F-6'da ZATEN yazan tuzagin ta kendisi:
      // 'rAF arka planda/kisilmis baglamda CALISMAZ'. Uzun sayfa + WebKit'te de oluyor.
      //
      // COZUM: KRITIK bir isi rAF'a EMANET ETME.
      //   1) Baslatma: rAF VE setTimeout birlikte kurulur, ILK GELEN kazanir (basladi bayragi
      //      ile tek sefer kosar). rAF calisirsa layout oturmus olur (ideal); calismazsa
      //      120ms sonra setTimeout kurtarir.
      //   2) Dogrulama dongusu de rAF yerine setTimeout kullanir (rAF olmeyse dongu de olur).
      // ============================================================================
      var basladi=false;
      var basla=function(){
        if(basladi) return; basladi=true;
        try{
          var deneme=0;
          // Layout'u ZORLA hesaplat: DOM az once degisti (fill/pin/ensureWindow) -> layout kirli.
          var zorla=function(){ try{ return card.getBoundingClientRect().top; }catch(e){ return 0; } };
          var git=function(){
            zorla();
            try{ card.scrollIntoView({block:'center', inline:'nearest'}); }catch(e){
              var r=card.getBoundingClientRect();
              window.scrollTo(0,Math.max(0,r.top+window.pageYOffset-Math.max(0,(window.innerHeight-r.height)/2)));
            }
            // Pencereli render'i tazele; sonra TEKRAR kaydir (bkz. §80: ensureWindow sayfayi
            // buyutup karti ekran disina atabiliyor -> git()'in SON isi daima kaydirma olsun).
            if(typeof window.__raiEnsureWindow==='function'){try{window.__raiEnsureWindow();}catch(e){}}
            zorla();
            try{ card.scrollIntoView({block:'center', inline:'nearest'}); }catch(e){}
          };
          var dogrula=function(){
            var r=card.getBoundingClientRect();
            var ekranda = r.top > -50 && r.top < window.innerHeight;
            if(ekranda || deneme>=5) return;   // oldu ya da pes et (sonsuz dongu YOK)
            deneme++; git();
            setTimeout(dogrula, 50);           // rAF DEGIL: rAF olu olabilir (kok neden buydu)
          };
          git();
          setTimeout(dogrula, 50);
        }catch(e){}
      };
      // ILK GELEN KAZANIR: rAF calisiyorsa hemen, calismiyorsa 120ms'de setTimeout kurtarir.
      try{ requestAnimationFrame(function(){ requestAnimationFrame(basla); }); }catch(e){}
      setTimeout(basla, 120);
      return true;
    }catch(e){}
    return false;
  };

  function wire(){
    const cont=document.getElementById('menuContainer')||document.body;
    cont.addEventListener('click',e=>{const card=e.target.closest('.product-card');if(card)openCard(card);});
    // Tiklanabilir gorunum
    const s2=document.createElement('style');s2.textContent='.product-card{cursor:pointer}';document.head.appendChild(s2);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',wire);else wire();
})();
