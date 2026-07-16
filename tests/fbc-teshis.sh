#!/bin/sh
# fbc TESHISI: fbclid zinciri nerede kopuyor? (Konsola _ yazilamadigi icin repo scripti.)
# SADECE OKUR, hicbir sey degistirmez. fbclid/fbc DEGERLERI basilmaz, sadece VAR/YOK.
D=staging-db-staging-1
P="docker exec $D psql -U republique -d republique -c"

echo "=== 1) KOPUK HALKA SAYIMI (asil kanit) ==="
Q1="SELECT count(*) AS toplam, count(*) FILTER (WHERE fbclid IS NOT NULL AND fbclid <> '') AS fbclid_olan, count(*) FILTER (WHERE fbc IS NOT NULL AND fbc <> '') AS fbc_olan, count(*) FILTER (WHERE fbclid IS NOT NULL AND fbclid <> '' AND (fbc IS NULL OR fbc = '')) AS kopuk FROM scans;"
$P "$Q1"

echo "=== 2) SON 8 REKLAM TARAMASI ==="
Q2="SELECT rep_id, masa, to_char(timestamp,'DD.MM HH24:MI') AS zaman, CASE WHEN fbclid IS NULL OR fbclid='' THEN 'YOK' ELSE 'VAR' END AS fbclid, CASE WHEN fbc IS NULL OR fbc='' THEN 'YOK <<<' ELSE 'VAR' END AS fbc, CASE WHEN fbp IS NULL OR fbp='' THEN 'YOK' ELSE 'VAR' END AS fbp FROM scans WHERE fbclid IS NOT NULL AND fbclid <> '' ORDER BY timestamp DESC LIMIT 8;"
$P "$Q2"

echo "=== 3) KODDA fbclid -> fbc DONUSUMU VAR MI? (Meta formati: fb.1.<ms>.<fbclid>) ==="
N=$(grep -rn "fb\.1\." --include=*.js /opt/republique-staging/public /opt/republique-staging/src 2>/dev/null | wc -l)
echo "kodda fb.1. gecen satir sayisi -> $N"
if [ "$N" -eq 0 ]; then echo ">>> KANIT: DONUSUM HIC YOK. fbc SADECE Meta Pixel cerezinden okunuyor."; fi
echo ""
echo "--- app.js fbc kaynagi ---"
grep -n "_fbc" /opt/republique-staging/public/js/app.js || echo "bulunamadi"
