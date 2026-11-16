# MoTA Executor（dsh-mota-executor）

把本机的 DeepSeek Harness 接入 MoTA Creator：一个插件实例可以同时托管**多个**绑定式 Pull Agent。每个 Agent 有自己的 Creator 队列、自己的并发能力、自己的 Token/费用统计和日志；Creator 在绑定式接入下发来的 Queue 地址、BOUND_PULL Agent Token（`mpk_…`）、Agent Code 与岗位，交给本插件就能跑起来：

- 按 Pull 协议持续心跳（`heartbeat`），让 Creator 页面显示在线；
- 按每个 Agent 的并发数长轮询领取任务（`claim`），在租约内续租（`renew`）；
- 每个任务开一个独立的 Harness 子 Agent，按岗位的 V2 输出契约执行；
- 用校验过的四字段信封回传结果和**真实** Token 用量（`complete`），并读取回执；
- 平台要求自检时，跑一遍最短的真实链路并如实上报 `selfCheck`。

Token 只作为 URL query 参数发往 Creator 下发的队列地址，不写进插件配置、不写日志、不进会话可见文本。

## 功能

- **Agent 列表**：新增 / 查看 / 编辑 / 启停 / 删除；每个 Agent 独立绑定、独立 Worker，互不影响。
- **单 Agent 配置**：Queue 地址、Token、岗位、**并发数（1–8）**；Agent Code 由粘贴的接入指令解析，Worker ID 首次连接自动生成并固定。
- **用量与费用**：每个 Agent 累计任务数、接受/未接受、输入/输出/总 tokens、模型调用次数，以及按插件配置单价估算的费用。
- **日志**：按 Agent、级别筛选，查看心跳、领取、回传、自检与错误事件。

## 安装

**方式一：一条命令（推荐）**，需要 DSH `>= 0.2.2-rc.1 < 0.3.0`：

```bash
dsh plugin --profile desktop add https://github.com/mota-developer/dsh-mota-executor/releases/latest/download/dsh-mota-executor.tgz
```

**方式二：GitHub 固定提交**：

```bash
dsh plugin --profile desktop add github:mota-developer/dsh-mota-executor#<commit>
```

**方式三：npm（发布后）**：

```bash
dsh plugin --profile desktop add dsh-mota-executor
```

**方式四：本地目录**：打开 **设置 → 插件** → **Add plugin** → 选择本目录。

安装后在插件列表里应能看到「MoTA Executor」及其图标；建议重开应用让插件生效。插件是纯 Host + 轻量 Client 插件、零运行时 npm 依赖，不需要构建。

### 界面入口

- **左侧栏**：侧边栏右下角的操作区里、用量行上方，一行带边框的「MoTA Executor」入口（橙色图标 + 文字）。它不占用全局面板图标列（`sidebar.panellist`），不会挤压「插件」「定时任务」那些图标。
- **设置页**：设置左侧导航里的「MoTA Executor」，点开就是同一个控制台。
- **独立页面**：`http://127.0.0.1:<Web GUI 端口>/mota` 仍保留单 Agent 兼容页，适合排查连接问题。

## 使用

1. 打开控制台，点 **新增 Agent**。
2. 把 Creator Center 给出的整段绑定说明粘进「接入指令」，点 **解析**：Queue 地址、Token、岗位会自动填好，Agent Code 与 Worker ID 在后台解析/生成。
3. 设置这个 Agent 的 **并发数**（同时执行的任务数，1–8），点 **创建 Agent**。插件先做一次真实心跳，成功后状态变在线。
4. 回到 Creator 页面点 **Test connection**，确认平台侧探测通过。
5. 之后 Creator 派发的任务会自动领取执行，结果与用量出现在「最近任务」「用量与费用」「日志」里。

删除 Agent 会同时停止它的 Worker，并删除本机保存的 Token 与统计。停用（停止）只会停 Worker，配置和统计保留。

## 运行行为

- **每个 Agent 一个 Worker**：一个心跳循环 + `并发数` 个 claim 循环，同 Agent 内最多并发执行 `并发数` 个任务；不同 Agent 之间完全独立。
- 心跳间隔以平台返回的 `heartbeatIntervalSeconds` 为准（默认 60 秒，插件限制在 5–600 秒）。
- `claim` 使用 40 秒读取超时（平台长轮询上限 30 秒）；返回 204 立即再取。
- 租约（`leaseExpireAt`）剩余时间约 1/3 时续租；续租冲突（409）会取消当前执行、不回传。
- 回传只认 HTTP 200 + `accepted` 布尔值；网络 / 5xx / 429 会用**完全相同**的字节重试，重试预算用尽则保留原结果，等平台重新派发同一 runId 时原样重放，不会重复执行。
- 参数错误（`000002`）、401、403 会停止该 Agent 的所有循环，并在它的日志里显示原因，等待人工更新 Token。
- 总 Token、输入、输出、缓存、推理用量都来自子 Agent 的 `assistant/message` 事件；拿不到真实用量时任务按失败处理，不会伪造数字。

## 输出契约

每个岗位的 `payload_result` 都按插件内置的 V2 岗位 schema 校验（`schemas/*.json`，来自官方 mota-bind 创作者套件），校验项包括：

- 顶层恰好是 `payload_result`、`payload_info`、`contract_version: "V2"`、`usage`；
- `runId` 只放在 `X-MoTA-Run-ID` 请求头，不出现在 body；
- `payload_info` 非空，并在末尾追加官方免责声明：
  - 中文：`AI 生成的研究参考，不构成投资建议。`
  - 英文：`AI-generated research for reference only, not investment advice.`
- `usage.totalTokens` 为 ≥1 的整数，`cachedInputTokens ≤ promptTokens`。

契约不满足时会让子 Agent 带着具体问题自修复，最多 3 轮；仍不满足则本任务不回传，Agent 日志会记录失败原因。

## 配置项（`cordis.patch.yml`）

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `language` | `zh` | 输出免责声明语言，`zh` 或 `en` |
| `taskTimeoutSeconds` | `600` | 单个任务一轮生成的超时 |
| `selfCheckTimeoutSeconds` | `60` | 平台自检超时 |
| `allowInsecureLoopback` | `false` | 仅本地假队列调试用：允许 `http://127.0.0.1` / `localhost` 队列 |
| `autoStart` | `true` | 插件加载时自动启动所有已启用的 Agent |
| `priceInputPerMTok` | `0` | 估算费用用的输入单价（每百万 token，插件货币单位） |
| `priceOutputPerMTok` | `0` | 估算费用用的输出单价（每百万 token） |
| `currency` | `CNY` | 费用展示货币符号/单位 |

真实 Creator 队列必须是 `https`；不要为真实环境打开 `allowInsecureLoopback`。两个单价都为 0 时，界面显示「未配置单价」而不是 0 元。

示例：

```yaml
- id: mota-executor
  config:
    priceInputPerMTok: 2
    priceOutputPerMTok: 8
    currency: CNY
```

## 数据与安全

- 每个 Agent 的 Token 存在 DSH 凭据库的独立 GrantRecord 里（key `mota/agent-<uuid>`），界面只显示掩码；插件配置与日志里没有明文 Token。
- 旧版本的单连接记录（`mota/connection`）会在首次加载时自动迁移成一个 Agent，随后删除旧记录。
- 用量统计持久化在该 Agent 的凭据记录里，重启后保留；日志保存在内存（每个 Agent 最近 400 条），重启后清空。
- 发往模型的业务输入会做凭据键清洗（`authorization`、`access_token`、`api_key`、`password`、`cookie` 等），`runtimeContext` 只保留协议允许的字段。
- 任务内容会发送给本机 DSH 当前配置的模型提供方；这是执行任务的必要条件。
- 队列请求不跟随重定向，错误信息与界面状态都不回显完整 URL 或 Token。
- 执行任务的子 Agent 与本机 Harness 共享工具权限（当前 DSH API 无法安全地「禁用全部工具」）。插件在系统提示里明确禁止调用工具并把任务数据标记为不可信，但这只是提示词层的约束，**请只接入可信的 Creator 账号**。

## 市场与索引

- 仓库根目录的 `index.json` 是 format 1 插件市场索引，钉定固定 commit 的 git 源。
- `node scripts/verify-index.mjs` 自检索引与包的一致性；`--remote` 额外校验索引钉定的 commit 与 npm 版本。
- 已向 [`awesome-dsh-plugin`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 提交 `data/plugins/mota-developer__dsh-mota-executor.yml`，收录后会在 dshmarket 的「插件市场」里出现，可直接一键安装。

## 已知限制

- 未实现 Token 轮换的「候选 Token」流程：Worker 遇到 401 会停止该 Agent 并等待人工粘贴新 Token。
- 未实现 Push 通道、`mbt_*` 签名密钥或托管式 Agent。
- 平台侧预检（`/publics/bound/validate`）和评测仍由 Creator 侧跑；插件只保证契约与协议层面的正确。
- 一个 Agent 的并发上限是 8；更高的并发请拆成多个 Agent。
- 日志只在内存里，重启后清空；需要长期留存的用量看统计数字。
- 子 Agent 执行期间会出现在本会话的子 Agent 列表里（`origin: subagent`），任务完成后会话被释放。
- `allowInsecureLoopback` 只适合本机假队列测试，不可用于生产。

## 开发与测试

在仓库根目录执行：

```bash
node --test test/
```

测试覆盖：子集 JSON Schema 校验、信封/用量检查、真实用量汇总、假队列上的心跳/领取/续租/回传/字节一致重试/`000002` 处理、多 Agent 的创建/更新/日志/删除 API、以及凭据记录迁移。

本地端到端调试：在一个终端起一个假队列（实现 `heartbeat/claim/renew/complete` 四个 POST 端点），在插件配置中把 `allowInsecureLoopback` 设为 `true`，然后新增 Agent 并使用 `http://127.0.0.1:<port>/publics/bound/queue/<id>` 作为 Queue 地址。
