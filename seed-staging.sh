#!/bin/sh
# Prod verisini test2 (staging)'e KOPYALAR (menu/loglar/scans/audit + cari erp.db).
# Prod'a DOKUNMAZ (sadece okur). Istedigin zaman calistirilabilir: bash seed-staging.sh
set -e
echo ">> test2 veri kopyalama basladi..."

# 1) Postgres: prod'u dump et, staging'e temiz yukle
docker exec republique-db-1 pg_dump -U republique --clean --if-exists republique > /tmp/prod_seed.sql
docker exec -i staging-db-staging-1 psql -U republique -d republique < /tmp/prod_seed.sql > /tmp/seed_pg.log 2>&1 || true
rm -f /tmp/prod_seed.sql
echo ">> Postgres verisi kopyalandi."

# 2) ERP cari (erp.db) kopyala
if docker cp republique-erp-1:/data/erp.db /tmp/erp_seed.db 2>/dev/null; then
  docker cp /tmp/erp_seed.db staging-erp-staging-1:/data/erp.db
  rm -f /tmp/erp_seed.db
  echo ">> ERP cari verisi kopyalandi."
else
  echo ">> UYARI: erp.db bulunamadi, ERP verisi atlandi."
fi

# 3) Staging app+erp yeniden baslat (yeni veriyi gorsunler)
docker restart staging-app-staging-1 staging-erp-staging-1 >/dev/null
echo ">> test2 verileri prod ile guncellendi. https://test2.republique.tr"
