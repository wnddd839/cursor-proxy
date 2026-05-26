#!/usr/bin/env bash
set -euo pipefail

sudo mkdir -p /opt/cursor-direct-gateway
sudo install -o ubuntu -g ubuntu -m 0644 /tmp/cursor-direct-gateway.mjs /opt/cursor-direct-gateway/cursor-direct-gateway.mjs
sudo install -o root -g root -m 0644 /tmp/cursor-direct-gateway.service /etc/systemd/system/cursor-direct-gateway.service

key="$(sudo awk -F= '/^CURSOR_GATEWAY_API_KEY=/{print substr($0,index($0,$2)); exit}' /opt/cursor-gateway/cursor-gateway.env)"
if [[ -z "$key" ]]; then
  echo "CURSOR_GATEWAY_API_KEY not found in /opt/cursor-gateway/cursor-gateway.env" >&2
  exit 1
fi
admin_password="$(sudo awk -F= '/^CURSOR_GATEWAY_ADMIN_PASSWORD=/{print substr($0,index($0,$2)); exit}' /opt/cursor-gateway/cursor-gateway.env)"
if [[ -z "$admin_password" ]]; then
  admin_password="$key"
fi

sudo tee /opt/cursor-direct-gateway/cursor-direct-gateway.env >/dev/null <<EOF
CURSOR_DIRECT_HOST=127.0.0.1
CURSOR_DIRECT_PORT=32126
CURSOR_DIRECT_REQUIRE_API_KEY=true
CURSOR_DIRECT_AUTH_PATH=/home/ubuntu/.config/cursor/auth.json
CURSOR_DIRECT_API_BASE_URL=https://api2.cursor.sh
CURSOR_DIRECT_AGENT_HOST=agentn.api5.cursor.sh
CURSOR_DIRECT_CLIENT_VERSION=cli-2026.05.24-dda726e
CURSOR_DIRECT_IDLE_MS=900
CURSOR_DIRECT_TIMEOUT_MS=60000
CURSOR_DIRECT_API_KEY=$key
CURSOR_DIRECT_ADMIN_PASSWORD=$admin_password
EOF

sudo chown ubuntu:ubuntu /opt/cursor-direct-gateway/cursor-direct-gateway.env
sudo chmod 600 /opt/cursor-direct-gateway/cursor-direct-gateway.env
sudo systemctl daemon-reload
sudo systemctl restart cursor-direct-gateway
systemctl is-active cursor-direct-gateway
