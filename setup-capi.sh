#!/usr/bin/env bash
# CAPI ayar betigi: pixel id + gizli token'i sunucudaki .env'e yazar, uygulamayi yeniden baslatir.
# Kullanim (sunucu konsolunda): bash /opt/republique/setup-capi.sh
set -euo pipefail
ENV=/opt/republique/.env
touch "$ENV"

# Eski META satirlarini temizle (POSTGRES_PASSWORD gibi digerlerini KORU)
grep -v '^META_' "$ENV" > "$ENV.tmp" 2>/dev/null || true
mv "$ENV.tmp" "$ENV"

# Pixel ID (gizli degil)
echo "META_PIXEL_ID=858472356496034" >> "$ENV"

echo ""
echo ">>> CAPI erisim jetonunu simdi YAPISTIR ve Enter'a bas (ekranda gorunmez):"
read -rs TOK
echo "META_CAPI_TOKEN=$TOK" >> "$ENV"
unset TOK

echo ""
echo ">>> Meta 'Test Events' kodu (Events Manager > Test Events'te gorunur)."
echo ">>> TEST icin kodu yapistir; CANLI icin bos birakip Enter'a bas:"
read -r TEC
if [ -n "$TEC" ]; then echo "META_TEST_EVENT_CODE=$TEC" >> "$ENV"; fi

cd /opt/republique
docker compose up -d
echo ""
echo "TAMAM: CAPI ayarlandi ve uygulama yeniden baslatildi."
