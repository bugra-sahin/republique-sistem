#!/usr/bin/env bash
set -euo pipefail
cd /opt/republique
git pull --ff-only
docker compose up -d --build
