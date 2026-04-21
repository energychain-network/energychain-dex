# EnergySwap DEX 运维手册（中文）

适用于 `dex/` 目录下的整套 DEX 服务（dex-indexer / dex-api / dex-web /
PostgreSQL+TimescaleDB / Redis / Prometheus / Grafana / Nginx）。本手册的目标
是让一名 SRE 在没有原作者在场的情况下也能完成日常巡检、故障切换和小版本
发布。

## 1. 拓扑概览

```
┌────────┐   JSON-RPC    ┌──────────────┐   pgx     ┌──────────────────┐
│ EVM    │ ◀──────────── │ dex-indexer  │ ────────▶ │ Postgres+        │
│ chain  │   eth_logs   │   (Go)        │           │ TimescaleDB      │
└────────┘               └──────┬───────┘           └────────┬─────────┘
                                │ Redis pub/sub               │
                                ▼                             │ pgx
                         ┌──────────────┐  WS / HTTP   ┌─────▼────┐
                         │  Redis       │ ◀──────────  │  dex-api │
                         └──────────────┘              └────┬─────┘
                                                             │ HTTP
                                                       ┌─────▼────┐
                                                       │  dex-web │
                                                       └──────────┘
```

所有服务均通过 `dex/deploy/docker-compose.yml` 编排，监控接入 Prometheus +
Grafana，外部入口由 Nginx 终结。

## 2. 首次部署

```bash
cd dex/deploy
cp .env.example .env             # 填入 RPC、合约地址、域名、邮箱
docker compose pull
docker compose run --rm migrate  # 一次性建表
docker compose up -d
docker compose logs -f indexer api
```

健康检查：

| URL                                  | 期望状态 |
| ------------------------------------ | -------- |
| `https://<domain>/api/v1/overview`   | `200`    |
| `https://<domain>/`                  | 首页加载 |
| `http://<host>:9091/-/healthy`       | `200`    |
| `http://<host>:3001/api/health`      | `ok`     |

## 3. 日常巡检（每天）

1. Grafana 「DEX Overview」 看板：
   - Indexer lag < 30 块；
   - API p95 < 200 ms；
   - 24h volume 与链上活动对得上；
   - Postgres connections < 80% 上限。
2. 检查报警：`http://<host>:9091/alerts` 应全部 OK。
3. 抽样核对：`select count(*) from swaps where block_time > now() - interval '1h';`
   与链上 SwapEvent 数量是否一致。

## 4. 升级流程

零停机升级（蓝绿）：

```bash
git pull
cd dex/deploy
docker compose build api web indexer
docker compose up -d --no-deps --remove-orphans api web indexer
docker compose ps
docker image prune -f
```

如果只是 web/api 改动，indexer 可以不重启。Schema 变更必须先跑 `migrate`：

```bash
docker compose run --rm migrate -path /migrations -database "$PG_DSN" up
```

## 5. Reorg 与数据修复

- Indexer 默认保留 32 块的 confirmation buffer，浅 reorg 会自动回滚。
- 深度 reorg 或外部数据库损坏时，可以从指定高度重放：
  ```bash
  docker compose stop indexer
  psql "$PG_DSN" -c "UPDATE indexer_cursor SET height = <safe_height> WHERE chain_id = <id>;"
  docker compose start indexer
  ```
- 重放期间 API 仍可读旧数据；前端会显示 stale 警示，原因是 `updated_at`
  比当前链头早。

## 6. 备份

- Postgres：每天 02:00 通过 `pg_basebackup` 全量 + WAL 归档至 S3，保留 14 天。
- Redis：纯缓存，不需要备份。
- 配置和 `.env`：纳入受控 git repo（私有），`.env` 内的密钥使用 SOPS 加密。

恢复演练每季度执行一次：拉取最近一份基线 → 在隔离环境恢复 → 跑 `make verify`
比对最近 1000 个 swap 的金额。

## 7. 常见故障

| 现象                                                | 排查思路 |
| --------------------------------------------------- | -------- |
| 前端 Overview 一直显示旧时间戳                      | 看 indexer 日志和 `indexer_cursor`；99% 是 RPC 卡顿。 |
| Swap 报价 404                                        | `/quote` 找不到路径，确认 token 地址正确，看 `pairs` 表是否含目标 token。 |
| Charts 没有 K 线                                    | 确认 `ohlcv` 表对应 pair+granularity 有数据，没有的话回填 `aggregator`。 |
| WebSocket 连接频繁断开                               | Nginx `proxy_read_timeout` 是否 ≥ 60s；负载均衡是否启用了粘性会话。 |
| Postgres 连接耗尽                                   | `SELECT pid, query FROM pg_stat_activity WHERE state='active';` 找出长查询。 |

## 8. 联系矩阵

- on-call 一线：`#dex-oncall`（Slack）
- DBA：`#data-platform`
- 链上事故：`#chain-core`
- 安全：`security@energychain.io`
