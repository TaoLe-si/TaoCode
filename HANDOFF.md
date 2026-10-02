# 交接说明（顶部状态更新于 2026-10-02 凌晨；下面「本轮」段是 2026-09-27 的历史存档）

## 当前状态：全绿

| 检查 | 结果 | 备注 |
|---|---|---|
| `npx vue-tsc --noEmit` | 0 错 | 2026-10-02 复跑 |
| `npm test` | **1460/1460** | 2026-10-02；最近一批新增 `tests/ui-motion.test.mjs` 11 条（前一批：`ui-icons` 16 条、`settings-keys-parity` 5 条、`menu-placement` 8 条、`diff-align` 13 条、`b7-verdict` 8 条） |
| `npx vite build` | ✓（`npm run build` 写的是 `dist/`） | **exe 吃的是 `build/ui/`**，只有 `npm run build:native` 会同步过去（它同时跑 36 个 ctest）。改完 UI 只见不到效果，先查这里，别去删 WebView2 缓存 |
| `scripts\build-native-locked.bat` | RC 0 / **0 warning** | main.cpp 已顶到 2000 行硬上限（新能力拆 `native/xxx.cpp`：近期拆出 `file_queries.cpp` / `library_sources.cpp`） |
| `ctest` | **36/36** | 2026-10-02；新增 `lsp_config_file`、`library_sources`。`ctest.exe` 不在 PATH，用 `scripts\run-ctest.bat` |
| 真机取证 | **同一时刻只能跑一个 TaoCode 实例**（WebView2 用户数据目录固定 `%LOCALAPPDATA%\TaoCode`）；探针的 `build/TaoCode.lsp.json` 用完立刻删，别留在用户正在用的 exe 旁边 | 姿势与脚本见 `scripts/_cdp_step.py` |

**最近这一段（第七十七～七十九批）的落点**：补全弹层的收尾（排序/分组更正/`filterText`/「选择声明」）、
`Ctrl+Alt+B`「选择实现」弹层、**「快速定义」Ctrl+Shift+I + 库类型源码**（`native/library_sources.cpp` +
桥接 `file.librarySource`）、以及两个真缺陷 —— ① `TaoCode.lsp.json` 因悬垂临时对象**从未被读到**；
② `lspReady` 写在非响应式对象上导致符号菜单/随处搜索长期不亮（Vue 代理陷阱）。
另外把 JDT 的 workspace folder 收窄成**已链接的子工程**（`ServerConfig::workspace_folders`），
AE2 那种布局上工程数 6 → 1、诊断 2100+ 批 → 5 批。逐条明细在 `docs/ui-parity-checklist.md` 的
第七十七～七十九批。

**再往后三批（第八十～八十二批）**：**第八十批**补齐文件书签的三条菜单挂点（标签页右键 / 项目视图 /
「添加另一书签…」），并修掉「面板没打开时点了没反应」——那个列表对话框原本挂在 `BookmarksPanel.vue` 里，
而面板是条件渲染的，现已提到外壳 `App.vue`。**第八十一批**补 gutter（装订线）右键菜单
（`src/gutterMenu.ts`）；踩到的坑记在清单里：`EditorView.domEventHandlers` 只挂在 `.cm-content` 上，
装订线是它的兄弟节点，必须用 `ViewPlugin` 自己往 `.cm-gutters` 挂（捕获阶段）。
**第八十二批**做了 Search Everywhere 文件来源的 **Smith-Waterman 模糊匹配**
（`src/fuzzyMatch.ts`，含 `fuzzyMatchPath` 的 0.7 阈值回退），并接上排序权重、高亮与一个
**默认关闭**的开关 `fuzzyFileSearch`（上游 `search.everywhere.fuzzy.files.enabled` 默认 false）。
那个开关暴露了一个**只有真机能发现的跨语言缺陷**：`settingsModel.ts` 与 `bridge.ts` 都有这个键，
**native 侧的 `GENERAL_SETTING_KEYS` 漏了**，`validate_general_patch` 于是判 `INVALID_SETTINGS` ——
界面能勾、永远存不下来。两侧补齐 + 加了守卫（ctest 与 `tests/b6-verdict.test.mjs` 各一条）。
**教训**：新加一个设置必须 native 两侧（`settings_schema.hpp` 的键表 + `settings_schema.cpp` 的默认值）
同时登记，TypeScript 判据查不出这一层。同批还交了两份判决材料：
`scripts/verdict_signals.py`（逐类机械信号）与 `docs/inventory/verdict-actions.md`
（`actions` 域 **317 类逐条判决**：`[x]` 12 / `[~]` 36 / `[ ]` 6 / `[-]` 263），
门控 `tests/b6-verdict.test.mjs` 会在覆盖面、引用真实性、四档计数、四个上游常量任一处漂移时失败。

**第八十三批（find + diff 域）**：判决 `docs/inventory/verdict-find-diff.md`
（**630 类逐条判决**：`[x]` 11 / `[~]` 40 / `[ ]` 498 / `[-]` 81），门控 `tests/b7-verdict.test.mjs` 8 条。
同批修掉一处**量出来的**性能缺陷：`src/diffText.ts` 的行级对齐原来开 (m+1)×(n+1) 的完整 DP 表，
而它跑在 UI 线程上（剪贴板对比 `src/vcsActions.ts:122`、保存冲突预览 `src/editorFileOps.ts:54`），
实测 10000×10000 行是 **1414 ms / 773 MB**；换成上游同款 **Myers O(ND) 线性空间**
（`src/diffAlign.ts`，`Diff.kt` + `MyersLCS.kt` + `Enumerator.kt`）后是 **10 ms / 0.5 MB**。
`computeLCS` 保留原名与 `{from,to}` 形状，三个调用点一行没动。
**两条教训**：
① **LCS 不唯一，判据不能写成"输出与 DP 完全一致"**。`tests/diff-align.test.mjs` 判的是两条可判性质 ——
公共段长度等于 DP 最优值、输出是合法公共子序列；再配 **4000 组随机用例**（极小字母表制造大量重复行）。
第一版 3182/4000，查下来算法没错（失败用例里长度都等于最优），是**装配顺序**：前后缀一起推、
前缀落到了列表末尾 —— 这类 bug 只有靠 oracle 才能抓到。
② **`verdict_signals.py` 的 `in_code` 是类名子串匹配**，`Range`/`Side`/`LinkAction`/`impl`
都会命中，不能当判决用；而 `in_comment_only` 里的 `FindUsagesManager`/`FindUsagesOptions` 之类
是因为本仓**注释里引用了上游行号**才命中的 —— 引用 ≠ 实现。本批正是靠逐个开源码，
把 8 条本来判 `[ ]` 的类（查找用法那一片）改判 `[~]`，它们在本仓**是有的**（走 LSP
`textDocument/references`，`src/treeActions.ts:99-113`）。
**门控的价值当场兑现**：`tests/b7-verdict.test.mjs` 第一遍就抓到 **18 条 `[~]` 写了"本仓没有"
却没落到任何文件**，逐条补完本仓落点才通过。

**第八十四批（UI + 图标全面核实）**：题目是"核实所有 UI，包括图标，统一设计模式、图标与文字搭配合理、
动效符合现代审美"。挖出来的不是配色或字号，而是两个更底层的东西。

① **`<button>` 的三处 UA 默认让一批菜单行排版静默失效**（Chromium/WebView2）。① `button { padding: 1px 6px }`
把固定尺寸的图标盒子挤扁；② `<button>` 默认 `display: inline-block`，`justify-content`/`gap`/`align-items`
**全部失效**；③ `<button>` 默认 `text-align: center`，让 `flex: 1` 的标题**各自居中**、看着像没左对齐
（盒子左边其实是对齐的）。前两条几何量不出来，只有截图能看出来。同时把图标收成**单一真源**
`src/uiIcons.ts`：11 个角色（chip 10 / inline 11 / dense 12 / menu 13 / control 14 / checkbox 14 /
toolbar 15 / action 16 / rail 20 / artwork 24 / hero 28），`ICON_STROKE = 2`，约 40 个 SFC 统一取用。
**口径不变**：配色是我们的（`src/tokens.css`），几何是源码的。

② **整条状态栏在真机上从不渲染**。前端默认 `showStatusBar: true`、`v-if` 也写了，就是不出现。根因在 native：
`EDITOR_SETTING_KEYS`（`native/settings_schema.hpp`）**同时**充当 `validate_editor_patch` 的 `known_keys`
白名单**和** `prune_unknown` 的剪枝表（`native/project_settings_state.cpp:41`），而迁移循环
（`:47-49`）只从 `editor_defaults_impl()` 回填 —— 于是漏掉的键被前端**整个删掉**、回到 `undefined`、在 `v-if` 里为假。
更狠的是 `src/App.vue:676` 的 `saveSettingsPatch` 发的是**整个** `editorSettings` 对象，
所以**少一个键，整次 `settings.update` 都会被拒**。补了 5 个键（`showStatusBar` / `rightMargin` /
`showStickyLines` / `stickyLinesLimit` / `diffContextLines`），每个都带上游 `file:line`；顺带给
`stickyLinesLimit`、`diffContextLines` 加上数值域校验。状态栏一露面，又炸出两个被它挡了许久的缺陷：
「全部显示」那行没有前置图标槽（`textIndent` 5 vs 35）、以及状态栏组件菜单（16 行 ≈ 480px）贴底边**整块掉出视口**。
后者新起 `src/menuPlacement.ts`（纯函数，口径＝上游 `AbstractPopup`：原位 → 翻到锚点另一侧 → 夹取），
`openStatusMenu` 渲染完 `nextTick` 量一次真实尺寸再夹。

**三条教训**：
① **"新加一个设置必须 native 两侧（键表 + 默认值）同时登记"这条教训在第八十二批就写过一遍，第八十四批又踩了**。
所以这次不再靠人记：门控 `tests/settings-keys-parity.test.mjs`（5 条）双向查
"前端键 ⇄ native 白名单 ⇄ native 默认值 ⇄ 桥接编辑器白名单"，任一侧漂移即红。
**第一版只有单向（前端⇒native），如果那 5 个键再漏一次它会永远绿** —— 补了反向那条才作数。
② **先量再判**：这批的三个布局缺陷没有一个是从代码上看出来的，全是截图 + CDP 量尺寸才发现的。
反过来也有一条：改完 UI 发现"改动没生效"，先比对 `build/ui/index.html` 的 script hash 和 `dist/` 的 mtime，
**别先怀疑 WebView2 缓存**（我删了 `EBWebView/{Cache,Code Cache,GPUCache}` 也没用，真因是 `build/ui` 压根没同步）。
③ **判据要能真的红**：新写的 settings 门控第一遍是绿的，我用 `
` 去删 `"showStatusBar",`，
而源文件是 LF，字符串**根本没删掉** —— 一次"假绿"验证。加了"替换后必须变化"的断言才真红（2 条失败）。

**第八十五批（动效全面核实）**：上一批把"图标"那一维扫干净了，这批补**动效**那一维，同样外加两处文本字形当图标。

① **省电模式把循环动画变成了频闪**。降级原是 `animation-duration: .001ms !important` —— 对 `transition` 没问题（一次性，0 瞬间完成），
但配 `infinite` 是**每 0.001ms 重启一帧**、每秒上千帧，比转起来更晃，也和"省电"正好相反。`.status-spin` / `.gradle-spin` /
`.plugin-spin` 三个都是 `infinite`，所以一开省电就是三个频闪灯。改成 `animation: none !important` + 给三个转圈补静态替身
`opacity: .45`（和上游 `JBAnimator` 暂停同口径）。

② **`--ease` 用在循环动效上是错的**。`cubic-bezier(.16, 1, .3, 1)` 首段极慢：入场浮层要的就是这种起步轻，
但转圈要**角速度恒定**，套上去看起来是"顿一下再转"。新单列一档 `--ease-linear`（注释写清它只有一个消费者）。
`DebugPanel` 的 `debug-progress-slide` 仍是 `--ease` 且**不该动** —— 它是扫掠不是旋转，运动学本来不同，
所以门禁只校验"keyframes 函数体里含 `rotate(`"的那几处。三份逐字重复的 `@keyframes` 合成全局一份 `tc-spin`。

③ **motion-v 那一侧与令牌脱节**。`motion-v` 读不到 CSS 变量，`App.vue` 只能手抄 `0.1` / `0.16` / `[0.16, 1, 0.3, 1]`，
改 `tokens.css` 不会跟着动。新增 `src/motionTokens.ts` 做运行时令牌桥（`getComputedStyle` + 正则解析 `cubic-bezier`），
并留一组 fallback；**门禁专门比对 fallback 和 `tokens.css` 一致**，影子副本不许漂。

④ **把 `●` 这个字符换掉**。它当"正在运行"记号有三层问题：实心点大小由**字体**决定、和旁边退出码数字同色读起来就是"又一个数字"、
且早该被 `FORBIDDEN_ICON_GLYPHS` 拦住。换成 `src/components/RunningDot.vue`（lucide `Circle` + `fill="currentColor"` + `--accent`），
**不用转圈** —— 那是"不确定进度"才有的信号，"进程还活着"是确定状态，静态点才对。顺带补了 `RunConsole` 里 `<button>` 的
`display: inline-flex`（第八十四批那三处 UA 陷阱的同款，不补的话点会沉到 11px 标题文字下面）。

**门禁 `tests/ui-motion.test.mjs`（11 条）自己踩了四个坑**，最危险的是第四个：
① 令牌正则把 `tokens.css` **注释里**的示例值一起收了 → 解析前先剥 `/* */`；
② 匀速档判据把 `debug-progress-slide` 误认成循环 → 只校验含 `rotate(` 的 keyframes；
③ `m[1].endsWith('ms')` 作用在**数字串**上，恒为假 → 判 `m[2] === 'ms'`；
④ `value.type !== 6` 里的 `6` 是 **attribute** 节点的 type，而 `value` 是**属性值**节点（type 2 = TEXT），
于是 `buttonClasses` 恒为空、**门禁永远绿** → 改判 `typeof value.content !== 'string'`。
前三个是"写错"，第四个是"失效"—— 失效的最危险，因为它看起来一直是绿的。
`:hover` 那条门禁第一版靠类名里有没有 `button` 字样猜，误报 39 处；改用 `@vue/compiler-dom` 走真实模板后收敛到 6 处真缺，全补上。

**一条补充教训**：门禁写完先过、再**人工核对它到底在不在干活**。批次八十二/八十四各出现过一次"假绿"，
这批第四次 —— 只不过这次假绿的不是自己写的新门禁，而是 `:hover` 那条收集器恒空。

**顺带删死 CSS**：`src/style.css` 里 13 条 `.blame-*` 全仓无消费者（annotate 没实现，`docs/inventory/vcs_scan.md` 记的是"未出现"），
整块删除，1343 → 1329 行。因为是删除不是新增，模块大小门禁的帽子没被顶高。
`App.vue` 这批净增 5 行，靠合并 import / 压注释 / 收空行**补回 5 行**，保持在 2737 上限不变。

本批判决书：`docs/ui-parity-checklist.md` 第八十五批。
真机（`TAOCODE_DEBUG_PORT=9331`）量到的判决点：正常态 `tc-spin / 1.1s / linear / infinite / opacity 1`，
切 `data-motion=reduced` 后同一元素 `animation-name: none / duration 0s / opacity .45`（**频闪消失**），去掉属性又复原；
遍历 CSSOM 中含 `rotate(` 的 keyframes 集合恰为 `["tc-spin"]`；`.run-tab > button` / `.running-dot` 等六条新规则确实进了产物；
全树 `.count-badge` / `.run-tab-badge` 含 `●` 的文本子节点为 `[]`。
取证完已 `taskkill //PID 26848 //F`，`tasklist | grep -i taocode` 为空，探针与截图已删（`build/` 是 gitignored 的）。

本批判决书：`docs/ui-parity-checklist.md` 第八十四批（1490-1636 行）。
已知偏离：`docs/settings-parity.md:53` 记的 `stickyLinesLimit` 默认 3 vs 上游
`EditorSettingsExternalizable.java:94` 的 5 —— 这批只把 native 默认补成 3 与前端对齐，**偏离本身没改**，
留到动粘性行那一批判。

## 本轮（2026-09-27 晚）做了什么 —— 历史存档

1. **修掉一次没做完的改名**：`javaRun.*` 的产物目录从 `outputPath: string` 改成 `outputPaths: string[]`
   （`runtimeOutputPaths` 的设计，产物目录要跟着构建工具走），但只改了 `javaRun.ts` / `runTargets.ts`，
   留下 4 处旧调用点，其中 2 处是**真实运行期 bug**：
   - `src/runActions.ts` 运行路径传 `outputPath` → `outputPaths` 得 undefined → **运行 Java 文件抛 TypeError**；
   - 同文件调试路径传字符串 → 字符串可迭代 → classpath 被逐字符展开成 `o;u;t;/;p;r;o;d;u;c;…`（**静默损坏**）；
   - `src/runConfigurations.ts` 同样错键，但外面包着 `try/catch` → 异常被吞，`autoTargets` 恒为 `[]`
     （就是最初报的"打开项目没有运行配置"）。
   运行路径同时换成复用 `runtimeOutputPaths(plan_request)`，Gradle/Maven 才用上自己的产物目录。
2. **核实出清单不可信，并重枚举**（详见 `docs/class-parity-todo.md` §0'）：7 域 **5 051 → 10 400 类**，
   补回 Git Log 580 / editor 735 / projectView 163 / Search Everywhere 146 / folding 71；
   新增 `scripts/enumerate_inventory.py` 与 `scripts/inventory_gaps.py`（**有洞就 exit 1**）。
3. **查出两个待修缺陷**（尚未修，见下）。

## 本轮已修（原查实、已动手）

| # | 缺陷 | 位置 | 怎么修的 |
|---|---|---|---|
| 1 | 「布局」子菜单被插到**窗口菜单最顶上** | `src/menuUi.ts` | 锚点 id `window.searchEverywhere` **全仓不存在** → `findIndex` 得 −1、`+1` 变 0，"碰巧"插对。IDEA 的窗口菜单里本就没有 Search Everywhere（它在 `GoToMenu`，`PlatformActions.xml:604`）。按 `PlatformActions.xml:637-651` 的真实顺序改为**直接置顶**（`[...layoutMenuRows.value, ...windowMenuRows]`），删掉 findIndex + splice。顺带删掉 `windowMenu.ts` 顶部一条与已修正注释**并存**的旧注释 |
| 2 | Search Everywhere 是**空壳** | `src/menus/navigateMenu.ts`、`src/keymap.ts`、主工具栏 | 「随处搜索」(Shift+Shift) 与「查找操作」(Ctrl+Shift+A) **都调 `openActionSearch`**；仓库无任何 tab/贡献者结构（IDEA 侧 146 类）。已做成真对话框：纯逻辑 `src/searchEverywhere.ts`、装配 `src/searchEverywhereHost.ts`、UI `src/components/SearchEverywhereDialog.vue`；tab 取自 `IdeBundle.properties` 的 `searcheverywhere.*.tab.name`（旧那套 Classes/Symbols/… 所属的 `ContributorDefinedTabsCustomizationStrategy.kt` 已 `@Deprecated`），只渲染有真实供给者的 **All / Project / Commands / Run Configurations** |

**LSP 符号供给者已经接上（2026-10-01 第七十八批复核，上一条"仍未做"是过期的）**：`src/searchEverywhereHost.ts`
按查询词（≥2 字、120ms 防抖）发 `workspace/symbol`，`symbols` 供给者同时喂 All 与 Project tab，
结果带行/列预览；关闭/切工作区/文件变化分别作废在途请求（`tests/search-everywhere.test.mjs` 逐条锁住）。
**仍未做**：`IDE` / `Autocompletion` 两个 tab —— 二者在本仓都没有真实供给者：`IDE` 那个名字
（`searcheverywhere.ide.search.tab.name`）在参考源码树里**只有资源串、没有任何代码用它**（grep 全树 0 命中，
只有 grazie 的 i18n 测试数据），`Autocompletion` 是"搜索框里的查询命令补全"（`AutoCompletionProvider.java:40-100`
的 `AutoCompletionCommand`），本仓的搜索框没有查询语言，所以按"没有真实消费链路的项不渲染"不放假控件。

## 缺口清单现状

- **`docs/enum-lsp-dap.md` §C（LSP 缺口）：0 条** —— 37 个 LSP 请求全部实现。
- **§D（DAP 缺口）：3 条**，且**都是协议侧补齐**（`loadedSources` 按需重取 / `stepBack`+`reverseContinue` /
  `readMemory`+`disassemble`）—— 三条在 IDEA 源码里**都没有对应类**（文档里附了搜索命令与零命中结果）。
  它们排在 `docs/class-parity-todo.md` 的类清单之后。
- **`docs/class-parity-todo.md`（总控）**：`[x]` 30 / `[~]` 15 / `[ ]` 13 / `[-]` 6。
  ⚠️ 这里的 `[ ]`/`[~]` 标记**未经复核**（本轮只重枚举了类清单，没重判判决）；
  §9 里 5 个"工作量大"的项目（`ToggleFullScreen` / `EditorToggleShowGutterIcons` / `Macros` /
  `ExportImportGroup` / `EditorBidiTextDirection`）实际**都已落地**，代码在仓库里。
  **下一批的起点应该是 §0' 的 10 400 类逐类判决，不是这份旧标记。**

## 续做须知（今天新立的规矩）

1. **文档里的 IDEA 依据必须带搜索命令或标 `待核`** —— 今天核对 6 条「IDEA：`XxxClass`」「与 IDEA 一致」
   断言，**6 条全错**（详见 `.workbuddy/memory/2026-09-27.md`）。
2. **大文件上限只能靠拆来下调**，不许抬（`tests/module-size.test.mjs`）：今天把
   `lsp_fake_server.cpp`(762→4 文件)、`CodeEditor.vue`(1284→1211)、`lsp_session.cpp`(1973→1381) 都拆了。
3. **脚本改代码**：优先 Edit（有唯一性校验）；必须用脚本时 `assert t.count(anchor) == 1`、每步一写、
   改前备份、改完跑行为基线。中文引号一律「」（半角 `"` 会让脚本 `SyntaxError` 且整体不写盘 —— 今天 5 次）。
4. **编译通过 ≠ 行为正确**：拆分后曾出现"零警告但服务器完全不响应"（漏了 `set_sender` 注入），只有测试抓到。
5. 新增的 skill：`~/.workbuddy/skills/scripted-refactor-safety/`（脚本化重构的安全规程）。

## 继续的起点

- 类清单：`docs/class-parity-todo.md` 的 `[ ]` 与 `[~]` 行（每行都标了缺什么）。
- 逐类明细：`docs/inventory/*_scan.md`（7 域 5051 行，每行一个源码类 + 机检状态）。
- 机检：`scripts/parity_scan.py` + `node --test tests/routing-parity.test.mjs tests/module-size.test.mjs`。

# HANDOFF · TaoCode IDEA UI 1:1 移植

> 交接件。未来只读这一份即可接续，不需回读对话。路径索引见文末。

---

# 以下为**上一次会话**的交接（存档）

> ⚠️ 里面的数字已过时（那时 `npm test` 是 138/138，现在是 **535/535**；验证口径里的
> `vite build --emptyOutDir false` 也已被 `build-native-locked.bat` 的 dist→build/ui 复制取代）。
> **最新状态以本文开头那几段为准。** 保留它是因为「踩过的坑」那张表仍然有效。

## 【主线状态】

**目标**：把 `D:\TaoCode`（C++20 宿主 + WebView2 + Vue3）的界面与交互按 IDEA 源码 1:1 移植补全，禁止虚假/占位/空壳。

**当前节点**：设置对话框（外观页）、主窗口（顶栏/工具窗口/状态栏/提交面板）、欢迎页三块区域的**有真实消费链路**项已全部落地并实测通过。
**第 25~27 批后新增**：状态栏工具窗口 widget、顶栏项目 widget、提交图例、提交前检查与拒绝原因；并把纯逻辑抽成 `src/toolWindows.ts` / `src/commitLegend.ts` / `src/projectWidget.ts` / `src/commitCheck.ts` 四个可单测模块（测试 112 → 138）。

**权威清单**：`D:\TaoCode\docs\ui-parity-checklist.md`（逐条勾选 + 未做项及理由 + 每批验证记录）。

**验证口径（每批必跑）**：
1. `npx vue-tsc --noEmit -p tsconfig.json` → 0 错误
2. `npm test` → 138/138
3. `npx vite build --emptyOutDir false` → exit 0（`--emptyOutDir false` 是因为沙箱禁止批量删除 dist）
4. `python -c "import subprocess;subprocess.run(['cmd','/c',r'D:\TaoCode\scripts\build-native-locked.bat'])"` → RC 0 且零告警
5. `ctest --output-on-failure`（17 项）→ 全绿
6. **启动冒烟**：先 `taskkill //IM TaoCode.exe //F`，再 `subprocess.run(['./TaoCode.exe'], timeout=15)`；`TimeoutExpired` 视为存活

**下一步候选**（按价值）：
1. 「图 X」截图条目核实——**等桃补图**（本会话模型看不到图片，此前"图 1/2/3 的内容"是我推断的，不可作为依据）
2. 剩余已判定为不做/有意偏差的项（透明度语义不符、抗锯齿浏览器不暴露、三个状态栏 widget 无对应机制、项目 widget 的 tooltip 不相对主目录、提交图例的 registry 强制紧凑开关不表面化）——如桃要求仍可逐项尝试
3. `CommitAuthorComponent`（vcs/commit/CommitAuthorComponent.kt:38-121）：需要新增原生 `git.user`（读 `user.name`/`user.email`）与 `git.commit --author`，属跨层改动，尚未开始

**第 24 批（todolist 一次性完成）**：欢迎页项目分组、主菜单位置三模式、屏幕阅读器支持、工具窗口条拖放换边重排——四项均已落地并实测。

## 【本session】

**做了什么**（第 11~27 批 + 两次回归修复，全部实测）：
- 状态栏：内存指示器（原生 `app.memory`）、列选择模式指示器、进度指示器 + 取消按钮（原生 `git.progress` / `git.cancel`）、通知中心、SmartMode 指示（含误报修复）、位置 widget（选区/多光标/点击转到行）、**右键组件菜单**（15 widget 勾选 + 持久化）、省电模式、**工具窗口 widget（悬停列出窗口 + Alt+编号，点击切工具窗口条）**
- 外观页：缩放/紧凑/完整路径/树视图×2/平滑滚动/菜单图标/工具窗口组×3/并列布局×3/背景图像/演示模式/对比滚动条/色觉滤镜/界面字体
- 提交面板：IDEA 结构（信息框头部 + 修改(M) + 提交(N)/提交并推送(P)）、历史信息、回滚、重新格式化、提交选项（--signoff + TODO 预检）、**提交图例（暂存分类小计 + 宽度不足自动紧凑）**、**提交前检查与拒绝原因标签**
- 欢迎页：左栏 tab 语义 + 自定义页 + 插件计数 + ⋮ 菜单 + 分支行 + 空态快捷动作 + 删除确认 + 键盘删除
- 顶栏：**项目 widget（已打开/最近项目 + 搜索）**、Git 分支 widget、运行 widget

**踩过的坑（都已修，值得记住）**：
| 坑 | 现象 | 处置 |
|---|---|---|
| 递归加锁 | `queue_git_request`/`git_worker` 持 `git_mutex` 时调 `publish_git_progress()` → 启动即崩 `0xC0000409` | 发布移出锁外 |
| 伪实现（menuIcons） | 后一次编辑整块替换掉了 `dataset.menuIcons` 赋值，只剩死 CSS | 补回并扩到所有菜单面 |
| 伪实现（bracketMatching） | 控件+持久化都有，编辑器从未读它 | 加 `data-bracket-matching` + CSS 取消高亮 |
| 模板属性坑 | `:aria-label="运行"` 多冒号 → tsc 报 `Property '运行' not found`；三元+反引号嵌套也易歧义 | 字面量不加冒号；复杂 title 用 computed |
| 脚本改文件 | 用 python 字符串替换插块时重复插入、把 CSS 规则拆坏 | 改后必须 grep 计数确认，CSS 破坏要用行区间重建 |
| CSS 误插进媒体查询 | 顶栏 widget 规则同时存在于全局与 `@media (max-width:700px)` → 宽屏下 `.run-caret` 样式缺席 | 删媒体查询内重复块，规则归位全局 |
| 未声明标识符 | `DebugPanel.vue` 的 `consoleNote = …` → vue-tsc `TS2304`、运行时 ReferenceError | 与同文件其余 catch 统一为 `error.value = message(caught)` |
| 链接失败 | 残留 TaoCode.exe 占用导致 `LNK1104` | 构建前先 taskkill |
| 图片 | 本会话模型看不到截图 | **已如实告知桃；不可再假装看到** |

**未决 / 挂起**：
1. 「图 1/2/3」截图条目未核实（等桃补图或文字描述）
2. 有意偏差清单（每项都有 IDEA 源码行号，见清单对应条目）：项目 widget 的 tooltip 不相对主目录；提交图例的 registry 强制紧凑开关不表面化；amend 留空信息沿用原信息；透明度/抗锯齿/三个状态栏 widget 判定 N/A
3. 监督代理（`supervisor`）每轮结束会被框架回收，需重派；定时任务 `79edf316-456b-4856-af5a-d6eac40a38ab` 每 15 分钟自动拉起 main（`FREQ=HOURLY;INTERVAL=1;BYMINUTE=0,15,30,45`）

## 索引

- 硬规则：`.workbuddy/memory/MEMORY.md`（任务未完成禁止停止 / 禁止编造 / 缺口必须读源码 / 不放假控件 / 验证口径）
- 日志：`.workbuddy/memory/2026-09-26.md`（按批记录）
- 清单：`docs/ui-parity-checklist.md`
- 审计报告（第一阶段）：`docs/audit-completion-report.md`
- IDEA 源码：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`
- 构建：`scripts\build-native-locked.bat`（含互斥锁；SDK 路径手抄，因 `reg.exe` 被沙箱拉黑）
