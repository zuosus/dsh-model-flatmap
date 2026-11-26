# LESSONS

Project-level lessons log for the dsh-model-flatmap plugin. Append-only: new
entries go below the marker, newest first; old entries are never rewritten.

<!-- APPEND-ONLY LOG: 新条目插入到此行之后 -->
## LES-051 — 2026-11-26 — `files` 数组漏了被 import 的模块，发布出去的 1.6.0 装完就报 `ERR_MODULE_NOT_FOUND`

`index.js` 里 `import { readConfigFile } from './config.js'`，但 `package.json` 的 `files` 只列了 `index.js` / `repo-url.js` / `telemetry.js` / `client.js` / `cordis.patch.yml` / `locale/*.json` / `docs` / `icon.svg`。`config.js` 缺失，于是 1.6.0 的 tarball 里根本没有它——**每一个从 npm 安装的用户，宿主半边都加载失败**。而本地 checkout 里 `config.js` 一直在，全部 374 条测试也一直全绿，因为测试跑的是工作树，不是 tarball。

这是「测试覆盖了代码正确性，却没覆盖产物完整性」的典型缺口。三步自查，按代价从低到高：

1. **改完 import 就扫一眼 `files`**：新增一个被入口 import 的相对模块时，`files` 必须同步。这条靠自觉，最容易漏。
2. **加一条声明式测试**（成本极低，已落地为 `test/package.test.mjs`）：遍历 `index.js` / `client.js` 的相对 import 图，断言每个节点都能被某个 `files` 条目匹配到。它不跑 npm，只读 manifest，所以毫秒级。注意 npm 特性：`package.json`、`README*`、`LICENSE` 无论如何都会被打包，对它们断言 `files` 是假阳性。
3. **发版前真的解包验证一次**：`npm pack --pack-destination /tmp/x` → `tar xzf` → `node -e "import('./package/index.js')"`。这是唯一能证明「用户拿到的那个东西能跑」的检查。`npm pack --dry-run` 只列出文件，不证明它们能互相解析。

顺带：`npm view` / `npm pack` 在沙箱里若报 `EPERM` 指向 `~/.config/npm/cache`，是缓存目录权限问题而非网络或凭据问题，加 `--cache <临时目录>` 即可，别误判成需要重登。


## LES-050 — 2026-11-26 — 一个「偏好」开关，要有读它的人、要在会活下来的地方；两者缺一都等于没做

用户说「我嘱咐过要默认开启，但实践中常常是关闭的」。查下去是两个缺陷叠在一起，而且**任何一个单独修好都不会改变用户看到的现象**：

1. **没人读**。默认值只写进 `localStorage`，插件里没有任何代码在打开会话时去取它、更没写 `team/mode`。开关能翻、能持久化、测试也过——只是它从来没有影响过任何东西。这类「装饰性开关」特别难发现，因为它的每一层都自洽。
2. **存的地方会消失**。桌面版 GUI 每次启动用不同的 `127.0.0.1:<随机端口>`，而 `localStorage` 按 origin 隔离。就算第 1 条修好了，用户也只会看到「我设了，重启后又是关闭」。

教训按顺序有三条。**第一，给一个偏好写测试时，要断言「它改变了什么行为」，而不只是「它存下来了、读回来了」。** 本次原有的两条测试只覆盖存取往返，全绿，恰好掩盖了功能从未生效。补的测试是「打开一个无选择的会话会调用 `setEnabled(sessionId, true)`」。**第二，先确认存储介质的生命周期覆盖你说的那个生命周期。** 端口随机 → origin 随机 → `localStorage` 不可靠，这是本项目已经踩过一次的坑（DEC-060 把可见性搬进 `config.yaml` 就是为了同样理由），所以第三个偏好应该一开始就跟它们放一起，而不是先图省事放浏览器再搬。**第三，把「应用点」和「存储」当成两个独立可验证的修复**，各自给红→绿证据；这次分别把应用 effect 删掉、把 store 换回 `localStorage` 版本，各转红 7 条，才能证明两处都真的在起作用。

顺带两条实现坑：（a）改动会导致设置页的开关在面板里「看起来没反应」，因为读是异步的——用 `dirty` 标记让本地点击不被迟到的文件读取覆盖，否则用户点了开、文件里旧值晚到、开关自己弹回去；（b）`apply()` 里还有心跳，它的后台写会让测试清理目录时撞 `ENOTEMPTY`；测某个独立安装函数时直接调用它，或给状态文件预置「今天已完成」，不要让无关的后台 IO 决定测试成败。

**最重要的一条，是这次差点交付一个假的修复。** 我最初把应用点放在面板里，判断 `agentTeam` 投影的 `enabled === undefined` 表示「从未选择」，写了 5 条测试还全绿——因为测试桩让投影返回了 `{ enabled: undefined }`。但宿主源码里 `buildTeamProjection` 返回的是 `enabled: state.enabled === true`，**客户端永远看不到 `undefined`**，那个条件在生产里恒不成立，而且它会把用户显式关闭的会话也"修正"成开启。教训是：**断言一个东西「看得到某个状态」之前，先去读产出那个状态的那一行代码**，尤其是跨进程/跨层的契约。测试桩不是规格，它只反映我当时的假设；桩伪造出一个宿主不会发出的形状，测试就成了对我自己猜想的自证。正确顺序是先在宿主源码里找到「没选过」到底如何表达（这次是原始事件日志 + `inheritedEventCount` 水位），再决定在哪里判断、写什么测试。


## LES-049 — 2026-11-26 — `client.js` 的整段 CSS 在一个模板字符串里，注释里写反引号会让整个文件语法错误

本插件的 CSS 不是独立文件，而是 `const CSS = \`...\`` 这段模板字符串。想给某条规则补一句注释、顺手用反引号标出属性名（例如「它自己的 \`title\` hint」）时，那个反引号会**提前结束模板字符串**，后面的英文单词变成裸标识符——`SyntaxError: Unexpected identifier 'title'`。

后果有迷惑性：`node --test test/` 会把 `plan.test.mjs`、`render.test.mjs` 等每个测试文件都报成 `'test failed'`，看上去像五处独立故障，实际只有一处语法错误。排查顺序应该是先 `node --check client.js`，再跑测试。

对策：CSS 注释里不要用反引号，需要强调就写成普通词（`title hint` 而不是 \`title\` hint）；改完 CSS 字符串后先 `node --check`，再跑测试集。另外，删除一条 CSS 规则时，测试里按「下一条规则的选择器」切片的断言也要同步改锚点——本次删掉 `.dshmf-teamLabel` 后，一处 `css.slice(indexOf(".dshmf-team {"), indexOf(".dshmf-teamLabel {"))` 会静默切到文件末尾，断言照样通过但覆盖范围变了，属于「测试变绿但失效」的隐患。


## LES-048 — 2026-11-21 — 测试运行时补上 `useLayoutEffect` 时，flush 要给最小 `window`

本插件的 render 测试用自建的 hook runtime 跑真组件。原先 `useLayoutEffect: () => { cursor += 1 }` 只是占掉一个槽位——组件里所有布局效应（测量、placement、定位）在测试里从未真正执行过。要测「打开面板时把网格滚动到选中行」就必须真的跑布局效应，于是把它改成和 `useEffect` 一样的排队 + `flushLayoutEffects()`。

坑在于：一旦真的执行，面板自己的 placement 布局效应会调 `window.addEventListener('resize'/'scroll')`，而测试环境没有 `window`，直接 `ReferenceError: window is not defined`——报错点还在 `client.js` 里，看上去像产品代码的 bug。正确做法是在 flush 期间临时挂一个最小 `window`（`addEventListener`/`removeEventListener` 空实现 + `innerWidth`/`innerHeight`），flush 完在 `finally` 里还原。顺带这也验证了这些效应在「没有真实布局」时是安全降级的。

另一条：写这类 DOM 交互的断言时，先手算一遍期望值再写进 `assert.equal`。本次四条期望值里有三条第一次算错（把「视口在文档中的偏移」当成视口高度、把 `getBoundingClientRect` 的绝对坐标当成相对坐标），红的原因全是算错而非实现错，白白多跑一轮。

## LES-047 — 2026-11-20 — 「只有一个 source of truth」意味着删掉缓存，而不是把它留作首帧便利

用户说 `localStorage` 不参与、只能有一个 source of truth 时，正确动作是彻底删除缓存的读写与镜像，而不是保留一份「首帧先画缓存、Host 应答后文件覆盖」的折中——后者仍有两个数据源，且缓存与文件冲突时还要解释谁赢。删的时候同步删 `readStored`/`writeStored` 参数、`readHidden`/`writeHidden`/`readAliases`/`writeAliases` 函数与 `HIDDEN_KEY`/`ALIAS_KEY` 常量、`__test` 导出和文档提及，一处不留。

配套教训：删除一批测试时，若它们恰好用 `delete globalThis.localStorage` 掩盖了**另一个无关测试**泄漏的 `globalThis.localStorage`，删掉后那个泄漏会暴露、拖垮后面的测试。改测试块时若发现「隔离通过、全序列失败」，先查前序测试是否泄漏了全局状态，在**泄漏源头**补 `finally { delete globalThis.localStorage }`，而不是在受害者身上打补丁。

## LES-046 — 2026-11-20 — 迁移失败要能"退回旧地址继续用"，而不是只吞掉异常

把数据目录从 `$DSH_HOME/<name>/` 迁到 `$DSH_HOME/plugins/<name>/` 时，最容易写出的半成品是：迁移函数 `try/catch` 吞掉异常返回 `false`，调用方却仍然按新路径读写。结果是迁移失败的那一刻插件表面没崩，实际上读的是一个空目录——用户的统计开关被重置成默认值、安装 id 换新，比直接报错更难排查。

正确做法是把"路径解析"和"迁移"分成两个函数：`resolveDataDir()` 只算规范的新地址；`resolvePluginDataDir()` 才决定这一次到底用哪个目录（新地址存在 → 新地址；否则旧地址存在 → 旧地址）。迁移函数只负责搬，失败返回 `false`，让解析函数自然落到旧地址上。测试要专门覆盖这条：注入一个 `rename` 和 `cp` 都抛 `EACCES` 的假文件系统，断言不抛异常、返回 `false`、且 `resolvePluginDataDir()` 指回旧目录、还能读到旧目录里的真实设置。

另一条：跨卷回退（`EXDEV` → 递归拷贝 + 删除）必须处理"拷贝到一半失败"的中间态——先 `rm` 掉半成品目标目录再抛错，否则下一次启动会看到目标目录已存在，误判为"迁移已完成"而永远读缺文件的目录。测试里用假 `rename` 抛 `EXDEV`、真 `cp` 执行，同时断言 `cp` 收到 `recursive: true`。

最后一条流程教训：先写测试时如果直接 `import` 一个还不存在的导出，红阶段的失败会是 `SyntaxError: does not provide an export`——那是导入错误，不满足"因行为缺失而失败"的要求。先补上导出与空实现（返回 `false` / 走旧路径），再跑一次，让失败变成断言差异，红→绿证据才站得住。

## LES-045 — 2026-11-20 — 目标是固定站点时，别沿用「从本地状态推导」的旧机制

把链接从「本项目 GitHub 页（从 git remote 推导）」改成「宣传插件市场（固定站点）」时，最大的陷阱是只改兜底常量、保留旧的 remote 推导与宿主路由：那样有 remote 的机器仍打开仓库页，恰好背离新意图，还留下一段无人再用却看似合理的复杂代码。

正确做法是先判断新目标的性质：市场是稳定公共地址，不是 checkout 的属性，因此整套推导（git 读取、宿主路由、预取、超时、fallback、相关文案）都该删除，只留一个常量。浏览器半边不能 import 宿主模块，常量要在两半各声明一次，用测试把两者钉在一起防漂移。删功能时同步清理测试、README / DETAIL 文档与残留注释，避免「代码已改、文档还在讲旧机制」。

配套教训：测试先行时，红阶段的失败要全部命中「行为缺失」（常量不存在、旧路由仍注册、旧文案仍在），而不是环境或语法问题；绿阶段再确认全套通过。

## LES-044 — 2026-11-18 — 「默认」和「本次」是两个作用域，别让临时开关污染默认偏好

用户要求给智能体团队协作加「默认开关」，并特别说明：模型面板里的开关是临时改动，不影响默认值。实现时最危险的诱惑是复用同一个 store，或者在会话开关的 `setEnabled` 里「顺手」写一下默认——那正好把用户刻意分开的两个作用域混成一个。

正确做法：默认值单独一个 store（仅设置页可写），会话开关依旧只走 `remote.agentTeams.setEnabled(sessionId, enabled)`；seat face 上根本不提供默认写入口，从结构上让两条路径无法互相触碰。测试要显式钉住「会话开关不会写默认」（断言 face 没有默认 setter，且只调用一次带 sessionId 的 setEnabled）。

配套教训：默认值要与上游宿主的默认保持一致（宿主 `agent-team.defaultEnabled` 默认 `false`），所以缺失/损坏记录必须读成 `false`，而不是像遥测那样读成 `true`。同一套 localStorage 读写模式，默认方向不同，照抄会得出相反行为。

## LES-043 — 2026-11-18 — 条件渲染的依赖是外部服务时，缺失不能等同于「功能不存在」

面板插件里一个由宿主 namespace 服务驱动的开关，若按「服务不在就不渲染」实现，profile 刚配置但进程未重启、或客户端挂载早于服务时，用户只会看到控件凭空消失，然后去插件源码里找「是不是被删了」。更诚实的降级是保留控件、禁用并写明原因：它把「功能不支持」和「尚未就绪」分开，也给了用户下一步动作。

验证方式：把「缺失即隐藏」的旧断言改成「缺失仍可见但禁用且不可点击」的断言，并同时覆盖服务缺失与 projection 缺失两条路径。


## LES-041 — 2026-11-17 — 「就地无解的灰按钮」要把解释放到用户能去的地方，并让解释由同一判据驱动

按钮被禁用时，用户最需要的是「为什么」和「下一步去哪」。这个插件的「默认样式」灰掉是因为交出席位不安全（DEC-049），而修复动作在另一个插件那里——按钮自己既不能解释也不该假装能修。合理做法是让设置页这张「用户本来就会来配置的页面」说话，而不是在按钮旁塞一段 crowding 的提示。

一个关键陷阱：如果解释卡用「severity」这种粗粒度状态判断，就会和按钮的真实可用性漂移。本次让 `diagnoseSeat` 暴露与 `canStepAside()` 同源的 `nativeAvailable`，设置页据此显示——两处判据同源，才不会出现「按钮亮着、说明却说不可用」的假话。验证方式沿用本项目惯例：先用真实 `SlotCore` 形状的夹具跑出新断言失败，再收修复。

## LES-042 — 2026-11-17 — 「打开页面」本身就是一个失效信号，尤其当变更不会发事件时

修 DEC-053 时我给设置页的目录加了五个 Host 事件的失效通道，能覆盖「插件中途注册」。但用户删掉
provider 后设置页仍列出它：删除往往**不发任何事件**，而且用户关闭设置页的这段时间订阅根本不存在，
于是事件通道两头落空，快照停在首次读取。

教训是：**失效策略要按变更的种类逐一过一遍**，不能只覆盖最显眼的那一种。「新增 / 注册」有事件，
「删除 / 关闭插件」可能没有；事件订阅只覆盖前者，必须再有一条与事件无关的通道兜底。「用户重新打开
页面」就是这条通道 —— 它是一次明确的「给我看当前状态」的信号，此时重新读取的代价（一次请求）远小于
展示已删除东西的代价。判断该不该缓存时，别只问「谁负责让它失效」，还要问「有没有变更根本不会通知我」。

配套的一点：React 里「面板关闭时整块卸载、只渲染 active 一节」意味着**每次打开都是一次真实挂载**，
挂载 effect 就是天然的新鮮度边界。把「打开」当成失效点，比在组件内部猜「数据可能变了没」要可靠。

## LES-040 — 2026-11-17 — 「一处看得到、另一处看不到」先查两边读的是不是同一份数据，再查渲染

用户说 Raccoon provider 在 picker 里看得到、在设置页看不到。我一开始往渲染方向想（过滤、
折叠、分组），实际根因在**数据获取层**，而且是一行 memoisation：

```js
load: () => {
  if (snapshot.status === 'ready') return Promise.resolve()   // ← 永久记忆
```

**两个表面读的不是同一个源**，这件事 DEC-034 当时就写清楚了，但只写了一半的后果：

- picker → `modelDirectories.directoryFor(sessionId)`，内置 resolver 订阅了五个
  `llm/*` / `settings/*` / `credentials/*` 事件并 `refresh()`，**有失效通道**；
- 设置页 → `remote.session.modelCatalog()` + 自建 store，**没有任何失效通道**。

于是同样的 Host 状态，一个有刷新路径、一个没有，症状就表现成「只有设置页不对」。
教训是：**当两个 UI 表面读不同数据源时，「它们在某个时刻会分叉」是结构性的，不是偶发
bug**；选源的时候要同时选失效策略，否则就是在造一个只会在插件中途注册时才现形的 bug。

排查顺序因此应当是：先确认两边**数据源**是否相同 → 再看同一个源的两边**失效策略**是否
相同 → 最后才看渲染。渲染层没问题，查多久都是白查。

另一条：`status === 'ready'` 这种「成功即终态」的 memoisation 在**目录类**数据上是危险
默认值。目录是 Host 的状态投影，不是常量；凡是有 `xxx-updated` 事件的地方，就说明上游
自己认为它会变。写缓存时先问一句「谁负责让它失效」，答不上来就不要缓存。

验证方式也值得记：我用一个独立脚本喂一个「首读之后才多出一个 provider」的假 Host，
在改代码**之前**先跑出 `STALE`，改完再跑出 `fresh`。先有能失败的证据，再谈修复。

## LES-039 — 2026-11-17 — 按钮承诺的能力，必须先在真源码上验一遍再写文案

做「设置页冲突提示 + 强制修复」时，我先写了「修复会补上缺失的子槽，让默认样式恢复可用」，
然后才去真实 `SlotCore` 上验证。结论是**做不到**：`renderSlot` 读的是**当前被选中 entry**
的 `children`，而原生模式要 dispose 我们自己的 entry，渲染的是继承者的子槽。在我们自己的
entry 上声明那个子槽，对用户零作用。

如果没验，交付的会是一个「按下去什么都不会变」的按钮，配一段理直气壮的说明。**功能是对的、
测试是绿的、文案是假的**——这是最坏的一种交付。所以顺序应当是：先在真实运行时上确认这个
动作到底改变什么，再决定按钮叫什么、说明写什么。

由此得到一条可直接套用的判据：**「这个按钮按下去，屏幕上的哪一处会变？」** 答不上来就不要
画这个按钮。空位状态下我做对了——只给「刷新页面」，因为只有刷新能让 shipped entry 重新注册；
已持有格子时连按钮都不给，只给解释。

第二个教训是**测试里塞 stub 会让修复永远是绿的**。第一版 UI 测试传的是
`repairSeat: () => { repaired += 1; return { ok: true } }`，它证明「点了会调用」，完全不证明
「调用会修好」。改成经 `settings.section` 的 inject face 驱动**真正的** `repairSeat`，立刻
暴露了一个真 bug：`unmountSeat()` 同步触发槽位通知 → 重入 `syncMode` → 把刚 dispose 的 entry
重新挂上，修复后留下两个 entry（`[-1, -7]`）。这个 bug 靠读代码很难发现，靠真实调用一秒钟
就现形。**凡是「动作类」功能，测试必须驱动真实现，不能只驱动到边界。**

第三个：`repairable` 这种布尔量的语义要写死成「有没有一个能改变现状的动作」，而不是
「有没有问题」。我一开始让 `contested`（有竞争者但我们仍持有）也 `repairable: true`，
于是页面在完全正常的状态下也提供修复按钮，按下去还会把 priority 一路往下棘轮。

## LES-038 — 2026-11-17 — 用真实源码复现，别用自己想象的机制复现

排查「本插件与 acp 插件冲突」时，前几轮都在自己写的模拟槽上跑，得出的结论是「优先级冲突
会让 acp 抛错，所以它没注册上」。换成**从 `dsh-web-frontend` 里抠出来的真 `SlotCore`** 后，
结论翻了一半：静态 bundle 行**不经过**动态 runner 的优先级改写（`guardedSlots` 只作用于
动态 Cordis 包），所以 acp 是带着默认 priority 0 进来的，和 shipped 撞格、**真抛错**。

教训不是「要测得真」，而是**模拟层的假设要写出来并单独验证**：

- 我以为「动态插件都会被重写 priority」→ 去 `dsh-cordis-client-runner` 读
  `guardedSlots`，确认它只挂在 `DynamicCordisPackageRunner` 的 `load()` 上；两个插件都是
  静态 bundle 行，根本不走那条路。这一条如果没查，修复方向会完全错（会去调 priority 数值）。
- 我以为「别的 entry 在 = 原生选择器在」→ 读渲染器 `renderSlot`，发现它读的是
  `entry.children[key]`，**子槽由被选中的 entry 挂载**。于是「有没有人」和「是不是原生
  选择器」是两个问题，混成一个就交出了没有回程的席位。

另一个反复踩的点：**测试夹具太干净反而掩盖 bug**。夹具里「shipped 竞争者」只是一个裸组件，
没声明 `.label`/`.options`，而真实的 `ModelSelect` 两个都声明。旧断言因此永远绿。改成默认
带上真实子槽声明后，6 条既有测试立刻变红——它们红得对，因为夹具在说谎。修夹具时要问一句：
**这个夹具的形状，和运行时真实对象的形状，差在哪？** 差的那部分如果正好是新判定的依据，
那测试就是在测夹具而不是测产品。

还有一个值得记住的坑：`slots.inject` 只在 `declarationEpoch` **变化**时重建。所以一次注册
失败（撞 priority 抛错）之后，即使肇事插件被卸载、格子空了，**它也不会自动重试**——用户
看到的「禁用两个插件后选择器彻底没了」就是这场碰撞留下的永久残骸，只能靠刷新恢复。凡是
「注册可能抛错」的注入点，都要意识到**失败不是可重试的**，最好在成功路径上就避免撞格。


## LES-037 — 2026-11-18 — 把自己的渲染结果换成第三方的，就要回头数一遍「哪些规则假设它是我的」

DEC-046 把原生 label 槽搬到模型行上，机制一次就对了。随后的一次 UI/UX 复核却找出五处细节
缺陷，几乎都源于同一个盲点：**行的内容从「我画的」变成了「别人画的」，而插件里一堆规则还
写在「我画的」这个前提上。**

具体地，一条条都是同一个问句的答案：

- 自绘角标有一条「选中行反白」的覆盖规则 → 现在画角标的是别人，规则失效；
- 「不划 badge」的删除线规则 → badge 现在在被划的轨道**内部**，规则的前提没了；
- 「抑制自绘 badge，因为占用者会画」→ 占用者崩了就不成立，于是崩溃时连 badge 一起丢；
- 「行名来自行内容」→ 内容成了第三方组件，它渲染 `null` 时行就没有名字了；
- 崩溃测试「行还在就算通过」→ 测试渲染器根本不调用子组件，把边界删掉测试照样绿。

**教训**：替换一块渲染来源（换成第三方组件、换成宿主渲染、换成异步内容）之后，别只验证
「新内容能显示」，要**把所有引用这块内容的既有规则重新问一遍**：它们的假设还成立吗？尤其是
那类「因为 X 会做，所以我不用做」的省略——X 一旦可能缺席或失败，省略就变成了缺陷。还有
一类更隐蔽：测试**没有真的走到**它声称验证的那条路径（不调用子组件的渲染器、不触发 effect
的桩），这种测试给出的是虚假的安心。


## LES-036 — 2026-11-17 — 测试夹具要用「消费者拿到的形状」，不是「存储里的形状」

给 creditNotes（设置页「无额度」标注的推导函数）写单测时，我照着持久层的样子造夹具：
`Map<route, {marked:true, at:时间戳}>`。函数读的是 `getSnapshot().marks`——**live map**，
值恒为 `true`。结果断言全部失败，而函数本身完全正确。

同一个「余额标记」在一个插件里有**三种形状**：存储记录（带时间戳，store 私有）、live map
（`true`，快照暴露）、渲染层集合（creditNotes 的输出）。夹具造错形状时失败模式很安静：
不抛异常、只是空集合，deepEqual 报「[] !== [p/a]」，乍看像逻辑错了。

**教训**：为 store 包装器的输出写测试前，先写一行断言确认夹具形状。渲染测试里我把记录形状的
夹具塞进 `readStored`、live 形状喂给 `creditNotes`，两条路径要分开造。

另外两条同批踩到的：渲染树里的文本是**子节点数组**不是字符串，断言文案要用 `textOf(node)`；
以及分支上的提交在 main 前进后不要硬 rebase——把 main 当基准重放功能改动，比解决十来个
交织的冲突块更安全，也不会把别人新加的测试（rename、telemetry）弄丢。

## LES-035 — 2026-11-17 — 给 Provider 改名，改的是标签，不是身份

需求看起来是「在设置里改个名字，让 picker 也显示」。把它当一次字符串替换会在三处翻车：

1. **显示名有多个出口**：*By provider* 标题、*By family* 行主文本、行 tooltip、Provider 搜索、失败条。漏掉任何一个，同一个 Provider 就会在同一屏上出现两种拼写。
2. **模型名往往带着目录原名。** 家族行尾标要剥离目录原名，否则 `豆包 2.1 Turbo` 会把 Provider 重复一遍。但也**不能顺手剥离别名**：别名是用户标签，`Pro` 可能正是模型名的一部分，把 `Claude 3.5 Pro Sonnet` 剥成 `3.5 Sonnet` 就改坏了模型名。
3. **用名字做 key**。改名会顺手改掉「这是哪个 Provider」，路由、可见性记录、当前选择都会跟着晃。
4. **失焦提交 + 行内按钮 = 触屏上的「取消变成保存」**。`pointerdown` 先把焦点从输入框移走，`blur` 抢先提交，随后按钮自己的 click 再去取消一个已经关掉的编辑器。按钮用一次性 `suppressBlur` 标记，其余区域 `preventDefault` 保住焦点；`Escape` 挂容器（按钮上也要能用），`Enter` 只挂输入框（在「取消」上按 Enter 必须取消）。
5. **`maxLength` 按 UTF-16 计数**，emoji 名字会被切半；改按码点裁剪时还要回写 DOM 值——state 没变时 React 直接跳过渲染，屏幕上就会留着比实际保存更长的名字。
6. **临时插入的 live region 不会被播报**。`role="status"` 必须和编辑器同时存在、空时裁剪隐藏（不能 `display:none`），否则警告在出现的那一帧才进入无障碍树。

正确的切法：别名按 provider id 存；显示名只从 `providerLabel` 一处推导；搜索同时保留原名与别名；尾标只剥离目录原名，不剥用户别名。另一个容易误判的点：宿主 catalog 的 `provider.name` 不是选择器能写的字段，宿主 Settings 的 `displayName` 也不会流到 catalog——所以这个需求只能做成本地显示层，不要为了「顺便同步原生模式」去改宿主数据。

**教训**：给一个实体改名之前，先分清「身份」和「标签」；然后找出标签的所有出口，只留一个推导函数。
## LES-034 — 2026-11-18 — 复用宿主自己的渲染路径之前，先确认它到底渲染了几处

给模型行补上倍数/忙碌/促销角标时，我一度准备自己画一套「紧凑版」装饰——直到重读出厂
picker 的 `ModelSelect` 才发现：**它的每一行都是经 label cell 胜者渲染的**（`placement:
'option'`），目录 badge 只是它无人应答时的回退。也就是说槽系统本来就把「行」当成一等
placement，而我在 DEC-028 只把这套机制接到了**触发器**上，行这一半一直在手绘名字加
badge，白白丢掉连接插件的信息。

**教训**：要在自己插件里复现宿主的某块 UI 时，先数清宿主自己**在几个地方**渲染它、各用
什么 props（`placement`、`selected`…）。宿主渲染 N 处，通常意味着这 N 处共享同一条
render view 与同一份「每次面板一份」的依赖（`entry.inject(sessionId)`、locale seat）——
照抄一处而漏掉其余，就会做出一个看起来对、实际缺一半的实现。判断「这个槽该不该出现在
某处」的最快方法，是看宿主自己是否在那里也用了它。

## LES-033 — 2026-11-17 — 只改 CSS 的提交，在已经打开的窗口里可能「看起来没生效」

把模型开关改成另一种颜色后，用户说「it's still the same」。代码、测试、合并都没问题；
真正的原因是本插件注入样式表时**只在文档里没有对应 `<style>` 时才写入**：

```js
if (document.querySelector('style[data-plugin-css=...]') === null) { ...append... }
```

HMR 重新执行模块时，文档里的旧 `<style>` 还在，于是条件不成立，**新 CSS 被整段跳过**；
JS 的行为改动会生效，纯样式改动却一直停留在上一版，直到整页刷新。升级成一个「找不到就建、
找得到就覆盖 `textContent`」的幂等写入即可。

**教训**：给插件注入的全局样式做「已存在就跳过」的优化时，先问一句「HMR 会重新执行这个
模块，但不会重建 document；旧样式谁来更新？」。同理，验证纯样式改动时，别只看 HMR——
先整页刷新一次，再判断是代码问题还是热更新问题。

## LES-032 — 2026-11-17 — 父级开关做成「覆盖」，就等于拿走了子项自己的发言权

给模型列表加 provider 开关时，我把 provider 键当成**覆盖**：命中就直接判定整个 provider
不可见，并把子开关 `disabled`。逻辑自洽，看起来也「安全」——但它把用户最想要的流程堵死了：
**关掉有几十个模型的 provider，再只开想要的两三个**。子项一旦不能发言，用户就只能整组重开。

用户的原话是「makes models gray-out if disable a provider」，一针见血：变灰不是视觉问题，
是**权限问题**。

**正确的模型是「批量动作」而不是「父级状态」**：批量关 = 把该组每个子项自己的键都写上，
批量开 = 清空它们。这样父子写的是**同一批键**，天然可组合，记录里也不会出现「谁优先」的
特例。父开关自己不需要任何状态，它是子项状态的一个视图（全开/混合/全关）+ 一个批量按钮。

顺带两个必须一起做的收尾，否则改了等于没改：

- **父开关的批量写必须顺手删掉旧的裸父键**。只要它还在，覆盖逻辑就继续压着整组，
  「开几个」看起来毫无反应——排查时极难看出是「旧键还在」而不是「新代码没生效」。
- **旧记录要迁移**。语义从覆盖改成批量之后，UI 再也产生不出裸父键，但历史记录里有；
  它会让子开关显示为开、却关不掉。迁移要幂等，并且**对目录里查不到的键保持原样**——
  猜一个已经消失的 provider 覆盖了哪些模型，比留着这个惰性键更糟。

**教训**：做「全选/父级」类控件时，先问一句「它应该**写**子项，还是**压住**子项」。
压住实现起来更短，但会把「部分选择」这种最常见的意图变成不可达状态。


## LES-031 — 2026-11-17 — Host 侧签名写的返回类型，往往不是客户端拿到的形状

给设置页读全局模型目录时，Host 那侧的声明是
`@Remote('modelCatalog') modelCatalog(): Promise<ModelCatalog>`，于是我照着写
`const catalog = await session.modelCatalog(); catalog.groups`。**这是错的**：客户端拿到
的是信封 `RemoteResult<ModelCatalog>`，即 `{ok:true,value}` / `{ok:false,error}`，
真正的目录在 `.value` 里。

`.groups` 会安静地读到 `undefined`，`Array.isArray` 一判断就变成空目录 —— 页面不报错，
只是永远说「目录还没加载」。这种 bug 没有异常、没有日志，只有一句看起来合理的空状态，
最难查。

**规矩**：`@Remote` 标注的类型是 **Host 业务签名**，客户端一侧一律是
`Promise<RemoteResult<T>>`。找证据要看网关构造信封的那段代码（`dsh-api-gateway` 的
client dispatch 里 `return { ok: true, value }`），而不是看 Host 的方法签名。同仓里
所有正确的调用点（`catalog.ts`、`settings-models/store.ts`、`subagent-model-selection-
card-controller.ts`）都先判 `response.ok`，那就是信号。

顺带一条同类经验：**「有没有可用的服务」和「调用有没有成功」是两件事**，都要降级。
`ctx.get(name)` 在服务没挂载时返回 `undefined`（不抛），而调用本身还可能 reject
（装配期错误）。两个分支都得吞掉，否则设置页会因为一个可选命名空间整页挂掉。


## LES-030 — 2026-11-15 — 按钮之间压不下去的间距，通常不在按钮上，在容器的 gap 上

给「网页链接」按钮设了 `margin-right: 2px`，用户还是说间距太大。量一下才发现是 32px：
页脚是 flex 行且 `column-gap: 30px`，而**那 30px 作用在每对相邻 flex 子项之间**——
两个按钮当时是页脚的两个独立子项，于是容器 gap 正好落在它们中间，按钮上的 margin
只是零头。**在按钮上怎么调都压不下去，因为要压的是容器的 gap。**

而这 30px 又不能动：它负责分隔页脚的三个成员（推理等级组、团队协作行、尾部按钮组），
改小会把整个页脚的分组间距一起毁掉。

**解法是改结构，不是改数值**：把两个按钮收进一个容器，让它们成为页脚的**一个**子项。
容器的 gap 只作用于外侧，内部间距由容器自己的 `gap` 决定 —— 32px 直接变成 2px，
页脚的分组间距一个像素没动。

顺带一个模式：`margin-left: auto` 属于「**这一组**靠右」，不属于某个按钮。它留在按钮上
会分裂自由空间、把同组按钮重新拉开——旧写法因此需要一条 `A + B { margin-left: 0 }`
去补。分组之后那条补丁规则**应该直接删掉**，因为它补的问题已经不存在了；
留着它反而会让人以为那个坑还在。

**教训**：调 flex 子项之间的间距时，先问「这俩是同一个容器的子项，还是不同容器里的」。
同一个容器 → 改容器的 gap 或给它们包一层；不同容器 → 才轮到 margin。

## LES-027 — 2026-11-15 — 浏览器半边读不到 checkout，别去翻客户端的 API

给面板加「打开项目网页」按钮时，第一反应是在客户端找一个「当前仓库 remote」的
访问器。**没有，而且不该有**：客户端插件没有 fs、没有 subprocess，全库检索
`@deepseek-ai/*` 后确认宿主也不提供这样的服务或路由——`workspace.follow()` 只给
工作区**目录路径**，`repository.url` 只在 plugin-market 里描述**插件包自己**。

于是「怎么把宿主的数据弄到浏览器」变成真问题。三条路里只有一条对用户安装的 bundle
成立：

- **Typert Remote namespace** —— 客户端装配 `@deepseek-ai/dsh-api-remotes` 是一张
  **构建期白名单**，加 namespace 要改 DSH 自身源码并重新生成 `./remote` 产物。
  用户装的 bundle 扩不了这张表，写了也不生效。
- **boot global（`window.__DSH_BOOT__`）** —— 页面加载时的静态值，随 checkout 变化
  的地址用不上。
- **`ctx.webServer.register` 自建路由 + 浏览器 `fetch`** —— 唯一可行，而且本机
  profile 里已有先例（`dsh-file-finder`）。配套的两件事必须一起抄：
  `connection.requestRejection(req)` 过宿主信任栅栏，以及**该函数抛错时 fail closed**。

**教训**：判断一个能力「客户端能不能做」时，先问它需要的是**浏览器里的状态**还是
**机器上的事实**。后者一律得走宿主半边，而宿主半边的通道在用户安装的 bundle 里
只有 HTTP 路由这一条。

## LES-028 — 2026-11-15 — 「不硬编码」和「要有兜底」可以同时成立，只要兜底是最后一步

需求同时说了「不要硬编码项目地址」和「没有 remote 时就用这个地址」。这两句不矛盾，
但**实现顺序决定了它是不是真的没硬编码**：

先写 `FALLBACK_PROJECT_URL` 常量，再让解析流程**遍历完所有 remote 才**返回它——
这时常量只是最后一步。反过来先写常量再「顺手」加个 remote 读取，常量就成了答案。

守住这条线的三个具体动作：

1. **兜底常量只声明一次**（宿主半边 `repo-url.js` 顶部），浏览器半边因为不能
   import 宿主模块而重复一份，就**用测试钉住两份相等**，并另用测试钉住它与
   `package.json` 的 `repository.url` / `homepage` 一致。重复不可怕，没人钉才可怕。
2. **非目标宿主的 remote 要拒绝，不要改写**。把 GitLab 地址改写成 github.com 会
   打开**另一个仓库**，界面上没有任何提示说目的地变了——这比打开兜底页更糟。
3. **返回值带上来源**（`source: 'remote' | 'fallback'`），让 UI 能如实说自己是
   从 remote 来的还是兜底的。一个说不清自己地址哪来的按钮，等于在骗用户。

## LES-029 — 2026-11-15 — 点击后才 `await` 再 `window.open`，等于把按钮交给弹窗拦截器

「网页链接」按钮第一版想的是：点击 → `fetch` 拿地址 → `window.open`。这是错的。
`await` 之后调用 `window.open` 已经脱离了用户手势，浏览器有权把它当弹窗拦掉，
表现是「有时能开、有时没反应」——最难查的那类 bug。

正确的做法是**把网络从点击路径上挪走**：面板打开时就预取地址，点击时拿着现成结果
**同步** `window.open`。只有抢在预取完成前的点击才走异步路径。

另外两件一起做掉：`window.open(url, '_blank', 'noopener,noreferrer')` 切断 opener
（否则新页面能拿到 `window.opener` 反向操作本页），以及**只放行 `http(s)`**——
宿主返回的字符串是**数据**不是指令，`javascript:` / `file:` / `data:` 一律丢弃。
真的被拦截时在 tooltip 里说明，不要装作打开了。


## LES-026 — 2026-11-14 — 「实测通过」要连着测几次，尾延迟会替你判失败

加心跳时，`POST https://dsh.zuos.us/api/e` 单次实测成功、返回 202，于是把请求预算定成
5 秒——比浏览器常见的 3 秒宽，比「用户能忍」还窄一点，看上去很稳。**它其实掐掉了大约
一半的成功上报**。

同一条链路连测 6 次：4.6 s / 6.9 s / 6.8 s 失败 / 10.0 s 失败 / 6.9 s / 6.91 s。
也就是说这条链路的**中位数就在 7 秒附近**，5 秒预算落在分布的左侧而不是右侧。单次成功
完全不能证明预算够——只要那次恰好是分布里最快的一档，你会得出完全相反的结论。

三条可复用的判断：

1. **只测一次得到的是「存在性」，不是「预算」。** 要定超时，至少连测 5–10 次看分布，
   取「明显高于中位数、又不至于让用户干等」的那一档。本次最终取 10 秒。
2. **在这个功能里，超时失败与「用户没在用」在数据库中无法区分。** 心跳没有送达就是
   没有这一行——和离线、和没开机一模一样。所以一个偏小的预算不会「更快」，它只会
   **把成功伪装成缺席**，而且伪装得和真实缺席完全一样，事后无法回溯。
3. **`AbortController` 的预算是整条交换，不是 TTFB。** headers 到达之后才 resolve，
   所以「先拿到 headers 就安全了」不成立，也没法靠别处补一个更小的数字。

顺带一条环境教训：这次第一次跑 `apply()` 冒烟测试时，状态目录建在 `~/.dsh/` 下被沙箱
以 `EPERM` 拦了——这是**沙箱在正常工作**，不是代码 bug。对策是用 `DSH_HOME=$PWD/.tmp-home`
把数据目录指到可写位置再验，而不是去提权或改默认路径。


## LES-025 — 2026-11-14 — 「不能声明子槽」不等于「不能用那个子槽」

这次需求是「trigger 显示得和原生一样丰富」。第一反应是去查这个槽能不能用，答案是不能：
`conversation.input.model.label` 已被出厂条目声明，我们再声明一次就抛 `already declared`
（cbca481 因此被 revert）。于是很容易在这里停住，退而求其次去补 `model.badge`——而那正好
拿不到用户真正问的那个东西（小人图标）。

**真正的问题问错了。** 「我能不能声明它」和「我能不能渲染它」是两个问题。声明只决定
**谁能调用 `renderSlot`**；它不决定**谁能读到胜出条目**。而 `entriesOfSlot` 是公开访问器，
声明活着的槽它就一直答得出胜出者——包括胜出者的 `component`。出厂条目被我们遮蔽但从未被
dispose，所以它的声明和所有贡献都还在。**遮蔽一个座位，不等于拆掉它声明的子槽。**

三条可复用的判断：

1. **先分清「声明权」和「读取权」。** 前者是排他的、会抛错的；后者是只读访问器给的。需求
   撞上「不能声明」时，先问「我需不需要声明，还是只需要读」。
2. **要渲染别人的组件，就得自己把它的座位配齐。** 渲染器合成的是 `t`（由 `entry.locale`
   经 `locale.bind(ns)`）、`inject(sessionId)` 的业务面、以及 owner props。少一样组件就
   静默画错或崩掉，而这些都不在「拿到 component」这一步里。
3. **别人组件的失败必须只损失装饰。** 渲染器给每个条目配了错误边界，我们自己渲染时没有
   这个保护。这里用独立的 `LabelBoundary`（fallback `undefined` → 退回 catalog 名字），
   **不要复用 `SeatBoundary`**：那个会把整行字画成错误信息，等于用一个小故障换掉整个控件。

还有一条验证方法值得记：这类「宿主契约」问题不要靠读源码推断就动手。用真实的 `SlotCore`
（从安装里取，不重写）跑一遍最小注册序列——遮蔽条目 + 出厂条目 + 连接器贡献——直接打印
`entriesOfSlot` 的结果，比读十遍 `registry.ts` 更确定。这次就是这么确认「我们的遮蔽不影响
label 槽，连让位后都还在」的。


## LES-024 — 2026-11-14 — 插槽给的锚点是 display:contents，意味着外观完全归你

`conversation.input.model.options` 这类 list 子插槽，渲染时会在内容外面套一个
`[data-slot]` 锚点，样式是 `display: contents`——它不生成盒子、不参与布局，也不带任何
宿主外观。结论有两面：

- **限制比想象的少**：想让条目长成什么样都行，不必也不应该去模仿相邻行的 class
  （那些 class 是 CSS Modules 的 hash，本来就抄不到）。想在视觉上从兄弟行里跳出来，直接画。
- **对齐要自己算**：既然没有盒子替你承担内缩，就得读宿主容器的 padding 与行内缩（这里是
  菜单 pad 4px、行内再 inset 8px），否则按钮会比上面的行窄几个像素——`padding: 0` +
  宿主已有的容器内缩才是对齐的做法。

另一个反复踩到的坑：**样式表是模板字符串**。在 CSS 注释里写反引号（比如给槽名加
markdown 反引号）会直接截断模板字符串，报的是 `SyntaxError: Unexpected identifier`，
指向的却是注释里那个词，很容易误判成代码问题。写注释时绕开反引号，或者干脆不加。

## LES-023 — 2026-11-14 — 「我的控件该住在哪」先看宿主插槽的声明者是谁

DEC-027 把返程控件放进了 `conversation.input.right`，理由是「它在原生模式下仍然活着」。
这条理由是对的，但只是**必要条件**：那个槽活下来的代价，是控件落在了原生 trigger 左边、
落在输入框工具栏里——它控制的是模型面板，却住在一个与模型面板无关的容器里。

真正决定住所的是**声明者**：`conversation.input.model.options` 由出厂 `ModelSelect` 自己
声明并渲染在自己的根菜单底部，所以注册进去的条目既（a）与出厂面板同生共死，又（b）在视觉与
语义上都属于那个面板。选槽时按「谁声明、渲染在哪」筛，比按「什么条件下它还活着」筛更早收敛。

配套两条细节：

- `list` 槽的 id 冲突键是 `(id, priority)`，注册一个新 `id` 不会挤掉既有占用者
  （`agent-team`）。但 `single` 会：同一 priority 下第二条注册直接抛错。
- 跳模式会 dispose 掉拥有当前菜单的条目，所以在这种「住在别人菜单里」的控件中，**先关菜单
  再切换**；否则焦点落在被卸载的节点上。

## LES-022 — 2026-11-14 — 遮蔽型槽条目的「另一种渲染方式」是 dispose 自己

需求是「显示宿主原生的控件」，最自然的思路是把它渲染出来：import 它的组件，或者从
`slots.entries()` 里把那条 `StoredEntry.component` 拿出来用。两条路都走不通，而且**不是
实现细节的问题，是所有权的问题**：出厂组件的 `renderSlot` 是绑定在**所属条目**上的闭包
（`boundRenderSlot(host, entry)`），别人调用直接抛 `StaleAuthorizationError` /
`SlotOwnershipError`；包也不导出组件。也就是「软链接」在数据结构上存在，但没有可用的调用面。

真正成立的做法是反过来的：**不渲染它，而是不再遮蔽它**。`single` 槽保留全部注册、只渲染最高
优先级的活条目，所以本插件 `dispose()` 掉自己的注册，槽就自己选出下面那条出厂条目。这比
「渲染别人的组件」强的地方不只是省事：它把「用哪个控件」的决定权完全交给宿主，于是宿主升级
换掉组件，这里自动跟着换——**结构上不可能过期**。凡是「嵌入宿主自己的控件」这类需求，先问
「我能不能让位」而不是「我能不能拿到它的实例」。

顺带记两条约束，它们是这个方案能成立的边界：

1. **让位必须可验证。** 「下面有别人」要能查出来（`entries()` 过滤掉自己），查不出来就别让位
   ——否则 composer 会变成一个空位。旧宿主没有这个方法时，「无法确认」必须等同于「拒绝」。
2. **控件不能住在它控制的座位里。** 原生模式 dispose 掉承载按钮的那条条目，按钮自己就没了。
   所以「回来的路」必须挂在另一个存活更久的槽上（这里是 `conversation.input.right` 的 list 槽），
   并且在没有话要说时渲染 `null` 而不是一个空壳元素。任何「用 A 切换 A 自身存在性」的控件，
   都要先问「切换之后谁还活着」。

还有一个容易漏的状态一致性问题：**存储值不等于生效值**。这里存了 `native` 却在无法让位时仍
显示面板，于是按钮的按下态如果读存储值，就会出现「面板在、按钮却声称自己在原生模式」。UI
上的状态标记必须报告**屏幕上真的发生了什么**，存储只是其中一个输入。
## LES-021 — 2026-11-14 — 用「自带副作用的桩」复现，等于自己造了一个 bug

这次排障最有价值的一条不是修好了什么，而是**差点用错误的证据修错东西**。

为了在 Node 里复现 `Maximum update depth exceeded`，我给 jsdom 的
`HTMLElement.prototype.offsetHeight` 和 `getBoundingClientRect` 写了一个
**每次读取都返回微变值**的 getter，于是插件「稳定复现」了 #185，看起来根因
已经找到。但这个 getter 本身有副作用：真实浏览器的布局读取是纯的，同一个布局
下读多少次都是同一个数。**是桩在制造变化，不是代码在制造变化。**

- **教训**：桩/替身要复制的是「被测对象观察到的环境」，不是「让它失败」。
  凡是读多次会返回不同值的 getter，都要先问一句「真实环境会不会这样」。
  这次真实环境的答案是「会，但只在布局真的变了时」——于是修复的关键也随之
  改变了方向：不是给循环加计数上限，而是让测量**只在真实输入变化时才启动**，
  并给亚像素噪声一条 2px 的容忍带。
- **如何验证一个「已复现」的失败是真的**：把桩换成诚实版本（同一布局恒定
  返回值），确认 bug 消失；再用「一次性变化后稳定」的桩，确认它仍然能触发。
  两者都要被试过，才知道自己钉的是代码的缺陷而不是桩的缺陷。
- **#185 的呈现方式会骗人**：`SeatBoundary` 把渲染错误画成 trigger 上的一行
  小字（`请选择模型: ...`），所以用户看到的是「模型选择器显示错误」，而真正
  崩掉的是整个座位在重渲染里打转。UI 上的错误文案是**症状的位置**，不是
  **原因的位置**——先确认异常类型（这里是渲染循环），再去代码里找闭环。

## LES-020 — 2026-11-14 — 「不会改变结果」是对某个推导成立，不是对整条链路成立

`applyWindow` 里那句注释——「`prepend` 翻进来的只是更早的历史，改变不了尾部推导出的标记」
——单看它自己毫无破绽：标记确实是由窗口尾部的事件推出来的。错的是把它当成了「这个分支可以
整段跳过」。**推导方向**决定哪一端的历史有意义：从尾部往前推的状态，确实可以丢掉更早的页；
但从历史事件里累积的状态（这条划线来自某个 `turn/end`），更早的页恰恰是唯一的事实来源。
所以「这个事件类型能不能改变状态」不能凭手感回答，要回到「状态由哪些事件算出」再回答。

这次教训里更值钱的一条是**取证方式**。判定逻辑（正则、code 表、429 读正文）写得很扎实，
函数级单测全绿，把真实失败事件直接喂进去也全对——于是第一反应必然是「判定又错了」。真正
定位靠的是去读宿主自己的持久化存储：`Local Storage/leveldb` 里 `dshmf:insufficient` 的
JSON 记着每条 route 最后一次被折叠的**时间**。把那个时间和会话日志里的 `turn/end` 一对，
立刻看出「最后折叠的是 03:39 的一次 completed，而 04:20 的 402 根本没进来」。结论从
「判定错了吗」直接跳到「这两条事件为什么没被看到」——省掉了一整轮对着正则打转。
教训：状态是「由某条通路观察到的」，那就去查**观察者的账本**（存储里的时间水位、监听器数量），
而不是反复验证被观察对象的判定逻辑。

第二个坑是**用 id 当身份**。`stops.has(sessionId)` 看起来是幂等保护，实际上把一个会变的
东西当成了不变的东西：同一个 sessionId 在 scope 回收再物化之后，背后是全新的对象和全新的
`eventSource`。凡是要长期持有某个「活对象」的引用（订阅、句柄、缓存），键必须是那个对象
本身或它的稳定标识，并在每次使用时校验身份；否则你保住的只是那个名字。

修这两处时顺手确认了一件事：`settle-assistant` 可以安全跳过，因为它只把 live attempt 换成
durable 的 Assistant 消息。**「跳过」的理由要写成「它不可能携带哪些事件」，而不是「它不可能
改变标记」**——前者可以在宿主代码里核对，后者只能靠猜。


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
