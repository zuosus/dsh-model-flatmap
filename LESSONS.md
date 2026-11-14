# LESSONS

Project-level lessons log for the dsh-model-flatmap plugin. Append-only: new
entries go below the marker, newest first; old entries are never rewritten.

<!-- APPEND-ONLY LOG: 新条目插入到此行之后 -->

## LES-019 — 2026-11-14 — 「恒为真」的比较函数在冷路径上不会报错，只会等着

`for (const key of map)` 拿到的是 `[key, value]` 数组，不是 key。`sameMarks()` 一直这么写，
于是 `right.has(pair)` 恒为 false，函数在两个非空 Map 上恒答「不一样」。它在 main 上活了很久
都没被发现，因为调用点长成 `if (result.changed && recompute()) publish()`：只有
`result.changed` 为真（确实发生了一次状态迁移）才会跑到 `sameMarks`，而那一刻集合确实刚刚变过
——错误的「不一样」和正确的「不一样」撞在一起，看不出任何差别。

这次把 24h 划线有效期加进去之后，`recompute()` 从「偶尔跑到」变成热路径：每次 fold、每次订阅、
每次展示都要重算，而「没有变化就必须保持 snapshot 引用不变」是 `useSyncExternalStore` 的硬要求。
这个函数第一次以「两个相同的集合」为输入被调用，就立刻炸成无限重渲染。

- **结论**：要问的不是「这个函数对不对」，而是「它在哪些输入上被调用过」。给一个函数加新的调用
  路径（尤其从「仅在变化时」变成「每次都跑」）时，把它对「无变化」输入的返回值单独钉成一条用例。
  这次落成的断言是：`refresh()` 什么都没改动时，`getSnapshot()` 必须还是同一个对象、listener
  一次都不能被通知。
- **Map / Set 的遍历要写明确**：`for (const [key, value] of map)`、`map.keys()`、`map.values()`。
  单变量 `for (const x of map)` 十有八九不是想要的（本次同一轮里 `scheduleExpiry` 也踩了同一下，
  结果是定时器根本不设，测试不报异常、只是永远不响）。
- **`unref` 的顺带一课**：一个「一天后才响」的定时器会把 Node 测试进程吊住不放。浏览器里句柄是
  数字、没有 `unref`，所以写成 `typeof handle?.unref === 'function' && handle.unref()`，两边都安全。

## LES-018 — 2026-11-13 — 删字符串要分「子串」还是「整词」，选错会静默地什么都不删

这轮要做的事本质是一句「把重复的信息去掉」：family 标题已经写了 `Qwen`，行里就别再
出现 `Qwen`；provider 名已经是主文本，尾标里就别再重复 `豆包`。听起来是一个函数，实际
是**两种不同的匹配语义**，而且选错时**不会报错**——它只是安安静静地一个字都没删掉，
界面上看起来就像「需求没实现」。

1. **粘在版本号上的名字必须按子串删。** 真实 id 里家族名和版本是连写的：
   `Qwen3.8-Flash-Next`、`Deepseek-V4.1-Flash`、`MiniMax-M3`。用整词匹配
   （`\bQwen\b`）会一个都命中不了，因为 `Qwen3` 里 `Qwen` 后面紧跟数字，没有词边界。
2. **独立的 provider label 必须按整词删。** 反过来，如果对 `AI` 这种两字母 label 用
   子串删除，`Rain` 会变成 `Rn`——一个看不见的、更难查的 bug。
3. **所以两者不能互换，也不该合并成一个「智能」函数。** 现在的实现是两个各司其职的
   小函数：`dropSubstring`（家族名，删处补空格防粘连）与 `dropWords`（provider label，
   带 `\p{L}\p{N}` 边界 + 最短 2 字符门槛）。

另外两个配套结论：

- **减法优于「取某段」。** 一开始想的是「取家族名之后的部分」，但 `Deepseek-V4.1-Flash`
  这种家族名在开头、`Fast Qwen Turbo` 这种在中间的命名会让位置假设直接崩。做减法
  （从完整名字里减掉已知的重复项）对位置没有假设，天然覆盖三种情况。
- **空的合法。** 「减完什么都不剩」不是失败，是正确答案（`Hy4` 在 `HY4` 下就该没有尾标）。
  只有「减完剩空、但 id 还能提供区分信息」时才回退，否则会为了填满而制造噪音。

**验证方式也值得记一笔。** 这类「减法对不对」的问题，光看代码看不出，跑单测也只能验证
自己挑的样例。真正定案是把**真实目录**（ModelScope roster + WorkBuddy/Doubao 命名）灌进
组件渲染树，逐行打印 `primary / tail / marks` 看一眼——第一版就是这么发现
`Qwen3.8-27B` 的尾标是 `27b`（丢了版本）和 `豆包 快速` 的尾标是 `pro`（id 与 name 不一致）
的。

## LES-017 — 2026-11-13 — 「只动主内容」是结构问题，不是尺寸问题

跑马灯需求里最容易被做错的一条是「跑马灯内容仅限主内容，不要包含右对齐的 badge」。直觉做法
是给整行或整段名字加动画，再想办法把 badge 排除——结果要么 badge 被一起拖走，要么要靠
反向补偿、裁剪宽度去凑，任意一帧错位就露馅。正确做法是先问**「哪一层在动」**：把主文本
包进一个 `overflow: hidden` 的窗口，只让窗口**内部**的那一个轨道平移，badge 作为窗口的
兄弟自然不受影响。教训：涉及「部分元素参与动画」时，先确定参与动画的那一层边界，把需要
静止的元素放在边界**外**，而不是在同一个盒子里做排除。

另一个坑：把 `MARQUEE_DELAY` 的定时器挂在 `onMouseEnter` 却忘了在 `onMouseLeave` 里
取消，快速划过的行会在鼠标离开后依然启动。这类「延迟触发」的交互，取消路径和启动路径
必须成对设计；本轮测试先只覆盖了「停留后启动」，漏掉了「提前离开」，才把这个 bug 写进
代码——补上用例后才暴露。


## LES-015 — 2026-11-13 — 布局改成「共用容器」后，旧的边框归属要一起搬家

把一个元素从「独立一行」改成「与另一个块共用 flex 容器并可能并排」时，挂在这个元素上的
`border-top` 不会自动跟着语义走：它仍只覆盖自己那一半，视觉上就成了错位的半截线。
教训：**装饰线属于它所分隔的两个区域之间的那条边界，不属于其中某一块。** 一旦上下两块
被包装进同一个容器，线的归属要跟着上移到容器，并检查深色主题选择器与 padding 是否
一起搬走；同时同步 render 测试的断言目标，否则测试会继续为错误位置背书。

## LES-016 — 2026-11-13 — 先问「这条事实属于谁」，再决定把状态挂在哪

这次 bug 的根因不是判定规则写错了，而是**状态的归属判断错了**。DEC-014/015 把「额度
不足」判定得相当扎实（真实日志校准、429 读正文），但把结论存进了**单个会话**的 face，
还随座位卸载 `dispose()` 掉。用户一句话点破：额度不跟 session/workspace 绑定。于是
同一个模型在 A 会话里欠费，B 会话依旧显示可用——判定再准也没用，因为它存错了地方。

三个可复用的判断：

1. **事实的归属决定状态的归属。** 「这次请求失败了」属于这个会话；「这个模型/账号还有
   没有额度」属于模型路由。凡是后者，状态就必须是全局的，并且要跨会话、跨工作区、跨
   重载存在。先写下「这条事实是关于谁的事实」，再决定它放在哪里，能省掉一整轮返工。
2. **跨来源合并必须有一个单调的水位。** 会话 feed 没有跨会话序号，但每条 durable 事件
   都带宿主的墙钟 `time`。用「每条 route 记住最后一次判定的时间，更旧的直接丢弃」，
   才能同时满足三件事：历史 replace 重放不复活旧划线、加载更早的会话不覆盖新结论、
   并发的乱序到达结果确定。用「最后写入覆盖」会在这三种情况下给出不确定的结果。
3. **清除不要实现成删除。** 删掉记录会连带丢掉 watermark，于是回放一条旧失败就把划线
   复活了。保留 `{marked: false, at}` 才是「我知道它已经恢复，且是在这个时间点」。

另外两个落地细节：座位卸载时**不要** dispose 共享 store（标记属于页面，不属于座位）；
座位在构建 face 时主动 `watch()` 自己那个 session 并 pin 住，因为 `sessions.list` 可能
还没列出它——只依赖列表同步会漏掉刚打开的会话。存储沿用既有的「origin 作用域 + 失败
即降级 + 读取时按 TTL 丢弃」写法，与分组选择保持一致，不引入第二套持久化风格。
## LES-014 — 2026-11-13 — HTTP 状态码不是语义：用真实历史校准判定，而不是凭直觉

这次差点犯两个反向错误，都是「凭直觉写规则」导致的：

1. **429 不是「限流」的同义词。** 直觉上 429 = 限流 = 账户还有钱 = 不该划线；但真实
   数据里 modelscope-token-plan 用 `429: {"message":"insufficient balance"}` 表示余额
   耗尽，出现 71 次。宿主对两种含义都标 `RATE_LIMIT`，所以判定必须读正文。教训：当
   一个状态码在同一字段上承载相反语义时，状态码只能当提示，不能当结论。
2. **关键词命中不等于语义命中。** 想让「额度」相关就划线，会误伤两条真实反例：上下文
   超限的消息写「与网络、账号、额度都无关」，传输失败的消息只是「建议等待额度恢复」。
   教训：中文关键词判定必须配否定语境与反例测试，否则宽一点的词表就是误报来源。

方法上的收获：**别猜，去折叠真实日志。** `~/.dsh/sessions/*/session.v4.jsonl.zstd`
（1270 个会话、251 MB、zstd 压缩）里 `turn/end` 的 `reason.error` 就是判定事实的
唯一权威来源。用 Node 内置 `zstdDecompressSync` 全量扫一遍，按「去 id/去数字」的形状
去重，就能得到 27 个真实形状而不是想象中的形状。把其中 20 个正例 + 7 个反例原样粘进
测试表，判定逻辑就被真实数据锁住了——这比再想十个可能的措辞有效得多。顺带一个细节：
真实失败里 `code` 与 `status` 的组合远比文档多（486 条无 status），所以分类器必须容忍
`status` 缺失，不能把它当作必填。
## LES-013 — 2026-11-13 — 先找宿主已有的分类，再决定要不要新机制

这次需求看起来需要「监听模型调用结果」，直觉是加一个宿主投影或事件。实际情况是：
`turn/end` 的 `reason.error` 已经带着 `code` / `message` / `status`，而且宿主
（`dsh-llm/src/error.ts` 的 `isQuotaExceededError`、`dsh-llm-deepseek` 的
`providerError`）已经把「额度耗尽」和「临时限流」分好类了，HTTP 402 也映射成
`QUOTA`。纯浏览器插件要做的只是折叠已有事件流。教训：

1. **先确认宿主是否已经分类过这件事。** 在 asar 里按语义关键词（`insufficient`、
   `402`、`quota`）搜一遍 `dsh-llm` / `dsh-llm-*`，比自建判定便宜得多，也更准；
   自己写正则容易把 `RATE_LIMIT` 误判成额度不足。
2. **错误事实与模型身份在两个事件里。** `turn/end` 说「为什么结束」，模型在它前面
   最近的 `request/header.header.config` 里。按「当前选中模型」加标记是错的——用户
   可能在失败后已经切走了。
3. **清除条件要区分「模型回应过」与「根本没跑」。** `aborted` / `blocked` /
   `interrupted` / `forked` 都不证明额度恢复；只有 `completed`、`max-tokens` 或
   另一种 `error` 才证明。否则用户取消一次就会误清标记。
4. **inject face 是按 entry+binding 缓存的，可以放心持有状态。**
   `dsh-client-ui-renderer` 的 `runInject` 结果存在 `sessionInjectCache` 里，同一
   binding 不会重建 face；所以订阅放进 face、用 `useSyncExternalStore` 读快照是安全
   的，但 snapshot 必须引用稳定，否则每次渲染都重绘。
5. **事件流的 `prepend` 与 `replace` 语义不同。** `replace` 要整体重折；`prepend`
   是加载更早历史，不可能改变尾部推导出的标记，重折只是浪费。
## LES-012 — 2026-11-13 — Let flex-wrap own "does it fit on one line"

When the requirement is "put A and B on one line if they fit, otherwise keep
two lines", the tempting implementation is a measured pixel threshold: read
`A.offsetWidth + B.offsetWidth + gap` and compare it to the container. That is
a second, hand-rolled copy of a computation the browser already performs
exactly and continuously. It adds a first-paint flash (measure happens after
paint), it goes stale on font load, locale change, scrollbar appearance and
theme switch, and its breakpoint is off by sub-pixel rounding.

The robust shape is to give the two items one flex container with
`flex-wrap: wrap` and the required `column-gap`, let each item keep `flex: 0 0
auto` and `max-width: 100%`, and let the browser break the line. The gap
requirement is then stated once, as CSS. JS is only needed for facts CSS cannot
express — here, whether the two ended up on the same line — and that flag must
be *derived after layout* and must never feed back into layout, otherwise a
stale flag can pin the wrong state.

Also: when two previously separate fixed rows become one container, fix the
height accounting in the same change. Summing the children's heights still
"works" in the two-row state but double-counts a shared line, silently
shrinking the scrolling grid. Measure the container, not the parts.

## LES-011 — 2026-11-13 — "Smart, flexible" row text means conditional, not just restyled

Three traps from reworking family rows, worth remembering before the next
"make the text smarter" request:

1. **Decide what the heading already says before choosing the row's primary
   text.** A family heading tells you WHAT and (with generations) WHICH
   generation. Printing a model/family name in the row repeats it; the missing
   fact is the provider. Inverting primary/secondary (provider primary, no
   family name, model name kept in the tooltip) is the actual fix — not a font
   or colour tweak.
2. **"On demand" needs a real condition.** Adding a variant tag to every row
   is noise. The right condition is "one provider has >1 model in this family";
   the plain base model then legitimately carries NO tag at all (null), which
   is more informative than a forced label. Let an empty derived variant mean
   "no tag", and only fall back to the unique id on a genuine collision.
3. **Validate against a pristine base when the tree has concurrent writers.**
   HEAD here already failed 29 render tests because a teammate's teamwork
   commit changed `teamAvailable` from a boolean to a function while the test
   harness still passed a boolean. Those failures were NOT mine. I confirmed
   by running the suite against a clean `git show HEAD:client.js`, then fixed
   only the harness (make `teamAvailable` a function), never the teammate's
   plugin code, and reported the base issue. Never "fix" a failing suite by
   rolling back someone else's work.

## LES-010 — 2026-11-13 — Pick the theme-invariant palette when the spec fixes a colour

A request for "a deep blue background with white text" is a *fixed* colour
pair, not a theme-adaptive one. Wiring it to `--dsw-alias-state-business-primary`
looked correct in the light theme (deepseek-500) but silently flipped to a
light blue with dark text in `body[data-ds-dark-theme]`, because that alias is
defined twice with opposite values. The host's `--dsw-static-*` palette is
declared once in the global `body` rule and never changes between themes —
`--dsw-static-deepseek-600` (`#4868b2`) and
`--dsw-static-neutral-bluish-00` (`#fff`) give the same deep-blue/white band
in both. Check whether a token's value is theme-dependent before using it to
honour a colour that the spec pins down, and verify the dark theme explicitly:
a passing light-theme screenshot says nothing about the other half of the
palette. This is the mirror of LES-004 (which was about composited contrast):
there a fill had to step away from the surface, here a colour had to stay put.


## LES-004 — 2026-11-13 — Verify a fill's *composited* contrast, not just its name or value

`--dsw-alias-menu-group-header-fill` is designed for the host's own menus,
where it sits against a different surface. On this panel — whose rows sit on
translucent `--dsw-menu-surface-fill` — the two are nearly the same colour (a
few levels apart) in both themes, so the bare token (even with DEC-003's frame)
does not buy separation. Two traps: (1) judge a fill by the **composited**
result over the actual surface/backdrop, not by its raw value; (2) do not
assume mixing toward `--dsw-alias-label-primary` helps — that token is dark in
light themes, but a light-theme header band must get *lighter* than the surface
to stand out, so that tint actually reduced separation. The robust fix was the
panel's own floating-segment recipe: an opaque `--dsw-alias-bg-layer-1` fill
(white in light / near-black in dark) with `--dsw-elevation-soft`, which
separates in both themes with no hard-coded colour or second theme branch.
Also: when concurrent writers already took DEC-003/LES-003, append with the
next free IDs instead of reusing or renumbering theirs.

## LES-003 — 2026-11-13 — Verify a row-layout change against the REAL panel width, not a guessed one

`PANEL_MAX = 320` is the panel's **height** cap, not its width: the placement
effect sets `width = clamp(280, vw - 24, 560)`, so the panel is normally much
wider than 320 px. Previewing the new per-row provider tag in a 320 px mock
therefore showed "CodeBuddy …" truncation that does not happen in the product,
and it took a `max-width: 45%` cap — which *caused* real truncation at the true
width — to notice the mistake. Read the placement code for the real geometry
before judging a dense layout, and drop width caps on secondary text: flex
already shrinks it, and a cap truncates labels that had room.


## LES-002 — 2026-11-13 — "Multi-segmentation" means reusing the panel's own segment recipe

When the user asks for a "multi-segmentation 控件" visual, do not invent a
new control: reuse the token recipe the panel already ships for
`.dshmf-seg`/`.dshmf-segBtn` (`interactive-bg-hover` track + 2 px inset +
`bg-layer-1` active segment + `elevation-soft`). Two segment-styled controls
on one panel read as one design system; a third invented flavour (e.g. the
brand-fill pills of DEC-001) is what prompts the redesign. Also: the
user-specified wording for a caption (推理等级 vs 思考强度) is a spec item —
use their exact term, and keep the explanatory detail in a tooltip instead
of widening the caption.

## LES-001 — 2026-11-13 — Host token/theme inspection: grep the asar with narrow windows only

The installed host ships its entire client (including the `--dsw-alias-*`
theme CSS) inside a single ~200 MB `app.asar` file. `grep -a` with a wide
context window (`.\{80\}`) against it takes minutes and overruns the bash
timeout. Use narrow windows (`grep -ao -- "token:[^;}]*"`), or verify a token
by its use in already-working plugin code. `--dsw-alias-brand-primary`,
`--dsw-alias-label-primary-foreground`, and `--dsw-radius-md` were confirmed
present this way; the brand/foreground pairing is already exercised by the
host switch, so it is safe for text on a brand background in both themes.
