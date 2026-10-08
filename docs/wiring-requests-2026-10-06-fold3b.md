# 接线 / 判词请求 2026-10-06 · 代号 `fold3b`（折叠 / 粘性行：模块侧收尾）

本批**不改任何保留文件、不改判决簿本体**。R 段 = 判词升档/措辞订正（`docs/inventory/*.md` 与
`scripts/verdict_table.py` 归主代理）；W 段 = 宿主侧接线（`src/App.vue`、`src/components/CodeEditor.vue`
归主代理 / 组件域；`src/editorTab.ts` 非保留但接线要成套 ⇒ 一并给请求）。
每条都给「条目原文在哪一行 → 新档/改法 → 本仓证据坐标 → 上游相对路径:行号（已逐行开过）→ 要改的那一行 + 可照抄 diff」。

上游基准树（只读）：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`。

**文件归属事实**（省得主代理改错文件）：
- `docs/inventory/verdict-folding.md` 是**手写**判决（有 `## G. 逐条总表`），逐条档位**只能直接改 md**。
- `docs/inventory/verdict-platform_rest.md`（`lp/custom-folding`、`lp/sticky-lines`）是 `scripts/verdict_table.py` **生成**的：
  要改的是 py 里的 tuple（`scripts/verdict_table.py:321` 的 `lp/sticky-lines`），否则下次生成会被覆盖回旧判词。
- 本批在**非保留**模块里已经改掉三处过时行号引用（见 R3），主代理升档/重生成时别把它们改回去。

---

## R1 `verdict-folding.md` 的 16 条 `[~]` → `[x]`（磁盘全做、有键位/菜单、有判据、上游逐行核过、且该行原本未写任何"缺"）

- **条目原文位置**（手写 md 行号）：
  - `BaseExpandToLevelAction` → `docs/inventory/verdict-folding.md:185`
  - `ExpandAllToLevel1..5Action` → `:194`、`:195`、`:196`、`:197`、`:198`
  - `ExpandToLevel1..5Action` → `:203`、`:204`、`:205`、`:206`、`:207`
  - `CollapseRegionRecursivelyAction` → `:191`；`ExpandRegionRecursivelyAction` → `:202`
  - `ExpandCollapseToggleAction` → `:199`
  - `CollapseDocCommentsAction` → `:189`；`ExpandDocCommentsAction` → `:200`
- **现状**：这 16 行的判词文本**没有写任何"缺"**（只有实现指哪、照上游哪一段），却仍挂 `[~]`。逐条核过磁盘 + 上游后，
  行为面**全部落地且被命令表/Code 菜单/判据消费**。
- **新档位**：`x`。
- **本仓证据坐标**：
  - 层级族 11 条：`src/editorFolding.ts:221`（`levelPlan`）+ `:162`（`rootAtLine`）+ `:763`（`expandCaretToLevel`）
    + `:776`（`expandAllToLevel`）；命令表 `src/editorCommands.ts:272-276`（`unfold.level1..5` / `unfold.all.level1..5`）；
    Code 菜单 `src/menus/codeMenu.ts:67-73`（展开到级别）与 `:76-78`（全部展开到级别）；
    判据 `tests/editor-folding.test.mjs:113`（比 N 浅的展开、正好 N 折起、更深不动）、`:362`（键位只绑级别 1）。
  - 递归 2 条：`src/editorFolding.ts:518`/`:524`（`foldRecursively`/`unfoldRecursively`）+ `:308`（`recursiveScope`）；
    命令表 `src/editorCommands.ts:269`；判据 `tests/editor-folding.test.mjs:304`（根 + 套在里面全部，收起时根已折着换光标处展开那条）、`:48`。
  - 切换 1 条：`src/editorFolding.ts:530`（`toggleFoldAtCaret`）+ `:299`（`toggleTarget`）；命令表 `:270`；判据 `:181`。
  - 文档注释 2 条：`src/editorFolding.ts:759`/`:760`（`foldDocComments`/`unfoldDocComments`）+ `:204`（`docCommentRanges`）
    + `:197`（`isDocCommentLine`）；命令表 `:271`；判据 `:60`、`:66`、`:77`、`:90`（其 handler `CollapseExpandDocCommentsHandler` 早就是 `[x]`）。
- **上游依据（相对路径:行号，本批逐行开过）**：
  - `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/BaseExpandToLevelAction.java:43-70`
    （`:64` `relativeLevel < level → setExpanded(true)`、`:67-69` `== level → setExpanded(false)`、`:30-41` `expandAll=false` 才挑根）。
  - `.../actions/ExpandCollapseToggleAction.kt:17-25`（先 `findFoldRegionStartingAtLine`，否则 `getFoldRegionsAtOffset(...)[0]`）。
  - `.../actions/BaseFoldingHandler.java:61-86`（`getFoldRegionsForCaret` = 递归那两条的根挑法，该行 L186 已 `[x]`）。
- **要改的那一行**：md 的 185/191/194-198/199/200/202/203-207 十六行，档位 `[~]` → `[x]`（文本里"照 §A / 实现见 src/editorFolding.ts"保留，
  可在句尾补一句"磁盘已全落 + 判据 `tests/editor-folding.test.mjs`"）。
- **表尾四档计数必须同步**（`docs/inventory/verdict-folding.md:209` 现写 `[x] 10 + [~] 30 + [ ] 0 + [-] 29 = 69`）：
  这 16 条同升 ⇒ `[x]` 10 → **26**、`[~]` 30 → **14**、`[-]`/`[ ]` 不动（26+14+0+29=69）。
  **`tests/b4-verdict.test.mjs` 的门禁 4「四档计数自洽」会盯这一行**，不改计数会红。

## R2 `lp/sticky-lines`：三条"缺"已订正其二、其三转成宿主接线（档位仍 `[~]`，只改措辞）

- **条目原文位置**：`scripts/verdict_table.py:321`（tuple `"lp/sticky-lines": ("~", …)`；族映射 `:588`；产物 `docs/inventory/verdict-platform_rest.md:362`）。
- **原文结尾的三条"缺"**：`缺：把 provider 接进 src/App.vue 的顶边渲染（现路径只过通用表）；视口滚动驱动的「起始行滚出视野」语义（本仓按光标行判）；StickyLinesPass 的 daemon 合帧与按视图优先级排序`。
- **核对结果**（判词 vs 磁盘 vs 上游）：
  1. 「provider 接进 App.vue」⇒ **已过期**：`src/App.vue:544` 已把当前编辑器语言喂进 `createStickyLines`，语言 provider 表接在
     `filterStickySymbols` 前面（`src/stickyLines.ts:76`、`src/stickyLineProviders.ts`），Java 误认 `struct` 那档已无，判据 `tests/tab-sticky-lines.test.mjs`。
  2. 「视口滚动驱动的『起始行滚出视野』」⇒ **模块侧已补齐**：`stickyScopes` 已收 `firstVisibleLine`（`src/stickyLines.ts:83-84`），
     完整判据在 `src/stickyLineViewport.ts`（窗口相交 `:120-124`、最小宽度 `:100-102`、面板放不下不画 `:127-130`、外层起排满即停 `:138-155`），
     判据 `tests/sticky-line-viewport.test.mjs`。**端到端未激活**只因为宿主还没透度量（W2/W3）。
  3. 「daemon 合帧」⇒ **模块侧已补齐**：`stickyPassNeeded`/`emptyStickyPassState`（`src/stickyLineViewport.ts:188-200`，`StickyLinesCollector.kt:36-51` 的 `ModStamp.isChanged`，
     新视图第一次必跑 `:39`「always run pass on editor opening」）。
     「按视图优先级排序」⇒ **无法核实其上游出处**：对 `platform/platform-impl/.../stickyLines/` 与 `platform/lang-impl/.../codeInsight/stickyLines/`
     两目录 `grep -rni priority` 零命中（本轮再核仍零）。本仓把"档位"落成宿主传入的 `StickyView.priority` + `orderStickyViews`/`primaryStickyView`
     （`src/stickyLineViewport.ts:78-90`），模块**不替宿主编"哪个分栏在上"**；能核实的是 `StickyLinesModelImpl.java:287-296` 的比较器 +
     `StickyLinesManager.kt:15-34`/`:86-99` 的"每编辑器各算各的"。
  - **本批另发现并修了一个真缺陷**（记进判词）：`createStickyLines` 退化路径原来 `.slice(-limit)`（留最内 N）与视口路径/上游
    （留最外 N、裁最内，`VisualStickyLine.kt:21-27` + `VisualStickyLines.kt:144-148`）反向 ⇒ 已改 `.slice(0, limit)`，
    判据 `tests/sticky-lines.test.mjs`「limit 小于层数时，退化路径与视口路径留的是同一批最外层」。
- **建议改法**：档位仍留 `~`（端到端要等 W2/W3 的宿主接线），把三条"缺"整段换成上面「已过期 / 模块侧已补齐 / 无法核实」的精确表述，
  并点名"宿主缺口走 `docs/wiring-requests-2026-10-06-fold3b.md` W2/W3"。
- **要改的那一行**：`scripts/verdict_table.py:321` tuple 的第二元素（判词字符串）。族映射 `:588` 不动。

## R3 本批已改掉三处过时上游行号引用（非保留模块/测试；别改回去）

磁盘注释里三处指向参考树**不存在/错位**的行（裸文件名引用，不在锚点快照 `docs/inventory/citation-anchors.json` 里，改动零门控风险）：

| 位置 | 原引（错） | 已改为 | 参考树实证 |
|---|---|---|---|
| `src/customFoldingProviders.ts:191` | `CustomFoldingProvider.java:112-114` | `CustomFoldingProvider.java:81-83` | 该文件只 84 行；`isCollapsedByDefault` 在 `:81-83` |
| `src/customFoldingProviders.ts:38` | `CustomFoldingSurroundDescriptor.java:51` / `:262-271` | `:47`（DEFAULT_DESC_TEXT）/ `:300-304`（`?`→替换并选中） | `:51` 是"空选区返回 EMPTY"，替换在 `:300-304` |
| `tests/folding-custom-region-providers.test.mjs:16` | `CustomFoldingSurroundDescriptor.java:51` | `:47` + `:300-304` | 同一处陈旧的第二副本 |

主代理若把 `verdict-folding.md` / `verdict-platform_rest.md` 的判词往这两个数上带，请用 `:81-83` / `:47`+`:300-304`。

---

## W1 `src/components/CodeEditor.vue:917`：无区域时那条提示直接用模块导出的文案（纠正前置 folding-lane W-6 的一处不准）

- **落点**：`src/components/CodeEditor.vue`（保留文件，本批只给可照抄 diff）。
- **现状**：`src/customFoldingPopup.ts:29` 导出的 `NO_CUSTOM_REGIONS_IN_FILE = '当前文件中没有自定义的折叠'`
  （按上游中文包键 `IdeBundle.properties` 的 `goto.custom.region.message.unavailable`，`localization-zh.jar!messages/IdeBundle.properties:1107` **实机解包核实**）
  **当前零消费方**；宿主 `src/components/CodeEditor.vue:917` 写的是另一句自造措辞 `showErrorHint('这个文件里没有自定义折叠区域')`。
- **对前置 folding-lane W-6 的订正**：那条请求写"同文件 :81 已经 import 了这个模块，不用新增 import 行"——
  **不准**。`src/components/CodeEditor.vue:82` 现在是 `import { createCustomRegionsPopup } from '../customFoldingPopup'`，
  **没有**把 `NO_CUSTOM_REGIONS_IN_FILE` 具名引进来 ⇒ 必须把常量加进那条既有 import 的花括号里（仍是同一行、不新增行）。
- **可照抄 diff（两处、都是整行替换、净 0 行 —— 现有上限 1145/1147 有 2 行余量也够，且不消耗余量）**：
  ```diff
  # src/components/CodeEditor.vue:82
  -import { createCustomRegionsPopup } from '../customFoldingPopup'
  +import { createCustomRegionsPopup, NO_CUSTOM_REGIONS_IN_FILE } from '../customFoldingPopup'

  # src/components/CodeEditor.vue:917
  -            showErrorHint('这个文件里没有自定义折叠区域')
  +            showErrorHint(NO_CUSTOM_REGIONS_IN_FILE)
  ```
- **上游依据**：`platform/lang-impl/src/com/intellij/lang/customFolding/GotoCustomRegionAction.java:65`（一个区域都没有时给提示）。
- **为什么算用户可见 + 死文案**：同一件事在弹层标题、通知、文档里出现两种措辞、本地化包对不上；且 `NO_CUSTOM_REGIONS_IN_FILE` 现为孤儿导出。

## W2 `src/App.vue:544` + `src/components/CodeEditor.vue` + `src/editorTab.ts`：把面板度量喂给 `createStickyLines`（订正前置 folding-lane W-1/W-2 的行号）

> 本条**取代** `docs/wiring-requests-2026-10-06-folding.md` 的 W-1/W-2（那两条的 `App.vue:513` 已过时，现在是 `:544`）。
> 目的：让 `src/stickyLines.ts` 走视口那一层而不是退化路径；模块出口与判据都齐了（`src/stickyLineViewport.ts`、`tests/sticky-line-viewport.test.mjs`），只差宿主透三个度量。

- **1) `src/editorTab.ts:13` 的 `EditorHandle` 加一个只读出口签名**（非保留文件）：
  ```diff
    export interface EditorHandle {
      text(): string
      ...
      selectionText(): string
  +  /** 粘性行视口判据要的三度量（上游 visibleArea.y/height + editor.lineHeight，见 `VisualStickyLines.kt:60-62`、`:71-74`）；拿不到就留 undefined。 */
  +  stickyMetrics(): { firstVisibleLine?: number; lineHeight?: number; viewportHeight?: number }
  ```
- **2) `src/components/CodeEditor.vue` 的 `defineExpose({ … })`（块起于 `:423`）里加一个属性**：在该对象字面量里追加一行
  ```ts
  stickyMetrics: () => view ? { firstVisibleLine: view.doc.lineAt(view.viewport.from).number, lineHeight: view.defaultBlock.height || undefined, viewportHeight: view.viewport.height } : {},
  ```
  （`view` 是 `src/components/CodeEditor.vue:105` 的 `let view: EditorView | undefined`。
  **这是 1 行新增**：现在 1145/1147，只有 2 行余量 ⇒ 单行可进；若主代理要把度量拆成多行小函数，需要**先腾位**——推荐把
  三度量抽成非保留侧的一个纯函数（新建 `src/stickyMetrics.ts`，导出 `stickyMetricsFrom(view: EditorView)`），宿主那侧只留
  `stickyMetrics: () => view ? stickyMetricsFrom(view) : {},` 一行，把多行算术挪出保留文件。）
- **3) `src/App.vue:544` 给 `createStickyLines` 补 `view`**（保留文件，可照抄）：
  ```diff
  -const { stickyLines } = createStickyLines({ editorSettings, outline, currentLine: () => active.value?.line, language: () => (active.value ? associationOf(active.value.path, active.value.content) : undefined) })
  +const { stickyLines } = createStickyLines({
  +  editorSettings, outline,
  +  currentLine: () => active.value?.line,
  +  language: () => (active.value ? associationOf(active.value.path, active.value.content) : undefined),
  +  // 面板身份 = 聚焦分栏；度量从组件透出（上面 2）。拿不到时那三字段留 undefined，模块侧退回按光标行的退化路径，不会渲染空白面板。
  +  view: () => {
  +    const metrics = editorFor(activePath.value)?.stickyMetrics() ?? {}
  +    return { id: String(focusedPane.value ?? 0), firstVisibleLine: metrics.firstVisibleLine, lineHeight: metrics.lineHeight, viewportHeight: metrics.viewportHeight }
  +  },
  +})
  ```
  （`editorFor` `src/App.vue:187`、`focusedPane` `:194`、`activePath` `:220` 都是现成的；App.vue 现 2707/2737，有 30 行余量。）
- **上游依据**：`platform/platform-impl/src/com/intellij/openapi/editor/impl/stickyLines/VisualStickyLines.kt:66-87`（`collectLogical` 从
  `visibleArea.y` 换顶行）、`:158-159`（`isPanelTooBig`）、`:162-163`（`isScopeNotNarrow`，默认 5 行见 `:18-19`）、
  `platform/platform-impl/src/com/intellij/openapi/editor/impl/stickyLines/StickyLinesManager.kt:86-99`（`visibleAreaChanged` 驱动重算）。

## W3 `src/App.vue`：多分栏时按 `pane` 各取一份粘性行（订正前置 folding-lane W-3 的行号与"优先级"说法）

> 取代 `docs/wiring-requests-2026-10-06-folding.md` W-3（那条写 `src/App.vue:2119`，现在渲染块在 `:2168-2173`）。

- **现状**：`src/App.vue:2172` 是 `v-if="stickyLines.length && pane === focusedPane && !binaryView"` ⇒ 只有聚焦分栏画粘性行，且用的是 W2 里那份单 `view` 的 `stickyLines`。
- **要接什么**：一次给所有分栏算（`stickyLinesPerView(scopes, views, lineLimit)`，`src/stickyLineViewport.ts:164-170`），渲染处按 `pane` 取那一份。
  模块侧的 `stickyLinesPerView` **键序已经 = 优先级序**（内部走 `orderStickyViews`），所以 `for (const [id, lines] of perView)` 直接就是显示序，
  宿主**不必再去重排一遍**，也不该在模块里编"哪个分栏在上"（`priority` 由宿主给；上游跨视图先后**无法核实**，见 R2 第 3 点）。
  分栏身份只有 `App.vue` 有（`groups` `:193`、`Pane` 从 `./editorGroups` 导入 `:107`），故本批只做模块判据、不做渲染分支（不放假控件）。
- **上游依据**：`StickyLinesManager.kt:20-34`（每个 editor 一个 manager/面板）、`StickyLinesModelImpl.java:93-100`（模型挂文档 MarkupModel，一份文档一份 ⇒ 同文档两分栏共享层、显示各算各的）。
- **另注（不编）**：判决原文"按视图优先级排序"在两 stickyLines 目录 `grep priority` 零命中（本批再核）；能核实的只有
  `StickyLinesModelImpl.java:287-296` 的比较器（已实现为 `compareStickyScopes`）与"各编辑器各算各的"两条。若主代理另有出处请给路径，本仓按那条补。

## 引用（不重复登记）：Surround With 列表的三项 / 独立命令 —— 见前置 folding-lane W-4、W-5

- 族①的 surround 模块侧（`src/customFoldingSurround.ts`，三个 provider 各一条 + 选区吸附整行 + 尾部先插 + `?`→`Description` 并选中）已全落。
- 缺的仍是**列表接线**：Ctrl+Alt+T 的「折叠区域」四条现在是 `src/surround.ts:41-44` 的硬编码字符串（前置 folding-lane W-4 写的 `:34-37` 已过时，
  现模板在 **`:41-44`**，其 `:34` 注释引用 `CustomFoldingSurroundDescriptor.java:224-227`/`:47` 是正确的），标题/文本/占位与 `src/customFoldingProviders.ts` 那张表各写一份 ⇒ 改表不改列表。
  命令表 `fold.surroundRegion`（`src/editorCommands.ts:200-216`）目前写死 `customFoldingSurrounder('')`（默认那一族）⇒ 前置 W-5。
- `src/surround.ts`/`src/surroundTemplates.ts`/`src/menus/editMenu.ts` **不在本折叠 lane 名下**（别的桶），本批**不动**，仅登记当前行号供主代理接。

## 处理结果（wiring-backlog lane，2026-10-06）

- **R1 / R2 / R3** —— 判词与引用订正，非本 lane。
- **W1** —— 目标 `src/components/CodeEditor.vue:917`（禁改清单）。需 CodeEditor owner。
- **W2 / W3（面板度量喂 `createStickyLines` / 按 pane 各取一份）** —— 目标 `src/App.vue`（本 lane）+ `CodeEditor.vue` + `src/editorTab.ts`。因度量数据源在 CodeEditor（需 defineExpose），App.vue 单方面接 = 无数据。**需 CodeEditor owner** 先落度量出口（与 folding W-1/W-2 同一条）。

结论：零接线（串在 CodeEditor 上）。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「零接线（串在 CodeEditor 上）。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
