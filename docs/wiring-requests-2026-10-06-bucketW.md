# 接线请求 · 桶 W（不动 App.vue 的那一批收口后，剩下的宿主行）· 2026-10-06

本文件只放**保留文件**的目标行与可照抄整段（`src/App.vue`、`src/components/CodeEditor.vue`）。
模块侧与判据我已经落完并反向验证过，见 `docs/batch-2026-10-06-bucketW.md`。
行号是 2026-10-06 现树实测（`src/App.vue` 2729 行 / 上限 2737）；并发中会漂，粘之前重读一次目标区域。

---

## H1 · 测试树跳源的最后一段（请求 W-B11c-1 的宿主半，模块侧已核齐）

- **目标行**：`src/App.vue:2283`（渲染 `<TestRunnerPanel … :ready="isDesktop && Boolean(workspace)" />` 那一行；
  桶 11c 的请求原文写 `:2254`，现树实测 **2283**，行号已漂）。
- **要加的属性（逐字可粘，加在该标签末尾、`/>` 之前）**：

  ```vue
  @jump="target => revealLocation({ path: target.path, line: Math.max(0, target.line - 1) })"
  ```

- **行号口径**：`revealLocation` 收 **0 基**（同一处约定见 `src/App.vue:1062-1063` 的 `Math.max(0, action.line - 1)`），
  `src/testLocator.ts` 给的是 **1 基**（`Math.max(1, …)`：`:160`、`:185`、`:192`）⇒ 必须 `-1`。
- **模块侧实况（已核，不是照抄请求）**：`src/components/TestRunnerPanel.vue:32` 声明 `emit: { jump: [...] }`；
  发送点 `:271-273`（`jump(node)`，模板 `:491` 双击树节点、`:507` 点结果行）与 `:404`（运行中跟随）。
  tooltip 早已显示目标 `文件:行`（`:496`）却点不动 —— 缺的就是这一行。
- **上游依据**：`platform/smRunner/src/com/intellij/execution/testframework/sm/runner/SMTestLocator.java:22-31`
  （`getLocation(protocol, path, project, scope)` 产出可导航的 `Location` 列表）；
  `java/execution/impl/src/com/intellij/execution/testframework/JavaTestLocator.java:96-125`，
  metainfo 的 `行:列` 最终变成 `new OpenFileDescriptor(project, file, line, col)`（实测在 `:111-117`）。
- **判据**：`tests/tool-window-view-panels.test.mjs`（本轮新增，钉住「渲染归属只有 App.vue 一处」）、
  `tests/test-locator.test.mjs`、`tests/test-tree-view.test.mjs`。

## H2 · 工具窗口宿主不要再 import 没渲染的面板（请求 W-B11c-2 —— 模块侧我已改完）

已落地：`src/components/ToolWindowView.vue` 删掉了两条陈旧 import（`./HistoryPanel.vue`、`./TestRunnerPanel.vue`）。
**如果**主代理的打算是在工具窗口里也画一份测试运行器（不是删 import），那要动的就是保留文件，请按 H1 的
`@jump` 一起接，并把 `tests/tool-window-view-panels.test.mjs` 的两条判据改成「宿主统一渲染、App.vue 不再画」。
现在这两条判据会拦住「只 import 不渲染」的中间态。

## H3 · 树右键菜单「将目录标记为」那一格（请求 14a W1 的宿主半）

- **目标行**：`src/App.vue:2428` 之后、`:2430` 的书签组之前（14a 原文写 `:2448`，现树实测剪切/复制/粘贴那两行在
  `:2427-2428`）。
- **可照抄整段**：

  ```vue
        <button v-if="markRootMenu(treeMenu.entry)" class="has-sub"
                @click="treeSubmenu = treeSubmenu === 'markroot' ? null : 'markroot'">{{ markRootMenu(treeMenu.entry)!.title }}</button>
        <template v-if="treeSubmenu === 'markroot'">
          <button v-for="item in markRootMenu(treeMenu.entry)!.items" :key="item.id" class="sub-item"
                  @click="applyMarkRoot(item.id, treeMenu.entry)">{{ item.label }}</button>
        </template>
  ```

- **模块侧已备好**：`src/treeActions.ts:188` 的 `return { …, markRootMenu, applyMarkRoot }`（`markRootMenu` 在 `:162`、
  `applyMarkRoot` 在 `:168`，写回走 `project.settings.update`）；可见性/成员/组标题的纯规则在 `src/pvMarkRoots.ts`。
  `src/explorerActions.ts` 的 `treeSubmenu` 联合里 `'markroot'` 这个字面量**本轮已加**（否则这一行 vue-tsc 会报 TS2322）。
- **上游依据（逐条开过）**：`platform/lang-impl/resources/intellij.platform.lang.impl.actions.xml:252`
  （`<group id="MarkRootGroup" …popup="true">`）；
  `platform/lang-impl/src/com/intellij/ide/projectView/actions/MarkRootGroup.java:14-22`
  （组标题按选区在 `group.MarkRootGroup.file.text` / `group.MarkRootGroup.text` 之间切）。
- **判据**：接完跑 `node --experimental-strip-types --test tests/pv-mark-roots.test.mjs`（若桶 14a 有那份）与
  `tests/pv-command-wiring.test.mjs`，两条都不该动。

## H4 · `createTreeActions` 补 `refreshTree` 实参（请求 14a W2）

- **目标行**：`src/App.vue:1350`（`createTreeActions({ notify, isDesktop, menu, treeMenu, treeSubmenu, tabMenu, … request, projectSettings, allTabs,` 那一行，
  整个 deps 对象从 `:1349` 的 `} = createTreeActions({` 起）。实测这一行**没有** `refreshTree`
  （`:1340` 那一条 `refreshTree` 属于上面那个 `createExplorerActions` 的 deps，别弄混）。
- **要加什么**：在该 deps 里补一个 `refreshTree,`（同名字段，`:1340` 已在用）。
- **为什么**：本仓的排除是设置表驱动（`ProjectSettings.excludedDirs`），`project.settings.update` 回来不会自动重取目录；
  `src/treeActions.ts:179` 的 `deps.refreshTree?.()` 现在是空转 ⇒「标记为已排除」要等下一次刷新才从树上消失。
  上游是 `MarkRootActionBase` 提交模型后由 `MarkRootsManager` 触发树刷新。

## H5 · 编辑器可视区首行透出来（请求 5b W-5 的宿主半，模块侧与判据本轮已齐）

- **模块侧现状**：`src/stickyLines.ts:96` 的 `StickyLinesDeps.firstVisibleLine?: () => number | undefined`
  与 `:74-83` 的「给了就按起始行滚出可视区筛」都在；判据在 `tests/sticky-lines.test.mjs:76-91`
  （`给了可视区顶行时，起始行还看得见的那一层不再重复钉住`，四条断言）。**不缺代码，缺的是宿主透传。**
- **目标行 1**：`src/components/CodeEditor.vue:95`（`defineEmits<{ … }>()` 那一长行）——在末尾 `folded: [line1based: number]`
  之后补一段：

  ```ts
  ; viewportFirst: [line1based: number]
  ```

- **目标行 2**：`src/components/CodeEditor.vue:1020-1026` 那个 `if (update.selectionSet || update.docChanged) { … }` **之后**
  （同一层，紧接着 `}` 的下一行）加：

  ```ts
            // 粘性行的「滚出视野」那一档要可视区顶行（上游 VisualStickyLines.kt:67-86 按 visibleArea 顶行算，
            // StickyLinesManager.kt:32,86,111 由 visibleAreaChanged 驱动重算）。
            if (update.viewportChanged) emit('viewportFirst', update.state.doc.lineAt((update.visibleRanges[0]?.from ?? 0)).number)
  ```

- **目标行 3**：`src/App.vue:2194` 的 `<CodeEditor … @cursor="(line, column) => { tab.line = line; tab.column = column }" … />`
  同一行里补一个监听（改现有行，不加行）：

  ```vue
  @viewport-first="line => { if (pane === focusedPane && tab.path === activePath) stickyFirstVisibleLine = line }"
  ```

- **目标行 4**：`src/App.vue:503` 的 `createStickyLines({ … })` 补实参（并在附近声明 `const stickyFirstVisibleLine = ref(0)`，
  `0` = 没滚 ⇒ 与不传等价，不会把现有行为改掉）：

  ```ts
  firstVisibleLine: () => (stickyFirstVisibleLine.value > 0 ? stickyFirstVisibleLine.value : undefined)
  ```

  净增：App.vue 2 行（ref + 实参），CodeEditor.vue 3 行。
- **上游依据**：`platform/platform-impl/src/com/intellij/openapi/editor/impl/stickyLines/VisualStickyLines.kt:67-86`、
  同目录 `StickyLinesManager.kt:32`/`:86`/`:111`。

## H6 · 登记为「做不到 / 不属于本批」的（不给出假控件）

| 请求 | 为什么只能登记 |
| --- | --- |
| 桶 15 W1（新建文件对话框接自定义模板） | 三段全在 `src/App.vue`（`:2523-2539` 的 `<option>`、`:1771-1777` 的 `applyNameDialog()` else 分支、import 区），本批不动它。 |
| 桶 10b 第 1 条（Run Anything 的执行上下文目录） | 执行侧**早就接了**：`src/runActions.ts:444` 的签名已是 `runExternalTool(command, name, cwd?)`，`:465` 发 `cwd: cwd?.trim() || workspace.value.root`。缺的两半都不在本批属主：`src/components/RunAnythingDialog.vue:17/:43` 的 payload 要带 `cwd`（属桶 9b，`runAnythingContext.ts` 仍在 `.tools/orphan-baseline.txt` 的 8 条里），宿主 `src/App.vue:2648` 那一行是保留文件。 |
| 桶 10b 第 2 条（终端滚轮总闸 / 基准字号两格设置） | 上游那一格在 **Settings › Editor › General**（`platform/ide-core-impl/src/com/intellij/openapi/editor/ex/EditorSettingsExternalizable.java:1043`），本仓该节写的是 `editorSettings`（宿主 `src/components/SettingsDialog.vue:722`）⇒ 新增键必须同时进 `src/settingsModel.ts`（保留文件）与 `native/settings_schema.cpp` 的 `EDITOR_SETTING_KEYS`。只做 `TerminalPanel.vue:81` 那一侧就是「没人能改的旋钮」：默认值本来就等于现在写死的 `true`，用户可见行为零变化。故整条登记，不做半截。 |
| 桶 10b 第 3 条（ANSI 16 色逐色号自定义） | 出口 `src/terminalColors.ts:85` 的 `terminalPalette(theme, foreground, background)` 加第四参很容易，但没有写入方：设置页要新增一格（`src/components/SettingsDialog.vue` 配色方案 › 控制台）且值要落 `src/settingsModel.ts`（保留）。只加参数 = 只过自己测试的死分支。 |
| 桶 10b 第 4 条（大文件模式的动作替换） | 生效点是 `src/components/CodeEditor.vue`（保留）与 `src/editorCommands.ts`（不属本批）；`LARGE_FILE_DISABLED_ACTIONS` 那张表等这条被认领再写。 |
| 桶 10b 第 5 条（大文件里勾「正则」的提示） | `src/largeFileNotice.ts` 现在只有 `largeFileNoticeText`（`:42`），**没有** `largeFileRegexNoticeText`；渲染点 `src/components/EditorFindBar.vue` 属桶 5（本轮未收口）。纯函数与提示文案一起做才有消费者，故整条留给认领。 |
| 桶 10b 第 6 条（提权运行 `elevate?: boolean`） | `src/bridge.ts` 的 `RunStartParams` 是保留文件，且如请求自己所说：提权进程拿不到 `run_host` 那根继承管道，要先定 daemon/命名管道那一层，不是加参数能收工的。 |
| 桶 11c W-B11c-3（`'jar'` 运行配置类型） | 三张表必须同改，其中 `src/settingsModel.ts:25` 的 `RunConfig['type']` 联合是保留文件 ⇒ 交主代理一次做完（`src/jarRun.ts:50`/`:103` 的表单字段与类型 id 已备好，`src/jarRun.ts` 也在 orphan 基线里等这一条）。 |
| 桶 14a W3（移动的撤销要连引用改写一起撤） | `renameEntryWithReferences` 的实现属重构域（实测在 `src/semanticActions.ts:465`，桶 1 名下、本轮未收口）。`src/explorerActions.ts:111-115` 的注释与指针已订正到 14a 那份请求。 |

## 处理结果（wiring-backlog lane，2026-10-06）

- **H1 已接线**：`src/App.vue:2315` 的 `<TestRunnerPanel …>` 已带 `@jump="target => revealLocation({ path: target.path, line: Math.max(0, target.line - 1) })"`。
- **H2 已闭环**：`src/components/ToolWindowView.vue` 已无 `TestRunnerPanel` / `HistoryPanel` 陈旧 import。
- **H3 已接线**：`src/App.vue:2556-2558` 的「将目录标记为」子菜单已在。
- **H4 已接线**：`src/App.vue:1442` 的 `createTreeActions` deps 已含 `refreshTree`。
- **H5 未落** —— 目标 `src/components/CodeEditor.vue`（禁改清单，emit `viewportFirst`）+ `src/App.vue`（本 lane 可改）。因 CodeEditor 侧未 emit，App.vue 单方面补 `firstVisibleLine` 无数据源 ⇒ 需 **CodeEditor owner** 先补 emit（与 5b W-5 同一条）。
- **H6 表** —— 逐条登记，其中「桶 15 W1」本 lane 已接（见 bucket15 处理结果）、「桶 10b 第 1 条」本 lane 已核为早已接线、「桶 11c W-B11c-3」本 lane 已核为已接线；其余（10b 第 2/3/4/5/6 条、14a W3）转对应 owner。

结论：H1-H4 已接线；H5 转给 CodeEditor owner。
