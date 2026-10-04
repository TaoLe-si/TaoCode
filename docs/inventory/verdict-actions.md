# B6 判决：`actions` = 317 类

判定依据：机械信号（`docs/inventory/actions_signals.{md,json}`，由 `scripts/verdict_signals.py actions` 生成：逐类读上游源码收集继承链 / Swing 组件（`JComponent`·`JList`·`JPanel`·`Graphics2D`·`paintComponent`）/ 平台专属标记（`CustomFrameDecoration`·`Headless`·`OSX`）/ `testSources`）+ 本仓 `src/` `native/` 的真实引用核对（**区分三态**：真实代码引用 / 只被注释引用 / 从未出现）+ 关键家族读上游源码核对语义。

四档（同 B1–B5）：`[x]` 已移植 · `[~]` 部分 · `[ ]` 未移植（TODO）· `[-]` 不适用（附理由）

> **本文档对 317 类逐条给判决**：§A 讲已移植的 12 条，§B 讲部分移植 36 条，§C 讲未移植 6 条，§D 讲不适用 263 条，§G 是**逐条总表**（317 行，机检对齐）。四档合计 12 + 36 + 6 + 263 = 317。
>
> 本域是 `openapi/actionSystem`（171 类）+ `ide/actions/searcheverywhere`（146 类）两个包的合集。
> 判决按「**行为是否落地**」给，不按类名 —— 落地形态可以不含类名（例：`ActionPlaces` 判 `[x]`，
> 但本仓没有这个类，places 是靠 `src/menus/fileMenu.ts` / `src/menus/editorPopupMenu.ts` /
> `src/components/MainToolbar.vue` 三个文件分模块承载的）。
>
> 2026-10-02 第三十八批把 **Smith-Waterman 模糊匹配**落了地（`src/fuzzyMatch.ts` + 接进随处搜索的文件档
> + 高亮 + 注册表键开关），`fuzzyMatching` 一族三类的判决因此落地，见 §A-2。

## 0. 机械信号总账（可复核）

| 信号 | 类数 | 说明 |
|---|---:|---|
| 逐类读到源码 | 317 / 317 | `docs/inventory/actions.txt` 的每一条路径都真实存在 |
| 带 `testSources` | 12 | 上游测试类，本仓测试策略不同（判据在 `tests/*.test.mjs`），一律 `[-]` |
| 带 Swing 组件标记 | 74 | 含 `JComponent`/`JList`/`JPanel`/`Graphics2D`/`paintComponent` 等，本仓用 Vue + CSS 表达 |
| 平台专属 | 6 | `CustomFrameDecoration` 3 类（本仓无自绘标题栏）、`Headless` 2 类、`OSX` 1 类 |
| 名字在**本仓真实代码**里（排除注释） | 3 | `SearchEverywherePreview` / `Anchor` / `Toggleable` |
| 名字只在 `src/` 里被**注释**引用 | 18 | 「对照时读过、写进注释」，**不等于已移植** |
| 名字在 `src/` 里**从未出现** | 296 | 连对照都没开始 |

> 这张表是给**注释**算的口径（脚本逐类 strip 注释后复查）。它不直接等于判决数：`in_comment_only` 的 18 类里
> 既有判 `[~]` 的（`AnAction`、`Presentation`、`ActionGroup` —— 行为落了但名字只出现在注释里），
> 也有判 `[-]` 的（`ActionMenu`、`MacOtherAction`）。§G 每一行都写明依据落在哪个真实文件。

## A. 已移植（`[x]`，12 类）

### A-1 动作系统的三个骨架类（3）

| 类 | 源码 | 落点 |
|---|---|---|
| `Toggleable` | `platform/platform-api/.../Toggleable.java` | 勾选语义：`src/menus/types.ts` 的 `checked?: () => boolean`。分布式的勾选项（侧条显隐、面包屑、软换行、粘性行…）都走它 —— 这是「勾选态随打开时重算」的上游 `update()` 语义 |
| `Anchor` | `platform/platform-api/.../Anchor.java` | 工具栏停靠位：`src/toolWindowMeta.ts` 的锚点 + `src/menus/toolWindowGear.ts` 按锚点分组齿轮菜单 |
| `CommonShortcuts` | `platform/platform-api/.../CommonShortcuts.java` | 常用键位常量表：`src/keymap.ts` 里逐条对应（Ctrl+S / Ctrl+Z / Ctrl+Shift+Z / Ctrl+F / Ctrl+Shift+N / F12 / Shift+Shift…），全部查过 `$default.xml` |

### A-2 Smith-Waterman 模糊匹配（3，本批落地）

这一族是「注册表键 `search.everywhere.fuzzy.files.enabled` 打开后，随处搜索的文件档改用本地序列对齐」的实现。
上游的常量与本仓 `src/fuzzyMatch.ts` 逐项对齐（`ScoringParameters.kt:18-60`）：

| 类 | 源码 | 落点 |
|---|---|---|
| `ScoringParameters` | `platform/lang-impl/.../fuzzyMatching/ScoringParameters.kt` | `DEFAULT_SCORING_PARAMETERS`：matchScore 16 / mismatchPenalty 0 / gapPenalty −1 / firstCharBonus 8 / consecutiveBonus 6 / camelCaseBonus 7 / separatorBonus 8 |
| `AlignmentMatrix` | `platform/lang-impl/.../fuzzyMatching/AlignmentMatrix.kt` | DP 表 + 回溯。tie 顺序 DIAGONAL > UP > LEFT > ZERO 与上游 `AlignmentMatrix.kt:50-56` 的 `computeCell` 一致；回溯只记真实命中的下标 |
| `SmithWatermanAlgorithm` | `platform/lang-impl/.../fuzzyMatching/SmithWatermanAlgorithm.kt` | `fuzzyMatch`：`SmithWatermanAlgorithm.kt:116-154` 的四档 bonus + `calculateMaxPossibleScore`（:175-186）归一化。判据 `tests/fuzzy-match.test.mjs` 9 条 |

配套的两个上游常量也一并落：`MAX_FUZZY_WEIGHT = 9999`（`SeFuzzyFileSearchItem.kt:38`）与
`search.everywhere.fuzzy.files.min.score = 6500`（`SeFuzzyFileSearchProvider.kt:141`）——
`src/fuzzyMatch.ts` 的 `fuzzyWeight`/`passesFuzzyThreshold` 就是这两行。9999 这个值刻意压在
`PreferStartMatchMatcherWrapper.START_MATCH_WEIGHT = 10000` 之下，所以前缀命中的文件永远排在模糊命中之前
（`src/searchEverywhere.ts` 的 `rankingWeight` 就建立在这个权重轴上）。

**判据**：`tests/fuzzy-match.test.mjs` 9 条（常量逐项、无命中、大小写不敏感下标、连续 > 散落、三档 bonus、
归一化、扩展名过滤、路径回退、阈值过滤与 `toInt()` 截断）+ `tests/search-everywhere.test.mjs` 6 条
（默认关、camel 缩写命中、minScore 过滤、跨来源权重序、高亮区间、外壳→对话框→设置页三点接线）。

**真机取证**（2026-10-02，CDP 驱动真 exe，端口 9333）：

- 打开设置 →「系统设置」页 → 勾上「随处搜索用模糊匹配排序文件」→ 确定，
  `%LOCALAPPDATA%\TaoCode\projects.json` 的 `general.fuzzyFileSearch` 落盘为 `true`；
- 搜 `bkp` → `bookmark-probe.ts` 排第一，标题渲染为
  `<mark class="se-hit">b</mark>ookmar<mark class="se-hit">k</mark>-<mark class="se-hit">p</mark>robe.ts`
  （三个高亮下标 0/6/9 正是 camelCase bonus 命中的位置）；
- 关掉开关再搜 `bkp` → 同样的结果但**没有高亮**（默认关时行为与移植前逐字一致）；
- 搜 `spb`（只可能命中目录片段的查询）→ 开关关时 **0 条**，开关开时 **16 条**且 `bookmark-probe.ts` 在首位
  —— 这是 `SmithWatermanMatcher.kt:58-70`「文件名归一分 > 0.7 用文件名，否则退到整条路径」那一档。

> 顺带修掉一个真 bug：前端已有 `fuzzyFileSearch`，但 native 的 `GENERAL_SETTING_KEYS` 键表漏了这个键，
> 于是 `settings.general.update` 会被 `validate_general_patch` 判 `INVALID_SETTINGS` 拒掉、开关永远存不下去。
> 已补进 `native/settings_schema.hpp:56` 的键表与 `native/settings_schema.cpp` 的 `general_defaults_impl`，
> 并在 `native/projects_test.cpp` 的 `update_general` 用例里加了默认值 / 落盘往返 / 非法类型三条判据。
> 这也印证了「跨语言边界的新设置必须两侧都登记」这条硬规则。

### A-3 动作的 places 与 id（2）

| 类 | 源码 | 落点 |
|---|---|---|
| `ActionPlaces` | `platform/ide-core/.../ActionPlaces.java` | places（主菜单 / 编辑器右键 / 主工具栏…）在本仓靠文件分模块承载：`src/menus/fileMenu.ts` 与 `src/menus/codeMenu.ts` 是主菜单，`src/menus/editorPopupMenu.ts` 是编辑器右键，`src/components/MainToolbar.vue` 是主工具栏 |
| `IdeActions` | `platform/ide-core/.../IdeActions.java` | 动作 id 常量表：`src/menus/fileMenu.ts` 等 18 个菜单模块里每个 `MenuRow.id` 就是一个动作 id，逐条对照过上游 `PlatformActions.xml` |

### A-4 随处搜索的三个贡献者与预览（3）

| 类 | 源码 | 落点 |
|---|---|---|
| `SymbolSearchEverywhereContributor` | `platform/lang-impl/.../SymbolSearchEverywhereContributor.java` | `src/searchEverywhereHost.ts` 走 LSP `workspace/symbol`，与「转到符号」同一个请求、同一个 ≥2 字门槛（`SEARCH_EVERYWHERE_SYMBOL_MIN`） |
| `ActionSearchEverywhereContributor` | `platform/lang-impl/.../ActionSearchEverywhereContributor.kt` | `src/searchEverywhereHost.ts` 复用菜单模块的 `actionList`（与「查找操作」面板同一个源），打分在 `src/searchEverywhere.ts` 的 `scoreCommand` |
| `SearchEverywherePreview` | `platform/lang-impl/.../SearchEverywherePreview.kt` | 预览字段 + `src/components/SearchEverywhereDialog.vue` 的「预览」tab |

### A-5 feature 门控（1）

| 类 | 源码 | 落点 |
|---|---|---|
| `SearchEverywhereFeature` | `platform/lang-impl/.../SearchEverywhereFeature.kt` | feature 门控 + 预热那一层：`src/searchEverywhereHost.ts` 的 `SEARCH_EVERYWHERE_SYMBOL_MIN` 门槛与两处防抖（符号 120ms / 文件刷新 200ms）即为等价行为 —— 上游用 feature flag 决定要不要预热，本仓数据都是本地同步的（文件清单、菜单表、运行配置表），预热没有可等的对象 |

## B. 部分移植（`[~]`，36 类）

逐条写「已有」与「还差」。**每一行的 `src/` 都是真实文件**（`tests/b6-verdict.test.mjs` 机检 §F-2）。

### B-1 动作骨架（5）

| 类 | 已有 | 还差 |
|---|---|---|
| `AnAction` | `src/menus/types.ts` 的 `run?: () => void` + 18 个菜单模块的动作表 + `src/menuUi.ts` 的 `pickMenuRow` 分派 | `ActionUpdateThread`/`ActionUpdateThreadAware` 的后台更新契约与 `getActionUpdateThread` 调度 |
| `Presentation` | `MenuRow` 的 `title`/`keywords`/`keys`/`section`/`enabled`/`checked` 就是 Presentation 的字段投影 | `description`（悬停长说明）、`icon`/`color` 的逐动作覆盖、`performAction` 的 before/after 钩子 |
| `ActionGroup` | `src/menus/types.ts` 的 `MenuRow`：`children` 静态子菜单 + `childrenOf` 动态子菜单（对齐 `getChildren(null)` 每次可不同）+ `src/menus/submenuState.ts` | `getChildren` 的 enable/visibility 回调、`isPopup` 的独立生命周期 |
| `DefaultActionGroup` | 18 个菜单模块就是它的实例表（每个模块导出一个 `MenuRow[]`） | 622 行里的 separator 集合、`disableAll`、popup 判定（`section` 字段是简化替代） |
| `ToggleAction` | `MenuRow.checked` 的勾选态随打开时重算 | `isSelected` 的三态、`setSelected` 的反向通知 |

### B-2 动作管理（3）

| 类 | 已有 | 还差 |
|---|---|---|
| `ActionManager` | `src/menuUi.ts` 的 `actionList`（Find Action 面板与「查找操作」共用）+ 18 个菜单模块的静态装配表 + `src/commandSearch.ts` 的排序 | id 索引、`beforeActionPerformed` 钩子、快捷键反查（`getActionForKeystroke`） |
| `ActionManagerImpl` | 同上 | 810 行里的 XML 装载、监听广播、`ActionManagerEx` 扩展面（该类标了 `Headless`，本仓是 GUI 宿主，那部分判据对本域不成立） |
| `RegistryToggleAction` | `src/components/GeneralRegistryToggles.vue` 把上游只有注册表键、没有设置页入口的两项（`autoShowProcessPopup`、`search.everywhere.fuzzy.files.enabled`）升格为持久化开关 | 读的是**设置状态**而非 `Registry`，没有「改注册表要重启」那一层（那正是本仓把它升格为设置的理由） |

### B-3 快捷键（4）

| 类 | 已有 | 还差 |
|---|---|---|
| `ShortcutSet` | `src/keymap.ts` 的 104 个绑定（按键 → 动作的 if 链，判定顺序即 IDEA 优先级语义）+ `MenuRow.keys` 显示 | 键位反查表（按动作查键）、用户自定义键位 |
| `Shortcut` | 每个绑定的 modifiers+key 组合 | `KeyboardShortcut`/`MouseShortcut` 的对象化表达 |
| `KeyboardShortcut` | `src/keymap.ts` 里是硬编码的键位比较，非 `KeyboardShortcut` 实例 | 键位对象（可编程构造、可比较） |
| `AbbreviationManager` | `src/commandSearch.ts` 的 `rankCommands` + `MenuRow.keywords` 让「查找操作」能按缩写命中 | 从标题自动推缩写 + 用户覆盖的机制（本仓用 `keywords` 字段显式声明） |

### B-4 菜单与工具栏（5）

| 类 | 已有 | 还差 |
|---|---|---|
| `ActionMenu` | `src/menus/types.ts` 的树 + `src/menuUi.ts` 的 `rowTitle`/`rowEnabled`/`pickMenuRow`/子菜单浮层状态 + `src/components/EditorPopupMenu.vue` | 键盘导航、725 行里的 Mnemonic/分组与加速键（`MacOtherAction` 那套） |
| `ActionPopupMenu` | `src/components/EditorPopupMenu.vue`（编辑器右键）+ `src/menuUi.ts` 的子菜单浮层 | 定位/尺寸约束（`src/popupBounds.ts` 只覆盖一部分） |
| `ActionToolbar` | `src/components/MainToolbar.vue` + `src/toolWindowMeta.ts` 的 stripe 按钮集合 + `src/toolWindowStripes.ts` 的显隐 | 分隔符/标签动作混排、popup 菜单宿主语义 |
| `ActionToolbarImpl` | 同上 | 1850 行里的布局策略族、自绘、按钮外观（`ActionButtonLook` 三档） |
| `ActionButton` | `src/toolWindowStripes.ts` + `src/components/ToolWindowView.vue` 的 stripe 按钮（含数字角标 Alt+1..9、悬停激活） | 三档外观（`ActionButtonLook`）、按住拖出、`ActionButtonWithText` 的文字变体 |

### B-5 动作通知与数据键（2）

| 类 | 已有 | 还差 |
|---|---|---|
| `AnActionListener` | `src/macros.ts` 的 `recordActionStep` 记录动作步骤（宏回放依赖它） | `beforeActionPerformed`/`afterActionPerformed` 的全量广播 |
| `PlatformDataKeys` | `src/menus/toolWindowGear.ts` 与 `src/explorerActions.ts` 的动作直接读当前选中的路径/文件 | 键名表本身（等价于取值，但无 `DataKey` 抽象） |

### B-6 弹出动作（1）

| 类 | 已有 | 还差 |
|---|---|---|
| `PopupAction` | `src/menuUi.ts` 的子菜单浮层 + `src/components/EditorPopupMenu.vue`/`src/toolWindowActions.ts` 的浮层动作 | 「执行后保持浮层打开」的注解语义（`KeepPopupOnPerform` 判 `[-]`） |

### B-7 随处搜索：贡献者框架（6）

| 类 | 已有 | 还差 |
|---|---|---|
| `SearchEverywhereContributor` | `SEARCH_EVERYWHERE_TABS` 每档一个 `sources` 列表 + `rankingWeight`，四个供给者各占一档 | 分页/增量取与「打字中继续取」协议 |
| `WeightedSearchEverywhereContributor` | `rankingWeight` 返回统一权重轴上的分值（模糊档 ≤ 9999、前缀命中 = 10000） | 多档贡献者之间的权重协商 |
| `SearchEverywhereContributorFactory` | `src/searchEverywhereHost.ts` 按 tab 装配四个供给者 | 按项目/无项目两套工厂 |
| `MixedResultsSearcher` | `src/searchEverywhereHost.ts` 一次装配四路结果，`src/searchEverywhere.ts` 的 `searchEverywhereResults` 按权重合并排序 | 流式追加（先出文件再出符号）与超时丢弃 |
| `SearchEverywherePresentationProvider` | tab/来源/权重投影 + 行渲染（含本批的 `<mark class="se-hit">` 命中高亮） | `ColoredListCellRenderer` 那种整条彩色渲染 |
| `AbstractGotoSEContributor` | `rankingWeight` 与 `fuzzyMatchPath` 承担了「模糊匹配 + 排序」这层语义 | query 切词与「先类名后成员」的两段式 |

### B-8 随处搜索：UI（7）

| 类 | 已有 | 还差 |
|---|---|---|
| `SearchEverywhereUI` | `src/components/SearchEverywhereDialog.vue`（256 行）+ `src/searchEverywhere.ts`（205 行）：四个 tab、输入框、结果列表、键盘导航、预览 pane | ML 排序、分栏宽度可拖、独立 header 视图 |
| `SearchEverywhereManager` | `src/searchEverywhereHost.ts` 持有数据 + `src/App.vue` 的 `searchEverywhereOpen` 开关 | 会话级搜索历史（`SearchEverywhereManagerImpl.kt` 的 typedSearchHistory）、快捷键注册 |
| `SearchEverywhereManagerImpl` | 弹层的开合、数据装配、查询词分发在 `src/searchEverywhereHost.ts` | 495 行里的 coroutine scope / 快捷键 / 重新排序服务 |
| `SearchEverywhereHeader` | `src/components/SearchEverywhereDialog.vue` 的输入框 + tab 行 | 570 行里的独立 header 视图（列头、宽度拖拽） |
| `SearchEverywhereToolbarField` | 输入框（`se-input` + 防抖 + Esc/Enter 键） | field 校验态与「无结果」空态文案（`SearchEverywhereEmptyTextProvider` 判 `[ ]`） |
| `SEListSelectionTracker` | `src/components/SearchEverywhereDialog.vue` 的键盘处理 | 「选中变化 → 触发预览」的时序（异步预览加载） |
| `SearchEverywhereNavigationHandler` | `src/searchEverywhereHost.ts` 的打开动作 | 各类型各自的导航（类跳到文件、运行配置启动） |

### B-9 随处搜索：文件档与预览（2）

| 类 | 已有 | 还差 |
|---|---|---|
| `FileSearchEverywhereContributor` | `src/searchEverywhereHost.ts` 的文件供给者（`workspace.files`）+ 文件档打分；本批起可切 Smith-Waterman 档（`src/fuzzyMatch.ts` 的 `fuzzyMatchPath`，对齐 `SmithWatermanMatcher.kt:58-70`） | 按项目过滤、非索引文件处理 |
| `RunConfigurationsSEContributor` | `src/searchEverywhereHost.ts` 的 `allRunConfigNames`（用户配置 + 自动发现候选） | 按最近使用排序、配置类型图标 |

## C. 未移植（`[ ]`，2 类）—— 有真行为、本仓还没有

| 类 | 差在哪 | 下一批的判据 |
|---|---|---|
| `ClassSearchEverywhereContributor` | 本仓符号档走 LSP `workspace/symbol`（类与成员同一路），没有独立的「按类名搜」这一档 | 需要 LSP 侧区分 kind 之后才谈得上拆档 |
| `ClassSearchEverywhereNavigationHandler` | 打开符号即跳到文件，没有「类/方法」两级区分 | 同上 |

**第九十一批之后的三条已落地**（§G 里已是 `[~]`，本表此处原先漏改）：`SearchEverywhereEmptyTextProvider`
（`src/searchEverywhereEmpty.ts`）、`ScopeChooserAction`（`src/searchEverywhereScope.ts`）、`PreviewAction`
（`SearchEverywhereDialog.vue` 的「预览」开关）。


## D. 不适用（`[-]`，263 类）—— 附理由

四类理由，逐条写在 §G 的依据列里：

1. **Swing 专属构件**（自绘按钮外观、列表渲染器、布局策略族、约束对象…）：本仓菜单/工具栏/列表都是 DOM + CSS，
   交给布局引擎与样式表，不手算宽度也不自绘。代表：`ActionButtonLook` 三档、`ToolbarLayoutStrategy` 族 7 类、
   `PSIPresentationBgRendererWrapper`（502 行）、`ActionUtil`（803 行）、`Utils`（1557 行）。
2. **平台专属 / 无头 / macOS**：本仓窗口装饰由宿主 C++ 建的 WebView2 单窗口负责，没有自绘标题栏；
   本仓是 GUI 宿主，`Headless` 判据不成立；触控板手势与 macOS 菜单项位置特例不适用。
   代表：`SegmentedBarPainter`（`CustomFrameDecoration`）、`SENewUIHeaderView`（`CustomFrameDecoration`）、
   `SearchEverywhereWarmupActivity`（`Headless`）、`ToolbarUpdater`（`Headless`）、
   `Win10ActionButtonLook`、`MacGestureAdapter`、`MouseShortcut`、`PressureShortcut`。
   （`ActionManagerImpl` 与 `ActionMenu` 虽带 `Headless`/`OSX` 标记，但有实现点，判 `[~]` 不判 `[-]`。）
3. **动作系统的注册表/声明文件那一层**：本仓菜单是编译期写死的 TS 模块，没有 `PlatformActions.xml`、
   没有运行时注册、没有动作 id 命名空间。代表：`ActionManagerXmlSupport`、`ActionManagerState`、
   `ActionPluginRegistrar`（1269 行）、`ActionStub`/`ActionGroupStub`、`DataKeys` 全族、
   `ActionId`、`ActionRef`、`PresentationFactory`。
4. **内部设施 / 遥测 / 测试面板**：不采集遥测、无远程开发后端、无 ML 排序、无内部测试面板。
   代表：统计族 6 类、远程开发族 8 类、ML 族 3 类、`SETester`/`SETestingPanel`、
   `ResultsGraph`（调试可视化）、12 个 `testSources` 类。

**本批如实不做的两条**（写清理由，不留假控件）：

- **不引入 ML 排序**（`SearchEverywhereMlService` 族）：本仓排序是纯确定性的分数函数，
  引入模型服务会让「同一查询得到同一顺序」这条可测试的性质失效。判据 `tests/search-everywhere.test.mjs`
  断言的就是确定性顺序。
- ~~不做作用域选择器~~ **第九十一批已经做了**（`src/searchEverywhereScope.ts`，§G 判 `[~]`）——
  这条原先记的是"还没做、所以留在 §C 而不是 §D"，现已落地；本文件的 §C 表也一并改齐（上面那三行）。

## E. 与上游口径的差异（如实记下）

| 差异 | 上游 | 本仓 | 理由 |
|---|---|---|---|
| 模糊文件供给者 | 注册表键 `search.everywhere.fuzzy.files.enabled`，默认 **false**（`SeFuzzyFileSearchProviderFactory.kt:28-31`） | 同默认 false，但升格为设置页开关（`src/components/GeneralRegistryToggles.vue`） | 上游只有注册表键没有设置页入口；TaoCode 没有注册表对话框 |
| 动作 id | `PlatformActions.xml` 声明 + 运行时注册 | `MenuRow.id` 字符串 + 编译期模块 | 没有插件注册动作的通道（插件只贡献命令，见 `src/pluginCommands.ts`） |
| 键位 | `Keymap` + `$default.xml`，用户可改 | `src/keymap.ts` 的硬编码 if 链 | 没有快捷键设置页（本域的 `KeymapShortcutOperation` 判 `[-]`） |
| 动作更新线程 | `ActionUpdateThread` BGT/EDT 契约 | 同步纯函数 `enabled`/`checked` | `MenuRow` 的谓词都在主线程同步算，没有跨线程更新 |

## F. 判据（本判决文件自身的门控）

`tests/b6-verdict.test.mjs`：

1. **覆盖 317 类，不多不少**：从 `docs/inventory/actions.txt`（317 行）与 `docs/inventory/actions_signals.json`
   逐条取「类名 + 路径」，要求每个键在 §G 表里恰有一行。
2. **`[x]`/`[~]` 行的依据必须指到真实文件**：§G 里所有 `[x]`/`[~]` 行，反引号里出现的每个 `src/…`/`native/…`
   路径都必须在磁盘上存在（防「注释里提过就算移植」）。
3. **12 个 `testSources` 类必须在 §G 里被判 `[-]`**。
4. **四档计数自洽**：§G 里 `[x]`+`[~]`+`[ ]`+`[-]` 的行数必须等于 317，且与表尾那句一致。
5. **§A-2 的四个常量必须与上游一致**：`MAX_FUZZY_WEIGHT = 9999`、`FUZZY_FILES_MIN_SCORE = 6500`、
   `START_MATCH_WEIGHT = 10000`、`FUZZY_FILES_ENABLED_DEFAULT = false`（防有人把默认打开）。

## G. 逐条总表（317 类，与扫描件一一对齐）

| `DataKeys` | `java/openapi/src/com/intellij/openapi/actionSystem/DataKeys.java` | `[-]` | 数据键表：TaoCode 的动作函数直接闭包捕获状态（`src/menus/fileMenu.ts` 等 18 个菜单模块里的 `enabled: () => boolean`），不走 DataKey ⇒ 无对应物 |
| `ShortcutProvider` | `platform/analysis-api/src/com/intellij/openapi/actionSystem/ShortcutProvider.java` | `[-]` | 提供额外快捷键的接口：TaoCode 无第三方快捷键贡献方 |
| `ActionClassMetaData` | `platform/editor-ui-api/src/com/intellij/openapi/actionSystem/ActionClassMetaData.java` | `[-]` | 动作类的元数据（图标/描述的类级注解）：菜单是手写模块，元数据即字段本身 |
| `ActionGroup` | `platform/editor-ui-api/src/com/intellij/openapi/actionSystem/ActionGroup.java` | `[~]` | 菜单树的数据模型：`src/menus/types.ts` 的 `MenuRow`（`children` 静态子菜单 + `childrenOf` 动态子菜单，对齐上游 ActionGroup 的 `getChildren(null)` 每次可不同）+ `src/menus/submenuState.ts`；还差 `getChildren` 的 enable/visibility 回调与 `isPopup` 的独立生命周期 |
| `ActionManager` | `platform/editor-ui-api/src/com/intellij/openapi/actionSystem/ActionManager.java` | `[~]` | 动作注册与查询：`src/menuUi.ts` 的 `actionList`（Find Action 面板与「查找操作」共用）+ `src/menus/fileMenu.ts` 等 18 个菜单模块的静态装配表 + `src/commandSearch.ts` 的排序；还差上游的 id 索引、beforeActionPerformed 钩子、快捷键反查（`getActionForKeystroke`） |
| `ActionPopupMenu` | `platform/editor-ui-api/src/com/intellij/openapi/actionSystem/ActionPopupMenu.java` | `[~]` | 弹出菜单：`src/components/EditorPopupMenu.vue`（编辑器右键）+ `src/menuUi.ts` 的子菜单浮层；还差定位/尺寸约束（`src/popupBounds.ts` 只覆盖一部分） |
| `ActionToolbar` | `platform/editor-ui-api/src/com/intellij/openapi/actionSystem/ActionToolbar.java` | `[~]` | 工具栏：`src/components/MainToolbar.vue` + `src/toolWindowMeta.ts` 的 stripe 按钮集合 + `src/toolWindowStripes.ts` 的显隐；还差上游的分隔符/标签动作混排、`ActionToolbar` 的 popup 菜单宿主语义 |
| `ActionToolbarListener` | `platform/editor-ui-api/src/com/intellij/openapi/actionSystem/ActionToolbarListener.java` | `[-]` | 工具栏尺寸/布局监听：TaoCode 的工具栏用 CSS flex，无尺寸监听器 |
| `ActionUiKind` | `platform/editor-ui-api/src/com/intellij/openapi/actionSystem/ActionUiKind.kt` | `[-]` | UI 种类枚举：同 `ActualActionUiKind` |
| `ActionUpdateThread` | `platform/editor-ui-api/src/com/intellij/openapi/actionSystem/ActionUpdateThread.java` | `[-]` | 动作更新线程契约（BGT/EDT）：TaoCode 的 `enabled`/`checked` 都是同步纯函数，无线程契约 |
| `ActionUpdateThreadAware` | `platform/editor-ui-api/src/com/intellij/openapi/actionSystem/ActionUpdateThreadAware.java` | `[-]` | 动作自报更新线程：同上 |
| `AnAction` | `platform/editor-ui-api/src/com/intellij/openapi/actionSystem/AnAction.java` | `[~]` | 动作本体：`src/menus/types.ts` 的 `MenuRow.run?: () => void` + `src/menus/fileMenu.ts` 等 18 个菜单模块的动作表 + `src/menuUi.ts` 的 `pickMenuRow` 分派；还差上游 `AnAction` 的 `ActionUpdateThread`/`ActionUpdateThreadAware` 后台更新契约与 `getActionUpdateThread` 调度 |
| `AnActionEvent` | `platform/editor-ui-api/src/com/intellij/openapi/actionSystem/AnActionEvent.java` | `[-]` | 动作事件对象：TaoCode 直接调 `run()`，不建事件对象、不传 DataContext/InputEvent |
| `AnActionEventVisitor` | `platform/editor-ui-api/src/com/intellij/openapi/actionSystem/AnActionEventVisitor.java` | `[-]` | 事件访问者（键盘/鼠标事件分派）：本仓键盘走 `src/keymap.ts` 的全局 keydown，鼠标走 DOM 事件 |
| `AnActionResult` | `platform/editor-ui-api/src/com/intellij/openapi/actionSystem/AnActionResult.kt` | `[-]` | 动作返回值（Performed/Callback）：TaoCode 的 `run: () => void` 无返回值语义 |
| `CommonDataKeys` | `platform/editor-ui-api/src/com/intellij/openapi/actionSystem/CommonDataKeys.java` | `[-]` | 通用数据键：同上 |
| `CustomShortcutSet` | `platform/editor-ui-api/src/com/intellij/openapi/actionSystem/CustomShortcutSet.java` | `[-]` | 自定义快捷键集（`useShortcutsOf` 换绑）：TaoCode 的键位不可配置 ⇒ 无对应物 |
| `CustomizedDataContext` | `platform/editor-ui-api/src/com/intellij/openapi/actionSystem/CustomizedDataContext.java` | `[-]` | 定制 DataContext：同上 |
| `DataContextWrapper` | `platform/editor-ui-api/src/com/intellij/openapi/actionSystem/DataContextWrapper.java` | `[-]` | DataContext 包装器：同上 |
| `DynamicActionGroup` | `platform/editor-ui-api/src/com/intellij/openapi/actionSystem/DynamicActionGroup.java` | `[-]` | TaoCode 用 `childrenOf: () => MenuRow[]` 表达动态组（`src/menus/types.ts`），语义等价于 `getChildren(null)` 每次重算 ⇒ 单独一类无对应物 |
| `ExperimentalIcons` | `platform/editor-ui-api/src/com/intellij/openapi/actionSystem/ExperimentalIcons.kt` | `[-]` | 实验性图标集：本仓图标走 `src/toolWindowMeta.ts` 的文本/emoji 映射，无图标资源集 |
| `InjectedDataKeys` | `platform/editor-ui-api/src/com/intellij/openapi/actionSystem/InjectedDataKeys.java` | `[-]` | 注入型数据键：无键名表 ⇒ 无对应物 |
| `KeepPopupOnPerform` | `platform/editor-ui-api/src/com/intellij/openapi/actionSystem/KeepPopupOnPerform.java` | `[-]` | 执行后保持浮层打开：本仓浮层由 Vue 状态控制，动作只改状态，无此注解语义 |
| `KeyboardShortcut` | `platform/editor-ui-api/src/com/intellij/openapi/actionSystem/KeyboardShortcut.java` | `[~]` | 键盘键位：`src/keymap.ts` 的判定是硬编码的键位比较，非 `KeyboardShortcut` 实例 |
| `MergeableActions` | `platform/editor-ui-api/src/com/intellij/openapi/actionSystem/MergeableActions.kt` | `[-]` | 合并动作（多 id 合成一个按钮）：工具窗口 stripe 的合并在 `src/toolWindowStripes.ts` 直接算，无此抽象 |
| `OverridingAction` | `platform/editor-ui-api/src/com/intellij/openapi/actionSystem/OverridingAction.java` | `[-]` | 动作 id 覆盖：TaoCode 无动作 id 命名空间（菜单 id 是字符串，无注册表可覆盖） |
| `Presentation` | `platform/editor-ui-api/src/com/intellij/openapi/actionSystem/Presentation.java` | `[~]` | 呈现模型：`src/menus/types.ts` 里 `MenuRow` 的 `title`/`keywords`/`keys`/`section`/`enabled`/`checked` 就是 Presentation 的字段投影；还差 `description`（悬停长说明）、`icon` 与 `color` 的逐动作覆盖、`performAction` 的 before/after 钩子 |
| `RightAlignedToolbarAction` | `platform/editor-ui-api/src/com/intellij/openapi/actionSystem/RightAlignedToolbarAction.java` | `[-]` | 右对齐工具栏动作（分割线前的那一格）：本仓 stripe 只有图标按钮，没有右对齐动作区 |
| `Shortcut` | `platform/editor-ui-api/src/com/intellij/openapi/actionSystem/Shortcut.java` | `[~]` | 单个键位：`src/keymap.ts` 里每个绑定的 modifiers+key 组合；还差 `KeyboardShortcut`/`MouseShortcut` 的对象化表达 |
| `ShortcutSet` | `platform/editor-ui-api/src/com/intellij/openapi/actionSystem/ShortcutSet.java` | `[~]` | 快捷键表：`src/keymap.ts` 的 104 个绑定（按键 → 动作的 if 链，判定顺序即 IDEA 优先级语义）+ `src/menus/types.ts` 的 `keys?: string`（菜单行显示键位） |
| `TimerListener` | `platform/editor-ui-api/src/com/intellij/openapi/actionSystem/TimerListener.java` | `[-]` | 计时器监听：本仓用 `setTimeout` 直接调，无监听器协议 |
| `UpdateInBackground` | `platform/editor-ui-api/src/com/intellij/openapi/actionSystem/UpdateInBackground.java` | `[-]` | BGT 更新标记注解：同上 |
| `UpdateSession` | `platform/editor-ui-api/src/com/intellij/openapi/actionSystem/UpdateSession.java` | `[-]` | 更新会话（编辑器/文档）：`src/editorCommands.ts` 的命令各自读当前 tab，无会话对象 |
| `AnActionListener` | `platform/editor-ui-api/src/com/intellij/openapi/actionSystem/ex/AnActionListener.java` | `[~]` | 动作执行前后通知：`src/macros.ts` 的 `recordActionStep` 记录动作步骤（宏回放依赖它）；还差上游的 `beforeActionPerformed`/`afterActionPerformed` 全量广播 |
| `CustomComponentAction` | `platform/editor-ui-api/src/com/intellij/openapi/actionSystem/ex/CustomComponentAction.java` | `[-]` | 在菜单里塞 Swing 组件的动作：菜单项是文本行，不支持自定义组件渲染 |
| `MainMenuPresentationAware` | `platform/editor-ui-api/src/com/intellij/openapi/actionSystem/ex/MainMenuPresentationAware.java` | `[-]` | 主菜单呈现感知：主菜单行就是 `MenuRow`，无此接口 |
| `ActionRemoteBehavior` | `platform/editor-ui-api/src/com/intellij/openapi/actionSystem/remoting/ActionRemoteBehavior.kt` | `[-]` | 远程开发（Gateway/remote dev）那套：本仓是纯本地单窗口宿主，无远程后端 ⇒ 无对应物 |
| `ActionRemoteBehaviorCustomizer` | `platform/editor-ui-api/src/com/intellij/openapi/actionSystem/remoting/ActionRemoteBehaviorCustomizer.kt` | `[-]` | 远程开发（Gateway/remote dev）那套：本仓是纯本地单窗口宿主，无远程后端 ⇒ 无对应物 |
| `ActionRemotePermissionRequirements` | `platform/editor-ui-api/src/com/intellij/openapi/actionSystem/remoting/ActionRemotePermissionRequirements.kt` | `[-]` | 远程开发（Gateway/remote dev）那套：本仓是纯本地单窗口宿主，无远程后端 ⇒ 无对应物 |
| `ActionWithMergeId` | `platform/editor-ui-api/src/com/intellij/openapi/actionSystem/remoting/ActionWithMergeId.kt` | `[-]` | 带 merge id 的动作：同上 |
| `AutoLayoutStrategy` | `platform/editor-ui-api/src/com/intellij/openapi/actionSystem/toolbarLayout/AutoLayoutStrategy.kt` | `[-]` | 工具栏布局策略：TaoCode 的工具栏是 CSS flex + 一次宽度预算折叠（`src/mergedMainMenu.ts`），不做「压缩/换行/右对齐调整」这套策略对象 —— 那是为了在 Swing 里手算宽度，本仓交给布局引擎 |
| `CompressingLayoutStrategy` | `platform/editor-ui-api/src/com/intellij/openapi/actionSystem/toolbarLayout/CompressingLayoutStrategy.kt` | `[-]` | 工具栏布局策略：TaoCode 的工具栏是 CSS flex + 一次宽度预算折叠（`src/mergedMainMenu.ts`），不做「压缩/换行/右对齐调整」这套策略对象 —— 那是为了在 Swing 里手算宽度，本仓交给布局引擎 |
| `NoWrapLayoutStrategy` | `platform/editor-ui-api/src/com/intellij/openapi/actionSystem/toolbarLayout/NoWrapLayoutStrategy.kt` | `[-]` | 工具栏布局策略：TaoCode 的工具栏是 CSS flex + 一次宽度预算折叠（`src/mergedMainMenu.ts`），不做「压缩/换行/右对齐调整」这套策略对象 —— 那是为了在 Swing 里手算宽度，本仓交给布局引擎 |
| `RightActionsAdjusterStrategyWrapper` | `platform/editor-ui-api/src/com/intellij/openapi/actionSystem/toolbarLayout/RightActionsAdjusterStrategyWrapper.kt` | `[-]` | 工具栏布局策略：TaoCode 的工具栏是 CSS flex + 一次宽度预算折叠（`src/mergedMainMenu.ts`），不做「压缩/换行/右对齐调整」这套策略对象 —— 那是为了在 Swing 里手算宽度，本仓交给布局引擎 |
| `ToolbarLayoutStrategy` | `platform/editor-ui-api/src/com/intellij/openapi/actionSystem/toolbarLayout/ToolbarLayoutStrategy.java` | `[-]` | 工具栏布局策略：TaoCode 的工具栏是 CSS flex + 一次宽度预算折叠（`src/mergedMainMenu.ts`），不做「压缩/换行/右对齐调整」这套策略对象 —— 那是为了在 Swing 里手算宽度，本仓交给布局引擎 |
| `ToolbarLayoutUtil` | `platform/editor-ui-api/src/com/intellij/openapi/actionSystem/toolbarLayout/ToolbarLayoutUtil.kt` | `[-]` | 工具栏布局策略：TaoCode 的工具栏是 CSS flex + 一次宽度预算折叠（`src/mergedMainMenu.ts`），不做「压缩/换行/右对齐调整」这套策略对象 —— 那是为了在 Swing 里手算宽度，本仓交给布局引擎 |
| `WrapLayoutStrategy` | `platform/editor-ui-api/src/com/intellij/openapi/actionSystem/toolbarLayout/WrapLayoutStrategy.kt` | `[-]` | 工具栏布局策略：TaoCode 的工具栏是 CSS flex + 一次宽度预算折叠（`src/mergedMainMenu.ts`），不做「压缩/换行/右对齐调整」这套策略对象 —— 那是为了在 Swing 里手算宽度，本仓交给布局引擎 |
| `ExecutionDataKeys` | `platform/execution/src/com/intellij/openapi/actionSystem/ExecutionDataKeys.java` | `[-]` | 运行相关数据键：运行配置由 `src/bridge.ts` 的 `runConfigs` 直接传，无 DataKey |
| `DependentTransientComponent` | `platform/ide-core-impl/src/com/intellij/openapi/actionSystem/DependentTransientComponent.java` | `[-]` | 随主浮层一起销毁的子组件：浮层内容是 Vue 模板，生命周期自动级联 |
| `SimpleDataContext` | `platform/ide-core-impl/src/com/intellij/openapi/actionSystem/impl/SimpleDataContext.java` | `[-]` | 简单的键值 DataContext 实现：同 `DataContext` |
| `ActionPlaces` | `platform/ide-core/src/com/intellij/openapi/actionSystem/ActionPlaces.java` | `[x]` | 动作的 places 概念（主菜单/编辑器右键/工具栏…）：本仓按文件分模块承载 —— `src/menus/fileMenu.ts` 与 `src/menus/codeMenu.ts` 是主菜单，`src/menus/editorPopupMenu.ts` 是编辑器右键，`src/components/MainToolbar.vue` 是主工具栏，等价于三处 places |
| `ActionWithDelegate` | `platform/ide-core/src/com/intellij/openapi/actionSystem/ActionWithDelegate.java` | `[-]` | 委托动作：TaoCode 的动作直接给 `run`，无 delegate 分层 |
| `IdeActions` | `platform/ide-core/src/com/intellij/openapi/actionSystem/IdeActions.java` | `[x]` | 动作 id 常量表（`IDE_*` 那些 id）：`src/menus/fileMenu.ts` 等 18 个菜单模块里每个 `MenuRow.id` 就是一个动作 id，逐条对照过上游 `PlatformActions.xml` |
| `PlatformCoreDataKeys` | `platform/ide-core/src/com/intellij/openapi/actionSystem/PlatformCoreDataKeys.java` | `[-]` | 平台核心数据键：同 `DataKeys`，本仓无键名表 |
| `SeparatorAction` | `platform/ide-core/src/com/intellij/openapi/actionSystem/SeparatorAction.java` | `[-]` | 分隔符动作：菜单行用 `section` 字段分组表达分隔，不需要一个空动作类 |
| `AutoCompletionCommand` | `platform/lang-api/src/com/intellij/ide/actions/searcheverywhere/AutoCompletionCommand.java` | `[-]` | 同 `AutoCompletionContributor`：按当前文档补全属补全弹窗，不在此框架内 |
| `AutoCompletionContributor` | `platform/lang-api/src/com/intellij/ide/actions/searcheverywhere/AutoCompletionContributor.java` | `[-]` | 自动补全贡献者（按当前文档取词）：这是补全弹窗的供给者，本仓的补全走 LSP（`src/lspCompletion.ts`），不共用随处搜索的贡献者框架 |
| `ContributorSearchResult` | `platform/lang-api/src/com/intellij/ide/actions/searcheverywhere/ContributorSearchResult.java` | `[-]` | 贡献者搜索结果包装：结果就是 `SearchEverywhereItem` 数组，无包装 |
| `EssentialContributor` | `platform/lang-api/src/com/intellij/ide/actions/searcheverywhere/EssentialContributor.java` | `[-]` | 必要贡献者接口：同上 |
| `ExtendedInfo` | `platform/lang-api/src/com/intellij/ide/actions/searcheverywhere/ExtendedInfo.kt` | `[-]` | 结果的扩展信息（右侧详情）：本仓结果行只有标题 + 路径两段 |
| `FoundItemDescriptor` | `platform/lang-api/src/com/intellij/ide/actions/searcheverywhere/FoundItemDescriptor.java` | `[-]` | 命中项描述：命中就是结果行本身 |
| `PossibleSlowContributor` | `platform/lang-api/src/com/intellij/ide/actions/searcheverywhere/PossibleSlowContributor.java` | `[-]` | 慢贡献者标记：四个供给者都是本地同步的（文件清单/LSP 符号/菜单表/运行配置表），无慢速来源 |
| `SearchEverywhereCommandInfo` | `platform/lang-api/src/com/intellij/ide/actions/searcheverywhere/SearchEverywhereCommandInfo.java` | `[-]` | 同 `SearchEverywhereCommandInfo` |
| `SearchEverywhereContributor` | `platform/lang-api/src/com/intellij/ide/actions/searcheverywhere/SearchEverywhereContributor.java` | `[~]` | 贡献者接口（`fetchElements`/`fetchTypedElements` + 权重）：`src/searchEverywhere.ts` 的 `SEARCH_EVERYWHERE_TABS` 每档一个 `sources` 列表 + `rankingWeight`，四个供给者各占一档；还差上游的分页/增量取与「打字中继续取」协议 |
| `SearchEverywhereContributorFactory` | `platform/lang-api/src/com/intellij/ide/actions/searcheverywhere/SearchEverywhereContributorFactory.java` | `[~]` | 贡献者工厂：`src/searchEverywhereHost.ts` 按 tab 装配四个供给者；还差上游的按项目/无项目两套工厂 |
| `SearchEverywhereEssentialContributorMarker` | `platform/lang-api/src/com/intellij/ide/actions/searcheverywhere/SearchEverywhereEssentialContributorMarker.kt` | `[-]` | 「必要贡献者」标记：四个供给者都是内置的，无「缺失即不可用」的标记需求 |
| `SearchEverywhereExtendedInfoProvider` | `platform/lang-api/src/com/intellij/ide/actions/searcheverywhere/SearchEverywhereExtendedInfoProvider.kt` | `[-]` | 同 `ExtendedInfo` |
| `SearchEverywherePresentationProvider` | `platform/lang-api/src/com/intellij/ide/actions/searcheverywhere/SearchEverywherePresentationProvider.java` | `[~]` | 呈现提供：`src/searchEverywhere.ts` 的 tab/来源/权重投影 + `src/components/SearchEverywhereDialog.vue` 的行渲染（含本批的 `<mark class="se-hit">` 命中高亮）；还差上游的 `ColoredListCellRenderer` 整条彩色渲染 |
| `SearchEverywhereSpellCheckResult` | `platform/lang-api/src/com/intellij/ide/actions/searcheverywhere/SearchEverywhereSpellCheckResult.kt` | `[-]` | 同 `SearchEverywhereSpellingCorrector` |
| `SearchEverywhereSpellingCorrector` | `platform/lang-api/src/com/intellij/ide/actions/searcheverywhere/SearchEverywhereSpellingCorrector.kt` | `[-]` | 搜索词拼写纠错（词典）：本仓无词典服务，纠错要接远程 ⇒ 无对应物 |
| `SearchEverywhereToggleAction` | `platform/lang-api/src/com/intellij/ide/actions/searcheverywhere/SearchEverywhereToggleAction.java` | `[-]` | 「贡献者开关」动作的基类（点一下开关某个档）：本仓用 tab 切档，不用勾选开关 ⇒ 无对应物 |
| `SearchFieldActionsContributor` | `platform/lang-api/src/com/intellij/ide/actions/searcheverywhere/SearchFieldActionsContributor.kt` | `[-]` | 输入框内的动作贡献者（齿轮/过滤器按钮）：本仓输入框只有清除与 tab 切换 |
| `SemanticSearchEverywhereContributor` | `platform/lang-api/src/com/intellij/ide/actions/searcheverywhere/SemanticSearchEverywhereContributor.kt` | `[-]` | 语义搜索（向量）贡献者：需要远程模型服务，本仓纯本地 ⇒ 无对应物 |
| `TabsCustomizationStrategy` | `platform/lang-api/src/com/intellij/ide/actions/searcheverywhere/TabsCustomizationStrategy.kt` | `[-]` | tab 定制策略接口：`SEARCH_EVERYWHERE_TABS` 是常量表，tab 顺序与增减在编译期定 ⇒ 无运行时定制 |
| `WeightedSearchEverywhereContributor` | `platform/lang-api/src/com/intellij/ide/actions/searcheverywhere/WeightedSearchEverywhereContributor.kt` | `[~]` | 带权重的贡献者：`rankingWeight` 返回统一权重轴上的分值（模糊档 ≤ 9999、前缀命中 = 10000，见 `src/searchEverywhere.ts`），对齐上游的权重可比性要求 |
| `RemoteSearchEverywhereConverter` | `platform/lang-api/src/com/intellij/ide/actions/searcheverywhere/remote/RemoteSearchEverywhereConverter.java` | `[-]` | 远程开发（Gateway/remote dev）那套：本仓是纯本地单窗口宿主，无远程后端 ⇒ 无对应物 |
| `RemoteSearchEverywhereConverterSupplier` | `platform/lang-api/src/com/intellij/ide/actions/searcheverywhere/remote/RemoteSearchEverywhereConverterSupplier.java` | `[-]` | 远程开发（Gateway/remote dev）那套：本仓是纯本地单窗口宿主，无远程后端 ⇒ 无对应物 |
| `RemoteSearchEverywherePresentation` | `platform/lang-api/src/com/intellij/ide/actions/searcheverywhere/remote/RemoteSearchEverywherePresentation.java` | `[-]` | 远程开发（Gateway/remote dev）那套：本仓是纯本地单窗口宿主，无远程后端 ⇒ 无对应物 |
| `SearchEverywhereRemoteSupportService` | `platform/lang-api/src/com/intellij/ide/actions/searcheverywhere/remote/SearchEverywhereRemoteSupportService.java` | `[-]` | 远程开发（Gateway/remote dev）那套：本仓是纯本地单窗口宿主，无远程后端 ⇒ 无对应物 |
| `LangDataKeys` | `platform/lang-core/src/com/intellij/openapi/actionSystem/LangDataKeys.java` | `[-]` | 语言数据键（编辑器/文件/项目等的 IDE 层键）：同上，无键名表 |
| `AbstractEqualityProvider` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/AbstractEqualityProvider.java` | `[-]` | 去重基类：同 `SEResultsEqualityProvider` |
| `AbstractGotoSEContributor` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/AbstractGotoSEContributor.kt` | `[~]` | Goto 类贡献者基类（查询词切分 + 模糊匹配 + 排序）：`src/searchEverywhere.ts` 的 `rankingWeight` 与 `fuzzyMatchPath` 承担了这层的语义；还差上游的 query 切词与「先类名后成员」的两段式 |
| `ActionSearchEverywhereContributor` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/ActionSearchEverywhereContributor.kt` | `[x]` | 动作贡献者：`src/searchEverywhereHost.ts` 复用菜单模块的 `actionList`（与「查找操作」面板同一个源），打分在 `src/searchEverywhere.ts` 的 `scoreCommand` |
| `ActionsEqualityProvider` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/ActionsEqualityProvider.java` | `[-]` | 同 `SEResultsEqualityProvider` |
| `AutoCompletionProvider` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/AutoCompletionProvider.java` | `[-]` | 补全渲染器（JList + 自绘高亮）：补全弹窗的上游渲染器，本仓补全是 `src/completionUi.ts` 的补全浮层，不属本域 |
| `CalculatorSEContributor` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/CalculatorSEContributor.kt` | `[-]` | 计算器贡献器（输入算式求值）：纯附加功能，非 IDE 核心 ⇒ 不做 |
| `CheckBoxSearchEverywhereToggleAction` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/CheckBoxSearchEverywhereToggleAction.java` | `[-]` | 复选框式的贡献者开关：`SearchEverywhereFiltersAction` 的同类，不做 |
| `ClassSearchEverywhereContributor` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/ClassSearchEverywhereContributor.kt` | `[ ]` | 类贡献者：本仓符号档走 LSP `workspace/symbol`（类与成员同一路），没有独立的「按类名搜」这一档。**要做得先有**一个只回类符号的语言服务请求（LSP 没有"只要 type"的参数），或对 `workspace/symbol` 的结果按 `SymbolKind` 客户端过滤 —— 后者会把"类"的定义交给服务器返回的 kind，服务器不保证给，所以暂不做。 |
| `ClassSearchEverywhereNavigationHandler` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/ClassSearchEverywhereNavigationHandler.kt` | `[ ]` | 类的导航（跳到文件并定位）：本仓的符号档是 LSP 符号，打开即跳到文件，没有「先跳类名再跳成员」的两级区分。同 `ClassSearchEverywhereContributor` 的前置条件。 |
| `ContributorDefinedTabsCustomizationStrategy` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/ContributorDefinedTabsCustomizationStrategy.kt` | `[-]` | 由贡献者定义 tab 的策略：四个 tab 是硬编码的 ⇒ 无对应物 |
| `CorrectionWrapper` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/CorrectionWrapper.kt` | `[-]` | 同 `SearchEverywhereSpellingCorrector` |
| `FileSearchEverywhereContributor` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/FileSearchEverywhereContributor.kt` | `[~]` | `src/searchEverywhereHost.ts` 的文件供给者（`workspace.files`）+ `src/searchEverywhere.ts` 的文件档打分；本批起可切 Smith-Waterman 档（`src/fuzzyMatch.ts` 的 `fuzzyMatchPath`，对齐 `SmithWatermanMatcher.kt:58-70` 的「文件名归一分 > 0.7 否则整条路径」）；还差上游的按项目过滤与非索引文件处理 |
| `FixedTabsListCustomizationStrategy` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/FixedTabsListCustomizationStrategy.kt` | `[-]` | 固定 tab 列表策略：同 `TabsCustomizationStrategy` |
| `GotoContributorsAvailabilityApi` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/GotoContributorsAvailabilityApi.kt` | `[-]` | 贡献者可用性查询接口：四个供给者恒定可用 ⇒ 无需查询 |
| `GotoContributorsAvailabilityService` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/GotoContributorsAvailabilityService.kt` | `[-]` | 同 `GotoContributorsAvailabilityApi` |
| `HintHelper` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/HintHelper.kt` | `[-]` | Swing 提示气泡工具（JBUIScale）：提示用 CSS ⇒ 无对应物 |
| `HistoryIterator` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/HistoryIterator.kt` | `[-]` | 历史遍历（上下键回溯历史查询词）：本仓的上下键是在当前结果里移动，不回溯历史 ⇒ 无对应物 |
| `MergeableElement` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/MergeableElement.java` | `[-]` | 合并元素接口：`src/toolWindowMeta.ts` 的条目直接带 id/标题，无合并协议 |
| `MixedListFactory` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/MixedListFactory.java` | `[-]` | 混合列表工厂（JList 构造）：同 `MixedSearchListModel` |
| `MixedResultsSearcher` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/MixedResultsSearcher.java` | `[~]` | 混合结果搜索（多供给者并发取 + 合并）：`src/searchEverywhereHost.ts` 一次装配四路结果，`src/searchEverywhere.ts` 的 `searchEverywhereResults` 按权重合并排序；还差上游的流式追加（先出文件再出符号）与超时丢弃 |
| `MixedSearchListModel` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/MixedSearchListModel.java` | `[-]` | 混合结果的列表模型（Swing `ListModel`）：列表是 computed 数组 ⇒ 无模型类 |
| `MonolithSearchEverywhereManagerFactory` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/MonolithSearchEverywhereManagerFactory.kt` | `[-]` | 单体版管理器工厂（单进程部署的接线）：本仓弹层直接由 `src/searchEverywhereHost.ts` 装配 ⇒ 无工厂层 |
| `NonIndexableFilesSEContributor` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/NonIndexableFilesSEContributor.kt` | `[-]` | 非索引文件贡献者（无索引时兜底）：本仓的文件清单来自宿主直接枚举（`workspace.files`），不区分索引/非索引 ⇒ 无对应物 |
| `NonIndexableProductBehaviorService` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/NonIndexableProductBehaviorService.kt` | `[-]` | 非索引文件的按产品行为策略：同上 |
| `OptionEqualityProvider` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/OptionEqualityProvider.java` | `[-]` | 同 `SEResultsEqualityProvider` |
| `PSIPresentationBgRendererWrapper` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/PSIPresentationBgRendererWrapper.java` | `[-]` | 502 行 Swing 列表渲染器（JList/JPanel/JLabel）：本仓列表行是 DOM + CSS ⇒ 自绘渲染器不适用 |
| `PersistentSearchEverywhereContributorFilter` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/PersistentSearchEverywhereContributorFilter.java` | `[-]` | 贡献者的持久过滤（记住用户关掉的档）：本仓 tab 常显 ⇒ 无对应物 |
| `PossibleInternalCommandsContributor` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/PossibleInternalCommandsContributor.kt` | `[-]` | 内部命令贡献者（IDEA 内部命令）：本仓菜单表是自有的，无内部/外部命令之分 |
| `PreviewAction` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/PreviewAction.kt` | `[~]` | 预览面板的开关动作。**第九十一批已落**：`src/components/SearchEverywhereDialog.vue` 的「预览」按钮（`showPreview` + `aria-pressed`，与 `SearchEverywherePreview` 面板联动）。上游 `PreviewAction` 是动作对象，本仓是同一个开关的一个按钮 —— 行为一致，形态不同。 |
| `PreviewExperiment` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/PreviewExperiment.kt` | `[-]` | 预览实验开关：`PreviewAction` 那一格的前置实验标记；本仓预览无实验门控 |
| `PreviewListener` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/PreviewListener.java` | `[-]` | 预览加载完成监听：预览内容由供给者一次性算出，无监听协议 |
| `PromoAction` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/PromoAction.java` | `[-]` | 推广动作（试用/升级提示）：无商业化功能 ⇒ 不适用 |
| `PsiElementsEqualityProvider` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/PsiElementsEqualityProvider.java` | `[-]` | 同 `SEResultsEqualityProvider` |
| `PsiItemWithSimilarity` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/PsiItemWithSimilarity.kt` | `[-]` | 带相似度的 PSI 项（模糊结果合并）：本仓的结果不合并相似项 ⇒ 无对应物 |
| `RecentFilesSEContributor` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/RecentFilesSEContributor.java` | `[-]` | 最近文件贡献者：`src/projectWidget.ts` 的最近项目列表是另一个入口，本仓的随处搜索没有「最近文件」这一档 |
| `RunConfigurationsSEContributor` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/RunConfigurationsSEContributor.java` | `[~]` | 运行配置贡献者：`src/searchEverywhereHost.ts` 的 `allRunConfigNames`（用户配置 + 自动发现候选）；还差上游的按最近使用排序与配置类型图标 |
| `SEHeaderActionListener` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/SEHeaderActionListener.kt` | `[-]` | header 动作监听：tab 切换是 Vue 的 `@click` ⇒ 无监听协议 |
| `SEListSelectionTracker` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/SEListSelectionTracker.java` | `[~]` | 选中项追踪（上下键 + 回车）：`src/components/SearchEverywhereDialog.vue` 的键盘处理；还差上游的「选中变化 → 触发预览」的时序（异步预览加载） |
| `SENewUIHeaderView` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/SENewUIHeaderView.kt` | `[-]` | 新 UI 的 header 视图（54 行，`CustomFrameDecoration` 专属）：本仓 header 是 tab 栏 + 输入框，无平台专属自绘视图 |
| `SEResultsEqualityProvider` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/SEResultsEqualityProvider.kt` | `[-]` | 结果去重（equals 判定）：本仓 `searchEverywhereResults` 按 id+来源去重，是纯函数，无 provider 类 |
| `SEResultsListFactory` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/SEResultsListFactory.java` | `[-]` | 结果列表工厂（JList + 渲染器）：同 `PSIPresentationBgRendererWrapper` |
| `SESearcher` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/SESearcher.java` | `[-]` | 搜索执行器接口：`searchEverywhereResults` 是纯函数（同步打分），无搜索器对象 |
| `SETabSwitcherListener` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/SETabSwitcherListener.kt` | `[-]` | tab 切换监听：同 `SEHeaderActionListener` |
| `ScopeChooserAction` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/ScopeChooserAction.java` | `[~]` | 作用域选择。**第九十一批已落**：`src/searchEverywhereScope.ts` 的 `scopeChoices` / `filterByScope` + `src/components/SearchEverywhereDialog.vue` 的作用域下拉（候选 =「项目」+ 项目设置里的命名作用域；只筛**文件与符号**两类，与上游只把 `ScopeChooserAction` 挂在 `TextSearchContributor` / `AbstractGotoSEContributor` 上一致）。**缺**：预定义作用域（本仓没有 `CustomScopesProvider`，见 `docs/class-parity-todo.md` §4）与 Swing 那一格 `ActionButtonWithText` 的 Ctrl+Alt+P 切换。 |
| `ScopeSupporting` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/ScopeSupporting.java` | `[~]` | 支持作用域的动作接口。本仓的等价物是 `src/searchEverywhereScope.ts` 的 `filterByScope` 谓词 —— 传进 `searchEverywhereResults` 的第六个实参，只作用于文件/符号来源。 |
| `SearchAdapter` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/SearchAdapter.kt` | `[-]` | 搜索适配器：四个供给者的数据直接进 items，无需适配 |
| `SearchEventsBuffer` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/SearchEventsBuffer.kt` | `[-]` | 搜索事件缓冲（打字节流）：本仓用 computed + 防抖直接实现，无事件缓冲类 |
| `SearchEverywhereActions` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/SearchEverywhereActions.java` | `[-]` | 搜索框内的动作常量类：`src/components/SearchEverywhereDialog.vue` 直接绑键 |
| `SearchEverywhereContributorModule` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/SearchEverywhereContributorModule.kt` | `[-]` | 贡献者的模块声明（供插件依赖检查）：本仓供给者是硬编码的四个，无模块系统 |
| `SearchEverywhereContributorValidationRule` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/SearchEverywhereContributorValidationRule.java` | `[-]` | 贡献者校验规则（插件贡献的贡献者是否合法）：无插件贡献者 ⇒ 无校验 |
| `SearchEverywhereContributorWrapper` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/SearchEverywhereContributorWrapper.kt` | `[-]` | 贡献者包装（改权重/加过滤）：本仓的权重在 `rankingWeight` 一处算，无包装层 |
| `SearchEverywhereCoroutineScopeService` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/SearchEverywhereCoroutineScopeService.kt` | `[-]` | 搜索的协程作用域：无协程层 |
| `SearchEverywhereDataUtils` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/SearchEverywhereDataUtils.kt` | `[-]` | 搜索数据的工具方法（去重/截断）：去重与截断在 `searchEverywhereResults` 内联 |
| `SearchEverywhereEmptyTextProvider` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/SearchEverywhereEmptyTextProvider.kt` | `[~]` | 无结果时的空态文案。**第九十一批已落**：`src/searchEverywhereEmpty.ts` 的 `searchEverywhereEmptyText` + `src/components/SearchEverywhereDialog.vue` 的空态块（主行「找不到任何内容」+ 用过选项时才有的「使用的搜索选项：」那一行 + 一条去工程内查找的出路）。分档规则照 `SearchEverywhereUI.java:1926-2011`：有 `SearchEverywhereEmptyTextProvider` 实现者的 tab（本树里只有 `TextSearchContributor.kt:281-300`，对应 All/Project）用实现者文案，其余走通用分支。**缺**：上游的多段 swing `StatusText`（本仓是一段结构化文本）。 |
| `SearchEverywhereFeature` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/SearchEverywhereFeature.kt` | `[x]` | feature 门控 + 预热那一层：`src/searchEverywhereHost.ts` 的 `SEARCH_EVERYWHERE_SYMBOL_MIN` 门槛 与两处防抖（符号 120ms / 文件刷新 200ms）即为等价行为 —— 上游用 feature flag 决定要不要预热，本仓数据都是本地同步的（文件清单、菜单表、运行配置表），预热没有可等的对象 |
| `SearchEverywhereFiltersAction` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/SearchEverywhereFiltersAction.java` | `[-]` | 过滤器动作（按类型筛选结果）：本仓用 tab 切档，不用过滤器按钮 |
| `SearchEverywhereFiltersStatisticsCollector` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/SearchEverywhereFiltersStatisticsCollector.java` | `[-]` | 使用统计/遥测：本仓不采集遥测 ⇒ 无对应物 |
| `SearchEverywhereFoundElementInfo` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/SearchEverywhereFoundElementInfo.java` | `[-]` | 同 `FoundItemDescriptor` |
| `SearchEverywhereHeader` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/SearchEverywhereHeader.java` | `[~]` | 搜索头部：`src/components/SearchEverywhereDialog.vue` 的输入框 + tab 行；还差上游 570 行里的独立 header 视图（与结果列表的列头、宽度拖拽） |
| `SearchEverywhereLanguage` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/SearchEverywhereLanguage.kt` | `[-]` | 搜索的语言集成标记（决定用哪套贡献者）：本仓 tab 与语言无关（符号走 LSP） |
| `SearchEverywhereManager` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/SearchEverywhereManager.java` | `[~]` | `src/searchEverywhereHost.ts` 持有数据 + `src/App.vue` 的 `searchEverywhereOpen` 开关；还差上游的会话级搜索历史（`SearchEverywhereManagerImpl.kt` 的 typedSearchHistory）与快捷键注册 |
| `SearchEverywhereManagerImpl` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/SearchEverywhereManagerImpl.java` | `[~]` | 同 `SearchEverywhereManager`：弹层的开合、数据装配、查询词分发在 `src/searchEverywhereHost.ts`；上游那 495 行里的 coroutine scope / 快捷键 / 重新排序服务未做 |
| `SearchEverywhereMixedListInfo` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/SearchEverywhereMixedListInfo.kt` | `[-]` | 同 `MixedListInfo` |
| `SearchEverywhereMlContributorReplacement` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/SearchEverywhereMlContributorReplacement.kt` | `[-]` | ML 排序（本地模型服务）：本仓排序是纯确定性的分数（`src/searchEverywhere.ts` 的 `rankingWeight`），刻意不引入 ML ⇒ 无对应物 |
| `SearchEverywhereMlService` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/SearchEverywhereMlService.kt` | `[-]` | ML 排序（本地模型服务）：本仓排序是纯确定性的分数（`src/searchEverywhere.ts` 的 `rankingWeight`），刻意不引入 ML ⇒ 无对应物 |
| `SearchEverywhereMlTabsCustomizationStrategy` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/SearchEverywhereMlTabsCustomizationStrategy.kt` | `[-]` | ML 排序（本地模型服务）：本仓排序是纯确定性的分数（`src/searchEverywhere.ts` 的 `rankingWeight`），刻意不引入 ML ⇒ 无对应物 |
| `SearchEverywhereNavigationHandler` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/SearchEverywhereNavigationHandler.kt` | `[~]` | 导航处理器（打开选中的项）：`src/searchEverywhereHost.ts` 的打开动作；还差各类型各自的导航（类跳到文件、运行配置启动） |
| `SearchEverywherePopupInstance` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/SearchEverywherePopupInstance.kt` | `[-]` | 弹层实例（供外部拿到当前弹层）：本仓由 `src/App.vue` 的 `searchEverywhereOpen` 持有 |
| `SearchEverywherePreview` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/SearchEverywherePreview.kt` | `[x]` | `src/searchEverywhere.ts` 的预览字段 + `src/components/SearchEverywhereDialog.vue` 的「预览」tab（`SearchEverywhereItem.preview` / `previewText`，由 `src/searchEverywhereHost.ts` 从符号/文件供给） |
| `SearchEverywherePreviewFetcher` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/SearchEverywherePreviewFetcher.kt` | `[-]` | 远程预览抓取器：同「远程开发」 |
| `SearchEverywherePreviewGenerator` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/SearchEverywherePreviewGenerator.kt` | `[~]` | 预览生成：`src/searchEverywhereHost.ts` 的预览字段 + `src/components/SearchEverywhereDialog.vue` 的预览 pane；还差上游的多来源预览（符号 doc / diff / usage） |
| `SearchEverywherePreviewPrimaryUsageFinder` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/SearchEverywherePreviewPrimaryUsageFinder.kt` | `[-]` | 预览的主用量查找：预内容就是那一条，无用量语义 |
| `SearchEverywhereRemoteSupportServiceImpl` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/SearchEverywhereRemoteSupportServiceImpl.kt` | `[-]` | 远程开发（Gateway/remote dev）那套：本仓是纯本地单窗口宿主，无远程后端 ⇒ 无对应物 |
| `SearchEverywhereReorderingService` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/SearchEverywhereReorderingService.kt` | `[-]` | 结果重排服务：**上游本树里只有 EP 定义、没有任何实现**（`intellij.platform.lang.impl.xml:240` 注册 `com.intellij.searchEverywhereReorderingService`，全树 grep 只有接口文件与一个消费点 `MixedSearchListModel.java`）。上一版把它记成"用户手动调顺序并记住"是错的 —— 那是插件才能提供的能力，CE 里没有。 |
| `SearchEverywhereResultsNotifier` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/SearchEverywhereResultsNotifier.kt` | `[-]` | 结果通知器：同 `SearchListener` |
| `SearchEverywhereTabsShortcutsUtils` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/SearchEverywhereTabsShortcutsUtils.kt` | `[-]` | tab 快捷键工具（数字键切 tab）：本仓 tab 用鼠标点击切换，无数字键快捷键 |
| `SearchEverywhereToolbarField` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/SearchEverywhereToolbarField.kt` | `[~]` | `src/components/SearchEverywhereDialog.vue` 的输入框（`se-input` + 防抖 + Esc/Enter 键）；还差上游的 field 校验态与「无结果」空态文案（`SearchEverywhereEmptyTextProvider`） |
| `SearchEverywhereUI` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/SearchEverywhereUI.java` | `[~]` | `src/components/SearchEverywhereDialog.vue`（256 行）+ `src/searchEverywhere.ts`（205 行）：四个 tab、输入框、结果列表、键盘导航、预览 pane 都在；还差上游的 ML 排序、分栏宽度可拖、header 视图（`SearchEverywhereHeader.kt` 570 行） |
| `SearchEverywhereWarmupActivity` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/SearchEverywhereWarmupActivity.kt` | `[-]` | 后台预热（Headless 活动）：本仓打开即用，不预热 ⇒ 不适用 |
| `SearchHistoryList` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/SearchHistoryList.kt` | `[-]` | 搜索历史列表：同 `SEHistoryManager` |
| `SearchListModel` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/SearchListModel.java` | `[-]` | 搜索结果列表模型：同 `MixedSearchListModel` |
| `SearchListener` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/SearchListener.java` | `[-]` | 搜索监听（结果/进度回调）：查询是同步 recompute，无回调协议 |
| `SearchListenerEx` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/SearchListenerEx.java` | `[-]` | 扩展搜索监听：同 `SearchListener` |
| `SearchProcessLogger` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/SearchProcessLogger.kt` | `[-]` | 搜索过程日志：无遥测/调试日志 ⇒ 无对应物 |
| `SearchRestartReason` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/SearchRestartReason.java` | `[-]` | 重启搜索的原因枚举：搜索无重启语义（同步重算） |
| `SlowContributorDetector` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/SlowContributorDetector.kt` | `[-]` | 慢贡献者探测器：同上，无速度差需要区分 |
| `SplitSearchAdapter` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/SplitSearchAdapter.kt` | `[-]` | 分档搜索适配器：同 `SearchAdapter` |
| `SplitSearchListener` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/SplitSearchListener.kt` | `[-]` | 分档搜索监听：同 `SearchAdapter` |
| `SymbolSearchEverywhereContributor` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/SymbolSearchEverywhereContributor.java` | `[x]` | 符号贡献者：`src/searchEverywhereHost.ts` 用 LSP `workspace/symbol` （与「转到符号」同一个请求、同一个 ≥2 字防抖门槛） |
| `ThrottlingListenerWrapper` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/ThrottlingListenerWrapper.java` | `[-]` | 节流监听包装：同 `SearchEventsBuffer` |
| `TopHitSEContributor` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/TopHitSEContributor.java` | `[-]` | 「最常用」贡献器（LRU 排序）：本仓无使用频次统计 ⇒ 无该档 |
| `TrivialElementsEqualityProvider` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/TrivialElementsEqualityProvider.java` | `[-]` | 同 `SEResultsEqualityProvider` |
| `Utils` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/Utils.kt` | `[-]` | actionSystem 的 Utils（1557 行）：Swing 专用工具集 ⇒ 本域无对应物 |
| `WaitForContributorsListenerWrapper` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/WaitForContributorsListenerWrapper.java` | `[-]` | 等待贡献者的监听包装：同 `SearchEventsBuffer` |
| `ActionExtendedInfo` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/footer/ActionExtendedInfo.kt` | `[-]` | 同 `ActionExtendedInfo` |
| `ExtendedInfoImpl` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/footer/ExtendedInfoImpl.kt` | `[-]` | 同 `ActionExtendedInfo`（上游用 JPanel 渲染 ⇒ 本仓更没有） |
| `SEHistoryManager` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/footer/SEHistoryManager.kt` | `[-]` | 搜索历史管理（`SearchEverywhereManager` 的历史组件）：本仓不存搜索历史 ⇒ 无对应物 |
| `AlignmentMatrix` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/fuzzyMatching/AlignmentMatrix.kt` | `[x]` | `src/fuzzyMatch.ts` 的 DP 表 + 回溯：tie 顺序 DIAGONAL > UP > LEFT > ZERO 与上游 `AlignmentMatrix.kt:50-56` 的 computeCell 一致；判据 `tests/fuzzy-match.test.mjs` |
| `ScoringParameters` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/fuzzyMatching/ScoringParameters.kt` | `[x]` | `src/fuzzyMatch.ts` 的 `DEFAULT_SCORING_PARAMETERS`：matchScore 16 / mismatchPenalty 0 / gapPenalty −1 / firstCharBonus 8 / consecutiveBonus 6 / camelCaseBonus 7 / separatorBonus 8，逐项对齐 `ScoringParameters.kt:18-60` |
| `SmithWatermanAlgorithm` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/fuzzyMatching/SmithWatermanAlgorithm.kt` | `[x]` | `src/fuzzyMatch.ts` 的 `fuzzyMatch`：本地对齐 DP + bonus 计算（`SmithWatermanAlgorithm.kt:116-154` 的 firstChar/consecutive/camelCase/separator 四档）+ `calculateMaxPossibleScore`（:175-186）归一化；判据 `tests/fuzzy-match.test.mjs` 9 条 |
| `Presentations` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/remote/Presentations.kt` | `[-]` | Presentation 的表格渲染：`src/menus/fileMenu.ts` 等 18 个菜单模块 直接出 `MenuRow[]`，无中间表格对象 |
| `ResultsGraph` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/setesting/ResultsGraph.kt` | `[-]` | 结果权重图（调试用可视化，`JComponent`+`JBColor` 自绘）：内部调试工具 ⇒ 不适用 |
| `SETester` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/setesting/SETester.kt` | `[-]` | 上游内部测试面板/开关：不是用户功能 ⇒ 不适用 |
| `SETestingPanel` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/setesting/SETestingPanel.kt` | `[-]` | 上游内部测试面板/开关：不是用户功能 ⇒ 不适用 |
| `TestSearchEverywhereAction` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/setesting/TestSearchEverywhereAction.kt` | `[-]` | 上游内部测试面板/开关：不是用户功能 ⇒ 不适用 |
| `package-info` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/setesting/package-info.java` | `[-]` | 包说明文件：非类，无行为 |
| `SearchEverywhereUsageTriggerCollector` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/statistics/SearchEverywhereUsageTriggerCollector.java` | `[-]` | 使用统计/遥测：本仓不采集遥测 ⇒ 无对应物 |
| `SearchFieldStatisticsCollector` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/statistics/SearchFieldStatisticsCollector.java` | `[-]` | 使用统计/遥测：本仓不采集遥测 ⇒ 无对应物 |
| `SearchPerformanceTracker` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/statistics/SearchPerformanceTracker.kt` | `[-]` | 使用统计/遥测：本仓不采集遥测 ⇒ 无对应物 |
| `SearchingProcessStatisticsCollector` | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/statistics/SearchingProcessStatisticsCollector.kt` | `[-]` | 使用统计/遥测：本仓不采集遥测 ⇒ 无对应物 |
| `CalculatorSEContributorTest` | `platform/lang-impl/testSources/com/intellij/ide/actions/searcheverywhere/CalculatorSEContributorTest.kt` | `[-]` | 上游 testSources 类：本仓测试策略不同（判据在 `tests/*.test.mjs`），无对应物 |
| `HeaderTabsTest` | `platform/lang-impl/testSources/com/intellij/ide/actions/searcheverywhere/HeaderTabsTest.kt` | `[-]` | 上游 testSources 类：本仓测试策略不同（判据在 `tests/*.test.mjs`），无对应物 |
| `MixingMultiThreadSearchTest` | `platform/lang-impl/testSources/com/intellij/ide/actions/searcheverywhere/MixingMultiThreadSearchTest.kt` | `[-]` | 上游 testSources 类：本仓测试策略不同（判据在 `tests/*.test.mjs`），无对应物 |
| `NonIndexableFilesSEContributorTest` | `platform/lang-impl/testSources/com/intellij/ide/actions/searcheverywhere/NonIndexableFilesSEContributorTest.kt` | `[-]` | 上游 testSources 类：本仓测试策略不同（判据在 `tests/*.test.mjs`），无对应物 |
| `PSIPresentationBgRendererWrapperTest` | `platform/lang-impl/testSources/com/intellij/ide/actions/searcheverywhere/PSIPresentationBgRendererWrapperTest.kt` | `[-]` | 上游 testSources 类：本仓测试策略不同（判据在 `tests/*.test.mjs`），无对应物 |
| `PathFromRootResolverTest` | `platform/lang-impl/testSources/com/intellij/ide/actions/searcheverywhere/PathFromRootResolverTest.kt` | `[-]` | 上游 testSources 类：本仓测试策略不同（判据在 `tests/*.test.mjs`），无对应物 |
| `SETestUtil` | `platform/lang-impl/testSources/com/intellij/ide/actions/searcheverywhere/SETestUtil.kt` | `[-]` | 上游 testSources 类：本仓测试策略不同（判据在 `tests/*.test.mjs`），无对应物 |
| `SearchBufferedListenersTest` | `platform/lang-impl/testSources/com/intellij/ide/actions/searcheverywhere/SearchBufferedListenersTest.kt` | `[-]` | 上游 testSources 类：本仓测试策略不同（判据在 `tests/*.test.mjs`），无对应物 |
| `SearchEverywhereNavigationHandlerTest` | `platform/lang-impl/testSources/com/intellij/ide/actions/searcheverywhere/SearchEverywhereNavigationHandlerTest.kt` | `[-]` | 上游 testSources 类：本仓测试策略不同（判据在 `tests/*.test.mjs`），无对应物 |
| `SearchEverywhereToolbarFieldsTest` | `platform/lang-impl/testSources/com/intellij/ide/actions/searcheverywhere/SearchEverywhereToolbarFieldsTest.kt` | `[-]` | 上游 testSources 类：本仓测试策略不同（判据在 `tests/*.test.mjs`），无对应物 |
| `SearchModelTest` | `platform/lang-impl/testSources/com/intellij/ide/actions/searcheverywhere/SearchModelTest.java` | `[-]` | 上游 testSources 类：本仓测试策略不同（判据在 `tests/*.test.mjs`），无对应物 |
| `TextSearchContributorTest` | `platform/lang-impl/testSources/com/intellij/ide/actions/searcheverywhere/TextSearchContributorTest.kt` | `[-]` | 上游 testSources 类：本仓测试策略不同（判据在 `tests/*.test.mjs`），无对应物 |
| `AbbreviationManager` | `platform/platform-api/src/com/intellij/openapi/actionSystem/AbbreviationManager.java` | `[~]` | 首字母缩写：`src/commandSearch.ts` 的 `rankCommands` + `src/menus/types.ts` 的 `keywords` 让「查找操作」能按缩写命中（`src/keymap.ts` 的 104 个绑定是显式键位，不靠缩写推导） |
| `ActionButtonComponent` | `platform/platform-api/src/com/intellij/openapi/actionSystem/ActionButtonComponent.java` | `[-]` | 按钮的 Swing 组件封装：本仓 stripe 按钮是 DOM + CSS |
| `ActionGroupStub` | `platform/platform-api/src/com/intellij/openapi/actionSystem/ActionGroupStub.kt` | `[-]` | （见 §A 组）XML 存根 ⇒ 无动作声明文件 |
| `ActionGroupWrapper` | `platform/platform-api/src/com/intellij/openapi/actionSystem/ActionGroupWrapper.kt` | `[-]` | 包装层：TaoCode 的菜单行没有「原始组 + 包装」两层结构，`MenuRow` 直接就是行 |
| `ActionId` | `platform/platform-api/src/com/intellij/openapi/actionSystem/ActionId.kt` | `[-]` | 动作 id 类（`ActionId.of(...)`）：TaoCode 的菜单 id 是裸字符串（`src/menus/types.ts`） |
| `ActionInGroup` | `platform/platform-api/src/com/intellij/openapi/actionSystem/ActionInGroup.java` | `[-]` | 「动作在组内」的查询结构：本仓菜单是静态树，查询靠遍历 `src/menus/submenuState.ts` |
| `ActionPromoter` | `platform/platform-api/src/com/intellij/openapi/actionSystem/ActionPromoter.java` | `[-]` | 动作位置提升（把搜索结果排到前面）：TaoCode 的排序是纯分数（`src/searchEverywhere.ts`），无提升器 |
| `ActionStub` | `platform/platform-api/src/com/intellij/openapi/actionSystem/ActionStub.java` | `[-]` | 动作 XML 存根：无动作声明文件（`src/menus/fileMenu.ts` 等 18 个菜单模块 手写） |
| `ActionToolbarPosition` | `platform/platform-api/src/com/intellij/openapi/actionSystem/ActionToolbarPosition.java` | `[-]` | 工具栏位置枚举（TOP/BOTTOM/…）：本仓工具栏位置是布局的一部分（`src/toolWindowMeta.ts` 的锚点），无独立枚举 |
| `ActionWrapperUtil` | `platform/platform-api/src/com/intellij/openapi/actionSystem/ActionWrapperUtil.kt` | `[-]` | 动作包装的工具方法（补全 id 等）：本仓无动作包装层 |
| `AnActionHolder` | `platform/platform-api/src/com/intellij/openapi/actionSystem/AnActionHolder.java` | `[-]` | 持有 AnAction 的小容器：菜单数据里就是行本身 |
| `AnActionWrapper` | `platform/platform-api/src/com/intellij/openapi/actionSystem/AnActionWrapper.kt` | `[-]` | 包装 AnAction（隐藏 id 等）：无对应结构 |
| `Anchor` | `platform/platform-api/src/com/intellij/openapi/actionSystem/Anchor.java` | `[x]` | ActionToolbar 的停靠位：`src/menus/toolWindowGear.ts` 与 `src/toolWindowMeta.ts` 的工具窗口齿轮菜单按锚点分组 |
| `CheckedActionGroup` | `platform/platform-api/src/com/intellij/openapi/actionSystem/CheckedActionGroup.java` | `[-]` | 勾选组：`MenuRow.checked` 只支持单行勾选，三态组无消费者 |
| `CommonShortcuts` | `platform/platform-api/src/com/intellij/openapi/actionSystem/CommonShortcuts.java` | `[x]` | 常用键位常量表：`src/keymap.ts` 里逐条对应（Ctrl+S / Ctrl+Z / Ctrl+Shift+Z / Ctrl+F / Ctrl+Shift+N / F12 / Shift+Shift…），全部查过 `$default.xml` |
| `CompositeShortcutSet` | `platform/platform-api/src/com/intellij/openapi/actionSystem/CompositeShortcutSet.java` | `[-]` | 多套快捷键求并：`src/keymap.ts` 的 if 链就是并集，但无「可组合的集」这一层 |
| `Constraints` | `platform/platform-api/src/com/intellij/openapi/actionSystem/Constraints.java` | `[-]` | 组件尺寸约束：布局交给 CSS flex/grid，不建约束对象 |
| `DataConstants` | `platform/platform-api/src/com/intellij/openapi/actionSystem/DataConstants.java` | `[-]` | DataKey 的 id 常量表：无键名表 ⇒ 无对应物 |
| `DecorativeElement` | `platform/platform-api/src/com/intellij/openapi/actionSystem/DecorativeElement.kt` | `[-]` | 装饰元素（菜单里的非动作格）：分隔靠 `section`，无装饰格 |
| `DefaultActionGroup` | `platform/platform-api/src/com/intellij/openapi/actionSystem/DefaultActionGroup.java` | `[~]` | `src/menus/fileMenu.ts` 等 18 个菜单模块就是它的实例表（每个模块导出一个 `MenuRow[]`，即一个 ActionGroup）；上游 622 行里的 separator 集合、`disableAll`、popup 判定未做（`section` 字段是简化替代） |
| `DefaultCompactActionGroup` | `platform/platform-api/src/com/intellij/openapi/actionSystem/DefaultCompactActionGroup.java` | `[-]` | 紧凑菜单组是 Toolbar 用的（`isCompact`），TaoCode 的主菜单不区分紧凑/普通档 ⇒ 无对应物 |
| `EmptyAction` | `platform/platform-api/src/com/intellij/openapi/actionSystem/EmptyAction.java` | `[-]` | 不渲染的动作占位：菜单行不写即等价 |
| `EmptyActionGroup` | `platform/platform-api/src/com/intellij/openapi/actionSystem/EmptyActionGroup.java` | `[-]` | 空组占位：菜单数据里不写空组即等价，`src/menus/fileMenu.ts` 等 18 个菜单模块 无此概念 |
| `KeyboardGestureAction` | `platform/platform-api/src/com/intellij/openapi/actionSystem/KeyboardGestureAction.java` | `[-]` | 键盘手势动作（macOS 上等同快捷键）：本仓无手势/触控板交互 |
| `KeyboardModifierGestureShortcut` | `platform/platform-api/src/com/intellij/openapi/actionSystem/KeyboardModifierGestureShortcut.java` | `[-]` | 修饰键手势（Ctrl+A 这类组合的抽象）：`src/keymap.ts` 的绑定是 `(modifiers, key)` 直接比较，无 Shortcut 对象 ⇒ 无对应物 |
| `MacOtherAction` | `platform/platform-api/src/com/intellij/openapi/actionSystem/MacOtherAction.java` | `[-]` | macOS 的「其他」菜单项位置特例：本仓不区分 macOS/Windows/Linux 的菜单项位置规则 |
| `MouseShortcut` | `platform/platform-api/src/com/intellij/openapi/actionSystem/MouseShortcut.java` | `[-]` | 鼠标快捷键（点右键之外的组合）：本仓菜单只有左键点击与悬停，无鼠标键位动作 |
| `PerformWithDocumentsCommitted` | `platform/platform-api/src/com/intellij/openapi/actionSystem/PerformWithDocumentsCommitted.java` | `[-]` | 执行前先提交文档：`src/editorCommands.ts` 的命令各自处理保存时机，无统一注解 |
| `PlatformDataKeys` | `platform/platform-api/src/com/intellij/openapi/actionSystem/PlatformDataKeys.java` | `[~]` | 平台数据键：`src/menus/toolWindowGear.ts` 与 `src/explorerActions.ts` 的动作直接读当前选中的路径/文件，等价于 PlatformDataKeys 的取值，但无键名表 |
| `PopupAction` | `platform/platform-api/src/com/intellij/openapi/actionSystem/PopupAction.java` | `[~]` | 弹出动作（点开一个浮层再执行）：`src/menuUi.ts` 的子菜单浮层 + `src/components/EditorPopupMenu.vue`/`src/toolWindowActions.ts` 里的浮层动作都走这条 |
| `PressureShortcut` | `platform/platform-api/src/com/intellij/openapi/actionSystem/PressureShortcut.java` | `[-]` | 压感笔快捷键：触屏/笔输入未支持 ⇒ 无对应物 |
| `Separator` | `platform/platform-api/src/com/intellij/openapi/actionSystem/Separator.java` | `[-]` | Swing 分隔组件（`JSeparator`）：菜单是 DOM，CSS 边界即分隔 |
| `ToggleAction` | `platform/platform-api/src/com/intellij/openapi/actionSystem/ToggleAction.java` | `[~]` | `src/menus/types.ts` 的 `checked?: () => boolean`：勾选态随打开时重算（同上游 update 语义）；还差 `isSelected` 的三态与 `setSelected` 的反向通知 |
| `ToggleOptionAction` | `platform/platform-api/src/com/intellij/openapi/actionSystem/ToggleOptionAction.java` | `[-]` | 选项切换动作：工具窗口 stripe 的显隐有 `toggle` 语义，但走 `src/toolWindowActions.ts` 的开关函数，非动作类 |
| `Toggleable` | `platform/platform-api/src/com/intellij/openapi/actionSystem/Toggleable.java` | `[x]` | ToggleAction 的 isSelected/update：菜单行用 `checked?: () => boolean`（`src/menus/types.ts`），分布式的勾选项（侧条显隐、面包屑、软换行…）都走它；真机取证见 docs/ui-placement-audit.md |
| `ActionContextElement` | `platform/platform-api/src/com/intellij/openapi/actionSystem/ex/ActionContextElement.kt` | `[-]` | 上下文元素（Swing 组件 + DataContext）：TaoCode 的动作闭包直读状态，无此包装 |
| `ActionCopiedShortcutsTracker` | `platform/platform-api/src/com/intellij/openapi/actionSystem/ex/ActionCopiedShortcutsTracker.kt` | `[-]` | 「复制快捷键」后高亮的追踪器：无复制快捷键功能 ⇒ 无对应物 |
| `ActionManagerEx` | `platform/platform-api/src/com/intellij/openapi/actionSystem/ex/ActionManagerEx.kt` | `[-]` | 动作管理器的扩展接口（`ActionManagerEx.getInstanceEx`）：本仓无第三方动作注册方 ⇒ 无对应物 |
| `ActionPopupMenuListener` | `platform/platform-api/src/com/intellij/openapi/actionSystem/ex/ActionPopupMenuListener.java` | `[-]` | 弹出菜单监听：浮层的开关由 Vue 状态驱动，无监听器 |
| `ActionUtil` | `platform/platform-api/src/com/intellij/openapi/actionSystem/ex/ActionUtil.kt` | `[-]` | 动作工具集（803 行，遍历 Swing 组件树/找按钮）：本仓无组件树，动作以数据形式存在 |
| `CheckboxAction` | `platform/platform-api/src/com/intellij/openapi/actionSystem/ex/CheckboxAction.java` | `[-]` | 勾选框组件动作：勾选态用菜单行左侧的勾号（`checked` 字段 + CSS），不是嵌入组件 |
| `ComboBoxAction` | `platform/platform-api/src/com/intellij/openapi/actionSystem/ex/ComboBoxAction.java` | `[-]` | 下拉组件动作（427 行）：本仓用子菜单表达同一交互（`children`），无内嵌 combo |
| `DefaultCustomComponentAction` | `platform/platform-api/src/com/intellij/openapi/actionSystem/ex/DefaultCustomComponentAction.java` | `[-]` | 同 `CustomComponentAction` 的默认实现 |
| `ThreeStateCheckboxAction` | `platform/platform-api/src/com/intellij/openapi/actionSystem/ex/ThreeStateCheckboxAction.java` | `[-]` | 三态勾选：菜单勾号只有两态 |
| `TooltipDescriptionProvider` | `platform/platform-api/src/com/intellij/openapi/actionSystem/ex/TooltipDescriptionProvider.java` | `[-]` | 动作悬停长描述：`MenuRow` 未提供 `description` 字段 ⇒ 无对应物 |
| `TooltipLinkProvider` | `platform/platform-api/src/com/intellij/openapi/actionSystem/ex/TooltipLinkProvider.java` | `[-]` | 悬停提示里的链接（帮助主题）：本仓悬停是 CSS `title` ⇒ 无链接提供器 |
| `ActionGroupUtil` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/ActionGroupUtil.java` | `[-]` | 菜单组工具方法（取 popup 链、算 id）：`src/menus/submenuState.ts` 只留了需要的部分，其余是 Swing `JComponent` 遍历 |
| `ActionUpdaterInterceptor` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/ActionUpdaterInterceptor.kt` | `[-]` | 更新拦截器：TaoCode 的 `enabled`/`checked` 就是纯函数，没有拦截层 |
| `AnActionExtensionProvider` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/AnActionExtensionProvider.java` | `[-]` | 插件动作扩展点：TaoCode 的插件只贡献命令（`src/pluginCommands.ts`），无 action 扩展点 |
| `ExtendableAction` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/ExtendableAction.java` | `[-]` | 可扩展动作基类（供插件注册）：`src/pluginCommands.ts` 的插件菜单是另一条路，不走这个基类 |
| `RegistryToggleAction` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/RegistryToggleAction.java` | `[~]` | 注册表键开关动作：`src/components/GeneralRegistryToggles.vue` 把上游只有注册表键、没有设置页入口的两项（`autoShowProcessPopup`、`search.everywhere.fuzzy.files.enabled`）升格为持久化开关 —— 这正是 `RegistryToggleAction` 的语义在本仓的落点 |
| `SplitButtonAction` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/SplitButtonAction.java` | `[-]` | 分裂按钮（主区 + 下拉区，345 行自绘）：本仓工具窗口 stripe 按钮只有单一动作；「工具窗口齿轮」是独立的溢出按钮（`src/menus/toolWindowGear.ts`）而不是分裂按钮的另一半 |
| `ActionButtonLook` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/ex/ActionButtonLook.java` | `[-]` | 按钮外观（199 行，选中/悬停/禁用三态的自绘）：本仓用 CSS 表达三态 ⇒ 无自绘外观类 |
| `QuickList` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/ex/QuickList.java` | `[-]` | 快速列表（右键一组动作）：本仓的「最近操作」是菜单行的 `recent` 标记（`src/menus/types.ts`），不是独立的 QuickList 面板 |
| `QuickListsManager` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/ex/QuickListsManager.kt` | `[-]` | 快速列表管理：同 `QuickList` |
| `ToolbarLabelAction` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/ex/ToolbarLabelAction.java` | `[-]` | 工具栏文字标签动作：本仓 stripe 按钮只有图标 |
| `AbbreviationManagerImpl` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/AbbreviationManagerImpl.java` | `[-]` | 缩写计算的完整实现（含设置页的定制缩写）：TaoCode 用 `keywords` 字段显式声明，不做「从标题自动推缩写 + 用户覆盖」的机制 |
| `ActionButton` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/ActionButton.java` | `[~]` | 工具窗口 stripe 按钮：`src/toolWindowStripes.ts` + `src/components/ToolWindowView.vue` 的按钮集合（含数字角标 Alt+1..9、悬停激活）；还差上游 `ActionButton` 的三档外观（`ActionButtonLook`）、按住拖出、`ActionButtonWithText` 的文字变体 |
| `ActionButtonUtil` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/ActionButtonUtil.kt` | `[-]` | 按钮工具方法：`src/toolWindowStripes.ts` 只留了角标计算那部分 |
| `ActionButtonWithText` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/ActionButtonWithText.java` | `[-]` | 带文字的按钮变体：本仓 stripe 只有图标按钮 |
| `ActionConfigurationCustomizer` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/ActionConfigurationCustomizer.kt` | `[-]` | 动作的配置期定制钩子：`src/menus/fileMenu.ts` 等 18 个菜单模块 写死菜单，无定制钩子 |
| `ActionExecutionSupport` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/ActionExecutionSupport.kt` | `[-]` | 动作执行前的 UI 准备（提交文档、跑 before）：`src/editorCommands.ts` 的命令各自处理提交，无统一支撑类 |
| `ActionGroupStub` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/ActionGroupStub.kt` | `[-]` | （见 §A 组）XML 存根 ⇒ 无动作声明文件 |
| `ActionManagerImpl` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/ActionManagerImpl.kt` | `[~]` | 同 `ActionManager`（`src/menuUi.ts` 的 `actionList` + `src/commandSearch.ts`）；上游 810 行里的 XML 装载、监听广播、`ActionManagerEx` 扩展面未做，且标了 Headless（本仓是 GUI 宿主，那部分判据对本域不成立） |
| `ActionManagerRegistration` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/ActionManagerRegistration.kt` | `[-]` | 动作注册流程（校验 id/重复）：TaoCode 菜单是编译期常量，无运行时注册 |
| `ActionManagerState` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/ActionManagerState.kt` | `[-]` | 动作系统的序列化状态（`ActionManager.xml`）：无动作声明文件 ⇒ 无状态可存 |
| `ActionManagerXmlSupport` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/ActionManagerXmlSupport.kt` | `[-]` | XML 装载器：无 XML 动作声明 ⇒ 无装载器 |
| `ActionMenu` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/ActionMenu.kt` | `[~]` | 菜单实现：`src/menus/types.ts` 的树 + `src/menuUi.ts` 的 `rowTitle`/`rowEnabled`/`pickMenuRow`/子菜单浮层状态 + `src/components/EditorPopupMenu.vue`；还差上游的键盘导航、`ActionMenu` 的 725 行里的 Mnemonic/分组与加速键（`MacOtherAction` 那套） |
| `ActionMenuItem` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/ActionMenuItem.kt` | `[-]` | 菜单项组件：菜单项是数据行 + CSS，不是组件实例 |
| `ActionPluginRegistrar` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/ActionPluginRegistrar.kt` | `[-]` | 插件动作登记（1269 行）：TaoCode 插件只贡献命令字符串，不进动作系统 ⇒ 无对应物 |
| `ActionPopupMenuImpl` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/ActionPopupMenuImpl.java` | `[-]` | 弹出菜单的 Swing 实现：DOM 浮层已覆盖交互，实现层无对应物 |
| `ActionPresentationDecorator` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/ActionPresentationDecorator.java` | `[-]` | 呈现装饰器：`enabled`/`checked` 直接算，无装饰链 |
| `ActionToolbarImpl` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/ActionToolbarImpl.kt` | `[~]` | 同 `ActionToolbar`（`src/components/MainToolbar.vue` + `src/toolWindowMeta.ts`）；上游 1850 行里的布局策略族、自绘、按钮外观（`ActionButtonLook` 三档）未做 |
| `ActionToolbarPresentationFactory` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/ActionToolbarPresentationFactory.java` | `[-]` | 工具栏呈现工厂：`src/components/MainToolbar.vue` 直接渲染行，无工厂 |
| `ActionUpdater` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/ActionUpdater.kt` | `[-]` | 上游 1005 行的更新器（把 Presentation 刷进 UI 树）：TaoCode 菜单每次打开由 computed 重算，无缓存更新器 |
| `ActionUpdaterInterceptorImpl` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/ActionUpdaterInterceptorImpl.kt` | `[-]` | 拦截器默认实现：同上 |
| `ActualActionUiKind` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/ActualActionUiKind.kt` | `[-]` | 实际 UI 种类（工具栏/菜单/…）：本仓按文件分模块渲染，无统一 UI 种类判定 |
| `AsyncDataContext` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/AsyncDataContext.java` | `[-]` | 异步 DataContext：同上 |
| `AutoPopupSupportingListener` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/AutoPopupSupportingListener.java` | `[-]` | 自动弹出支持监听：无此机制 |
| `BundledQuickListsProvider` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/BundledQuickListsProvider.java` | `[-]` | 内置快速列表提供：同 `QuickList` |
| `ChameleonAction` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/ChameleonAction.java` | `[-]` | 同一动作在不同 places 有不同呈现：TaoCode 菜单按文件分模块写，不做 places 覆盖 |
| `CoreActionsPrelude` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/CoreActionsPrelude.kt` | `[-]` | 核心动作的 Kotlin DSL 声明层：TaoCode 无 DSL，菜单是手写的 TS 模块 |
| `DynamicActionConfigurationCustomizer` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/DynamicActionConfigurationCustomizer.java` | `[-]` | 动态版配置定制：同上 |
| `FieldInplaceActionButtonLook` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/FieldInplaceActionButtonLook.java` | `[-]` | 输入框内嵌按钮外观：无内嵌按钮形态 |
| `FloatingToolbar` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/FloatingToolbar.kt` | `[-]` | 浮动工具栏（编辑器的浮动工具窗）：本仓无此形态 |
| `FusAwareAction` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/FusAwareAction.java` | `[-]` | 功能开关感知的动作（动态卸载插件）：TaoCode 的插件启停是重启生效的静态表（`src/bridge.ts` 的 `plugin.setEnabled`） |
| `IdeaActionButtonLook` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/IdeaActionButtonLook.java` | `[-]` | 新外观按钮：同 `ActionButtonLook` |
| `KeymapShortcutOperation` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/KeymapShortcutOperation.kt` | `[-]` | 键位编辑操作（快捷键设置页的增删改）：TaoCode 没有快捷键设置页 ⇒ 无对应物 |
| `MacGestureAdapter` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/MacGestureAdapter.java` | `[-]` | macOS 触控板手势适配（140 行）：平台专属输入，本仓只处理键盘与鼠标点击 |
| `MenuCancelledControlFlowException` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/MenuCancelledControlFlowException.kt` | `[-]` | 菜单取消的控制流异常：本仓取消就是关掉浮层的普通分支 |
| `MenuItemPresentationFactory` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/MenuItemPresentationFactory.java` | `[-]` | 菜单项呈现工厂：`src/menus/types.ts` 的行就是呈现，无工厂 |
| `MoreActionGroup` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/MoreActionGroup.kt` | `[-]` | 「更多」溢出组：主菜单溢出走 `src/mergedMainMenu.ts` 的溢出按钮，不是靠一个 MoreActionGroup 节点 |
| `MouseGestureManager` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/MouseGestureManager.java` | `[-]` | 鼠标手势管理（拖拽手势）：本仓的拖拽是各组件自己的 drag 实现（`src/toolStripeDrag.ts`、编辑器拖拽），无统一手势管理器 |
| `PoppedIcon` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/PoppedIcon.java` | `[-]` | 弹出菜单时的图标替换（箭头叠加）：本仓子菜单用独立的展开箭头元素 |
| `PopupShowingTimeTracker` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/PopupShowingTimeTracker.kt` | `[-]` | 浮层显示时长统计：无遥测需求 ⇒ 无对应物 |
| `PreCachedDataContext` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/PreCachedDataContext.kt` | `[-]` | 预缓存 DataContext（756 行）：同上，且需要 `BaseDataContext` 的模态语义，本仓无模态框 |
| `PresentationFactory` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/PresentationFactory.java` | `[-]` | Presentation 的工厂：TaoCode 的呈现就是行对象上的字段，无工厂层 |
| `ProxyShortcutSet` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/ProxyShortcutSet.kt` | `[-]` | 代理快捷键集（随目标动作变化）：TaoCode 键位是静态表 ⇒ 无对应物 |
| `SafeIdeView` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/SafeIdeView.kt` | `[-]` | 安全视图（`SafeIdeView.getRuntime`）：JDK 内部 API 的兼容层，本仓不依赖那些内部类 |
| `StubItem` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/StubItem.java` | `[-]` | XML 存根的行：无动作声明文件 ⇒ 无对应物 |
| `ToolbarUpdater` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/ToolbarUpdater.kt` | `[-]` | 工具栏后台刷新（183 行，标了 Headless）：本仓工具栏由 Vue 响应式重算，无后台更新器 |
| `ToolbarUtils` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/ToolbarUtils.kt` | `[-]` | 工具栏尺寸工具：`src/mergedMainMenu.ts` 有等价的宽度预算逻辑，但那是溢出折叠专用，非通用工具集 |
| `Utils` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/Utils.kt` | `[-]` | actionSystem 的 Utils（1557 行）：Swing 专用工具集 ⇒ 本域无对应物 |
| `WeakTimerListener` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/WeakTimerListener.java` | `[-]` | 弱引用计时器监听：同上 |
| `Win10ActionButtonLook` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/Win10ActionButtonLook.java` | `[-]` | Win10 外观按钮（61 行，Graphics2D）：Windows 专属外观；本仓是 WebView2 + CSS，无平台专属自绘外观 ⇒ 不适用 |
| `ActionRef` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/actionholder/ActionRef.kt` | `[-]` | 对动作的弱引用：TaoCode 无动作对象生命周期，菜单行随 Vue 重建 |
| `PillBorder` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/segmentedActionBar/PillBorder.java` | `[-]` | 胶囊边框（53 行，Graphics2D 自绘）：本仓用 CSS border-radius ⇒ 无自绘边框类 |
| `SegmentedActionToolbarComponent` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/segmentedActionBar/SegmentedActionToolbarComponent.kt` | `[-]` | 分段式工具栏（237 行，自绘）：本仓 stripe 是普通图标按钮集合，无分段控件；且它标了自绘 + 平台专属装饰，与 WebView2 + CSS 不同构 |
| `SegmentedBarActionComponent` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/segmentedActionBar/SegmentedBarActionComponent.kt` | `[-]` | 分段条动作组件：同 `SegmentedActionToolbarComponent` |
| `SegmentedBarPainter` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/segmentedActionBar/SegmentedBarPainter.kt` | `[-]` | 分段条自绘（202 行，`CustomFrameDecoration` 平台专属）：本仓窗口装饰由宿主 C++ 负责（无 customFrameDecorations），不适用 |
| `SegmentedCustomAction` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/segmentedActionBar/SegmentedCustomAction.kt` | `[-]` | 分段条自定义动作：同 `SegmentedActionToolbarComponent` |
| `ToolbarActionsUpdatedListener` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/segmentedActionBar/ToolbarActionsUpdatedListener.java` | `[-]` | 工具栏动作更新监听：同上，响应式重算不需要监听器 |
| `package-info` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/segmentedActionBar/package-info.java` | `[-]` | 包说明文件：非类，无行为 |
| `ActionSystemScope` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/util/ActionSystemScope.kt` | `[-]` | 动作系统的 coroutine scope：无协程层 |
| `package-info` | `platform/platform-impl/src/com/intellij/openapi/actionSystem/util/package-info.java` | `[-]` | 包说明文件：非类，无行为 |

> **四档合计**：`[x]` 12 + `[~]` 40 + `[ ]` 2 + `[-]` 263 = **317**
>
> **第九十一批的变化**：`[ ]` → `[~]` 四类（`ScopeChooserAction` / `ScopeSupporting` / `PreviewAction` /
> `SearchEverywhereEmptyTextProvider`）；`[ ]` → `[-]` 一类（`SearchEverywhereReorderingService` ——
> 复核发现**上游本树里只有 EP 定义、没有任何实现**，上一版记的"用户手动调顺序并记住"是错的）。
