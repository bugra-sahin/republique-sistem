#!/bin/sh
# Republique otomatik yedekleme
# Her gece ~03:00'te Postgres (menu/loglar/scans/audit) + erp.db (cari) yedegi alinir.
# Son 14 yedek saklanir. Yedekler "backups" adli Docker volume'unde durur.
mkdir -p /backups

do_backup() {
  TS=$(date +%Y%m%d_%H%M)
  pg_dump -h db -U republique republique > "/backups/db_${TS}.sql" 2>>/backups/backup.log && \
    echo "$(date) db yedegi alindi: db_${TS}.sql" >> /backups/backup.log || \
    echo "$(date) HATA: pg_dump basarisiz ${TS}" >> /backups/backup.log
  if [ -f /erpdata/erp.db ]; then
    cp /erpdata/erp.db "/backups/erp_${TS}.db" 2>>/backups/backup.log && \
      echo "$(date) erp yedegi alindi: erp_${TS}.db" >> /backups/backup.log
  fi
  # Son 14 db + 14 erp yedegini tut, eskilerini sil
  ls -1t /backups/db_*.sql 2>/dev/null | tail -n +15 | while read f; do rm -f "$f"; done
  ls -1t /backups/erp_*.db 2>/dev/null | tail -n +15 | while read f; do rm -f "$f"; done
}

# Konteyner baslayinca dogrulama icin hemen bir yedek al
do_backup

LAST=""
while true; do
  CUR_H=$(date +%H)
  DAY_H=$(date +%Y%m%d_%H)
  if [ "$CUR_H" = "03" ] && [ "$DAY_H" != "$LAST" ]; then
    do_backup
    LAST="$DAY_H"
  fi
  sleep 600
done
