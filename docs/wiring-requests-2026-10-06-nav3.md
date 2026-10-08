# 接线请求 · 代号 nav3（导航 / 最近位置 / Select In 域）· 2026-10-06

本文件两半：
§1 是本轮（接手 nav3）**新发现**的五条宿主/他人名下调用点，每条给「目标文件 + 目标行 + 可照抄的 old/new + 上游依据」；
§2 是对 `docs/wiring-requests-2026-10-06-navigation2.md`（N-1…N-5）与
`docs/wiring-requests-2026-10-06-usage3.md`（R-1…R-3）的**逐条现状判定**（已闭环 / 仍缺 / 前提变了）。

所有上游坐标都是本轮亲自打开参考树按行自数核对的；所有本仓行号都是本轮 `sed -n` / `grep -n` 实测的
（工作区共享，12 路并行，落之前请按字符串再定位一次 —— `src/App.vue` 在本轮中途就被别人的提交动过）。

---

## §1 本域新请求

### H-1（`appvue`）· 宿主把导航栈两格的**类型**跟上：`{ path; line }` → `NavSpot`

**现状**：`src/App.vue:509-510` 仍是
```ts
const navBack = ref<{ path: string; line: number }[]>([])
const navForward = ref<{ path: string; line: number }[]>([])
```
而 `src/lspNavigation.ts:72` 已经把这一个域的形状定成
`export interface NavSpot { path: string; line: number; pane: PaneGroup<Tab> | null }`
（上游 `PlaceInfo` 的 `window` 字段：`platform/platform-impl/src/com/intellij/openapi/fileEditor/impl/IdeDocumentHistoryImpl.kt:685-694`、
取用 `:712`、跳回去作为 `openFile(window = …)` 的实参 `:572-579`）。

**为什么要动**：今天不会出错（`LspNavigationDeps.navBack: Ref<any>`），但**只要宿主有一处重建这两个数组**
（照现在的手写类型重建就会把 `pane` 丢掉，「上一步/下一步/最近位置回原来那一栏」这条用户可见行为就静默退化）。
钉住类型 = 让下一次改宿主的人必须处理 `pane`。

**目标行**：`src/App.vue:509-510`（老→新逐字替换）：
```ts
// old
const navBack = ref<{ path: string; line: number }[]>([])
const navForward = ref<{ path: string; line: number }[]>([])
// new
const navBack = ref<NavSpot[]>([])
const navForward = ref<NavSpot[]>([])
```
**import**（`src/App.vue:100` 现在那一行是 `import type { Place } from './lspNavigation'`）：
```ts
import type { NavSpot, Place } from './lspNavigation'
```
（同文件 `:61` 的 `import { createLspNavigation, CLASS_KINDS, type SymbolEntry } from './lspNavigation'` 不动。）

**判据**：`tests/nav-places-pane.test.mjs` 的「② 每一格与环里每一格都带着自己那一栏」已经钉了模块侧那一半；
宿主这一半落完之后建议把锚点扩到 `src/App.vue`（同一族的字符串 `ref<NavSpot[]>([])` 两处）。

---

### H-2a（`appvue`）· 新开文件那格要把当前分栏记进去

**现状** `src/App.vue:907`：
```ts
    rememberPlace({ kind: '文件', path, line: 0, label: path })
```
**改成**（同函数里 `groups` 与 `focusedPane` 都已在作用域内，见 `src/App.vue:899-905`）：
```ts
    rememberPlace({ kind: '文件', path, line: 0, label: path, pane: groups[focusedPane.value] })
```
**上游依据**：`IdeDocumentHistoryImpl.kt:689`（`PlaceInfo` 的 `window` 形参）+ `:694` 的 `WeakReference` ——
每一条位置都**自带**当时那个窗口，不是可选装饰。

### H-2b（`src/editorSplits.ts` 归属代理）· 切标签那格同样带上栏

**现状** `src/editorSplits.ts:122`（在 `switchTabIn(pane, tab)` 里，`pane` 与 `groups` 都是现成的）：
```ts
  rememberPlace({ kind: '文件', path: tab.path, line: Math.max(0, tab.line - 1), label: tab.path })
```
**改成**：
```ts
  rememberPlace({ kind: '文件', path: tab.path, line: Math.max(0, tab.line - 1), label: tab.path, pane: groups[pane] })
```
同文件 `:63` 已经解构出 `groups`，不需要新 import。

### H-2c（`src/bookmarkActions.ts` 归属代理，低优先）· 书签那格没有栏

`src/bookmarkActions.ts:130` 的 `rememberPlace({ kind: '书签', … })` 拿不到分栏：该模块的 deps（`:31` 附近）没有
`groups` / `splitModel`。两种落法，**都请归属代理选**，我不动别人的文件：
1. 给 `BookmarkActionsDeps` 补一条 `currentPaneGroup: () => PaneGroup<Tab> | null`，宿主在
   `src/App.vue:1272` 的 `createBookmarkActions({ … })` 实参里给 `currentPaneGroup: () => groups[splitModel.focused]`，
   然后 `:130` 加 `pane: deps.currentPaneGroup()`；
2. 或者认定「放书签不是导航」，把这条 `rememberPlace` 删掉（上游 `commitBackPlace` 只在
   `currentCommandIsNavigation && currentCommandHasMoves` 时才提交，`IdeDocumentHistoryImpl.kt:285-287` ——
   放书签这条命令两个条件都不满足 ⇒ **上游不会因为打个书签就往「最近位置」里塞一格**）。
   这一条是**行为差异**，需要判词确认；我倾向方案 2，但那是书签域的账。

---

### H-3（`src/workspaceLifecycle.ts` 归属代理）· 换工程要清**两条**环，现在只清一条

**现状**：`src/workspaceLifecycle.ts:296` 与 `:414` 都只有 `places.value = []`，`changePlaces` 从来没被清过
（同文件 `:64` 已经接过 `places` 这条 dep）。后果（用户可见）：换到另一个工程之后，
「最近位置」弹层勾上「仅显示已编辑的」还能列出**上一个工程**的文件，`Ctrl+Shift+Backspace` 会把人往旧工程的那一行带。

**上游依据**：`IdeDocumentHistoryImpl.kt:80` —— 这个历史是 **project 级** `@State`（挂在 workspace 存储上），
换工程 = 换一个实例 = 两条环天然为空。

**目标行 / 可照抄**（两处各一行，`changePlaces` 需要像 `places` 一样进 deps）：
```ts
// :64 的 dep 声明
  places: any
// 之后补一行
  changePlaces: Ref<Place[]>        // 或与其它两行同风格：changePlaces: any
// :296 与 :414 各改成
  places.value = []
  changePlaces.value = []
```
宿主那一侧：`src/App.vue:1909` 那条注入列表里 `closeAllPanes, navBack, navForward, treeVersion, places, projectSettings, …`
加上 `changePlaces`（同一个解构出来的 ref，见 `src/App.vue:302`）。
**游标不用单独清**：`changePlaces` 清空后 `previousChangePlace` 直接给 `null` ⇒ `jumpLastEditLocation` 走
「没有上次编辑位置。」那条提示（判据：`tests/recent-locations.test.mjs` 的「空环与单格环」）。

---

### H-4（`src/explorerActions.ts` 归属代理）· `recentlyEdited` 这一类**没有写入点**

**现状**：`src/explorerActions.ts:239-243` 的 `rememberRecent(path)` 只写 `recentlyOpened` 一条通道
（`:241`），`recentFilesModel.ts` 的 `recentlyEdited` / `recentlyOpenedPinned` 两格除了自己的判据之外没有任何调用点
⇒ 这是「只过自己测试的出口」，本域的零消费方自查里已经记成 `[ ]`。

**上游依据**：写入 = `platform/recentFiles/frontend/src/com/intellij/platform/recentFiles/frontend/RecentFilesEditorTypingListener.kt:36`
（打字 ⇒ `applyFrontendChanges(RECENTLY_EDITED, listOf(file), FileChangeKind.ADDED)`）；
类别枚举 = `platform/recentFiles/shared/src/com/intellij/platform/recentFiles/shared/FileSwitcherApi.kt:58`。

**可照抄的落法**（在本文件里加一条**已经有人要**的通道，宿主只需要在编辑器变更钩子上调一次）：
```ts
// old（src/explorerActions.ts:239-246）
  function rememberRecent(path: string) {
    if (!path) return
    const next: RecentFilesState = { ...recentFilesState.value, recentlyOpened: addEvent(recentFilesState.value.recentlyOpened, [path]) }
// new
  function rememberRecent(path: string) {
    if (!path) return
    const next: RecentFilesState = { ...recentFilesState.value, recentlyOpened: addEvent(recentFilesState.value.recentlyOpened, [path]) }
// 并在同文件里补一条（导出名与 deps 表 :281 一起加）：
  function rememberRecentEdit(path: string) {
    if (!path) return
    const next: RecentFilesState = { ...recentFilesState.value, recentlyEdited: addEvent(recentFilesState.value.recentlyEdited, [path]) }
    recentFilesState.value = next
    try { window.localStorage.setItem(RECENT_FILES_STORAGE_KEY, serializeRecentFiles(next)) }
    catch { /* storage unavailable: session-only */ }
  }
```
调用点必须在**编辑**那一刻：本仓的编辑钩子是 `src/lspNavigation.ts` 的 `onEditorChange`（`:257-266` 那一段，
紧挨着 `rememberPlace(..., edited: true)`）。把 `rememberRecentEdit` 经 `LspNavigationDeps`（`src/lspNavigation.ts:111` 附近）
传进来、在 `:262` 之后调一次即可 —— **这一步要动 `src/App.vue` 的注入表**（`src/App.vue:709` 那条
`editorSettings, working, hasTabPath, rememberPlace, bufferEpoch, splitOrientation,` 列表），归 appvue。
上游依据同一处：`RecentFilesEditorTypingListener.kt:36`。

### H-5（`appvue`）· 读出 `recentlyEdited` 的那一层是 Switcher（Ctrl+Tab），本仓没有 ⇒ 不渲染

上游读出侧全部住在 `platform/recentFiles/frontend/src/com/intellij/platform/recentFiles/frontend/Switcher.kt`：
`:318`（`onlyEdited -> getRecentFiles(RECENTLY_EDITED)`）、`:551`（复选框决定读哪一类）、`:620`（列表整体换成编辑过的那一份）。
本仓没有 Ctrl+Tab 的 Switcher 面板，`Ctrl+E` 那个面板读的是 `recentlyOpened`（`src/explorerActions.ts:238,247`）。
按规约「没有消费链路的 UI 一律不渲染」，我**没有**往 `Ctrl+E` 面板塞一个假的下拉。
需要主代理拍板：要么给 Switcher 立项（新组件 + 键位 + `pinned` 那一档才有归宿），要么把
`recentlyEdited` / `recentlyOpenedPinned` 两类从模型里删掉（`src/recentFilesModel.ts` 归最近文件那轮，我不动）。

---

## §2 N / R 条目逐条判定（本轮开仓核过现状，没有改它们的模块侧）

| 条目 | 判定 | 本轮实测的现状证据 | 缺的那一件 |
|---|---|---|---|
| **N-1**（`appvue`，引用面板换 `referenceRows`；= usage3 的 R-1） | **仍缺**（宿主那一半一行没落） | `src/App.vue:2242` 仍是 `v-for="(ref, index) in references"` 的平表；模块侧 `referenceRows` / `toggleUsageGroup` 齐且判据绿（`tests/usage-view-panel-rows.test.mjs` 12 条，本轮实跑在内共 86/86） | 照抄 `navigation2.md` §N-1 那段替换（行号从 2215-2218 漂到了 **2242**，请按 `class="ref-list"` 定位）；R-1 比 N-1 多两条：速度搜索 `referencesSpeedSearch` 与 `<input class="ref-speed-search">` —— **注意** `class="ref-speed-search"` / `.ref-group` / `.ref-count` 这几个类 `src/style.css` 里**没有**，落之前要么让主代理补类，要么照 N-1 那版只用已有的 `.ref-item`/`.ref-path`/`.ref-pos` |
| **N-1b**（面板三个按钮：全部展开/折叠/导出） | **仍缺，且前提要主代理拍板** | `src/App.vue:2242` 那一格里没有工具条层；导出通道现成 —— `src/App.vue:1356` 的 `request('dialog.saveFile', …)` + `:1358` 的 `request('app.writeExportFiles', …)` 两跳（原请求写的 `:1333-1337` 已被别人的提交位移，本轮重数过） | 加就是新增布局 ⇒ 归 appvue；加了必须带 `v-if="references.length"` |
| **N-2**（`src/menus/toolWindowGear.ts` 登记 `usage.groupBy`） | **仍缺** | `src/menus/toolWindowGear.ts:63` 只有 `{ action: 'usage.viewOptions', fromHost: true, contentsScoped: true },`，`:75` 之后是 `window.resizeToolWindow`；表里没登记的 id 被同文件 **`:140`** 的 `if (!row) continue` 丢掉（原请求写的 `:105-106` 已经位移，本轮按 `grep -n continue` 重定位过）⇒ 「分组」这一组**不出现**（不是假控件，但接不上） | 在 `:63` 之后插 `{ action: 'usage.groupBy', fromHost: true, contentsScoped: true },`，同批改 `tests/usage-view-gear.test.mjs` 的两处 `deepEqual` 期望（N-2 原文给了完整数组，断言是变严不是放松）。该文件本轮没在别人名下（`git status` 里不 M），但派单没写 ⇒ 我只给行不落手 |
| **N-3**（`appvue`，层级行消费 `row`） | **仍缺** | `src/App.vue:2254` 仍是 `v-for="({ node, depth }, index) in hierRows"`，`row` 解构了没人用 | `navigation2.md` §N-3 说 W-1 的替换段照抄即可，本轮复核成立（`src/hierarchyRenderer.ts` 的 `hierarchyRowModel` 产物与 `hierRows` 每行的 `{node, depth, row}` 都在，判据 `tests/hierarchy-renderer.test.mjs` 绿） |
| **N-4**（`appvue`，层级范围下拉）= **R-3** | **仍缺**（两条是同一个挂载点，R-3 比 N-4 多一条 notice） | `grep -n "hierScope" src/App.vue` ⇒ **0 命中**；`:1341` 从 `createHierarchyView` 解构的名字里没有 `hierScope` / `hierScopeOptions` / `setHierarchyScope` | 用 N-4 那版（脚本里 `pickHierScope` 窄化 + 模板 `<select>`），或 R-3 那版（模板内 `as HTMLSelectElement` —— 注意 R-3 写的 `($event.target as HTMLSelectElement)` 在 vue-tsc 下正是 N-4 特意避开的那种写法，**以 N-4 为准**）；`src/App.vue:1341` 的解构要补三个名字 |
| **N-5**（`src/semanticActions.ts` / `src/toolContents.ts` 的 provider 层） | **仍缺，前提没变** | `src/semanticActions.ts:131` 仍是 `startReferences(symbol, `${payload.path}#${symbol}`)`；`src/toolContents.ts:153,158` 的 `usagesTabName` / `usagesPanelTitle` 未动 | 原请求给的改法（换成 `${baseName(payload.path)}#${symbol}` 的形状）依旧成立，本轮复核过上游 `platform/indexing-api/src/com/intellij/lang/findUsages/DescriptiveNameUtil.java` 的文件名档确实是唯一能对齐的那一档；该文件不在我名下 |
| **R-2**（给引用面板接符号源 `provideUsageSymbols`） | **仍缺**（模块侧就绪） | `grep -rn "provideUsageSymbols" src/App.vue` ⇒ 0 命中（宿主从没注册过 provider）⇒ 树就停在「文件 → 行」两层，齿轮「分组」里只有「目录结构」一条（这正是设计里「不接也不报错」的那一档） | 宿主在引用结果回来后按文件注册一次 provider（可用 `src/lspPerFileCache.ts` 的 `documentSymbol` 缓存）；与 N-2 是**成对**的：N-2 不落的话，符号源接上也没有切换的入口 |

> N/R 八条里，**没有任何一条已经闭环**。八条缺的都不是模块侧：四条落 `src/App.vue`（H/N/R 的宿主行，归 appvue）、
> 一条落 `src/menus/toolWindowGear.ts`、一条落 `src/semanticActions.ts`+`src/toolContents.ts`、
> 一条（R-2）是 App.vue 的 provider 注册。本域（最近位置 / 导航栈 / Select In / 最近文件）自己那一半已经补齐并配了判据。

## 处理结果（wiring-backlog lane，2026-10-06）

- **H-1 已接线**：`src/App.vue:525-526` 已是 `ref<NavSpot[]>([])`，import 已含 `NavSpot`。
- **H-2a 已接线**：`src/App.vue:944` 的 `rememberPlace` 已带 `pane: groups[focusedPane.value]`。
- **H-2b / H-2c** —— 目标 `src/editorSplits.ts` / `src/bookmarkActions.ts`（非本 lane）。需对应 owner。
- **判据** `tests/nav-places-pane.test.mjs` **pass 5 / fail 0**。

结论：H-1/H-2a 已接线；H-2b/H-2c 转 owner。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「H-1/H-2a 已接线；H-2b/H-2c 转 owner。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
