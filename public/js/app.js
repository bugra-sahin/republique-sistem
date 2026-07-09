document.addEventListener('DOMContentLoaded', () => {
  const categoryNav = document.getElementById('categoryNav');
  const menuContainer = document.getElementById('menuContainer');

  let menuData = null;
  let categoryElements = []; 

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

  function renderMenu() {
    categoryNav.innerHTML = '';
    menuContainer.innerHTML = '';
    categoryElements = [];

    if (!menuData || menuData.length === 0) {
      menuContainer.innerHTML = `<div class="loading-state">Menü şu an boş.</div>`;
      return;
    }

    menuData.forEach((category, index) => {
      // Üst menü butonu (Seviye 1: Menü Bölümü)
      const btn = document.createElement('button');
      btn.className = `cat-btn ${index === 0 ? 'active' : ''}`;
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
              // inStock kontrolü
              if (product.inStock === false) return;

              const pCard = document.createElement('div');
              pCard.className = 'product-card';
              
              // Varsayılan resim
              const defaultImg = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="90" height="90" fill="%230a1f16"><rect width="90" height="90" fill="%2305100c"/><text x="45" y="45" fill="%23d4af37" font-size="12" font-family="sans-serif" text-anchor="middle" alignment-baseline="middle">REPUBLIQUE</text></svg>';
              const imgSrc = product.image ? product.image : defaultImg;

              pCard.innerHTML = `
                <img src="${imgSrc}" class="product-img" alt="${product.name}" loading="lazy" onerror="this.src='${defaultImg}'">
                <div class="product-info">
                  <div class="product-name">${product.name}</div>
                  <div class="product-desc">${product.description || ''}</div>
                  <div class="product-price">${product.price} ₺</div>
                </div>
              `;
              catSection.appendChild(pCard);
            });
          }
        });
      }

      menuContainer.appendChild(catSection);
    });

    setupScrollSpy();
  }

  function setupScrollSpy() {
    window.addEventListener('scroll', () => {
      let currentActive = categoryElements[0];
      
      for (const cat of categoryElements) {
        const el = document.getElementById(cat.id);
        if (el) {
          const rect = el.getBoundingClientRect();
          // Eğer bölümün üst kısmı ekranda görünür hale geldiyse
          if (rect.top <= 100) {
            currentActive = cat;
          }
        }
      }

      // Aktif sınıfını güncelle ve scroll et
      categoryElements.forEach(cat => cat.btn.classList.remove('active'));
      if (currentActive) {
        currentActive.btn.classList.add('active');
        // Aktif butonu görünür alana kaydır
        currentActive.btn.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      }
    });
  }

  fetchMenu();
});
