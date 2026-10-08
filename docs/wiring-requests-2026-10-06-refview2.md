# wiring-requests 2026-10-06 · refview2（引用面板用法树行模型的 W-3 模块侧收尾）

任务表 #219 / `docs/wiring-requests-2026-10-06-usage3.md` 的后续。本轮账目与上游坐标：
`docs/batch-2026-10-06-refview2.md`（§1 上游真身、§4 落点、§7 订正留痕）。

## 0. 本轮**不需要**改冻结文件

行模型（`src/usageViewGrouping.ts`）与它的宿主状态（`src/referenceContents.ts`）都在模块侧，
生产链路 `App.vue`（冻结）→ `src/toolViewContext.ts:201-208` → `ToolWindowView.vue:220` →
`components/ReferencePanel.vue` 一行没动，也**没有新增任何 UI 控件**。
实测余量（本轮开头核对的三个数）：`src/App.vue` 30 行、`src/bridge.ts` 0 行（已贴顶）、
`src/components/CodeEditor.vue` 2 行 —— 本轮三处均未占用。

## 1. R-1（需要宿主，**当前不需要动代码**）：应用级展开档那一格的设置页出口

- 模块侧已做：`referencesExpandedAll`（`taocode.usagesExpandedAll`，缺键取默认 false，对齐上游
  `platform/usageView/src/com/intellij/usages/UsageViewSettings.kt:63-64` 的 `IS_EXPANDED`）。
  现在它只由面板上那两个整体动作写（`expandAllUsageGroups` / `collapseAllUsageGroups`，
  对应上游 `UsageViewImpl.java:344-347` / `:353-358`）。
- 需要谁：设置里「用法视图」那一页（上游 `UsageViewSettings` 的宿主）如果要给这一格一个勾选项，
  直接读写这一个 ref 即可，**不要在 `App.vue` 里再存第二份**。
- 不给也没关系：面板上那两个按钮已经覆盖同一件事，**没有消费链路就不画**（本轮按此不新增控件）。

## 2. R-2（需要宿主）：导出到文本文件仍没有 UI 出口

- 模块侧已有两份导出：`exportUsageTreeText`（缩进树，上游 `platform/usageView-impl/src/com/intellij/usages/impl/ExporterToTextFile.java:31-71` 的形状）
  与 `exportUsagesText`（`path:line` 平表，`src/hierarchyExport.ts:80` 声明与它同一条口径）。
  `src/referenceContents.ts` 的 `exportReferencesText(header)` 走的是树形那份。
- 现状：`exportReferencesText` 只有判据在调（`tests/usage-view-panel-rows.test.mjs:156`、`:332`），
  **生产链路里没有任何按钮/菜单项调它** —— 上游那一条是 `UsageViewImpl.java:2260` 递出去的
  `PlatformDataKeys.EXPORTER_TO_TEXT_FILE`（`ExportToTextFileAction`），本仓的齿轮里目前没有这一项。
- 要谁接：`src/menus/toolWindowGear.ts` 的引用表 + `src/usageViewGear.ts` 给一行（`canExport` 的等价判据 =
  不在搜索中且内容有选中项，上游 `ExporterToTextFile.java:93-96`）。
  **本轮没加** —— 那是新增 UI 控件，超出本批范围；接的时候导出文本用模块里那两份，别在宿主里重拼。

## 3. R-3（需要宿主，可选）：平表导出与树同源

- `exportUsagesText` 吃的是 `LspLocation` 平表（payload），面板画的是 `buildUsageTree` 那棵树；
  两份数据源同一条 `references` computed（`src/referenceContents.ts:88-91`），所以现在**已经同源**。
- 若将来做「只导出可见行」（上游没有这一档：`ExporterToTextFile.java:24-29` 导的是 model，不看展开态），
  请从 `referenceRows` 里筛 `kind === 'usage'` 的行再取 `path/line/character`，**不要**新造第二棵树。

## 4. 已登记的缺口（本轮未收，出处在案）

- 「一键导航」那一档齿轮项：结果行没有选择态 ⇒ 做不出真开关
  （`src/usageViewGear.ts:15-17`、`docs/source-todo.md` §10）。同一件事也让上游「全部折叠」的
  `keepSelectionLevel=3` 那一段在本仓落不了地（`UsageViewImpl.java:356` + `TreeUtil.java:883-907`），
  本轮按既有判据保持"收全部组键"。
- Module / Package / Scope / Usage Type / Flatten Modules 几档分组：本仓工作区单根、没有模块表
  （`src/usageViewGrouping.ts` 模块头「架构不等价」那一条），齿轮里不给行。

## 处理结果（wiring-backlog lane，2026-10-06）

- 请求原文自述「本轮**不需要**改冻结文件」，R-1/R-2/R-3 均为「需要宿主」但当前不需要动代码。零接线。

结论：零接线（请求原文自述无需动代码）。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「零接线（请求原文自述无需动代码）。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
