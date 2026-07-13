document.addEventListener('DOMContentLoaded', () => {
  // ANA SEKME (Tab) Gezinme Mantığı
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const targetId = btn.getAttribute('data-tab');
      tabContents.forEach(content => {
        content.classList.remove('active');
        if (content.id === targetId) content.classList.add('active');
      });

      if (targetId === 'tab-live') fetchLiveScans();
      else if (targetId === 'tab-ads') fetchAdsManager();
      else if (targetId === 'tab-chats') fetchChatLogs();
      else if (targetId === 'tab-audit') fetchAuditLog();
    });
  });

  // Audit / islem kayitlari
  const auditDaysEl = document.getElementById('auditDaysFilter');
  if (auditDaysEl) auditDaysEl.addEventListener('change', fetchAuditLog);
  async function fetchAuditLog() {
    const tbody = document.querySelector('#auditTable tbody');
    if (!tbody) return;
    const days = (document.getElementById('auditDaysFilter') || {}).value || '30';
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color: var(--text-secondary);">Yükleniyor...</td></tr>';
    try {
      const r = await fetch('/api/admin/audit-log?days=' + days);
      const d = await r.json();
      const rows = (d && d.kayitlar) || [];
      if (!rows.length) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color: var(--text-secondary);">Bu dönemde kayıt yok.</td></tr>'; return; }
      const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
      tbody.innerHTML = rows.map(row => {
        const dt = new Date(row.ts);
        const saat = isNaN(dt) ? '' : dt.toLocaleString('tr-TR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
        return '<tr>' +
          '<td style="white-space:nowrap;">' + esc(saat) + '</td>' +
          '<td style="white-space:nowrap;">' + esc(row.method) + '</td>' +
          '<td>' + esc(row.path) + '</td>' +
          '<td style="white-space:nowrap;">' + esc(row.ip) + '</td>' +
          '<td style="color: var(--text-secondary); max-width:280px; overflow:hidden; text-overflow:ellipsis;">' + esc(row.body_summary) + '</td>' +
        '</tr>';
      }).join('');
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#e57373;">Kayıtlar alınamadı: ' + e.message + '</td></tr>';
    }
  }

  // AI Sohbet kayitlari
  const chatDaysEl = document.getElementById('chatDaysFilter');
  if (chatDaysEl) chatDaysEl.addEventListener('change', fetchChatLogs);
  async function fetchChatLogs() {
    const tbody = document.querySelector('#chatLogsTable tbody');
    if (!tbody) return;
    const days = (document.getElementById('chatDaysFilter') || {}).value || '7';
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color: var(--text-secondary);">Yükleniyor...</td></tr>';
    try {
      const r = await fetch('/api/admin/chat-logs?days=' + days);
      const d = await r.json();
      const rows = (d && d.kayitlar) || [];
      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color: var(--text-secondary);">Bu dönemde sohbet kaydı yok.</td></tr>';
        return;
      }
      const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
      tbody.innerHTML = rows.map(row => {
        const dt = new Date(row.created_at);
        const saat = isNaN(dt) ? '' : dt.toLocaleString('tr-TR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
        return '<tr>' +
          '<td style="white-space:nowrap;">' + esc(saat) + '</td>' +
          '<td style="white-space:nowrap;">' + esc(row.table_name || '-') + '</td>' +
          '<td>' + esc(row.user_msg) + '</td>' +
          '<td style="color: var(--text-secondary);">' + esc(row.ai_reply) + '</td>' +
        '</tr>';
      }).join('');
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#e57373;">Kayıtlar alınamadı: ' + e.message + '</td></tr>';
    }
  }

  // Sayfa yüklendiğinde otomatik ilk sekmeyi (Canlı Akış) çek
  fetchLiveScans();

  // ADS MANAGER ALT SEKMELERİ
  const subTabBtns = document.querySelectorAll('.ads-sub-tab-btn');
  const subTabContents = document.querySelectorAll('.ads-sub-content');

  subTabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      subTabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const targetId = btn.getAttribute('data-sub');
      subTabContents.forEach(content => {
        content.classList.remove('active');
        if (content.id === targetId) content.classList.add('active');
      });
    });
  });

  // --- TARİH VE SAAT FİLTRELEME MANTIĞI (09:00 - 03:00 İş Günü) ---
  function getBusinessDayRange(dateStr = null) {
    const now = dateStr ? new Date(dateStr) : new Date();
    if (!dateStr && now.getHours() < 3) now.setDate(now.getDate() - 1);
    
    const start = new Date(now);
    start.setHours(9, 0, 0, 0);
    
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    end.setHours(3, 0, 0, 0);
    
    return { start_date: start.toISOString(), end_date: end.toISOString() };
  }

  function getRelativeRange(hours) {
    const end = new Date();
    const start = new Date(end.getTime() - (hours * 60 * 60 * 1000));
    return { start_date: start.toISOString(), end_date: end.toISOString() };
  }

  // EVENT LISTENERS FOR FILTERS
  document.getElementById('liveScanFilter').addEventListener('change', fetchLiveScans);
  document.getElementById('btnFilterReports').addEventListener('click', fetchReports);
  
  document.getElementById('btnFilterAds').addEventListener('click', () => {
    adsManagerLoaded = false;
    fetchAdsManager();
  });

  // --- REKLAM YÖNETİMİ (ADS MANAGER) FONKSİYONLARI ---

  let adsManagerLoaded = false;

  function fetchAdsManager() {
    if (adsManagerLoaded) return; // Sadece ilk girişte veya manuel yenilemede çek

    let queryParams = '';
    const sDate = document.getElementById('adsStartDate').value;
    const eDate = document.getElementById('adsEndDate').value;
    if (sDate && eDate) {
      queryParams = `&since=${sDate}&until=${eDate}`;
    }

    // 1. Aktif Hesap Hiyerarşisi
    fetch('/api/admin/ads/hierarchy?account=active' + queryParams)
      .then(res => res.json())
      .then(data => {
        if (data.success) renderHierarchy(data.data, 'adsHierarchyTable');
      });

    // 2. AI Önerileri (Aktif hesaptan çekilir)
    fetch('/api/admin/ads/suggestions')
      .then(res => res.json())
      .then(data => {
        if (data.success) renderSuggestions(data.data);
      });

    // 3. Instagram Medya
    fetch('/api/admin/ads/ig-media')
      .then(res => res.json())
      .then(data => {
        if (data.success) renderIGMedia(data.data);
      });

    // 4. Eski Hesap Hiyerarşisi
    fetch('/api/admin/ads/hierarchy?account=old' + queryParams)
      .then(res => res.json())
      .then(data => {
        if (data.success) renderHierarchy(data.data, 'oldAdsHierarchyTable');
      });

    adsManagerLoaded = true;
  }

  // Akordiyon Tablo Render Mantığı
  function renderHierarchy(campaigns, tableId) {
    const tbody = document.querySelector(`#${tableId} tbody`);
    tbody.innerHTML = '';

    if (!campaigns || campaigns.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;">Kayıt bulunamadı.</td></tr>`;
      return;
    }

    campaigns.forEach(camp => {
      // Kampanya Satırı
      const trCamp = document.createElement('tr');
      trCamp.className = 'row-campaign';
      trCamp.innerHTML = `
        <td><span class="material-icons-round" style="font-size:18px; vertical-align:middle;">folder</span> ${camp.name}</td>
        <td>${getBadge(camp.status)}</td>
        <td colspan="6" style="text-align:right; font-size:0.8em; color:var(--text-secondary);">Setleri görmek için tıkla</td>
      `;
      tbody.appendChild(trCamp);

      // Kampanyaya tıklanınca Setleri aç/kapa
      trCamp.addEventListener('click', () => {
        const adsets = tbody.querySelectorAll(`.adset-for-${camp.id}`);
        adsets.forEach(row => {
          row.style.display = row.style.display === 'none' || row.style.display === '' ? 'table-row' : 'none';
        });
      });

      if (!camp.adsets) return;

      camp.adsets.forEach(set => {
        // Set Satırı
        const trSet = document.createElement('tr');
        trSet.className = `row-adset adset-for-${camp.id}`;
        trSet.innerHTML = `
          <td style="padding-left: 30px;"><span class="material-icons-round" style="font-size:16px; vertical-align:middle;">layers</span> ${set.name}</td>
          <td>${getBadge(set.status)}</td>
          <td>Bütçe: ${set.daily_budget ? (parseInt(set.daily_budget)/100).toFixed(0) + ' TL' : '-'}</td>
          <td colspan="5" style="text-align:right; font-size:0.8em; color:var(--text-secondary);">Reklamları görmek için tıkla</td>
        `;
        tbody.appendChild(trSet);

        // Sete tıklanınca Reklamları aç/kapa
        trSet.addEventListener('click', () => {
          const ads = tbody.querySelectorAll(`.ad-for-${set.id}`);
          ads.forEach(row => {
            row.style.display = row.style.display === 'none' || row.style.display === '' ? 'table-row' : 'none';
          });
        });

        if (!set.ads) return;

        set.ads.forEach(ad => {
          // Reklam Metriklerini Hesapla
          let spend = 0, impressions = 0, purchases = 0, views3s = 0, revenue = 0;
          if (ad.insight) {
            spend = parseFloat(ad.insight.spend) || 0;
            impressions = parseInt(ad.insight.impressions) || 0;
            if (ad.insight.actions) {
              const p = ad.insight.actions.find(a => 
                a.action_type === 'purchase' || 
                a.action_type === 'offsite_conversion.fb_pixel_purchase' ||
                a.action_type === 'offsite_conversion.custom.1191511349325239'
              );
              if (p) purchases = parseInt(p.value) || 0;
              const v = ad.insight.actions.find(a => a.action_type === 'video_view');
              if (v) views3s = parseInt(v.value) || 0;
            }
            if (ad.insight.action_values) {
              const rv = ad.insight.action_values.find(a => 
                a.action_type === 'purchase' || 
                a.action_type === 'offsite_conversion.fb_pixel_purchase' ||
                a.action_type === 'offsite_conversion.custom.1191511349325239'
              );
              if (rv) revenue = parseFloat(rv.value) || 0;
            }
          }
          const cpa = purchases > 0 ? (spend / purchases).toFixed(2) : '-';
          const hookRate = impressions > 0 ? ((views3s / impressions) * 100).toFixed(1) : 0;
          const roas = spend > 0 ? (revenue / spend).toFixed(2) : '-';

          // Reklam Satırı
          const trAd = document.createElement('tr');
          trAd.className = `row-ad ad-for-${set.id}`;
          trAd.innerHTML = `
            <td style="padding-left: 60px;">↳ ${ad.name}</td>
            <td>${getBadge(ad.status)}</td>
            <td>${spend.toFixed(2)} TL</td>
            <td>${impressions}</td>
            <td>%${hookRate}</td>
            <td>${purchases}</td>
            <td style="color:${cpa !== '-' && cpa > 150 ? '#ef4444' : 'inherit'}">${cpa !== '-' ? cpa + ' TL' : '-'}</td>
            <td>${roas}</td>
          `;
          tbody.appendChild(trAd);
        });
      });
    });
  }

  function renderSuggestions(result) {
    const container = document.getElementById('suggestionsContainer');
    const badge = document.getElementById('aiBadge');
    
    container.innerHTML = `
      <div style="display:flex; gap:20px; margin-bottom:20px;">
        <div class="stat-card"><span>Hesap Ort. CPA:</span> <strong>${result.avgCPA.toFixed(2)} TL</strong></div>
        <div class="stat-card"><span>Hesap Ort. Hook Rate:</span> <strong>%${result.avgHookRate.toFixed(1)}</strong></div>
      </div>
    `;

    if (!result.suggestions || result.suggestions.length === 0) {
      container.innerHTML += `<p style="color:var(--accent-green);"><span class="material-icons-round">check_circle</span> Şu an her şey yolunda. Eylem gerekmiyor.</p>`;
      badge.style.display = 'none';
      return;
    }

    badge.innerText = result.suggestions.length;
    badge.style.display = 'inline-block';

    result.suggestions.forEach(sug => {
      const card = document.createElement('div');
      card.className = 'suggestion-card';
      const isGood = sug.type === 'INCREASE_BUDGET';
      const icon = isGood ? 'trending_up' : 'warning';
      const color = isGood ? 'var(--accent-green)' : '#ef4444';
      const btnText = isGood ? 'Bütçeyi Artır' : 'Reklamı Durdur';

      card.innerHTML = `
        <div class="suggestion-title" style="color: ${color}">
          <span><span class="material-icons-round" style="vertical-align:middle;">${icon}</span> ${isGood ? 'Bütçe Artırım Önerisi' : 'Kötü Performans Uyarısı'}</span>
        </div>
        <p><strong>Reklam:</strong> ${sug.adName} <br><span style="font-size:0.85em; color:var(--text-secondary)">(${sug.campName} > ${sug.setName})</span></p>
        <p style="margin: 10px 0;">${sug.reason}</p>
        <div style="text-align:right;">
          <button class="btn-primary" style="background: ${color}" onclick="alert('Demo: ${btnText} eylemi onaylandı.')">${btnText} (Onayla)</button>
        </div>
      `;
      container.appendChild(card);
    });
  }

  function renderIGMedia(mediaArray) {
    const container = document.getElementById('igMediaContainer');
    container.innerHTML = '';

    if (mediaArray.error || !mediaArray || mediaArray.length === 0) {
      container.innerHTML = `<p style="grid-column: 1/-1; color:#ef4444;">${mediaArray.error || 'İçerik bulunamadı. Instagram hesabı yetkilerini kontrol edin.'}</p>`;
      return;
    }

    mediaArray.forEach(m => {
      const card = document.createElement('div');
      card.className = 'ig-card';
      const imgUrl = m.media_type === 'VIDEO' ? m.thumbnail_url : m.media_url;
      const date = new Date(m.timestamp).toLocaleDateString('tr-TR');

      card.innerHTML = `
        <img src="${imgUrl}" alt="IG Media">
        <p><strong>${date}</strong><br>${m.caption ? m.caption.substring(0, 60) + '...' : 'Açıklama yok'}</p>
        <button class="btn-primary" style="width: 90%; margin-bottom:10px;" onclick="openIgModal('${m.id}')">Reklam Ver (Modal)</button>
      `;
      container.appendChild(card);
    });
  }

  window.openIgModal = function(mediaId) {
    document.getElementById('igModalMediaIdText').innerText = "Gönderi ID: " + mediaId;
    document.getElementById('igAdModal').setAttribute('data-selected-media', mediaId);
    document.getElementById('igAdModal').style.display = 'flex';
  };

  function getBadge(status) {
    if (status === 'ACTIVE') return '<span class="badge badge-active">AKTİF</span>';
    if (status === 'PAUSED') return '<span class="badge badge-paused">DURAKLATILDI</span>';
    return `<span class="badge">${status}</span>`;
  }

  // --- CANLI AKIŞ & RAPOR FİLTRELERİ ---
  
  function fetchReports() {
    const sDateStr = document.getElementById('reportsStartDate').value;
    const eDateStr = document.getElementById('reportsEndDate').value;
    
    let start_date, end_date;

    if (!sDateStr && !eDateStr) {
      // Eğer tarih seçilmemişse bugünü al
      const range = getBusinessDayRange();
      start_date = range.start_date;
      end_date = range.end_date;
    } else {
      // Kullanıcının seçtiği aralığı İş Günü mantığına uyarla
      const start = new Date(sDateStr || eDateStr);
      start.setHours(9, 0, 0, 0);
      
      const end = new Date(eDateStr || sDateStr);
      end.setDate(end.getDate() + 1);
      end.setHours(3, 0, 0, 0);
      
      start_date = start.toISOString();
      end_date = end.toISOString();
    }

    fetch(`/api/admin/reports?start_date=${start_date}&end_date=${end_date}`)
      .then(res => res.json())
      .then(data => {
        // İleride raporlama kısmına ciro verilerini basmak için kullanılacak.
      })
      .catch(err => console.error(err));
  }

  function renderAudiences() {
    const tbody = document.querySelector('#audiencesTable tbody');
    if (!tbody) return;
    
    fetch('/api/admin/audiences')
      .then(res => res.json())
      .then(data => {
        tbody.innerHTML = '';
        if (data.success && data.data.length > 0) {
          data.data.forEach(aud => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
              <td>${aud.name}</td>
              <td>${aud.name.includes('Lookalike') ? 'Lookalike (LAL)' : 'Custom Audience'}</td>
              <td>${aud.size}</td>
              <td>-</td>
              <td>${getBadge(aud.status || 'AKTİF')}</td>
            `;
            tbody.appendChild(tr);
          });
        } else {
          tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-secondary);">Henüz oluşturulmuş hedef kitle yok. Yukarıdan yapay zeka ile oluşturun.</td></tr>`;
        }
      })
      .catch(err => {
        console.error(err);
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-secondary);">Kitleler yüklenemedi.</td></tr>`;
      });
  }

  // AI Audience Builder Event Listener
  const aiAudienceBtn = document.getElementById('btnBuildAudience');
  if(aiAudienceBtn) {
    aiAudienceBtn.addEventListener('click', () => {
      const prompt = document.getElementById('aiAudiencePrompt').value;
      if (!prompt) return;
      
      const statusDiv = document.getElementById('aiAudienceStatus');
      statusDiv.style.display = 'block';
      statusDiv.innerHTML = `<span style="color:var(--accent-yellow);">Arka planda veritabanı taranıyor ve Meta ile iletişim kuruluyor... Lütfen bekleyin.</span>`;
      
      fetch('/api/admin/audiences/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      })
      .then(res => res.json())
      .then(data => {
        setTimeout(() => {
          btnBuildAudience.innerText = "Oluştur";
          btnBuildAudience.disabled = false;
          statusDiv.style.color = "var(--accent-green)";
          statusDiv.innerText = "Başarılı: " + data.message;
          
          renderAudiences();
        }, 500);
      })
      .catch(err => {
        statusDiv.innerHTML = `<span style="color:#ef4444;">Bir ağ hatası oluştu.</span>`;
      });
    });
  }

  // AI Suggestions Fetch & Render
  function fetchAiSuggestions() {
    fetch('/api/admin/ads/suggestions')
      .then(res => res.json())
      .then(data => {
        const container = document.getElementById('aiSuggestionsList');
        if(!container) return;
        container.innerHTML = '';
        if(data.data && data.data.length > 0) {
          document.getElementById('aiBadge').style.display = 'inline-block';
          document.getElementById('aiBadge').innerText = data.data.length;
          
          data.data.forEach(sug => {
            const div = document.createElement('div');
            div.style.background = 'rgba(212, 175, 55, 0.05)';
            div.style.border = '1px solid var(--accent-gold)';
            div.style.padding = '15px';
            div.style.borderRadius = '8px';
            div.innerHTML = `
              <h3 style="margin-top:0; color:var(--accent-gold);">${sug.adName}</h3>
              <p style="margin:5px 0;"><strong>Performans:</strong> ${sug.performance}</p>
              <p style="margin:5px 0; color:var(--text-secondary);">${sug.suggestion}</p>
              <button class="btn-primary" onclick="approveSuggestion('${sug.id}')" style="margin-top:10px;">${sug.action}</button>
            `;
            container.appendChild(div);
          });
        } else {
          document.getElementById('aiBadge').style.display = 'none';
          container.innerHTML = '<p style="color:var(--text-secondary);">Şu an için yeni bir ölçekleme önerisi bulunmuyor.</p>';
        }
      })
      .catch(err => console.error(err));
  }

  window.approveSuggestion = function(sugId) {
    if(!confirm("Bu testi ana kampanyaya taşıyarak ölçeklemeyi onaylıyor musunuz? İşlem Meta Ads Manager üzerinde otomatik gerçekleşecek.")) return;
    fetch('/api/admin/ads/approve-suggestion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ suggestionId: sugId })
    }).then(res => res.json())
      .then(data => {
        alert(data.message);
        fetchAiSuggestions();
      }).catch(err => console.error(err));
  };

  // Modal Buton İşlemleri
  const btnAiTest = document.getElementById('btnAiTest');
  if(btnAiTest) {
    btnAiTest.addEventListener('click', () => {
      const mediaId = document.getElementById('igAdModal').getAttribute('data-selected-media');
      fetch('/api/admin/ads/ai-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mediaId })
      }).then(res => res.json()).then(data => {
        alert(data.message || data.error);
        document.getElementById('igAdModal').style.display = 'none';
        // Testin önerilere düşmesi için simülasyon amacıyla listeyi yenile
        setTimeout(fetchAiSuggestions, 1000);
      }).catch(err => {
        alert("Bir hata oluştu: " + err.message);
      });
    });
  }

  const btnManualAd = document.getElementById('btnManualAd');
  if(btnManualAd) {
    btnManualAd.addEventListener('click', () => {
      const mediaId = document.getElementById('igAdModal').getAttribute('data-selected-media');
      const budget = document.getElementById('manualBudget').value;
      // Eski mock uç nokta kullanılıyor
      fetch(`/api/admin/ads/ig-drafts/create`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ mediaId, budget }) 
      }).then(res => res.json()).then(data => {
        alert("Manuel taslak başarıyla duraklatılmış (PAUSED) olarak oluşturuldu.");
        document.getElementById('igAdModal').style.display = 'none';
      });
    });
  }

  // İlk açılışta önerileri çek
  fetchAiSuggestions();

  // Çağrı
  renderAudiences();

  function fetchLiveScans() {
    const filterType = document.getElementById('liveScanFilter') ? document.getElementById('liveScanFilter').value : 'today';
    let queryParams = '';
    
    if (filterType === 'today') {
      const { start_date, end_date } = getBusinessDayRange();
      queryParams = `?start_date=${start_date}&end_date=${end_date}`;
    } else if (filterType === '1h') {
      const { start_date, end_date } = getRelativeRange(1);
      queryParams = `?start_date=${start_date}&end_date=${end_date}`;
    } else if (filterType === '4h') {
      const { start_date, end_date } = getRelativeRange(4);
      queryParams = `?start_date=${start_date}&end_date=${end_date}`;
    }

    fetch('/api/admin/reports' + queryParams)
      .then(res => res.json())
      .then(data => {
        const tbody = document.querySelector('#liveScansTable tbody');
        tbody.innerHTML = '';
        if (!data || data.length === 0) {
          tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color: var(--text-secondary);">Bu zaman aralığında okutulan QR yok.</td></tr>`;
          return;
        }
        data.forEach(scan => {
          const dateObj = new Date(scan.timestamp);
          const timeString = dateObj.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
          // Kaynak turu: yeni kaynak_tur kolonu (5 tip) oncelikli; yoksa eski fbclid yedegi.
          const kt = scan.kaynak_tur || ((scan.fbclid || scan.utm_source === 'facebook' || scan.utm_source === 'ig') ? 'reklam' : 'dogrudan');
          const ktMap = {
            reklam:  { cls:'ads',     txt:'REKLAM' + (scan.utm_campaign ? ' (' + scan.utm_campaign + ')' : '') },
            organik: { cls:'organic', txt:'ORGANİK (arama)' },
            sosyal:  { cls:'organic', txt:'SOSYAL' },
            referans:{ cls:'organic', txt:'REFERANS' },
            dogrudan:{ cls:'organic', txt:'DOĞRUDAN (QR/link)' }
          };
          const info = ktMap[kt] || ktMap.dogrudan;
          let sourceBadge = `<span class="badge ${info.cls}">${info.txt}</span>`;
          // Tekrar gelen misafir rozeti (daha once >6 saat once gelmis)
          if (scan.tekrar_gelen) sourceBadge += ` <span class="badge" style="background:#8a5cf6;color:#fff">TEKRAR GELEN</span>`;
          const isMobile = scan.user_agent && scan.user_agent.toLowerCase().includes('mobi') ? '📱 Mobil' : '💻 Masaüstü';

          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td>${timeString}</td>
            <td style="font-weight: 600;">${scan.masa}</td>
            <td style="color: var(--text-secondary); font-size: 0.8rem;">${isMobile}</td>
            <td>${sourceBadge}</td>
            <td style="font-family: monospace; font-size: 0.8rem; color: var(--text-secondary);">...${scan.rep_id.substring(scan.rep_id.length - 8)}</td>
          `;
          tbody.appendChild(tr);
        });
      })
      .catch(err => console.error(err));
  }
});

// Sidebar derin-link: URL hash'ine gore sekme ac (#ads, #reports, #live, #upload)
(function(){
  function openFromHash(){
    var h=(location.hash||'').replace('#','').toLowerCase();
    var map={ads:'tab-ads',reports:'tab-reports',live:'tab-live',upload:'tab-upload',chats:'tab-chats',audit:'tab-audit'};
    if(map[h]){ var b=document.querySelector('.tab-btn[data-tab="'+map[h]+'"]'); if(b) b.click(); }
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', openFromHash); else openFromHash();
  window.addEventListener('hashchange', openFromHash);
})();
