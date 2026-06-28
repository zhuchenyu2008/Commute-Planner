# 通勤规划助手 MVP 设计

## 目标

构建一个本地优先的个人智能通勤规划应用。登录用户可以在首页输入一句自然语言请求，例如 `明天 9:15 到龙湖天街电影院`，系统会创建 OpenAI-compatible Agent 会话，展示规划过程，并生成可执行的行程计划。

应用需要覆盖目的地定位、路线候选、最晚出发时间、路线分段、缓冲时间、自动复算、提醒任务、历史记录、设置、通知日志和可确认的个人记忆。

## 技术方案

项目采用 Next.js App Router 单体应用，服务层集中在 `src/lib`：

- 前端页面和 API routes 放在 `app`。
- Prisma/SQLite 负责本地持久化。
- Agent runner 负责规划、超时和重试。
- 高德 Web Service 通过 `src/lib/amap` 适配，并带 deterministic mock fallback。
- Telegram/email 通知通过 `src/lib/notifications` 适配。
- 后台调度器通过 `scripts/scheduler.ts` 和 Docker scheduler 服务每分钟执行一次。

天气只作为 Agent 可参考的信息，不是硬编码排名规则；Agent 可以引用天气解释路线或缓冲选择，但实现层不自动因为天气给路线加固定分钟数。

## 用户流程

1. 用户登录应用。
2. 用户在设置中配置默认城市、时区、出发点、路线偏好、Telegram 和邮件通知。
3. 用户回到首页输入一句话，例如 `明天 9:15 到龙湖天街电影院`。
4. 系统校验登录状态并创建 Agent 会话。
5. 用户进入 `/agent/[sessionId]`，看到智能体读取偏好、查询 POI、获取天气参考、查询路线和生成缓冲的过程。
6. 规划完成后系统写入行程、路线、分段、缓冲和提醒任务，并跳转到 `/trips/[tripId]`。
7. 行程详情页展示最晚出发时间、路线分段、缓冲时间、提醒计划和监控状态。
8. 用户如果不满意，可以点击“智能体对话”回到会话继续调整。
9. 调度器每分钟检查到期提醒，记录复算状态，并在配置可用时发送 Telegram/email 通知。

多站行程是一等模型：`Trip` 包含有序 `TripStop`，每一段 `TripLeg` 都有自己的路线候选、路线分段、缓冲、复算记录和提醒任务。

## 页面

- 登录：本地账号密码登录，使用 session cookie。
- 首页：严格延续 Lumina Velocity 样板风格，第一屏就是通勤输入，不做营销 landing page。
- 智能体对话：展示用户请求、智能体消息、工具调用记录和自动跳转状态。
- 行程详情：展示目标到达、最晚出发、路线分段、缓冲时间、提醒计划、监控状态和返回智能体对话入口。
- 历史行程：按创建时间展示已规划行程。
- 设置：维护默认城市、时区、出发点、路线偏好、Telegram Chat ID 和邮件接收人。
- 记忆：展示已确认记忆和待确认记忆候选。

## Agent 能力

Agent 以较宽的决策权限为中心，可以调用项目暴露的规划能力：

- 读取用户设置和已确认记忆。
- 搜索高德 POI。
- 查询天气参考。
- 查询公交/地铁、步行和骑行路线。
- 生成结构化缓冲时间。
- 创建或更新行程、停靠点、路段、路线候选、路线分段和提醒任务。
- 写入复算记录和通知日志。
- 在配置可用时触发 Telegram/email 通知。

Agent 不限制推理轮数。运行使用 10 分钟 wall-clock timeout，超时后自动重试；重试限制是任务尝试次数，不是 Agent 思考轮数。

## 时间模型

路线时间和非路线时间必须分开记录。

路线时间来自高德路线结果，例如公交/地铁、步行、骑行。

非路线缓冲由 Agent 决策并结构化保存，包括：

- 进入商场、园区或场馆。
- 从入口走到电影院、店铺或办公室。
- 电梯、扶梯和楼层移动。
- 检票、安检、排队或签到。
- 停车、取车、还共享单车。
- 地铁换乘、站台等待、进出站摩擦。
- 路口过街和站外步行。
- 用户偏好余量。
- 天气参考说明。

天气缓冲的分钟数保持为 `0`，只作为参考信息展示和记录。

## 数据模型

核心 Prisma 模型：

- `User`
- `Session`
- `UserSettings`
- `AgentSession`
- `AgentMessage`
- `AgentToolCall`
- `Trip`
- `TripStop`
- `TripLeg`
- `RouteCandidate`
- `RouteSegment`
- `BufferComponent`
- `ReminderJob`
- `RecalculationLog`
- `NotificationLog`
- `Memory`
- `MemoryCandidate`

内部状态枚举仍使用英文值，例如 `monitoring`、`scheduled`、`sent`，前端负责将其展示为中文。

## 高德集成

`src/lib/amap` 提供统一适配层：

- POI 文本搜索。
- POI 详情。
- 天气查询。
- 公交/地铁路线。
- 步行路线。
- 骑行路线。

高德请求必须经过全局限流队列，每秒最多 3 次。缺少 key 或真实服务失败时，系统回落到 mock client，以保证本地 UI 和测试稳定。

## 调度器与通知

调度器每分钟查找到期的 `ReminderJob`，使用锁避免重复发送。处理流程：

1. 加载行程、路段、路线候选、设置和记忆。
2. 记录智能体辅助复算摘要。
3. 更新提醒任务状态。
4. 写入 Telegram/email 通知日志。
5. 配置完整时发送通知，配置缺失时记录为 skipped。

默认提醒节奏为 T-30、T-20、T-15、T-10、T-5 和 T。

## Docker

项目提供 `Dockerfile` 和 `docker-compose.yml`。Compose 同时启动 web 和 scheduler，SQLite 数据挂载到 `./data:/app/data`，容器内使用 `DATABASE_URL=file:/app/data/commute.db`。

`.env` 由运行环境提供，不能提交真实密钥。

## 前端设计约束

必须延续已有前端样板和规范：

- Lumina Velocity 视觉语言。
- Inter 字体和系统中文字体回退。
- Commute Blue 主操作色。
- 玻璃拟态主要操作面板。
- 移动端底部导航，桌面端顶部导航。
- 状态 pill、时间线、紧凑但可读的操作型 UI。
- 不做营销页；首页直接进入通勤输入工作流。

新增页面也必须沿用同一套 token、间距、圆角、导航和信息层级。

## 测试策略

行为代码使用 TDD。重点覆盖：

- 自然语言目的地解析。
- 高德限流和 mock fallback。
- Agent 超时与重试。
- 缓冲组件归一化。
- 多站行程持久化。
- 提醒任务生成。
- 调度器到期任务处理。
- 通知去重和日志。
- 中文 UI 文案和 E2E 主流程。
