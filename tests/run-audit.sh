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
# KISAYOL (2026-07-15, §80-I): Hetzner web konsolunda **iki nokta yazilamaz** -> ":" tusu ENTER
#   gibi davranip komutu IKIYE BOLUYOR. KANIT: `echo a:b` -> "a" + "b: command not found".
#   Yani `URL=https://test1...` konsola ELLE YAZILAMAZ. Bu yuzden hedefi ARGUMAN ile seciyoruz:
#       bash tests/run-audit.sh test1     -> CANLI (test1) denetlenir   [iki nokta YOK]
#       bash tests/run-audit.sh           -> test2 (varsayilan)
#   (Terfi sonrasi test1'de olcum ZORUNLU oldugu icin bu kisayol kalicidir.)
case "${1:-}" in
  test1) URL_HEDEF="https://test1.republique.tr" ;;
  test2) URL_HEDEF="https://test2.republique.tr" ;;
esac
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
  "$IMAJ" sh -c 'export NODE_PATH=$(npm root -g); [ -d "$NODE_PATH/playwright" ] || [ -d node_modules/playwright ] || npm i --no-audit --no-fund playwright@1.47.0; node ux-audit.js'
KOD=$?
echo
if [ "$KOD" -eq 0 ]; then
  echo "SONUC: TEMIZ (sorun yok)"
else
  echo "SONUC: SORUN VAR -> tests/report/ux-audit.json ve tests/report/*.png bak"
fi
exit $KOD
