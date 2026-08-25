# OpenClaw 服务停用记录 v1.0

> 运维操作文档 · 2026-08-25 · 操作方式:SSH 远程(Windows OpenSSH + askpass)
> 目的:为「星图」MVP 部署腾出服务器资源。**只停服务、不删数据,全部可逆。**

---

## 1. 服务器信息

| 项目 | 值 |
|---|---|
| 公网 IP | `124.222.89.40` |
| 登录方式 | `ssh root@124.222.89.40`(密码认证,密码不在此文档中记录明文) |
| 系统 | Ubuntu(Linux `VM-0-12-ubuntu` 5.15.0-181-generic),腾讯云 |
| 规格 | 2 核 4G(实际 3.6Gi 内存),系统盘 59G(已用 15G),Swap 2G |

---

## 2. OpenClaw 部署架构(停用前侦查结果)

OpenClaw 以 **Docker Compose** 方式部署,项目目录 **`/opt/openclaw/`**,compose project 名 `openclaw`。

### 2.1 容器清单

| 容器名 | 镜像 | 作用 | restart 策略 | 端口 |
|---|---|---|---|---|
| `openclaw-gateway` | `openclaw/openclaw:latest` | 网关服务(核心,带健康检查 `/healthz`) | `unless-stopped` | `0.0.0.0:18789 → 18789` |
| `openclaw-cli` | `openclaw/openclaw:latest` | CLI 会话容器 | 无(默认 `no`) | 复用 gateway 网络(`network_mode: service:openclaw-gateway`) |

### 2.2 数据挂载(全部保留在宿主机,未受任何影响)

| 宿主机路径 | 容器内路径 | 内容 |
|---|---|---|
| `/opt/openclaw/data` | `/home/node/.openclaw` | 运行状态 + 配置 `openclaw.json` |
| `/opt/openclaw/workspace` | `.../workspace` | 账号 1 的工作区 |
| `/opt/openclaw/workspace-patchx` | `.../workspace-patchx` | 账号 2 的工作区 |
| `/opt/openclaw/auth-secrets` | `/home/node/.config/openclaw` | 认证密钥 |

### 2.3 关键配置

- `env_file`(可选):`/opt/openclaw/.env` —— 含 `DEEPSEEK_API_KEY`、`OPENCLAW_GATEWAY_TOKEN`、`TZ` 等
- gateway 启动参数:`node dist/index.js gateway --bind lan --port 18789 --allow-unconfigured`
- 容器安全设置:`cap_drop NET_RAW/NET_ADMIN`、`no-new-privileges`、`init: true`

### 2.4 遗留文件(未处理)

| 路径 | 说明 | 建议 |
|---|---|---|
| `/root/docker-compose.yml` | **旧版部署残留**:单容器 `openclaw`,端口 3000,内含飞书 App Secret 明文,当前无对应运行容器 | 确认无用后可删除;删除前先轮换飞书密钥 |
| `/opt/openclaw/openclaw-main/docker-compose.yml` | 源码/示例目录内文件 | 保留 |

---

## 3. 停用操作(2026-08-25 已执行 ✅)

### 3.1 执行命令

```bash
cd /opt/openclaw
docker compose stop
```

### 3.2 实际输出

```
 Container openclaw-cli Stopping
 Container openclaw-cli Stopped
 Container openclaw-gateway Stopping
 Container openclaw-gateway Stopped
```

### 3.3 停止后验证

```bash
docker ps -a --format '{{.Names}} | {{.Status}}'
# openclaw-cli      | Exited (0)
# openclaw-gateway  | Exited (0)

ss -tln | grep 18789          # 无输出 → 端口已释放
free -h                       # used 1.0Gi → 485Mi;available 2.3Gi → 2.9Gi
```

停用后服务器可用内存约 **2.9G**,足够部署「星图」Next.js 生产服务(约需 250~400M)。

---

## 4. 恢复方法(想重新启用 OpenClaw 时)

```bash
cd /opt/openclaw
docker compose start
```

验证:`docker ps` 两个容器恢复 `Up`,端口 18789 重新监听。

---

## 5. 服务器重启行为(重要)

| 场景 | openclaw-gateway | openclaw-cli |
|---|---|---|
| 现在(已手动 stop)重启服务器 | ❌ 不会自启(`unless-stopped` 对手动停止的容器不拉起) | ❌ 不会自启 |
| 先 `docker compose start` 恢复,之后重启服务器 | ✅ 会自动拉起 | ❌ 不会自启(需再 `docker compose start openclaw-cli`) |

即:**除非你主动恢复,OpenClaw 不会因为服务器重启而复活。**

---

## 6. 完全卸载(暂不需要,备用)

```bash
cd /opt/openclaw
docker compose down          # 删除容器,保留卷数据
# 彻底清理(三思后行,数据不可恢复):
# rm -rf /opt/openclaw
# rm -f /root/docker-compose.yml   # 旧残留
```

---

## 7. 安全提醒 ⚠️

1. **改服务器密码**:本次操作涉及 SSH 密码传输,建议执行 `passwd` 更换 root 密码。
2. **轮换密钥**:`/root/docker-compose.yml`(旧残留)与 `/opt/openclaw/.env` 中存有飞书 App Secret、DeepSeek Key 等明文凭据,建议在飞书开放平台轮换。
3. 停用后两个账号(workspace / workspace-patchx)与 OpenClaw 的连接均已断开,属预期现象。
4. 若日后重启用 OpenClaw,先执行 `docker pull openclaw/openclaw:latest` 更新镜像。
