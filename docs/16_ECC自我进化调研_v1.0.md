# ECC（Everything Claude Code）自我进化体系深度调研 v1.0

> 调研对象：https://github.com/affaan-m/ECC（本地完整源码位于 `参考项目资源/ECC-main/`）
> 调研目的：为「星图」的**小星自我进化智能体**（每账户初始提示词一致 → 随使用沉淀出独属于该用户的进化提示词，作为用户个人资产存入账户数据库）提供可借鉴的思想、机制与实现。
> 调研日期：2026-08-29。基于 main 分支完整源码精读（README/zh-CN、continuous-learning-v1/v2、unified-memory、rules-distill、growth-log、memory-persistence hooks、instinct-cli.py、observer 代理、ecc2 Rust 控制面、Memory Vault 设计文档等）。

---

## 0. 结论速览（给产品决策者）

1. **ECC 不是"AI 产品"，而是一套"让智能体随使用变聪明"的工程体系**。它把"自我进化"拆成了五个可独立复用的机制：**观察（100% 确定性采集）→ 模式抽取（后台低成本模型）→ 原子沉淀（置信度加权）→ 聚类进化（原子→技能）→ 记忆分层（会话态/项目态/个人态）**。星图的小星进化层可以直接把这套流水线从"编程智能体"翻译到"人生助手智能体"。
2. **最值得抄的三样东西**：
   - **instinct（本能）数据模型**：`trigger + action + confidence + evidence + scope` 的原子结构，置信度随"确认/矛盾/时间"升降——这正是"小星慢慢懂你"的量化骨架；
   - **"记忆≠指令"的信任边界**：所有机器沉淀的内容默认 `unreviewed`，可被用户查看、纠正、删除，永不自动变成硬规则——与星图"助手姿态、用户主体"的底色完全一致；
   - **观察与生成解耦**：采集走确定性钩子（100% 可靠），分析走后台低成本模型（Haiku 级）异步跑，绝不阻塞主对话——对应星图"保存后异步抽取"的既有管线，可以直接升级。
3. **关键取舍已经替我们验证过**：v1（会话结束才学、直接产出大技能）→ v2（每次工具调用都观察、先产原子本能再聚类进化）的演进，结论是"**原子 + 置信度 + 异步后台观察**"全面胜出——星图应该直接从 v2 形态起步，不要重走 v1 弯路。
4. **与星图的差异点（不能照抄的地方）**：ECC 的"项目 scope/全局 scope"是"这个项目 vs 所有项目"；星图里每个账户的进化提示词**全部是 user 级个人资产**（星图的"项目"≈"人生阶段"，可以保留 project 层用于分阶段沉淀，但不存在跨用户的"全局"共享）。ECC 的观察对象是"工具调用"，星图的观察对象是"对话内容与用户对产出的反馈"。
5. **可直接复用的实现资产**：instinct 的 YAML frontmatter 契约、置信度升降规则（+0.05/-0.1/-0.02/周）、关键词重叠贪心聚类（`instinct-cli.py` `_cluster_by_keyword_overlap`）、Memory Vault 的 Markdown 文档契约与 create-only 写入、growth-log 的"伯乐原则"去重——全部 MIT 许可，可放心借鉴。

---

## 1. 项目概况

| 项 | 内容 |
|---|---|
| 仓库 | [affaan-m/ECC](https://github.com/affaan-m/ECC)（旧名 everything-claude-code） |
| 定位 | "Agent harness performance optimization system"——面向 Claude Code / Codex / OpenCode / Cursor 等编程智能体的**性能优化系统**：技能、本能、记忆、安全、研究优先 |
| 规模 | 244k+ stars，68 个代理 / 286 个技能 / 94 个命令 / 40+ 钩子；作者 [@affaanmustafa](https://x.com/affaanmustafa)，Anthropic x Forum Ventures 黑客松获胜者，10+ 个月生产环境实战打磨 |
| 许可证 | **MIT**（可自由使用、修改） |
| 版本 | v2.2.0（2026-08），v2.1 起为"智能体 Harness 操作系统"（261 技能 + 控制面基底） |
| 与"自我迭代"的关系 | 用户关注的核心在三个子系统：**continuous-learning-v2（本能学习）**、**unified-memory / Memory Vault（统一记忆）**、**growth-log + rules-distill（经验蒸馏与晋升）**，外加 memory-persistence 生命周期钩子作为基础设施 |

> 澄清：ECC 的"持续学习"学的是**编程偏好**（代码风格、工具使用、调试手段），不是人格。但它的**机制抽象与人格无关**——星图要做的就是把这套机制的对象换成"用户的情绪模式、语言习惯、人生主题、对建议的反馈"。

---

## 2. 核心子系统深挖

### 2.1 continuous-learning-v2：本能（Instinct）学习系统 ⭐最核心

**一句话**：把每次会话变成"原子本能"（一条带置信度的小行为），再聚类进化成技能/命令/代理。

#### 2.1.1 数据流（全链路）

```
会话活动（git 仓库中）
   │ PreToolUse/PostToolUse 钩子捕获提示词+工具调用（100% 可靠）
   │ + 自动识别项目（git remote / 路径 → 12 位 hash）
   ▼
projects/<project-hash>/observations.jsonl     ← 原始观察（带 project_id/name）
   │ 后台 Observer 代理读取（Haiku，低成本，间隔 5 分钟 / 攒满 20 条）
   ▼
模式检测（4 类）：
   ① 用户纠正（"不，用 X 不用 Y"）→ instinct "做 X 时，优先 Y"
   ② 错误解决（错误→修复序列重复出现）→ instinct "遇到错误 X，试 Y"
   ③ 重复工作流（同一工具序列）→ 工作流 instinct
   ④ 工具偏好（总是 Grep 后再 Edit）→ instinct "需要 X 时，用工具 Y"
   ▼
原子本能（YAML 文件，projects/<hash>/instincts/personal/ 或全局）
   │ /evolve 聚类 + /promote 跨项目晋升
   ▼
evolved/ 目录 → skills/commands/agents（可直接被 harness 加载）
```

#### 2.1.2 本能数据模型（可直接借鉴的契约）

```yaml
---
id: prefer-functional-style            # 唯一 ID
trigger: "when writing new functions"  # 触发条件（何时适用）
confidence: 0.7                        # 置信度 0.3~0.9
domain: "code-style"                   # 领域标签（便于分组）
source: "session-observation"          # 来源（观察/仓库分析/导入）
scope: project                         # project | global
project_id: "a1b2c3d4e5f6"             # 归属项目
---
# Prefer Functional Style
## Action
Use functional patterns over classes when appropriate.
## Evidence
- Observed 5 instances of functional pattern preference
- User corrected class-based approach on 2025-01-15
```

**设计要点**：
- **原子**：一条本能 = 一个 trigger + 一个 action，不写大而全的规则；
- **置信度加权**：0.3 试探（建议但不强制）→ 0.5 适度（相关时应用）→ 0.7 强（自动批准）→ 0.9 近乎确定（核心行为）；
- **证据背书**：每条本能记录它由哪些观察产生（可追溯、可审计）；
- **scope 隔离**：项目级默认，全局晋升需跨 2+ 项目 + 平均置信度 ≥0.8——防止污染。

#### 2.1.3 置信度演化规则（实现于 observer.md）

| 事件 | 调整 |
|---|---|
| 首次观察 1-2 次 | 初值 0.3 |
| 观察 3-5 次 | 0.5 |
| 观察 6-10 次 | 0.7 |
| 11+ 次 | 0.85 |
| 每次确认性观察 | +0.05 |
| 每次矛盾观察（用户纠正） | **-0.1**（矛盾惩罚大于确认奖励） |
| 每周未被观察到 | -0.02（**时间衰减**） |

→ 翻译到星图：用户纠正（"说得不对"）应该比默认接受降权更快；长期不出现的偏好应缓慢衰减，保证小星"懂的是现在的你"。

#### 2.1.4 进化（/evolve）：原子 → 技能

`instinct-cli.py` 的 `_cluster_by_keyword_overlap`：对 trigger 做关键词提取（去停用词），贪心聚类（共享词比例 ≥ 阈值），把相近本能的**共享核心词**作为簇标签，簇聚合成技能/命令/代理。**关键工程细节**：trigger 是自由文本，用整串归一化聚类会把每条都孤立成簇，所以必须用"关键词重叠"聚类——星图做"话题归并"时同样适用（星图已有 LLM 抽取归并 mergeToId，此算法可作为**无 LLM 兜底**的确定性归并器）。

#### 2.1.5 v1 → v2 的演进教训（避免重走弯路）

| 维度 | v1（已废弃） | v2（当前） | 为什么 |
|---|---|---|---|
| 观察时机 | Stop 钩子（会话结束） | PreToolUse/PostToolUse（每次工具调用） | **"技能是概率性的（~50-80% 触发），钩子 100% 触发"**——学习不能依赖概率 |
| 分析位置 | 主上下文 | 后台 Observer（Haiku 廉价模型） | 不占主对话 token、不拖慢主流程 |
| 沉淀粒度 | 直接产出完整技能 | 原子本能 → 聚类 → 技能 | 完整技能一次性产出质量差、难合并 |
| 置信度 | 无 | 0.3-0.9 加权 + 衰减 | 无置信度 = 无法区分"偶发"与"习惯" |
| 共享 | 无 | 导出/导入 | 个人资产可迁移 |

#### 2.1.6 隐私设计（对星图极重要）

- observations **只留在本地**；可导出的只有"本能（pattern）"，**不含原始对话/代码**；
- 用户控制导出与晋升；
- 观察文件 30 天自动清理；
- observe.sh 内置线性时间密钥清洗（不落盘任何密钥形状）。

### 2.2 unified-memory / Memory Vault：跨会话记忆分层 ⭐

**一句话**：把"会话态上下文"沉淀为可检查、可搜索的 Markdown 记忆文档，作为各 harness 间的共同上下文层。

#### 2.2.1 三级 scope

| scope | 位置 | 用途 | 星图翻译 |
|---|---|---|---|
| project | `<repo>/.ecc/memory/project/` | 仓库本地上下文（fail-closed .gitignore 保护） | 用户当前"人生阶段"层 |
| team | `<repo>/.ecc/memory/team/` | 供人类复核、可版本化共享 | （星图无团队，可省） |
| user | `~/.ecc/memory/` | 跟随用户跨仓库的**个人资产** | **账户级个人资产层（核心）** |

#### 2.2.2 关键契约（Memory Vault 设计文档 + unified-memory skill）

1. **Markdown 是唯一事实源**（`ecc.memory.v1` 文档契约：contexts/decisions/facts/handoffs/lessons/notes/preferences/runbooks 八类）；SQLite/向量/嵌入只是索引，永不是唯一副本——**星图的进化提示词也应以人类可读文件为事实源，存于账户数据库，便于导出、审计、删除**。
2. **记忆是上下文，不是指令**：所有条目默认 `trust: "unreviewed"`，**不能**静默变成规则/技能/策略；已核实的知识进入"受治理的项目文档"，而不是改记忆的信任字段。
3. **create-only 写入**：工具永不覆盖已有记忆 ID；"取代"以新文档 + 显式链接表达，历史可追溯。
4. **本地优先**：无模型、无网络、无数据库也能用；召回是有界词法检索，语义重排是可选的后续适配器。
5. **user scope 必须显式请求**，绝不隐式包含——个人资产的访问要有门槛。
6. **召回内容一律视为不可信数据**，不得作为指令执行；重要断言须对照权威来源复核。
7. 拒绝写入已知密钥形状；读取不跟随符号链接；handoff 文档固定五要素（目标与当前状态 / 已收集证据与已跑命令 / 涉及文件 / 剩余工作与风险 / 下一个具体动作）。

### 2.3 memory-persistence 生命周期钩子：什么时候记、什么时候读

`hooks/memory-persistence/` 定义了完整生命周期契约（全部非阻塞）：

| 事件 | 钩子 | 作用 | 星图翻译 |
|---|---|---|---|
| SessionStart | session-start | **有界**加载上一次上下文（`ECC_SESSION_START_MAX_CHARS` 限制）+ 识别项目状态 | 每次打开小星对话，注入当前"进化提示词摘要"（有长度上限） |
| PreCompact | pre-compact | 上下文压缩前保存状态 | 长对话触发总结前先落盘 |
| PreToolUse/PostToolUse | observe-runner | 观察工具意图与结果 | 每次对话消息前后落盘（星图已有 chats.json 全量持久化，天然满足） |
| SessionEnd | session-end | 会话结束时持久化摘要 | 当天 6:00 日报前，把当天对话做总结归档 |

配套操作符保障：`ECC_SESSION_START_CONTEXT=off` 可整体关闭上下文注入；钩子按 profile 分级（`ECC_HOOK_PROFILE`）；禁用清单（`ECC_DISABLED_HOOKS`）——**用户始终有权关闭进化**。

### 2.4 动态系统提示注入（contexts/）：初始提示词 + 分层注入

longform 指南的进阶模式：基础人格放 CLAUDE.md（每次加载），**按场景动态注入不同上下文**：

```bash
claude --system-prompt "$(cat ~/.claude/contexts/dev.md)"      # 开发模式
claude --system-prompt "$(cat ~/.claude/contexts/review.md)"   # 评审模式
claude --system-prompt "$(cat ~/.claude/contexts/research.md)" # 研究模式
```

要点：**系统提示内容权威性 > 用户消息 > 工具结果**；"手术刀式"控制什么上下文在什么时候加载，而不是一次全量加载。

→ 星图映射：**初始提示词（模板，全员一致）作为基座** + **进化层（个人资产）按需注入** + 会话开始时只注入"有界摘要"（类似 ECC_SESSION_START_MAX_CHARS），避免个人资产无限膨胀吃掉上下文。

### 2.5 growth-log：经验记录的方法论（怎么写才不白写）

核心三条规则（本项目的"日报/复盘内容哲学"可参考）：

1. **失败 > 成就**：一次 2 小时才找到的 bug 比 3 个一次跑通的功能更有营养；
2. **伯乐原则**：写之前先查——同一根因的新症状合并进旧条目，不重复建条目；
3. **必须可迁移**：每条必须能写出"下次遇到 [信号]，我会 [行动]"，写不出就是没提炼出模式。

模板固定四段（Context / Root Cause / Pattern+Signal / Related），4-8 句为度。反模式："修了支付模块的 bug"（是日记不是学习产物）。

→ 星图映射：这是**日报"观察"与"成长规划"的内容质量标准**——观察必须可迁移、可触发，不能是流水账。

### 2.6 rules-distill：经验如何晋升为规则（治理闭环）

"**确定性收集 + LLM 判断**"：脚本穷举收集 → LLM 跨读裁决。候选必须同时满足三层过滤：

1. 出现在 **2+ 个技能**中（单处出现的留在原地）；
2. 能写成 **"做 X / 不做 Y"** 的可行动作（不是"X 很重要"）；
3. 能说出**违反风险**（忽略它会出什么问题）。

裁决六类：Append / Revise / New Section / New File / Already Covered / Too Specific。**绝不自动改规则，必须用户审批**（Approve/Modify/Skip）。

→ 星图映射：小星的"进化提示词"从"经常出现的模式"晋升为"稳定人格设定"时，应同样要求"多次出现 + 可行动 + 用户可审"，且**给用户看得到、改得了、删得掉**的界面（呼应"个人资产"定位与数据权利）。

### 2.7 ECC2（Rust 控制面）：工程细节参考

`ecc2/`（4,417 行 Rust）值得借鉴的工程点：

- **DbWriter 专用线程**：SQLite 写入走 `mpsc::unbounded_channel` + oneshot 确认，解决"异步上下文写 SQLite"的锁争用——星图多用户下进化层写入可参考；
- **会话状态机**：`Pending → Running → {Idle, Completed, Failed, Stopped}` 强转换约束——进化层条目应有明确状态机（observed → candidate → confirmed → promoted → retired）；
- **工具调用风险评分**：4 轴（基础风险/文件敏感性/爆炸半径/不可逆性）合成 0-1 分，映射 Allow/Review/Confirm/Block——星图可借鉴为"进化提示词变更的风险分级"（改语气=低风险自动；改价值观=需复核）。

---

## 3. 可借鉴资产清单（星图落点）

| # | ECC 资产 | 内容 | 星图可用点 | 借鉴方式 |
|---|---|---|---|---|
| 1 | instinct YAML 契约 | id/trigger/confidence/domain/source/scope/evidence | 小星"个人资产条目"的数据结构 | 直接改造：trigger→"什么情境下适用"，action→"小星应如何回应"，domain→生活域/人格维度 |
| 2 | 置信度演化规则 | 初值分档 +0.05/-0.1/-0.02 周衰减 | "小星懂你多少"的量化与纠错权重 | 直接采用数值设计 |
| 3 | 观察-分析解耦 | 钩子 100% 采集 + 后台廉价模型分析 | 星图保存后异步抽取（现有 `/api/record` 管线）升级为"每次对话后异步观察" | 架构直接映射 |
| 4 | scope 隔离 | project/global + 跨项目晋升 | user（账户）/stage（人生阶段）两层个人资产 | 改造：无 global，全部归属账户 |
| 5 | /evolve 关键词重叠聚类 | 贪心聚类 + 共享核心词 | 主题归并的确定性兜底（无 LLM 时） | 代码级复用（MIT） |
| 6 | Memory Vault 文档契约 | Markdown 事实源 + 八类条目 + create-only + trust 字段 | 进化提示词的存储格式与审计 | 直接采用文件契约思想 |
| 7 | "记忆≠指令"边界 | unreviewed 默认 + 人工复核才晋升 | 小星进化内容默认"软偏好"，不自动变成硬规则；危机/红线永远硬编码优先 | 原则直接采纳 |
| 8 | 生命周期钩子 | SessionStart 有界加载/PreCompact/SessionEnd 摘要 | 对话开场注入进化摘要（有界）、6:00 日报前归档 | 映射到星图 API 时序 |
| 9 | 动态系统提示注入 | contexts/ + CLI 注入 | 初始提示词基座 + 进化层按需注入 | 架构映射 |
| 10 | growth-log 三规则 | 失败>成就/伯乐原则/必须可迁移 | 日报"观察"与成长规划的内容质量标准 | 内容方法论 |
| 11 | rules-distill 三层过滤 | 2+ 证据/可行动/违反风险 + 用户审批 | 进化条目晋升审核标准 + 用户可见/可改/可删 | 治理机制映射 |
| 12 | observe.sh 安全清洗 | 线性时间密钥匹配、30 天清理 | 对话内容落盘前脱敏（危机词、敏感信息分类） | 工程参考 |
| 13 | ECC2 状态机与 DbWriter | 强转换状态机 + 写线程隔离 | 进化条目生命周期、多用户写入并发 | 工程参考 |

---

## 4. 对星图「小星自我进化智能体」的初步映射（待与日记调研合并后定稿）

> 本节为方向性映射，最终方案等 `docs/17_日记类产品调研_v1.0.md` 与产品决策合并后再定。

**目标形态**：小星 = 基座提示词（模板一致）+ 进化层（账户个人资产）。进化层在用户数据库里以人类可读文档为事实源，随每次对话/反馈异步更新，注入时走"有界摘要"。

**建议的进化流水线（星图版）**：

```
用户对话/日记/反馈（每次落盘）
   │ 确定性采集（星图已全量持久化 chats.json + 记录，天然 100%）
   ▼
异步 Observer（低成本模型，不阻塞回复）
   │ 检测 4 类信号：
   │   ① 用户纠正（"不是这样的/你没懂我"）→ 负向证据
   │   ② 有效互动（采纳建议/继续深聊）→ 正向证据
   │   ③ 重复模式（话题、情绪触发、语言习惯）
   │   ④ 偏好（喜欢直接结论 vs 喜欢解释；喜欢测验 vs 只聊正事）
   ▼
个人资产条目（instinct 式：trigger/behavior/confidence/domain/evidence + trust:unreviewed）
   │ 置信度升降（+确认/-矛盾/时间衰减）
   ▼
晋升与聚类（≥阈值 + 多次证据 → 进入"稳定人格层"；用户可见、可改、可删、可导出）
   ▼
注入：会话开始时按场景注入有界摘要；红线（危机转介/命理/医疗边界）永远硬编码优先
```

**三个必须守住的红线（映射 ECC 的信任边界）**：
1. **进化层默认"软偏好"，永不自动成为硬规则**——尤其不得让进化结果覆盖危机识别、命理红线、医疗边界等宪法级约束；
2. **用户主权**：个人资产属于用户——可查看、纠正（降权）、删除、导出；这是"个人资产数据"的产品承诺；
3. **观察数据与展示数据分离**：原始对话留在记录层，进化层只沉淀"模式"，不沉淀原始内容（对应 ECC"只导出 pattern 不导出观察"）。

---

## 5. 参考来源

- ECC 仓库：[github.com/affaan-m/ECC](https://github.com/affaan-m/ECC)（本地完整源码 `参考项目资源/ECC-main/`，2026-08-29 main 分支）
- 中文 README：`ECC-main/README.zh-CN.md`
- continuous-learning-v2：`skills/continuous-learning-v2/`（SKILL.md、hooks/observe.sh、scripts/instinct-cli.py、agents/observer.md）
- continuous-learning v1（废弃说明与 v1/v2 对比）：`skills/continuous-learning/SKILL.md`
- unified-memory：`skills/unified-memory/SKILL.md` + `docs/design/ecc-memory-vault.md`
- memory-persistence：`hooks/memory-persistence/`（README.md、hooks.json）
- growth-log：`skills/growth-log/SKILL.md`
- rules-distill：`skills/rules-distill/SKILL.md`
- 动态注入与内存持久化：`the-longform-guide.md`（§Context and Memory Management、§Continuous Learning / Memory）
- ECC2 分析：`research/ecc2-codebase-analysis.md`
- 官网与生态：[ecc.tools](https://ecc.tools)、[npm ecc-universal](https://www.npmjs.com/package/ecc-universal)、[everything-claude-code 指南](https://agskills.dev/affaan-m/everything-claude-code/continuous-learning)
