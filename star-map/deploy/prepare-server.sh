#!/usr/bin/env bash
# star-map 服务器一次性初始化(部署手册 §5)
# 用法: root 执行  ./prepare-server.sh
# 内容: 系统更新 / Nginx+certbot / Node.js 20 / PM2 / starapp 用户与目录 / 备份 cron / logrotate / fail2ban
set -euo pipefail

APP_USER=starapp
APP_DIR=/opt/star-map
BACKUP_DIR=/var/backups/star-map

if [[ $EUID -ne 0 ]]; then echo "请用 root 执行"; exit 1; fi

echo "==> 1/8 系统更新"
apt-get update -qq && apt-get -y -qq upgrade

echo "==> 2/8 基础工具(Nginx/certbot/cron/logrotate/fail2ban)"
apt-get -y -qq install nginx certbot python3-certbot-nginx curl unzip cron logrotate fail2ban

echo "==> 3/8 Node.js 20 LTS"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get -y -qq install nodejs
fi
node -v

echo "==> 4/8 PM2"
npm install -g pm2

echo "==> 5/8 应用用户与目录"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR/releases" "$APP_DIR/data" "$BACKUP_DIR" /var/log/star-map
chown -R "$APP_USER":"$APP_USER" "$APP_DIR" /var/log/star-map

echo "==> 6/8 备份 cron(每天 03:30,保留 7 份)"
cat > /etc/cron.d/star-map-backup <<EOF
30 3 * * * root /opt/star-map/deploy/backup.sh
EOF
chmod 644 /etc/cron.d/star-map-backup

echo "==> 7/8 logrotate"
cat > /etc/logrotate.d/star-map <<'EOF'
/var/log/star-map/*.log {
  daily
  rotate 7
  compress
  missingok
  notifempty
  copytruncate
}
EOF

echo "==> 8/8 fail2ban 自启"
systemctl enable --now fail2ban

echo ""
echo "✅ 服务器初始化完成。"
echo "   下一步: 上传应用包,执行 ./deploy-app.sh star-map-release.tar.gz"
