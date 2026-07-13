document.addEventListener('DOMContentLoaded', () => {
  const categoryNav = document.getElementById('categoryNav');
  const menuContainer = document.getElementById('menuContainer');

  let menuData = null;
  let categoryElements = []; 

  // --- Tracking Logic ---
  function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
  }

  function setCookie(name, value, days) {
    const d = new Date();
    d.setTime(d.getTime() + (days*24*60*60*1000));
    document.cookie = `${name}=${value};expires=${d.toUTCString()};path=/`;
  }

  function generateId() {
    return 'rep_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
  }

  async function initTracking() {
    const urlParams = new URLSearchParams(window.location.search);
    
    let tableParam = urlParams.get('masa') || urlParams.get('table');
    if (!tableParam && window.location.pathname.startsWith('/menu/')) {
      tableParam = window.location.pathname.replace('/menu/', '').replace('/', '');
    }

    const params = {
      masa: tableParam || 'Bilinmiyor',
      utm_source: urlParams.get('utm_source'),
      utm_medium: urlParams.get('utm_medium'),
      utm_campaign: urlParams.get('utm_campaign'),
      utm_content: urlParams.get('utm_content'),
      utm_term: urlParams.get('utm_term'),
      fbclid: urlParams.get('fbclid'),
    };

    let rep_id = getCookie('rep_id');
    if (!rep_id) {
      rep_id = generateId();
      setCookie('rep_id', rep_id, 730); // 2 year cookie
    }

    // Wait a bit to let Meta Pixel initialize and set _fbp / _fbc
    setTimeout(async () => {
      const fbp = getCookie('_fbp');
      const fbc = getCookie('_fbc');

      try {
        await fetch('/api/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rep_id,
            fbp,
            fbc,
            ...params
          })
        });
      } catch (err) {
        console.error('Tracking error', err);
      }
      
      // Fire Meta Custom Event
      if (typeof fbq === 'function') {
        fbq('trackCustom', 'ViewMenu', { masa: params.masa });
      }
    }, 1000); // 1 second delay
  }
  // ----------------------

  async function fetchMenu() {
    try {
      const response = await fetch('/api/menu');
      if (!response.ok) throw new Error('Menu alinamadi');
      const data = await response.json();
      
      // PionPOS API yapısına göre kategori->seksiyon->ürün dönüyor.
      if (data && data.result && data.result.categories) {
        menuData = data.result.categories; 
      } else {
        // Fallback or different structure
        menuData = data; 
      }
      
      renderMenu();
    } catch (err) {
      console.error(err);
      menuContainer.innerHTML = `<div class="loading-state" style="color: #ff5555;">Menü yüklenirken bir hata oluştu. Lütfen sayfayı yenileyin.</div>`;
    }
  }

  function getActivePrice(product) {
    if (!product.happyHourInfo || product.happyHourInfo.length === 0) return { price: product.price, isDiscount: false };
    
    const now = new Date();
    let jsDay = now.getDay(); // 0=Sun, 6=Sat
    let isoDay = jsDay === 0 ? 7 : jsDay; // 1=Mon, 7=Sun
    let pazarDay = jsDay + 1; // 1=Sun, 7=Sat

    const currentMs = (now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()) * 1000;

    for (let hh of product.happyHourInfo) {
      if (!hh.active) continue;
      
      if (hh.days.includes(jsDay) || hh.days.includes(isoDay) || hh.days.includes(pazarDay)) {
        if (hh.startHour <= hh.endHour) {
          if (currentMs >= hh.startHour && currentMs <= hh.endHour) {
            return { price: hh.price, isDiscount: true, originalPrice: product.price };
          }
        } else {
          // Gece yarısını geçen durum (Örn: 22:00 - 03:00)
          if (currentMs >= hh.startHour || currentMs <= hh.endHour) {
            return { price: hh.price, isDiscount: true, originalPrice: product.price };
          }
        }
      }
    }
    return { price: product.price, isDiscount: false };
  }

  function renderMenu() {
    categoryNav.innerHTML = '';
    menuContainer.innerHTML = '';
    categoryElements = [];

    if (!menuData || menuData.length === 0) {
      menuContainer.innerHTML = `<div class="loading-state">Menü şu an boş.</div>`;
      return;
    }

    menuData.forEach((category, index) => {
      if (category.isVisible === false || category.name === 'Personel' || category.name === 'Ekstra İstek') return; // Kategori gizliyse tamamen atla

      // Üst menü butonu (Seviye 1: Menü Bölümü)
      const btn = document.createElement('button');
      btn.className = `cat-btn ${categoryElements.length === 0 ? 'active' : ''}`;
      btn.innerText = category.name;
      const catId = `cat-${index}`;
      
      btn.onclick = () => {
        const target = document.getElementById(catId);
        if (target) {
          const yOffset = -70; // Sabit header boşluğu
          const y = target.getBoundingClientRect().top + window.pageYOffset + yOffset;
          window.scrollTo({top: y, behavior: 'smooth'});
        }
      };
      categoryNav.appendChild(btn);

      // Bu bölüm için ana kapsayıcı
      const catSection = document.createElement('div');
      catSection.id = catId;
      catSection.className = 'category-section';
      
      categoryElements.push({ id: catId, btn: btn });

      // Seviye 2: Kategoriler (Sections)
      if (category.sections && category.sections.length > 0) {
        category.sections.forEach(section => {
          if (section.isVisible === false) return; // Gizliyse atla

          const secTitle = document.createElement('h2');
          secTitle.className = 'section-title';
          secTitle.innerText = section.name;
          catSection.appendChild(secTitle);

          // Seviye 3: Ürünler (Products)
          if (section.products && section.products.length > 0) {
            section.products.forEach(product => {
              if (product.inStock === false) return;

              let itemsToRender = [];
              if (product.variations && product.variations.length > 0) {
                product.variations.forEach(v => {
                  if (v.inStock === false) return;
                  itemsToRender.push({
                    ...product,
                    ...v, // Varyasyon özellikleri (fiyat, isim) ürünün üzerine yazar
                    name: `${product.name} ${v.name && v.name.toLowerCase() !== 'normal' ? '- ' + v.name : ''}`.trim(),
                    description: v.description || product.description,
                    happyHourInfo: v.happyHourInfo || product.happyHourInfo
                  });
                });
              } else {
                itemsToRender.push(product);
              }

              itemsToRender.forEach(item => {
                const pCard = document.createElement('div');
                pCard.className = 'product-card';
                
                // SVG'yi base64 yaptık ki tarayıcılar kırık imaj sanmasın
                const defaultImg = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI5MCIgaGVpZ2h0PSI5MCIgZmlsbD0iIzBhMWYxNiI+PHJlY3Qgd2lkdGg9IjkwIiBoZWlnaHQ9IjkwIiBmaWxsPSIjMDUxMDBjIi8+PHRleHQgeD0iNDUiIHk9IjQ1IiBmaWxsPSIjZDRhZjM3IiBmb250LXNpemU9IjEyIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgdGV4dC1hbmNob3I9Im1pZGRsZSIgYWxpZ25tZW50LWJhc2VsaW5lPSJtaWRkbGUiPlJFUFVCTElRVUU8L3RleHQ+PC9zdmc+';
                const imgSrc = item.image ? item.image : (product.image ? product.image : defaultImg);

                const priceInfo = getActivePrice(item);
                let priceHtml = '';
                if (priceInfo.isDiscount) {
                  priceHtml = `<span style="text-decoration: line-through; opacity: 0.6; font-size: 0.9em; margin-right: 5px;">${priceInfo.originalPrice} ₺</span><span style="color: #d4af37; font-weight: bold; font-size: 1.1em;">${priceInfo.price} ₺</span>`;
                } else {
                  priceHtml = `${priceInfo.price} ₺`;
                }

                pCard.innerHTML = `
                  <img src="${imgSrc}" class="product-img" alt="${item.name}" loading="lazy" onerror="this.src='${defaultImg}'">
                  <div class="product-info">
                    <div class="product-name">${item.name}</div>
                    <div class="product-desc">${item.description || ''}</div>
                    <div class="product-price">${priceHtml}</div>
                  </div>
                `;
                catSection.appendChild(pCard);
              });
            });
          }
        });
      }

      menuContainer.appendChild(catSection);
    });

    setupScrollSpy();
  }

  function setupScrollSpy() {
    // ONEMLI: Eski surum her scroll olayinda smooth scrollIntoView cagiriyordu ->
    // scroll<->smooth-scroll geri besleme dongusu ana thread'i kilitliyor, iOS Safari
    // sekmeyi olduruyordu ("sayfada bircok kez sorun olustu"). Cozum: rAF ile throttle
    // + YALNIZCA aktif kategori DEGISTIGINDE DOM guncelle ve nav'i kaydir.
    let ticking = false;
    let lastActiveId = null;
    function update() {
      ticking = false;
      let currentActive = categoryElements[0];
      for (const cat of categoryElements) {
        const el = document.getElementById(cat.id);
        if (el && el.getBoundingClientRect().top <= 100) currentActive = cat;
      }
      if (currentActive && currentActive.id !== lastActiveId) {
        lastActiveId = currentActive.id;
        categoryElements.forEach(cat => cat.btn.classList.remove('active'));
        currentActive.btn.classList.add('active');
        try { currentActive.btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' }); } catch (e) {}
      }
    }
    window.addEventListener('scroll', () => {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
  }

  initTracking();
  fetchMenu();
});
