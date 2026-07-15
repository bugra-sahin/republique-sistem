#!/usr/bin/env bash
# Republique - CANLI (test1) otomatik dagitim. republique-deploy.timer ~2 DAKIKADA BIR kosar.
#
# ===================== §81 KRITIK CANLI DUZELTMESI =====================
# SORUN: bu script her tikte KOSULSUZ `docker compose up -d --build` calistiriyordu.
# OLCUM (journalctl -u republique-deploy): kodda DEGISIKLIK OLMASA BILE her tikte
#     Container republique-app-1 Recreate   (00:23:00)
#     Container republique-app-1 Recreated
#     Container republique-app-1 Starting
#     Container republique-app-1 Started    (00:23:11)
#   = **~11 SANIYE kesinti**, ve timer **2 dakikada bir** kosuyor.
#   YANI CANLI SITE SUREKLI olarak her 2 dakikada ~11 saniye **502 Bad Gateway** veriyordu
#   (~%9 kesinti). GERCEK MISAFIR bunu "sayfa acilmiyor" diye yasiyordu.
#   (Denetimde gorulen 502 yagmurunun sebebi de buydu; denetim sadece GORUNUR yapti.)
# SEBEP: `--build` her tikte imaji yeniden uretiyor; imaj kimligi degisince compose
#   konteyneri RECREATE ediyor. Oysa yeni commit yoksa dagitilacak bir sey de YOKTUR.
# COZUM: commit DEGISMEDIYSE HICBIR SEY YAPMA (build YOK, restart YOK, canliya dokunma).
# =======================================================================
set -euo pipefail

# NOT: bu script calisirken `git reset --hard` KENDI DOSYASINI degistirebilir.
# Govdeyi fonksiyona alinca bash dosyanin TAMAMINI once ayristirir -> dosya
# calisma ortasinda degisse bile yarim/karisik calisma riski kalmaz.
main() {
  # Caddy kullanacagimiz icin, port cakisini onlemek amaciyla mevcut Nginx-i durduruyoruz
  systemctl stop nginx || true
  systemctl disable nginx || true

  cd /opt/republique
  git fetch origin

  local YEREL UZAK
  YEREL="$(git rev-parse HEAD)"
  UZAK="$(git rev-parse origin/main)"

  if [ "$YEREL" = "$UZAK" ]; then
    echo "Degisiklik yok ($YEREL) -> build/restart YAPILMADI. Canli konteynere DOKUNULMADI."
    exit 0
  fi

  echo "Yeni surum: $YEREL -> $UZAK  ... dagitiliyor"
  # Depoyu en guncel hale zorla (ff-only takilmalarini onler, kendini iyilestirir)
  git reset --hard origin/main
  docker compose up -d --build
  echo "Dagitim tamam: $UZAK"
}
main "$@"
