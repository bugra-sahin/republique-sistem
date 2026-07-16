#!/usr/bin/env bash
# Safari/WebKit fbc zinciri testini calistirir (fbc-safari.js).
# NEDEN BU DOSYA VAR: konsolda ':' ve uzun satir yazilamaz (bkz run-audit.sh basligi).
#   bash tests/run-fbc-safari.sh test1   -> CANLI
#   bash tests/run-fbc-safari.sh         -> test2 (varsayilan)
set -u
DIZIN="$(cd "$(dirname "$0")" && pwd)"
case "${1:-}" in
  test1) HEDEF="https://test1.republique.tr" ;;
  test2) HEDEF="https://test2.republique.tr" ;;
  *)     HEDEF="https://test2.republique.tr" ;;
esac
IMAJ="mcr.microsoft.com/playwright:v1.47.0-jammy"
echo "=== Safari/WebKit fbc testi === hedef: $HEDEF"
docker run --rm --network host \
  -e "HEDEF=$HEDEF" \
  -v "$DIZIN:/tests" -w /tests \
  "$IMAJ" sh -c 'export NODE_PATH=$(npm root -g); [ -d "$NODE_PATH/playwright" ] || [ -d node_modules/playwright ] || npm i --no-audit --no-fund playwright@1.47.0; node fbc-safari.js'
