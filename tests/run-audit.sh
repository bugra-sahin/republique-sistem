#!/usr/bin/env bash
# Republique - OTOMATIK UX DENETIMI calistirici.
#
# NEDEN BU DOSYA VAR (onemli, silme):
#   Hetzner web konsolu ':' , ';' ve '&&' karakterlerini BOZUYOR -> uzun docker komutunu
#   konsola ELLE yazmak imkansiz. Ayrica sunucuda npm/node YOK (her sey Docker icinde).
#   Cozum: komut repoda bu script'te dursun; konsolda sadece sunu yaz (iki nokta yok):
#       bash tests/run-audit.sh
#
# Playwright resmi imaji kullanilir -> sunucuya HICBIR SEY kurulmaz, host kirlenmez.
# CHAT=1 verilirse AI sohbet testi de kosar (GERCEK Anthropic cagrisi, 1 mesaj).
set -u
URL_HEDEF="${URL:-https://test2.republique.tr}"
MASA_HEDEF="${MASA:-b-9}"
CHAT_ACIK="${CHAT:-0}"
IMAJ="mcr.microsoft.com/playwright:v1.47.0-jammy"
DIZIN="$(cd "$(dirname "$0")" && pwd)"

echo "=== Republique UX Denetimi ==="
echo "Hedef : $URL_HEDEF   Masa: $MASA_HEDEF   Chat testi: $CHAT_ACIK"
echo "Imaj  : $IMAJ"
echo

docker run --rm --network host \
  -e "URL=$URL_HEDEF" -e "MASA=$MASA_HEDEF" -e "CHAT=$CHAT_ACIK" \
  -v "$DIZIN:/tests" -w /tests \
  "$IMAJ" node ux-audit.js
KOD=$?
echo
if [ "$KOD" -eq 0 ]; then
  echo "SONUC: TEMIZ (sorun yok)"
else
  echo "SONUC: SORUN VAR -> tests/report/ux-audit.json ve tests/report/*.png bak"
fi
exit $KOD
