# DECISIONS

Project-level decision log for the dsh-model-flatmap plugin. Append-only: new
entries go below the marker, newest first; old entries are never rewritten.

<!-- APPEND-ONLY LOG: 新条目插入到此行之后 -->

## DEC-029 — 2026-11-14 — 菜单底部的入口画成按钮，而不是再复制一行菜单项

**Context.** 用户看到 DEC-028 的实现后指出：`回到平铺模型面板` 看起来像表格行，不像按钮，
问能不能改视觉。这是纯粹的观感问题——功能、位置、注册方式都不动。

**Findings.** 该插槽（`conversation.input.model.options`）交给占用者的只有一个
`display: contents` 的锚点（`scoped-slots.tsx:1313` 的 `ANCHOR_STYLE`），锚点本身不参与
布局。也就是说**盒子完全是我们画的**，没有任何宿主样式作用在我们的元素上，改成什么形态都不
受限制。可用的主题令牌都在 `ui-theme/src/styles/design-platform.css`：
`--dsw-alias-border-l2/l3/l4`、`--dsw-alias-interactive-bg-hover`、
`--dsw-alias-label-primary/secondary`，圆角 `--dsw-radius-sm`（8px）。深色主题由同一批
别名令牌切换，无需自己判断主题。

**Decision.** 改成「底部动作带 + 带描边的整宽按钮」：

- 外层 `.dshmf-modeAction` 是一条**横跨整行的带**，`border-top: 1px solid
  var(--dsw-alias-border-l2)` 与上方的值行分开；不设水平内边距，让按钮边缘与上方行对齐
  （菜单自身已 pad 4px，行本身的 hover 填充也正好铺满那个宽度）。
- 按钮 `.dshmf-modeBtnRow`：整宽、高 30、`--dsw-alias-border-l3` 描边、
  `--dsw-radius-sm`、12/18 中等字重、居中、hover 换成
  `--dsw-alias-interactive-bg-hover` 并把描边提到 `l4`，focus 用宿主焦点环令牌。
- 图标换成四宫格（`PATH_GRID`），指向**目的地**——平铺面板，而不是重复上方已经用过的模型
  图形；尺寸 13。
- **去掉 `role="menuitem"`**：这一条不是「在一组值里选一个」，是执行一个动作。语义上就是
  普通 `<button>`，测试里用「不许带 menuitem」把这条钉住。

**Rejected.**（1）继续模仿菜单行、只加个边框：看起来仍是行。（2）用
`--dsw-alias-button-primary-fill` 做主按钮：那是整个界面的主操作语义，一个模式开关不该抢占。
（3）改成图标按钮（只有图标没有文字）：这条动作的字面意思需要说清楚，纯图标会让「回哪去」
更含糊。

**Consequences.** 视觉层级现在是「值行 —— 分隔线 —— 动作」，与用户对「这里是按钮」的预期
一致。分隔线与按钮都用别名令牌，深浅主题自动跟随；已用宿主的真实行样式搭静态预览截图核对
过两种主题。

## DEC-028 — 2026-11-14 — 切回平铺的入口长在原生选择器自己的菜单底部

**Context.** 用户指出 DEC-027 的返程控件位置不对：`原生` chip 挂在
`conversation.input.right`，只能出现在原生 trigger 的**左边**，而且它属于输入框工具栏、
不属于它所操作的那个面板。用户明确否掉「CSS `order` 挪到右边」和「两处都放」，只要一个
形态：**原生选择器自己的面板里，底部一行**。

**Findings.** 读本机安装（`app.asar`）：

- 出厂 `ModelSelect` 注册 `conversation.input.model` 时用 `children` 声明了
  `conversation.input.model.label`（single，inline）和 `.options`（list）。前者在
  trigger 内部与菜单行里，后者在根菜单 Model / Effort 两行**之后**
  （`ModelSelect.tsx:505`）。
- 这个声明归**出厂条目**所有（`docs/subsystems/slots.md:23`：一个 declaration 只由一个
  活条目拥有），所以 `.options` 的生命周期跟随出厂条目——恰好横跨我们 dispose 座位的那段时间。
- 它是 `list`，注册只需一个全新 `id`，**不会**与已占用的 `agent-team` 冲突
  （`SlotCore.register` 只按 `(id, priority)` 查重）。
- 条目其它形态要么不可用、要么会踢掉功能：`.label` 是 single 且已在触发器内部渲染；
  `.model` 是 single，只能有一个胜出者，仍要自己渲染出厂组件（DEC-027 已否）；宿主没有
  覆盖工具行的 `hoc` 槽（现存 `hoc` 只有 `hero.frame` / `chat.markdown.fence` /
  `sidebar.session.action`）。

**Decision.** 返程控件改注册到 `conversation.input.model.options`
（`id: 'dsh-model-flatmap.native'`, `order: 50`），渲染一行与出厂菜单同规格的
`<button role="menuitem">`（34px、radius-md、13/20、hover 用
`--dsw-alias-interactive-bg-hover`）。平铺模式下该组件返回 `null`，出厂菜单与出厂状态完全
一致。点击顺序固定：先调宿主给这个插槽的 `dismiss()` 关菜单，再切换模式——切换会 dispose
掉拥有该菜单的条目，否则焦点会落在已卸载的节点上。

同时**删除** `conversation.input.right` 的那条注册与 `.dshmf-modeChip` 样式：留两处入口会
让「模式控件属于谁」继续含糊，正是用户要收敛的那一点。

**Rejected.**（1）CSS `order: 1` 把 chip 挪到 trigger 右侧：不是面板，只是邻居，且仍属于
工具栏。（2）`order: 1` 与菜单行并存：一个控件两个家。（3）把出厂组件塞进自建的
outer panel：`renderSlot` 绑定在所属条目上，且我们要声明 `.label`/`.options` 时注册期就会抛
`slot "…" is already declared`。

**Consequences.** 返程入口只在原生菜单打开后可见（少了常驻性），这是用户接受的取舍：它现在
100% 属于它所操作的面板，并且永远跟随出厂的菜单实现升级。菜单行的标签复用
`native.back`（「回到平铺模型面板」），不再需要 `native.label` 的 chip 语义。

## DEC-027 — 2026-11-14 — 原生模式：把座位**让出去**，而不是把宿主控件搬进来

**Context.** 用户要求在面板右下角加一个 `原生` / `Original` 按钮：按下后本插件显示宿主
原生的 model picker，再按一次回到平铺面板。用户的追加要求很明确——「不要试图自己去拷贝或者
模仿一个原生 model picker 控件：应该总是在 DSH 中找到该控件然后加载它，这样可以保证即使
DSH 不断升级，这个新功能也能显示最新的原生 model picker」。用户还猜测能否「两套 UI 都渲染、
按条件隐藏一套」，并问能否「返回一个软链接指向出厂组件」。

**Findings.** 读本机安装（`app.asar/dsh/node_modules/@deepseek-ai/`）：

- `dsh-client-ui-renderer/src/client/registry.ts`：`single` 槽**保留全部**注册
  （`entries(key)`），只把「被遮蔽的 cell 的胜出者」交给 outlet 渲染
  （`entriesOfSlot(key)`）。我们只因为用负优先级（−1…−5）注册才占住了这个 cell，出厂的
  `ModelSelect` 条目一直注册在我们下面。
- `dsh-client-ui-slots` 的 `StoredEntry` 暴露 `component`、`inject`、`registrant`、
  `locale`——也就是说「软链接」在数据结构上确实存在。
- 但 `dsh-client-ui-model-selection/lib/client.js` 只导出 `apply` / `inject` /
  `ModelDirectory` / `ModelDirectoryResolver`：**组件本身没有导出**。
- `registry.ts` 的 `boundRenderSlot(host, entry)` 把 `renderSlot` 子槽绑定在**所属条目**上，
  别的条目调用会抛 `StaleAuthorizationError`（注册已释放）或 `SlotOwnershipError`
  （未声明的子槽）。而出厂 `ModelSelect` 依赖
  `renderSlot('conversation.input.model.label' / '.options')`、
  绑定到 `model` 命名空间的 `t`、以及注入的 directory face。

**Decision.** 让位（step aside），不搬运。原生模式 DISPOSE 掉本插件
`conversation.input.model` 的注册，于是槽自己选出下方那条出厂条目，宿主渲染它自己的组件。
因此这里没有副本、没有 import 内部包、没有 re-mount：DSH 升级后出现的自然是它最新的 picker，
这个功能**结构上不可能过期**。

配套的三条约束：

1. **可验证才让位。** `slots.entries()` 拿到除自己以外的活条目，为空（或宿主旧到没有这个方法）
   就拒绝让位——否则 composer 会变成一个没有任何模型控件的空位。此时按钮置灰并给出原因。
2. **持久化的 `native` 不代表屏幕上就是原生。** 面板只在**它占着 cell 时**才渲染，所以二者
   只会在「存了 native 但没有可继承者、控制器拒绝让位」时不一致。按钮的 `aria-pressed` 报告
   **实际生效**的模式，而不是存储值。
3. **模式控件必须活得比它控制的座位久。** 原生模式会 dispose 掉承载按钮的条目，所以「回来的
   路」放在 `conversation.input.right`（list 槽，输入框行内、提交按钮之前），平铺模式下渲染
   `null`。

**Rejected.**（1）import `ModelSelect` 直接渲染：包不导出组件，且内部 props 契约不受支持，
升级即碎。（2）渲染 `entries()` 里另一条目存的 `component`：能拿到对象，但它的 `renderSlot`
会拒绝非所属条目，等于拿到一个必然抛错的空壳；要让它跑起来就得自建条目、自绑 `t`、自造
directory face——那已经是在复刻出厂控件了。（3）切模式时把面板和原生控件都挂在树上用
`display:none` 切换：仍需自己渲染原生控件，回到（1）（2）；而且隐藏的槽条目仍占着 cell，
`single` 槽里「胜出者」的语义会被扭曲。

**Consequences.** 切换是一次 `dispose()` + 一次 `register()`，所以从原生模式回来时面板是全新
挂载（关闭态、上次搜索词丢弃）——可接受。切换时焦点会随被 dispose 的按钮落到 document；跨插件
查 DOM 取焦点是被禁止的，故不做。模式存进 `localStorage`（`dshmf:mode`，与分组选择同源同
生命周期），写失败静默降级为 `flat`。让位前会把被选中条目的 `registrant` 打一次 info 日志，
方便用户排查「到底交给了谁」。
## DEC-026 — 2026-11-14 — 面板测量不得自激：两个无依赖数组的 layout effect

**Context.** 用户报告：composer 的 model picker trigger 突然显示
`请选择模型: Minified React error #185`。React #185 是 "Maximum update depth
exceeded"，即渲染循环被 React 主动中止；`SeatBoundary` 捕获后把它画成
trigger 上的一行字，所以看起来像「模型选择器坏了」，实际是整个座位在重渲染
里打转。

**Root cause.** 组件里有两条自激回路，症状相同、来源相同：

1. `// ---- measurement` 的 `useLayoutEffect` **没有依赖数组**，每次渲染后都
   测量 `rowH / headH / fixed` 并 `setMetrics`。而 `metrics.fixed` 直接参与
   `availableHeight`，`availableHeight` 决定列数，列数决定面板自身高度，面板
   高度又决定下一次测量——输入就是它自己的输出。
2. `// ---- placement` 的 `useLayoutEffect` 同样**没有依赖数组**，每次渲染都
   跑 `place()` 并写 `metrics.box`；`place()` 读的 `panel.offsetHeight` 又由
   `metrics` 推导而来，位置变化导致高度取整不同，于是反复重定位。

两条回路平时不发作：只有当测量值真的在两次渲染之间改变，才形成闭环。浏览器
里触发它的事件本身很普通——web font 换入、滚动条出现或消失、
flex 行在断点附近来回换行、亚像素取整。这就是「突然之间」的来源：不是版本
升级，也不是某次操作，而是布局第一次抖动。

**Decision.** 让测量与定位都**只在真正的布局输入变化时运行**，并且不让
亚像素噪声冒充布局变化：

- 两个 effect 都补上依赖数组。测量的依赖是
  `[open, sectionCount, footerKey, errorKey, confirmOpen, teamErrorKey, replan]`
  ——恰好是「哪些固定区块存在」这件事；派生的成员压成稳定字符串键，避免每次
  渲染新建数组/对象把这层依赖重新点燃。定位的依赖是
  `[open, metrics.fixed, metrics.rowH, metrics.headH, metrics.fixedCount]`
  （`plan` 由这些指标推出，等价但可读，且不会读到尚未计算的 `plan`）。
- 测量值先经 `quantizeMetric` 量化到 0.5px，再用 `metricChanged` 的
  `METRIC_HYSTERESIS = 2px` 带宽比较。带宽小于列宽规划能感知的最小单位
  （26px 的行），大于滚动条/换行抖动。真实变化（footer 换行、错误条出现）
  远超带宽，照常生效。

**Consequences.** 三条回归用例先在原始代码上失败、修好后通过（两个 effect
「armed by layout inputs」、以及「a sub-pixel drift is not mistaken for a new
layout」）。用真实 React 18 + jsdom 对振荡布局做的验证：原始代码抛
`Maximum update depth exceeded`，修复后 `loop=false`；而一次性真实布局变化
（模拟 web font 换入）在修复前后都正常，确认没有把正常重排一并砍掉。

**Rejected.** 只加「最多重算 N 次」的计数器——那是把循环停下来而不是消除它，
面板会停在一个按旧高度算出的错误列数上；也拒绝只做去抖延迟——测量本身是同步
布局读取，延迟只会把振荡摊到多帧，仍然不收敛。

## DEC-025 — ⛔️ 2026-11-14 — 划线不显示的两个漏检：prepend 与 eventSource 换代

取代: 无（DEC-014 / DEC-015 / DEC-017 / DEC-024 的判定规则、全局归属与 24 小时有效期全部
继续有效）。本条只修正「观察」这一层：事实已经判定正确，但有两类事件根本没能进入折叠。

**Context.** 用户报告：Trae 的 deepseek 与 ModelScope 的 deepseek 刚刚用光额度，面板上却
都没有出现删除线。取证方式是读宿主自己的持久化状态：`Local Storage/leveldb` 里的
`dshmf:insufficient` 记录显示，最后一次被折叠的观察是 `trae/deepseek-v4.1-flash` 在
03:39:33Z 的一次 **completed**，而真正失败的两次 `turn/end` 发生在 04:20:32Z（Trae，
`QUOTA`）与 04:22:40Z（modelscope-token-plan，`RATE_LIMIT` + `insufficient balance`）。判定
逻辑本身没问题——把这两条事件直接喂给 `isInsufficientBalance` 都会划线，整窗口重折也能得到
正确结果。问题在于它们从未被折叠。定位到两个独立的漏检：

1. **`prepend` 被当成「不可能改变标记」。** `applyWindow` 原来只处理 `replace` 与 `append`，
   注释写的理由是「prepend 只是把更早的历史翻进来，改变不了尾部推导出的标记」。这个理由
   对「尾部推导」成立，对本功能不成立：标记恰恰来自历史里的 `turn/end`。客户端打开会话时
   只取最新一页，失败的那一回合一旦落在窗口之外（长会话里很常见——实测有失败之后仍排着
   6508 条事件的会话），它就只能通过 `prepend` 进来，于是永久漏检。
2. **订阅按 sessionId 而不是 eventSource 记账。** `attachSession` 原来以 `stops.has(id)`
   判重。客户端是按需物化 Session scope、无人 retain 就回收的：切到别的会话再切回来，同一个
   id 会拿到**全新的 Session 对象与全新的 `eventSource`**。于是 store 一直挂在已退休的 feed 上
   ——新 feed 上的失败永不折叠（不划线），而旧 feed 若再有动静还会往状态里灌过期事实。

**Decision.** `prepend` 与 `replace` 走同一条重折路径：清掉该会话的 route、按窗口顺序
（由旧到新）整体重走。跨会话的单调水位（每条 route 记住最后一次判定的时间）保证这次重折
不会用旧事实盖掉新结论。订阅改为记 `{ source, stop }`，`attachSession` 先比对
`attached.source === source`，换代时退订旧的、丢掉旧的 route 映射再重连新的。
`settle-assistant` 仍然跳过——它只把 live attempt 换成 durable 的 Assistant 消息，不可能携带
`turn/end` 或 `request/header`。

**Consequences.** 两条回归用例先在原始代码上失败、修好后通过（`a failure paged in as
OLDER history still strikes its model`、`a re-materialised Session feed is followed, not the
retired one`）。副作用是翻页时会多折一整个窗口：`prepend` 本来就是一次网络往返，重折是
O(窗口)，与 Dec-014 的全局水位叠加后不会产生额外的可见重绘（`sameMarks` 保证快照身份稳定）。



## DEC-024 — ⛔️ 2026-11-14 — 删除线自带 24 小时有效期：一天没再试就不画了

取代: DEC-014 中「直到该模型下一次返回非额度不足再去掉」这条清除条件，以及 DEC-017 里
「划线一直保留到下一次调用为止」的隐含前提。DEC-014 的判定规则（数据来源、两层判定、标记
落在 route 上、只用删除线呈现）与 DEC-015 / DEC-017 的其余结论继续有效；旧条目按 append-only
规则原文保留。

**Context.** 用户提出：line-through 的 model 要记录下「这个变化发生的时间」；如果用户没有再
尝试这个模型，那么 24 小时之后再次展示这个模型时，需要取消 line through decoration。
DEC-017 其实已经给每条记录存了 `at`，但那个时间只用来越晚的观察压过早的观察（排序），
从来没有人拿它判断「这条结论还新不新」。于是一条划线只有两种出路：用户再次调用该模型，
或者这条记录满 7 天被裁掉。而「额度耗尽」恰恰是最容易自己好转的事实——每日额度重置、余额
充值、套餐转成限时免费——结果「昨天欠费」的模型到今天仍然画着线，面板在替它断言一件它并不
知道的事。

**Decision.**

- **`at` 同时充当有效期起点。** 新增 `STRIKE_TTL = 24h` 与纯函数
  `markIsLive(entry, now, strikeTtl)`：一条记录只有同时满足 `marked` 且「距上次观察不足
  24 小时」才画线。判定只看时间不看次数——「用户没有再尝试这个模型」在这套语义里正好就是
  「这条 route 没有新的观察进来」。
- **过期只停装饰，不删记录。** 记录仍按 `MARKS_TTL = 7d` 保留（包括 `marked: true` 的旧
  记录），它是这条 route 的时间水位：重放同一条旧失败事件时 `at` 与记录完全相同，
  `foldMarkEntry` 判为无变化，所以过期的划线不会被自己的历史复活。
- **重试会续期。** 再次调用又欠费 → 更晚的 `at` 进来 → 重新划线并再给 24 小时；再次调用且
  模型有任何其它回应 → 走 DEC-014 的清除路径。窗口永远是「距最新一次关于这条 route 的认知
  24 小时」，不是「距这一行被画出来 24 小时」。
- **谁在什么时候重算。** 划线自己到期是**没有任何事件会通知**的一次状态变化，所以由 store
  主动盯时钟：每次 fold 之后、每个座位 `subscribe`（= 列表被展示）时、点击 trigger 打开面板
  时（`markFace.refresh()`），外加一个设在「最近一条在画的划线的到期时刻」上的定时器。定时器
  句柄 `unref()`，不让一次「等一天」反过来拖住宿主进程或测试运行。
- **没时间戳的事件按「此刻」记账。** `eventTimeOf` 的兜底从 `0` 改为 `Date.now()`：一条没带
  `time` 的观察不是 1970 年的观察，按 0 记会立刻被判过期，划线反而永远画不出来。

**Rejected.** 把过期实现成删除记录（丢掉水位，重放旧历史会把划线复活，正是 DEC-017 已经拒绝
过的做法）；只在 fold 时重算（用户不再碰这个模型 = 不再产生这条 route 的事件，于是永远到不了
期）；把有效期塞进 `parseMarks`（那只管 `localStorage` 的读取，管不了页面存活跨过 24 小时的
情况）；给行加倒计时提示、或要求用户点一下才清除（需求只要「不再画线」，多出来的 UI 是噪音）。

**Consequences.** `client.js`：新增 `STRIKE_TTL` / `markIsLive` 并挂到 `__test`；
`createMarkStore` 增加可注入的 `now` / `strikeTtl` 与 `refresh()`，`recompute` 改为按时间判定，
`applyWindow` 折完统一走 `refresh()`，`dispose` 清定时器；face 与 `EMPTY_INSUFFICIENT` 增
`refresh`，座位在打开面板时调用它。顺带修掉一个此前被掩盖的 bug：`sameMarks` 用
`for (const key of left)` 迭代 Map（拿到的是 `[key, value]` 数组），恒判「不一样」，每次
recompute 都换一个新的 snapshot 对象——原先它只在真实状态迁移时才被跑到，错错相抵看不出问题；
时钟检查把它变成热路径之后，这就是 `useSyncExternalStore` 的无限重渲染（见 LES-019）。
render 测试新增 7 条：时间窗判定、只画新鲜的标记、快照引用稳定性、过期不复活 + 重试续期、
定时器自我唤醒、存储里的过期标记在展示时不画、打开面板重读时钟；并把此前当事件时间用的
`1000 / 1001 / 2000` 等假时刻换成 `ago(ms)` 的真实时刻——它们现在既是排序依据也是计时起点。

## DEC-023 — 2026-11-13 — family 行补「型号 + 倍数」尾标；分组标题也走跑马灯

取代: DEC-012 中「尾标只在同一 provider 于同一家族下有多个模型时才出现」的结论。
DEC-012 的其余部分（provider 为主文本、家族名不在行里重复、generation 拆分）继续有效，
条目本身按 append-only 规则保留原文。

**Context.** 用户在真实目录上看到 *按模型家族* 的信息量不足，两条具体缺失：

1. **倍数丢了。** 按 Provider 下能看到 `Hy4 · x0.00`、`Deepseek-V4.1-Flash · x0.01`；
   按家族下主文本变成 provider name，倍数随模型名一起消失，同一 provider 下的行看起来
   一模一样。
2. **型号丢了。** `Qwen` 标题下只写 `ModelScope International`，`Qwen3.8-Flash-Next`
   和 `Qwen3.8-27B` 无法区分——而这两个正是用户点名要看的东西（用户补了一句：
   `Qwen3.8-27B` 只是例子，关键是 `Qwen` 作为家族名可以被剥离）。
3. **标题也会截断。** `ModelScope Token Plan` 在窄列里同样变成 `ModelScope Toke…`，
   行有跑马灯而标题没有，交互不一致。

**Decision.**

- **尾标改为「剥掉家族名与 provider label 之后剩下的部分」。** 不再只在 id 尾巴上取词，
  而是拿模型名做两次减法：先按**子串**删掉家族名（`Qwen3.8-Flash-Next` → `3.8-Flash-Next`，
  `MiniMax-M3` → `M3`），再按**整词**删掉 provider 自己 label 里的词（`豆包 2.1 Turbo`
  → `2.1 Turbo`）。结果放在行**末尾**（`showVariant` 之后），字号 11px、caption 色。
  - **版本号保留。** 旧的 `idVariantOf` 会把纯数字丢掉，那正好丢掉用户要的型号；
    新路径只做减法，`3.8-27B` 完整保留。
  - **子串 vs 整词的选择是有理由的。** 家族名与版本号在真实 id 里是**粘在一起**的
    （`Qwen3.8`、`Deepseek-V4.1`、`MiniMax-M3`），整词匹配会一个都删不掉；provider
    label 则是独立词（`豆包`、`WorkBuddy`），必须整词匹配，否则 `AI` 会把 `Rain`
    打成 `Rn`。两种减法因此不能互换。
  - **减法只删，不重排、不改写。** 中间位置的家族名也删（`Fast Qwen Turbo` →
    `Fast Turbo`），删除处补空格，避免把前后两个词粘成一个。
  - **空的尾标是合法结果。** `Hy4` 在 `HY4` 标题下什么都不剩，就不画尾标；只有当模型名
    只剩家族/provider 时，才回退到 id 尾巴（`hy4free` → `free`、`auto` → `auto`），
    保证两行不会完全一样。真的撞了（同 provider、同家族、尾标相同）仍回退到唯一 id。
  - **倍数在尾标里也走 `nameRuns`。** `x0.01` 在按 Provider 下是「小一号 + 粗」，在尾标
    里保持同样处理（11px 容器内再降到 10px/700），否则同一个倍数换一种分组就换了长相。
- **分组标题复用行的窗口/轨道分层，跑马灯共用一套状态机。** `.dshmf-groupTitle` 现在是
  带 `display:flex` 的**框**，里面是 `.dshmf-groupTitleWindow`（裁剪 + ellipsis）包着
  `.dshmf-groupTitleTrack`（`width: max-content`）。hover 停留 0.5 s 后**只让轨道平移**，
  色带的底色、描边、圆角、阴影全程不动——和行里「badge 不动」是同一个结构性保证。
  - **关键帧不复制。** 标题轨道直接复用 `@keyframes dshmf-rowNameMarquee` 与
    `--dshmf-marquee-shift` / `--dshmf-marquee-duration` 两个变量，所以「一趟、
    ease-in-out、`1 forwards`、reduced-motion 关闭」四条自动同时成立。
  - **一套状态机。** 行的 route key 与标题的 block key（`t:…`）共用同一个 `marquee`
    state，进入任一方都会先 `disarm` 并清掉对方，所以面板里永远只有一处在滚。
  - **标题不响应键盘 focus。** 标题没有点击行为，focus 触发跑马灯会变成「Tab 过去就
    开始滚」的意外动效；行保留 focus 触发（聚焦的行就是用户正在看的那一行）。

**Rejected.** 在 family 行里恢复「模型全名 + provider 小字」（回到 DEC-004 的形态，
家族名重复且主次颠倒）；把倍数单独做成右侧 badge（目录 badge 位置已被 `限时免费`
占用，两个 chip 会打架）；用正则硬编码「取家族名之后的全部内容」（遇到
`Deepseek-V4.1-Flash` 这类家族名在中间/前缀混合的命名就崩）；给标题写第二套 keyframes
（两套必然漂移，且 DEC-022 的四条结论要维护两遍）。

**Consequences.** `client.js`：新增 `dropSubstring` / `dropWords` / `TAIL_EDGE`，
`rowVariantOf(model, family, providerLabel)` 改为减法实现并在 sections builder 里
对所有 family 行（不再只对「多模型 provider」）计算；`renderRow` 对尾标套 `nameRuns`；
`renderTitle` 走窗口/轨道；`enterRow` 增加第三个参数 `selector`；测量探针同步成
「标题窗口 + 轨道」与「行 + 尾标」两种形状。CSS 新增 `.dshmf-groupTitleWindow`、
`.dshmf-groupTitleTrack[data-running]`、`.dshmf-rowProvider .dshmf-rowNameMark`，
`.dshmf-groupTitle` 从 `text-overflow: ellipsis` 改为 flex 容器（ellipsis 下移到窗口）。
测试：`plan.test.mjs` 钉住子串/整词两种减法、版本号保留、空尾标与 id 回退、
悬空分隔符；`render.test.mjs` 钉住「Qwen 下两行靠型号区分」「尾标在末尾」
「倍数在尾标里仍是小一号粗体」「标题有窗口/轨道」「标题 hover 一趟后停」「面板内
同时只有一处在滚」。真实 Chrome（headless）复核：标题 20px 高不变、尾标 11px、
尾标内倍数 10px/700、标题轨道末帧右缘与窗口右缘重合、`ease-in-out` 采样
0→1.58→10.33→40→69.67→78.42→80px、移开后 `animations.length === 0` 且
`transition-duration: 0s`。

## DEC-022 — 2026-11-13 — 跑马灯只跑一趟、ease-in-out、离开即无动画归位

取代: DEC-021 中「一轮 = 去 + 停 + 回、`linear`、`infinite`」的三条结论。
DEC-021 的其余部分（窗口/轨道分层、0.5s 停留触发、badge 不参与、位移=截断量、
reduced-motion 关闭）全部继续有效，条目本身按 append-only 规则保留原文。

**Context.** 用户看完 DEC-021 的实现后提了两点：动画曲线要用 ease-in-ease-out，不要
linear；并且不要来回跑，「第一次跑完就停止」，鼠标挪开后立即恢复原样、不需要动画。

**Decision.**

- **一趟，单向，停在末尾。** 关键帧只剩 `from { translateX(0) }` 和
  `to { translateX(var(--dshmf-marquee-shift)) }` 两个点，`animation: ... 1 forwards`：
  跑完就停在「最后一个字形贴住窗口右缘」的位置，不回程、不重复。
  `forwards` 很关键——没有它，动画结束后会立刻跳回起点，鼠标一停住就会看到名字「闪回」。
- **`ease-in-out`，速度口径改为「平均速度」。** 单程 + 对称缓动，所以周期就是
  `shift / MARQUEE_PX_PER_SECOND`（原来的 `shift / 0.45` 是为「去+回各占 45%」留的预算，
  现在没有回程了）。ease-in-out 让起步和到达都变柔和，而不改变平均速度——用户说的
  「不要太快也不要太慢」约束的还是这个平均值。128px 溢出约 2.6s，比原来的 5.7s 短，
  因为它只需走一趟。
- **鼠标离开 = 立刻归位，无过渡。** `data-running` 一去掉，整条 `animation` 就从元素上
  消失，transform 直接回到初始值。轨道上没有 `transition`（`transition-duration: 0s`），
  所以不会出现「慢慢退回去」的动画——这正是用户要求的「立即变回原来的样子」。

**Rejected.** 保留回程但把回程放到鼠标离开时触发（会与「立即恢复」直接冲突，且离开时
还要一个动画，用户明确说不要）；用 `linear` 只改时长（第二条要求就是「不要 linear」）；
用 `animation-direction: alternate` 做来回（等价于 infinite，被明确否掉）；在 JS 里用
`transitionend` 把末尾状态固化成 inline style（多一套状态同步，且 `forwards` 已经够用）。

**Consequences.** 仍是纯 CSS + 一个纯函数：`marqueePassGeometry` 的 duration 公式去掉
`/0.45`，其余（shift、最小时长、reduced-motion、触发/取消路径）不变。测试同步改为钉住
「关键帧只有一个 0px 起点」「`ease-in-out`、不带 `linear`、`1` 次、`forwards`、不带
`infinite`」「duration == shift / speed」，并在 headless Chrome 里按 0/10/25/50/75/90/100%
采样确认：位移单调增加到恰好 171px（`trackRight === winRight`），末尾 `dx=171` 且
`playState: finished`，去掉 `data-running` 后 `dx=0`、`animations.length === 0`、
`transition-duration: 0s`，badge 左缘全程 165px 不动。

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
