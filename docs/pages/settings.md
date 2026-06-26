# 设置页面规格

## 页面目标

设置页集中管理网页密码、用户资料、Agent 记忆、通勤偏好、通知通道和系统配置状态。它是让工具从固定通勤脚本变成个人出行助理的控制台。

## 用户任务

- 查看和修改网页登录密码。
- 设置默认城市、时区和默认起点。
- 管理 Agent 记忆：地点、别名、路线偏好、通知偏好和待确认记忆。
- 查看 Telegram、邮件、高德和模型配置状态。
- 发送测试 Telegram 或邮件。
- 退出登录。

## 全局约定

- 未登录访问设置页时跳转登录门禁，登录成功后返回设置页。
- 底部导航展示：首页、历史、设置；设置 tab 高亮。
- 设置页可以承载多个管理分组，但保持单页滚动，不拆成额外主页面。
- 密钥、token、SMTP 密码、模型 API key 只显示是否已配置，不展示明文。
- Agent 从对话中发现的记忆必须经用户确认后才生效。

## 布局结构

1. 顶部标题区
   - 标题：“设置”。
   - 次要文案：“管理偏好、记忆和通知”。

2. 账号与安全
   - 当前登录状态。
   - 修改网页密码入口。
   - 退出登录按钮。
   - Session 过期说明。

3. 基础资料
   - 默认城市。
   - 时区。
   - 默认起点。
   - 常用出发点。

4. 待确认记忆
   - Agent 提出的待保存偏好。
   - 每条展示来源语句、记忆类型、建议值和置信度。
   - 操作：确认、编辑后确认、忽略。

5. 地点与别名
   - 地点记忆：家、公司、学校、健身房等。
   - 别名记忆：“学校”“公司楼下”等短语映射。
   - 每项展示名称、地址、城市、经纬度状态。

6. 路线偏好
   - 偏好地铁。
   - 少走路。
   - 少换乘。
   - 允许共享单车。
   - 避免打车。
   - 天气不好时自动降低骑行优先级。

7. 自动时间策略
   - 场内、换乘、停车、还车和通知变化阈值不提供用户手动设置。
   - 系统根据路线数据、天气和默认策略自动计算缓冲、最晚出发时间和提醒触发节奏。

8. 通知设置
   - Telegram 启用状态。
   - 邮件启用状态。
   - 提醒节奏说明。
   - 测试 Telegram。
   - 测试邮件。

9. 系统配置状态
   - 高德 Web Key 是否配置。
   - OpenAI-compatible 模型是否配置。
   - Telegram bot token 是否配置。
   - SMTP 是否配置。
   - 数据库路径和应用版本。

## 组件清单

- `AuthGate`
- `SettingsHeader`
- `AccountSecuritySection`
- `ProfileSection`
- `PendingMemorySection`
- `PlaceMemorySection`
- `RoutePreferenceSection`
- `NotificationSection`
- `SystemStatusSection`
- `MemoryEditorSheet`
- `PasswordChangeDialog`
- `ConfirmDeleteMemoryDialog`
- `TestNotificationButton`
- `BottomNav`
- `GlobalErrorBanner`

## 页面状态

- `unauthenticated`：跳转登录页。
- `loading`：加载 profile、记忆和系统状态。
- `ready`：设置可编辑。
- `saving`：正在保存某个设置项。
- `testingNotification`：正在发送测试通知。
- `passwordChanging`：正在修改网页登录密码。
- `memoryConflict`：同类型同标签记忆冲突，需要确认覆盖。
- `serviceMissingConfig`：某通道缺少配置。
- `offline`：后端不可达。
- `authExpired`：认证过期，跳转登录页。

## 记忆类型

- `place`：地点，保存名称、别名、地址、城市、经纬度。
- `alias`：短语映射，例如“学校”对应某个 POI。
- `route_preference`：路线偏好，例如偏好地铁、少走路、允许共享单车。
- `notification_preference`：通知偏好，例如 Telegram+邮件。
- `general_note`：其他出行习惯，必须可读、可编辑、可删除。

## 核心交互

- 页面加载时并行调用 `GET /api/profile`、`GET /api/memories`、`GET /api/settings/status`。
- 用户修改基础资料后调用 `PATCH /api/profile`。
- 新增记忆调用 `POST /api/memories`，手动新增默认直接保存为 `confirmed`。
- 编辑记忆调用 `PATCH /api/memories/{id}`。
- 删除记忆调用 `DELETE /api/memories/{id}`，默认软删除。
- 确认待保存记忆调用 `POST /api/memories/{id}/confirm`。
- 修改密码通过 `POST /api/auth/change-password`，成功后可要求重新登录。
- 测试通知调用 `POST /api/settings/test-notification`，必须明确展示测试结果。
- 配置缺失时相关测试按钮禁用，并提示需要在 `.env` 中配置。

## 接口

### `GET /api/profile`

返回默认城市、时区、默认起点和后端自动时间策略字段。分钟类策略字段只用于后端计算，不在设置页展示为可编辑项。

### `PATCH /api/profile`

保存基础资料。未传入分钟类策略字段时，后端不得覆盖现有自动时间策略。

### `GET /api/memories`

支持按类型和状态筛选：

```text
type=place
status=pending,confirmed
```

### `POST /api/memories`

创建手动记忆。

### `PATCH /api/memories/{id}`

编辑已存在记忆。

### `DELETE /api/memories/{id}`

软删除记忆。

### `POST /api/memories/{id}/confirm`

确认 Agent 提出的待保存记忆。

### `POST /api/auth/change-password`

请求示例：

```json
{
  "currentPassword": "old-password",
  "newPassword": "new-password"
}
```

### `GET /api/settings/status`

返回系统配置状态，不返回密钥明文。

### `POST /api/settings/test-notification`

请求示例：

```json
{
  "channel": "telegram"
}
```

## 验收点

- 设置页明确承载记忆层和网页密码认证管理，不新增单独记忆页。
- 待确认记忆不会在未确认前参与路线规划。
- 用户可以手动新增、编辑、删除和确认记忆。
- 修改密码流程不会泄露明文密码或 hash。
- 系统配置只显示是否配置，不展示任何 secret。
- Telegram 和邮件测试能展示成功、失败和缺少配置三类结果。
