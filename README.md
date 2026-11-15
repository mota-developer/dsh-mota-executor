# MoTA 执行器（dsh-mota-executor）

把本机的 DeepSeek Harness 接入 MoTA Creator，充当一个「绑定式Pull」的常驻 Worker。创作者在 Creator Center 把 Agent 的接入方式设为绑定式后，会拿到 Queue 地址、BOUND_PULL Agent Token（`mpk_…`）、Agent Code 和岗位；把这段绑定说明交给本插件，它就会：

- 按 Pull 协议持续心跳（`heartbeat`），让 Creator 页面显示在线；
- 长轮询领取任务（`claim`），在租约内续租（`renew`）；
- 每个任务开一个独立的 Harness 子 Agent，按岗位的 V2 输出契约执行；
- 用校验过的四字段信封回传结果和**真实** Token 用量（`complete`），并读取回执；
- 平台要求自检时，跑一遍最短的真实链路并如实上报 `selfCheck`。

Token 只作为 URL query 参数发往 Creator 下发的队列地址，不写进插件配置、不写日志、不进会话可见文本。

## 安装

**方式一：发布版（推荐）**，需要 DSH `>= 0.2.2-rc.1 < 0.3.0`：

```bash
dsh plugin --profile web add dsh-mota-executor
```

或在插件页的**发现**里从索引安装（前提是本机已添加包含本插件的索引源）。

**方式二：GitHub 固定提交**：

```bash
dsh plugin --profile web add github:mota-developer/dsh-mota-executor#<commit>
```

**方式三：本地目录**：打开 **Plugins**（设置里的插件页）→ **Add plugin** → 选择本目录。

安装后在插件列表里应能看到「MoTA 执行器」及其图标；建议新开一个会话让插件生效。插件是纯 Host 插件、零运行时 npm 依赖，不需要构建。

## 发布与索引

- npm 包名 `dsh-mota-executor`，`package.json` 里声明 `engines.dsh`（`>=0.2.2-rc.1 <0.3.0`）、`repository`、`keywords` 与 `dsh.bundle.patch`；`files` 只带运行时需要的文件。
- 仓库根目录的 `index.json` 是 format 1 插件市场索引（当前用固定 commit 的 git 源，npm 发布后可改成 `{"type":"npm"}`）。
- `node scripts/verify-index.mjs` 自检索引与包的一致性；加 `--remote` 会通过 `git ls-remote` 校验索引钉定的 commit 确实存在。
- 发版顺序：改版本号 → `npm test` → `npm publish` → 更新 `index.json` 的 `version` / `publishTimestamp` / `source` → `npm run verify:index -- --remote` → 提交推送。

## 连接

1. 打开 `http://127.0.0.1:59121/mota`（如果 Harness 换了端口，把 origin 换掉即可）。
2. 把 Creator Center 给出的整段绑定说明粘进「粘贴绑定说明」，点「解析」，或直接填写：
   - **Queue 地址**：Creator 回执里签发，形如 `https://…/publics/bound/queue/…`；
   - **BOUND_PULL Agent Token**：`mpk_` 开头；
   - **Agent Code**：Creator 页面上的 Agent Code；
   - **岗位**：与 Creator 上注册的岗位一致，插件不接受自行推断的岗位；
   - **Worker ID**：可留空自动生成；同一个 Worker 请保持稳定。
3. 点「保存并连接」。插件会先做一次真实心跳，成功后状态变为在线。
4. 回到 Creator 页面点 **Test connection**。它是平台侧的真实心跳探测，只有这条链路成功才会通过。
5. 之后 Creator 派发的任务会出现在页面「最近任务」里，包含 runId、回执、耗时。

断开并清除会同时停止 Worker 并删除本机凭据记录 `mota/connection`。

## 运行行为

- 心跳间隔以平台返回的 `heartbeatIntervalSeconds` 为准（默认 60 秒，插件限制在 5–600 秒）。
- `claim` 使用 40 秒读取超时（平台长轮询上限 30 秒）；返回 204 立即再取。
- 租约（`leaseExpireAt`）剩余时间约 1/3 时续租；续租冲突（409）会取消当前执行、不回传。
- 回传只认 HTTP 200 + `accepted` 布尔值；网络 / 5xx / 429 会用**完全相同**的字节重试，重试预算用尽则保留原结果，等平台重新派发同一 runId 时原样重放，不会重复执行。
- 参数错误（`000002`）、401、403 会停止所有循环，并在页面上显示原因，等待人工更新 Token。
- 单 Worker 同时只执行一个任务；不做无上限并发。
- 总 Token、输入、输出、缓存、推理用量都来自子 Agent 的 `assistant/message` 事件；拿不到真实用量时任务按失败处理，不会伪造数字。

## 输出契约

每个岗位的 `payload_result` 都按插件内置的 V2 岗位 schema 校验（`schemas/*.json`，来自官方 mota-bind 创作者套件），校验项包括：

- 顶层恰好是 `payload_result`、`payload_info`、`contract_version: "V2"`、`usage`；
- `runId` 只放在 `X-MoTA-Run-ID` 请求头，不出现在 body；
- `payload_info` 非空，并在末尾追加官方免责声明：
  - 中文：`AI 生成的研究参考，不构成投资建议。`
  - 英文：`AI-generated research for reference only, not investment advice.`
- `usage.totalTokens` 为 ≥1 的整数，`cachedInputTokens ≤ promptTokens`。

契约不满足时会让子 Agent 带着具体问题自修复，最多 3 轮；仍不满足则本任务不回传，页面会记录失败原因。

## 配置项（`cordis.patch.yml`）

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `language` | `zh` | 输出免责声明语言，`zh` 或 `en` |
| `taskTimeoutSeconds` | `600` | 单个任务一轮生成的超时 |
| `selfCheckTimeoutSeconds` | `60` | 平台自检超时 |
| `allowInsecureLoopback` | `false` | 仅本地假队列调试用：允许 `http://127.0.0.1` / `localhost` 队列 |
| `autoStart` | `true` | 插件加载时自动用已保存的连接启动 Worker |

真实 Creator 队列必须是 `https`；不要为真实环境打开 `allowInsecureLoopback`。

## 安全与数据

- Token 存在 DSH 凭据库（GrantRecord，key `mota/connection`），设置页只显示掩码。
- 发往模型的业务输入会做凭据键清洗（`authorization`、`access_token`、`api_key`、`password`、`cookie` 等），`runtimeContext` 只保留协议允许的字段。
- 任务内容会发送给本机 DSH 当前配置的模型提供方；这是执行任务的必要条件。
- 队列请求不跟随重定向，错误信息与页面状态都不回显完整 URL 或 Token。
- 执行任务的子 Agent 与本机 Harness 共享工具权限（当前 DSH API 无法安全地“禁用全部工具”）。插件在系统提示里明确禁止调用工具并把任务数据标记为不可信，但这只是提示词层的约束，**请只接入可信的 Creator 账号**。

## 已知限制

- 未实现 Token 轮换的「候选 Token」流程：Worker 遇到 401 会停止并等待人工粘贴新 Token；不会自动提升候选 Token。
- 未实现 Push 通道、`mbt_*` 签名密钥或托管式 Agent。
- 平台侧预检（`/publics/bound/validate`）和评测仍由 Creator 侧跑；插件只保证契约与协议层面的正确。
- 一个 Worker 一个并发；多并发需要部署多个 Worker ID。
- 子 Agent 执行期间会出现在本会话的子 Agent 列表里（`origin: subagent`），任务完成后会话被释放。
- `allowInsecureLoopback` 只适合本机假队列测试，不可用于生产。

## 开发与测试

在仓库根目录执行：

```bash
node --test test/
```

测试覆盖：子集 JSON Schema 校验、信封/用量检查、真实用量汇总、假队列上的心跳/领取/续租/回传/字节一致重试/`000002` 处理、以及插件入口的页面与连接/断开 API。

本地端到端调试：在一个终端起一个假队列（实现 `heartbeat/claim/renew/complete` 四个 POST 端点），在插件配置中把 `allowInsecureLoopback` 设为 `true`，然后用 `http://127.0.0.1:<port>/publics/bound/queue/<id>` 连接。
