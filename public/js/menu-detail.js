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

  function wire(){
    const cont=document.getElementById('menuContainer')||document.body;
    cont.addEventListener('click',e=>{const card=e.target.closest('.product-card');if(card)openCard(card);});
    // Tiklanabilir gorunum
    const s2=document.createElement('style');s2.textContent='.product-card{cursor:pointer}';document.head.appendChild(s2);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',wire);else wire();
})();
