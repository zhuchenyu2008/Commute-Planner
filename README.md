# Commute Planner

一个 Docker 化的个人通勤规划助手，基于 Next.js、Prisma SQLite 和高德 Web Service。

## Quick Start

```bash
cp .env.example .env
cmd /c npm install
cmd /c npm run db:init
cmd /c npm run dev
```

默认首次密码来自 `.env` 的 `APP_INITIAL_PASSWORD`，未配置时为 `change-me-now`。登录后可在设置页修改密码。

## Docker

```bash
cp .env.example .env
docker compose up --build
```

SQLite 数据库挂载在 `./data/commute.db`。

如果本机 `prisma db push` 因 Prisma schema engine 权限或二进制问题失败，可以使用 `npm run db:init` 创建同等 SQLite 表结构和默认数据。

## Environment

- `AMAP_WEB_SERVICE_KEY`：高德 Web Service Key。缺失时使用本地 fallback 数据。
- `OPENAI_COMPAT_BASE_URL` / `OPENAI_COMPAT_API_KEY` / `OPENAI_COMPAT_MODEL`：OpenAI-compatible 抽取器。缺失时使用规则解析。
- `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`：Telegram 测试与提醒。
- `SMTP_*` / `RECIPIENT_EMAIL`：邮件测试与提醒。

所有业务 API 都需要登录；密钥只用于后端，不会返回给前端。
