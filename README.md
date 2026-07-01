# 通勤规划助手

Commute Planner 是一个个人通勤规划应用，使用 Next.js、Prisma/SQLite、AMap 工具和兼容 OpenAI 的规划运行器构建。它可以根据用户偏好、地点检索、路线结果和参考天气生成通勤计划，并为计划中的行程创建提醒任务。

## 本地开发

1. 将本地运行配置放在 `.env` 中。不要把真实密钥提交到仓库。
2. 安装依赖：

```bash
npm install
```

3. 准备本地数据库：

```bash
npm run prisma:deploy
npm run prisma:seed
```

4. 启动开发服务器：

```bash
npm run dev
```

默认种子账号是 `user@example.com` / `password`。可以通过 `SEED_USER_EMAIL` 和 `SEED_USER_PASSWORD` 覆盖。

常用脚本：

```bash
npm run dev
npm run build
npm run start
npm run lint
npm test
npm run test:watch
npm run prisma:generate
npm run prisma:migrate
npm run prisma:deploy
npm run prisma:seed
npm run scheduler:tick
npm run email:test-templates
npm run email:test-departure-reminder
npm run email:test-route-change
npm run telegram:poll
```

## 测试

运行单元测试和集成测试：

```bash
npm test
```

运行类型检查：

```bash
npm run lint
```

验证生产构建：

```bash
npm run build
```

运行 Playwright E2E 用例：

```bash
npm run test:e2e -- tests/e2e/commute-flow.spec.ts --reporter=line --workers=1
```

E2E runner 会先构建应用，再启动生产服务器，随后运行 Playwright，最后停止服务器。除非显式提供 `DATABASE_URL`，E2E 会使用本地 SQLite 数据库 `e2e-test.db`。

## 调度器

本地执行一次调度器 tick：

```bash
npm run scheduler:tick
```

调度器会检查到期的 reminder jobs，记录重新计算结果，并在 Telegram 或 email adapter 配置完整时发送通知。`docker-compose.yml` 中的 `scheduler` 服务会循环执行：

```bash
while true; do npm run scheduler:tick; sleep 60; done
```

应用也包含 scheduler tick API。配置 `SCHEDULER_TICK_SECRET` 后，请求需要通过 `Authorization: Bearer <secret>` 或 `x-scheduler-secret` 传入同一个 secret；未配置该变量时，本地调用不会强制校验。

## Telegram 双向入口

Telegram polling worker 需要在 `.env` 中配置 `TELEGRAM_BOT_TOKEN`。用户还需要先登录网站，在设置页保存自己的 Telegram Chat ID，worker 才能把 Telegram 对话和站内用户关联起来。

本地启动 Telegram worker：

```bash
npm run telegram:poll
```

Telegram 用法：

- `/new 明天九点到外事学校` 创建新行程。
- `/new` 后发送下一条普通文本创建新行程。
- 普通文本会继续当前 Agent 对话。
- `/trips` 通过 inline buttons 切换当前 Telegram 对话绑定的行程。
- `/cancel` 取消当前行程监控。
- `/new` 不会取消旧行程提醒，只有 `/cancel` 会取消。

## 本机一键部署

本机一键部署是和 Docker 并列的生产启动方式，适合不想使用容器、但希望一次启动 Web、scheduler 和 Telegram worker 的机器。

Windows：

```powershell
.\start-all.ps1
```

也可以双击 `start-all.cmd`。如果 PowerShell 执行策略拦截脚本，请使用 `start-all.cmd`，它会以 `ExecutionPolicy Bypass` 调用 PowerShell 入口。

Linux：

```bash
chmod +x ./start-all.sh
./start-all.sh
```

首次启动时，脚本会检查并补全 `.env`，然后执行依赖安装、Prisma 生成、数据库迁移、种子账号写入、生产构建和服务启动。高德地图与 AI Agent 配置是必填项：

- `AMAP_API_KEY`
- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_MODEL`

`SEED_USER_EMAIL`、`SEED_USER_PASSWORD` 和 `SCHEDULER_TICK_SECRET` 如果留空，脚本会自动生成并写入 `.env`。随机生成的种子账号和密码会在首次生成时打印到控制台。

`TELEGRAM_BOT_TOKEN` 和 SMTP 配置是可选通知能力。未配置 Telegram token 时，脚本会跳过 Telegram worker，但 Web 和 scheduler 会继续启动。

可用参数：

```bash
npm run start:all -- --configure
npm run start:all -- --yes
```

`--configure` 会强制重新进入配置向导。`--yes` 适合自动化环境，缺少必填项时会直接失败并列出缺失配置。

## Docker

同时运行 web app、scheduler 和 Telegram worker：

```bash
docker compose up --build
```

`migrate` 一次性服务会先执行 `npx prisma migrate deploy`。`web`、`scheduler` 和 `telegram` 都通过 `service_completed_successfully` 依赖它，确保 SQLite schema 只在长驻服务启动前迁移一次。`web` 只运行 `npm run start` 并暴露 `3000:3000`，`scheduler` 每 60 秒运行一次 `npm run scheduler:tick`，`telegram` worker 只运行 `npm run telegram:poll`，不再自己执行 migration。

Telegram worker 需要在 `.env` 中配置 `TELEGRAM_BOT_TOKEN`。未配置 token 时，worker 会提示缺少配置并退出，不会启动 polling。

SQLite 数据会持久化到 `./data`，并在容器内挂载到 `/app/data`。`docker-compose.yml` 会读取 `.env`，同时将容器内的 `DATABASE_URL` 设置为 `file:/app/data/commute.db`。

## 环境变量与通知配置

只在 `.env` 中保存真实配置值，不要在文档、提交记录或日志中泄露。下面只列出变量名和用途。

核心配置：

- `DATABASE_URL`：Prisma 使用的数据库连接，默认可使用 SQLite，例如 `file:./dev.db`。
- `DEFAULT_CITY`：默认城市，用于 AMap 查询和种子用户设置。
- `DEFAULT_TIMEZONE`：默认时区，例如 `Asia/Shanghai`。
- `AMAP_API_KEY`：AMap API key；未配置时会使用 mock AMap client，适合本地测试。
- `OPENAI_API_KEY`：兼容 OpenAI 的规划运行器凭证。
- `OPENAI_BASE_URL`：兼容 OpenAI 接口的自定义 base URL；未配置时使用官方默认。
- `OPENAI_MODEL`：规划运行器使用的模型名；未配置时使用代码默认值。
- `SEED_USER_EMAIL`：覆盖种子用户邮箱。
- `SEED_USER_PASSWORD`：覆盖种子用户密码。
- `SCHEDULER_TICK_SECRET`：保护 scheduler tick API 的 shared secret。

默认出发点和通知接收人不通过环境变量配置。用户登录后需要在设置页通过地点搜索选择默认出发点，并填写 Telegram Chat ID 或邮件接收人；系统会保存这些用户级设置。

Telegram 通知：

- `TELEGRAM_BOT_TOKEN`：Telegram bot token。

Email 通知：

- `SMTP_HOST`：SMTP 主机。
- `SMTP_USER`：SMTP 用户名。
- `SMTP_PASS`：SMTP 密码。代码也兼容 `SMTP_PASSWORD`，但 `.env.example` 默认使用 `SMTP_PASS`。
- `SMTP_PORT`：SMTP 端口，默认 `587`。
- `SMTP_SECURE`：设为 `true` 时使用 secure SMTP。
- `SMTP_FROM`：发件人；未配置时使用 `SMTP_USER`。
- `SMTP_TLS_USE_SYSTEM_CA`：设为 `true` 时尝试加载系统 CA，用于处理本机已信任但 Node.js 默认不信任的 SMTP 证书链。

本地发送 mock 邮件模板：

```bash
npm run email:test-templates
npm run email:test-departure-reminder
npm run email:test-route-change
```

`email:test-templates` 会发送全部 mock 模板；`email:test-departure-reminder` 只发送出发提醒；`email:test-route-change` 只发送路线变化提醒。命令会读取数据库中已配置的邮件接收人，并要求 SMTP 配置完整。

通知 adapter 配置不完整时，发送会被跳过并记录状态，不会阻塞调度器继续处理其他 reminder jobs。
