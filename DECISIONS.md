# DECISIONS

Project-level decision log for the dsh-model-flatmap plugin. Append-only: new
entries go below the marker, newest first; old entries are never rewritten.

<!-- APPEND-ONLY LOG: 新条目插入到此行之后 -->

## DEC-021 — 2026-11-13 — 命中截断的模型名行：hover 0.5s 后向左跑马灯，badge 不参与

**Context.** 模型行的主文本（provider 分组下是模型名，family 分组下是 provider 名）在列宽
不足时会变成 `DeepSeek Reasone…`，唯一的完整文本入口是 `title` tooltip——要等系统 tooltip
的延迟，读起来很钝。用户要求：名称显示不完（出现 `…`）时，hover 达到 0.5 秒才开始向左跑
马灯；速度不要太快也不要太慢；**跑马灯内容只包含主内容**，右对齐、始终显示的 `限时免费`
等 badge 不能跟着动。

**Decision.**

- **分层：窗口 + 轨道。** 行的主文本包进 `.dshmf-rowNameWindow`（`overflow: hidden` +
  `text-overflow: ellipsis` + `nowrap`），里面是 `.dshmf-rowNameTrack`（
  `display: inline-block; width: max-content`，所以内容可以比窗口宽）。**只有轨道平移**，
  `.dshmf-rowProvider`（family 变体标签）、`.dshmf-badge`（限时免费 / ×0.1）、
  `.dshmf-rowTail`（spinner）都是窗口的**兄弟**，留在原地。这是「跑马灯内容仅限主内容」
  的结构性保证，而不是靠裁剪尺寸去凑。
- **触发是「停留」而不是「进入」。** `onMouseEnter` 只负责挂一个 `MARQUEE_DELAY = 500ms`
  定时器；`onMouseLeave` 会先 `disarm` 再清理，所以**在 0.5s 内划过去的行永远不会启动**
  （否则快速扫过整个网格会留下一排还在滚的行）。定时器触发时才测量
  （`clientWidth` / `scrollWidth`），此刻行已完成布局，也不需要首帧就同步读取样式。
  键盘 `focus` 同样算「停留」，`blur` 同样停止。
- **只有真的被截断才动。** `nameClippedBy(window)` 返回 `scrollWidth - clientWidth`，
  ≤1px 视为「放得下」直接不动——短名称 hover 再久也绝不抖。
- **速度恒定，且与溢出量解耦。** `MARQUEE_PX_PER_SECOND = 50`（1px/20ms）。关键帧把一轮
  分成 45% 去、5% 停、45% 回、5% 停，所以周期是 `shift / 0.45`，去程与回程速度都恒为
  50px/s：128px 溢出约 5.7s 一轮，看起来是「缓慢掠过」而不是快闪；再长的名称也不会因为
  距离变长而变快。`MARQUEE_MIN_MS = 900` 兜底，避免 2px 溢出瞬间滑过。
- **位移量 = 截断量，而不是内容宽度。** 只滑到最后一个字形刚好贴住窗口右边为止
  （`translateX(-shift)`，`shift` = 截断像素），所以脚本不会把已经看得见的部分白白再推出去
  一屏、也不会滑到名称右边的空白里。
- **CSS 驱动，JS 只给两个数。** `@keyframes dshmf-rowNameMarquee` +
  `animation: ... linear infinite`，`--dshmf-marquee-shift` / `--dshmf-marquee-duration`
  由行内 style 传入（每行不同）。JS 里没有逐帧循环，也没有 `requestAnimationFrame`，
  与这个面板其余部分的「纯 CSS 定布局」风格一致（见 DEC-013）。
- **`prefers-reduced-motion: reduce` 下完全不动**：此时 `animation: none`，hover 处理器也
  直接返回。ellipsis + tooltip 仍然提供完整名称，信息不丢。
- **同一时刻只有一行在跑。** 状态是 `{ key, shift, duration }`，key 是模型 route
  （`provider/model`），进入新行会把上一行复位。

**Rejected.** 用 `scrollLeft` 或 `rAF` 逐帧推动（会与 CSS 动画抢布局，且每帧触发重排，
网格里几十行时成本不可接受）；用 `marquee`/`<marquee>` 语义或用负 `text-indent` 动画
（无法只动主内容，会把 badge 一起拖走）；在 `onMouseEnter` 里立即测量并启动（违背
「0.5s 停留」的要求，且首帧布局可能未稳定）；把 badge 放进轨道里再反向补偿（两套动画要
同步，任意一帧错位都会露出来）；无限来回滚动（用户要的是「看不全时能读全」，读完后应当
安静下来，而不是永久跳动——本实现每轮结束回到起点并在下一轮前停顿，鼠标不移开才继续）。

**Consequences.** 纯渲染/CSS 变更，没有布局、planner、probe 或数据流改动：26px 行高不变，
列宽算法不变（`width: max-content` 的轨道被 `overflow: hidden` 的窗口约束住，不会往外顶）。
`.dshmf-rowName` 这个 class 被保留在轨道上，所以删除线（DEC-014）、`x0.1` 小号粗体标记
（MULT_MARKER）和既有测试仍然作用于同一个元素；ellipsis 移到窗口上。测量探针同步改成
「窗口 + 轨道」结构，测得的行高仍然覆盖最宽行。测试从 111 条扩到 112 条：新增「badge 在
窗口/轨道之外」「hover 0.5s 后按截断量启动、离开即停、放得下的名字不动」「0.5s 内划过去
不启动」「CSS 的裁剪、max-content、线性动画与 reduced-motion」以及纯函数几何用例
（速度恒定、位移=截断量、最短时长兜底）。已在 headless Chrome 中按 45% 关键帧定格采样：
轨道 `translateX(-128px)` 后最后一个字形恰好贴住窗口右缘（`trackRight === winRight`），
badge 左缘在 0ms/450ms/700ms 三个采样点均为 236px 不动。


## DEC-020 — 2026-11-13 — 面板加 1px 浅灰边框；图标改用双主题可见的蓝色

**Context.** 两条独立反馈：(1) 面板浮层没有自己的边框，边缘只靠 elevation 阴影和
`--dsw-elevation-stroke-color`，在浅色背景上边界不够明确；(2) `icon.svg` 用
`currentColor` 绘制且整体 opacity 偏低，在深色模式下几乎看不到。

**Decision.**

- `.dshmf-panel` 的 `border: 0` 改为 `border: 1px solid #D1D5DB`（Tailwind
  gray-300，浅灰）。与 DEC-011/DEC-012 同理，**不**使用 `--dsw-alias-border-*`
  token：它们设计上就极淡，达不到"看得见的边框"的要求。深色模式下由
  `body[data-ds-dark-theme]` / `html[data-ds-dark-theme]` 覆盖为 `#6B7280`
  （与 DEC-012 的深色分割线同一灰阶），宽度保持 1px。
- `icon.svg` 不再依赖 `currentColor`：主结构用 `#3B82F6`（蓝 500），次级行用
  `#60A5FA`（蓝 400），底部最弱一行用 `#93C5FD`（蓝 300）。三档蓝色在白底和
  近黑底（#1e1e1e / #2b2b2b / #15161a）上都保持清晰，层级仍由深浅表达，
  不再用 opacity 表达层级（opacity 正是深色下看不见的原因）。

**Consequences.** 纯 CSS / SVG 变更，无布局、DOM、planner 改动。render 测试新增
一条约束：`.dshmf-panel` 带 `1px solid` 的显式灰边框、且深色分支存在。已在 headless
Chrome 中渲染图标于白/浅灰/深灰/近黑四种底色核对可见性。

## DEC-019 — 2026-11-13 — ⛔️ 编号更正：额度不足全局状态的条目为 DEC-017，与列间分割线条目撞号

取代: DEC-017（指「额度不足的删除线是全局状态，不绑定 session / workspace」那条；
撞号的两条旧条目本身均按 append-only 规则保留原样，不做任何改写）。

**Context.** 两个分支并行开发、先后合入 main：一条是「列间分割线是 grid 独立子项」，
一条是「额度不足的删除线是全局状态」。两条都在合并时被编号为 `DEC-017`，于是日志里出现
两个同号条目，违反「每个条目必须有唯一 ID」的硬约束。列间分割线的 `DEC-017` 已作为
后续 `DEC-018`（grid 子项显式指定 grid-column）的 Context 被引用，改动它的编号会波及
那条已经写好的引用；因此保留它的 `DEC-017` 不动。

**Decision.**

- 「额度不足的删除线是全局状态，不绑定 session / workspace」这条决策的**正式编号改为
  `DEC-019`**（即本条），其内容与结论完全不变：模块级共享 mark store、观察全部会话、
  按事件时间定序、持久化到 `localStorage`、判定语义沿用 DEC-015。
- 下方标题仍写作 `## DEC-017 — 额度不足的删除线是全局状态…` 的旧条目由本条声明
  **取代**，按 append-only 规则保留原文、不删除、不重写、不重排。
- 另一条 `## DEC-017 — 列间分割线是 grid 的一个独立子项…` 编号不变、继续有效。

**Consequences.** 日志中出现两个 `## DEC-017` 标题是 append-only 的历史痕迹，但**唯一
有效的决策 ID** 是：列间分割线 = DEC-017，额度不足全局状态 = DEC-019。引用后者时应写
DEC-019。无代码改动。
## DEC-018 — 2026-11-13 — grid 子项必须显式指定 grid-column，不能依赖自动放置

**Context.** DEC-017 把分割线提升为 `.dshmf-grid` 的独立子项，只给了它
`grid-row: 1`，没有指定列，另外两个 `.dshmf-col` 交给自动放置。结果 UI 完全错乱：
CSS Grid 会先放置「行位置已固定」的项目，分割线因此抢到第 1 条轨道，两个 column 被
挤到第 2、3 条轨道，第 1 条 `minmax(0,1fr)` 轨道塌缩成 1px —— 左列被压成一条缝，
各列视觉上叠在一起。上一次的验证只看了「分割线比列高」，没看列的实际位置和宽度，所以
把这个错误读成了成功。

**Decision.**

- `renderColumn` 与 `renderDivider` 都显式写出 `gridColumn` 与 `gridRow: '1'`：
  第 k 列（0 起）落在轨道 `2k+1`，它后面的分割线落在轨道 `2k+2`，即
  col / gutter / col / gutter / col。
- 空态与 failure 条继续用 `.dshmf-empty` / `.dshmf-failure` 的
  `grid-column: 1 / -1` 横跨整行。

**Consequences.** 布局不再依赖自动放置的隐式顺序。render 测试新增硬约束：grid 的每个
子项都必须写 `grid-column`，且轨道序列必须是 1,2,3…（无碰撞、无空洞），text column 落
在奇数轨道、gutter 落在偶数轨道。验证方式也改为把真实组件渲染树序列化后交给 headless
Chrome 量 `getBoundingClientRect`（列宽、左偏移、行数分布、分割线高度），而不是只看线高。


## DEC-017 — 2026-11-13 — 列间分割线是 grid 的一个独立子项，而不是列的 border

**Context.** DEC-003 给每列加分割线时用的是 `.dshmf-col--divided` 的
`border-right`。border 只能跟随它所属盒子的高度，于是分割线的长度永远等于左边那一列
的行内容高度：列比网格矮时，线就短一截，看上去像是「挂在列上」。

**Decision.**

- 删掉 `.dshmf-col--divided`，新增 `.dshmf-colDivider`：它是 `.dshmf-grid` 的**直接
  子项**，与各 `.dshmf-col` 同级，占据列与列之间一条独立的 `1px` 轨道
  （`gridTemplateColumns` 由 `minmax(0,1fr)` 逐个拼接，中间以 `1px` 相连）。
- `.dshmf-grid` 保持 `align-items: start`（文本列按内容高度自然排布），分割线单独
  `align-self: stretch` 撑满整行网格高度，并用自己的 `margin: 6px 0` 留出上下边距；
  线宽 `1px`、颜色沿用 `--dsw-alias-border-l3`。
- 只有真正落在两列之间的空隙才渲染分割线（`renderColumns` 在每列之前插入），单列
  布局依然无边框；空态与 failure 条不参与该轨道。

**Consequences.** 纯结构与 CSS 变更，planner/DOM 语义不变（行仍然只在 `.dshmf-col`
里）。render 测试约束：分割线数量 = 列数 - 1、grid 子项按 col/divider 交替、分割线不是
任何列的子孙、`.dshmf-colDivider` 上 `align-self: stretch` 且没有 border。


## DEC-016 — 2026-11-13 — 分割线挂在 footer 容器上，而不是推理等级上

**Context.** DEC-011/DEC-012 把分割线画在 `.dshmf-reason` 的 `border-top` 上。
之后推理等级与团队协作改为同一个 `.dshmf-footer` flex 容器内的两个子块：两者能并排
时共用一行，放不下时各自一行。线仍挂在 `.dshmf-reason` 上，于是并排时线只盖住推理
等级那一半，位置显得错位。

**Decision.**

- 把 `border-top: 1px solid #9CA3AF`（深色 `#6B7280`）与 `padding-top: 6px` 上移
  到 `.dshmf-footer`，深色分支同步改为 `body[data-ds-dark-theme] .dshmf-footer` /
  `html[data-ds-dark-theme] .dshmf-footer`。
- `.dshmf-reason` 与 `.dshmf-team` 都不再拥有任何 `border-top`：线永远在两者共同的
  UI block 上方，与它们在并排/换行哪种排布无关。

**Consequences.** 纯 CSS 变更，DOM/planner 不变。render 测试约束改为「线在
`.dshmf-footer` 上，两个子块都没有 border-top」。分割线颜色与线宽不变（沿用 DEC-012）。

## DEC-017 — 2026-11-13 — 额度不足的删除线是全局状态，不绑定 session / workspace

**Context.** DEC-014 把删除线标记折叠在**单个会话**的 durable 事件流上
（`sessions.binding(sessionId).eventSource`），face 也是按 session 构建、随座位卸载
`dispose()` 掉的。用户指出这是错的：**「模型还有没有额度」并不跟 session 或 workspace
绑定**——额度是模型路由（及其背后的账号）的属性。于是同一个模型在 A 会话里因欠费失败，
B 会话、另一个工作区、甚至刷新之后仍然显示为「可用」，用户会反复撞同一堵墙。

**Decision.**

- **标记改为模块级全局状态。** 每次激活创建一个 `createMarkStore`，所有座位共享同一份
  状态与同一组订阅；座位卸载**不再** `dispose()` 它（标记属于页面，不属于某个座位）。
- **观察所有会话，而不只是当前座位那个。** store 通过 `ctx.sessions.list` 的 `ids`
  遍历全部会话，逐个 `binding(id).eventSource` 折叠；座位在构建 face 时额外 `watch()`
  自己那个 session 并 pin 住，避免「列表还没列出它」时漏掉。列表变化时重挂/摘除订阅，
  换掉 `sessions` 服务（客户端重载）时整体重挂。
- **跨会话按事件时间定序。** 会话 feed 没有跨会话序号，但每条 durable 事件都保留宿主的
  墙钟 `time`。每条 route 记录最后一次判定的时间，**更旧的一条直接丢弃**。这解决了两类
  真实问题：历史 replace 重放不能把已被更晚调用清除的划线复活；加载一个历史更早的会话也
  不能覆盖更新的结论。已清除的 route 保留 watermark，正是为了挡住这种回放。
- **用 `localStorage` 持久化，跨 reload 生效。** 与分组选择同一套「origin 作用域 +
  失败即降级」的写法：`dshmf:insufficient` 存 `{routeKey: {marked, at}}`，读取时丢弃
  超过 7 天的记录，写入时顺带裁剪，避免长期存活的页面无限增长。
- **把语义与簿记拆开。** `decideMark(event, route)` 只回答「这条事件对这条 route 意味着
  什么」（mark / clear / 不表态），`foldMarkEntry(entries, key, marked, at)` 只做带时间
  水位的 last-writer-wins。判定规则本身（含 429 读正文）完全沿用 DEC-015，未改一字。

**Rejected.** 把标记挂到「当前选中模型」上（用户可能已经切走，会标错行）；只观察当前
座位的会话（正是本次要修的问题）；用 `sessionStorage`（仍然按标签页/会话隔离，不满足
「跨 session 与 workspace」）；把「清除」实现成删除记录（会丢掉 watermark，回放旧历史时
划线复活）；用「最新写入覆盖」而不是时间比较（并发/乱序到达时结果不确定）。

**Consequences.** `client.js`：`foldInsufficient` 的签名与状态形状由 `Map<string, true>`
改为 `Map<string, {marked, at}>`，新增 `decideMark` / `eventTimeOf` / `foldMarkEntry` /
`parseMarks` / `serializeMarks` / `readMarks` / `writeMarks` / `createMarkStore` 并挂到
`__test`；face 的 `insufficient` 改为共享 store，座位改用 `watch()` 而非 `dispose()`。
render 测试由 95 条扩到 104 条：新增「A 会话失败 → B 会话划线」「B 会话更新的成功 → 清除」
「更旧的失败不能复活」「reload 后从 localStorage 恢复」「持久化格式防御与过期」「存储失败
不影响面板」「store 观察所有会话」「sessions 缺失时降级」以及「跨会话的 429 仍按正文判定」。
## DEC-015 — 2026-11-13 — 429 不等于限流：额度判定改由正文决定

**Context.** DEC-014 把额度不足的判定写成「结构化 code 优先，402 其次，正文兜底」。
用户随后指出一个反例：`429: {"message":"insufficient balance","request_id":"…"}` ——
同一个 429 状态既可能是真正的限流，也可能是余额耗尽，宿主对两者都给出 `RATE_LIMIT`。
按 DEC-014 的写法，`RATE_LIMIT` 不划线，于是这类真实欠费会被漏掉。

**Decision.**

- **429 的状态不再具有判定权。** 402 仍可直接判定（payment required）；429 以及其它
  状态一律交给正文判断：正文说明余额/额度耗尽就划线，纯限流就不划线。
- **用真实数据校准判定词表。** 折叠本地 `~/.dsh/sessions` 全部 1270 个会话日志中
  每一条 `turn/end` 失败（共 486 条无 status、21 条 402、15 条 400、9 条 403、
  5 条 429），按 message 形状去重后得到 27 个与额度相关的形状：其中 20 个确属额度
  不足，7 个是真正的限流/无关失败。词表据此扩充：`insufficient_user_quota`、
  `not enough quota`、`no credits remaining`、`credits or licenses`、
  `quota is exhausted`、`requests have exceeded the quota`、
  `billing daily count exceeded`，以及 `额度已用尽` / `预算已用完` 等中文写法。
- **新增 `BUDGET_EXHAUSTED` 代码**（真实会话中出现 50 次，如「今日学习调用预算已用完」）。
- **把真实样本固化成测试。** render 测试新增 `REAL_INSUFFICIENT` / `REAL_TRANSIENT`
  两张表，条目是原样粘贴的真实 `{ code, status?, message }`，逐条断言判定结果；另有
  一条端到端用例证明「同一个 429，正文说余额不足则划线，纯限流则不划线」。

**Rejected.** 只加一条「429 也算额度不足」的规则——那会把真正的限流也划上线，正好与
需求相反。把判定放宽成「正文里出现 额度/balance 就算」——真实数据里有两条反例：
上下文超限的消息写着「与网络、账号、额度都无关」，传输失败的消息只是「建议等待额度
恢复」，两者都不该划线，现已作为反例固化在 `REAL_TRANSIENT` 里。

**Consequences.** `client.js`：`INSUFFICIENT_TEXT` 扩充并加入中文预算/额度句式，
`INSUFFICIENT_CODES` 增加 `BUDGET_EXHAUSTED`，`isInsufficientBalance` 注释明确 429
由正文决定。测试从 2 条分类器用例扩展为 4 条 + 1 条端到端，总数 95 条全绿。判定结果
在全部真实数据上复核：20 个欠费形状全部命中，7 个限流/无关形状全部不命中。

## DEC-014 — 2026-11-13 — 额度不足的模型行加删除线，直到该模型下一次返回非额度不足

**Context.** 用户要求：模型调用的返回结果如果表示没有额度（402、message 里含
insufficient balance / credit 之类，只要是额度不足），就在该模型 row 的文字上加
line-through；直到该模型下一次返回非 insufficient 错误再去掉。

**Decision.**

- **数据来源不新增宿主能力。** 宿主已把「账户额度耗尽」与「临时限流」分开：`dsh-llm`
  产出 provider-neutral 的 `QUOTA` / `ACCOUNT_QUOTA` 代码，`dsh-llm-deepseek` 的
  `providerError` 把 HTTP 402 映射为 `QUOTA`。这些事实以 `turn/end` 事件落到
  `reason.error = { code, message, status? }`，正是 Chat 读取 `shell.quota-notice`
  所用的同一个来源。因此面板直接折叠 Session 的 durable 事件流
  （`ctx.sessions.binding(id).eventSource`），**不改宿主、不新增事件类型**。
- **判定分两层。** 结构化 `code` 优先（`QUOTA` / `ACCOUNT_QUOTA` 等）；其次是
  `status === 402` 或 `HTTP_402`；最后才按文案兜底（`insufficient balance|credits`、
  `quota exceeded`、`out of credits`、`余额不足`、`额度不足` 等），用于宿主把失败
  压成 `UNKNOWN` 但保留了 provider 原文的情形。`RATE_LIMIT` 等临时错误**不算**额度
  不足——账户仍有余额。
- **标记落在 route 上，不是当前选中项。** 失败请求的模型取自它之前最近一条
  `request/header` 的 `header.config`（`{ provider, model }`），所以标记精确落在真正
  被派发的那条 `provider/model` 上；用户此后切换选中模型不会让标记跑到别的行。
- **清除条件是「模型确实回应了」。** 同一 route 的 `turn/end` 若为 `completed`、
  `max-tokens`，或另一种 `error`，都清除标记；而 `aborted`、`blocked` 以及合成关闭
  的 `interrupted` / `forked` 不清除——模型根本没回应，不能证明额度已恢复。
- **呈现只用删除线。** 不改变行颜色：删除线在选中行的深蓝底与浅/深两套主题下同样
  成立，也不与错误条的红色抢注意力。只作用于行文字（名称与 family 变体标签），
  badge 与 spinner 不划线。
- **订阅面保持引用稳定。** face 缓存一次（renderer 按 entry+binding 缓存 inject
  face），只在标记集合真正变化时替换 snapshot 并通知，其他事件一律安静；`replace`
  整体重折，`prepend`（加载更早历史）不改变标记故忽略。

**Rejected.** 在宿主侧新增投影或事件（面板是纯浏览器插件，且 `turn/end` 已带全部
所需事实）；按当前选中模型加标记（会标错模型）；用红色或透明度表达（与错误条语义
重复，且在选中蓝底上不稳定）；把 `aborted` 也当作清除条件（会让用户取消一次就误清）。

**Consequences.** `client.js`：新增 `isInsufficientBalance` / `foldInsufficient` /
`routeOfHeader` / `routeKeyOf` 纯函数并挂到 `__test`，face 增加 `insufficient`
可观察面，`renderRow` 输出 `data-insufficient`，CSS 用 `text-decoration: line-through`；
`inject` 增加 `sessions`。render 测试固定分类器的正反例、route 解析、fold 的标记/清除/
取消不清除、402 与文案两条路径、以及只有行文字被划线。
## DEC-013 — 2026-11-13 — Reasoning group and teamwork switch share one adaptive footer line

**Context.** The reasoning group ("推理等级" + segment track) and the agent
teamwork row (label + info + switch) each owned their own fixed row at the
bottom of the panel, so the panel always spent two lines on them. The user
asked for them to sit on ONE line when a line can hold both — with at least
30 px between them — and to keep the current two-row look when it cannot.

**Decision.**

- Both groups now live inside a single `dshmf-footer` flex container. The
  footer is `display: flex; flex-wrap: wrap; column-gap: 30px; row-gap: 4px`,
  and each child keeps `flex: 0 0 auto` + `max-width: 100%` so it renders at
  its natural width and caps (rather than overflows) when it ends up alone.
- The one-line/two-line decision is **CSS flex wrapping**, not a JS pixel
  threshold: the footer takes the panel width, and the children share a line
  exactly when `reason + 30 + team <= panel inner width`. This stays correct
  across window resize, font loading, locale text length and both themes, with
  no measurement race and no second source of truth. It also degrades to the
  exact previous two-row layout automatically, which is what "keep it as it is
  when it does not fit" means.
- `column-gap: 30px` is the required middle margin; in the wrapped state it
  contributes nothing (no cross-axis gap), and `row-gap: 4px` preserves the
  original stacking rhythm.
- No divider juggling was needed: DEC-011 (merged independently on `main`
  while this change was in progress) already removed the teamwork row's own
  border and keeps a single grey rule above the reasoning group, so a shared
  line needs no conditional hairline. The teamwork row's old `margin-top: 1px`
  was dropped too, because inside the footer the `row-gap` supplies that
  spacing and a stray top margin would misalign the two groups on a shared
  line.
- Fixed-height accounting changed with it: the panel used to measure
  `reasonRef` and `teamRef` separately and sum them. On a shared line those two
  heights overlap, so summing would over-subtract from the grid budget and
  shrink the scroll area for no reason. The measurement now sums `footerRef`
  once instead.
- Failure strips (`dshmf-error`) and the disable-confirmation (`dshmf-confirm`)
  stay OUTSIDE the footer: they are full-width, conditional rows that must not
  be squeezed into a half-line next to the groups. The footer only ever holds
  the reasoning group and the teamwork row.

**Rejected.** A `ResizeObserver` + JS width comparison that flips a class at a
threshold: it duplicates a breakpoint the browser already computes exactly,
adds a first-paint flash, and drifts when fonts or the locale change.
Setting the footer to `width: max-content` so `flex-wrap` is decided by
shrink-to-fit: the footer would then never wrap, because `max-content` is by
definition the no-wrap width. Giving the children `flex: 1 1 0` or a shared
`gap` on the panel: either stretches a group to fill half the line when only
one is present, or makes the 30 px apply between unrelated sections.

**Consequences.** One shared line is used whenever it fits, so the grid gains
a row of height in that state. Rendering order, radio semantics, switch
semantics, keyboard handling and the disable confirmation are unchanged; the
DOM now nests the two groups under one extra wrapper, which the render tests
pin (both groups inside one footer, strips outside, footer measured once).

## DEC-012 — ⛔️ 2026-11-13 — Family rows are provider-primary, and a brand's generations stay distinct

推翻: DEC-004 的两点结论（"每行以次级文字显示 provider" 与 "hy3/hy4 合并进一个 HY 家族"）。
DEC-004 条目本身保留原样，仅由本条声明其失效。

**Context.** After DEC-004 shipped, the user reported that under *By family*
the row content needed a smarter, more flexible treatment:

1. A family heading already says what the models ARE (and now, with the
   generation split, also which generation). Repeating a model/family name as
   the row's main text is redundant — the useful, missing information in a
   family that spans providers is WHERE a model comes from.
2. Merging `hy3` and `hy4` into one `HY` family was explicitly called a
   mistake: the model's **generation has to be distinguished**, not collapsed.

**Decision.**

- *Row content (By family).* The primary text becomes the **provider name**.
  The family name is not drawn in the row at all. The full model name and
  description move to (and stay in) the row tooltip. A short secondary variant
  is added **only on demand**: when one provider offers more than one model in
  the same family, those rows get an id-derived tail (`hy4free` → `free`,
  `hy3-x` → `x`, `hy4flash-exp1` → `flash exp1`); the plain base model carries
  no tag. Colliding variants fall back to the unique model id. Under
  *By provider* the primary text stays the model name and no tag is drawn.
- *Generation split.* A registered brand (`FAMILY_BRANDS`, currently `HY`)
  resolves to `BRAND + generation` from the id's leading digit, so `hy3` →
  `HY3`, `hy4free`/`hy4std`/`hy4-preview` → `HY4`, and a bare `hy` → `HY`.
  Dictionary families (GPT, Qwen, …) are never split. Unregistered brands
  keep DEC-004's collapse (`acme4-turbo` and `acme-7b` → `Acme`).
- Generations rank next to their bare brand in numeric order
  (`HY` < `HY3` < `HY4` < `Others`), so a new generation does not jump to the
  end of the grid.

**Rejected.** Keeping the model name as primary text with the provider as a
quiet tag (the DEC-004 shape) — it repeats the family name and buries the one
discriminating fact (the provider). A fixed variant on every row (noise when a
provider has one model in the family). Upper-casing all generations or splitting
dictionary families by version.

**Consequences.** `client.js`: `familyOf` now emits `HY3`/`HY4`, `familyRank`
orders generations, `idVariantOf`/`rowVariantOf` derive short tails, the
sections builder disambiguates per provider+family, and `renderRow` swaps the
primary/secondary roles. The measurement probe and 26 px row height are
unchanged (the tag still shares the model-name line). Render tests pin the
generation split, provider-primary text, no family name in a row, and the
on-demand variant; plan tests pin `familyOf`/`familyRank`/variant helpers.

## DEC-011 — 2026-11-13 — 分割线只放在模型网格与推理等级之间

**Context.** 用户要求：推理等级与智能体团队协作之间不要有分割线；模型网格与推理等级之间要有一条明显一些的灰色分割线。

**Decision.**

- 移除 `.dshmf-team` 原有的 `border-top: 0.5px solid var(--dsw-alias-border-l1)`，使推理等级与团队协作之间不再有线条。
- 在 `.dshmf-reason` 顶部加 `2px` 实线分割线，浅色模式用中等灰色 `#6B7280`，深色模式（`body[data-ds-dark-theme]` / `html[data-ds-dark-theme]`）用更亮的浅灰 `#D1D5DB`，并加 `padding-top: 6px`。
- 这里刻意不用 `--dsw-alias-border-*` token：这些 token 设计上就是极淡的边框，达不到用户反复要求的明显程度，因此用显式灰值加深色分支。

**Consequences.** 纯 CSS 变更；无布局、DOM、planner 改动。render 测试固定分割线的位置、颜色与团队协作无边框。

## DEC-012 — 2026-11-13 — 分割线色调降为普通灰

**Context.** DEC-011 的 `#6B7280`(浅)/`#D1D5DB`(深) 在 2px 下用户反馈"太深"。

**Decision.** 调弱为普通灰：浅色 `#9CA3AF`、深色 `#6B7280`，线宽由 2px 降为 1px（更接近常规分隔线）。位置与"团队协作无边框"约束不变。

**Consequences.** 纯色调微调；render 测试约束同步更新为 `#9CA3AF`/1px。

## DEC-010 — 2026-11-13 — Selected model: deep-blue band with white bold text, no checkmark

**Context.** The selected model was marked only by a 14px checkmark at the
right edge of its row. That reserved a trailing column on *every* row (empty
on all the unselected ones) and read as a weak, easy-to-miss glyph. The user
asked for a space-saving treatment: no checkmark, a deep-blue background and
white bold text on the selected row.

**Decision.**

- Drop `PATH_CHECK` and the checkmark branch in `renderRow`; the selection is
  carried by the row itself through `aria-pressed="true"`.
- The selected row draws as a solid band: `background:
  --dsw-static-deepseek-600` (deep blue `#4868b2`), `color:
  --dsw-static-neutral-bluish-00` (white), `font-weight: 600`. White on that
  blue measures 5.39:1, and the fill stands apart from the panel surface in
  both themes (5.33:1 light, 2.77:1 dark).
- The blue is pinned to the **static** palette, not
  `--dsw-alias-state-business-primary`: that alias is deepseek-500 in light
  but flips to light deepseek-400 in dark, which would paint a light-blue band
  with the theme's dark foreground — the opposite of the requested deep blue
  with white text. The static `--dsw-static-*` tokens are defined once in the
  host's global `body` rule and are identical in both themes.
- Hover is skipped for the selected row
  (`:not([aria-pressed="true"])`), so the neutral hover wash cannot cover the
  highlight. Provider tags inherit the white text (slightly dimmed) and
  badges become a translucent white chip so both stay legible on the fill.
- The trailing tail element is now drawn only for a pending selection (the
  spinner); the measurement probe no longer mirrors a tail column. Since the
  row height is fixed at 26px, no planner change is needed.

**Rejected.** An alias-based blue fill + `--dsw-alias-label-primary-foreground`
text (the host's own chip recipe): it inverts to light blue / dark text in the
dark theme. Keeping a fixed 14px tail for the checkmark (wastes horizontal
space on every unselected row).

**Consequences.** Purely a CSS + render-path change; the row keeps its 26px
height and the column planner, probe measurements, and selection semantics
(`aria-pressed`) are unchanged. Render tests pin the CSS recipe, the absence
of the check path/glyph, and the tail-free probe.


## DEC-005 — 2026-11-13 — Float the group-title band on an opaque layer fill

**Context.** DEC-003 added a low-key frame to the group label but kept its
`--dsw-alias-menu-group-header-fill` background. The user then reported the
grouping title's background was still too close to the row / panel background.
In both themes that fill is only a few levels from the panel/menu surface the
rows sit on (light: `rgba(248,249,250,.94)` band vs `rgba(252,253,254,.7)`
surface; dark: `rgba(48,49,54,.94)` vs `rgba(48,49,54,.64)`), so the band did
not read as a separate section header.

**Decision.** Keep the DEC-003 frame (hairline + grey left edge) untouched and
change only the band's fill to `--dsw-alias-bg-overlay` plus
`--dsw-elevation-soft` — the exact recipe the panel already uses for its
active segment (`.dshmf-segBtn[aria-pressed]`, `.dshmf-pill[aria-checked]`).
Crucially `bg-layer-1` (the first attempt) is opaque white in light and
near-black in dark — i.e. it matched the panel surface in *both* themes, which
is exactly why the band read as flat. `bg-overlay` resolves to a soft grey in
light (`bluish-150` ≈ #e9ecf2, visibly darker than the white panel) and a light
grey in dark (`bluish-700` ≈ #61666b, visibly lighter than the near-black
surface), so the band steps clearly away from the translucent panel surface in
both themes with no hard-coded colour and no second theme branch. Rows stay
transparent (background only on hover/focus), so the band is the only standing
separation.

**Rejected.** `bg-layer-1` (opaque white/near-black — matches the panel surface
in *both* themes, so the band reads flat; this is why the first pass had weak
contrast), a `color-mix` tint toward `--dsw-alias-label-primary` (compositing
math showed it *reduces* separation in most cases), a tint toward `bg-layer-1`
(only a few levels of gain and worse on dark pages), a hard-coded
darker/lighter fill (breaks theme token purity), and `interactive-bg-hover` (a
translucent hover tint that would blur the row's own hover state).

**Consequences.** CSS-only on `.dshmf-groupTitle`; the frame, height, padding,
and line-height from DEC-003 are preserved, so the probe-measured `headH` and
the column planner stay valid. The render tests pin the opaque grey overlay
fill (and assert it is *not* the panel base/layer-1 surface), the absence of the
near-surface group-header fill, the soft elevation, the DEC-003 frame, and the
row's transparent background so the old near-identical flat fill cannot
regress.

## DEC-004 — 2026-11-13 — Family grouping: rows name their provider, and a family is a brand not a version

**Context.** Two problems with model-family grouping, both reported from the
real catalog:

1. A family heading says what a model *is*, but one family can hold models
   from several providers. Under family grouping the grid therefore gave no
   way to tell two same-named models from different providers apart.
2. Grouping was too fine. `hy3`, `hy4-preview` and `hy4free` arrived as three
   separate headings even though they are three versions of one brand.

**Decision.**

- Every row under *By provider* stays as it was. Under *By family* each row
  draws its provider as secondary text (`.dshmf-rowProvider`: caption colour,
  11 px, shrinks and ellipsises before the model name, no fixed width cap),
  and the row's `title` tooltip gains the provider on its own line. Under
  *By provider* the heading already is the provider, so no tag is drawn.
- The provider label is resolved ONCE per group and reused as the section
  title, the search face, and the per-row tag, so a localized catalog name
  (`{ zh, en }`) cannot make the heading and the tag disagree.
- A family is the brand, not the version. `BRAND_WITH_VERSION` strips a
  version tail (`hy4free` → `hy`), so every version of a brand lands in one
  heading. A registered brand list (`FAMILY_BRANDS`, currently `HY`) pins the
  exact heading casing and keeps that family in the normal sort order; the
  brand is looked up on every id segment, so a provider-prefixed id
  (`codebuddy-hy3`) still resolves to `HY`.
- The measurement probe now mirrors a family-grouped row (name + provider tag
  + tail), so the measured row height covers the tallest row shape.

**Rejected.** Showing the provider tag in *By provider* mode (the heading
already says it, so it would be pure noise); a fixed `max-width` on the tag
(it truncated "CodeBuddy CLI" to "CodeBuddy …" in a column that had room);
upper-casing every short brand (it would draw `phi-4` as `PHI` instead of the
dictionary's `Phi`).

**Consequences.** The three `hy*` headings collapse into one `HY` heading, so
the grid gets shorter and the column planner fits more models per column. A
family-grouped row is unchanged in height (26 px) because the tag shares the
model-name line. Render tests pin the tag's presence under family grouping,
its absence under provider grouping, the one-heading outcome for three `hy`
versions across two providers, and the localized-label agreement between
heading and tag.

## DEC-003 — 2026-11-13 — Groups get a low-key framed label; the rows stay unboxed

**Context.** The flat grid listed each provider/family as a tinted title band
over bare rows. The user asked for each group (provider or family, per the
active grouping) to carry a frame (线框) that is visible but unobtrusive —
low-key, simple, still good-looking. The dense layout flows a group's rows
across 1–3 columns, so a single box around a whole group is only possible if
the group becomes an indivisible placement unit — which would cost density for
large groups (a 30-model provider would become one tall scrolling card beside
ragged gaps under short groups).

**Decision.** Keep the dense row flow. Frame the group **label** instead:

- The title band gains a hairline frame — `1px solid
  --dsw-alias-border-l2` (≈10 % black in light, ≈12 % white in dark) — and a
  3 px left edge in `--dsw-alias-state-business-primary` (the panel's own
  DeepSeek-blue accent, ≈#7aaaff / #4176e6). The band stays 20 px tall, so the
  probe-measured `headH` and the column planner are untouched.
- The band keeps its filled, smaller-bold styling from the 2026-11-13 label
  restyle, so frame + accent + fill read as one calm section header.
- The rows themselves stay borderless and keep flowing across columns; a group
  that spans columns is marked at its head by the framed label.

**Rejected.** Boxing each group as an indivisible bordered card (a
`.dshmf-card` around title + rows, with the planner's units changed from rows
to cards): the cleanest "frame the whole group", but it breaks the row flow
across columns and costs density for large groups. The user explicitly chose
the weak divider over it.

**Consequences.** CSS-only on `.dshmf-groupTitle` (plus its render-test
assertions and this doc); no layout, planner, probe, or DOM-structure change.

## DEC-002 — ⛔️ 2026-11-13 — Reasoning effort: "推理等级" caption inline with a multi-segmentation control

取代: DEC-001 的视觉呈现（"思考强度" 文案、双行卡片容器、品牌色 pill 选中态）。
DEC-001 的 radio 语义（`radiogroup` / `radio` / `aria-checked` / 方向键）与
"固定区高度由 `reasonRef` 实测"的布局机制保持不变。

**Context.** After reviewing the labelled card, the user asked for the
caption to read "推理等级" (not "思考强度"), to sit on the same line as the
options whenever possible (wrapping only when the row cannot fit), and to
draw the options with the visual language of a multi-segmentation control.

**Decision.**

- Caption text: "推理等级" / "Reasoning effort"; the hint tooltip (what the
  setting adjusts) is kept.
- Layout: `display: flex; flex-wrap: wrap` — the caption and the segment
  track share one line; the track (a single flex item that does not shrink)
  wraps to its own line only when the row cannot fit, and scrolls
  horizontally if its content still overflows.
- Visual: the track reuses the header segment's recipe —
  `--dsw-alias-interactive-bg-hover` track, `--dsw-radius-sm` corners,
  2 px inset; the active segment floats on `--dsw-alias-bg-layer-1` with
  `--dsw-elevation-soft` and 500 weight (the brand-fill pill is dropped).
  Radio semantics and the checked-state rules are unchanged.

**Consequences.** The fixed section returns to a single ~26 px line in the
common case (shorter than DEC-001's two-line card), so the scrollable grid
gains height back. The panel now has one visual language for
"one-of-many, exactly one active" (header grouping + reasoning level).
Render tests still pin the radiogroup structure and exclusive
`aria-checked`; the t-stub label key is unchanged, so no test edits were
needed.

## DEC-001 — 2026-11-13 — Reasoning levels become a labelled, exclusive group

**Context.** The flat model picker rendered the current model's reasoning
efforts as a loose row of borderless pills with only a tooltip-level group
label. It was easy to miss that the block is a setting, hard to see which
level was active, and the mutual exclusivity of the choices was not expressed
in semantics or in pixels.

**Decision.**

- Wrap the effort pills in a visible group: a tinted, rounded container
  (`--dsw-alias-bg-module-platform` fill, `--dsw-radius-md`, inset 2 px) with
  a caption ("思考强度" / "Thinking intensity") plus a sparkle icon and a hint
  tooltip explaining that the setting adjusts how deeply the model thinks.
- Use radio semantics: `role="radiogroup"` + `role="radio"`, `aria-checked`
  (replacing `aria-pressed`), `aria-labelledby` naming the caption, and
  arrow-key navigation over the enabled pills, so exactly one level is ever
  selected and the group is fully keyboard-operable.
- The checked pill uses the brand fill (`--dsw-alias-brand-primary` with
  `--dsw-alias-label-primary-foreground` text — the same proven pairing as the
  host switch — plus `--dsw-elevation-soft`), making the selection
  unmistakable in both light and dark themes.

**Rejected.** Keeping `aria-pressed` buttons (no exclusive semantics, weak
selected state), and restyling the pills as a segmented control (would blur
against the provider/family segment in the header and still read as one of
many flat options).

**Consequences.** The fixed reasoning section grows by ~35 px, which the
column planner absorbs by shrinking the scrollable grid (the section height is
measured through `reasonRef`, no planner change needed). Render tests pin the
radiogroup structure, the caption, and exclusive `aria-checked`.
