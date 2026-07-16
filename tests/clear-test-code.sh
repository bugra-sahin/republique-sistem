#!/usr/bin/env bash
# CANLI (test1) META_TEST_EVENT_CODE'u BOSALTIR -> gercek eventler OPTIMIZASYONA gider.
# Bugra 2026-07-16'da ACIK ONAY verdi (§88).
#
# NEDEN AYRI DOSYA (set-test-code.sh yetmiyor):
#   1) set-test-code.sh BOS argumani REDDEDIYOR -> `if [ -z "$KOD" ]; then ... exit 1; fi`
#   2) varsayilan hedefi STAGING (.env) -> canliyi degistirmez.
# GUVENLIK: yedek alir · SADECE tek satiri degistirir · once/sonra OLCUP raporlar.
# capi-sender.js `if (process.env.META_TEST_EVENT_CODE)` kullanir -> BOS string = kapali (dogrulandi).
#
# KULLANIM: sh /opt/republique/tests/clear-test-code.sh
# SONRASINDA ZORUNLU: cd /opt/republique && docker compose up -d   (env yeniden okunsun)
set -euo pipefail
ENVF="${ENVF:-/opt/republique/.env}"
[ -f "$ENVF" ] || { echo "HATA: $ENVF yok"; exit 1; }

YEDEK="$ENVF.yedek.$(date +%s)"
cp "$ENVF" "$YEDEK"
echo "Yedek alindi: $YEDEK"

ONCE=$(grep -c '^META_TEST_EVENT_CODE=..*' "$ENVF" || true)
echo "ONCE  (1=DOLU, 0=bos/yok): $ONCE"

if grep -q '^META_TEST_EVENT_CODE=' "$ENVF"; then
  sed -i 's|^META_TEST_EVENT_CODE=.*|META_TEST_EVENT_CODE=|' "$ENVF"
else
  echo "NOT: META_TEST_EVENT_CODE satiri hic YOK -> zaten bos sayilir."
fi

SONRA=$(grep -c '^META_TEST_EVENT_CODE=..*' "$ENVF" || true)
echo "SONRA (1=DOLU, 0=bos/yok): $SONRA"

if [ "$SONRA" = "0" ]; then
  echo "OK - test kodu BOSALDI."
  echo ">>> SIMDI: cd /opt/republique && docker compose up -d"
  echo ">>> Gerekirse geri al: cp $YEDEK $ENVF"
else
  echo "SORUN - hala DOLU. Yedek: $YEDEK"
  exit 1
fi
