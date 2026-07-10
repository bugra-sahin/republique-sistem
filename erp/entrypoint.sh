#!/bin/sh
set -e
mkdir -p /data
# DB volume'de kalici. Ilk acilista bos olur; SQLAlchemy create_all semayi otomatik kurar.
# Bugra'nin GERCEK verisi sonra OZEL kanaldan yuklenecek (public repoya finansal veri konmaz).
export ERP_DB_PATH=/data/erp.db
export ERP_XLSX_PATH=/data/Mini_ERP_Veriler.xlsx
exec uvicorn backend.main:app --host 0.0.0.0 --port 8000
