#!/usr/bin/env bash
# star-map 应用部署(部署手册 §6)
# 用法: root 执行  ./deploy-app.sh <star-map-release.tar.gz>
# 内容: 解压到 releases/<时间戳> → data 指向持久目录 → npm ci + build → PM2 启动/重载 → 清理旧版本(留 3 个)
set -euo pipefail

APP_USER=starapp
APP_DIR=/opt/star-map
PORT=3001

if [[ $EUID -ne 0 ]]; then echo "请用 root 执行"; exit 1; fi
RELEASE_TAR="${1:-}"
if [[ -z "$RELEASE_TAR" || ! -f "$RELEASE_TAR" ]]; then
  echo "用法: ./deploy-app.sh <star-map-release.tar.gz>"
  exit 1
fi

STAMP=$(date +%Y%m%d%H%M%S)
RELEASE_DIR="$APP_DIR/releases/$STAMP"

echo "==> 1/6 解压 $RELEASE_TAR → $RELEASE_DIR"
mkdir -p "$RELEASE_DIR"
tar -xzf "$RELEASE_TAR" -C "$RELEASE_DIR" --strip-components=1

echo "==> 2/6 数据目录(持久化,与版本分离)"
mkdir -p "$APP_DIR/data"
# 首次部署: 把包里的数据迁到持久目录;之后版本不再覆盖线上数据
if [[ -d "$RELEASE_DIR/data" && ! -e "$APP_DIR/data/profile.json" ]]; then
  cp -a "$RELEASE_DIR/data/." "$APP_DIR/data/"
fi
rm -rf "$RELEASE_DIR/data"
ln -sfn "$APP_DIR/data" "$RELEASE_DIR/data"

echo "==> 3/6 .env(首次自动带入,后续手动维护 /opt/star-map/.env)"
if [[ ! -f "$RELEASE_DIR/.env" && -f "$APP_DIR/.env" ]]; then
  cp "$APP_DIR/.env" "$RELEASE_DIR/.env"
fi
if [[ ! -f "$RELEASE_DIR/.env" ]]; then
  cp "$RELEASE_DIR/.env.example" "$RELEASE_DIR/.env"
  echo "⚠️  已生成 .env 模板,请先编辑 $RELEASE_DIR/.env 填 DEEPSEEK_API_KEY 与 SESSION_SECRET,再继续"
fi

chown -R "$APP_USER":"$APP_USER" "$RELEASE_DIR" "$APP_DIR/data"

echo "==> 4/6 安装依赖 + 构建(约 1~3 分钟)"
cd "$RELEASE_DIR"
sudo -u "$APP_USER" npm ci
sudo -u "$APP_USER" npm run build

echo "==> 5/6 PM2 启动/重载"
ln -sfn "$RELEASE_DIR" "$APP_DIR/current"
# 必须 delete + start 而非 reload:PM2 reload 不更新已存在应用的 cwd(Node realpath 软链后 cwd 固化在旧 release,
# 曾导致线上进程一直跑旧代码——见迭代日志踩坑库第 11 条)
sudo -u "$APP_USER" pm2 delete star-map >/dev/null 2>&1 || true
sudo -u "$APP_USER" pm2 start "$APP_DIR/current/deploy/ecosystem.config.cjs" --env production
sudo -u "$APP_USER" pm2 save
pm2 startup systemd -u "$APP_USER" --hp "$APP_DIR" >/dev/null || true

echo "==> 6/6 清理旧版本(保留最近 3 个,便于回滚)"
ls -1dt "$APP_DIR"/releases/*/ 2>/dev/null | tail -n +4 | xargs -r rm -rf

echo ""
echo "✅ 部署完成: $RELEASE_DIR (current → $RELEASE_DIR)"
echo "   验证: curl http://127.0.0.1:3001/api/status  应返回 {\"loggedIn\":false,...}"
echo "   回滚: ln -sfn $APP_DIR/releases/<旧版本> $APP_DIR/current && pm2 reload star-map"
