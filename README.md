# DSH 多模型协作压缩

新插件提供模型处理与设置页；billion-context 仍是唯一压缩范围、历史保留和提交者。主会话继续使用它原来的 DeepSeek 模型。

- A：通过 DSH 的 LLM 服务，使用可配置 Provider / Model 和 billion-context 的压缩指令生成候选。默认 `deepseek-account/deepseek-flash`，复用本机 DSH 账户，不另存密钥。
- B：Claude Messages 的原生按需压缩 `compaction: {type: "summarize"}`，beta `compact-2026-09-04`，默认 `claude-sonnet-5-5`。不把普通聊天摘要冒充原生压缩。
- 审核：`gpt-6.1-terra` Responses API，同时读取本次原始历史、A、B。`store:false`，推理强度可调。
- 关闭交叉审核时只运行所选摘要源：Claude 开启为 B，否则为 A；交叉审核开启时为 A+审核或 A+B+审核。独立事实核验可单独开关，任一启用阶段失败均不提交。
- Key 从 `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` 读取；Windows User/Machine 环境变量异步读取并缓存。不写入源码、运行记录或设置页。

## 引擎适配

基于 billion-context v0.1.209 的本地分支。复用 `compress.externalSummary` 和 `providers`，不新增第二套调度器。插件启动时在 IPv4 loopback 建立带随机令牌的本地摘要服务；引擎私有凭据库只保存本地服务令牌。

`compress`、后台预先折叠和 `/compact` 共用引擎范围与校验。候选生成期间只隔离压缩相关字段；草稿不进入持久化队列，提交按字段增量合并，保留懒加载 Map 和无关状态。整批通过才提交，版本冲突放弃。严格模式禁用紧急 CPU 摘要、摘要截短补救、近期保留区放宽；无法安全压缩时明确失败，不牺牲已保护历史。跨多轮压缩读取缓存原文；原文缺失时拒绝只对旧摘要进行审核。

原始会话和恢复材料继续由 DSH 与 billion-context 保存。模型处理不写入角色、人设或记忆插件。正常配置关闭或插件停用恢复之前的压缩配置。异常进程退出时旧本地端点可能不可达，此时压缩失败；重新启动 DSH 重建端点即可。

## 设置与观察

DSH 设置 → 多模型协作压缩。可配置开关、模型、环境变量名、推理强度、超时重试、摘要预算、近期保留 token 和自动折叠目标。默认由模型决定何时压缩以及范围，自动折叠目标仅在关闭模型规划时供原流程使用。请求容量预检采用保守 UTF-8 字节上界；超过预算拒绝，需缩小范围。

每次运行显示 A/B/审核阶段、模型、耗时、usage 和错误，不记录密钥或聊天正文。`validated` 只代表候选校验成功，不代表已提交；最终提交见 billion-context 的压缩回执和会话块。费用不估算，Claude usage 使用 `usage.iterations`，避免误记为 0。

本地适配通过 `link:` 安装，避免市场更新覆盖修改。更新 billion-context 前须重放本地补丁、构建并回归测试；保留安装前备份，不宣称对未知新版本自动兼容。

## 验证

`node --test test/*.test.js`；引擎运行 `tests/collaborative-transaction.test.ts` 与已有 external-summary、DSH native 测试。真实模型测试仅使用合成内容，避免把现有私人聊天当作测试数据。

### 本机验收记录（2026-11-01）

- 新插件单元测试 6/6；ACP 事务与外部摘要回归 28/28；新增命令注册回归 2/2，手动 compact 精确会话与范围转发 1/1；TypeScript 检查和构建通过。
- 真实 DSH 摘要 A + Claude 原生压缩 + Terra 审核成功，实际提交两个隔离测试范围。持久化后重新载入，两个块及完整原文均恢复。测试材料为虚构项目，不涉及私人会话。
- 完整 DSH native 扩展回归中有两项未通过：Windows 临时 SQLite 文件被占用（EBUSY）；runtime-death 用例等待 Promise 时事件循环退出。尚未证明与本次补丁无关，因此不宣称全库测试通过。
- 设置页已目视核验；桌面代理移除 Origin 的兼容问题改用随机 CSRF 令牌校验，同时保留 loopback Host / 跨站拒绝。
- 主动自动触发和手动入口共用事务代码；尚未用现有私人会话做破坏性端到端压缩。

## 安装（Windows / PowerShell 7）

本插件使用 [billion-context](https://github.com/ranxianglei/billion-context) 及其 [acp-kernel](https://github.com/ranxianglei/acp-kernel)。适配基于 v0.1.209，提交 39a0ada58f396ec6e5ee29fdbaa01c01b74f14d9；补丁与上游完整许可位于 patches/，并非上游官方发行版。

需要 Node.js 22、npm、Git、已安装的 DSH 和可调用相应模型的账户。先关闭 DSH 再安装，安装完成后重新打开。克隆目录须长期保留，安装使用本地目录链接。

1. 克隆本仓库：

~~~powershell
git clone https://github.com/ThirvenGree/dsh-collaborative-compaction.git
cd dsh-collaborative-compaction
pwsh -File ./prepare-engine.ps1
pwsh -File ./install.ps1
~~~

2. 若已构建适配引擎，可给 install.ps1 传入 -EnginePath；自定义 DSH profile 用 -ProfilePath 指定。安装前自动备份原包和配置，不覆盖其他目标的现存链接。安装脚本不负责停止正在工作的 DSH。
3. 通过 Windows 环境变量设置 ANTHROPIC_API_KEY 和 OPENAI_API_KEY，勿提交到仓库。插件默认关闭，在 DSH 设置「多模型协作压缩」中开启，确认模型名称与账户权限。
4. 自动压缩继续由 billion-context 调度；在正常会话中可用 /compact 手动触发。受保护的近期历史不足以提供压缩范围时不会强行压缩。
5. 可运行 node live-test.mjs 测试正在运行的本地摘要服务；会调用真实账户并产生费用，只使用脚本内合成内容。

GitHub Release 提供插件安装包及引擎补丁；不会托管你的 DSH 会话、提供云端服务或携带密钥。仅安装插件压缩包不足以完成引擎适配，仍须执行上述准备与安装步骤。

## 许可

新插件代码采用 MIT；billion-context 补丁涉及的上游代码遵循 patches/billion-context-LICENSE（包含产品出处标注附加条款）。

## 0.2.0：模型规划与事务修正

- 正常请求有合法候选历史时，请规划模型（默认 Terra，可切换）决定现在压缩、暂不或不确定；手动 /compact 和 compress 也进入同一规划路径。规划读取候选范围、上下文容量、近期任务片段，不以固定 token 阈值替代模型选择。片段有截取标记；规划只是提案，保护区、工具配对、范围和历史版本由引擎最终核验。没有合法历史时不调用模型。
- 低于硬性安全阈值时，规划暂缓不压缩、规划失败保留原文。达到有效上下文预算（含上游输出预留）的 90% 时，系统覆盖暂缓、不确定和规划失败；优先执行模型选择的合法历史，不足时由原引擎继续选取候选，目标降到有效预算的 81%。预算估计含系统/工具开销、图片预留和现有估计校准。不会放宽近期保护、工具配对、原文保留或独立审核；若无法安全压缩，容量检查仍可阻止请求。调用量会高于仅阈值触发，设置页分别记录规划、摘要、交叉审核与事实核验。规划记录 decided、摘要 validated 都不等于引擎已提交。
- 新增独立事实核验：单独模型调用对照原文与最终摘要，并要求逐项引用证据。代码验证证据原文和摘要引文确实存在；核验不通过或引文不匹配拒绝提交。该机制减少错误，不构成所有语义事实的数学证明。
- 引擎配置路径遵循 BILI_CONFIG_FILE > XDG_CONFIG_HOME > 默认目录；备份按实际路径分开。
- 安装脚本在失败后恢复包、链接、manifest 和锁文件。中断后保留事务记录，可用同一 ProfilePath 执行 install.ps1 -Rollback 恢复。

本版验证：插件单测 11/11；引擎事务与规划专项 17/17，既有外部摘要回归 23/23；手动路由专项通过，构建与类型检查通过。实际安装链路中模型选出两个范围，A、B、交叉审核、独立事实核验全部成功，提交后原文保留且持久化重载恢复。安装回滚在创建链接后和修改 manifest 后分别注入失败，均恢复原状态。较广 DSH native 运行时恢复用例仍存在事件循环提前退出问题，未宣称全库通过。
