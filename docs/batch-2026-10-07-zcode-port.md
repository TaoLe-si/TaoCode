# 批次报告 · ZCode 设置全量移植 + Agent 面板接线（2026-10-07）

> 用户需求（2026-10-07，承接 `docs/batch-2026-10-07-agent.md`）：
> 「项目已经由其他 agent 推进了，阅读交接文档，然后把 ZCode 的功能全量移植进入，包括设置以及其他逻辑」。
>
> 上一批留下的现场：右栏 Agent 对话窗口已接通（纯逻辑 9 模块 + 子代理 2 模块），
> 但**设置页 16 节里有 9 节还是「诚实空态」**，会话库/斜杠命令**没接进面板**，
> 对话流在 untitled 工作区上会卡死，而且**上一批没跑全量测试**（门禁只报了 vue-tsc 与 module-size）。

## 一、先清账：上一批留下的 24 条红

交接件 §二写的是「vue-tsc 0 错、module-size 5/5」，但那两条之外**没跑过全量**。
本批开工先取基线：**7581 通过 / 24 失败**（14 个文件）。逐条归因后全部处理，其中
**5 条是真缺陷，19 条是判据钉死了旧形状**。

### 5 条真缺陷（不是测试的问题）

| # | 症状 | 根因 | 处置 |
|---|---|---|---|
| 1 | 工具窗口条上的 Agent 图标是 lucide 机器人 | 上一批用 `Bot` 注册 `agent` 窗口，违反「工具窗口条图标只走 IDEA expui 副本」 | 换成上游 `AllIcons.ToolWindowAskAI`（`AllIcons.java:1494`），走 `scripts/gen-idea-icons.mjs` 重新生成，`toolWindowMeta.ts` 不再 import lucide |
| 2 | 「恢复默认布局后条纹顺序 = 默认顺序」这条不变量不成立 | `DEFAULT_TOOL_ORDER` 只按注册表顺序过滤，**没排 side tool**；条纹渲染的第一判据却是 `isSplit`（`AbstractDroppableStripe.kt:59-62`「side buttons in the end」）⇒ 两张"默认顺序"互相矛盾 | `DEFAULT_TOOL_ORDER` 现在**按画出来的样子**派生（同分组规则）。分组是稳定的，对已分组列表再跑一次结果不变 |
| 3 | `projectTreeModel.refresh()` 在无 DOM 环境抛 `ReferenceError` | 直接摸 `document.activeElement` | 判一下 `typeof document !== 'undefined'`。浏览器里行为不变，无 DOM 环境不再整条链崩 |
| 4 | bundled `fileIconProvider` 两支在判据里长期是红的 | 那两行 `registerFileIconProvider` 落在 `createWorkspaceLifecycle()` **工厂体内**（该文件工厂体不缩进，看不出来）⇒ 只有真起过宿主的进程里才有 | 提到模块加载时登记，与 `customFoldingProviders.ts` / `environmentKeyProviders.ts` 同一纪律 |
| 5 | `RunConsole` 暂停钮、FileTree 撤销两处判据红了 | 代码其实比判据**更正确**（走了 EP `consolePauseStateProvider`、走了 `com.intellij.undoProvider` 链），判据钉死了中间那一层 | 改判据守**意图**（那颗钮确实带 aria-pressed / 撤销确实经 undoProvider 链），不锁死间接层 |

### 19 条判据形状

`idea-icons`（2）· `tool-layout-state`（5）· `tool-window-stripes`（2）· `tool-stripe-split`（1）
· `tool-window-registry`（1）· `menu-check-icon`（1）· `ui-icons`（1）· `wiring-closeout`（1）
· `pv-command-wiring`（1）· `search-everywhere`（5）· `run-filters`（1）· `toggle-aria-state`（1）
· `ep-component-mount`（2）

其中三类值得记：

- **Agent 面板与设置页的相对导入带了 `.ts` 扩展**（`'../uiIcons.ts'`），与全仓 `.vue` 的约定相反，
  而且 `tests/ui-icons.test.mjs` 的「用了 iconSize 必须真的 import 它」那条正则要求路径以 `uiIcons` 结尾
  ⇒ 两个新文件直接判红。已统一成无扩展（`.vue` 组件导入仍带 `.vue`）。
- **斜杠命令菜单用了 lucide 的 `Check`** —— 全仓门禁规定勾选记号只走 `IdeaCheckedIcon`。已换。
- **`commandSearch.ts` 新增了 `ideShellExtensionPoints` 依赖**，但 `tests/search-everywhere.test.mjs`
  的桩加载器还在"任何依赖都抛"。那条依赖是**真逻辑**（`GotoAction` 的别名/同义词匹配档），
  拿桩顶就等于在测假行为 ⇒ 改成把生产的那份链加载进来。

## 二、设置页：从 9 节空态到 16 节全部有落点

### 分工

四个 lane 各交付**纯逻辑模块 + 判据**（不碰 Vue），主代理亲手接界面。这样切分是因为：
纯逻辑模块能被 `node --test` 直接断言，而 Vue 组件的接线判据只能扫源码锚点 —— 两者混在一起写，
一半的判据会退化成"字符串匹配"。

| Lane | 模块 | 行数 | 判据 |
|---|---|---|---|
| A | `src/agentMemoryFiles.ts`（记忆）+ `src/agentSearchScope.ts`（工作区搜索范围） | 343 + 518 | 37 条 |
| B | `src/agentHooks.ts`（钩子）+ `src/agentAutomations.ts`（自动化） | — + 705 | 36 条 |
| C | `src/agentMcpServers.ts`（MCP）+ `src/agentSkills.ts`（技能） | 599 + 414 | 43 条 |
| D | `src/agentSubagents.ts`（子智能体）+ `src/agentPlugins.ts`（插件）+ `src/agentComputerUse.ts`（浏览器/电脑控制可用性） | — | — |

**每节一块**「模块 → 自己的 `.vue` 组件」；组件之间共用
`src/components/agent-settings/AgentSettingsSectionShell.vue`（说明 + 控制项状态表 + 缺口文案）。
外壳存在的理由：那三段话（这一节是什么 / 哪些真接上了 / 缺什么）在 16 个 `.vue` 里各写一遍一定会漂。

### 三档状态是这一批唯一的产品承诺

`AgentSettingsSectionShell` 把每个控制项分成三档，**只有前两档能渲染成控件**：

- `wired` —— 真控件，点下去确实改变行为；
- `config-only` —— 真控件 **+ 一句「尚未接入执行路径」**。存得住、读得出，但还没有消费方；
  渲染成开关却不标这一句，就是**放假控件**（用户会以为已经生效）；
- `gap` —— **不渲染成任何控件**，只显示缺口说明。

各节模块自己判（判据钉在 `tests/agent-*.test.mjs` 里），外壳只负责诚实地渲染出来。

### 页面本身的收窄

`AgentSettingsPage.vue` 的职责收到「节导航 + Agent 总设置（常规 / 模型设置）」：

- 九节各有组件后，那段 `v-else` 兜底空态**删掉了** —— 留着就等于「万一有新节位进来就显示一段假说明」；
- 保存按钮的可见范围收窄到 `general` / `modelProvider` 两节（`tests/agent-settings-page-dispatch.test.mjs` 钉住），
  否则点一次「保存」会把别节的字段一起覆盖。

判据 `tests/agent-settings-page-dispatch.test.mjs`：16 节的 id 与中文标题逐条对齐 ZCode 的
`BASE_SETTINGS_SECTIONS`、三组顺序、每节都有出口、没有一节落到兜底里、九个组件文件真的存在。

## 三、面板：会话库 + 斜杠命令接进去了（交接件 §四.2）

模块（`agentSessions.ts` 23 条判据 / `agentCommands.ts` 10 条判据）上一批就交付了，
但面板没消费它们 —— 那是两份死代码。本批接上：

- **会话库**：头部一个会话按钮 + 弹层（切换 / 新建 / 删除）；每轮对话后自动存档；
  切场时先把当前这场存回去、再把目标那场的转写装回活会话。
- **斜杠命令**：输入以 `/` 开头就不发给模型（`//` 开头的按普通文本走 —— 用户在打路径）；
  Tab 补全；七条真命令全部有派发出口。**认不出来的命令不吞输入** —— 原样按普通文本发出去。
- **`/只看待决`** 真接到改动列表的过滤上，不是只弹一句提示。

### 为此给会话状态机补了两个出口

`clear()` 与 `restore()`（`src/agentSession.ts`），三条口径写进接口注释并有判据：

1. **清空必须把轮数归零** —— 假模型按 `turnCount` 决定「第一轮只读、后面才写」
   （`src/agent.ts:157-159`），留着旧轮数会让「清空后再发一条」直接进写模式。
2. **恢复时历史调用绝不重新执行** —— `transcript()` 记的「已批准」只写进 `decidedApproved`
   （让导出如实说出当时处置），**不进 `approved`**（那是被 `drainApproved()` 取走真去写盘的队列）。
   把历史灌进去等于切回一场旧对话就把当初的改动再写一遍。
3. **历史调用的 id 取负数** —— 假模型的 id 是 `轮次 * 2`（正数），恢复后轮数接着往后走，
   沿用正数就会与将来某一轮撞上，撞上会让 `transcript()` 把一条全新的调用误报成「早就批准过」。

## 四、对话流卡死：给宿主文件桥加时限（交接件 §四.1）

现象：untitled 示例项目上发一条消息，`busy` 永久卡 true、`messages` 停在 0 ——
一次 `await file.read` 不返回，审批门之后每一段都在等它。

`src/agentBridgeTimeout.ts`（纯模块 + 6 条判据，`tests/agent-bridge-timeout.test.mjs`）：
`file.read` / 取 version 的那次 `file.read` / `file.write` 三处都过时限，
到点**按「读不到」收场而不是抛**（面板继续往下走，工具结果里如实写着），并 `console.warn` 一次。
只给读加、写那条挂起同样会锁住「保留」那颗钮，所以三处都加。

## 五、ZCode 常规节里两个「只存不用」的开关

| 开关 | 原状态 | 现在 |
|---|---|---|
| `messageStreamShowTodos` | 存进设置，没人读 | **面板读它**：关掉时不渲染那条待办清单 |
| `messageStreamShowReasoning` | 存进设置，没人读 | 仍是只存 —— 但设置页**新增了诚实提示**：本仓当前是确定性本地假模型，不产思考流，真实联网模型接上前没有东西可显示 |

`taskAutoArchive*`（自动归档）**已接**（本轮后半段补上，详见 §六.3）：会话库一打开就按天扫一遍，
当前那一场永不归档、阈值不合法一步不动。没有定时器 —— 真做成后台常驻任务就得回答
「关掉窗口时那次扫描还算不算」，那一档登记在遗留清单里。

## 六、门禁（收工实测）

| 门禁 | 结果 |
|---|---|
| `node --test tests/*.test.mjs`（全量） | **7843 通过 / 0 失败**（开工基线是 7581 通过 / 24 失败） |
| `npx vue-tsc -b --force` | **0 错**（必须带 `--force`；不带是增量构建会给假阴性） |
| `node --test tests/module-size.test.mjs` | **5/5** |
| **ctest（native，42 条）** | **42/42**（开工时 `http_client_contract` 红，见 §六.1） |
| Agent 域判据（`tests/agent-*.test.mjs`） | **345/345** |
| 设置分节 3 份 + 派发 + 三档表 | **51/51** |
| `npx vite build` | ✓ |
| `.tools/find-missing-ext` | 仅既有 `src/dapEventRelay.ts:19`（他人在制品，非本批） |
| `.tools/find-ts-in-mjs` · `find-param-props` | 干净 · 0 处 |
| `.tools/find-orphan-modules.mjs --gate` | 本批新增模块**全部有生产消费方**；门禁仍红 **8 个**，全是 10-06 中止 lane 的遗留（见 §七） |

### 六.1 桃报的「exe 还是旧图标」：根因是 ICO 编码，不是缓存

用户原话：「构建好的exe显示的还是旧的应用图标而不是我设计的花体字母T」，
后来补的一条更准：「大图标、中图标都是花体，只有详细信息图标仍然是正常的T，
疑似花体T缺少分辨率，旧的T顶替了」。

**先说一次走错的判断**：我最初查完 PE 资源、逐档导出图片、确认七档全是花体 T 之后，
给的结论是「文件是对的，是资源管理器没刷新，按 F5 即可」。**那是错的** —— 用户按 F5 无效。
真正的原因在**图标编码格式**上，源文件与 PE 结构都看不出来。

**真因**：`scripts/gen-app-icon.mjs` 的 `buildIco()` 把**七档全部写成 PNG**。
而 Windows **只允许 256×256 那一档用 PNG 压缩**，256 以下必须是未压缩的 DIB
（`BITMAPINFOHEADER` + 底向上的 XOR 位图 + AND 掩码）。GDI 的图标装载器解不了小尺寸的 PNG，
于是整张图标组被判成不可用 —— 表现正是用户看到的那样：**尺寸大的档还能糊弄出一张，
某一档直接退回成系统默认那张普通 T**。

**判据里那条错误的断言把它固化了**：`tests/app-icon.test.mjs` 原来逐档断言
`assert.deepEqual([...png.subarray(0,8)], [0x89,0x50,0x4e,0x47,...])` ——
**「第 i 档是 PNG」**，把一个 Windows 的硬要求写成了本仓的规矩。

**修法**（`scripts/gen-app-icon.mjs` 新增 `encodeDib()`）：

```js
data: size >= 256 ? encodePng(...) : encodeDib(...)
```

DIB 的三处细节都在注释里写清了：`biHeight` 写**两倍**（XOR 在上 AND 在下，ICO 的 DIB 约定）、
AND 掩码每行按 4 字节对齐且不能省、像素要 BGRA 且**自下而上**。

**怎么证它修对了**（两条互相独立的证据）：

1. `Icon(path, size, size)` 让 GDI **按尺寸去挑**组里的那一档 ——
   修之前 32px 那一档读出来是**噪声**（GDI 解不了 PNG）；修之后 16/24/32/48/64/128
   **每一档都精确命中自己的尺寸**，且图像都是花体 T。
2. 产物 exe 的 `RT_GROUP_ICON` 七档字节数与新 `.ico` 逐档相等，DIB 那六档的头是 `BITMAPINFOHEADER`。

**顺带把构建链上第二个坑也焊死了**：`.rc` 里写的是 `ICON "app-icon.ico"`，而那个 `.ico`
由生成器产出、**不在任何源文件列表里** ⇒ CMake 不知道这条隐式依赖，改完图重新生成 `.ico`
之后 ninja 看 `.rc` 没动就**不重跑 rc.exe**，链接出来的 exe 继续嵌旧图标。上一批的绕过办法
是手工 `touch native/app-icon.rc`，那是治标。现在：

```cmake
set_source_files_properties(native/app-icon.rc PROPERTIES OBJECT_DEPENDS "${CMAKE_SOURCE_DIR}/native/app-icon.ico")
```

实测：只碰 `.ico` 不碰 `.rc`，ninja 会 `[1/2] Building RC object … [2/2] Linking`。

**两个新判据都做过变异测试**：去掉 `OBJECT_DEPENDS` → 转红；把 `buildIco` 改回七档全 PNG
→ 「第 i 档是 PNG」那条与新增的「256 以下必须 DIB」那���**同时**转红。

#### 这一节留了三个取证脚本（`.tools/`，不改产品行为）

| 脚本 | 回答什么 | 踩过的坑 |
|---|---|---|
| `verify-exe-icon.mjs` | `.ico` 每档的载荷有没有进产物 | 载荷全在 ≠ 组登记对了 |
| `read-pe-group-icon.mjs` | `RT_GROUP_ICON` 登记几档、指向哪个 `RT_ICON`；可带 outDir 逐档导出 | **PE 资源树里的偏移是相对 `.rsrc` 节起点的**，不是文件绝对偏移也不是 RVA（只有叶子的 DataRVA 才是 RVA）——走错基准会得到 `va is not defined` 之类的怪错 |
| `shell-icon.mjs` / `read-ico-by-size.ps1` / `enum-exe-icons.ps1` | 系统/GDI 到底读出什么 | `SHGetFileInfo` 没有「取 48px」这个口（`SHGFI_LARGEICON` 是 **0**，0x2/0x4 不存在）；`ExtractIconEx` 返回的是**图标组个数**（本仓一直是 1），**不是档数** —— 拿它当「一共就一枚图标」的证据会误判 |

**教训**：图标这类资源问题，源文件与 PE 结构都查不出来，**只有让 GDI 按尺寸去读**才看得见；
而 GDI 读出来的和 PE 里登记的可以完全对不上（本次就是：登记七档、GDI 一档都挑不出来）。

### 六.2 `http_client_contract`：判据的前提错了，不是产品错

ctest 里唯一那条红（开工时）查下来是**测试的前提不成立**：它用 `.invalid`（RFC 2606 保留域名）
「永不解析」来制造连接失败，但 `http_get` 用的是 `WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY` ——
**机器上开着系统代理时请求会走代理，代理对任何 URL 都回一个错误响应**（本机实测 502）。
于是判据在直连机器上绿、在开着代理的机器上红，而它绿红都不是在测我们的代码。

产品的口径本身自洽且没改：`available` 的意思是「拿到了 HTTP 响应」，成败码在 `status` 里
（所以 502 → `available:true` + `status:502` 是对的，调用方才分得清 200 与 502）。
判据改成钉**与环境无关的那条不变量**：`available==false` ⇒ 带 reason 且不带 content；
`available==true` ⇒ 必须带数字 `status`。两种都算「诚实」，唯独「`available=true` 却没有
`status`」才是假成功。改完 42/42 全绿。

### 六.3 自动归档：两个开关从「只存不用」变成真动作

`taskAutoArchiveEnabled` / `taskAutoArchiveOlderThanDays` 此前只存不读。新增
`archiveStaleSessions(store, olderThanDays, now)`（`src/agentSessions.ts`），面板挂上时跑一次。

口径与上游**有意**不同并写进了注释：ZCode 归档的是「超期的**已完成**会话」，而本仓的会话就是
消息流 + 台账、**没有「完成」这个状态** ⇒ 只按「多少天没动过」判。三条护栏各有判据：
**当前那一场永不归档**、**阈值不合法一步不动**（非有限数 / ≤0 / >365 —— 算错的阈值把整库清空
比不归档糟得多）、时间戳坏掉的记录不动它。

**没做定时器**：这一格的口径是「会话库一打开就扫一遍」，不是后台常驻任务 ——
真做成定时器就得回答「关掉窗口时那次扫描还算不算」，那是另一件事，登记在遗留清单里。

### 保留文件余量（口径 `split('\n').length`，末尾换行也算一行）：
`src/App.vue` **2680/2680 = 0** ｜ `src/components/SettingsDialog.vue` **1182/1182 = 0**
（本批**没碰**这两个贴顶文件）｜ `src/components/AgentPanel.vue` **660/900** ｜
`src/components/AgentSettingsPage.vue` **326/900** ｜ 十个分节组件 79–300 行。

### 本批改动文件清单

**新建 · 纯逻辑模块（10）**：`src/agentSettingsStore.ts`（十节共用的存储面）·
`src/agentMemoryFiles.ts` · `src/agentSearchScope.ts` · `src/agentHooks.ts` · `src/agentAutomations.ts` ·
`src/agentMcpServers.ts` · `src/agentSkills.ts` · `src/agentSubagents.ts` · `src/agentPlugins.ts` ·
`src/agentComputerUse.ts` · `src/agentBridgeTimeout.ts`

**新建 · 界面（11）**：`src/components/agent-settings/` 下 `AgentSettingsSectionShell.vue`
与十个分节组件（记忆 / 搜索范围 / 钩子 / 自动化 / MCP / 技能 / 子智能体 / 插件 / 浏览器 / 电脑控制）

**新建 · 判据（7）**：`tests/agent-memory-files` · `agent-search-scope` · `agent-hooks` ·
`agent-automations` · `agent-mcp-servers` · `agent-skills` · `agent-subagents` · `agent-plugins` ·
`agent-computer-use` · `agent-controls-status` · `agent-panel-wiring` ·
`agent-settings-page-dispatch` · `agent-settings-sections-a/b/c`

**修改**：`src/toolWindowMeta.ts`（Agent 图标 + 默认顺序派生）· `src/components/icons/index.ts`（`agent → askAI`）·
`src/components/icons/toolWindowIcons.ts` · `scripts/gen-idea-icons.mjs`（新增 AskAI 两档）·
`src/components/icons/ideaIconData.ts`（生成物）· `src/workspaceLifecycle.ts`（EP 登记提到模块加载时）·
`src/projectTreeModel.ts`（无 DOM 守卫）· `src/agentSession.ts`（`clear` / `restore`）·
`src/agentHostWire.ts`（三处时限）· `src/components/AgentPanel.vue`（会话库 + 斜杠命令 + 待办开关）·
`src/components/AgentSettingsPage.vue`（九节派发）· 判据 8 份（见 §一）· `HANDOFF.md`

## 七、做不到 / 无法核实

- **真模型接入（AG-01）**：设置页的 providers 表只有存储面，`modelConnectionNotice` 继续显示
  「尚未接入联网模型」。这是产品承诺，有判据钉着，本批**没删**。
- **ZCode 的 OAuth 登录 / Coding Plan / 插件市场同步 / 浏览器与电脑控制的真实授权**：依赖真实服务与授权，
  本仓未接，各节按三档口径显示缺口，不放假控件。
- **记忆的查看器那一半**：ZCode 靠后端 `memoryService.listProjectMemories()` 列文件，本仓 `src/agent*.ts`
  里没有任何读盘出口 ⇒ 记忆节只有配置面。
- **工作区搜索范围的规则集还没有搜索管道消费**：存得住、读得出、能匹配，但不影响任何搜索结果。
- **`ignore` npm 包的内部行为无法核实**：`.tools/ZCode` 是浅克隆、没装 node_modules。
  按 gitignore 的可观察语义用显式祖先遍历实现，注释里标明是**替代实现**而非同源。
- **本仓没有 `AGENTS.md`**（lane A 实测；`docs/batch-2026-10-06-audit2.md` 有同样记录）。
  记忆节的出厂清单因此**不含工作区条目**，只在模板菜单里给这个路径模板，不假装能自动发现文件。
- **untitled 工作区上 `file.read` 是否真挂起**：本批没有在真 exe 上复验（**未做真机取证**），
  只是把"挂起"从"永久锁死"降级成"一次诚实的失败"。根因未定位。
- **8 个孤儿模块**（`statusBarListener` / `detachedEditorsHost` / `switcherHost` / `mavenModel` /
  `pluginMarketRemote` / `virtualFilePointer` / `documentationBrowser` / `components/icons/index.ts`）
  是 10-06 中止 lane 的遗留，本批未处理：它们不属于 ZCode 移植面，且接上去需要逐个核实半成品是否正确。
  `node .tools/find-orphan-modules.mjs --gate` 因此仍红。