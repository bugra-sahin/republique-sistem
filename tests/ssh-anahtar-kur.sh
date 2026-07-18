#!/bin/sh
# Republique - Claude Code SSH anahtarini kurar.
# Sebep: Hetzner web konsolu >, _ ve tirnak karakterlerini yazamiyor.
#        Bu dosya o karakterleri repo uzerinden tasir.
# Calistirma: sh /opt/republique/tests/ssh-anahtar-kur.sh
# Guvenli: sadece /root/.ssh altina yazar, hicbir sey silmez, mukerrer eklemez.

KDIR=/root/.ssh
KFILE=$KDIR/authorized_keys
KBLOB=AAAAC3NzaC1lZDI1NTE5AAAAIB9wdm8VKsrVGdIQfJYW/OZEHfO1QJZG5MN7Ur48SXLj
KEY="ssh-ed25519 $KBLOB claude-code-republique"

mkdir -p "$KDIR"
chmod 700 "$KDIR"
touch "$KFILE"
chmod 600 "$KFILE"

if grep -qF "$KBLOB" "$KFILE"; then
  echo "SONUC: ZATEN VAR - tekrar eklenmedi."
else
  echo "$KEY" >> "$KFILE"
  echo "SONUC: EKLENDI."
fi

echo "--- klasor icerigi (onceki denemelerin artiklari gorunur) ---"
ls -a "$KDIR"

echo "--- authorized_keys satir sayisi ---"
wc -l < "$KFILE"

echo "--- PARMAK IZI (beklenen: SHA256:JVKkAHXNR5jHTZdOp3VfV63Uz1He3s/m07rlNWnYUrk) ---"
ssh-keygen -lf "$KFILE"
