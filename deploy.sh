#!/usr/bin/env bash
set -euo pipefail

# Caddy kullanacagimiz icin, port cakisini onlemek amaciyla mevcut Nginx'i durduruyoruz
systemctl stop nginx || true
systemctl disable nginx || true

cd /opt/republique
git pull --ff-only
docker compose up -d --build
