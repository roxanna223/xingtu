#!/usr/bin/env bash
# 「秘书」接入脚本：为一个新项目生成实例目录（骨架三件套）
# 用法：在 秘书/ 目录下执行  bash init.sh <项目名>
# 效果：projects/<项目名>/ 下生成 00_核心锚点.md、02_任务追踪器.md、03_偏差日志.md，并在登记表追加一行。
set -euo pipefail
cd "$(dirname "$0")"

NAME="${1:-}"
if [ -z "$NAME" ]; then
  echo "用法: bash init.sh <项目名>"
  exit 1
fi

DIR="projects/$NAME"
if [ -e "$DIR" ]; then
  echo "已存在: ${DIR}（不覆盖，防止冲掉已有锚点）"
  exit 1
fi

mkdir -p "$DIR"
cp "method/03_模板_核心锚点.md"   "$DIR/00_核心锚点.md"
cp "method/04_模板_任务追踪器.md" "$DIR/02_任务追踪器.md"
cp "method/05_模板_偏差日志.md"   "$DIR/03_偏差日志.md"
printf '| %s | 待勘察 | 待勘察 | %s |\n' "$NAME" "$(date +%F)" >> "projects/README.md"

echo "✅ 已创建 ${DIR}（00/02/03 三份骨架），登记表已追加一行。"
echo "下一步：按 method/01_本质勘察法.md 执行勘察（收集原话 → 剥壳 → 找链 → 定制三问 → 盘点诊断 → 输出四件套）。"
