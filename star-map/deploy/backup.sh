#!/usr/bin/env bash
# star-map 每日数据备份(由 /etc/cron.d/star-map-backup 调用,保留 7 份)
set -euo pipefail

BACKUP_DIR=/var/backups/star-map
DATA_DIR=/opt/star-map/data
KEEP=7

if [[ ! -d "$DATA_DIR" ]]; then exit 0; fi

STAMP=$(date +%Y%m%d-%H%M%S)
tar -czf "$BACKUP_DIR/star-data-$STAMP.tar.gz" -C "$DATA_DIR" .

# 只保留最近 KEEP 份
ls -1t "$BACKUP_DIR"/star-data-*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f

echo "[$(date '+%F %T')] backup done: star-data-$STAMP.tar.gz"
