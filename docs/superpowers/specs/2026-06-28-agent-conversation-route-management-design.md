# Agent 多轮对话与线路管理设计

## 目标

把行程详情里的“智能体对话”从规划进度页升级为可继续对话的线路管理入口。用户从详情页进入同一个 Agent 会话后，可以像第一次规划一样继续让 Agent 调用工具、查询地点和路线、更新当前线路、生成记忆候选，并在超时时间内进行任意多轮工具调用。

本设计同时补齐记忆候选确认/忽略、监控状态操作、默认出发点设置方式、行程标题格式、路线偏好文案，以及清理 `.worktrees` 后只在项目根目录工作的要求。

## 用户体验

1. 用户在行程详情点击“智能体对话”。
2. 页面进入 `/agent/[sessionId]?view=conversation`，显示历史用户消息、Agent 消息和工具调用记录。
3. 用户可以继续输入自然语言，例如“改成明天 10:00 到东钱湖地铁站”“这段改骑行”“以后记住我从外事学校出发”。
4. 后端把新用户消息写入同一个 `AgentSession`，将 session 状态改为 `running`，并启动续聊运行。
5. Agent 获得当前行程上下文、历史消息、用户设置、已确认记忆，以及和首次规划同级别的全部可用工具。
6. Agent 可以多轮调用工具，不限制推理轮数或工具轮数，只受既有 wall-clock timeout 约束。
7. Agent 通过线路更新工具修改当前 trip、stops、legs、route candidates、segments、buffers、reminders、monitoring status，或创建记忆候选。
8. 用户回到详情页时看到更新后的标题、路线、提醒和监控状态。

确认后的记忆必须在每次 Agent run 中生效。它不只是记忆页里的展示数据，也不能只依赖 Agent 主动调用工具碰运气读取；运行开始时要主动把已确认记忆注入 Agent 上下文，并明确告诉 Agent 这些是用户确认过的长期偏好、常用地点或习惯。

## Agent 工具集

续聊时暴露两类工具，和首次规划保持同样的“工具由 Agent 主动选择，应用层不硬编码决策”的原则。

### 读取与决策工具

- `read_settings`：读取城市、时区、出发点、通勤方式倾向和通知设置。
- `read_memories`：读取已确认记忆。
- `read_current_trip`：读取当前 trip 的完整结构，包括 stops、legs、selected candidate、segments、buffers、reminders、recalculations。
- `search_poi`：关键词搜索高德 POI。
- `get_poi_detail`：读取 POI 详情。
- `get_weather_reference`：读取天气参考。
- `get_transit_route`：查询公交/地铁路线。
- `get_walking_route`：查询步行路线。
- `get_bicycling_route`：查询骑行路线。

### 修改当前线路工具

- `update_trip_summary`：更新标题、目标到达时间、最终目的地和状态。
- `replace_trip_stops`：整体替换停靠点，适合目的地或中途点变化。
- `replace_trip_legs`：整体替换线路路段、候选路线、选中路线、分段和缓冲组件。
- `select_route_candidate`：在已有候选中切换选中路线。
- `replace_reminder_schedule`：根据新的最晚出发时间重建提醒计划。
- `cancel_trip_monitoring`：取消当前行程监控，取消未执行提醒。
- `create_memory_candidate`：把对话中发现的偏好、常用地点、出发习惯写成待确认记忆。

这些工具都必须记录 `AgentToolCall`，成功或失败都要可追踪。修改工具应尽量用事务保护，避免只更新一半线路。

## 多轮运行模型

首次规划继续使用 `startPlanningSession` 和 `runPlanningSession`。详情页续聊新增“追加用户消息并运行”的入口，例如 `POST /api/agent-sessions/[sessionId]/messages`。

续聊运行使用同一个超时和重试模型：

- 每次用户追加消息后，session 进入 `running`。
- runner 从数据库读取历史消息，追加系统提示和当前 trip 上下文。
- runner 同时读取当前用户已确认的 `Memory`，将其作为独立上下文消息传给 Agent，并说明这些记忆应优先作为用户偏好和常用地点证据使用。
- Agent 可以反复调用所有工具，直到它完成当前用户请求并返回自然语言总结。
- 不设置工具调用轮数上限。
- 超时后记录失败消息，保留已完成的工具日志。
- 如果修改工具已经成功提交，不因为后续超时自动回滚已确认的数据库更新；Agent 消息需要说明当前状态。

为了兼容现有进度页，规划完成后的自动跳转只在非 conversation view 生效。conversation view 不自动跳走。

## 行程标题格式

Agent 保存或更新单段行程标题时，统一使用：

```text
起点-终点
```

例如用户输入“明天10:00 外事学校到东钱湖地铁站”，标题保存为：

```text
外事学校-东钱湖地铁站
```

多段行程可使用 `起点-最终目的地`。如果起点或终点来自 POI 全称，优先使用用户可识别的短名称，不把时间写进行程标题。

## 记忆候选闭环

记忆页待确认候选新增两个操作：

- 确认：创建对应 `Memory`，并把候选状态改为 `confirmed`。
- 忽略：把候选状态改为 `ignored`。

接口建议为 `POST /api/memory-candidates/[candidateId]/confirm` 和 `POST /api/memory-candidates/[candidateId]/ignore`。两者都要校验当前用户拥有该候选。

确认后的 `Memory` 必须参与后续每一次首次规划和续聊。实现上需要有统一的记忆上下文构造函数，例如读取最近或最相关的已确认记忆，序列化为 Agent 可读的结构化文本，并在 `runPlanningSession` 与续聊 runner 中共同使用。`read_memories` 工具仍保留，供 Agent 在运行中按需刷新或查看更完整列表。

## 监控状态

详情页监控区域新增：

- 已监控时间：从 `Trip.createdAt` 或首次进入 `monitoring` 的时间计算。当前模型没有单独字段时，先使用 `createdAt`。
- 待提醒数量：统计 `ReminderJob.status = scheduled` 的数量。
- 取消监控：按钮调用 `POST /api/trips/[tripId]/cancel-monitoring`。

取消监控后：

- `Trip.status` 更新为 `cancelled`。
- 所有关联 `TripLeg.status = cancelled`。
- 未执行的 `ReminderJob.status = cancelled`。
- 已发送、失败、跳过的提醒日志不改写。

## 默认出发点

默认出发点不再来自配置文件或环境变量。`.env`、`readEnv`、README 和 seed 逻辑都不再要求 `DEFAULT_ORIGIN` 或 `DEFAULT_ORIGIN_NAME`。

用户必须在设置页保存出发点：

- 设置页展示“默认出发点”搜索框。
- 用户输入关键词后调用服务端 POI 搜索接口。
- 用户从候选中选择一个地点，表单保存 `originName` 和隐藏的 `originLngLat`。
- 不提供手写坐标输入框。
- 未来接入高德 JS 地图时，可在同一组件里增加地图点选；当前实现至少完成候选词搜索选择闭环。

如果用户没有保存出发点：

- 首页提交规划时返回明确提示，引导用户去设置页选择默认出发点。
- Agent 的 `read_settings` 也返回缺失状态，避免工具层用环境变量坐标兜底。

## 通勤方式倾向

设置页把“路线偏好”改为“通勤方式倾向”，并用明确选项替代难懂文案：

- `balanced`：均衡
- `fastest`：省时间优先
- `habit`：贴近日常习惯
- `transit`：公交地铁优先
- `bike`：骑行优先

内部字段仍可沿用 `routePreference`，但 UI、验证错误、Agent 提示使用新的中文文案。

## Worktree 清理

移除 `.worktrees/commute-planner-mvp` 对应的 git worktree，并删除空的 `.worktrees` 工作目录。之后实现、测试和提交都只在 `D:\code\Commute-Planner` 根目录进行。

清理前需要确认根目录已有最新应用代码；清理命令不得影响根目录 `.git` 或未跟踪业务文件。

## 数据一致性

线路更新工具优先采取“整体替换当前线路可变部分”的方式，降低半更新风险：

- 删除并重建当前 trip 的 stops、legs、route candidates、segments、buffers 和未执行 reminders。
- 保留 trip、agent session、历史消息、工具调用、notification logs 和 recalculation logs。
- 如果只是取消监控或切换候选路线，使用更小的事务更新。

所有更新工具必须校验 `trip.userId` 和 `AgentSession.userId` 一致，且 session 关联当前 trip。

## 测试策略

使用 TDD。优先新增以下测试：

- Agent 续聊接口能追加用户消息，并把 session 重新置为 `running`。
- 续聊 runner 暴露读取、路线查询、记忆候选和线路更新工具，且不设置轮数上限。
- `update/replace` 工具能更新当前 trip 标题为 `起点-终点`，并替换路线结构。
- 记忆候选确认会创建 Memory 并关闭 candidate；忽略只关闭 candidate。
- 确认后的 Memory 会被注入后续首次规划和续聊的 Agent 消息上下文，不依赖 Agent 先调用 `read_memories`。
- 取消监控会取消 trip、legs 和 scheduled reminders。
- 设置 API 不再从 env 返回默认出发点；未设置出发点时规划入口返回引导错误。
- 设置表单不渲染坐标输入框，使用候选搜索选择保存隐藏坐标。
- “通勤方式倾向”文案和选项渲染正确。

## 非目标

- 本轮不实现实时地图拖拽 SDK 的完整交互。如果没有现成地图组件，先完成服务端 POI 搜索候选选择；后续可在同一接口上接入地图点选。
- 本轮不重做通知渠道配置。
- 本轮不把旧行程历史迁移成新标题格式，只保证新建和经 Agent 更新的行程遵守格式。
