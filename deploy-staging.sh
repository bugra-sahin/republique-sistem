#!/bin/sh
# test2 (staging) uzerinde guncel main kodunu test et. Prod'a DOKUNMAZ.
cd /opt/republique-staging || exit 1
git fetch origin
git reset --hard origin/main
docker compose -p staging -f docker-compose.staging.yml up -d --build
echo "test2 guncellendi: https://test2.republique.tr"
