// Bakis/dwell takibi: misafir tiklamasa bile hangi BOLUME (Wrap, Pizza, Kokteyl...) ne kadar baktigini olcer.
// Gece gelen adisyonla (rep_id/masa uzerinden) eslestirilip "wrap'e 30sn bakti -> wrap siparis etti" verisi cikar.
(function () {
  function getCookie(n){var v='; '+document.cookie;var p=v.split('; '+n+'=');if(p.length===2)return p.pop().split(';').shift();return null;}
  function getTable(){var p=new URLSearchParams(location.search);var t=p.get('masa')||p.get('table');
    if(!t&&location.pathname.indexOf('/menu/')===0)t=decodeURIComponent(location.pathname.replace('/menu/','').replace(/\/$/,''));
    return t&&t.trim()?t.trim():null;}
  var table=getTable();
  if(!table)return; // sadece masadaki misafir

  var dwell={};        // bolum adi -> toplam ms
  var cur=null, curStart=Date.now();

  // Su an ekranin ustunde olan (bakilan) bolumu bul: ust cizgiyi (120px) en son gecen section-title
  function currentSection(){
    var titles=document.querySelectorAll('.section-title');
    var name=null;
    for(var i=0;i<titles.length;i++){
      var r=titles[i].getBoundingClientRect();
      if(r.top<=120) name=(titles[i].textContent||'').trim(); else break;
    }
    return name;
  }
  function tick(){
    if(document.hidden)return;
    var now=Date.now(), s=currentSection();
    if(s!==cur){ if(cur) dwell[cur]=(dwell[cur]||0)+(now-curStart); cur=s; curStart=now; }
  }
  setInterval(tick,1000);

  // URUN DUZEYI: her urun kartinin ekranda gorunur kaldigi sureyi olc (IntersectionObserver)
  var pdwell={};       // urun adi -> toplam ms
  var pvis={};         // urun adi -> gorunur olmaya basladigi an
  function pName(card){ var n=card.querySelector('.product-name'); return n?(n.textContent||'').trim():null; }
  if('IntersectionObserver' in window){
    var io=new IntersectionObserver(function(list){
      var now=Date.now();
      list.forEach(function(en){
        var nm=pName(en.target); if(!nm)return;
        if(en.isIntersecting && en.intersectionRatio>=0.5){ if(!pvis[nm]) pvis[nm]=now; }
        else if(pvis[nm]){ pdwell[nm]=(pdwell[nm]||0)+(now-pvis[nm]); delete pvis[nm]; }
      });
    },{threshold:[0,0.5,1]});
    function observeCards(){ document.querySelectorAll('.product-card').forEach(function(c){ if(!c.__obs){c.__obs=1;io.observe(c);} }); }
    observeCards();
    // menu sonradan render olursa yeni kartlari da izle
    var mo=new MutationObserver(function(){ observeCards(); });
    var cont=document.getElementById('menuContainer'); if(cont) mo.observe(cont,{childList:true,subtree:true});
  }

  function flush(){
    if(cur){ dwell[cur]=(dwell[cur]||0)+(Date.now()-curStart); curStart=Date.now(); }
    // gorunur duran urunlerin suresini de topla
    var now2=Date.now(); for(var nm in pvis){ pdwell[nm]=(pdwell[nm]||0)+(now2-pvis[nm]); pvis[nm]=now2; }
    var entries=[]; for(var k in dwell){ if(dwell[k]>=3000) entries.push({kind:'section',section:k, ms:Math.round(dwell[k])}); }
    for(var pk in pdwell){ if(pdwell[pk]>=3000) entries.push({kind:'product',section:pk, ms:Math.round(pdwell[pk])}); }
    if(!entries.length)return;
    try{
      var payload=JSON.stringify({table:table, rep_id:getCookie('rep_id'), items:entries});
      if(navigator.sendBeacon){ navigator.sendBeacon('/api/track-dwell', new Blob([payload],{type:'application/json'})); }
      else { fetch('/api/track-dwell',{method:'POST',headers:{'Content-Type':'application/json'},body:payload,keepalive:true}).catch(function(){}); }
      for(var j=0;j<entries.length;j++){ if(entries[j].kind==='product') delete pdwell[entries[j].section]; else delete dwell[entries[j].section]; }
    }catch(e){}
  }
  document.addEventListener('visibilitychange',function(){ if(document.hidden) flush(); });
  window.addEventListener('pagehide',flush);
  // uzun oturumlarda periyodik gonderim (30sn)
  setInterval(flush,30000);
})();
