# 折叠族接线请求（2026-10-06，代号 `folding`）

本批只动 `src/editorFolding*.ts` `src/customFolding*.ts` `src/stickyLine*.ts` 与域内测试。
下面每一条的目标文件都**不在本代理可改面**（`appvue` / `bucket5b` / `keymap` / 组件在途），
按派单规约只交请求：目标文件 + 目标行号 + import + 可照抄的整段替换 + 上游依据。

上游基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（下列行号均已逐行打开核过）。

---

## W-1 `src/App.vue:513` 把面板身份与度量喂给 `createStickyLines`（粘性行的视口那一层）

- **目标文件/行**：`src/App.vue` 第 513 行（现在是这一句）
- **要接什么**：给 `createStickyLines` 补一个 `view` 实参。**没有它**时本仓只能按「包含光标行」这条
  退化路径出粘性行；有了它才走上游那一层（候选=与可视区顶部那一段**相交**、作用域至少 5 行才算一层、
  面板放不下就一条不画、从外层起排满上限即停）。
- **可照抄的替换**（`src/stickyLines.ts` 的 `StickyLinesDeps.view` 与
  `src/stickyLineViewport.ts` 的 `StickyView` 都已就位，判据在 `tests/sticky-line-viewport.test.mjs`）：

  ```ts
  // src/App.vue:98 那条 import 后面已经引过 createStickyLines，不用加新的。
  const { stickyLines } = createStickyLines({
    editorSettings, outline,
    currentLine: () => active.value?.line,
    language: () => (active.value ? associationOf(active.value.path, active.value.content) : undefined),
    // 面板身份 = 当前聚焦的分栏；度量从 CodeEditor.vue 透出（见 W-2）。
    view: () => ({
      id: String(focusedPane.value ?? 'main'),
      firstVisibleLine: editorMetrics().firstVisibleLine,
      lineHeight: editorMetrics().lineHeight,
      viewportHeight: editorMetrics().viewportHeight,
    }),
  })
  ```

  `editorMetrics()` 是要新增的一个小函数（或直接换成 `editorFor(active.value?.path)?.stickyMetrics()`）：
  组件侧的出口见 W-2。**拿不到度量时把那三个字段留 `undefined` 就行** —— 模块侧会退回旧路径，
  不会渲染空白面板（不放假控件）。
- **上游依据**：
  `platform/platform-impl/src/com/intellij/openapi/editor/impl/stickyLines/VisualStickyLines.kt:66-87`
  （`collectLogical` 从 `visibleArea.y` 换算顶行、窗口高度 = `lineHeight * stickyLinesLimit + 1`）、
  同文件 `:158-159`（`isPanelTooBig`）、`:162-163`（`isScopeNotNarrow`，默认 5 行见 `:18-19`）、
  `platform/platform-impl/src/com/intellij/openapi/editor/impl/stickyLines/StickyLinesManager.kt:86-99`
  （`visibleAreaChanged` 驱动重算）。

## W-2 `src/components/CodeEditor.vue` 透出三个度量（`firstVisibleLine` / `lineHeight` / `viewportHeight`）

- **目标文件**：`src/components/CodeEditor.vue`（组件侧 defineExpose 那一块）
- **要接什么**：加一个只读出口，把 CodeMirror 视口度量给宿主；这是 W-1 的数据源。
- **可照抄的实现**：

  ```ts
  // 粘性行的视口判据要三个度量（上游用 visibleArea 的 y/height 与 editor.lineHeight，
  // 见 VisualStickyLines.kt:70-74 与 StickyLinesManager.kt:139-147）。
  function stickyMetrics(): { firstVisibleLine?: number; lineHeight?: number; viewportHeight?: number } {
    const current = view
    if (!current) return {}
    const area = current.viewport
    return {
      firstVisibleLine: current.doc.lineAt(area.from).number,
      lineHeight: current.defaultBlock.style ? Number.parseFloat(current.defaultBlock.height.toFixed(2)) : undefined,
      viewportHeight: area.height,
    }
  }
  ```

  （`lineHeight` 用 `defaultBlock.height` 即可，它是单行盒高；拿不到就返回 `undefined`，
  模块侧 `stickyPanelFits` 会跳过那一档判断而不是乱判。）
- **上游依据**：`VisualStickyLines.kt:60-62`（`editor.settings.stickyLinesLimit` + `editor.lineHeight`）、
  `:71-74`（`visibleArea.y` → 顶行）。

## W-3 `src/App.vue`：多分栏各算一份粘性行（`stickyLinesPerView`）

- **现状**：`src/App.vue:2119` 那一行是
  `v-if="stickyLines.length && pane === focusedPane && !binaryView"` —— **只有聚焦分栏**画粘性行。
  上游是「层存在文档级的模型里，显示在每个编辑器上」：同一文件开在两个分栏时，
  两个面板各自按自己的可视区算一份。
- **要接什么**：把 `createStickyLines` 换成一次给所有分栏算，渲染处按 `pane` 取那一份。
  模块侧出口已就位：`src/stickyLineViewport.ts` 的 `stickyLinesPerView(scopes, views, lineLimit)`
  （判据 `tests/sticky-line-viewport.test.mjs` 的「多分栏：同一个文档的两个视图各算各的」）。
- **需要宿主提供的**：每个分栏的 `StickyView`（`id` + 三个度量）。**分栏身份只有 `App.vue` 有**，
  模块侧无法凭空造，故本批只做判据不做渲染分支（不放假控件）。
- **上游依据**：`StickyLinesManager.kt:20-34`（每个 editor 一个 manager）、
  `StickyLinesModelImpl.java:93-100`（模型挂在文档的 MarkupModel 上，一份文档一份）。
- **另注（不编）**：判决原文写的「按视图**优先级**排序」在参考树里指不到对应代码
  —— 对整个 `stickyLines` 目录搜 priority 零命中。能核实的只有上面这两条 +
  `StickyLinesModelImpl.java:287-296` 的比较器（起始升序、同起点宽的在前，已实现为
  `compareStickyScopes`）。若主代理另有出处，请给路径，本仓按那条补。

## W-4 `src/surroundTemplates.ts` / `src/surround.ts`：Surround With 列表的三项改由 provider 表驱动

- **目标文件/行**：`src/surround.ts` 第 34-37 行（四条硬编码的「折叠区域 …」模板）
  与 `src/surroundTemplates.ts:33`（`surroundChoices`）/ `:46-52`（`applySurround`）。
- **现状**：`src/customFoldingSurround.ts` 已经有 `customFoldingSurrounders()`
  （每个 provider 一项，顺序 = EP 注册顺序，标题 = provider 的 `getDescription()`）与
  `surroundWithRegion(...)`（缩进、`?` → `Description` 并选中、先插尾部），
  但 Ctrl+Alt+T 的列表走的是 `src/surround.ts` 里那四条硬编码字符串：
  **标题、标记文本、说明占位符三处都与 provider 表各写一份**，改表不会改列表；
  而且那四条不带「选中 `Description` 让用户改名」这一步。
- **要接什么**（两条任选，推荐第一条）：
  1. 列表里那四条换成表驱动 —— `surroundChoices` 计算时把
     `customFoldingSurrounders()` 映射成 `{ title: item.title, keywords: 'region fold 折叠区域 区域', id: item.id }`
     追加在现有模板之后，`applySurround` 遇到带 `id` 的项时改调
     `editorFor(tab.path)?.surroundWithRegionById(item.id)`（组件侧的这个方法在
     `CodeEditor.vue` 里加一个薄封装即可，内部就是 `src/editorCommands.ts:194-210` 已有的那段 dispatch）；
  2. 或保留 `src/surround.ts` 的四条、把 `prefix/suffix` 改成从
     `CUSTOM_FOLDING_PROVIDERS` 取（至少消除两处文本各写一份）。
- **上游依据**：`platform/lang-impl/src/com/intellij/lang/folding/CustomFoldingSurroundDescriptor.java:218`
  （`getSurrounders()`）与 `:226`（逐个 provider 造一个 surrounder）、`:47`（`DEFAULT_DESC_TEXT`）、
  `:298-304`（`?` → `Description` 并把那段选上）、`:316-318`（落地后 `updater.select(rangeToSelect)`）。

## W-5 `src/editorCommands.ts` / `src/menus/editMenu.ts`：`fold.surroundRegion` 目前只会用默认那一族标记

- **目标文件/行**：`src/editorCommands.ts:194-210`（`customFoldingSurrounder('')` 写死 id 为空的 provider）
  与 `src/menus/editMenu.ts:151`（只有一行菜单）。
- **要接什么**：另两条 provider（`NetBeansCustomFoldingProvider`、`VisualStudioCustomFoldingProvider`）
  到不了用户手里。上游的形态是「Surround With 列表里一族三项」（见 W-4），
  所以**优先做 W-4**；若要独立命令，就按 id 参数化：
  `'fold.surroundRegion'`（默认族）、`'fold.surroundRegion.netbeans'`、`'fold.surroundRegion.vs'`，
  菜单三行文案直接用 `customFoldingSurrounders()` 的 `title`（取自中文包，别另写）。
- **上游依据**：`platform/core-api/resources/intellij.platform.core.xml:40`（EP 声明）与
  `platform/lang-impl/resources/intellij.platform.lang.impl.xml:1466-1467`（社区树里注册的两条实现）。

## W-6 `src/components/CodeEditor.vue:919`：无区域时那条提示直接用模块导出的文案

- **现状**：`src/customFoldingPopup.ts:29` 导出的 `NO_CUSTOM_REGIONS_IN_FILE = '当前文件中没有自定义的折叠'`
  **没有消费者**；宿主里写的是另一句（`showErrorHint('这个文件里没有自定义折叠区域')`）。
  模块那句是按上游中文包键写的（`IdeBundle.properties` 的
  `goto.custom.region.message.unavailable`），宿主那句是本仓自造的措辞。
- **要接什么**：把宿主那一处的字面量换成 `import { NO_CUSTOM_REGIONS_IN_FILE } from '../customFoldingPopup'`
  并 `showErrorHint(NO_CUSTOM_REGIONS_IN_FILE)`（同文件 `:81` 已经 import 了这个模块，不用新增 import 行）。
- **为什么算用户可见**：同一件事在弹层标题、通知、文档里出现两种措辞，本地化包对不上；
  并且这条常量现在是**零消费方的死文案**（规约第 5 条孤儿口径）。
- **上游依据**：`platform/lang-impl/src/com/intellij/lang/customFolding/GotoCustomRegionAction.java:65`
  （无区域时给提示这一支）。

## 处理结果（wiring-backlog lane，2026-10-06）

- **W-1（`createStickyLines` 补 `view` 实参）未落** —— 目标 `src/App.vue:559`（本 lane 可改），但数据源 `editorMetrics()` / `stickyMetrics()` 需 `src/components/CodeEditor.vue` 先 defineExpose（见 W-2，禁改清单）⇒ 无度量时模块退回旧路径。**需 CodeEditor owner** 先落 W-2 的出口，之后 App.vue 一行接上。
- **W-2** —— 目标 `src/components/CodeEditor.vue`（禁改清单）。需 CodeEditor owner。
- **W-3（按分栏算粘性行）** —— 目标 `src/App.vue` + `src/stickyLines.ts`（`stickyLineProviders.ts` 已就位）。依赖 W-1 的 view 度量，同上。
- **surround.ts 的折叠模板** —— 目标 `src/surround.ts:34-37`（本 lane 可改面），但请求原文归 bucket5b/folding 的组件在途，未接。

结论：W-1/W-2/W-3 串在 CodeEditor owner 上，本 lane 不单方面接（无度量 = 假面板）。

补充复核：**W-1 未落** —— `src/App.vue:559` 的 `createStickyLines({...})` 仍只有 `editorSettings, outline, currentLine, language`，无 `view` 实参（数据源 `CodeEditor.vue` 的度量出口未落，见 W-2）。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「W-1/W-2/W-3 串在 CodeEditor owner 上，本 lane 不单方面接（无度量 = 假面板）。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
