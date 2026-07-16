#!/usr/bin/env bash
# Republique - .env icindeki META_TEST_EVENT_CODE degerini gunceller (CAPI Test Events kodu).
#
# NEDEN BU SCRIPT VAR (§83): Hetzner web konsoluna bu degeri ELLE yazmak IMKANSIZ.
#   Konsol karakter tuzaklari: alt cizgi -> tire olur, buyuktur isareti -> nokta olur,
#   cift tirnak -> tek tirnak olur, iki nokta ENTER gibi davranir, CAPS LOCK TERS.
#   DAHASI: ekranda DOGRU gorunse bile kabuga BOZUK gidiyor. OLCULDU:
#     grep -c TEST80259 .env  -> 0     (oysa dosyada META_TEST_EVENT_CODE=TEST80259 YAZIYOR)
#     grep -c TEST      .env  -> 1
#   Yani "zoom ile satiri okudum, dogruydu" YETMIYOR. Konsola deger YAZDIRMA.
# COZUM: deger script icinde (repodan gelir). Konsolda sadece sunu yaz (ozel karakter YOK):
#     bash tests/set-test-code.sh TEST73493
#
# GUVENLIK: Bu, Meta "Test Events" kodudur. DOLU oldugu surece capi-sender.js payloada
#   test_event_code ekler -> eventler Test Events e duser, GERCEK optimizasyonu KIRLETMEZ.
#   BOSALTMAK = gercek event gondermek demektir. Canliya alirken BILEREK bosaltilir.
set -euo pipefail

ENVF="${ENVF:-/opt/republique-staging/.env}"
KOD="${1:-}"
# §86: KONSOL CAPS'I TERS CEVIRDIGI ICIN gelen argumani BUYUK HARFE cevir.
# OLCULDU: "bash tests/set-test-code.sh TEST97623" yazdim -> .env'e "test97623" (KUCUK) yazildi.
# Meta test kodu BUYUK/KUCUK HARFE DUYARLIDIR -> kucuk yazilirsa Test Events'te ASLA gorunmez.
# Artik konsolda kucuk de yazsan buyuk de yazsan DOGRU kod yazilir.
KOD="$(printf '%s' "${KOD}" | tr 'a-z' 'A-Z')"

if [ -z "$KOD" ]; then
  echo "KULLANIM: bash tests/set-test-code.sh TEST73493"
  echo "         (kodu Events Manager > Olaylari test edin ekranindan al)"
  exit 1
fi

if [ ! -f "$ENVF" ]; then echo "HATA: $ENVF yok"; exit 1; fi

YEDEK="$ENVF.yedek.$(date +%s)"
cp "$ENVF" "$YEDEK"
echo "Yedek alindi: $YEDEK"

if grep -q "^META_TEST_EVENT_CODE=" "$ENVF"; then
  sed -i "s|^META_TEST_EVENT_CODE=.*|META_TEST_EVENT_CODE=$KOD|" "$ENVF"
  echo "Mevcut satir guncellendi."
else
  printf "\nMETA_TEST_EVENT_CODE=%s\n" "$KOD" >> "$ENVF"
  echo "Satir eklendi."
fi

echo "--- SONUC (dogrulama) ---"
grep "^META_TEST_EVENT_CODE=" "$ENVF"
echo "--- dosya bozulmadi mi (satir sayisi yedek vs yeni) ---"
echo "yedek satir: $(wc -l < "$YEDEK")   yeni satir: $(wc -l < "$ENVF")"
echo ""
echo "SIRADAKI: docker compose -f docker-compose.staging.yml -p staging up -d --build"
echo "          (env degisikligi konteyner yeniden olusturulmadan ETKILI OLMAZ)"
