#!/bin/sh
# PROD (test1) fbc TESHISI - §87-D-3'teki tek acik halkayi kapatir.
# NEDEN SCRIPT: Hetzner konsolunda '_' -> '-' olur, ':' ENTER gibi davranir, '{' yazilamaz,
#   uzun satirlarda KARAKTER DUSER. Yani bu sorgu konsola ELLE yazilamaz. (§82-I, §87-G)
# SADECE OKUR. Hicbir sey degistirmez. Sirri EKRANA BASMAZ (fbc/fbclid degerleri degil VAR/YOK).
D=republique-db-1
P="docker exec $D psql -U republique -d republique -t -c"

echo "=== 1) KOPUK HALKA SAYIMI (prod) ==="
$P "SELECT count(*) AS toplam, count(*) FILTER (WHERE fbclid IS NOT NULL AND fbclid <> '') AS fbclid_olan, count(*) FILTER (WHERE fbc IS NOT NULL AND fbc <> '') AS fbc_olan, count(*) FILTER (WHERE fbclid IS NOT NULL AND fbclid <> '' AND (fbc IS NULL OR fbc = '')) AS kopuk FROM scans;"

echo ""
echo "=== 2) SON 8 REKLAM TARAMASI (prod) ==="
$P "SELECT masa, to_char(timestamp,'DD.MM HH24:MI') AS zaman, CASE WHEN fbclid IS NULL OR fbclid='' THEN 'YOK' ELSE 'VAR' END AS fbclid, CASE WHEN fbc IS NULL OR fbc='' THEN 'YOK <<<' ELSE 'VAR' END AS fbc, CASE WHEN fbc LIKE 'fb.1.%' THEN 'FORMAT-OK' ELSE '-' END AS format FROM scans WHERE fbclid IS NOT NULL AND fbclid <> '' ORDER BY timestamp DESC LIMIT 8;"

echo ""
echo "=== 3) OZET ==="
$P "SELECT CASE WHEN count(*)=0 THEN 'REKLAM TARAMASI YOK' WHEN count(*) FILTER (WHERE fbc IS NULL OR fbc='')=0 THEN 'GECTI - fbclidli taramalarin HEPSINDE fbc VAR' ELSE 'SORUN - ' || count(*) FILTER (WHERE fbc IS NULL OR fbc='') || ' taramada fbc YOK' END FROM scans WHERE fbclid IS NOT NULL AND fbclid <> '' AND timestamp > now() - interval '2 hours';"

echo ""
echo "=== 4) SON 10 TARAMA - FBCLID FARKETMEKSIZIN (masa/cihaz/fbclid) ==="
$P "SELECT masa, cihaz, CASE WHEN fbclid IS NULL OR fbclid='' THEN 'fbclid-YOK' ELSE 'fbclid=' || left(fbclid,12) END AS reklam, to_char(timestamp,'DD.MM HH24:MI') AS zaman FROM scans ORDER BY timestamp DESC LIMIT 10;"

echo ""
echo "=== 5) SON 10 MOBIL TARAMA (telefon testi buradan gorunur) ==="
$P "SELECT masa, CASE WHEN fbclid IS NULL OR fbclid='' THEN 'fbclid-YOK' ELSE 'fbclid-VAR' END AS reklam, CASE WHEN fbc IS NULL OR fbc='' THEN 'fbc-YOK' ELSE 'fbc-VAR' END AS fbc, to_char(timestamp,'DD.MM HH24:MI') AS zaman FROM scans WHERE cihaz='Mobil' ORDER BY timestamp DESC LIMIT 10;"
