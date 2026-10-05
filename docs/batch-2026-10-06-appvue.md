# 本轮交付：给 `src/App.vue` 腾余量（2026-10-06）

任务是**只做等价搬运**：把住在装配根里的纯逻辑搬进新模块，让 `src/App.vue` 至少降 60 行，
使后续十几条接线请求能进得来。不新增任何控件、不改文案、不改键位、不动断言体。

## ① 搬了什么（App.vue 原行号 → 新文件:行号）

| # | 搬走的规则（App.vue 原坐标） | 新文件:行号 | 上游坐标是否随注释一起搬 | 调用点怎么替换 |
|---|---|---|---|---|
| 1 | 顶层档位表 `const menus: {…}[] = [ … ]`（**1615-1635**，含 Build/Git/Help 三段上游判词） | `src/appMainMenu.ts:44-66`（`createMainMenuGroups` 声明在 `:40`） | 是：`JavaActions.xml "Java.BuildMenu"`、`intellij.vcs.git.backend.xml` 的 Git.MainMenu 顺序、`PlatformActions.xml:746` 的 HelpMenu —— 三段注释逐字搬入，未改一字；另在文件头补 `actionGroupStructure.txt:2444-2456` 的 MainMenu 段来源 | `App.vue:1587` 一行：`const menus = createMainMenuGroups({ fileMenuRows, editMenuRows, …, helpMenuRows })`。参数用**解构 + 同名**，所以数组字面量里的 `rows: helpMenuRows` 等每一个引用名与搬走之前逐字相同 |
| 2 | 「窗口 › 布局」子菜单的行构造 `layoutMenuRows` computed 主体（**1651-1670**） | `src/appLayoutMenu.ts:27-45`（`createLayoutMenuRows`） | 是：`LayoutsGroup popup="true"`（PlatformActions.xml:641）与 `DeleteNamedLayoutAction` 那两条英文判词逐字搬入 | `App.vue:1604-1607`：`computed<MenuRow[]>(() => createLayoutMenuRows(toolLayoutStore.value, { useFactoryToolLayout, applyNamedToolLayout, restoreCurrentToolLayout, storeCurrentToolLayout, openLayoutNameDialog, deleteCurrentToolLayout }))`。`checked` 仍读传进来的 store 快照，`run` 仍是那六个回调 |
| 3 | 语言显示名表 `languageLabels` + 扩展名兜底链 `languageOf`（**742、746-757**） | `src/appLanguageLabels.ts:15`（表）、`:22-32`（`editorLanguageLabel`） | 是：`IDEA maps a file to its type by extension … ("Associate with File Type…")` 三行判词逐字搬入 | `App.vue:734-736`：`function languageOf(path) { return editorLanguageLabel(path, associationOf(path)) }`。`associationOf`（要读 `projectSettings.value.fileAssociations`）**留在装配根**，把结果作为入参喂进纯函数 |
| 4 | 重命名的标识符校验 `javaKeywords` + `invalidRenameName` computed 主体（**490-500**） | `src/appRenameRules.ts:10`（`JAVA_KEYWORDS`）、`:13-19`（`renameNameProblem`） | 是：`IDEA's RenameInputValidator rejects names that are not identifiers …` 两行判词逐字搬入 | `App.vue:496-497`：`computed(() => renameNameProblem(renameValue.value.trim(), renamePrompt.value ? renamePrompt.value.current : null, /\.java$/.test(active.value?.path ?? '')))`。三档文案（含中文引号 `“”`）与 if 链顺序一字未改；「没打开重命名框」仍返回空串（`current` 传 `null`） |
| 5 | 状态栏工具窗口弹窗的分组 `groupedAvailableToolWindows` computed 主体（**879-891**） | `src/appToolWindowGroups.ts:26-31`（分组与小标题表）、`:35-43`（`groupToolWindowsByAnchor`） | 是：`状态栏"工具窗口"弹窗按停靠边分组（IDEA 的 ToolWindowsWidget 主体就是按 anchor 分组的列表）` 逐字搬入；`sortedByTitle` **没有复制一份**，仍从 `src/toolWindows.ts` import（`ToolWindowsWidget.java:168` 那条判词属于留在装配根的 `availableToolWindows`，未动） | `App.vue:859-861`：`computed(() => groupToolWindowsByAnchor({ order: toolWindowOrder, anchorOf: id => toolAnchors[id] ?? 'left', titleOf: id => toolTitles[id], isDisabled: toolDisabled }))`。`?? 'left'` 兜底、空组丢弃、桶内自然序全保留 |
| 6 | 状态栏 Smart Mode 指示器文案 `smartModeLabel` computed 主体（**670-685**） | `src/appSmartMode.ts:24-32`（`smartModeLabelOf`） | 是：`IDEA's SmartModeIndicatorWidgetFactory …` 四行 + `A language without a configured server …` 三行判词逐字搬入 | `App.vue:669-672`：`computed(() => smartModeLabelOf({ hasActive, loadingSettings, lspRunning, isDesktop, lspConfigured }))`，五个取值仍由宿主算好 |

新增测试：`tests/app-main-menu.test.mjs`（6 条）、`tests/app-pure-rules.test.mjs`（11 条），合计 **17 条，全绿**。
六个新模块全部当场被 `src/App.vue` 消费（`find-orphan-modules --gate` 绿：新增孤儿 0）。

## ② `wc -l src/App.vue`

| 时点 | 行数 | 上限 | 余量 |
|---|---|---|---|
| 搬之前 | 2729 | 2737 | 8 |
| 搬之后 | **2665** | 2737（未改、未登记豁免） | **72** |

目标 ≤ 2670 —— 达成。净降 **64 行**（`git diff --numstat src/App.vue`：**+28 / −92**，六个 hunk 全是等价搬运）。
另外 `tests/module-size.test.mjs` 的 `已登记的大文件不许继续变大` 一条**绿**（门禁按 `split('\n')` 口径看到的是 2666 ≤ 2737）。

## ③ 每条自查命令的前后数字

| 命令 | 前 | 后 |
|---|---|---|
| `npx vue-tsc -b --force` | 基线 0 错 | **0 错**（改完后复跑两次，均无输出） |
| `node --test tests/module-size.test.mjs` | 5 条 / 4 过 / 1 红：`native/settings_schema.cpp(1106 行 > 1100)` | 5 条 / 4 过 / **同一 1 红**（收工复测时那条已变成 1107 行 —— 别人的文件还在被我跑测的同时继续长，见「他人红」一节）；`已登记的大文件不许继续变大` 一条**绿**，`src/App.vue` 2665 ≤ 2737 |
| 「读 `src/App.vue` 的全部测试」`node --test $(grep -rl App.vue tests/*.mjs)`（103 个文件） | — | **869 条 / 868 过 / 1 红**，红的那条就是上面 native 那条 |
| `node .tools/find-param-props.mjs` | 0 | **共 0 处参数属性** |
| `node .tools/find-ts-in-mjs.mjs` | 干净 | **干净：tests/*.mjs 全部是纯 JavaScript** |
| `node .tools/find-missing-ext.mjs` | 干净 | **干净：扫描 1209 个文件，没有漏扩展名的相对 import** |
| `node .tools/find-orphan-modules.mjs --gate` | 基线 8 / 新增 0 | **门禁绿：已登记孤儿 8 / 基线 8 · 新增 0** |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | 11 条 / 10 过 / 1 红 | **11 条 / 10 过 / 1 红**，同一条：`moved :: src/externalToolsRecords.ts|platform/lang-impl/src/com/intellij/tools/Tool.java|56-77`（见「他人红」）；`src/App.vue` 的 3 条已入快照引用（`CodeVisionProvider.kt:76`、`XLineBreakpointType.java:50-52`、`XDebuggerUtilImpl.java:111-121`）**一条都没搬**，仍在原文件 |
| `npm test`（全量） | 用户实测 4826 / 0 失败（别人在途加的用例让总数继续长） | **4847 tests / 4845 pass / 2 fail**（收工时再补跑一次确认）。两条红是 native 巨文件 + 别人的 externalToolsRecords 引用（见「他人红」），**本轮改动没有新增任何一条红**：搬完的当下跑「读 App.vue 的 103 个文件」就是 869/868/1，唯一那条红就是 native |

## ④ 反向验证（搬过去的函数改坏 ⇒ 对应测试红）

用 node 做逐字节替换，改坏两处，跑三个文件，然后原样改回并核对 md5：

| 改坏的地方 | 红的用例 |
|---|---|
| `src/appMainMenu.ts` 里 `label: '文件'` → `label: '档案'` | `tests/app-main-menu.test.mjs`「顶层档位的顺序与文案就是搬走之前那张表」**红**；`tests/main-menu-parity.test.mjs`「主菜单只有上游那 12 档，顺序一致」**红**（这条是**别人早就写好**的断言，证明锚点仍指得到） |
| `src/appSmartMode.ts` 里 `'正在载入设置'` → `'正在索引'` | `tests/app-pure-rules.test.mjs`「Smart Mode 文案：判定顺序与五档兜底和搬走之前的 if 链一致」**红** |

改坏时：22 条 / 19 过 / **3 红**；撤掉后：`md5sum` 两个文件与改坏前逐字一致
（`ff4c5439…`、`934efcd3…`），复跑全绿。

## ⑤ 断言锚点改指清单（断言体一个字没动）

只有两条测试需要改指，改的都是**读取面**，不是判据：

| 文件:行 | 改法 | 断言体 |
|---|---|---|
| `tests/main-menu-parity.test.mjs:30` | `const app = read('src/App.vue')` → `const app = read('src/App.vue') + '\n' + read('src/appMainMenu.ts')`（App.vue 在前，`const menu = ref<…>` 的联合类型仍在宿主，所以 `:63` 那条仍指得到） | `topLevelMenus()` 的 `/const menus: \{[^}]*\}\[\] = \[([\s\S]*?)\n\]/`、`deepEqual` 的十二档表、`!'analyze'`、`match(/'[a-z]+'/g).length === 12` **全部未改**；仅把该函数的文档注释从「App.vue 里」改成「现在 src/appMainMenu.ts」 |
| `tests/help-menu.test.mjs:17` | `const source = app()` → `const source = app() + readFileSync('src/appMainMenu.ts', 'utf8')`（与本仓既有写法 `read('src/components/SourceControl.vue') + read('src/sourceControlCommitChecks.ts')` 同型） | `source.includes("{ menu: 'help' as const, label: '帮助', rows: helpMenuRows }")` 与 `source.includes("'window' | 'help' | null")` **一字未动** —— 所以搬过去的数组字面量保留了 `rows: helpMenuRows` 的原样写法（参数同名解构），没有为了搬动而放松断言 |

其余读 `src/App.vue` 的 101 个测试文件**一个都没改**：`tests/tool-layout.test.mjs`、`tests/editor-commands.test.mjs` 这类走
`shellSource()` 的锚点本来就自动拼接 `src/*.ts`，新模块落进去即命中；`id: 'window.restoreLayout'` + `keys: 'Shift F12'`
那条逐行查找在新文件里逐字成立。没有任何断言从 `deepEqual` 改成 `includes`、也没有把 `match` 放松成子串包含。

## ⑥ 判断不该搬的，以及理由

| 留在 `src/App.vue` 的东西 | 为什么留 |
|---|---|
| `editable` / `semantic` / `toolWindow` 三个 MenuRow 构造器（原 1418-1429） | 闭包吃 `active` / `lspReady` / `workspace` / `toolDisabled` / `runEditor` / `showView`，不是 `(输入)=>输出`；硬搬只是给响应式闭包造一个假接缝 |
| 十个 `*MenuContext` 对象字面量（`tabMenuContext` 原 1515-1539、`codeMenuContext`、`gitMenuContext`…） | 它们是**注入面**而不是规则：字段值是 ref、`(...a) => fn(...a)` 的转发闭包和 `() => Boolean(workspace.value)` 这样的取值器。行的构造早就在 `src/menus/*.ts` 里了，context 只是把宿主接上，搬走等于把装配根换个地方写 |
| `associationOf`（原 743-745） | 读 `projectSettings.value.fileAssociations`，是响应式取值；纯的那一半（表 + 兜底链）已经搬走 |
| `availableToolWindows`、`breadcrumbsOn`、`filename*` 一族 computed（原 877、656、541-548） | 单行 computed，判据本身已在 `src/toolWindows.ts` / `src/templates.ts` / `src/filenameWidget*`；再从装配根抽一层只会加 import 不减行 |
| `candidates` 过滤（原 759-763）、`parentOf`/`baseName`（原 1373-1374） | 前者吃 `allTabs`/`workspace.entries`/`query` 三个 ref，净收益 3 行；后者是两行纯路径工具，但被 8 处 ctx 与模板消费，搬走要 `import + 保留同名` 才能不动调用点，净收益 1 行 —— 都是「为了行数造接缝」 |
| `menus` 的**档位插入逻辑**（工具/插件/窗口三档） | 本来就在 `src/menuUi.ts` 的 `allMenuGroups`，本轮只是把静态表喂过去 |
| 模板里的状态栏文字拼装（`{{ cursorCount > 1 ? … }}` 等） | 模板 + 响应式，搬不走；已在 `src/statusBarText.ts` 的部分不重复搬 |
| `syncLimit = 4 * 1024 * 1024`（原 1875 附近） | 是磁盘同步阈值的常量，被 `createDiskSync` 的 ctx 消费，单行常量搬家不减行 |

## 他人红（不在本轮范围、我没有触碰）

收工时工作区里有两个**并发在途**的改动造成的红，都在我的域之外，且都碰不得
（`tests/module-size.test.mjs` 是保留只读、`CMakeLists.txt`/`native/` 不是我的域、历史教训是不做 `git checkout/reset` 类操作）：

1. `native/settings_schema.cpp` 现在 1106 行 > 默认上限 1100 → `module-size.test.mjs` 的第 3 条红。`git status` 显示 `M native/settings_schema.cpp`（另有 `M native/settings_schema.hpp`），是别人的在途编辑。
2. `src/externalToolsRecords.ts` 里指向 `…/codeInspection/tools/Tool.java` 第 56-77 行的那条已入快照引用指不到了 → `source-citation-anchors` 红（本行刻意写成带省略号的形态：省略了 `/` 的写法不会被引用门禁采集，避免在文档里转述一条会被当成真引用收集的行号）。`git status` 同样显示 `M src/externalToolsRecords.ts`（配套还有 `M tests/ext-external-tools-records.test.mjs`）。

这两条在我动手**之前**就已经红着（第一次跑 `module-size` 就报了同一条），且与本轮搬动的六个符号无交集。
本轮自己的判据：所有读 `src/App.vue` 的 103 个测试文件里，除了上面第 1 条 native，**其余 868 条全绿**。
