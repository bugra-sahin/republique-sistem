#!/usr/bin/env bash
# §91: .env'e SITE_HOST (ve istege bagli MASA_URL_BICIMI) yazar.
# NEDEN SCRIPT: Hetzner konsolunda '_' -> '-' olur; 'SITE_HOST=' ELLE YAZILAMAZ. (§82-I)
# NEDEN GEREKLI: capi-sender.js event_source_url'i SITE_HOST'tan uretir. Yoksa varsayilan
#   'test2.republique.tr' kalir -> CANLI eventler event_source_url olarak TEST2'yi gosterir = YANLIS VERI.
#
# KULLANIM:
#   sh tests/set-site-host.sh test1.republique.tr          -> /?masa=b-9 bicimi (varsayilan)
#   sh tests/set-site-host.sh republique.tr path           -> /menu/b-9 bicimi (GECIS GUNU)
# SONRASINDA ZORUNLU: cd /opt/republique && docker compose up -d
set -euo pipefail
ENVF="${ENVF:-/opt/republique/.env}"
HOSTV="${1:-}"
BICIM="${2:-query}"
[ -n "$HOSTV" ] || { echo 'KULLANIM: sh tests/set-site-host.sh test1.republique.tr [query|path]'; exit 1; }
[ -f "$ENVF" ] || { echo "HATA: $ENVF yok"; exit 1; }

YEDEK="$ENVF.yedek.$(date +%s)"
cp "$ENVF" "$YEDEK"
echo "Yedek alindi: $YEDEK"

ekle_veya_guncelle() {
  ANAHTAR="$1"; DEGER="$2"
  if grep -q "^${ANAHTAR}=" "$ENVF"; then
    sed -i "s|^${ANAHTAR}=.*|${ANAHTAR}=${DEGER}|" "$ENVF"
    echo "guncellendi: ${ANAHTAR}=${DEGER}"
  else
    printf '%s=%s\n' "$ANAHTAR" "$DEGER" >> "$ENVF"
    echo "eklendi: ${ANAHTAR}=${DEGER}"
  fi
}

ekle_veya_guncelle SITE_HOST "$HOSTV"
ekle_veya_guncelle MASA_URL_BICIMI "$BICIM"

echo ''
echo '=== DOGRULAMA (1 = var) ==='
echo -n 'SITE_HOST      : '; grep -c "^SITE_HOST=..*" "$ENVF" || true
echo -n 'MASA_URL_BICIMI: '; grep -c "^MASA_URL_BICIMI=..*" "$ENVF" || true
echo ''
echo '>>> SIMDI: cd /opt/republique && docker compose up -d'
echo ">>> Geri al: cp $YEDEK $ENVF"
