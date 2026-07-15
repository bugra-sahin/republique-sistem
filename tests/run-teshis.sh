#!/usr/bin/env bash
# Republique - WEBKIT ai-kart TESHIS calistirici (TEK SEFERLIK OLCUM).
#
# NEDEN BU DOSYA VAR (run-audit.sh ile ayni sebep):
#   Hetzner web konsolu ":" ";" "|" ve "&&" karakterlerini BOZUYOR -> uzun docker komutu
#   konsola ELLE yazilamaz. Cozum: komut burada dursun, konsolda sadece sunu yaz:
#       bash tests/run-teshis.sh
#
# Bu script URETIM KODUNU DEGISTIRMEZ, sadece olcer ve ekrana tablo basar.
set -u
URL_HEDEF="${URL:-https://test2.republique.tr}"
MASA_HEDEF="${MASA:-b-9}"
URUN_HEDEF="${URUN:-Limonata}"
IMAJ="mcr.microsoft.com/playwright:v1.47.0-jammy"
DIZIN="$(cd "$(dirname "$0")" && pwd)"

echo "=== Republique WEBKIT ai-kart TESHIS ==="
echo "Hedef: $URL_HEDEF   Masa: $MASA_HEDEF   Urun: $URUN_HEDEF"
echo "Imaj : $IMAJ"
echo

docker run --rm --network host -e "URL=$URL_HEDEF" -e "MASA=$MASA_HEDEF" -e "URUN=$URUN_HEDEF" -v "$DIZIN:/tests" -w /tests "$IMAJ" sh -c 'export NODE_PATH=$(npm root -g); [ -d "$NODE_PATH/playwright" ] || [ -d node_modules/playwright ] || npm i --no-audit --no-fund playwright@1.47.0; node webkit-teshis.js'
