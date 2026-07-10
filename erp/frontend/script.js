let currentSupplierId = null;
const apiBase = "/erp/api";

function showPage(pageId) {
    document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
    document.getElementById(pageId).style.display = 'block';
    
    document.querySelectorAll('.sidebar li').forEach(li => li.classList.remove('active'));
    
    if(pageId === 'dashboard') {
        document.querySelector('.sidebar li:nth-child(1)').classList.add('active');
        loadDashboard();
    } else if (pageId === 'logs') {
        document.querySelector('.sidebar li:nth-child(2)').classList.add('active');
        loadLogs();
    }
}

function openModal(id) { document.getElementById(id).style.display = 'block'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }

async function loadDashboard() {
    const targetDate = document.getElementById('targetDate').value;
    let url = `${apiBase}/dashboard`;
    if(targetDate) url += `?target_date=${targetDate}`;
    
    const res = await fetch(url);
    const data = await res.json();
    lastDashboardData = data.suppliers;
    
    document.getElementById('totalDueAll').innerText = data.total_due_all.toLocaleString('tr-TR', {minimumFractionDigits: 2}) + ' TL';
    
    const tbody = document.getElementById('dashboardTbody');
    tbody.innerHTML = '';
    
    const txSelect = document.getElementById('txSupplier');
    txSelect.innerHTML = '';
    
    data.suppliers.forEach(s => {
        const tr = document.createElement('tr');
        
        let islemHtml = `<button class="btn btn-secondary" onclick="openSupplierDetail(${s.id})">Detay</button>`;
        if(s.vadesi_gelen > 0) {
            islemHtml += ` <button class="btn btn-primary" onclick="markAsPaid(${s.id}, ${s.vadesi_gelen})" style="padding: 5px 8px; font-size: 13px;">💸 Ödeme Yaptım</button>`;
        }
        
        tr.innerHTML = `
            <td onclick="openSupplierDetail(${s.id})" style="cursor:pointer;"><b>${s.name}</b></td>
            <td onclick="openSupplierDetail(${s.id})" style="cursor:pointer;">${s.vade_suresi}</td>
            <td onclick="openSupplierDetail(${s.id})" style="cursor:pointer; color: var(--danger)"><b>${s.vadesi_gelen.toLocaleString('tr-TR', {minimumFractionDigits: 2})} TL</b></td>
            <td onclick="openSupplierDetail(${s.id})" style="cursor:pointer; color: var(--warning)"><b>${s.toplam_cari.toLocaleString('tr-TR', {minimumFractionDigits: 2})} TL</b></td>
            <td>${islemHtml}</td>
        `;
        tbody.appendChild(tr);
        
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.innerText = s.name;
        opt.dataset.isManual = s.is_manual_due_date;
        txSelect.appendChild(opt);
    });
    checkManualDueDate();
}

function checkManualDueDate() {
    const sel = document.getElementById('txSupplier');
    if(!sel) return;
    const opt = sel.options[sel.selectedIndex];
    const isManual = opt && opt.dataset.isManual === 'true';
    const grp = document.getElementById('txDueDateGroup');
    const inp = document.getElementById('txDueDate');
    if(grp && inp) {
        grp.style.display = isManual ? 'block' : 'none';
        inp.required = isManual;
    }
}

async function openSupplierDetail(id) {
    currentSupplierId = id;
    showPage('supplierDetail');
    
    const res = await fetch(`${apiBase}/suppliers/${id}`);
    const data = await res.json();
    
    document.getElementById('detailName').innerText = data.supplier.name;
    document.getElementById('detailTerm').innerText = data.supplier.payment_term_days;
    document.getElementById('detailInitial').innerText = data.supplier.initial_balance.toLocaleString('tr-TR');
    document.getElementById('detailToplamCari').innerText = data.supplier.toplam_cari.toLocaleString('tr-TR', {minimumFractionDigits: 2}) + ' TL';
    
    // Fill Edit Form just in case
    document.getElementById('editSupName').value = data.supplier.name;
    document.getElementById('editSupBal').value = data.supplier.initial_balance;
    document.getElementById('editSupTerm').value = data.supplier.payment_term_days;
    document.getElementById('editSupManual').checked = data.supplier.is_manual_due_date;
    
    const tbody = document.getElementById('txTbody');
    tbody.innerHTML = '';
    
    const term = data.supplier.payment_term_days;
    const isManual = data.supplier.is_manual_due_date;
    
    data.transactions.forEach(t => {
        let displayDueDate = "-";
        if (t.type === 'Alım') {
            if (isManual) {
                if (t.due_date) {
                    displayDueDate = t.due_date.split('-').reverse().join('.') + ` <button class="action-btn" onclick="editTxDueDate(${t.id}, '${t.due_date}')" style="padding:2px 6px; font-size:12px; margin-left:5px; background:#f0f0f0; border:1px solid #ddd; border-radius:3px;">✎</button>`;
                } else {
                    let txYear = parseInt(t.date.split('-')[0]);
                    displayDueDate = `01.01.${txYear + 1} <button class="action-btn" onclick="editTxDueDate(${t.id}, '')" style="padding:2px 6px; font-size:12px; margin-left:5px; background:#f0f0f0; border:1px solid #ddd; border-radius:3px;">✎</button>`;
                }
            } else {
                let d = new Date(t.date);
                d.setDate(d.getDate() + term);
                displayDueDate = d.toISOString().split('T')[0].split('-').reverse().join('.');
            }
        }
        
        const tr = document.createElement('tr');
        let color = t.type === 'Alım' ? 'var(--danger)' : 'var(--success)';
        if(t.type === 'İade') color = 'var(--success)';
        tr.innerHTML = `
            <td>${t.date.split('-').reverse().join('.')}</td>
            <td>${displayDueDate}</td>
            <td style="color:var(--text-muted); font-size:13px">${t.timestamp}</td>
            <td><b>${t.type}</b></td>
            <td style="color: ${color}"><b>${t.amount.toLocaleString('tr-TR', {minimumFractionDigits: 2})} TL</b></td>
            <td>
                <button class="action-btn" onclick="openEditTxModal(${t.id}, '${t.type}', '${t.date}', ${t.amount})" style="background:#f0f0f0; border:1px solid #ddd; border-radius:3px;">✎</button>
                <button class="action-btn" onclick="deleteTx(${t.id})">Sil</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function openEditSupplier() { openModal('editSupplierModal'); }

async function deleteSupplier() {
    if(!confirm("Bu tedarikçiyi ve ona ait tüm işlem/eşleştirmeleri silmek istediğinize emin misiniz? Bu işlem geri alınamaz!")) return;
    const res = await fetch(`${apiBase}/suppliers/${currentSupplierId}`, { method: 'DELETE' });
    if(res.ok) {
        showPage('dashboard');
    }
}

async function loadLogs() {
    const res = await fetch(`${apiBase}/logs`);
    const data = await res.json();
    const tbody = document.getElementById('logsTbody');
    tbody.innerHTML = '';
    
    data.forEach(l => {
        const tr = document.createElement('tr');
        let color = l.type === 'Alım' ? 'var(--danger)' : 'var(--success)';
        if(l.type === 'İade') color = 'var(--success)';
        tr.innerHTML = `
            <td>${l.date.split('-').reverse().join('.')}</td>
            <td>${l.timestamp}</td>
            <td><b>${l.supplier_name}</b></td>
            <td><b>${l.type}</b></td>
            <td style="color: ${color}"><b>${l.amount.toLocaleString('tr-TR', {minimumFractionDigits: 2})} TL</b></td>
            <td>
                <button class="action-btn" onclick="openEditTxModal(${l.id}, '${l.type}', '${l.date}', ${l.amount})" style="background:#f0f0f0; border:1px solid #ddd; border-radius:3px;">✎ Düzenle</button>
                <button class="action-btn" onclick="deleteTx(${l.id})">Sil</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function copyDuePayments() {
    if(!lastDashboardData || lastDashboardData.length === 0) return alert('Kopyalanacak veri yok.');
    
    const targetDateInput = document.getElementById('targetDate').value;
    let dateText = "Bugün";
    if (targetDateInput) {
        dateText = targetDateInput.split('-').reverse().join('.');
    } else {
        const today = new Date();
        dateText = today.toISOString().split('T')[0].split('-').reverse().join('.');
    }

    let text = `${dateText} günü vadesi gelmiş ödemeler:\n`;
    let hasDues = false;
    let total = 0;

    lastDashboardData.forEach(s => {
        if (s.vadesi_gelen > 0) {
            hasDues = true;
            total += s.vadesi_gelen;
            text += `${s.name} ${s.vadesi_gelen.toLocaleString('tr-TR', {minimumFractionDigits: 2})} TL\n`;
        }
    });

    if (!hasDues) {
        return alert('Vadesi gelmiş ödeme bulunmamaktadır.');
    }
    
    text += `----------------------\nToplam: ${total.toLocaleString('tr-TR', {minimumFractionDigits: 2})} TL`;

    navigator.clipboard.writeText(text).then(() => {
        alert('Bilgiler panoya kopyalandı! İstediğiniz yere (WhatsApp, Mail vs.) yapıştırabilirsiniz.');
    }).catch(err => {
        alert('Kopyalama başarısız oldu: ' + err);
    });
}


async function addSupplier(e) {
    e.preventDefault();
    const fd = new FormData();
    fd.append('name', document.getElementById('supName').value);
    fd.append('initial_balance', document.getElementById('supBal').value);
    fd.append('payment_term_days', document.getElementById('supTerm').value);
    fd.append('is_manual_due_date', document.getElementById('supManual').checked);
    
    const res = await fetch(`${apiBase}/suppliers`, { method: 'POST', body: fd });
    if(res.ok) {
        closeModal('addSupplierModal');
        e.target.reset();
        loadDashboard();
    } else {
        alert(await res.text());
    }
}

async function updateSupplier(e) {
    e.preventDefault();
    const fd = new FormData();
    fd.append('name', document.getElementById('editSupName').value);
    fd.append('initial_balance', document.getElementById('editSupBal').value);
    fd.append('payment_term_days', document.getElementById('editSupTerm').value);
    fd.append('is_manual_due_date', document.getElementById('editSupManual').checked);
    
    const res = await fetch(`${apiBase}/suppliers/${currentSupplierId}`, { method: 'PUT', body: fd });
    if(res.ok) {
        closeModal('editSupplierModal');
        openSupplierDetail(currentSupplierId);
    }
}

async function addTransaction(e) {
    e.preventDefault();
    const fd = new FormData();
    fd.append('supplier_id', document.getElementById('txSupplier').value);
    fd.append('type', document.getElementById('txType').value);
    fd.append('date_str', document.getElementById('txDate').value);
    fd.append('amount', document.getElementById('txAmount').value);
    if(document.getElementById('txDueDate').value) {
        fd.append('due_date_str', document.getElementById('txDueDate').value);
    }
    
    const res = await fetch(`${apiBase}/transactions`, { method: 'POST', body: fd });
    if(res.ok) {
        closeModal('addTransactionModal');
        e.target.reset();
        loadDashboard();
        if(currentSupplierId) openSupplierDetail(currentSupplierId);
    }
}

async function deleteTx(id) {
    if(!confirm('Bu işlemi silmek istediğinize emin misiniz?')) return;
    await fetch(`${apiBase}/transactions/${id}`, { method: 'DELETE' });
    if(document.getElementById('supplierDetail').style.display === 'block') {
        openSupplierDetail(currentSupplierId);
    } else {
        loadLogs();
    }
}

function openEditTxModal(id, type, dateStr, amount) {
    document.getElementById('editTxId').value = id;
    document.getElementById('editTxType').value = type;
    let dStr = dateStr;
    if(dStr.includes('.')) dStr = dStr.split('.').reverse().join('-');
    document.getElementById('editTxDate').value = dStr;
    document.getElementById('editTxAmount').value = amount;
    openModal('editTxModal');
}

async function submitEditTx(e) {
    e.preventDefault();
    const id = document.getElementById('editTxId').value;
    const fd = new FormData();
    fd.append('type', document.getElementById('editTxType').value);
    fd.append('date_str', document.getElementById('editTxDate').value);
    fd.append('amount', document.getElementById('editTxAmount').value);
    
    const res = await fetch(`${apiBase}/transactions/${id}`, { method: 'PUT', body: fd });
    if(res.ok) {
        closeModal('editTxModal');
        if(document.getElementById('supplierDetail').style.display === 'block') {
            openSupplierDetail(currentSupplierId);
        } else {
            loadLogs();
            loadDashboard();
        }
    } else {
        alert(await res.text());
    }
}

async function markAsPaid(supplierId, amount) {
    if(!confirm(`${amount.toLocaleString('tr-TR')} TL vadesi gelen borcu ödendi olarak işaretlemek (bugünün tarihiyle ödeme girmek) istiyor musunuz?`)) return;
    const fd = new FormData();
    fd.append('supplier_id', supplierId);
    fd.append('type', 'Ödeme');
    fd.append('date_str', new Date().toISOString().split('T')[0]);
    fd.append('amount', amount);
    
    const res = await fetch(`${apiBase}/transactions`, { method: 'POST', body: fd });
    if(res.ok) {
        loadDashboard();
    } else {
        alert('Hata: ' + await res.text());
    }
}

async function editTxDueDate(txId, currentDate) {
    const newDate = prompt("Yeni Ödeme Tarihini (Y-A-G veya G.A.Y) girin. Örn: 2026-06-25", currentDate || "");
    if(newDate === null) return;
    
    let dStr = newDate.trim();
    if(dStr.includes('.')) dStr = dStr.split('.').reverse().join('-');
    
    if(!dStr || isNaN(new Date(dStr).getTime())) {
        return alert('Geçersiz tarih formatı! Lütfen 2026-06-25 şeklinde girin.');
    }
    
    const fd = new FormData();
    fd.append('due_date_str', dStr);
    
    const res = await fetch(`${apiBase}/transactions/${txId}/due_date`, { method: 'PUT', body: fd });
    if(res.ok) {
        openSupplierDetail(currentSupplierId);
    } else {
        alert('Hata: ' + await res.text());
    }
}

let pendingPdfData = null;

async function uploadPdf() {
    const file = document.getElementById('pdfFile').files[0];
    if(!file) return alert('Lütfen bir dosya seçin');
    
    document.getElementById('pdfBtn').innerText = 'Yükleniyor...';
    
    const fd = new FormData();
    fd.append('file', file);
    
    try {
        const res = await fetch(`${apiBase}/excel/check`, { method: 'POST', body: fd });
        if (!res.ok) {
            alert("Hata oluştu: " + await res.text());
            document.getElementById('pdfBtn').innerText = 'Listeyi Yükle ve Tara';
            return;
        }
        const data = await res.json();
        
        document.getElementById('pdfBtn').innerText = 'Listeyi Yükle ve Tara';
        
        if(data.unknown_names && data.unknown_names.length > 0) {
            pendingPdfData = data;
            const list = document.getElementById('mappingList');
            list.innerHTML = '';
            let opts = `<option value="">-- Tedarikçi Seç --</option>`;
            data.suppliers.forEach(s => opts += `<option value="${s.id}">${s.name}</option>`);
            data.unknown_names.forEach((name, i) => {
                const div = document.createElement('div');
                div.className = 'map-item';
                div.style.marginBottom = '12px';
                div.style.paddingBottom = '8px';
                div.style.borderBottom = '1px solid #eaeaea';
                div.innerHTML = `<span style="display:block; margin-bottom:5px; font-weight:600; font-size:14px;">${name}</span><select class="input" id="map_${i}" data-name="${name}">${opts}</select>`;
                list.appendChild(div);
            });
            document.getElementById('previewSection').style.display = 'none';
            document.getElementById('mappingSection').style.display = 'block';
        } else {
            pendingPdfData = data;
            document.getElementById('mappingSection').style.display = 'none';
            showPreviewTable(data.extracted_data, data.suppliers);
        }
    } catch (e) {
        alert("Bağlantı hatası: " + e);
        document.getElementById('pdfBtn').innerText = 'Listeyi Yükle ve Tara';
    }
}

function showPreviewTable(extracted, suppliers) {
    const tbody = document.getElementById('previewTbody');
    tbody.innerHTML = '';
    
    let supplierMap = {};
    let manualMap = {};
    suppliers.forEach(s => {
        supplierMap[s.id] = s.name;
        manualMap[s.id] = s.is_manual;
    });
    
    extracted.forEach((item, index) => {
        const isManual = manualMap[item.supplier_id];
        const dueInput = isManual ? `<input type="date" class="row-due-date input" style="padding:4px;" data-index="${index}" required>` : `<span style="color:#888;">Otomatik</span>`;
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="padding: 8px; border-bottom: 1px solid #ddd;">${item.date.split('-').reverse().join('.')}</td>
            <td style="padding: 8px; border-bottom: 1px solid #ddd; font-size: 13px;">${item.unvan_raw}</td>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;"><b>${supplierMap[item.supplier_id] || 'Bilinmiyor'}</b></td>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;">${dueInput}</td>
            <td style="padding: 8px; border-bottom: 1px solid #ddd; color: var(--danger);"><b>${item.tutar.toLocaleString('tr-TR', {minimumFractionDigits: 2})} TL</b></td>
        `;
        tbody.appendChild(tr);
    });
    
    document.getElementById('previewSection').style.display = 'block';
}

async function commitPdfMappings() {
    if(!pendingPdfData) return;
    const mappings = {};
    const selects = document.querySelectorAll('#mappingList select');
    
    for(let sel of selects) {
        if(!sel.value) return alert('Lütfen tüm unvanlar için bir tedarikçi seçin!');
        mappings[sel.dataset.name] = sel.value;
    }
    
    // Save locally for commit later
    pendingPdfData.new_mappings = mappings;
    
    // Update local extracted data with mapped suppliers for preview
    pendingPdfData.extracted_data.forEach(item => {
        if(mappings[item.unvan_raw]) {
            item.supplier_id = mappings[item.unvan_raw];
        }
    });
    
    document.getElementById('mappingSection').style.display = 'none';
    showPreviewTable(pendingPdfData.extracted_data, pendingPdfData.suppliers);
}

async function commitPreviewData() {
    if(!pendingPdfData) return;
    
    const inputs = document.querySelectorAll('.row-due-date');
    for(let inp of inputs) {
        if(!inp.value) return alert('Lütfen manuel ödemeli tüm faturalar için Ödeme Tarihi girin!');
        pendingPdfData.extracted_data[inp.dataset.index].due_date = inp.value;
    }
    
    const res = await fetch(`${apiBase}/excel/commit`, { 
        method: 'POST', 
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({new_mappings: pendingPdfData.new_mappings || {}, extracted_data: pendingPdfData.extracted_data}) 
    });
    const data = await res.json();
    if(data.success) {
        alert(data.count + ' adet fatura başarıyla aktarıldı!');
        closeModal('uploadPdfModal');
        document.getElementById('previewSection').style.display = 'none';
        loadDashboard();
    }
}

async function uploadExcel() {
    const file = document.getElementById('excelFile').files[0];
    if(!file) return alert('Dosya seçin');
    document.getElementById('excelBtn').innerText = 'Yükleniyor...';
    
    const fd = new FormData();
    fd.append('file', file);
    
    try {
        const res = await fetch(`${apiBase}/import_excel`, { method: 'POST', body: fd });
        if(!res.ok) {
            alert("Hata: " + await res.text());
            document.getElementById('excelBtn').innerText = 'Excel Yükle';
            return;
        }
        const data = await res.json();
        
        if(data.success) {
            alert(data.count + ' kayıt aktarıldı!');
            closeModal('importExcelModal');
            loadDashboard();
        }
    } catch (e) {
        alert("Bağlantı hatası: " + e);
    }
    document.getElementById('excelBtn').innerText = 'Excel Yükle';
}

function exportSupplier() {
    if(!currentSupplierId) return;
    let url = `${apiBase}/export/${currentSupplierId}`;
    const sDate = document.getElementById('exportStart').value;
    const eDate = document.getElementById('exportEnd').value;
    
    let params = [];
    if(sDate) params.push(`start_date=${sDate}`);
    if(eDate) params.push(`end_date=${eDate}`);
    if(params.length > 0) url += '?' + params.join('&');
    
    window.open(url, '_blank');
}

// Init
window.onload = () => {
    // Set default date to today
    document.getElementById('targetDate').valueAsDate = new Date();
    loadDashboard();
};
