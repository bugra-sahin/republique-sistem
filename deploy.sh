#!/usr/bin/env bash
set -euo pipefail

# Caddy kullanacagimiz icin, port cakisini onlemek amaciyla mevcut Nginx'i durduruyoruz
systemctl stop nginx || true
systemctl disable nginx || true

cd /opt/republique
# Depoyu her durumda en guncel hale zorla (ff-only takilmalarini onler, kendini iyilestirir)
git fetch origin
git reset --hard origin/main
docker compose up -d --build
