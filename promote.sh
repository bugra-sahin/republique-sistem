#!/bin/sh
# Gece 03:00 otomatik terfi: test2 (staging) SAGLIKLIYSA test1 (prod)'a al.
# Once versiyon yedegi (git tag) alinir -> rollback mumkun. DB yedegi ayrica backup servisiyle alinir.
LOG=/var/log/republique-promote.log
echo "=== $(date) === terfi kontrolu basladi" >> "$LOG"

# 1) Staging saglik kontrolu (test2). Saglıksızsa terfi ETME (prod korunur).
if ! curl -sf https://test2.republique.tr/health >/dev/null 2>&1; then
  echo "$(date) STAGING SAGLIKSIZ -> terfi IPTAL, prod aynen kaliyor" >> "$LOG"
  exit 0
fi
echo "$(date) staging saglikli" >> "$LOG"

# 2) Prod versiyon yedegi (rollback icin git tag)
cd /opt/republique || exit 1
TAG="prod-$(date +%Y%m%d-%H%M)"
git tag "$TAG" >> "$LOG" 2>&1
echo "$(date) prod yedek tag: $TAG" >> "$LOG"

# 3) Prod'u guncel main ile kur (test1'e terfi)
git fetch origin >> "$LOG" 2>&1
git reset --hard origin/main >> "$LOG" 2>&1
docker compose up -d --build >> "$LOG" 2>&1
echo "$(date) TERFI TAMAM (test1 guncellendi)" >> "$LOG"

# 4) Staging'i GELISTIRME DALINA esitle (main'e DEGIL!) -> test2 uzerindeki devam eden isler
#    gece SILINMESIN. test2 hep dali (bugra-sahin-patch-1 = son isler) gosterir, geri gitmez.
STAGING_BRANCH="bugra-sahin-patch-1"
cd /opt/republique-staging || exit 0
git fetch origin >> "$LOG" 2>&1
git reset --hard origin/$STAGING_BRANCH >> "$LOG" 2>&1
docker compose -p staging -f docker-compose.staging.yml up -d --build >> "$LOG" 2>&1
echo "$(date) staging dala ($STAGING_BRANCH) esitlendi" >> "$LOG"

# Eski yedek tag'leri sinirla (son 30 tut)
cd /opt/republique && git tag | grep '^prod-' | sort | head -n -30 | while read t; do git tag -d "$t" >/dev/null 2>&1; done
echo "$(date) === terfi bitti ===" >> "$LOG"
