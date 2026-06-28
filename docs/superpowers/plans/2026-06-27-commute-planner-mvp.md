# 通勤规划助手 MVP 实施计划

> 给 agentic worker 的说明：实施时使用 `superpowers:subagent-driven-development` 或 `superpowers:executing-plans`。行为变更遵循 TDD：先写失败测试，再实现，再验证通过。

## 目标

交付一个 Docker 化的 Next.js + Prisma/SQLite 个人通勤助手。用户输入一句自然语言，系统展示 Agent 规划过程，生成可执行行程，并提供多站路段、缓冲、提醒、自动复算、历史、设置、记忆和通知能力。

## 架构

- `app`：Next.js 页面和 API routes。
- `src/components`：延续前端样板的 React 组件。
- `src/lib/db.ts`：Prisma client。
- `src/lib/env.ts`：类型化环境变量读取，不输出密钥。
- `src/lib/auth`：本地登录和 session cookie。
- `src/lib/amap`：高德 DTO、限流、真实 client、mock client。
- `src/lib/agent`：Agent runner、工具调用记录、规划编排、10 分钟超时与自动重试。
- `src/lib/trips`：行程、停靠点、路段、缓冲、提醒生成。
- `src/lib/scheduler`：到期任务查询、锁定、复算和状态更新。
- `src/lib/notifications`：Telegram、email、通知日志和去重。
- `prisma/schema.prisma`：SQLite 数据模型。
- `scripts/scheduler.ts`：本地和 Docker scheduler tick。
- `tests`：unit、integration、E2E 测试。

## 技术栈

- Next.js 15
- React 19
- TypeScript
- Prisma / SQLite
- Vitest
- Playwright
- Docker / Docker Compose
- OpenAI-compatible Agent runner
- 高德 Web Service
- Telegram/email adapters

## 实施任务

### 1. 项目脚手架

- 建立 `package.json`、Next.js、TypeScript、Vitest、Playwright、Tailwind 配置。
- 创建 `app/layout.tsx`、`app/page.tsx` 和全局样式。
- 添加 smoke test，确认测试框架可运行。
- 验证：`npm.cmd test -- tests/unit/smoke.test.ts`、`npm.cmd run lint`。

### 2. Prisma 和本地种子用户

- 建立 `User`、`Session`、`UserSettings`、`AgentSession`、`Trip` 等核心模型。
- 添加迁移和 `prisma/seed.ts`。
- 默认城市、时区、出发点从 `.env` 读取，缺省值为宁波、`Asia/Shanghai` 和“家”。
- 验证：schema integration test、env unit test。

### 3. 本地登录

- 实现账号密码登录、登出、session cookie 和当前用户读取。
- 登录页使用项目统一玻璃面板风格。
- API 错误使用中文返回。
- 验证：auth unit test、settings API auth test、E2E 登录流程。

### 4. 高德适配层

- 实现真实高德 client：POI、天气、公交/地铁、步行、骑行。
- 实现每秒 3 次的限流队列。
- 实现 mock fallback，保证无 key 或服务失败时测试稳定。
- 天气只作为参考信息。
- 验证：AMap client、throttle、fallback 测试。

### 5. Agent runner

- 建立 Agent 会话、消息、工具调用记录。
- 运行不限制推理轮数。
- 使用 10 分钟 timeout，超时自动重试。
- 每次规划写入可见的中文消息。
- 验证：runner timeout/retry unit test、agent session integration test。

### 6. 行程创建

- 支持 `Trip`、`TripStop`、`TripLeg`、`RouteCandidate`、`RouteSegment`、`BufferComponent`、`ReminderJob`。
- 支持单目的地和多站行程的数据结构。
- 默认提醒节奏为 T-30、T-20、T-15、T-10、T-5、T。
- 天气缓冲分钟数为 `0`，只作参考。
- 验证：create-trip integration test、buffers/reminders unit test。

### 7. 前端应用页面

- 首页：一句话输入，提交后进入 Agent 对话。
- Agent 对话：展示用户请求、智能体消息和工具调用。
- 行程详情：展示最晚出发、路线分段、缓冲、提醒和监控状态。
- 历史：展示已规划行程。
- 设置：配置城市、时区、出发点、路线偏好和通知目标。
- 记忆：展示已确认记忆和待确认候选。
- 验证：UI component test、E2E 主流程。

### 8. 调度器和通知

- 查询到期提醒任务并加锁。
- 写入复算摘要。
- 发送 Telegram/email，配置缺失时记录 skipped。
- 写入通知日志并使用稳定 dedupe key。
- 验证：scheduler integration test、notification dedupe test。

### 9. Docker

- `Dockerfile` 构建 Next.js 应用。
- `docker-compose.yml` 启动 web 和 scheduler。
- SQLite 数据挂载到 `./data`。
- Compose 读取 `.env`，不提交真实密钥。
- 验证：Docker 配置测试；Docker daemon 可用时运行 `docker compose build`。

### 10. 中文化

- 应用界面、API 用户错误、Agent 消息、通知正文、README 和 docs 全部使用简体中文。
- 保留代码标识、路由、环境变量、脚本名、Prisma 模型名、状态枚举和第三方服务名。
- 中文输入示例必须能解析目的地，例如 `明天 9:15 到龙湖天街`。
- 验证：中文 UI 单测、中文 E2E、README 文档断言、英文/乱码扫漏。

## 常用命令

```bash
npm.cmd test
npm.cmd run lint
npm.cmd run build
npm.cmd run test:e2e -- tests/e2e/commute-flow.spec.ts --reporter=line --workers=1
npm.cmd run scheduler:tick
docker compose up --build
```

## 完成标准

- `npm.cmd test` 通过。
- `npm.cmd run lint` 通过。
- `npm.cmd run build` 通过。
- E2E 主流程通过。
- Docker 配置存在并通过静态测试。
- README 和 docs 为中文。
- 不读取、不输出、不提交 `.env` 真实值。
