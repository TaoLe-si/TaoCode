# 接线请求 2026-10-06 · lane **pvtree5**（给主代理）

本批名下代码已经自跑通（121/121 绿，见 `docs/batch-2026-10-06-pvtree5.md` §8），**不需要**为 C5 接任何宿主线：
`OutlinePanel.vue` 的 store/restore 是面板内部的，窗格 `src/components/ToolWindowView.vue:196` 早就把
`:path/:symbols/:source` 喂齐了。下面 4 条是**判决簿订正**与**两处行为分歧**，外加一条保留文件里的死引用。
每条都给了可照抄的 old/new 与**实测**行号（行号是本批在盘上一天天开出来的，不是抄来的）。

---

## R-1 判决簿订正请求（本批没动 `docs/inventory/verdict-*.md` 一个字）

> 完整表格见 `docs/batch-2026-10-06-pvtree5.md` §6；这里只列要改的三处原文。
> 注意：`verdict-settings-run.md`、`verdict-editor.md`、`verdict-find-diff.md` 是别的 lane 刚改完的，本批一条没碰，
> 下面三条也不涉及它们。

### R-1a `docs/inventory/verdict-projectviews.md:30`（`pv/structure-view`）

old（该行的「缺」那一段，逐字）：
```
缺：`Show Inherited Members`（继承节点来自 PSI/语言服务，LSP `documentSymbol` 不区分继承成员）、autoscroll to/from source 两个开关（`StructureViewComponent` 的跟随编辑器开关）、PSI 侧的排序器族（`VisibilitySorter`/`Sorter` 扩展点；本仓只有名称与种类两档）
```
new：
```
缺：`Show Inherited Members`（继承节点来自 PSI/语言服务，LSP `documentSymbol` 不区分继承成员）、`Sorter`/`StructureViewExtension` 的**扩展点宿主**（本仓四档是内置的，第三方插不进来）。
已补（2026-10-06）：autoscroll to/from source 两个开关（`src/structureFollow.ts` + `src/components/OutlinePanel.vue`，默认值对齐 `StructureViewFactoryImpl.java:49-50`）；
`VisibilitySorter` 那一档（四档 + unknown，判据 `tests/structure-follow.test.mjs`）；`KindSorter` 权重按上游原值（`KindSorter.java:34-57`，构造器 30 先于方法 35、属性 40 先于字段 50）；
折叠态按文件保存/取回（`StructureViewComponent.java:397-407` 与 `:414-428` 的 storeState/restoreState 等价物，一次性消费）；
Ctrl+F12 弹层的默认档（名称+种类，且用 `KindSorter.POPUP_INSTANCE` ⇒ 嵌套类型落在成员下面），判据 `tests/outline-view.test.mjs`。
```

### R-1b `docs/inventory/verdict-projectviews.md:36`（`pv/project-view`）

old（该行的「缺」里这一段，逐字）：
```
`MarkRootGroup`/`MarkAsContentRootAction` 这组标记根动作（根与 SDK 只在 `src/components/ProjectStructurePane.vue` 编辑，项目树右键没有 Mark Directory As）
```
new：删掉这一段，改记
```
`MarkRootGroup`/`MarkAsContentRootAction` 一族已在 `src/pvMarkRoots.ts`（判据 `tests/pv-mark-roots.test.mjs`），
标记根的模型在 `src/rootsModel.ts`；仍缺 `SplitProjectViewUtil` 的双窗格与 `CustomizeTreesAction` 的窗格定制。
```
（磁盘出处：`src/pvMarkRoots.ts:1-2` 文件头就写着它补的正是这条判词缺口。）

### R-1c `docs/inventory/verdict-projectviews.md:28`（`pv/project-view-nodes`）

old（该行的「缺」里这一段，逐字）：
```
可编辑的嵌套规则（上游 `FileNestingInProjectViewDialog`；本仓 `createProjectTreeModel` 没有设置页给 `nestingRules` 喂值，只用 `DEFAULT_NESTING_RULES`）
```
new：删掉这一段，改记
```
文件嵌套规则可编辑：`src/projectTreeNestingDialog.ts:58`（`nestingRulesOf`）+ `src/components/FileNestingSettings.vue:19`/`:54`
+ 宿主 `src/components/ProjectViewSortSettings.vue:34`/`:67` + 喂进模型 `src/components/FileTree.vue:50`
+ 持久化 `src/projectTreeState.ts:117`/`:129`（`useFileNestingRules` / `nestingRules` 两键）。
```
同一条里另一句仍然成立、**不要**改：`ProjectViewFileNestingService` 的「上游对话框那套预览/排序细节」若未逐条对齐，
按 `src/projectTreeNesting.ts` 现状保留。（本批没复开那个上游类，写「无法核实」。）

---

## R-2 保留文件里的死引用：`src/App.vue:9`

实测：`src/App.vue:9` 有 `import OutlinePanel from './components/OutlinePanel.vue'`，但**全文件没有任何 `<OutlinePanel`**
（`grep -n "OutlinePanel" src/App.vue` 只有这一行；其余 `outline` 命中都是 `refreshOutline`/`toggleOutline` 这类函数）。
真正上树的是 `src/components/ToolWindowView.vue:196`。

要改的（照抄）：
```
old: import OutlinePanel from './components/OutlinePanel.vue'
new: （整行删除）
```
**腾位方案**（App.vue 只剩 31 行余量，这条是**净减 1 行**，不占反要位）：删除后 `src/App.vue` 从 2706 行变 2705 行。
**门禁影响已核**：`node .tools/find-orphan-modules.mjs --gate` 不会因为删这一行而报孤儿 ——
消费链走 `ToolWindowView.vue:8` → `OutlinePanel.vue` → `src/outlineView.ts` / `src/structureFollow.ts`，三头都在。
本批没自己删：`src/App.vue` 是保留文件，且不在本 lane 交付物里。

---

## R-3 `collapseAll` 的两处行为分歧（等判定，本批**没动行为**）

现状（`src/projectTreeModel.ts:251-263`）：折叠时清空 `expanded`，再把「选中行的顶层祖先」那**一行**放回 `expanded`。
上游（实测坐标）：`AbstractProjectViewPane.java:803-806` 覆写成 **非 strict** → `TreeUtil.java:892-925` 的
`:911` `if (!strict && row == 0) break` 只豁免**第 0 行**；`:916` 一旦出现**第二个**顶层行就把 strict 翻成 true。

- 分歧 ①（多顶层行）：本仓留「选中行的顶层祖先」，上游留「第 0 行，且多根时一行都不留」。
  生产里等价 —— `src/App.vue:2101` 与 `src/components/ToolWindowView.vue:260` 都传 `:project-name` ⇒ 恒有唯一的合成根 = 第 0 行。
  判据 `tests/project-tree-appearance.test.mjs:377-401`（嵌入树那一支）用的 fixture 有 `src` + `main.ts` 两个顶层行，
  按上游读法应该**全折**（期望 `['src','main.ts']`），现在期望的是 `src` 留开 ⇒ **这条判据测的是测试构造的形状，不是生产形状**。
- 分歧 ②（无选中行）：上游 `:897` 取不到 leadSelectionPath ⇒ prohibited 为 null，但 `:911` 的第 0 行豁免仍然生效 ⇒
  仍留开第 0 行；本仓 `path === undefined` 时一律清空。

要改的话（照抄，两条一起改才自洽）：
```
old: const selectedIndex = rows.value.findIndex(row => row.entry.path === selected.value)
     let ancestor = selectedIndex
     while (ancestor > 0 && rows.value[ancestor]!.level > options.depth()) ancestor--
     const path = rows.value[ancestor]?.entry.path
new: const topLevel = rows.value.filter(row => row.level <= options.depth())
     const path = topLevel.length === 1 ? topLevel[0]!.entry.path : undefined
```
（并把 `tests/project-tree-appearance.test.mjs:377-401` 那条改成生产形状：给嵌入树也铺一个第 0 行，或直接把期望改成全折。）
本批不改的理由：这条是 pvtree4 落地的、判据跑绿、且用户可见的生产形状两种写法一致；改法要连带动它新加的判据，
留给主代理判定（改或不改都行，但**注释里原来的证据链是错的**，本批已就地订正，见批次文档 §4）。

---

## R-4 `node --test` 那条门禁命令的名字要订正（文档/看板级，不改代码）

看板 `docs/batch-2026-10-06-lane-board.md:15` 写着「`structure-follow/outline-view/project-tree-model` **31/31**」
（`docs/batch-2026-10-06-main.md:696` 只记了「31/31 绿」那个数）。
实测：`tests/project-tree-model.test.mjs` **不存在**；`node --test` 多路径时静默忽略不存在的文件（EXIT 仍 0），
单跑才报 `Could not find`。也就是说那 31 条里根本没有 projectTree 族的任何一条。
建议写成（本批实测 **121/121 fail 0**；同一命令两次跑分别 874.2659ms / 1035.4026ms，SSR 那几条占大头）：
```
node --test tests/structure-follow.test.mjs tests/outline-view.test.mjs tests/outline-caret-source.test.mjs \
  tests/project-tree-appearance.test.mjs tests/project-tree-behavior.test.mjs \
  tests/project-tree-decorations.test.mjs tests/project-tree-nesting.test.mjs \
  tests/pv-mark-roots.test.mjs tests/pv-file-undo.test.mjs tests/pv-history-session.test.mjs \
  tests/pv-command-processor.test.mjs tests/pv-command-wiring.test.mjs
```

---

## 非本批、只登记

- `node .tools/find-orphan-modules.mjs --gate` 顺带报出 `src/jarRun.ts`、`src/runAnythingContext.ts`
  「已接上（可以更新基线）」—— 不是本批的文件，本批没动基线。
- 任务书点名的全仓类型红 `src/lspSymbolBridge.ts(33,10) TS2459` 在本批实测时**已不存在**：
  `src/symbolSearch.ts:23` 现在 `export { SPEED_SEARCH_STRUCTURE_SEPARATORS }`（ss3 名下），
  且 `npx vue-tsc --noEmit -p tsconfig.json` 本批跑过 ⇒ EXIT=0。本批没碰这两个文件。

## 处理结果（wiring-backlog lane，2026-10-06）

- **R-1** —— 判决簿订正（`docs/inventory/*`），非本 lane。
- **R-2（`src/App.vue:9` 死引用）** —— 本 lane 可改面。登记为待办（清理陈旧 import）。
- **R-3 / R-4** —— 判定/文档级。

结论：零接线（R-2 登记）。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「零接线（R-2 登记）。」。
本 lane 本轮接线：**R-2 已接** —— 删掉 `src/App.vue:9` 的死引用 `import OutlinePanel from './components/OutlinePanel.vue'`（全文件无 `<OutlinePanel`，真正上树的是 `ToolWindowView.vue`），App.vue 净 -1 行。R-1（判决簿）属 `docs/inventory/**`（禁改）；R-3 是行为判定项；R-4 是看板文档订正。
