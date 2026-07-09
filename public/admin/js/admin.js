document.addEventListener('DOMContentLoaded', () => {
  // Sekme (Tab) Gezinme Mantığı
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      // Aktif sekme butonunu değiştir
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Aktif içeriği değiştir
      const targetId = btn.getAttribute('data-tab');
      tabContents.forEach(content => {
        content.classList.remove('active');
        if (content.id === targetId) {
          content.classList.add('active');
        }
      });

      // Eğer "Canlı Akış" sekmesine tıklandıysa güncel veriyi çek
      if (targetId === 'tab-live') {
        fetchLiveScans();
      } else if (targetId === 'tab-ads') {
        fetchAdsDashboard();
      }
    });
  });

  // Sayfa yüklendiğinde otomatik ilk sekmeyi (Canlı Akış) çek
  fetchLiveScans();

  // Dosya Yükleme (Drag & Drop) Alanı
  const uploadArea = document.getElementById('uploadArea');
  const fileInput = document.getElementById('fileInput');

  uploadArea.addEventListener('click', () => fileInput.click());

  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('dragover');
  });

  uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('dragover');
  });

  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    if (e.dataTransfer.files.length) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) {
      handleFileUpload(fileInput.files[0]);
    }
  });

  function handleFileUpload(file) {
    const uploadStatus = document.getElementById('uploadStatus');
    const uploadMessage = document.getElementById('uploadMessage');
    
    uploadStatus.style.display = 'block';
    uploadMessage.style.color = 'var(--text-secondary)';
    uploadMessage.innerText = `${file.name} sunucuya yükleniyor ve eşleştiriliyor... Lütfen bekleyin.`;

    const formData = new FormData();
    formData.append('pos_file', file);

    fetch('/api/admin/upload-pos', {
      method: 'POST',
      body: formData
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        uploadMessage.style.color = 'var(--accent-green)';
        uploadMessage.innerText = `Eşleşme Tamamlandı! Rapor sonuçları hazır.`;
        // Burada 3. sekmeye (Günün Özeti) geçiş yapılabilir veya sonuçlar doğrudan ekrana basılabilir
        setTimeout(() => {
          document.querySelector('[data-tab="tab-reports"]').click();
          renderReports(data.report);
        }, 1500);
      } else {
        uploadMessage.style.color = '#ef4444';
        uploadMessage.innerText = `Hata: ${data.error || 'Dosya işlenemedi'}`;
      }
    })
    .catch(err => {
      console.error(err);
      uploadMessage.style.color = '#ef4444';
      uploadMessage.innerText = 'Sunucuya bağlanılamadı veya bir hata oluştu.';
    });
  }

  function fetchLiveScans() {
    fetch('/api/admin/reports')
      .then(res => res.json())
      .then(data => {
        const tbody = document.querySelector('#liveScansTable tbody');
        tbody.innerHTML = ''; // Temizle

        if (!data || data.length === 0) {
          tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color: var(--text-secondary);">Henüz okutulan bir QR yok.</td></tr>`;
          return;
        }

        data.forEach(scan => {
          // Saat formatla (Sadece saat ve dakika)
          const dateObj = new Date(scan.timestamp);
          const timeString = dateObj.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
          
          // Kaynak etiketini belirle
          let sourceBadge = '';
          if (scan.fbclid || scan.utm_source === 'facebook' || scan.utm_source === 'ig') {
             sourceBadge = `<span class="badge ads">REKLAM (${scan.utm_campaign || 'Bilinmiyor'})</span>`;
          } else {
             sourceBadge = `<span class="badge organic">ORGANİK</span>`;
          }

          // Cihaz kısa adını belirle
          const isMobile = scan.user_agent.toLowerCase().includes('mobi') ? '📱 Mobil' : '💻 Masaüstü';

          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td>${timeString}</td>
            <td style="font-weight: 600;">${scan.masa}</td>
            <td style="color: var(--text-secondary); font-size: 0.8rem;">${isMobile}</td>
            <td>${sourceBadge}</td>
            <td style="font-family: monospace; font-size: 0.8rem; color: var(--text-secondary);">${scan.rep_id}</td>
          `;
          tbody.appendChild(tr);
        });
      })
      .catch(err => console.error("Canlı akış çekilemedi:", err));
  }

  function renderReports(reportData) {
    // Burada gelen eşleşme verileri (Toplamlar ve Tablo) doldurulacak
    document.getElementById('statTotalAdRev').innerText = reportData.totalAdRevenue + " TL";
    document.getElementById('statNewRev').innerText = reportData.newCustomerRevenue + " TL";
    document.getElementById('statHaloRev').innerText = reportData.haloRevenue + " TL";
    document.getElementById('statRetargetRev').innerText = reportData.retargetRevenue + " TL";

    const tbody = document.querySelector('#reportsTable tbody');
    tbody.innerHTML = ''; 

    if (reportData.matches.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color: var(--text-secondary);">Hiç reklam eşleşmesi bulunamadı.</td></tr>`;
      return;
    }

    reportData.matches.forEach(match => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${match.time}</td>
        <td>${match.masa}</td>
        <td>${match.total} TL</td>
        <td>${match.perCapita} TL</td>
        <td><span class="badge ${match.type === 'ORGANİK' ? 'organic' : 'ads'}">${match.label}</span></td>
        <td style="color: ${match.capiSent ? 'var(--accent-green)' : 'var(--text-secondary)'}">
          ${match.capiSent ? 'Gönderildi ✔' : 'Bekliyor'}
        </td>
      `;
      tbody.appendChild(tr);
    });

    if (reportData.matches.some(m => m.type !== 'ORGANİK' && !m.capiSent)) {
      document.getElementById('btnSendToMeta').style.display = 'block';
    }
  }

  // --- Reklam Yönetimi (AI) Fonksiyonları ---

  window.toggleAdSettings = function() {
    const modal = document.getElementById('adSettingsModal');
    modal.style.display = modal.style.display === 'none' ? 'block' : 'none';
  };

  window.saveAdSettings = function() {
    const maxCpa = document.getElementById('inputMaxCpa').value;
    const minRoas = document.getElementById('inputMinRoas').value;

    fetch('/api/admin/ads/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        max_cpa: parseFloat(maxCpa),
        min_roas: parseFloat(minRoas),
        pause_if_no_purchase_after_days: 3
      })
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        alert("AI Kuralları başarıyla kaydedildi.");
        toggleAdSettings();
      } else {
        alert("Kaydetme hatası.");
      }
    });
  };

  function fetchAdsDashboard() {
    fetch('/api/admin/ads/dashboard')
      .then(res => res.json())
      .then(result => {
        if (!result.success) return;
        const data = result.data;

        // Kuralları UI'a yaz
        if (data.rules) {
          document.getElementById('inputMaxCpa').value = data.rules.max_cpa || 200;
          document.getElementById('inputMinRoas').value = data.rules.min_roas || 2.0;
        }

        // Yeni Hesap Tablosunu ve Özetleri Doldur
        const activeCamps = data.active_account || [];
        const tbodyActive = document.querySelector('#adsCampaignTable tbody');
        tbodyActive.innerHTML = '';

        let totalSpend = 0;
        let totalPurchases = 0;
        let totalRevenue = 0;

        if (activeCamps.length === 0) {
          tbodyActive.innerHTML = `<tr><td colspan="7" style="text-align:center;">Kayıt bulunamadı.</td></tr>`;
        } else {
          activeCamps.forEach(camp => {
            const insights = camp.insights && camp.insights.data && camp.insights.data[0] ? camp.insights.data[0] : null;
            const spend = insights ? parseFloat(insights.spend) : 0;
            const purchases = insights && insights.actions ? insights.actions.find(a => a.action_type === 'purchase')?.value || 0 : 0;
            const revenue = insights && insights.action_values ? insights.action_values.find(a => a.action_type === 'purchase')?.value || 0 : 0;
            const cpa = purchases > 0 ? (spend / purchases).toFixed(2) : '-';
            const roas = spend > 0 ? (revenue / spend).toFixed(2) : '-';

            totalSpend += spend;
            totalPurchases += parseInt(purchases);
            totalRevenue += parseFloat(revenue);

            let aiSuggestion = '<span style="color:var(--text-secondary)">Bekleniyor</span>';
            const maxCpaAllowed = data.rules.max_cpa || 200;

            if (purchases > 0 && parseFloat(cpa) > maxCpaAllowed) {
              aiSuggestion = '<span class="badge" style="background:#ef4444; color:white;">DURDURMALI</span>';
            } else if (spend > 0 && purchases === 0) {
              aiSuggestion = '<span class="badge yellow">GÖZLEMDE</span>';
            }

            const tr = document.createElement('tr');
            tr.innerHTML = `
              <td>${camp.name}</td>
              <td>${camp.status}</td>
              <td>${spend.toFixed(2)} TL</td>
              <td>${purchases}</td>
              <td>${cpa === '-' ? '-' : cpa + ' TL'}</td>
              <td>${roas}</td>
              <td>${aiSuggestion}</td>
            `;
            tbodyActive.appendChild(tr);
          });
        }

        document.getElementById('adTotalSpend').innerText = totalSpend.toFixed(2) + ' TL';
        const avgCpa = totalPurchases > 0 ? (totalSpend / totalPurchases).toFixed(2) : '0.00';
        document.getElementById('adAverageCpa').innerText = avgCpa + ' TL';
        const totalRoas = totalSpend > 0 ? (totalRevenue / totalSpend).toFixed(2) : '0.00';
        document.getElementById('adRoas').innerText = totalRoas;

        // Eski Hesap Tablosunu Doldur
        const oldCamps = data.old_account_learning || [];
        const tbodyOld = document.querySelector('#oldAdsTable tbody');
        tbodyOld.innerHTML = '';

        if (oldCamps.length === 0) {
          tbodyOld.innerHTML = `<tr><td colspan="3" style="text-align:center;">Geçmiş veri bulunamadı.</td></tr>`;
        } else {
          oldCamps.forEach(camp => {
            const insights = camp.insights && camp.insights.data && camp.insights.data[0] ? camp.insights.data[0] : null;
            const spend = insights ? parseFloat(insights.spend).toFixed(2) : '0.00';
            const purchases = insights && insights.actions ? insights.actions.find(a => a.action_type === 'purchase')?.value || 0 : 0;
            const cpa = purchases > 0 ? (parseFloat(spend) / parseInt(purchases)).toFixed(2) : '-';

            const tr = document.createElement('tr');
            tr.innerHTML = `
              <td>${camp.name}</td>
              <td>${spend} TL</td>
              <td>${cpa === '-' ? '-' : cpa + ' TL'}</td>
            `;
            tbodyOld.appendChild(tr);
          });
        }
      })
      .catch(err => {
        console.error("Ads dashboard error:", err);
        const tbody = document.querySelector('#adsCampaignTable tbody');
        if(tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#ef4444;">Veri çekilemedi. Meta Jetonu eksik olabilir.</td></tr>`;
      });
  }

});
