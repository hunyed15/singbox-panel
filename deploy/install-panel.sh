#!/usr/bin/env bash
# SingBox 面板安装脚本(在中心机上执行,root)
set -euo pipefail

PANEL_DIR=/opt/singbox-panel
ENV_FILE=/etc/singbox-panel/panel.env
export DEBIAN_FRONTEND=noninteractive

echo "==> 1/5 安装 Node.js 24+(nodesource;node:sqlite 内置数据库,零原生依赖)"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d 'v')" -lt 24 ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi

echo "==> 2/5 拉取代码"
mkdir -p "$PANEL_DIR"
if [ ! -f "$PANEL_DIR/package.json" ]; then
  git clone https://github.com/hunyed15/singbox-panel.git "$PANEL_DIR"
fi
cd "$PANEL_DIR"

echo "==> 3/5 安装依赖 + 构建前端"
npm install --workspace server
(cd frontend && npm install && npm run build)

echo "==> 4/5 配置 env"
mkdir -p "$(dirname "$ENV_FILE")"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<EOF
APP_SECRET=$(openssl rand -hex 32)
PANEL_LISTEN=0.0.0.0:8081
PANEL_DB=./data/panel.db
ADMIN_USER=admin
ADMIN_PASS=
JWT_SECRET=$(openssl rand -hex 32)
SINGBOX_BIN=/usr/local/bin/sing-box
SINGBOX_CONFIG=/etc/sing-box/config.json
SINGBOX_UNIT=sing-box
# GitHub 不稳时切换镜像:
# SINGBOX_DOWNLOAD_BASE=https://ghproxy.com/https://github.com/SagerNet/sing-box/releases/download
CHECK_TIMEOUT_MS=15000
DEPLOY_TIMEOUT_MS=60000
EOF
fi

echo "==> 5/5 systemd"
cp "$PANEL_DIR/deploy/singbox-panel.service" /etc/systemd/system/singbox-panel.service
systemctl daemon-reload
systemctl enable --now singbox-panel
systemctl status singbox-panel --no-pager || true

echo "==> 完成。首次登录密码(若 ADMIN_PASS 为空):journalctl -u singbox-panel -n 50 | grep bootstrap"
echo "    面板地址:http://<本机>:8081(建议按 deploy/nginx.conf.example 配 HTTPS 反代)"
