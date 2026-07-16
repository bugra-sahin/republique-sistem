#!/bin/sh
# CAPI ortam degiskeni TESHISI. Konsola _ yazilamadigi icin repo scripti olarak kosulur.
# GUVENLIK: erisim anahtari EKRANA BASILMAZ, sadece "DOLU/BOS" bilgisi verilir.
K=staging-app-staging-1
echo "=== 1) KONTEYNERDE META DEGISKENLERI (degerler maskeli) ==="
docker exec $K env | grep -i "^META" | sed -E "s/=(.*)$/ -> [DOLU, uzunluk=\\1]/" | sed -E "s/uzunluk=(.)(.*)$/uzunluk=GIZLI/" || echo ">>> HIC META DEGISKENI YOK"
echo ""
echo "=== 2) TEST EVENT CODE (degeri gorunmeli, sir degil) ==="
D=$(docker exec $K printenv META_TEST_EVENT_CODE 2>/dev/null)
if [ -z "$D" ]; then echo ">>> BOS/YOK  --- EVENTLER TEST EVENTS YERINE GERCEK VERIYE GIDIYOR OLABILIR!"; else echo ">>> VAR: $D"; fi
echo ""
echo "=== 3) PIXEL / DATASET ID (Test Events ekraniyla AYNI olmali) ==="
docker exec $K printenv META_PIXEL_ID 2>/dev/null || echo ">>> META_PIXEL_ID YOK"
docker exec $K printenv META_DATASET_ID 2>/dev/null || echo ">>> META_DATASET_ID YOK"
echo ""
echo "=== 4) .env DOSYASINDA HANGI ISIMLER VAR (degerler yok) ==="
grep -oE "^[A-Za-z_]+" /opt/republique-staging/.env | grep -i meta || echo ">>> .env icinde META yok"
echo ""
echo "=== 5) capi-sender.js test kodu ekliyor mu ==="
grep -n "test.event.code" /opt/republique-staging/src/capi-sender.js || echo ">>> KODDA test_event_code YOK"
