from fastapi import FastAPI, UploadFile, File, Form, Depends, HTTPException, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from datetime import datetime, date, timedelta
import pandas as pd
import io
import fitz
import re
import os
import openpyxl
import urllib.parse

from backend.database import SessionLocal, Supplier, Transaction, Mapping

def sync_database_to_excel(db: Session):
    file_path = os.environ.get("ERP_XLSX_PATH", "Mini_ERP_Veriler.xlsx")
    try:
        # Suppliers
        suppliers = db.query(Supplier).all()
        sup_data = [{"ID": s.id, "Tedarikçi Adı": s.name, "Başlangıç Carisi": s.initial_balance or 0.0, "Vade Süresi": s.payment_term_days} for s in suppliers]
        df_sup = pd.DataFrame(sup_data)
        
        # Transactions
        txs = db.query(Transaction).join(Supplier).all()
        tx_data = [{"Zaman Damgası": t.timestamp, "İşlem Tipi": t.transaction_type, "Tedarikçi": t.supplier.name if t.supplier else "", "Tutar": t.amount, "Belge Tarihi": t.transaction_date.strftime("%d.%m.%Y")} for t in txs]
        df_tx = pd.DataFrame(tx_data)
        
        # Mappings
        maps = db.query(Mapping).join(Supplier).all()
        map_data = [{"Yasal Unvan (PDF/Excel)": m.pdf_name, "Eşleşen Tedarikçi": m.supplier.name if m.supplier else ""} for m in maps]
        df_map = pd.DataFrame(map_data)
        
        with pd.ExcelWriter(file_path, engine="openpyxl") as writer:
            df_sup.to_excel(writer, sheet_name="Tedarikçiler", index=False)
            df_tx.to_excel(writer, sheet_name="İşlemler", index=False)
            df_map.to_excel(writer, sheet_name="Eşleştirmeler", index=False)
    except Exception as e:
        print("Excel sync error:", e)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Admin Basic Auth (ayni /secrets/adminpw sifresi; ayarli degilse ACIK) ---
import base64, time
_ADMIN_PW_CACHE = {"v": None, "t": 0.0}

def _get_admin_pw():
    now = time.time()
    if now - _ADMIN_PW_CACHE["t"] < 10:
        return _ADMIN_PW_CACHE["v"]
    pw = os.environ.get("ADMINPW") or os.environ.get("ADMIN_PASSWORD")
    try:
        if os.path.exists("/secrets/adminpw"):
            with open("/secrets/adminpw") as f:
                s = f.read().strip()
                if s:
                    pw = s
    except Exception:
        pass
    _ADMIN_PW_CACHE["v"] = pw
    _ADMIN_PW_CACHE["t"] = now
    return pw

@app.middleware("http")
async def admin_auth(request, call_next):
    if request.method == "OPTIONS":
        return await call_next(request)
    pw = _get_admin_pw()
    if pw:
        auth = request.headers.get("authorization", "")
        ok = False
        if auth.startswith("Basic "):
            try:
                dec = base64.b64decode(auth[6:]).decode("utf-8")
                _, _, p = dec.partition(":")
                ok = (p == pw)
            except Exception:
                ok = False
        if not ok:
            return Response(status_code=401,
                            headers={"WWW-Authenticate": 'Basic realm="Republique Yonetim"'},
                            content="Yetkilendirme gerekli.")
    return await call_next(request)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# API Endpoints

@app.get("/api/dashboard")
def get_dashboard(target_date: str = None, db: Session = Depends(get_db)):
    if target_date:
        t_date = datetime.strptime(target_date, "%Y-%m-%d").date()
    else:
        t_date = date.today()
        
    suppliers = db.query(Supplier).all()
    results = []
    total_due_all = 0.0
    
    for s in suppliers:
        txs = db.query(Transaction).filter(Transaction.supplier_id == s.id).all()
        
        sum_alim = sum((t.amount or 0.0) for t in txs if t.transaction_type == "Alım")
        sum_odeme = sum((t.amount or 0.0) for t in txs if t.transaction_type == "Ödeme")
        sum_iade = sum((t.amount or 0.0) for t in txs if t.transaction_type == "İade")
        
        toplam_cari = (s.initial_balance or 0.0) + sum_alim - sum_odeme - sum_iade
        
        vadesi_gelmemis_toplam = 0.0
        for t in txs:
            if t.transaction_type == "Alım":
                if s.is_manual_due_date:
                    d_date = t.due_date
                    if not d_date:
                        try:
                            d_date = t.transaction_date.replace(year=t.transaction_date.year + 1)
                        except ValueError:
                            d_date = t.transaction_date + timedelta(days=365)
                    if d_date > t_date:
                        vadesi_gelmemis_toplam += (t.amount or 0.0)
                else:
                    due_date = t.transaction_date + timedelta(days=s.payment_term_days)
                    if due_date > t_date:
                        vadesi_gelmemis_toplam += (t.amount or 0.0)
                    
        vadesi_gelen = max(0.0, toplam_cari - vadesi_gelmemis_toplam)
        
        results.append({
            "id": s.id,
            "name": s.name,
            "vadesi_gelen": vadesi_gelen,
            "toplam_cari": toplam_cari,
            "vade_suresi": s.payment_term_days
        })
        total_due_all += vadesi_gelen
        
    return {"suppliers": results, "total_due_all": total_due_all}

@app.get("/api/suppliers/{supplier_id}")
def get_supplier_details(supplier_id: int, db: Session = Depends(get_db)):
    s = db.query(Supplier).filter(Supplier.id == supplier_id).first()
    if not s: raise HTTPException(404, "Not found")
    txs = db.query(Transaction).filter(Transaction.supplier_id == supplier_id).order_by(Transaction.transaction_date.desc(), Transaction.id.desc()).all()
    
    # Calculate balance
    sum_alim = sum((t.amount or 0.0) for t in txs if t.transaction_type == "Alım")
    sum_odeme = sum((t.amount or 0.0) for t in txs if t.transaction_type == "Ödeme")
    sum_iade = sum((t.amount or 0.0) for t in txs if t.transaction_type == "İade")
    toplam_cari = (s.initial_balance or 0.0) + sum_alim - sum_odeme - sum_iade
    
    return {
        "supplier": {
            "id": s.id,
            "name": s.name,
            "initial_balance": (s.initial_balance or 0.0),
            "payment_term_days": s.payment_term_days,
            "is_manual_due_date": bool(s.is_manual_due_date),
            "toplam_cari": toplam_cari
        },
        "transactions": [
            {
                "id": t.id,
                "type": t.transaction_type,
                "amount": (t.amount or 0.0),
                "date": t.transaction_date.strftime("%Y-%m-%d"),
                "due_date": t.due_date.strftime("%Y-%m-%d") if t.due_date else None,
                "timestamp": t.timestamp
            } for t in txs
        ]
    }

@app.post("/api/suppliers")
def create_supplier(name: str = Form(...), initial_balance: float = Form(0), payment_term_days: int = Form(30), is_manual_due_date: bool = Form(False), db: Session = Depends(get_db)):
    if db.query(Supplier).filter(Supplier.name == name).first():
        raise HTTPException(400, "Bu isimde bir tedarikçi zaten var.")
    s = Supplier(name=name, initial_balance=initial_balance, payment_term_days=payment_term_days, is_manual_due_date=int(is_manual_due_date))
    db.add(s)
    db.commit()
    return {"success": True}

@app.put("/api/suppliers/{supplier_id}")
def update_supplier(supplier_id: int, name: str = Form(...), initial_balance: float = Form(0), payment_term_days: int = Form(30), is_manual_due_date: bool = Form(False), db: Session = Depends(get_db)):
    s = db.query(Supplier).filter(Supplier.id == supplier_id).first()
    if not s: raise HTTPException(404, "Not found")
    s.name = name
    s.initial_balance = initial_balance
    s.payment_term_days = payment_term_days
    s.is_manual_due_date = int(is_manual_due_date)
    db.commit()
    return {"success": True}

@app.post("/api/transactions")
def add_transaction(supplier_id: int = Form(...), type: str = Form(...), amount: float = Form(...), date_str: str = Form(...), due_date_str: str = Form(None), db: Session = Depends(get_db)):
    t_date = datetime.strptime(date_str, "%Y-%m-%d").date()
    d_date = datetime.strptime(due_date_str, "%Y-%m-%d").date() if due_date_str else None
    ts = datetime.now().strftime("%d.%m.%Y %H:%M:%S")
    t = Transaction(
        supplier_id=supplier_id,
        transaction_type=type,
        amount=amount,
        transaction_date=t_date,
        due_date=d_date,
        timestamp=ts
    )
    db.add(t)
    db.commit()
    sync_database_to_excel(db)
    return {"success": True}

@app.put("/api/transactions/{tx_id}/due_date")
def update_tx_due_date(tx_id: int, due_date_str: str = Form(...), db: Session = Depends(get_db)):
    t = db.query(Transaction).filter(Transaction.id == tx_id).first()
    if not t: raise HTTPException(404, "Not found")
    t.due_date = datetime.strptime(due_date_str, "%Y-%m-%d").date()
    db.commit()
    return {"success": True}

@app.put("/api/transactions/{tx_id}")
def update_transaction(tx_id: int, type: str = Form(...), date_str: str = Form(...), amount: float = Form(...), due_date_str: str = Form(""), db: Session = Depends(get_db)):
    t = db.query(Transaction).filter(Transaction.id == tx_id).first()
    if not t: raise HTTPException(404, "Not found")
    t.transaction_type = type
    t.transaction_date = datetime.strptime(date_str, "%Y-%m-%d").date()
    t.amount = amount
    if due_date_str:
        t.due_date = datetime.strptime(due_date_str, "%Y-%m-%d").date()
    db.commit()
    sync_database_to_excel(db)
    return {"success": True}

@app.delete("/api/transactions/{tx_id}")
def delete_transaction(tx_id: int, db: Session = Depends(get_db)):
    t = db.query(Transaction).filter(Transaction.id == tx_id).first()
    if t:
        db.delete(t)
        db.commit()
        sync_database_to_excel(db)
    return {"success": True}

@app.delete("/api/suppliers/{supplier_id}")
def delete_supplier(supplier_id: int, db: Session = Depends(get_db)):
    s = db.query(Supplier).filter(Supplier.id == supplier_id).first()
    if s:
        db.delete(s)
        db.commit()
        sync_database_to_excel(db)
    return {"success": True}

@app.get("/api/logs")
def get_logs(db: Session = Depends(get_db)):
    txs = db.query(Transaction).join(Supplier).order_by(Transaction.transaction_date.desc(), Transaction.id.desc()).all()
    data = []
    for t in txs:
        data.append({
            "id": t.id,
            "type": t.transaction_type,
            "amount": (t.amount or 0.0),
            "date": t.transaction_date.strftime("%Y-%m-%d"),
            "timestamp": t.timestamp,
            "supplier_name": t.supplier.name
        })
    return data

@app.get("/api/export/{supplier_id}")
def export_supplier(supplier_id: int, start_date: str = None, end_date: str = None, db: Session = Depends(get_db)):
    s = db.query(Supplier).filter(Supplier.id == supplier_id).first()
    if not s:
        raise HTTPException(status_code=404)
        
    query = db.query(Transaction).filter(Transaction.supplier_id == supplier_id)
    
    # Calculate Devreden Bakiye if start_date is given
    devreden = (s.initial_balance or 0.0)
    
    if start_date:
        sd = datetime.strptime(start_date, "%Y-%m-%d").date()
        past_txs = query.filter(Transaction.transaction_date < sd).all()
        s_alim = sum((t.amount or 0.0) for t in past_txs if t.transaction_type == "Alım")
        s_odeme = sum((t.amount or 0.0) for t in past_txs if t.transaction_type == "Ödeme")
        s_iade = sum((t.amount or 0.0) for t in past_txs if t.transaction_type == "İade")
        devreden = devreden + s_alim - s_odeme - s_iade
        
        query = query.filter(Transaction.transaction_date >= sd)
        
    if end_date:
        ed = datetime.strptime(end_date, "%Y-%m-%d").date()
        query = query.filter(Transaction.transaction_date <= ed)
        
    # Sondan başa sıralama (En yeni en üstte)
    txs = query.order_by(Transaction.transaction_date.desc(), Transaction.id.desc()).all()
    
    data = []
    for t in txs:
        data.append({
            "Tarih": t.transaction_date.strftime("%d.%m.%Y"),
            "İşlem Tipi": t.transaction_type,
            "Tutar": (t.amount or 0.0)
        })
        
    # En altta Başlangıç / Devreden Bakiye yazsın
    label = "Devreden Bakiye" if start_date else "Başlangıç Bakiyesi"
    data.append({"Tarih": "-", "İşlem Tipi": label, "Tutar": devreden})
        
    df = pd.DataFrame(data)
    
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        df.to_excel(writer, sheet_name="Ekstre", index=False)
        worksheet = writer.sheets['Ekstre']
        for column_cells in worksheet.columns:
            length = max(len(str(cell.value)) for cell in column_cells)
            worksheet.column_dimensions[openpyxl.utils.get_column_letter(column_cells[0].column)].width = length + 5
            
    output.seek(0)
    
    encoded_filename = urllib.parse.quote(f"Ekstre_{s.name}.xlsx")
    headers = {
        'Content-Disposition': f"attachment; filename*=utf-8''{encoded_filename}"
    }
    return Response(output.read(), headers=headers, media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')

@app.post("/api/import_excel")
async def import_excel(file: UploadFile = File(...), db: Session = Depends(get_db)):
    content = await file.read()
    temp_path = "temp_import.xls"
    with open(temp_path, "wb") as f: f.write(content)
    
    try:
        try:
            df = pd.read_excel(temp_path, engine="openpyxl")
        except:
            try:
                df = pd.read_excel(temp_path, engine="xlrd")
            except:
                df = pd.read_html(temp_path)[0]
    except Exception as e:
        if os.path.exists(temp_path): os.remove(temp_path)
        raise HTTPException(400, f"Dosya okunamadı: {e}")
        
    if os.path.exists(temp_path): os.remove(temp_path)
    
    success_count = 0
    for _, row in df.iterrows():
        try:
            timestamp = str(row.iloc[0])
            islem_tipi = str(row.iloc[1]).strip()
            tedarikci_adi = str(row.iloc[2]).strip()
            tutar = float(row.iloc[3])
            tarih_val = row.iloc[4]
            
            if isinstance(tarih_val, datetime):
                tarih = tarih_val.date()
            elif isinstance(tarih_val, str):
                tarih = datetime.strptime(tarih_val, "%d.%m.%Y").date()
            else:
                continue
                
            # Tedarikci var mı?
            sup = db.query(Supplier).filter(Supplier.name == tedarikci_adi).first()
            if not sup:
                sup = Supplier(name=tedarikci_adi, initial_balance=0, payment_term_days=30)
                db.add(sup)
                db.commit()
                db.refresh(sup)
                
            # Ekle
            if islem_tipi not in ["Alım", "Ödeme", "İade"]:
                continue
                
            tx = Transaction(
                supplier_id=sup.id,
                transaction_type=islem_tipi,
                amount=tutar,
                transaction_date=tarih,
                timestamp=timestamp
            )
            db.add(tx)
            success_count += 1
        except Exception as e:
            print("Row error:", e)
            continue
            
    db.commit()
    return {"success": True, "count": success_count}

@app.post("/api/excel/check")
async def check_excel(file: UploadFile = File(...), db: Session = Depends(get_db)):
    content = await file.read()
    temp_path = "temp_invoice.xlsx"
    with open(temp_path, "wb") as f:
        f.write(content)
        
    try:
        try:
            df = pd.read_excel(temp_path, engine="openpyxl")
        except:
            try:
                df = pd.read_excel(temp_path, engine="xlrd")
            except:
                dfs = pd.read_html(temp_path)
                if not dfs: raise Exception("No tables found in HTML")
                df = dfs[0]
    except Exception as e:
        if os.path.exists(temp_path): os.remove(temp_path)
        raise HTTPException(400, f"Geçersiz Excel dosyası veya okunamayan format: {str(e)}")
        
    if os.path.exists(temp_path): os.remove(temp_path)
    
    try:
        extracted = []
        cols = df.columns.tolist()
        
        def normalize(s):
            return str(s).lower().replace('i̇', 'i').replace('ı', 'i').strip()

        unvan_col = next((c for c in cols if 'gönderici' in normalize(c) and 'unvan' in normalize(c)), None)
        if not unvan_col: unvan_col = next((c for c in cols if 'unvan' in normalize(c)), None)
            
        tutar_col = next((c for c in cols if 'dahil' in normalize(c) and 'tutar' in normalize(c)), None)
        if not tutar_col: tutar_col = next((c for c in cols if 'ödenecek' in normalize(c) or 'odenecek' in normalize(c)), None)
        if not tutar_col: tutar_col = next((c for c in cols if 'tutar' in normalize(c) or 'toplam' in normalize(c)), None)
            
        tarih_col = next((c for c in cols if 'belge' in normalize(c) and 'tar' in normalize(c)), None)
        if not tarih_col: tarih_col = next((c for c in cols if 'tarih' in normalize(c) or 'tarh' in normalize(c) or 'date' in normalize(c)), None)
        
        if not (unvan_col and tutar_col and tarih_col):
            unvan_col, tutar_col, tarih_col = 'Gönderici Unvan', 'vergiler dahil tutar', 'belge tarihi'

        for _, row in df.iterrows():
            try:
                unvan_raw = str(row[unvan_col]).strip()
                if unvan_raw == 'nan' or not unvan_raw: continue
                
                tutar_val = row[tutar_col]
                if isinstance(tutar_val, (int, float)):
                    tutar = float(tutar_val)
                else:
                    t_str = str(tutar_val).strip()
                    if ',' in t_str and '.' in t_str:
                        if t_str.rindex(',') > t_str.rindex('.'): # 1.234,56
                            t_str = t_str.replace('.', '').replace(',', '.')
                        else: # 1,234.56
                            t_str = t_str.replace(',', '')
                    elif ',' in t_str:
                        t_str = t_str.replace(',', '.')
                    tutar = float(t_str)
                    
                tarih_val = row[tarih_col]
                if isinstance(tarih_val, datetime) or isinstance(tarih_val, pd.Timestamp):
                    dt_str = tarih_val.strftime('%Y-%m-%d')
                else:
                    dt_str = pd.to_datetime(str(tarih_val).strip(), dayfirst=True).strftime('%Y-%m-%d')
                    
                extracted.append({'date': dt_str, 'unvan_raw': unvan_raw, 'tutar': tutar})
            except Exception as e: 
                print("Row skipped:", e)
                continue
        
        mappings = {m.pdf_name.lower(): m.supplier_id for m in db.query(Mapping).all()}
        all_suppliers = {s.name.lower(): s.id for s in db.query(Supplier).all()}
        
        unknown_names = set()
        mapped_data = []
        
        for item in extracted:
            unvan = item['unvan_raw'].strip()
            
            # 1. Check exact mapping database
            if unvan.lower() in mappings:
                item['supplier_id'] = mappings[unvan.lower()]
                mapped_data.append(item)
                continue
                
            # 2. Check simple case-insensitive fallback
            matched_sup_id = all_suppliers.get(unvan.lower())
            
            if matched_sup_id:
                m = Mapping(pdf_name=unvan, supplier_id=matched_sup_id)
                db.add(m)
                db.commit()
                mappings[unvan.lower()] = matched_sup_id
                item['supplier_id'] = matched_sup_id
                mapped_data.append(item)
                continue
                
            # 3. Not found anywhere
            unknown_names.add(unvan)
                
        suppliers = [{"id": s.id, "name": s.name, "is_manual": bool(s.is_manual_due_date)} for s in db.query(Supplier).all()]
        
        return {
            "success": True, 
            "unknown_names": list(unknown_names), 
            "extracted_data": extracted,
            "suppliers": suppliers
        }
    except Exception as e:
        import traceback
        err_msg = traceback.format_exc()
        raise HTTPException(500, f"Sunucu hatası: {str(e)}\n\nDetay:\n{err_msg}")

@app.post("/api/excel/commit")
async def commit_excel(payload: dict, db: Session = Depends(get_db)):
    new_mappings = payload.get("new_mappings", {})
    extracted_data = payload.get("extracted_data", [])
    
    for unvan, sup_id in new_mappings.items():
        if not db.query(Mapping).filter(Mapping.pdf_name == unvan).first():
            m = Mapping(pdf_name=unvan, supplier_id=int(sup_id))
            db.add(m)
    db.commit()
    
    mappings = {m.pdf_name.lower(): m.supplier_id for m in db.query(Mapping).all()}
    
    count = 0
    ts = datetime.now().strftime("%d.%m.%Y %H:%M:%S")
    for item in extracted_data:
        unvan = item['unvan_raw'].strip()
        sup_id = mappings.get(unvan.lower())
        if sup_id:
            d_val = datetime.strptime(item['date'], "%Y-%m-%d").date() if isinstance(item['date'], str) else item['date']
            due_val = datetime.strptime(item.get('due_date'), "%Y-%m-%d").date() if item.get('due_date') else None
            tx = Transaction(
                supplier_id=sup_id,
                transaction_type="Alım",
                amount=item['tutar'],
                transaction_date=d_val,
                due_date=due_val,
                timestamp=ts
            )
            db.add(tx)
            count += 1
            
    db.commit()
    sync_database_to_excel(db)
    return {"success": True, "count": count}

app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")
