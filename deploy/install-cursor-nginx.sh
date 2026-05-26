#!/usr/bin/env bash
set -euo pipefail

if ! command -v nginx >/dev/null 2>&1; then
  sudo apt-get update
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y nginx
fi

sudo install -o root -g root -m 0644 /tmp/cursor-nginx.conf /etc/nginx/conf.d/cursor-nginx.conf
sudo rm -f /etc/nginx/sites-enabled/default
sudo mkdir -p /opt/cursor-gateway /opt/cursor-direct-gateway

sudo sed -i 's/^CURSOR_GATEWAY_HOST=.*/CURSOR_GATEWAY_HOST=127.0.0.1/' /opt/cursor-gateway/cursor-gateway.env
if sudo grep -q '^CURSOR_GATEWAY_PORT=' /opt/cursor-gateway/cursor-gateway.env; then
  sudo sed -i 's/^CURSOR_GATEWAY_PORT=.*/CURSOR_GATEWAY_PORT=32125/' /opt/cursor-gateway/cursor-gateway.env
else
  echo 'CURSOR_GATEWAY_PORT=32125' | sudo tee -a /opt/cursor-gateway/cursor-gateway.env >/dev/null
fi
sudo sed -i 's/^CURSOR_DIRECT_HOST=.*/CURSOR_DIRECT_HOST=127.0.0.1/' /opt/cursor-direct-gateway/cursor-direct-gateway.env
if sudo grep -q '^CURSOR_DIRECT_PORT=' /opt/cursor-direct-gateway/cursor-direct-gateway.env; then
  sudo sed -i 's/^CURSOR_DIRECT_PORT=.*/CURSOR_DIRECT_PORT=32126/' /opt/cursor-direct-gateway/cursor-direct-gateway.env
else
  echo 'CURSOR_DIRECT_PORT=32126' | sudo tee -a /opt/cursor-direct-gateway/cursor-direct-gateway.env >/dev/null
fi
admin_password="$(sudo awk -F= '/^CURSOR_GATEWAY_ADMIN_PASSWORD=/{print substr($0,index($0,$2)); exit}' /opt/cursor-gateway/cursor-gateway.env)"
if [[ -n "$admin_password" ]]; then
  if sudo grep -q '^CURSOR_DIRECT_ADMIN_PASSWORD=' /opt/cursor-direct-gateway/cursor-direct-gateway.env; then
    sudo sed -i "s|^CURSOR_DIRECT_ADMIN_PASSWORD=.*|CURSOR_DIRECT_ADMIN_PASSWORD=$admin_password|" /opt/cursor-direct-gateway/cursor-direct-gateway.env
  else
    echo "CURSOR_DIRECT_ADMIN_PASSWORD=$admin_password" | sudo tee -a /opt/cursor-direct-gateway/cursor-direct-gateway.env >/dev/null
  fi
fi

sudo systemctl restart cursor-gateway
sudo systemctl restart cursor-direct-gateway
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl restart nginx

systemctl is-active nginx
