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

});
