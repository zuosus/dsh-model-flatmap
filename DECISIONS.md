# DECISIONS

Project-level decision log for the dsh-model-flatmap plugin. Append-only: new
entries go below the marker, newest first; old entries are never rewritten.

<!-- APPEND-ONLY LOG: 新条目插入到此行之后 -->
## DEC-060 — 2026-11-20 — 可见性开关与 Provider 重命名以 `$DSH_HOME/dsh-model-flatmap/config.yaml` 为唯一事实来源

**Context.** 可见性（hidden，哪些 Provider/模型被关掉）与别名（aliases，用户重命名的 Provider 名）此前只存浏览器 `localStorage`。用户要求把它们改到 Host 侧的一个配置文件，并明确纠正：`localStorage` 不参与，只能有一个 source of truth。

**Decision.** `$DSH_HOME/dsh-model-flatmap/config.yaml` 是这两个记录的唯一事实来源，`localStorage` 完全不参与——没有缓存、没有镜像、没有回退。客户端通过 Host 的 `dsh-model-flatmap/config` 路由读写：GET 读文件、POST 整体替换（不是 merge，两个 section 同时发送，避免「缺省 = 未变还是空」歧义）。`createHiddenStore`/`createAliasStore` 不再接受 `readStored`/`writeStored`：store 从内置默认开始（全部可见、目录原名），`persist()` 只 POST 到 config 路由，`adopt(record)` 只替换内存并通知订阅者、不再写 storage。删除 `readHidden`/`writeHidden`/`readAliases`/`writeAliases`/`HIDDEN_KEY`/`ALIAS_KEY` 及它们在 `__test` 的导出。`loadConfigFromHost` 不刷新任何缓存，只返回文件记录。

**Rationale.** 一个 source of truth 让手改文件立即生效、跨端一致，也没有「缓存与文件哪个算数」的二义性。代价是首帧显示默认、文件读取失败时停在默认（没有 last-known-good 可保留），这是「无缓存」的固有结果，如实告知用户。

**Consequences.** 首帧可能短暂显示默认再被文件覆盖；config.yaml 损坏或 Host 不可达时面板停在默认，损坏时 console 警告；无 last-known-good 保留。测试 285 条全绿：config-client 断言 `HIDDEN_KEY/readHidden/writeHidden/ALIAS_KEY/readAliases/writeAliases === undefined`、GET 不触碰 `localStorage`、store 从默认开始、`adopt` 无 storage 写、POST 发送完整记录。README / README.zh / docs/DETAIL.md 同步改写，删除 `dshmf:hidden`/`dshmf:aliases` 提及。

## DEC-059 — 2026-11-20 — 插件数据目录迁到 `$DSH_HOME/plugins/dsh-model-flatmap/`，并加一次性迁移

**Context.** DSH 各插件此前把配置/数据目录直接放在 `$DSH_HOME/<plugin-name>/`（本插件即 `~/.dsh/dsh-model-flatmap/`）。宿主侧已确立 `$DSH_HOME/plugins/<plugin-name>/` 作为插件数据目录的惯例（本机已有 `~/.dsh/plugins/dsh-generative-ui/` 与 `~/.dsh/plugins/dsh-model-fusion/`），要求统一。本插件的数据目录里放着 `analytics.json`（安装 id、lastAttemptDay 等）与 `telemetry-settings.json`（用户的统计开关），直接改路径会让老用户的安装身份与开关选择凭空消失。

**Decision.** 三件事一起做：（1）`resolveDataDir()` 改为 `join(resolveDshHome(options), 'plugins', DATA_DIR_NAME)`，新增常量 `PLUGINS_DIR_NAME`；`resolveDshHome()` 的语义（`$DSH_HOME` 优先、空白视为未设置、`~` 展开、`resolve` 绝对化）一字不动。（2）新增 `resolveLegacyDataDir()` 专门指向旧地址，`migrateLegacyDataDir()` 负责一次性整目录搬迁：旧地址不存在 → 静默返回 `false`；新地址已存在 → 绝不覆盖、绝不合并，返回 `false`；否则 `rename` 优先，`EXDEV` 回退为递归 `cp` + `rm`。（3）新增 `resolvePluginDataDir()`：新地址存在就用新地址，否则若旧地址存在就退回旧地址，两者都无则返回新地址（由写入方创建）。`index.js` 的心跳与 telemetry-settings 路由在**任何读写之前**先 `await migrateLegacyDataDir()`，并改用 `resolvePluginDataDir()`。

**Rationale.** 迁移失败必须降级、不能抛：统计与设置是插件的附带功能，一个只读的家目录不该让整个面板起不来，所以 `migrateLegacyDataDir()` 吞掉全部异常并返回布尔值，调用方靠 `resolvePluginDataDir()` 自动退回旧目录继续读。新地址已存在时既不覆盖也不合并，是因为两个 `analytics.json` 合并会得到互相矛盾的安装 id 与 `lastAttemptDay`（可能同一天重复上报），覆盖则会丢掉更新的一份；让新地址胜出、旧目录原样留着，是唯一不损坏数据的处理。`cp` 用 `errorOnExist: true, force: false`；拷贝失败时，若失败原因是目标已被别人抢先创建（`ERR_FS_CP_EEXIST`）就原样保留、直接退回旧目录，否则先 `rm` 掉自己的半成品目录再抛——半拷贝的目录会让 `resolvePluginDataDir()` 误判"新地址已就绪"，从而读到缺文件的目录，而删掉别人的目录则是更严重的越权。

**Rejected.**（1）只改路径不迁移：老用户的安装 id 会重置，DAU 凭空多出一次 install，用户关掉的统计开关也会重新打开——这是把一次重构变成一次数据事故。（2）迁移失败就抛错或让插件失效：违反本模块"统计永远不是插件故障"的既有承诺（DEC-031）。（3）新旧目录都读、取并集：状态文件不是可合并的数据结构，`lastAttemptDay` 取并集等于选一个随机值。（4）每次启动都尝试迁移：幂等靠"旧地址不存在"这一个条件就够了，多余的判断只会引入竞态。

**Consequences.** `test/telemetry.test.mjs` 的 "the data directory follows the hosts own home rules" 按新路径更新，并新增 7 条迁移测试（正常搬迁、幂等、新目录已存在不覆盖、迁移失败降级、`EXDEV` 走拷贝、拷贝途中目标被他人抢占时不误删、宿主先迁移后读）；测试数从 299 增至 306。`README.md` / `README.zh.md` / `docs/DETAIL.md` 里的 `~/.dsh/dsh-model-flatmap/analytics.json` 路径同步改写并补上迁移说明。迁移只在 `index.js` 的两条宿主路径上执行；`telemetry.js` 本身不认识"迁移"这件事，仍可只靠注入的 `dir` 独立测试。

## DEC-058 — 2026-11-20 — 面板链接改为宣传 dsh.zuos.us 插件市场，移除 git remote 推导与宿主路由

**Context.** 用户要求把项目里那条「link」改成宣传 dsh.zuos.us 插件市场的链接。查证 dsh.zuos.us 首页确认它确为面向 DSH 的插件市场，且列出了本插件的条目。原有的链接按钮（DEC-030 一类）点击时读取本地 checkout 的 GitHub remote、经宿主自建路由返回页面地址，remote 不可用时回退到本项目 GitHub 主页。

**Decision.** 把面板右下角的链接图标改成固定打开 `https://dsh.zuos.us/`（市场首页，而非某个插件详情页，以「宣传市场」为准）。因为目标是固定公开站点、不再由 checkout 决定，删除整套 git remote 推导：`repo-url.js` 瘦身为只导出 `MARKETPLACE_URL` 一个常量；`index.js` 删除 `PROJECT_LINK_PATH`、`projectLinkPayload`、`registerProjectLink` 及其调用（宿主只剩 telemetry 与其设置路由两条职责）；`client.js` 删除 `fetchProjectLink`、预取 effect、`projectLink` state 与 `/project-link` 路由常量，点击直接同步 `window.open(MARKETPLACE_URL, '_blank', 'noopener,noreferrer')`。中英文案改为「插件市场 / Plugin marketplace」，删去 `link.openFrom`、`link.fallback` 两条已无用的文案。

**Rationale.** 市场是稳定的公共地址，不是 checkout 的属性；沿用 remote 推导只会让「宣传市场」的按钮随 fork / rename 指向别处，是错误抽象。去掉宿主路由与预取后，点击再无 await 间隙，弹窗拦截不再有机会，代码面也更小。

**Rejected.**（1）保留 commit 路由、只把 fallback 改成市场地址：那样有 GitHub remote 的机器仍会打开仓库页，与宣传市场的意图相悖。（2）指向本插件详情页 `/dsh-model-flatmap/`：用户说的是宣传「插件市场」整体，首页更符合。（3）保留预取：地址已经是常量，预取只会增加无意义的复杂度。

**Consequences.** 测试从 322 调整为 299：`test/repo-url.test.mjs` 重写为 4 项校验常量与两半一致、无残留项目链接路由；render 测试的链接块改为校验固定地址、同步打开、放置与文案。README / README.zh / docs/DETAIL.md 的「项目链接」小节同步改写。此条目取代 DEC-030 一类关于「从 remote 推导项目页」的决定在该按钮上的适用性，旧条目按 append-only 规则原样保留。

## DEC-057 — 2026-11-18 — 设置页新增「启用智能体团队协作」默认开关，与模型面板的会话开关彻底分离

**Context.** 用户要求在设置面板增加一项「启用智能体团队协作」设置，并明确：模型面板里的改动属于临时改动，不是默认改动，不影响这个设置。查证宿主 `@deepseek-ai/dsh-agent-team` 的 `TeamService.Config` 有 `defaultEnabled: boolean`（默认 `false`，新会话首次 llm step 前写入 `team/mode`），但那是 profile 文件里的普通配置字段，本客户端插件无法读写；它的 `remote.agentTeams.setEnabled(sessionId, enabled)` 只写当前 Session 的选择。

**Decision.** 在本插件设置页底部（匿名统计开关上方）新增「启用智能体团队协作」开关，作为新会话默认值的浏览器端偏好，存于 `localStorage` 键 `dshmf:teamDefault`（`{enabled:boolean}`，缺失／损坏一律 `false`，与宿主默认一致）。独立 store，仅设置页可写；模型面板的会话开关只调 `remote.agentTeams.setEnabled(sessionId, enabled)`，seat face 上没有任何默认写入口，因此两条路径互不影响。默认关闭：不改现有会话、不覆盖已保存的 `team/mode`。文案明确说明「控制新会话的默认状态，已有会话不受影响」。

**Rationale.** 用户把「默认」和「本次」分属两个 surface：默认属于偏好设置页，临时属于模型面板。把它们放进同一个 store 会让会话开关污染默认，违背需求。用浏览器 localStorage 而非宿主配置，是因为插件是纯客户端的，宿主没有面向客户端的默认写入通道；不引入 Host 镜像，因为没有宿主消费者。

**Rejected.**（1）让设置页开关直接调用 `remote.agentTeams.setEnabled`：那会改当前会话，恰好是用户要避免的。（2）从会话开关顺带写默认：混淆两种作用域，用户明确反对。（3）把默认值塞进 telemetry 那套 Host 镜像：增加了没有消费者的复杂度。

**Consequences.** 新增 `dshmf-setTeamDefault` 样式带与中英文案 `teamDefault.title/desc/toggle`；`__test` 导出 `TEAM_DEFAULT_KEY/readTeamDefault/writeTeamDefault/createTeamDefaultStore/TEAM_DEFAULT_OFF`；新增 5 条测试（读取默认与损坏值、store 持久化与通知、设置页开关位置与翻转、双语文案、模型面板开关不写默认）。测试先在原代码上跑红，再实现跑绿，全套 322 条通过。

## DEC-056 — 2026-11-18 — 团队协作服务未挂载时保留开关行，禁用并说明

**Context.** 用户之前的会话把 Agent Teams 强制装进桌面 profile 并写了 agent-team-force 补丁块，但当前进程没有重启：`remote.agentTeams` 与 `agentTeam` projection 都还没挂载。面板按「缺失即 `null`」把整行删除，用户看到的像是功能被删了，无从判断是服务未加载还是插件不支持。

**Decision.** 页脚的团队协作行永远渲染：服务与 projection 都在时开关可用；任一缺失时开关禁用，提示改读 `team.unavailable`（说明当前会话尚未加载、需重启或在新会话开启 Agent Teams）。点击在禁用态绝不调用 `setEnabled`。footerKey 固定为 team 状态，避免开关从禁用到可用时触发一次多余测量。

**Rationale.** 「静默消失」把配置问题和功能缺失混成一件事，且违反 DEC-049/DEC-054 的同类原则：不可用的控件要在用户能看见的地方说明。服务可能稍后挂载，禁用态让面板重开即可自愈，不需要专门的订阅通道。

**Consequences.** 新增中英文案 `team.unavailable`；更新三条渲染测试（服务缺失、projection 缺失、footer 始终含团队行）。


## DEC-054 — 2026-11-17 — 「默认样式」置灰时，在设置页说明原因

**Context.** 用户报告平铺面板右下角「原生 / 默认样式」按钮又变灰，问能不能在本插件设置页写一条情况说明。根因是 DEC-049 的安全检查：`canStepAside()` 要求继承者声明 `conversation.input.model.options`，而当前 profile 里 `dsh-acp-agents` 以 priority 0 抢占席位、没有这个子槽，于是按钮被明确置灰。此前设置页的冲突提示在 `contested`（我们仍持有席位）状态下被刻意隐藏，恰好覆盖了这个案例——用户只看到灰按钮，没有任何解释。

**Decision.**
1. `diagnoseSeat()` 增加 `nativeAvailable` 字段，用与 `canStepAside()` **完全相同的规则**计算（优先继承者必须声明回程子槽）。设置页与按钮共用同一个判据，而不是各算各的。
2. 设置页在「我们持有席位 + `nativeAvailable === false` + 有竞争者」时显示一条说明卡：标题「默认样式不可用」，正文解释交出去会落到别人的控件、没有回程入口，并点名占位插件；不提供修复按钮——这里确实没有可做的修复（DEC-050）。
3. 普通 `contested`（有竞争者但默认样式可用）仍然沉默，避免噪音；`broken` / `unknown` 沿用原文案。

**Rationale.** 灰按钮是「按钮就地无解、必须去别处解释」的典型：用户能去的、能解释的地方就是设置页。说明必须由真实判据驱动，否则会出现「按钮亮着却说不可用」或反之的假话。容量上：新增 4 个测试，241 条全绿；先在原始 client.js 上确认新断言会失败，再收修复。

**Consequences.** 新增 `conflict.nativeUnavailable` / `conflict.nativeUnavailable.title` 两条中英文案；`seatDiagnosis` 的快照比较加入 `nativeAvailable`，继承者变化时页面即时更新。

## DEC-055 — 2026-11-17 — 每次打开设置页都强制重读目录，补上「关闭期间被删除、且无事件」的分支

**Context.** 用户删除了 GitHub Copilot provider，但设置页仍列出它；并明确指出「设置面板的内容不是
每次打开去获取最新数据的」。

**Findings.** DSH 的 `SettingsRoot` 是 `{open && <SettingsPanel>}`，且面板内只渲染 `only: active`
的那一节 —— 关闭即卸载，重新打开即重新挂载 `SettingsSection`。挂载时的
`useEffect(() => catalogFace.load(), [catalogFace])` 调的是**不带参数**的 `load()`，而
`createCatalogStore` 在 `status === 'ready'` 时把它短路成 no-op。于是快照永久停在**首次**读取的目录。
DEC-053 的五个 `remote.$on` 事件订阅只在「变更发生且插件在线、Host 转发了该事件」时失效；**provider
被删除通常不发任何事件**，且用户关闭设置页期间订阅也不在 —— 两个条件都不满足，删除就直到整页刷新
才可见。这是 LES-040「两个表面读不同源、失效策略也不同」的又一个具体分支。

**Decision.** 把挂载读改成 `catalogFace.load({ force: true })`：**每次打开设置页都重新问一次 Host**。
保留 DEC-053 的事件订阅不变 —— 它覆盖「用户停在设置页时插件中途注册」的分支，挂载读覆盖「关闭期间
发生、且无事件的变更（删除）」分支，二者互补，缺一都有盲区。

**与 DEC-053 被否方案 (2) 的关系（部分取代）。** DEC-053 曾以「只在挂载时强制重读：挂载不等于目录变化，
且用户停在页面上时插件注册仍不会出现」为由否掉挂载读作为**唯一**手段。这一判断对「唯一」成立，本次也
没有退回它：事件订阅仍然是中途注册的主通道。本条新增的是挂载读这条**补充**通道，理由是重新打开页面
本身就是用户「我要看当前状态」的明确信号，其新鲜度期望高于「目录很少变、省一次请求」的节省。
DEC-053 其余决策（五个事件、`force` 也重试失败、尽力而为订阅）全部继续有效。

**Rejected.**（1）去掉 `ready` memoisation、每次 `load()` 都联网：这会连设置页在多个页面间来回切换
都变成一次请求，且不解决「停在页面上、无事件」的场景。（2）给删除单独造一个事件：Host 不发，插件
无法订阅不存在的信号。（3）定时轮询：低频事件付持续流量，markStore 已证明定时器是维护负担
（DEC-053 已否，沿用）。

**Consequences.** 测试 313 → 314：新测试钉住「`SettingsSection` 挂载时以 `{ force: true }` 读取」，
并保留原测试断言「`createCatalogStore` 的强制读确实重问 Host 并用新 groups 替换快照」；两者合起来覆盖
从 Host 删除到重开页面的整条路径。测试运行时新增 `flushEffects()` 以便按需触发挂载副作用，现有测试
不调用它、行为不变。

## DEC-053 — 2026-11-17 — 设置页的模型目录必须随 Host 事件失效，否则永远停在首读

**Context.** 用户报告：SenseNova Raccoon provider 已打开、在 model picker 里能看到，但
**设置面板里看不到**。要求定位这是不是 bug。

**Findings.** 是 bug，且只在这一个表面成立，因为两个表面读的是**不同**的目录源：

- picker 走 `modelDirectories.directoryFor(sessionId)`（会话级目录），而
  `dsh-client-ui-model-selection` 的 `ModelDirectoryResolver` 订阅了
  `llm/adapters-updated` / `llm/models-updated` / `settings/document-updated` /
  `credentials/record-updated` / `credentials/reference-updated` 五个 Host 事件并
  `refresh()`，所以插件中途注册 adapter 后它自己会更新。
- 设置页走 `remote.session.modelCatalog()`（DEC-034 定的，因为设置页没有会话），
  包在 `createCatalogStore` 里。而该 store 的 `load()` 第一行是
  `if (snapshot.status === 'ready') return` —— **一旦读成功就永久记忆**。

于是：首读发生在 Raccoon 注册之前 → 快照停在那个目录；`SettingsSection` 的
`useEffect(() => { catalogFace.load() }, [catalogFace])` 重新进入设置页时调的还是
`load()`，被同一行挡掉；**没有任何路径能让它再问一次 Host**。picker 有失效通道，
设置页没有 —— 这正是「一个地方看得到、另一个看不到」的全部原因。

Raccoon 只是最容易撞上的触发者：`raccoon-publish.ts` 在切换开关/登录/目录漂移时都会
`emit('llm/adapters-updated')`，即插件是**按设计**在运行中注册 provider 的。任何中途
注册 provider 的连接插件都会复现。

**Decision.**

1. **`load()` 增加 `{ force: true }`**：`force` 是唯一的失效通道，绕过 `ready` 记忆；
   不带参数的 `load()` 语义不变（设置页在多个页面间来回切换不该每次重新请求）。
2. **订阅与宿主同名的那五个事件**，收到即以 `force` 重读。选这五个而不是自造信号：
   内置 `ModelDirectoryResolver` 用的就是这组，二者不会漂移；它们都在客户端
   forwarded-event 白名单（`API_REMOTE_FORWARDED_EVENTS`）里，`remote.$on` 才合法。
3. **订阅是尽力而为**：`remote.$on` 缺失/抛错只损失新鲜度，绝不损失设置页本身；
   `ctx.effect` 里逐个收集 disposer 并在 teardown 逐个释放。
4. **`force` 同时修复失败的读**：`unavailable` 不再是终态，一个之前加载失败的 provider
   会被「它回来了」的同一个信号重试。

**Rejected.**（1）把 `ready` 记忆整个去掉：设置页在页面间切换会变成每次访问一次
请求，而目录绝大多数时候不变。（2）只在 `SettingsSection` 挂载时强制重读：挂载不等于
目录变化，且用户停在设置页时插件注册仍然不会出现。（3）用定时轮询：为一个低频事件
付持续流量，且 `markStore` 已经证明定时器是这类插件的维护负担。（4）只订阅
`llm/adapters-updated`：凭据/设置变更同样会改变目录（`listModels` 在缺凭据时返回空
数组），只订一个会留下另一半的同类 bug。

**Consequences.** 新增 `CATALOG_INVALIDATING_EVENTS`；`createCatalogStore().load`
接受 `{ force }`；`apply()` 增加订阅块。测试 311 → 313：一条钉住「首读之后才注册的
provider 能进设置页」（并断言不带参数的 `load()` 仍不重读，保住记忆语义），一条钉住
「`apply()` 真的订阅了那五个事件、且订阅失败时设置页仍然注册」。两条都先在原始
`client.js` 上跑成失败，再确认修复后通过。


## DEC-052 — 2026-11-17 — 关闭态 provider 的 subtitle 与标题同色，整行正文统一 secondary

**Context.** DEC-051 修好标题色之后，用户继续要求「subtitle 也修改为一样的颜色」。

**Decision.** provider 在 `data-hidden` 下，标题、meta 行、以及被改名行的原名，三者由**同一条
规则**统一为 `label-secondary`。dimmed 不再出现在该行的正文里，只留给 no-credit 提示行。

**Rationale.** 一行里两种灰会读成渲染错误，而不是层级；「已关闭」的信号本来就有开关和
meta 行自己的文字（「全部关闭」）承担，颜色不承担它。这取代 DEC-043「meta 行保留 dimmed」
一条，DEC-042/043 其余结论（标题永不落 dimmed、显式声明规则）不变。

**Consequences.** 测试从「meta 保留 dimmed」改为「**每一条**命中 meta / 原名的规则都必须等于
标题的 secondary」，并按 DEC-051 的做法先注入一条 dimmed 覆盖确认断言会失败。

## DEC-051 — 2026-11-17 — 关闭态 provider 标题被打回 dimmed：删掉重复块，测试从「第一条规则」扩到「每一条规则」

**Context.** 用户反馈设置页里「全部关闭的 provider row 的 title 颜色太淡」。DEC-042 与
DEC-043 早已定案：provider 标题 primary → secondary（一档、仍可读），dimmed 只留给 meta 行。

**Findings.** 定案的那条规则还在，但重命名提交（`c3e9136`）复制 CSS 时把
`.dshmf-setProviderMeta`、`.dshmf-setProviderOriginal` 连同**旧的 dimmed 规则**整段又贴了
一遍，位置在被覆盖规则之后。同特异性下后者胜出，所以标题实际一直落在 dimmed，DEC-042/043
的结论被级联悄悄推翻。测试没拦住：既有断言用 `ruleOf` 取**第一条**匹配，重复的覆盖规则
在它后面，检查不到。

**Decision.** 删掉重复块，只留一条标题规则（secondary）与一条 meta 规则（dimmed）。测试新增
断言：**所有**命中 hidden provider 标题的规则都必须是 secondary——先复现重复块确认它会
失败，再收修复。

**Consequences.** 视觉回到「略灰」；今后再从别处复制这段 CSS 造成级联覆盖，测试会直接失败。

## DEC-050 — 2026-11-17 — 设置页报告模型位冲突，并提供「强制修复」；但只承诺真能做到的事

**Context.** DEC-049 修好了「交出席位不安全」，但用户看不见那次修复：冲突的表现仍然只是
「默认样式」按钮变灰，没有任何地方解释为什么。用户要求把这个变成功能：设置页写清楚错误，
并且「如果可以」给一个强制解决的按钮。

**Decision.** 设置页顶部加一条**按需出现**的冲突提示（`diagnoseSeat` + `repairSeat`），
四种状态各有各的说法，因为用户下一步动作不同：

| severity | 触发条件 | 页面表现 |
| --- | --- | --- |
| `ok` | 没有竞争者 | 不显示 |
| `contested` | 有竞争者，但我们仍持有 | **不显示**（面板正常，提示只会变成噪音） |
| `broken` | 竞争者真的赢下了格子 | 显示 + 点名 + 「强制修复」 |
| `broken` + 空位 | 谁都不在里面 | 显示 + 说明 + 「刷新页面」 |
| `unknown` | Host 不支持枚举 | 显示「无法检查」，**绝不显示为正常** |

**诊断靠结构，不靠包名。** 沿用 DEC-049：一个 entry 是不是「原生选择器」只看它有没有声明
`conversation.input.model.options`。所以 fork、改名发行版照样被认作原生，而任何只抢格子
不声明子槽的插件都会被列为竞争者并**点名**（`dsh-acp-agents`），因为「另一个插件」不是
一句可执行的说明。

**修复动作（`repairSeat`）只做一件事：把格子抢回来。** 计算所有竞争者里最低的 priority，
从它再往下 `-1` 重新注册，于是我们重新成为最低者、重新赢下格子。已在真实 `SlotCore` 上
验证：`acp@-6` 占位时修复后 `flatmap@-7` 赢回，且**幂等**——再次点击不改变任何东西。

**刻意不承诺的事（这一条比上面都重要）。** 最初我让修复「顺便声明缺失的
`conversation.input.model.options` 子槽」，并在文案里承诺「让默认样式恢复可用」。
在真实 `SlotCore` 上验证后发现**这是假的**：`renderSlot` 读的是**当前被选中的那个 entry**
的 `children`，而原生模式恰恰要 dispose 我们自己的 entry，于是渲染的是**继承者**（acp）
的子槽——它没有 `options`。在我们自己的 entry 上声明那个子槽，对用户毫无作用。
所以：
1. `registerSeat` 去掉了 `adoptReturnRow`（留着就是个没人受益的复杂分支）；
2. 文案改成如实说明「不会、也无法让默认样式恢复——那取决于占位插件是否退出」；
3. 已经持有格子时 `repairable: false`，页面**不显示按钮**，只显示解释
   （`conflict.notRepairable`）——一个按下去不改变任何事的按钮就是在说谎。

**Consequences.** 空位（两个插件都 disable 后的残骸）**无法就地修复**：shipped entry 当初
注册就抛错了，`slots.inject` 不会因为声明纪元没变而重试，本插件再注册也只是把我们自己的
面板放进去，不是用户要的原生选择器。所以那条路径只提供「刷新页面」，并在文案里说明原因，
而不是假装能修。

**Bug found by the tests, not by review.** 第一次实现时修复会留下**两个**自己的 entry：
`unmountSeat()` 会同步触发槽位通知 → 重入 `syncMode` → 把我们刚 dispose 的 entry 重新挂上，
和修复后的新 entry 并存（`[-1, -7]`）。修法是让 `repairSeat` 全程持有 `syncMode` 用的同一个
`syncing` 重入保护。已补一条专门的回归测试，并验证「去掉守卫即变红」。

**Test note.** 新增 13 条测试，其中 2 条**驱动真正的 `repairSeat`**（经
`settings.section` 的 inject face），而不是塞一个 stub —— 早期的 stub 版本让「修复」在测试里
永远是绿的。已验证两条关键回归在回退实现后确实变红。

## DEC-049 — 2026-11-17 — 「下面有人」不等于「原生选择器在」：交出席位前必须验它声明了回程槽

**Context.** 用户报告与 `github:lilinfangrelax/dsh-acp-agents` 冲突，两个现象：
1. 两个插件都 disable 后，输入框里连插件选择器都没了；
2. acp 改动了原生 model picker，本插件的「原生」按钮点不了。

在真实 `SlotCore`（从 `dsh-web-frontend` 抽出，非仿真）上复现，机制是确定的：
`single` 槽**保留每个注册、只渲染 priority 最低的那个**，且同一 priority 第二次注册
**直接抛错**。acp 注册 `conversation.input.model` 时**不带 priority**（默认 0），与
shipped `ModelSelect` 撞在同一格：
- 谁先注册谁赢，后注册者**抛错**（`already has a registration at priority 0`）；
- 若 acp 先注册，则 **shipped `ModelSelect` 抛错**，它的 entry 与它声明的两个子槽
  （`.label` / `.options`）一起消失 → 这正是现象 1：**两个第三方插件都关掉后，席位里
  只剩当初那场碰撞的残骸，原生选择器没有回来**，因为 `slots.inject` 只在
  `declarationEpoch` 变化时重建，而声明本身没变，所以它**永远不会自动重试**；
- acp 还抢先注册 `conversation.input.model.label`（priority 0），本插件的
  `readLabelEntry()` 按 `entriesOfSlot()[0]` 读赢家，于是标签位置显示 acp 的
  `ACP:<agent>` —— 这是「acp 也改动了原生 picker」的可见部分。

**Decision.** `canStepAside()` 不再满足于「别的 entry 存在」，而是要求**将要继承的那个
entry 自己声明了 `conversation.input.model.options`**（新增常量 `NATIVE_MENU_SLOT`）。
理由来自渲染器源码：`renderSlot(key)` 读的是 `entry.children[key]` —— **子槽由被选中的
那个 entry 挂载**。本插件「回到平铺」的那一行 `NativeMenuRow` 正挂在
`conversation.input.model.options` 上，所以一个没声明它的 entry 根本无法承载回程控件：
交出去就是把面板换成一个陌生控件，且**没有回头路**。

实现上：
- `otherEntries()` 额外按 priority 升序排序，`[0]` 可证就是继承者；
- 新增 `nativeInheritor()` 返回**合格**的继承者，`canStepAside()` = `nativeInheritor() !== undefined`；
- `declaresReturnRow(entry)` 同时接受 `entry.children`（真实 `StoredEntry` 形状）与
  `entry.options.children`（原始注册形状），避免把「Host 换了暴露方式」误判成「什么都没声明」；
- 判定**不看包名**：任何声明了该子槽的 entry 都算原生选择器（fork、改名发行版一样成立），
  只有「声明了回程槽」这一结构事实才作数；
- `reportInherit()` 在拒绝时额外 `console.warn` **点名挡路的插件**，因为「下面没人」和
  「下面有人但不是原生选择器」对用户是完全不同的两件事，日志必须分得开。

**Consequences.** acp 在位时，面板照常显示（不再有交出去后卡死的一步），「默认样式」按钮
按 `native.unavailable` 明确置灰，控制台指名 `dsh-acp-agents`。修的是**交出席位的安全性**，
不是 acp 的 bug：两个第三方插件争同一 `single` 格在结构上就无法靠 priority 协商（动态
runner 会把 priority 重写成 `-1,-2,…`，静态 bundle 行则完全不改写），所以「谁能安全接管」
必须由结构判断，而不是靠排队先后。

**Test note.** 测试夹具原先只塞一个裸组件当「shipped 竞争者」，既没声明 `.options` 也没声明
`.label`，与真实 `ModelSelect` 不符——正是这种不真实的夹具让旧断言全绿。现改为默认带上
`SHIPPED_SEAT_CHILDREN`，并新增 4 条回归：第三方占位不算原生选择器、持久化 native 遇到
第三方时仍保持面板、有第三方压在上面时仍以结构判定、以及「按声明的子槽而非包名识别原生
选择器」。已用「回退修复」验证这 3 条确实会红。



## DEC-048 — 2026-11-17 — 设置页模型行也画目录 badge 与倍率：与选择器同一套语法和数据

**Context.** 选择器的模型行早就画了目录的 `badge` 芯片（「限时免费」、负载标记、费率）并
把名字里的 `· x0.01` 倍率拆成更小更粗的一段，但设置页的模型行只画裸名字。于是同一个模型在
两处长得不一样：用户要在「这里把它打开/关闭」的界面上判断「这是哪个模型、现在是不是便宜
的那个」，还得先去开选择器。设置页恰恰是最该直接回答这个问题的界面。

**Decision.** 设置页的模型行复用选择器的两件事，而不是另起一套：
1. **倍率**由模块级的 `nameRuns`（与面板同一个正则语义）拆出，落进同一个
   `.dshmf-rowNameMark` 样式，因此 `· x0.01` 在两处都是同一段小号粗体旁注。
2. **芯片**由模块级的 `catalogBadge(model, resolveText)` 解析目录的 `badge.text` /
   `badge.tone`，经 host 的 `resolveText` 解析（可能是翻译表），画成与选择器同款
   `.dshmf-badge`。目录没给 badge、或解析出空串的模型**不画芯片、也不留空位**。
3. 布局上，名字与芯片同处一行（`.dshmf-setModelNameLine`），**让位的是名字**
   （`min-width:0` + 省略号），芯片 `flex:none` 不被压缩；行被关闭时芯片随名字一起变暗。
   账户在该路由上额度耗尽时，欠费说明仍在名字行**下面**单独一行，两种事实不抢同一段文字。

**Why drawn, not borrowed.** 选择器那行是 shipped 包的模块私有组件（CSS 是 hash 模块），
而它渲染的 `conversation.input.model.label` 槽是 session 作用域，`settings.section` 是
root 作用域，设置页挂不上选择器自己的行。能共享的是**语法和数据**：同样的「名字后跟芯片」
顺序、同样的 `badge.text`/`badge.tone`，而插件的芯片本就与 shipped `Tag` 几何一致。

**Consequences.** `catalogBadge` 与 `nameRuns` 提升到模块作用域供两处共用，避免一个表面
把倍率画成普通文字；`settings.section` 的 inject 增加 `resolveText`，否则本地化 badge 会
印出 `[object Object]`。此前的「设置页模型行只画名字」不再是设计选择，而是待补的缺口。

**Lessons.** 同一份目录数据被两个表面渲染时，「谁负责画」要在模块级定一次，否则两个表面
迟早长得不一样；而「让位的是谁」必须显式写进 CSS，默认的 flex 行为会让芯片先被压扁。

## DEC-047 — 2026-11-18 — 行内 host 原生 cell 的收尾：选中行角标、崩溃回退、可访问名与删除线（修订 DEC-046）

**Context.** DEC-046 把 picker 自带的 label 槽搬到了模型行上，一次 UI/UX 复核又找出几处
「机制对、细节错」的问题。多数源于同一个盲点：**占用者的输出是不透明的第三方组件，而本插件
原有的若干规则都假设行的内容是自己画的。**

**Findings.**（均已对照 `dsh-connect-workbuddy` 与出厂 `ModelSelect.module.css` 核实）

- 选中行是深蓝底白字，本插件自绘角标因此有一条 `.dshmf-badge` 反白覆盖规则；但 host 了
  cell 的行画的是**占用者的**角标（品牌色 16% 半透明底 + 品牌色文字），在深蓝底上几乎
  不可见，而那条覆盖规则对它无效。
- `LabelBoundary` 只接住**抛错**；占用者渲染 `null` 不是崩溃。此时行既没有自绘名字也没有
  badge，`<button>` 又没有 `aria-label`，于是变成**无名按钮**。
- `renderRow` 抑制目录 badge 的条件是「cell 存在」而非「cell 渲染成功」，所以占用者崩溃
  时**目录 badge 跟着丢失**——而 README 与 DEC-046 都承诺崩溃只损失装饰、名字和 badge 仍在。
- `text-decoration` 会传播到行内后代且**后代无法取消**，而 cell 的角标位于被划线的轨道内；
  workbuddy 的 label 根是 `inline-flex`，删除线是否进入它取决于浏览器对原子内联盒的处理。
  无论哪种，规则里「不划 badge」的说法都已不成立。
- `.dshmf-rowLabelFallback` 硬编码了 `13px/18px/400`，与 `.dshmf-row` 重复，且 400 会
  **覆盖选中行的 600**：占用者一崩，选中行就悄悄掉回常规字重。
- 崩溃测试从未真正触发边界（测试渲染器不调用子组件），把边界删掉它照样通过。
- 文档引用编号错了两处（触发器 cell 是 DEC-030 不是 DEC-028；family 尾巴是 DEC-023 不是
  DEC-024），测试总数也写成了过期的 256 → 262。

**Decision.**

1. 选中行用属性子串选择器把**占用者的**角标压到反白底上：
   `[class*="badge"|"promo"|"Badge"|"Promo"]`，只改底色/文字色/边框，**不碰布局**。这是对
   第三方类名的**有意耦合**，写进注释与 DETAIL，因为除此之外没有杠杆。
2. 行按钮加 `aria-label` = 模型名。占用者渲染空内容时行仍然有名，且这个名字不依赖装饰。
3. 目录 badge 挪进 `LabelBoundary` 的 **fallback**：崩溃时名字与 badge 一起回来，与文档
   承诺一致。抑制自绘 badge 的理由是「占用者自己会画」，占用者不在了，这个理由也就不成立。
4. 删除线**保持现状**：它继续横穿占用者的角标。另一种选择是 host 行完全不划线，但那样丢掉
   的是**信息**（这个模型没余额），留下的才是装饰。宁可让角标被划，不可让信号消失。注释与
   测试改成陈述事实，不再声称「不划 badge」。
5. `.dshmf-rowLabelFallback` 只声明盒模型（`display`/`white-space`），字号字重全部继承行，
   选中行的 600 不再被覆盖。
6. 崩溃测试改为**真的驱动边界**（构造 `LabelBoundary`、注入错误 state、断言回退），再断言
   每一行都把占用者包在该边界里、回退里含模型名。测试渲染器不调用子组件这一点，写进注释。
7. 抽 `providerNameFor(group, t)`：`deepseek-account` 的本地化例外此前有三份拷贝。
8. 更正 DEC-028 → DEC-030、DEC-024 → DEC-023 的引用与测试总数。

**Rejected.**（1）host 行完全不画删除线：丢掉真正的信号。（2）为角标重新自绘一套：正是
DEC-046 否掉的做法。（3）让占用者自己适配选中行：它是第三方代码，且不知道本插件的色板。
（4）去掉 `LabelBoundary`、改由行兜住空输出：接不住抛错，且崩溃必须止于装饰。

**Consequences.** `renderRowLabel` 多解析一次 badge 供 fallback 使用；`renderRow` 的
`aria-label` 与「抑制条件不变」的注释；CSS 多一条选中行角标规则、`.dshmf-rowLabelFallback`
瘦身为两条声明；新增 `providerNameFor` 助手。测试 278 → 287（崩溃测试拆分断言，另有选中行角标、
可访问名、崩溃仍留 badge、回退继承字重四条新测试）。


## DEC-045 — 2026-11-17 — 设置页以文字行展示「无额度」：模型逐个标注，provider 仅全组无额度时标注

**Context.** 用户要求：面板里靠线划掉的「余额/额度不足」（含以 429 返回的额度不足），要在
设置页模型名下方以文字展示；且**设置页不用线划**；当一个 provider 下**所有**模型都无额度时，
provider 名下方也要有该提示。

**Findings.**

- 现有 strike 系统已是全局单例：`createMarkStore` + localStorage `dshmf:insufficient`，
  route key = `provider/model`，TTL 24h——设置页直接复用**同一个 store** 即可。
- Host 已把额度耗尽归类为结构化错误码 `QUOTA` / `ACCOUNT_QUOTA`，插件现有
  `INSUFFICIENT_CODES` 已包含这两个码，判定层无需改动。
- 设置行的「变暗/降档」已经表达「关掉了」；线划会与它撞车——两个状态不能共用一种装饰，
  这正是用户禁止线划的原因。
- provider 级聚合必须是「本组**全部**模型无额度」且**组非空**：空组是「目录还没加载」；
  且聚合范围用目录全量模型（含被隐藏的），隐藏是显示选择，不能制造「整个 provider 无额度」。

**Decision.**

1. `creditNotes(marked, groups)` 纯函数：从 live map（`getSnapshot().marks`）推导两级标注
   ——模型级 `models: Set<routeKey>`，provider 级 `providers: Set<groupId>`（仅非空且全 strike）。
2. `SettingsSection` 增加 `insufficient` 注入（`inject` face 增加
   `insufficient: markStore ?? EMPTY_INSUFFICIENT`），`useSyncExternalStore` 读同一 store，
   快照恒为同一对象。
3. 渲染：provider 名下、模型名下各渲染 `.dshmf-setNoCredit` 文字行（`No credit` /「无额度」；
   provider 级用 `all models out of credit` /「全部模型无额度」），带 `title` 长解释。
   模型行新增 `.dshmf-setModelText` 文本列以容纳两行。
4. 样式：12px/18px、`--dsw-alias-state-warn-label`；`data-hidden` 下走 dimmed（与 meta 行同档，
   标题降到 tertiary）。**整个设置块禁用 line-through**（测试钉死）。面板线划行为不变。

**Rejected.**（1）设置页也画线划：与「关」的降档撞车，用户明令禁止。（2）provider 标注只算
「当前开启」的模型：隐藏是显示选择，不能改变账号事实。（3）用 `account/getBalance` 取真实余额：
账号级、仅 DeepSeek 平台账号 route 有意义，超出本次需求。（4）改用 Host 错误码替代现有判定：
现有码表已一致，属无谓重构。

**Consequences.** 设置页现在会说「这个模型/这组模型没钱了」，与面板线划是同一事实的两种表达；
provider 行在**折叠**状态下也能看到全组无额度。新增测试：creditNotes 真值表、展开/折叠渲染、
部分无额度负例、无 mark face 降级、注入 face 检查、CSS 无线划守卫。
## DEC-044 — 2026-11-17 — ON 的模型名提到 primary（亮色近黑/暗色近白），拉大 ON/OFF 差距（修订 DEC-043）

**取代：** DEC-043 中「ON 的模型名用 secondary」这一条；DEC-043 的其余结论（OFF 落 tertiary、
标题永不落 dimmed、meta 行保留 dimmed、显式声明规则）继续有效。

**Context.** DEC-043 之后用户再反馈：ON 的模型行标题应「亮色用黑、暗色用对应的亮色」，
进一步拉大 ON/OFF 的可辨性。secondary 在亮色下 5.80:1，与 OFF 的 tertiary 2.13:1 虽是一档，
但仍不够「黑」。

**Decision.** ON 的模型名提到 `label-primary`（亮色 `#0f1115` 18.90:1、暗色 `#f9fafb`
15.03:1）；OFF 保持 `label-tertiary`（2.13:1 / 4.24:1）。ON/OFF 差距由「secondary vs
tertiary」拉大到「primary vs tertiary」，一眼可辨，同时 OFF 仍远在 dimmed（1.26:1 /
1.64:1）之上，保持可读。

**Rejected.**（1）ON 用 secondary（DEC-043 原案）：不够黑，即用户本轮反馈。（2）OFF 也提到
primary 或 secondary：ON/OFF 重新同色，回到「不可辨」。（3）OFF 直接落 dimmed：回到最初
不可读的投诉。

**Consequences.** ON/OFF 的层级改由 **字体族（UI vs 等宽）+ 字重（600 vs 400）+ 字号
（14 vs 13）** 承担，色调不再区分 provider 与 model（两者 ON 态同为 primary，这是有意的）。
render 测试改为断言「ON 模型名 = primary、OFF = tertiary 且不等于 primary」，
并把「ON/OFF 由色调区分」的注释更新为「由族/字重/字号区分」。测试数不变（256）。
## DEC-046 — 2026-11-18 — 模型行也渲染 picker 自带的 label 槽：倍数、负载、促销角标与原生一致

**Context.** 用户要求模型行在模型名后带上和原生 picker 一样的信息——`x0.01` 倍数、忙碌
标记、`Free Now` 之类的促销角标——并建议直接复用原生 picker 的渲染视图。此前 DEC-030 只在
**触发器**上渲染了 `conversation.input.model.label` 槽的胜者；网格里的模型行画的是目录名
加自绘的 `model.badge` 芯片，连接插件的倍数/负载/促销信息全部丢失。

**Findings.**

- 原生 `ModelSelect` 的**每一行**都经 label cell 胜者渲染（`placement: 'option'`），目录
  badge 只是它「无人应答」时的回退。即槽系统本来就是为行设计的，DEC-030 的触发器只是同一
  机制的一个 placement。
- 行持有行所需的全部 owner props：`provider`、`model`、`placement: 'option'`、
  `selected`，与触发器同源，无需新数据。
- 占用者输出不透明（一个组件返回一整棵树），无法把名字与装饰拆开，因此整格 host；名字/
  倍数/角标的排版由占用者负责，与触发器、原生菜单天然一致。
- 真实占用者（workbuddy）在 `placement !== 'trigger'` 时走**紧凑**渲染——行里正好需要紧凑。

**Decision.**

1. 在**按 provider 分组**下，每个可选择的模型行渲染同一 label cell 胜者，`placement: 'option'`；
   触发器保持 `placement: 'trigger'` 不变。
2. 行格与触发器共用**每次面板一份**的 `labelFaceValue`（`entry.inject(sessionId)`）与
   `labelTranslate`（locale seat），不做每行重建——否则 20 行 = 20 次 inject，而原生
   picker 本就是每次 picker 一份。
3. 行条目额外携带**未解析的** `providerName`（目录名）。label cell 胜者用自己的 locale
   seat 解析它；本插件只预先解析 `deepseek-account` 一个 provider 名，其余留原样。
4. host 了 cell 的行**不再**自绘目录 `dshmf-badge`、名字也不再套 `nameRuns` 的倍数提升——
   否则同一个倍数出现两次（workbuddy 的 `splitCatalogRate` 注释里记录的正是这个缺陷）。
5. cell 外包 `LabelBoundary`，回退到 `.dshmf-rowLabelFallback`（纯目录名，沿用行的 13px/
   18px 文本度量、不换行）。占用者崩溃只损失装饰，不损失行本身。
6. **按 family 分组下不 host**：此时行的主文本是 **provider** 而非模型，把模型 label cell
   放进去会让 cell 装饰的是 provider 名；family 行继续用 DEC-023 的「更安静的尾巴」
   （模型型号 + 更小更粗的倍数）。

**Rejected.**

- 自绘倍数/忙碌/促销角标：重复实现第三方装饰，且与原生永远差一拍（促销文案、配色、紧凑
  规则都在占用者里）。用户明确要求「用原生 picker 的渲染视图」。
- 在 family 分组下也 host：cell 会装饰 provider 名（上文 Decision 6）。
- 每行重建 inject face：N× 服务读取与对象装配；原生 picker 亦为每次一份。
- 把 `LabelBoundary` 去掉、让行自己兜住崩溃：占用者是第三方代码，崩溃必须止于装饰
  （与 DEC-030 同一 containment 结论）。

**Consequences.** 行条目增加一个 `providerName` 字段；新增 `renderRowLabel` 与
`labelFaceValue`/`labelTranslate` 两个 memo；`renderRow` 在 cell 命中时改画 `nativeCell`
并抑制目录 badge。CSS 增加一条 `.dshmf-rowLabelFallback`。测试新增 6 条
（cell owner props、无双重装饰、无占用者回退不变、崩溃只损装饰、family 不 host、每面板
一份 face）。合入时全仓测试总数 272 → 278。

**Follow-up.** 合并后的一次 UI/UX 复核发现若干实现缺陷（选中行角标在深蓝底上不可读、
占用者崩溃时目录 badge 一起丢失、行失去可访问名称等），逐条修在 **DEC-047**；本条其余
结论不变。


## DEC-043 — 2026-11-17 — 关闭态标题降一档改为 tertiary：ON/OFF 一眼可辨且仍可读（修订 DEC-042）

**取代：** DEC-042 中「模型名关闭时保持 secondary」这一条；DEC-042 的其余结论（标题永不落
dimmed、meta 行保留 dimmed 承担关闭信号、规则显式声明）继续有效。

**Context.** DEC-042 之后用户反馈两轮：先是「too subtle」要更明显，澄清后明确目标——
**模型行标题的 ON/OFF 差异**要明显。DEC-042 把 OFF 模型名留在 secondary，与 ON 完全同色，
差异为零，确实不可辨。

**Findings.**

- Host 色阶在 secondary 与 dimmed 之间还有一档**设计好的** rung：`label-tertiary`
  （亮色 `#adb2b8`、暗色 `#81858c`），本仓库 `setIntro`/`setEmpty` 已用它承载「安静但可读」
  的说明文字——即它就是 shell 自己的「明显变灰但仍是正文」的那一档。
- 实测对比度（WCAG）：亮色 secondary 5.80:1 → tertiary 2.13:1（dimmed 1.26:1）；
  暗色 10.42:1 → 4.24:1（dimmed 1.64:1）。一档 rung = 明显的灰阶跳跃，同时远离
  dimmed 的不可读区间。
- provider 行无需再改：primary → secondary（18.9 → 5.8 / 15.0 → 10.4）本来就是一档
  明显差异。

**Decision.** OFF 的模型行标题降一档到 `label-tertiary`；provider 行保持 DEC-042 的
primary → secondary。标题仍永不落 dimmed。render 测试新增一条断言：OFF 的模型标题
**不等于** ON 的（secondary），防止未来重新塌缩成同色。

**Rejected.**（1）OFF 保持 secondary（DEC-042 原案）：与 ON 同色，即用户本轮反馈的
「差异不可辨」。（2）继续降到 dimmed：回到最初不可读的投诉。（3）自造颜色
（如 color-mix 混 secondary 与 dimmed）：绕开设计系统 token，且此前 DEC（DEC-035 时期）
已有「tint 混色在两主题下不稳定」的教训。

**Consequences.** 只改模型行一条 `[data-hidden]` 颜色规则与注释、测试断言从
「等于 secondary」改为「等于 tertiary 且不等于 secondary」。测试数不变（256）。


## DEC-042 — 2026-11-17 — 关闭态行的标题不再落 dimmed 色，只降一档到次级灰

**编号更正.** 合入时与遥测开关的 DEC-041 撞号，本条目改为 DEC-042。

**Context.** 设置页里关掉一个 provider 或模型后，行标题整体掉到
`--dsw-alias-label-dimmed`。从已安装 shell 实测该 token：亮色下是 `#e1e5ee`（白底上
接近不可读）、暗色下是 `#43454a`（近黑底上同样发闷），两个主题都低于可读阈值。
用户反馈「hard to recognize the text」，要求标题在关闭态也保持可读，
只给一个「略灰」的颜色。

**Decision.** 标题最多降一档：provider 名 `label-primary → label-secondary`；模型名
本就停在 `label-secondary`，关闭时保持不变——规则**显式保留**（写与基线相同的值，
防止未来改基线色时重新漂回 dimmed），与仓库「stated rather than inherited」的
既有惯例一致。「已关闭」的视觉信号改由开关状态与 meta 行（保留 dimmed）承担，
标题不承担。render 测试钉住：两条关闭态标题规则必须是 `label-secondary`、
永不出现 `label-dimmed`，meta 行保留 dimmed。

**Rejected.**（1）继续用 dimmed：即用户投诉的不可读状态。（2）直接删掉关闭态规则、
完全不区分：标题失去「略灰」这一档信号，且没有任何断言挡住未来重新引入 dimmed。
（3）meta 行也放宽：超出本次范围；meta 是行内最不重要的一行，保留 dimmed
维持整行「一眼可辨已关闭」的原有设计意图。

**Consequences.** 只动设置页 CSS 的两条 `[data-hidden]` 颜色规则（原来一条合并选择器
拆成 provider 名/meta 各一条，模型名一条改值）与对应注释；不改 DOM 结构、
不改开关与可见性逻辑。测试 255 → 256（含遥测开关合入后的基线）。

## DEC-041 — 2026-11-17 — ⛔️ 匿名心跳可关闭：设置页底部的开关，默认开启（推翻 DEC-031 的「不做开关」）
**编号更正.** 合入 `telemetry-toggle` 时与本分支的 DEC-037（设置导航图标）撞号，合并后改为 DEC-041；该分支内提交与 LESSONS 里仍称 DEC-037。


**取代：** DEC-031 第 4 条（「没有开关，默认 daily，不允许 off」）以及 README / DETAIL 里
「deliberately not switchable」的表述。DEC-031 的其余结论全部继续有效：每日一条、七个字段的
固定载荷、UTC+8 日界、先落盘再发送、30 次降级、复用 `dsh.zuos.us/api/e`。

**Context.** 用户要求：「telemetry 功能现在一直开着，我需要在设置面板加一个开关，默认 ON，
放在面板底部，让用户可以关掉/打开它。」这与 DEC-031 当时「不做开关」的判断直接冲突。

**Findings.**

- DEC-031 拒绝开关的理由是「一个没人能点到的开关不构成同意」。这个理由在**当时**成立：本
  bundle 那时还没有设置页。但 DEC-034 之后有了 `settings.section`，开关有地方住了——**前提
  变了，结论就该重审**。
- 关键结构事实：**开关住在浏览器，心跳由宿主发送。** 客户端只有 `localStorage`；宿主才发网络
  请求。两者必须打通，否则开关就是假的。
- 打通通道本仓库已有先例：DEC-032 的 project-link 就是「宿主自建路由 + 浏览器 fetch」，并过
  `connection.requestRejection` 信任栅栏。遥测选择走同一条路，只是方向相反（浏览器写、宿主读）。
- 默认必须 ON：这是 opt-out。从没打开设置页的机器照旧上报，开关才是真选择而非伪装的默认值
  （这正是 DEC-031 当初担心的问题，opt-out 默认值恰好回答了它）。

**Decision.**

1. **设置页底部加一个独立分区**（`.dshmf-setTelemetry`），在模型列表之后、用列表同款发丝线
   隔开。它管的是整个插件唯一的网络请求，不属于任何 provider / 模型，所以不放进列表里。
2. **默认 ON（opt-out）。** 缺记录 = 开启；文件损坏、`localStorage` 不可用、读到垃圾值一律
   降级为**开启**——一个读不出来的选择绝不能悄悄把上报关掉，那会正好少算那些文件坏掉的机器。
3. **客户端存 `localStorage`（`dshmf:telemetry`）+ 镜像到宿主。** `setEnabled` 同时写本地、
   通知订阅者、`void` 掉镜像请求。镜像失败一律 resolve（不 reject），宿主半边不存在时开关照样
   工作和显示，只是选择只存在本地。
4. **宿主新增 `TELEMETRY_SETTINGS_PATH` 路由**（GET 读当前选择 / POST 写新选择），过与
   project-link 同一道信任栅栏，`ctx.effect` 挂生命周期。POST 只接受 `{enabled: boolean}`，
   其余一律 400 而不是猜——这个文件闸的是真实的网络发送，含糊的写入不能被默认成开或关。
5. **宿主在每次发送前重读选择文件**（`telemetry-settings.json`，0600，与 `analytics.json`
   同目录），不是只在启动时读一次：这样拨开关在当天晚些时候的下一次复查就生效，无需重启。
6. **关闭时不发送也不落状态。** `TelemetryReporter` 加 `enabled` 闸，`prepare()` 第一件事就判它；
   关闭时既不 POST 也不写 `analytics.json`，所以重新打开的次日会干净地报一次 install/heartbeat，
   而不是接着一条半写的记录。
7. **激活时把已存选择推给宿主一次**（`syncNow`，fire-and-forget），这样用户在上一个会话里做的
   选择，即使不再打开设置页也会被下一次心跳遵守。

**Rejected.**（1）继续不做开关：用户明确要求，且有了设置页后 DEC-031 的前提已不成立。
（2）把开关放进模型列表里、当作某个 provider 的子项：它管的是整个插件的网络请求，不是某个
provider。（3）默认 OFF：那就成了 opt-in，会静默抹掉所有老机器的统计。（4）只写
`localStorage` 不同步宿主：宿主读不到浏览器，开关就是装饰。（5）宿主只在启动时读一次选择：
拨开关要重启才生效，等于没做。（6）损坏的选择降级为「关闭」：会正好少算文件坏掉的那批机器。

**Consequences.**

- `telemetry.js`：新增 `SETTINGS_FILE`、`parseSettings` / `serializeSettings` /
  `readSettingsFile` / `writeSettingsFile`，以及 `TelemetryReporter` 的 `enabled` 选项与
  `enabled` getter、`prepare()` 顶部的闸。
- `index.js`：新增 `TELEMETRY_SETTINGS_PATH`、`registerTelemetrySettings`、
  `readTelemetryBody`；`heartbeat()` 发送前读选择文件，关闭则返回 `{reason:'opted-out'}`。
  `apply()` 多注册一条路由。
- `client.js`：新增 `TELEMETRY_KEY`、`readTelemetryEnabled` / `writeTelemetryEnabled` /
  `syncTelemetryEnabled`、`createTelemetryStore` / `TELEMETRY_ON`、`TELEMETRY_SETTINGS_PATH`
  （浏览器侧、文档相对路径），`SettingsSection` 底部新分区，`settingsDict` 新增
  `telemetry.title` / `telemetry.desc` / `telemetry.toggle`（双语），`apply()` 构建并注入
  `telemetryStore`、激活时 `syncNow`。
- `SettingsSection` 新增 inject 面 `telemetry`；降级时用 `TELEMETRY_ON` 保持 hook 形状不变。
- 测试 242 → 253：遥测设置默认/损坏降级、文件原子读写与 0600、opt-out 上报体不发且不落状态、
  宿主路由 GET/POST/400/405、客户端 store 默认 ON + 持久化 + 镜像 + 订阅、镜像 POST 路径与
  失败 resolve、设置页底部分区位置与默认 ON、双语词条、浏览器与宿主路由路径一致。
  另改两条旧断言：设置页 switch 计数改为只数列表内的（遥测开关在列表外，带独立 class）；
  repo-url 的两条「只注册一条路由」改为「两条路由、按 path 查找」。
- 已知取舍：宿主半边不存在（Desktop 自带文件服务）时镜像不落地，选择只存在浏览器本地；该机器
  的心跳照旧（等于 opt-out 默认），开关仍渲染且可用，只是这一台的关闭只在本地生效。

## DEC-045 — 2026-11-17 — Provider 改名是本地别名，走同一条显示名推导

**编号更正.** 合入 `main` 时先与遥测开关的 DEC-041 撞号、又与该分支自己的
DEC-042/043/044 撞号，最终改为 DEC-045；本分支内提交信息里仍称 DEC-041。

**Context.** 用户要在本插件自己的「设置 → 模型列表」里给 Provider 改名，并要求输入框的模型选择器也显示新名字；设计上要求 modern and elegant。

**Findings.**

- 宿主目录里的 `provider.name` 来自连接插件的 adapter（`buildModelCatalog` 直接读 `ctx.llm.listProviders()` 的 name），不是模型选择器可以改写的字段；宿主 Settings → Models 的 `displayName` 也到不了 catalog。因此改名只能是本插件自己的显示层。
- 显示名散落在：*By provider* 分组标题、*By family* 行主文本、行 tooltip、Provider 搜索、失败条；任何一处单独处理都会漂移。
- 现有 `providerLabel` 已经是唯一出口，扩展第四个参数即可，不需要第二套命名逻辑。
- 设置页输入框应复用宿主 Models 页的字段几何（32px、`.5px` border-l4、radius-md、bg-layer-1），否则会像另一套控件。

**Decision.**

- 新增 `dshmf:aliases`（provider id → 字符串），独立于 `dshmf:hidden`；缺省表示目录原名；与原名归一化后相同则不落盘。
- `providerLabel(group, t, resolveText, alias)` 先取别名；标题、家族行、tooltip、失败条、搜索 title 都调用它。
- 搜索继续同时认目录原名与别名；家族行尾标只剥离目录原名，别名是用户标签，可能是模型名里的词（`Pro`），误剥会改坏模型名。
- 设置行加铅笔（24px，常驻；有别名时着色）+ 行内编辑器：Enter/对勾保存，Esc/叉号取消，失焦提交；空值或等于原名保存即恢复；已有别名时提供一键恢复；重名只提示不阻止。
- 编辑器里除输入框以外的 mousedown 全部接管：按钮走一次性 `suppressBlur` 标记，其余 `preventDefault`。否则触屏点「取消」会先失焦提交、再取消一个已经保存的编辑器。
- `Escape` 挂在编辑器容器上（按钮获得焦点时也生效），`Enter` 只挂在输入框上——在「取消」上按 Enter 必须是取消。
- 重名比较同时看其它 provider 的目录名与别名，用 `toLowerCase`（不用 `toLocaleLowerCase`，避免土耳其语 I/i 规则）。
- 输入清洗：控制字符转空格、空白折叠、trim、48 个码点上限；`maxLength` 不用（按 UTF-16 计会切坏 emoji），改在 `onChange` 里按码点裁剪并回写 DOM 值，否则 React 因 state 未变而跳过渲染，显示比实际保存的长。
- 重名提示走常驻 `role="status"`（空时裁剪隐藏而非 `display:none`），临时插入的 live region 不会被读屏播报。
- 所有样式只用宿主 token，复制宿主设置字段的尺寸/边框/圆角/底色。

**Rejected.**（1）写宿主 `displayName`：到不了 catalog，且不是所有 provider 可配置。（2）用 provider 名做 key：改名会改变身份、路由或可见性记录。（3）只在设置页替换文本：输入框面板是另一个组件、另一个 store。（4）弹窗或独立编辑页：行内编辑更轻，且不打断长列表的上下文。（5）允许空别名覆盖为空字符串：会让「恢复原名」变成不可逆的空白标题。

**Consequences.**

- 面板与设置共享一个 store，保存即重渲，无需刷新；别名按 id 保留，provider 暂时消失再回来仍生效。
- 原生 `默认样式` picker 仍显示目录名（宿主组件，不改）。
- 测试新增 16 项：记录清洗/读写/store、`providerLabel`/搜索/尾标、面板标题/家族行/即时重渲、设置编辑器保存/取消/Esc/IME/失焦/恢复/重名（含目录名与大小写）/空值/码点裁剪/指针与失焦竞争、复制键完整性、字段样式 token。

## DEC-040 — 2026-11-17 — 模型名改用等宽字体，provider 名留在 UI 字体

**Context.** DEC-039 之后 provider 行靠字重（600）与模型行（400）区分。用户进一步要求
「use fixed-width font for model row title」——让模型名用等宽字体。

**Findings.**

- 模型名本质是**标识符**（grok-4、claude-sonnet-5.5、deepseek-v4.1-flash-1017），
  不是散文，等宽字体在语义上是对的。
- 等宽还带来实际收益：版本号和小数位在行与行之间对齐，一列名字可以「扫」而不是「读」。
- Host 已定义 `--ds-font-family-code`，其值指向 `--dsh-font-family-code-default`
  （SF Mono / JetBrains Mono / Fira Code / Consolas，带 PingFang SC / Microsoft YaHei
  中文回退），所以等宽字体是**已存在**的 token，不是新增字体栈。

**Decision.** `.dshmf-setModelName` 用 `font-family: var(--ds-font-family-code)`，
字号 13px、字重 400、色调 secondary 均不变。provider 名继续 `font-family: inherit`
+ 600 + primary。两行现在同时由**字体族 + 字重 + 色调**三重区分。

**Rejected.**（1）硬编码 `monospace` 或自写字体栈：会脱离 Host 的字体选择，且中文回退
不可控。（2）provider 也改等宽：provider 是名称不是标识符，且会丢掉与设置页其余文本的
一致性（正是 DEC-039 撤回品牌字体的原因）。

**Consequences.** 模型名在等宽下比 UI 字体略宽，长名字会更早触发省略号——这是可接受的，
因为 `title` 属性仍带全名。render 测试钉住 code token、非 inherit、非硬编码栈，并断言
provider 与模型行的 `font-family` 必须不同。

## DEC-039 — 2026-11-17 — 撤回品牌字体：provider 行回到 UI 字体，只保留加粗

**Context.** DEC-038 给 provider 名换上 `--dsw-font-family-brand`（Montserrat）来和模型行
区分。用户实际看到后的反馈是「the provider font looks terrible」，要求「Keep the bold font,
use original font family」。

**Findings.**

- 品牌字体在这个位置读起来很差：Montserrat 是几何无衬线，和设置页其余全部 UI 文本
  （系统 UI 字体）并排时，字形宽度和 x-height 都不一致，一行标题夹在系统字体里像贴上去的。
- DEC-038 里「用字体族区分」这个判断本身没错，错在**换族**：换族会连带改变字宽、字高、
  数字形态，代价远大于它带来的区分度。

**Decision.** provider 名 `font-family: inherit`，`font-weight: 600`，去掉 `letter-spacing`。
区分只由**字重 + 色调 + 字号**承担。600 是 UI 字体真实存在的字重（不像品牌字体只到 500），
所以是真粗体，不是浏览器合成。

**Rejected.** 保留品牌字体但降字重：问题在字形本身，不在粗细。

**Consequences.** 这是对 DEC-038 的**撤回**，不是叠加：DEC-038 的字体族与字距一并作废。
render 测试改为钉住 `font-family: inherit`、`font-weight: 600`、无字距，并显式断言
**不得**出现 brand token / Montserrat / 硬编码字体栈，防止再漂回去。

## DEC-038 — 2026-11-17 — Provider 行改用品牌字体，靠字体本身而非字号区分

**Context.** 设置页「模型列表」里，provider 行和它下面的模型行几乎读成同一个东西：
14px 对 13px、主色对次色，差一档字号加一档色调，在一列长名单里根本不够。用户原话是
「almost look the same」，要的是**一眼**能看出哪一行是分组、哪一行是条目。

**Findings.**

- 只加大字号或加粗都不可行：14px 已经贴近设置页正文，再大就压过 `setTitle`；而
  `--dsw-font-family-brand` 指向 Montserrat，Host 只装了 300/400/500 三档，写 600/700
  会被浏览器合成假粗体，Retina 上发糊。
- Host 已经在用 `var(--dsw-font-family-brand)`（11 处），所以品牌字体是**已加载**的，
  不是新增网络请求。

**Decision.** provider 名改用 `var(--dsw-font-family-brand)`、`font-weight: 500`、
`letter-spacing: .04em`，并显式写 `color: var(--dsw-alias-label-primary)`；模型名反向
钉死 `font-family: inherit`、`font-weight: 400`、无字距、`label-secondary`。层级由
**字体族 + 字重 + 字距 + 色调** 四重承担，字号只保留原来的 14/13 差。

**Rejected.**（1）只把 provider 加粗到 600：假粗体。（2）只放大字号：压过设置页标题层级。
（3）只改颜色：色调差在长名单里几乎不可见，正是当前的问题。

**Consequences.** 两条规则各自显式声明字体族，模型行不再靠继承——否则 provider 换族后
模型行会跟着漂移。render 测试钉住字体 token、字重 500、字距、以及模型行的反向声明。

## DEC-037 — 2026-11-17 — 设置导航用定向 DOM 替换呈现列表图标

**Context.** 用户希望「模型列表」设置项使用列表图标。`settings.section` 注册契约只有
`id`、`order`、`label`，Host 按 section id 选择导航图标；`model-flatmap` 因无专属映射
显示默认齿轮。

**Findings.**

- `icon` 注册字段不会被设置壳层读取；借用内置 `models` id 会替换原生 Models 设置页。
- `dsh-remote-ssh` 已用 `MutationObserver` 按本地化导航标签替换默认 SVG；这一做法不依赖
  构建期 CSS 类名。

**Decision.** 只定位文本精确等于「模型列表」/“Model list”的导航按钮，将其 SVG 替换为
带唯一标记、`aria-hidden` 的列表图标。首次扫描处理已挂载的设置面板，观察器处理按需挂载、
React 重绘和语言切换；插件 effect dispose 时断开观察器。除此之外不读取或修改 Host DOM。

**Rejected.**（1）传入未支持的 `icon` 字段：设置壳层不会投影它。（2）复用 `models` id：
会替换原生设置页。（3）依赖构建期哈希 CSS 类名：Host 重构后会失效。

**Consequences.** 这是唯一的 Host DOM 交互例外，局限于设置导航中的一个 SVG；渲染测试覆盖
中英文标签、避免误改其他条目、以及 React 重绘后的图标恢复。

## DEC-036 — 2026-11-17 — 模型开关用偏青的品牌色，与 provider 开关区分

**Context.** 设置页展开一个 provider 后，父级开关和它下面每个模型的开关颜色完全相同，
一排模型看下去分不清哪一个是「管全部的」，哪些是「单个模型的例外」。DEC-035 之后
provider 开关有三种状态（实色 = 全开、淡色 = 混合、灰色 = 全关），再给模型开关一个
「更淡的品牌蓝」会和 mixed 态撞色。

**Decision.** provider 开关的全部状态都留在品牌蓝上；模型开关改用
`color-mix(in srgb, var(--dsw-alias-brand-primary) 50%, var(--dsw-alias-state-success-primary))`，
色相向青绿偏移一档。既能一眼和父级区分，又因为仍含有品牌色而读作同一套开关。

**Rejected.** 直接给模型开关上成功绿：语义变成「状态正常」，而这里只是显示偏好；
继续用更淡的品牌蓝：与 DEC-035 新增的 mixed 态（45% 品牌色 + 边框灰）几乎同色。

**Consequences.** 只新增 `.dshmf-switchModel[aria-checked="true"]` 一条规则，并给
`Switch` 加了可选的 `className` 入口；render 测试钉住「provider 开关不带额外 class、
模型开关带 `dshmf-switchModel`」。

## DEC-035 — 2026-11-17 — Provider 开关改成批量写，不是覆盖；旧记录自动折叠成逐模型键

**Context.** 用户反馈 DEC-034 的 provider 开关「没帮上忙」：关掉一个 provider 后，它下面的
模型开关**变灰且不可点**，于是「关掉有几十个模型的 provider，再只开想要的两三个」这个真正
有用的流程根本走不通。

**Findings.**

- 根因是语义选择，不是样式：DEC-034 把 provider 键当成**覆盖**（`modelIsVisible` 先看
  provider 键，命中就直接 `false`），并据此把子开关 `disabled`。覆盖的代价是子项**没有
  自己的发言权** —— 用户一旦关掉 provider，就只能整组重新打开，无法只留几个。
- 反过来，「provider 键 = 批量写」在记录层面与逐模型开关**同构**：批量关 = 写满该 provider
  下每个模型的键，批量开 = 清空它们。两者写的是同一批键，因此可以任意组合，记录里也不会
  出现「谁优先」的特殊情况。
- 但只改写入不改读取是不够的：旧记录里存的是**裸 provider id**，新语义下 UI 再也产生不出
  这种键，而它仍然会隐藏整个 provider —— 结果是模型开关显示为开、却关不掉。必须迁移。

**Decision.**

1. **`modelIsVisible` 只认逐模型键**；裸 provider 键降级为**读取兜底**（旧记录仍然生效，
   不会突然失效）。
2. **provider 开关 = 批量操作**：`setGroupVisible` 写/清该组每个模型的键，并**删掉**该
   provider 的裸键（否则旧键会继续压住整组，「开几个」看起来毫无反应）。
3. **模型开关永远可用**，不再 `disabled`；关掉的模型行变暗，但可点。
4. **provider 开关是三态**：`checked` = 全开，`mixed` = 部分开（`aria-checked="mixed"`，
   中间态拇指停在中间），全关时整行变暗并显示「全部关闭」。混合态从**模型状态派生**，
   provider 开关自己没有独立状态 —— 它是这组模型的一个视图 + 一个批量动作。
5. **旧记录自动迁移**：`migrateLegacyHidden` 在目录到达后把裸 provider 键展开成逐模型键，
   幂等；目录里查不到的 provider 键**原样保留**（可能是本 Host 已不再列出的 provider，
   猜它覆盖了哪些模型比留着更糟）。

**Rejected.**（1）保留覆盖语义、只把 `disabled` 去掉：子开关会显示「开」但实际无效，
是更糟的谎言。（2）provider 开关只作为「全选/全不选」快捷按钮、不显示状态：用户看不到
这一组当前是部分开还是全关。（3）给 provider 开关单独的 `providerHidden` 三态字段：
与「记录里只有隐藏项」的设计冲突，且引入第二个真相来源。

**Consequences.**

- `modelIsVisible` 语义反转；新增 `hiddenKeysForGroup`、`groupVisibility`、
  `setGroupVisible`（纯函数）、`sameKeys`、`migrateLegacyHidden`；store 新增
  `setGroupVisible` / `migrateLegacy`，并把持久化+通知收敛到一个 `commit`。
- `Switch` 支持 `mixed`，输出 `aria-checked="mixed"` 与 `data-mixed`。
- 文案：`hiddenCount` 由 `visibleCount` + `allOff` 取代。
- 测试 233 → 242，含「provider 关掉后模型开关仍可点」这条回归断言。

## DEC-034 — 2026-11-17 — Provider/模型可见性：设置页放在 `settings.section`，记录「隐藏了什么」，键用 route

**Context.** 用户反馈「面板里 provider 和模型太多了」，要求新增一个设置项：列出所有
provider 和模型，可以选择显示/隐藏一部分。

**Findings.**

- 客户端的模型目录有两个入口，差别很关键：
  - `modelDirectories.directoryFor(sessionId)` 是**按会话**的，`service.ts:67-91`
    在没有活动会话时直接抛错，而设置页没有会话；
  - `remote.session.modelCatalog()` 是**按 Host 世代**的全局目录，所有会话共用同一份
    （`catalog.ts:47-82` 把 `response.value.groups` 存进共享 store）。设置页该读这个。
- 它的返回**不是** `ModelCatalog`，而是 `RemoteResult<ModelCatalog>`，即
  `{ok:true,value}` / `{ok:false,error}`（`dsh-api-gateway/src/client/index.ts:458-465`
  构造信封；`types.ts:123-132` 明说「no consumer wraps a call to recover one」）。
  Host 侧签名写的 `Promise<ModelCatalog>` 是业务签名，不是客户端形状 —— 照它写会把
  `.groups` 读到 `undefined` 上。
- 设置面板有**自己的**扩展点 `settings.section`（`slot-catalog.ts:3803-3858`），
  kind `list`、注册项 `{id, order, label}`、owner props 只有 `{close}`。它是
  「每个注册一个设置页」，导航列里出现我们的标签。而 `plugins.bundle.config` 是
  **Plugin Manager 的 bundle 详情页**里的一节（`PluginManagerPage.tsx:819-825`），
  不是设置面板 —— 「我想看哪些模型」不属于「这个插件包怎么配」。
- 注册没有所有者白名单：`SlotCore.register` 只校验目标已声明、list 必须有 id、
  同 priority 下 id 不重复。第三方 bundle 的注册与内置的同权。

**Decision.**

1. **设置页挂在 `settings.section`**，`id: 'model-flatmap'`（自有 id：复用内置 id 会
   **替换**那个内置页），`order: 100` 排在最后。叶子节点，不声明 `children`。
2. **存「隐藏了什么」，不存「显示什么」。** 明天新装的插件带来的模型必须在没人重开
   设置的情况下自动出现，所以**没有记录 = 显示**。记录也因此很小：常见情况下是空的。
3. **键沿用 route key。** 模型用 `provider/model`（和余额删除线 `routeKeyOf` 完全同
   一个函数），provider 用裸 id。二者共用**一个**记录，所以 provider 开关和逐模型例外
   不可能对「谁后写」产生分歧。provider id 不含 `/`，route 一定含，因此两类键不会撞。
4. **provider 开关是父级开关，不是子项汇总**：provider 隐藏则其下全部隐藏，不管逐模型
   记录说什么；重新打开时那些例外原样回来（因为从来没被改写）。这让 provider 行是一个
   真正的控件，而不是一个需要猜的汇总。
5. **过滤放在唯一入口。** `visibleGroups` 在组件里 `state.groups` 之后、分组/搜索/列
   规划/触发器标签之前执行，下游拿到的就是唯一一份目录 —— 隐藏项无法从任何别的路径
   进入网格、搜索索引、分组标题或模型计数，不存在「第二处要记得过滤」。
6. **存储用 `localStorage`（`dshmf:hidden`）**，和 `dshmf:grouping` / `dshmf:mode`
   一致。设置页与面板同页，共享**一个** store 实例，所以在设置里拨动开关会立刻重渲
   已打开的面板，无需刷新。读写失败一律降级为「全部显示」——宁可丢记忆，不可丢模型。
7. **用户选择了「隐藏当前模型也照常隐藏，但触发器仍显示其名字」**。因此不拦截隐藏、
   也不强制保留当前行；触发器本来就直接读 `state.current` 的名字，不经过目录。

**Rejected.**（1）`plugins.bundle.config`：位置在 Plugin Manager 的包详情页，与
「模型列表」的语义不符。（2）`ctx.configForms` 写入插件配置：需要 Host 设置服务，
且会写进 profile 的插件配置；用户明确选择 `localStorage`。（3）只存「显示列表」：
新模型默认不出现，用户每装一个连接插件都要回来勾一次。（4）只做 provider 级开关：
粒度不够，用户要能关掉单个贵模型。（5）把过滤放在渲染循环里逐行判断：会漏掉搜索
索引和计数两条路径。

**Consequences.**

- 新增 `HIDDEN_KEY`、`readHidden`/`writeHidden`、`providerHiddenKey`/`modelHiddenKey`、
  `modelIsVisible`、`visibleGroups`、`createHiddenStore`、`ALL_VISIBLE`、
  `createCatalogStore`、`EMPTY_CATALOG`、`SettingsSection`、`Switch`，以及独立的
  `settingsDict` / `SETTINGS_NS`。
- 组件新增 `visibility` 这个 inject 面；`safeFace` 的降级脸也补上 `ALL_VISIBLE`，
  保持 hook 形状不变。
- 空状态多出一种：目录非空但全被隐藏时用 `empty.hidden`，并指向设置页，而不是
  误报「暂无可用模型」。
- 设置页字典必须**同时**声明 `provider.account`：`providerLabel` 会向当前字典要这个
  键，缺了就画出原始 key。
- `SETTINGS_NS` 与面板的 `NS` 一样**按世代重新铸造**：locale 注册表在 disposer 跑完
  后仍占着 namespace，同 id 重注册会抛错，禁用/启用一次就会丢文案。稳定 id 并不需要
  —— 设置外壳每次投影都重读 label thunk，不记 namespace 名。
- 测试 216 → 233。


## DEC-033 — 2026-11-15 — 链接按钮与切换按钮的间距：从 32px 压到 2px，靠分组而不是调 margin

**Context.** 用户反馈「和切换按钮的 gap/margin 太大了，要让 gap 极小」。

**Findings.**

- 表面上间距是我写的 `margin-right: 2px`，实际是 **32px**：页脚是 flex 行，
  `column-gap: 30px` 作用在**每个相邻 flex 子项之间**，而链接按钮和切换按钮当时是
  页脚的两个**独立子项**，于是那 30px 正好落在它们中间，再加上 2px 的 margin。
- 这 30px **不能为了这个按钮调小**：它的职责是分隔页脚的三个成员——推理等级组、
  团队协作行、尾部按钮组。把 `column-gap` 改成 2px 会把整个页脚的分组间距一起毁掉。
- 结论：**在按钮上怎么调 margin 都压不下去**，因为要压的是容器的 gap，不是按钮的
  margin。这是一个结构问题，不是数值问题。

**Decision.**

1. **把两个按钮收进一个容器 `.dshmf-actions`**，作为页脚的**一个**子项。
   这样 30px 只作用于这个容器**外侧**（它和左侧分组之间），容器内部的间距由它自己的
   `gap: 2px` 决定 —— **32px → 2px**，且页脚的分组间距一个像素没动。
2. **auto margin 从两个按钮上移到容器上**。`margin-left: auto` 属于「这一组靠右」，
   不属于任何单个按钮；留在按钮上会分裂自由空间、把两个按钮重新拉开——这正是旧写法
   需要 `.dshmf-linkBtn + .dshmf-modeBtn { margin-left: 0 }` 去补的坑。分组之后那条
   补丁规则**直接删掉**，因为它补的问题已经不存在了。
3. **2px 是刻意的「极小」**：两个按钮同为 22px 高、同 `radius-xs`，2px 让它们读起来是
   一个控件组，同时保留各自的 hover/focus 命中区互不重叠。
4. **切换按钮本身零改动**：`onClick`、`aria-pressed`、`disabled`、`aria-label`、文案
   全部原样，这次只动了它的**布局归属**（从页脚子项变成容器子项）。

**Rejected.**（1）把页脚 `column-gap` 从 30px 调小：会一并破坏推理等级组与团队协作行
之间的间距，那是另一个已定稿的视觉决策（DEC-016 的同一块布局）。（2）给两个按钮加
负 margin 去抵掉 gap：脆且不可读，换行时还会把右侧边缘拖出面板。
（3）用 `margin-right: 0` + 让切换按钮 `margin-left: 2px`：治标，30px 依旧在。

**Consequences.**

- 新增 `.dshmf-actions` 规则；`.dshmf-linkBtn` / `.dshmf-modeBtn` 都不再带任何横向
  margin；`.dshmf-linkBtn + .dshmf-modeBtn` 规则删除。
- 渲染树里页脚只剩 `reason` 与 `actions` 两个子项，`actions` 内含 `linkBtn`、`modeBtn`
  两个按钮（已实测确认）。
- 测试 215 → 216：原「两个按钮是页脚相邻子项」的断言**被新结构推翻**，改为断言
  「同属一个容器且图标在前、二者都不是页脚直接子项」，并新增按**数值**读 `gap`
  的断言（`2px` 且 `<= 2`），以及「页脚 30px 分组间距仍在、且够不到容器内部」的断言。
  这样「极小」是被测出来的，而不是注释里的一句话。

## DEC-032 — 2026-11-15 — 网页链接按钮：地址从 checkout 的 remote 推导，宿主半边读、浏览器半边开

**Context.** 用户要求在「展示方式切换按钮」（即页脚的 `默认样式` 按钮）左侧紧邻位置
新增一个「网页链接」图标按钮：点击时读取**当前代码仓库已配置的 GitHub remote**，
转成浏览器可访问的 GitHub 页面 URL，在新标签页打开；并明确两条红线——**不要硬编码
项目地址**，**不要改变现有「展示方式切换」按钮的功能**。

追问澄清时用户给了两点：目标 URL 是 `https://github.com/zuosus/dsh-model-flatmap`，
且当没有可用 remote 时就回退到它（原话 `hardcode: https://github.com/zuosus/dsh-model-flatmap`）。
这两点合起来是「地址优先从 remote 推导，remote 不可用时用本项目主页兜底」。

**Findings.**

- 浏览器半边**读不到 checkout**：客户端插件没有 fs、没有 subprocess。全库检索
  `@deepseek-ai/*` 后确认，宿主**没有任何**「返回当前仓库 remote / 仓库根」的服务或
  路由；`ctx.remote.workspace.follow()` 只给工作区**目录路径**，
  `repository.url` 只出现在 plugin-market 里描述**插件包自己**的元数据。
- 因此需要一个宿主→浏览器的通道。三条候选：(1) `ctx.webServer.register` 自建
  HTTP 路由，浏览器直接 `fetch`；(2) Typert Remote namespace；(3) boot global 注入。
- **(2) 走不通**：`@deepseek-ai/dsh-api-remotes` 的客户端装配是一张**构建期白名单**，
  新增 namespace 必须改 DSH 自身源码并重新生成 `./remote` 产物——用户安装的 bundle
  无法扩这张表。**(3) 不适用**：boot global 是页面加载时的静态值，而这个地址要随
  checkout 变化。**(1) 可行**，且本机 profile 里已有先例：
  `dsh-file-finder` 就是 `ctx.webServer.register` + 浏览器 `fetch('/dsh-file-finder/...')`，
  并用 `connection.requestRejection(req)` 过宿主的信任栅栏。
- `git remote -v` 会为每个 remote 打印 fetch/push **两行**，顺序**不保证**；
  `git remote get-url` 只给单个 remote。要「origin 优先 + 兜底任意可用 remote」，
  用 `git remote -v` 自己去重排序更直接。

**Decision.**

1. **宿主半边读 remote，浏览器半边只开标签页**。新增 `repo-url.js`：`git remote -v`
   → 按 `origin` / `upstream` / 其余排序 → 逐个 `githubPageUrl()` 转换 → 第一个可用的
   就是答案。地址**从不写死**：改名、换 owner、加 fork 都会自动跟随。
2. **只认 github.com，其它宿主一律拒绝而不是改写成 github.com**。把 GitLab 地址
   改写成 github.com 会打开**另一个仓库**，而界面上不会有任何提示说明目的地变了——
   那比打开兜底页更糟。非 GitHub remote 会被跳过，继续试下一个。
3. **兜底地址是唯一写死的常量，且只有它在所有 remote 都失败后才出现**。
   `FALLBACK_PROJECT_URL` 在 `repo-url.js` 顶部声明一次；浏览器半边因为不能 import
   宿主模块而**重复**一份，用两个测试分别钉住：一个比对 `package.json` 的
   `repository.url` / `homepage`，一个比对宿主与浏览器的两份常量。
4. **路由按请求解析，不在激活时缓存**。`/dsh-model-flatmap/project-link` 每次被请求
   都重新跑一遍解析：Host 运行期间新加的 remote 下一次点击就生效，而「此刻还不是仓库、
   等会儿才 `git init`」也能自己好起来。
5. **点击不等网络**。面板打开时就预取地址，正常点击拿着现成结果**同步** `window.open`
   ——`await` 之后再 `window.open` 是浏览器有权拦截的弹窗。只有抢在预取完成前的点击
   才走异步路径。真的被拦截时在 tooltip 里说明，而不是装作打开了。
6. **只有 `http(s)` 地址能进 `window.open`**。payload 里的 `javascript:`、`file:`、
   `data:` 一律丢弃改用兜底——这是把宿主返回的字符串当**数据**而不是当可信指令。
7. **路由过宿主自己的信任栅栏**：`connection.requestRejection(req)`，与
   `dsh-file-finder` 等自带路由的插件一致；该函数抛错时**fail closed**（403），
   不能因为栅栏答不上来就把路由敞开。没有 `webServer` 的组合就不注册，按钮走兜底。
8. **`margin-left: auto` 从模式按钮搬到链接按钮上**，两者成为**一个尾部对**：
   图标带 auto margin、模式按钮紧跟（`.dshmf-linkBtn + .dshmf-modeBtn { margin-left: 0 }`）。
   这样「紧邻」是结构性的，且面板变窄时这一对一起换行仍然靠右。模式按钮自身的
   外观、`aria-pressed` 语义、`disabled` 规则**一个字符都没动**。

**Rejected.**（1）用 Typert Remote namespace：需要改 DSH 自身的构建期装配白名单，
用户安装的 bundle 做不到。（2）在客户端写死 GitHub 地址：用户明确禁止，且 fork/改名
就会失效。（3）用 `/plugins/<id>/assets/*.json` 传地址：那条路由只服务 5 种图片扩展名，
`.json` 直接 404。（4）把非 GitHub remote 改写成 github.com：会打开错误的仓库且无提示。
（5）在没有 remote 时禁用按钮：用户明确要求这种情况下仍打开本项目主页，禁用会让
按钮看起来坏了。（6）点击时才发请求：`await` 后的 `window.open` 容易被弹窗拦截，
所以改为打开面板时预取。

**Consequences.**

- `index.js` 的 `inject` 仍为空数组：`webServer` / `connection` 都在调用时用
  `ctx.get` 惰性读取，缺失只是不注册路由，不会让插件加载失败。
- 新增 `repo-url.js` 已加入 `package.json` 的 `files`（未加 `exports`：它是内部模块，
  由 `index.js` 相对 import）。
- 测试从 176 增至 215：`test/repo-url.test.mjs` 24 项覆盖各种 remote 拼写、
  非 GitHub 拒绝、去重排序、兜底路径、两份常量一致性，以及宿主路由本身
  （JSON 应答、405、信任栅栏与 fail-closed、无 `webServer` / 无 `ctx.effect` /
  注册抛错都不影响插件加载）；`test/render.test.mjs` 新增 15 项覆盖位置
  （结构相邻 + 文档顺序）、非 toggle、预取/兜底/协议白名单/新标签页与
  `noopener,noreferrer`、CSS 配对规则与主题 token、双语词条与占位符一致性。
- **没有 `ctx.effect` 时仍然注册路由**：这是实现后自查发现的边界。最初写成
  `ctx.effect(() => register())`，在没有该生命周期助手的上下文里会**静默不注册**，
  按钮就永远走兜底。现在 `ctx.effect` 存在才挂 disposer，否则直接注册——
  **一条留下的路由比一个悄悄永远不工作的按钮便宜**。
- **tooltip 占位符名与填充名必须一致**：`link.openFrom` 最初写成 `{remote}` 而调用点
  填的是 `url`，结果是屏幕上直接显示 `{remote}`。字典测试看不出来（模板本身合法），
  所以补了一个把「模板声明的占位符」和「调用点填的名字」对上的测试。
- 已知边界：地址来自**插件自身所在 checkout**的 remote。profile 以 `link:` 安装时
  即本仓库；从 registry 装进 `node_modules` 时该目录通常不在任何仓库内，
  于是走兜底——这正是兜底存在的原因。


## DEC-031 — 2026-11-14 — DAU 统计：宿主半边每日匿名心跳，复用 dsh.zuos.us/api/e

**Context.** 用户要求「增加 DAU 统计功能」，并指向 `../dsh-decision-engine/` 的
`DECISIONS.md` / `api.day.app` 关键字。那边的做法（DEC-020 及其修订）是：插件端匿名心跳
→ Cloudflare Worker（`POST /api/e`）→ D1 → 每天 Bark 推送。用户明确要求本插件沿用同一套
后端，不要另建一份。

**Findings.**

- 采集端在 `dsh-decision-engine/site/make-bundle.mjs`：`MAX_BODY=2048`、
  `PLUGIN_RE=/^[a-z0-9][a-z0-9._-]{0,47}$/`、`UUIDV4` 校验、`v!==1` 拒绝、
  `k` 只接受 `install`/`heartbeat`。**`p` 字段（插件标识）是第一等维度**，五张明细表的
  主键都含 `plugin`。因此本插件只需上报 `p=dsh-model-flatmap`，**Worker 一行都不用改**，
  第二天的日报就会自动多出一条（`scheduled()` 用 `SELECT DISTINCT plugin` 读清单）。
- 推送在 Worker 的 `scheduled()` 里做，`cron 42 10 * * *`（= 18:42 Asia/Shanghai），
  Bark 走 `GET https://api.day.app/<key>/<title>/<body>`。这套东西全部在 decision-engine
  仓库里，本插件不需要碰。
- 实测端点（本机、2026-11-14）：
  `POST https://dsh.zuos.us/api/e` 成功返回 `202 {"ok":true,"day":"…","plugin":"…"}`，
  **单次往返 4.6–6.9 秒**（该站点的 TTFB 本身就按秒计）。直接拿 `fetch` 测了 6 次，
  其中 2 次在 6.8–10.0 秒处 `fetch failed`——这条链路的尾延迟就是这么大。
- `AbortController` 的超时是**整条交换**的预算（headers 之后才 resolve），不是只卡 TTFB，
  所以短预算无法靠别处补偿。

**Decision.**

1. **只做每日心跳**（用户在两选一里点的这一项）：装机、DAU、活跃版本由心跳供给。
   「当日决策数」这类业务计数不做——本插件没有可数的业务事件，硬凑一个等于往统计里
   填噪声。
2. **宿主半边发，客户端不发**。原因是两边口径不同：`client.js` 只在浏览器里跑，
   一个从不重载的标签页永远不上报；`index.js` 每次启动跑一次，正好是「这台机器今天
   有没有在用」的正确采样点。心跳因此写在 `index.js` 的 `apply()` 里，`void` 掉。
3. **新建 `telemetry.js`，不 import 兄弟插件的实现**。仓库的既有约束是零运行时依赖
   （连宿主的 peer 包都是复刻行为而不是引入），跨仓库 import 更会让两个包的版本绑死。
   复用的是**协议**（`v`/`p`/`id`/`k`/`ver`/`os`/`arch`）与**日界算法**（固定 UTC+8），
   不是代码。
4. **没有 `level` 开关，也没有配置文件**。用户明确要求「默认 daily，不允许 off，
   因为本插件没有设置页面」。这比兄弟插件更硬：那边至少还有一个 `config.yml`。
   判断是——**一个没人能点到的开关不构成同意，只构成伪装的默认值**；真正约束这次
   上报的是它的形状（七个字段、无自由文本、无会话内容）与频率（每台机器每天至多一次）。
   想彻底关掉，就停用 bundle，心跳随 UI 一起停。
5. **状态写在 `~/.dsh/dsh-model-flatmap/analytics.json`，0600**。家目录解析复刻宿主的
   三条规则：显式配置 > `$DSH_HOME` > `~/.dsh`；空白值当作没设；`~` 展开；结果
   `resolve` 成绝对路径（相对路径会让状态文件随进程工作目录漂移）。
   文件名**不叫** `telemetry.json`：兄弟插件用那个名字存本地决策流水账，两个只差一个
   字母、口径完全不同的文件放在一起，迟早被清缓存的人删错。
6. **「一天」固定按 UTC+8 算**：中国自 1991 年无夏令时，`(ms + 8h)` 取日历日就是当地
   日期，不需要 Intl / 时区数据库（Electron 里还取决于 ICU 打包方式）。Worker 用同一
   算法，两端对日一致。
7. **请求预算 10 秒**，不是 5 秒。这是本次唯一的「与兄弟插件不同」的参数，依据是上面
   的实测：5 秒会掐掉大约一半本来能送达的心跳，而失败在统计里与「用户离线」无法区分
   ——**一个会把成功伪装成缺席的预算，比一个略长的等待更糟**。
8. **先落状态再发送，且落盘失败就不发**。前者保证「进程在请求中途被杀」不会变成每天
   反复重报；后者是一条实测换来的边界：状态写不下去（只读 profile）时若照发，每次启动
   都会报一次，直接违反「每天至多一次」并抬高 DAU。丢一次心跳比刷高一次 DAU 便宜。
9. **失败计数到 30 次就永久降级**，与兄弟插件同阈值：一个一个月都连不上的端点，今天
   也不会连上，而每次启动都发一个注定失败的请求纯属噪声。
10. **进程活着跨过午夜还要再报一次**（`RECHECK_MS = 6h` 的 `unref` 定时器）。
    「启动时报一次」在桌面端的常态用法下会少算一天：昨晚 21:00 打开、一直没关的窗口，
    今天仍然开机在用，但它只报过昨天那一条——**这种少算在报表里与「用户不再用了」
    长得一模一样**。重新检查的代价接近零：`lastAttemptDay` 在本地文件里就能回答
    「今天报过了吗」，所以一天里只有跨零点后的第一次检查会真正出网。定时器 `unref`
    掉，绝不成为进程不退出的理由；disposer 挂在 `ctx.effect` 上，停用插件时一起清掉。

**Rejected.**（1）在 `client.js` 里计数并通过一条宿主路由落盘再随心跳上报：用户已否，
且它把一条纯 `void` 的旁路变成客户端→宿主的额外往返。（2）`import` 兄弟插件的
`lib/telemetry.js`：跨仓库依赖会让两个包的发布互相绑死，还违背零依赖约束。
（3）给个 `telemetryLevel: off` 配置项：没有设置页，用户改不到，等于没开。
（4）复用 `cordis.patch.yml` 的 config 段做「隐式开关」：那是一个只有翻源码才知道的
开关，比没有更糟。（5）把 `d`（决策数）硬凑成「面板打开次数」：客户端才知道的数，
而客户端不上报，最后只能填 0 或猜。

**Consequences.**

- Worker、D1、迁移、Bark 全部零改动；上线后第二天 18:42 的推送里就会出现一条
  `dsh-model-flatmap 近24小时`。**但推送正文里的「决策 / 人均」两行对这条统计线会恒为
  0**，因为本插件不上报 `d`。这是第 1 条决定的直接代价，已知并接受；若要它有意义，
  就得回到被否掉的方案（1）。
- `index.js` 从「运行时不提供任何能力」变成「只做一次心跳」。README / DETAIL 里那句
  「contributes nothing at runtime」因此改成准确表述——**文档说的是它做过什么，不是
  它原则上不做什么**。
- 任何一台机器删掉 `analytics.json` 都会被算成一次新的安装。这是「匿名、无账号」的
  必然代价，兄弟插件同样如此。

**测试**：`test/telemetry.test.mjs` 18 项——UTC+8 日界（含跨 UTC 零点）、UUIDv4 校验、
状态往返与损坏自愈、`decideKind` 真值表、上报体字段白名单（含 `prompt|key|token|path|
cwd|url|user|ip|session|email|model` 禁令）、插件 id / 端点兜底、新装→次日心跳、
同日不重发、无合法 `p` 不发且不建状态文件、失败不抛错且当天不重试、30 次后降级、
状态目录不可写时不发、`fetch` 缺失不崩、请求形态（POST / JSON / 带 abort signal）、
家目录三条规则、`apply()` 同步返回且不 await、重检定时器（存在、`unref`、同日不重发、
disposer 会 `clearInterval`）。全量 176 项通过。

**改动文件**：`telemetry.js`（新增）、`index.js`、`test/telemetry.test.mjs`（新增）、
`README.md`、`README.zh.md`、`docs/DETAIL.md`。


## DEC-030 — 2026-11-14 — trigger 的模型名不自己画：渲染 label 槽的胜出组件

**Context.** 用户报告：composer 的 model picker trigger 显示的内容在原生时和使用本插件时
不一致，原生的更丰富——原生会显示 tag（如 `夜间折扣`），甚至还能显示表示是否忙碌的小人图标。
用户明确选择「渲染 label 槽的胜出组件，求完全一致」，而不是只补 catalog 的 `model.badge`。

**Findings.** 读本机安装的 `dsh-client-ui-model-selection`（0.2.2-rc.3）与两个连接器插件：

- 出厂 `ModelSelect` 的 trigger **不画字符串**：它调用
  `renderSlot('conversation.input.model.label', {provider, model, placement:'trigger', selected},
  { fallback: name + <Tag> })`。所以「原生更丰富」来自这个槽的**胜出组件**。
- 该槽是 `single`、session 级、`inline: true`，由**出厂 `ModelSelect` 条目**声明
  （`children: {'conversation.input.model.label': …, 'conversation.input.model.options': …}`）。
  本插件用负优先级遮蔽这个座位，但**从不 dispose 它**，所以声明一直活着——这正是
  `readLabelEntry` 能读到胜出者的原因。
- 本机胜出者链：workbuddy `-105` > trae `-102` > 出厂 1017 `0`。workbuddy 的
  `WorkBuddyModelLabelInner` 自己画倍率、促销 chip、`busyIcon(level)`（一/二/三个人排队，
  idle 时是火箭）和「新」标记。**小人图标不在 catalog 里**——workbuddy 明确把 load level
  留在自己的组件内（「a stale 🚦 is worse than no 🚦」），所以只有渲染组件才拿得到。
- `SlotRegistry` 公开 `entriesOfSlot(key)`（每格胜出者，outlet 用的同一个访问器）、
  `subscribe(key, fn)` 与 `getVersion(key)`（文档化的 uSES 配对）。
- 用真实 `SlotCore` 跑过模拟：遮蔽条目注册后，label 槽的声明仍在、胜出者仍是 workbuddy；
  连本插件 dispose（原生模式让位）之后也仍在。

**Decision.** trigger 不再自己拼名字，而是**渲染 label 槽的胜出组件**：

1. 用 `slots.entriesOfSlot('conversation.input.model.label')[0]` 读胜出条目（要
   `component` 是函数）。
2. 自己合成它需要的座位：`t` 由 `entry.locale` 经 `locale.bind(ns)` 绑定；业务面由
   `entry.inject(sessionId)` 得到（session 级条目按渲染器契约收 sessionId）；owner props
   是出厂那份 `{provider, model, placement:'trigger', selected:true}`。
3. 外面套 `LabelBoundary`（**不复用 `SeatBoundary`**）：占用者是第三方组件，在没有渲染器
   自带 per-entry 边界的情况下运行，它崩掉只能损失装饰，绝不能损失座位。fallback 是
   `undefined`，于是调用方退回到 catalog 名字。
4. 没有占用者时走 `triggerFallbackLabel()`：**复刻**出厂 fallback（名字 + `model.badge`
   的 `Tag`，trigger 上 badge 在前）。这一条即使有占用者也必须留着——占用者若不为别家
   provider 复刻 `model.badge`，或干脆没有占用者，促销标记才不会丢。
5. 用 `slots.subscribe` + `getVersion` 订阅该槽，连接器插件在 boot 之后才注册也能立刻上屏，
   不需要刷新页面。

**Rejected.**（1）只补 `model.badge`：拿不到小人图标，用户已明确否掉。（2）在 trigger 上
**声明**这个子槽再 `renderSlot`：`SlotCore.register` 对已声明的子槽直接抛
`already declared (by an entry in "conversation.input.model")`——cbca481 就是这么被
revert 的（见 a4c9c6a）。（3）import 出厂 `ModelSelect`：包不导出组件。

**Consequences.** 这条推翻 DEC-027 里「不搬运宿主组件」的口径的**一小部分**：座位仍然
靠让位（DEC-027 不变），但 trigger 的 label 现在确实渲染另一个插件的组件。代价与边界：

- 占用者是第三方代码，它的 props 契约来自 `ModelLabelOwner`（文档化），但**不保证**它在
  所有宿主版本上都兼容。`LabelBoundary` + 退回 catalog 名字是这条路的兜底，也是它和
  「让位」在健壮性上的真实差距。
- 占用者若自己读 DOM/发请求（workbuddy 就会 fetch usage），trigger 上会多一次它的请求；
  这是它本来的行为，不是这里引入的。
- 原生模式（DEC-027）下本插件的座位被 dispose，宿主自己渲染 trigger，走的仍是同一个槽，
  所以两种模式的 trigger 现在**同源**——这正是用户要的一致。


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
