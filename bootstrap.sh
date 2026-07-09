#!/usr/bin/env bash
# Republique sunucusunu depoya baglar + otomatik dagitim kurar. Tek seferlik calisir.
set -euo pipefail
REPO="https://github.com/bugra-sahin/republique-sistem.git"
DIR="/opt/republique"

if [ ! -d "$DIR/.git" ]; then git clone "$REPO" "$DIR"; else git -C "$DIR" pull --ff-only; fi

# Sirlar (repoya girmez): DB parolasi yoksa uret
if [ ! -f "$DIR/.env" ]; then
  echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" > "$DIR/.env"
fi

# nginx ters vekil: 80 -> uygulama 3000
cat > /etc/nginx/sites-available/republique <<'NG'
server {
  listen 80 default_server;
  listen [::]:80 default_server;
  server_name _;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
NG
ln -sf /etc/nginx/sites-available/republique /etc/nginx/sites-enabled/republique
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# Otomatik dagitim: her 2 dakikada git pull + docker compose
cat > /etc/systemd/system/republique-deploy.service <<'SVC'
[Unit]
Description=Republique otomatik dagitim
After=network-online.target docker.service
[Service]
Type=oneshot
ExecStart=/opt/republique/deploy.sh
SVC
cat > /etc/systemd/system/republique-deploy.timer <<'TMR'
[Unit]
Description=Republique otomatik dagitim zamanlayici
[Timer]
OnBootSec=1min
OnUnitActiveSec=2min
[Install]
WantedBy=timers.target
TMR

chmod +x "$DIR/deploy.sh"
systemctl daemon-reload
systemctl enable --now republique-deploy.timer

# Ilk dagitim
bash "$DIR/deploy.sh"
echo "BOOTSTRAP_DONE"
