# 接线请求 · bm3（书签域第二轮）· 2026-10-06

> 派单规约 §2：以下目标文件都是保留文件或别人名下（`src/App.vue`、`src/keymap.ts`、`src/menus/*`、
> `src/toolViewContext.ts`、`src/components/*`），本代理**一个字都没改**，只交可照抄的 old/new 片段。
> 报告本体：`docs/batch-2026-10-06-bm3.md`。
> 上游基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`
> —— 本文件每条坐标都是本轮 `Read`/`sed` 实读过的行；本轮**没有**上网、没有引用别人的坐标而不复核。
>
> 锚点原文一律逐字照抄现文件（含缩进）。改之前请**重读那几行**：工作区是 12 路并行的，行号会漂，
> 所以每条都同时给了"这一段的识别特征"（同一行里必须出现的关键调用）。

## §0 先核对：历次请求里"目标为保留文件的书签条目"现状

| 条目 | 目标 | 本轮实测 | 结论 |
|---|---|---|---|
| `docs/wiring-requests-2026-10-06-bookmarks.md` **W-3**（编辑器标签右键那三行的**行序**） | `src/components/TabContextMenu.vue` | `grep -n "ctx.bookmarkFile(path)" src/components/TabContextMenu.vue` ⇒ **68**；`:69` 编辑描述、`:70` 添加另一书签…（三行都在，顺序仍是 Toggle 先） | **未闭环** ⇒ 见 **R-1**（本文件把它改成可直接粘贴的形状） |
| 同上（项目视图右键那一族，W-3 的孪生：上游 `xml:227` 把同一个组也挂到 `ProjectViewPopupMenu`） | `src/App.vue` | `:2447` Toggle、`:2448` 编辑描述 + 添加另一书签… ⇒ 顺序同样是 Toggle 先 | **未闭环**（上一轮的请求没覆盖这一处）⇒ 见 **R-2** |
| `docs/wiring-requests-2026-10-06-bucket14a.md` W1 / `-bucketW.md` H3（原文写"…在**书签**之前插一格「将目录标记为」"） | `src/App.vue` | `:2474-2476` 已有 `markRootMenu(treeMenu.entry)` / `applyMarkRoot(...)` 那一段（`:1373` 也从 `createTreeActions` 取了这两个口） | **已闭环，证据 `src/App.vue:2474-2476`**（书签只是位置锚点，不是书签域行为） |
| `docs/wiring-requests-2026-10-06-toolwindow2.md` W-TW2-2 / W-TW2-3（"把「**书签**」拖到分隔件之上"、"`files`/`git`/`outline`/`bookmarks` 都没有 `canCloseContents`"） | `src/App.vue`、`src/components/ToolWindowView.vue` | 那两段的"书签"只是**举例**（工具窗口侧栏的拖拽换组 / 齿轮行的窗口 id），不是书签行为；本轮未核其落地状态（属 toolwindow 域） | **非书签域**，不动别人的请求 |
| `docs/wiring-requests-2026-10-05.md:128`（`pv/bookmarks-alias`（5）） | —— | 那是族计数，不是接线请求 | 不适用（无挂点可核） |
| `docs/wiring-requests-2026-10-06-bookmarks.md` **W-1**（问题面板四个 `AnalysisUIOptions` 控件） | `src/components/ProblemsPanel.vue` | `grep -c "analysisUiOptions\|setAnalysisUiOption" src/components/ProblemsPanel.vue` ⇒ **0** | **未闭环**（`lp/analysis-scope` 域，非书签；请求原文仍然有效，本轮不重复抄） |
| 同上 **W-2**（项目打开即注入命名作用域表） | `src/settingsPersistence.ts` / `src/App.vue` | `grep -rn setAnalysisScopeNamedScopes src/` ⇒ 生产调用方仍只有 `src/components/ScopesSettingsPage.vue:395` | **未闭环**（同上，`lp` 域） |

下面 R-1 / R-2 / R-3 / R-4 / R-5 是本轮的请求。R-3、R-4、R-5 的**模块侧本轮已经做完**，
只差宿主那几行；片段都是照抄现文件后改出来的最小 diff。

---

## R-1 · 编辑器标签右键：三行改成上游的组内顺序

- **目标文件**：`src/components/TabContextMenu.vue`（桶 8 / appvue 名下）
- **锚点**：`<template>` 里第 68-70 行（识别特征：同一行里有 `ctx.bookmarkFile(path)`）。
- **old**（现文件逐字，68-70）：

  ```vue
      <button @click="ctx.bookmarkFile(path); close()">{{ ctx.fileBookmarkLabel(path) }}</button>
      <button v-if="ctx.fileBookmarkLabel(path) === '删除书签'" @click="ctx.editBookmarkAt(path); close()">编辑描述</button>
      <button v-if="ctx.fileBookmarkLabel(path) === '删除书签'" @click="ctx.addFileBookmarkToAnotherList(path); close()">添加另一书签…</button>
  ```

- **new**：

  ```vue
      <button v-if="ctx.fileBookmarkLabel(path) === '删除书签'" @click="ctx.addFileBookmarkToAnotherList(path); close()">添加另一书签…</button>
      <button v-if="ctx.fileBookmarkLabel(path) === '删除书签'" @click="ctx.editBookmarkAt(path); close()">编辑描述</button>
      <button @click="ctx.bookmarkFile(path); close()">{{ ctx.fileBookmarkLabel(path) }}</button>
  ```

- **为什么**：上游挂在 `EditorTabPopupMenu` 上的组 `popup@ExpandableBookmarkContextMenu` 的三条 reference
  就是这个顺序 —— `platform/bookmarks/resources/intellij.platform.bookmarks.xml:222-227`
  （`:223` AddAnotherBookmark、`:224` EditBookmark、`:225` ToggleBookmark、`:226` 挂 `EditorTabPopupMenu`、
  `:227` 挂 `ProjectViewPopupMenu`；本轮已重读这六行）。
- **可见性条件不用改**：后两行的 `v-if` 与上游等价 —— `EditBookmarkAction.kt:14-16` 的
  `isEnabledAndVisible = process(event, false) != null`，而 `:27-28` 取的 `group.getDescription(bookmark)`
  在 `BookmarksManagerImpl.kt:579-585` 首次被问就用 `createDescription` 补一个（文件书签补空串、不是 null）
  ⇒ 书签存在就显示；`AddAnotherBookmarkAction` 对行书签 `return false`，而标签菜单拿到的永远是文件书签
  （`actions/extensions.kt:57-61`），条件同样是"已有文件书签"。
- **同族残余偏差（不在这条里，记账用）**：整组的**插入位置**（上游在 `ReopenClosedTab` 之后，本仓在菜单首格）
  已记在 `docs/ui-placement-audit.md`，本轮不动。

## R-2 · 项目视图右键：同样三行的顺序（`App.vue` 那一份）

- **目标文件**：`src/App.vue`（保留文件）
- **锚点**：第 2447-2448 行（识别特征：同一行里有 `bookmarkFile(treeMenu.entry.path)`）。
- **old**（现文件逐字；注意 2448 是**一行里塞了两个 `<button>`**）：

  ```vue
          <button @click="bookmarkFile(treeMenu.entry.path); treeMenu = null">{{ fileBookmarkLabel(treeMenu.entry.path) }}</button>
          <button v-if="fileBookmarkLabel(treeMenu.entry.path) === '删除书签'" @click="editBookmarkAt(treeMenu.entry.path); treeMenu = null">编辑描述</button><button v-if="fileBookmarkLabel(treeMenu.entry.path) === '删除书签'" @click="addFileBookmarkToAnotherList(treeMenu.entry.path); treeMenu = null; treeSubmenu = null">添加另一书签…</button>
  ```

- **new**（只换顺序，其余逐字不动；第二行里那两个 button 的 `@click` 表达式保持原样）：

  ```vue
          <button v-if="fileBookmarkLabel(treeMenu.entry.path) === '删除书签'" @click="addFileBookmarkToAnotherList(treeMenu.entry.path); treeMenu = null; treeSubmenu = null">添加另一书签…</button><button v-if="fileBookmarkLabel(treeMenu.entry.path) === '删除书签'" @click="editBookmarkAt(treeMenu.entry.path); treeMenu = null">编辑描述</button>
          <button @click="bookmarkFile(treeMenu.entry.path); treeMenu = null">{{ fileBookmarkLabel(treeMenu.entry.path) }}</button>
  ```

- **为什么**：`ProjectViewPopupMenu` 挂的是**同一个组**（`platform/bookmarks/resources/intellij.platform.bookmarks.xml:227`）
  ⇒ 行序与 R-1 必须一致，否则同一个组在两个宿主里长出两种顺序。
- **注意**：这条与 `docs/wiring-requests-2026-10-06-bucket14a.md` W1 / `-bucketW.md` H3 抢的是同一个菜单块，
  但那两条**已经落地**（证据见 §0：`src/App.vue:2474-2476`），不会再冲突。

## R-3 · 书签面板取段：别再整张筛掉带 `isDefault` 的命名列表

- **目标文件**：`src/toolViewContext.ts`（不在本代理名下）
- **锚点**：第 177-181 行（识别特征：`bookmarkLists: [`）。
- **old**（现文件逐字）：

  ```ts
    bookmarkLists: [
      ...(projectSettings.value.bookmarkLists ?? []).filter((list: { isDefault: boolean }) => !list.isDefault)
        .map((list: { name: string; bookmarks: unknown[] }) => ({ name: list.name, isDefault: false, entries: list.bookmarks })),
      { name: workspace.value?.name ?? '默认', isDefault: true, entries: sortedAll.value },
    ],
  ```

- **new**（改成走本轮刚落地的纯函数；`Bookmark` 那层的 path/line 校验仍在
  `bookmarkSettings.normalizeBookmarkLists` 里做过 ⇒ 这里只是形状转换）：

  ```ts
    // 段序与「只有一段带默认标记」这两条规则现在在 `src/bookmarkLists.ts` 的 `panelSections`
    //（与书签面板用的 `panelLists` 同一份口径，判据 tests/bookmark-lists.test.mjs）。
    bookmarkLists: panelSections(projectSettings.value.bookmarkLists ?? [], sortedAll.value, workspace.value?.name ?? '默认'),
  ```

  并在文件顶部加值 import（注意 `.ts` 扩展名）：

  ```ts
  import { panelSections } from './bookmarkLists.ts'
  ```

- **为什么**：现在这份 `.filter(!isDefault)` 会把那张列表**整段藏起来**——里面的书签在面板里一条都看不见
  （用户视角就是"列表凭空消失"）。上游的约束是"**默认标记**只能有一个"（`Group.isDefault` 的 setter
  顺手清掉旧默认，`platform/bookmarks/src/com/intellij/ide/bookmark/BookmarksManagerImpl.kt:529-534`），
  不是"带默认标记的列表不渲染"；`getGroups()`（`:144`）把全部列表都交给树。
  本仓的处理是：段照常出现、`isDefault` 归到历史字段那份（`src/bookmarkLists.ts` 的 `panelSections` 注释里写全了）。
- **不接的后果**：面板（`panelLists`，本轮已改）与宿主这份取数**口径不一致**，
  同一份存档在两处渲染出不同的段数。

## R-4 · 「编辑器内下一个 / 上一个行书签」两行菜单（模型与宿主 API 都已就绪）

- **目标文件**：`src/menus/navigateMenu.ts`（不在本代理名下）＋ `src/App.vue`（保留文件）
- **上游**：动作 id `GotoNextBookmarkInEditor` / `GotoPreviousBookmarkInEditor`
  （`platform/bookmarks/resources/intellij.platform.bookmarks.xml:74-79`，图标 `NextOccurence` / `PreviousOccurence`）；
  显示名 "Next Line Bookmark in Editor" / "Previous Line Bookmark in Editor"
  （`platform/platform-resources-en/src/messages/ActionsBundle.properties:1335-1336`，中文按这条直译，
  本机中文包不在本地树 ⇒ 注明是直译）；
  行为本体 `platform/bookmarks/src/com/intellij/ide/bookmark/actions/NextBookmarkInEditor.kt:32-59`。
  **默认键位表里没有这两个动作**（`platform/platform-resources/src/keymaps/` 全树 grep 只在外来键位表
  `Sublime Text.xml:241/245` 见到 `GotoNextBookmark` 一族）⇒ 别给它们编快捷键。
- **本仓已备好**（本轮落地，判据 `tests/bookmarks.test.mjs`）：
  · 规则本体 `src/bookmarks.ts` 的 `nextLineBookmarkInFile(list, path, line, reverse, cyclic?)`
  （同文件、严格 > / < 光标行、默认不回绕 —— 回绕开关是注册表
  `ide.bookmark.occurrence.cyclic.iteration.allowed`，默认 false，`platform/bookmarks/src/com/intellij/ide/bookmark/BookmarkOccurrence.kt:57-58`）；
  · 宿主入口 `createBookmarkActions(...)` 返回值里的 **`cycleBookmarkInEditor`**（`src/bookmarkActions.ts:327-333`，已进 `:375` 的 return）。
- **接线 ①**：`src/menus/navigateMenu.ts` 的 `NavigateContext`（锚点：第 24-26 行，识别特征 `cycleBookmark: any`）

  old：
  ```ts
    active: any
    cycleBookmark: any
  ```
  new：
  ```ts
    active: any
    cycleBookmark: any
    cycleBookmarkInEditor: any
  ```

- **接线 ②**：同文件第 181-182 行之后插两行（锚点识别特征：同一行里有 `navigate.bookmarkNext` / `navigate.bookmarkPrevious`）

  old：
  ```ts
      { id: 'navigate.bookmarkNext', title: '下一个书签', keywords: 'next bookmark project wide 下一个书签', run: () => ctx.cycleBookmark(false) },
      { id: 'navigate.bookmarkPrevious', title: '上一个书签', keywords: 'previous bookmark project wide 上一个书签', run: () => ctx.cycleBookmark(true) },
  ```
  new（前两行一字不动，后面补两行；`keys` 故意不写 —— 上游没有默认键位）：
  ```ts
      { id: 'navigate.bookmarkNext', title: '下一个书签', keywords: 'next bookmark project wide 下一个书签', run: () => ctx.cycleBookmark(false) },
      { id: 'navigate.bookmarkPrevious', title: '上一个书签', keywords: 'previous bookmark project wide 上一个书签', run: () => ctx.cycleBookmark(true) },
      // 上游 GotoNext/PreviousBookmarkInEditor（intellij.platform.bookmarks.xml:74-79）：只在这个文件里走、默认不回绕。
      { id: 'navigate.bookmarkNextInEditor', title: '编辑器内下一个行书签', keywords: 'next bookmark in editor line 编辑器内下一个书签', enabled: ctx.hasEditor, run: () => ctx.cycleBookmarkInEditor(false) },
      { id: 'navigate.bookmarkPreviousInEditor', title: '编辑器内上一个行书签', keywords: 'previous bookmark in editor line 编辑器内上一个书签', enabled: ctx.hasEditor, run: () => ctx.cycleBookmarkInEditor(true) },
  ```
  ⚠ 这两条的**文案是直译**（本机中文包不在这棵树里）；若主代理手上有中文包，请按
  `action.GotoNextBookmarkInEditor.text` 的原串替换，别留我这句。
- **接线 ③**：`src/App.vue` 两处（锚点：`:1253` 那行有 `jumpMnemonic, cycleBookmark, dropBookmark`；
  `:1521` 那行是 `const navigateMenuContext: NavigateContext = { active, cycleBookmark,`）

  old（`:1253` 内，识别特征 `jumpMnemonic, cycleBookmark,`）：
  ```ts
    jumpMnemonic, cycleBookmark, dropBookmark, mnemonicOwner, persistBookmarks, bookmarkMnemonicLabel, bookmarkFile, fileBookmarkLabel, addFileBookmarkToAnotherList, clearMnemonicAt, gutterBookmarks, toggleBookmarkAt, editBookmarkAt, descriptionPrompt, saveBookmarkDescription,
  ```
  new：
  ```ts
    jumpMnemonic, cycleBookmark, cycleBookmarkInEditor, dropBookmark, mnemonicOwner, persistBookmarks, bookmarkMnemonicLabel, bookmarkFile, fileBookmarkLabel, addFileBookmarkToAnotherList, clearMnemonicAt, gutterBookmarks, toggleBookmarkAt, editBookmarkAt, descriptionPrompt, saveBookmarkDescription,
  ```

  old（`:1521` 内，识别特征 `cycleBookmark, goBack`）：
  ```ts
  const navigateMenuContext: NavigateContext = { active, cycleBookmark, goBack, goForward,
  ```
  new：
  ```ts
  const navigateMenuContext: NavigateContext = { active, cycleBookmark, cycleBookmarkInEditor, goBack, goForward,
  ```

## R-5 · 两个「书签清单」弹窗与三个键位（F11 那一族现在的键位与上游不一致）

- **目标文件**：`src/keymap.ts` + `src/menus/navigateMenu.ts`（都属主代理）＋ 一个新组件（谁的桶都行）
- **上游键位**（`platform/platform-resources/src/keymaps/$default.xml`，本轮逐行读过）：
  · `:356-358` `ShowBookmarks` = **Shift+F11** —— `ShowLineBookmarksAction`，弹一个"书签"窗口
  （标题 `popup.title.bookmarks=Bookmarks`，`platform/lang-api/resources/messages/BookmarkBundle.properties:62`；
  动作名两态：高级设置 `show.line.bookmarks.in.popup` 开着 = `show.line.bookmarks.action.text`（`:65`），
  关着 = `ActionsBundle.properties:1326` 的 "Show Bookmarks…"）；
  · `:359-361` `ShowTypeBookmarks` = **Ctrl+Shift+F11** —— 标题 `popup.title.type.bookmarks=Go to Mnemonic`
  （`BookmarkBundle.properties:63`）、动作名 `Go to Mnemonic…`（`ActionsBundle.properties:1332`）；
  · `:925-927` `ActivateBookmarksToolWindow` = **Alt+2**；
  · `:776-780` `ToggleBookmark` = F11、`ToggleBookmarkWithMnemonic` = Ctrl+F11（本仓这两条已经对）。
- **本仓现状**（`src/keymap.ts:314-320`）：F11 = 切换 ✔、Ctrl+F11 = 助记符选择器 ✔、
  **Shift+F11 = 打开书签工具窗口**（上游那是 Alt+2 的活），Ctrl+Shift+F11 与 Alt+2 都没有，
  两个弹窗也没有。`src/menus/navigateMenu.ts:183` 那行同样写着 `keys: 'Shift F11'`。
- **模型侧本轮已备好**（判据 `tests/bookmarks-view.test.mjs`）：
  `src/bookmarksView.ts` 的 `bookmarkMnemonicRows(entries)`（「转到助记符…」的行：按 `BookmarkType`
  枚举序、一键一条、没键的不进来 —— 上游 `actions/ShowTypeBookmarksAction.kt:38-42`）与
  `assignedMnemonics(entries)`（上游 `getAssignedTypes`，`BookmarksManagerImpl.kt:168-170`，
  选择器拿它给已占用的键上色：`actions/BookmarkTypeChooser.kt:70`、`:219`）；
  枚举序那份数组是 `src/bookmarks.ts` 的 `BOOKMARK_TYPE_ORDER`（1..9、0、A..Z，
  `platform/lang-api/src/com/intellij/ide/bookmark/BookmarkType.kt:19-31`），
  与菜单那 36 行的 `BOOKMARK_MNEMONICS`（0..9、A..Z，`intellij.platform.bookmarks.xml:82-117`）是**两份**。
  弹窗的"只显示行书签"那一档在 `platform/bookmarks/resources/intellij.platform.bookmarks.xml:42-43`
  （高级设置 `show.line.bookmarks.in.popup` 默认 **true**），过滤语义在
  `ui/tree/RootNode.kt:26`（弹窗里不含行书签的列表整段不出现）与 `ui/tree/GroupNode.kt:27-29`
  （`filterIsInstance<LineBookmark>()`）。
- **要接什么**（组件出现之后再动键位，否则 Shift+F11 会退化成"什么都不做"，比现状更差）：
  1. 新组件 `src/components/BookmarksPopup.vue`（两条弹窗共用一个壳：`mode: 'line' | 'type'`），
     行模型直接用上面那两个函数 + `src/bookmarks.ts` 的 `bookmarkDescription` / `bookmarkFontBold`；
     跳转复用 `createBookmarkActions` 已交出的 `goTo(entry)`（`src/bookmarkActions.ts:256-259`）。
  2. `src/keymap.ts:314-320` 的 F11 分支改成四态（old 是现文件逐字）：

     old：
     ```ts
       if (event.key === 'F11') {
         event.preventDefault()
         if (event.ctrlKey) openMnemonicPrompt()
         else if (event.shiftKey) showView('bookmarks')
         else toggleBookmark()
         return
       }
     ```
     new：
     ```ts
       if (event.key === 'F11') {
         event.preventDefault()
         // $default.xml:356-361 —— Ctrl+Shift+F11 = ShowTypeBookmarks（Go to Mnemonic…）、Shift+F11 = ShowBookmarks。
         if (event.ctrlKey && event.shiftKey) openBookmarksPopup('type')
         else if (event.ctrlKey) openMnemonicPrompt()
         else if (event.shiftKey) openBookmarksPopup('line')
         else toggleBookmark()
         return
       }
     ```
     并把工具窗口的键位补成上游那条 `alt 2`（`$default.xml:925-927`）：
     在同一个函数里加 `if (event.altKey && !event.ctrlKey && !event.shiftKey && event.key === '2') { event.preventDefault(); showView('bookmarks'); return }`
     —— 本轮实测 `grep -n "key === '2'\|Digit2" src/keymap.ts` ⇒ **0 命中**（`2` 这个键在键位函数里没被别处吃掉）；
     但同文件里 `event.altKey` 的组合分支很多（`:193`、`:273`、`:283`…），接之前请按顺序确认这条
     `alt 2` 不会被前面某条 alt 分支先截走（`ActivateBookmarksToolWindow` 之外本仓还有
     `alt 2` 的既有用法吗？本轮没查出别的 `altKey + 数字` 分支，但键位函数是一条长 if 链，位置决定优先级）。
  3. `src/menus/navigateMenu.ts:183` 那行的 `keys: 'Shift F11'` 要跟着改成 `'Alt 2'`，并新增两行
     `showBookmarksPopup`（`keys: 'Shift F11'`）与 `showMnemonicBookmarksPopup`（`keys: 'Ctrl Shift F11'`）。
- **不做的事**：`AdvancedSettings.getBoolean("show.line.bookmarks.in.popup")` 这一档本仓没有高级设置存储
  ⇒ 弹窗按上游的**默认值 true**（只有行书签）实现，别加一个没人读的开关。

---

## 本轮已经在本仓闭环、不需要主代理接线的（免得重复找）

1. **面板的 X 与「编辑描述」对命名列表里的书签终于有反应**：路由在
   `src/bookmarkActions.ts`（`dropBookmark` 先看 `removeBookmarkFromNamedList`，
   `editBookmarkAt` 先看 `bookmarkInFirstNamedList`，`saveBookmarkDescription` 落回同一张列表），
   语义本体在 `src/bookmarkLists.ts`（`listsHolding` / `removeFromFirstHolder` / `setDescriptionInList`）。
   挂点一个字没动（`src/toolViewContext.ts:134/169` 与 `src/components/BookmarksPanel.vue` 现状即可），
   判据 `tests/bookmarks.test.mjs` 最后那条链路断言 + `tests/bookmark-lists.test.mjs` 两条新断言。
2. **项目级「下一个 / 上一个书签」不再把文件书签算进循环**（`src/bookmarks.ts` 的 `nextBookmark`），
   宿主侧 `cycleBookmark` 调用形状没变 ⇒ 不需要接线。
3. **书签面板不再渲染两段「默认」**：`src/bookmarkListActions.ts` 的 `panelLists` 现在走 `panelSections`
   （面板 `src/components/BookmarksPanel.vue:54` 直接吃它，挂点无需改动）。宿主那份取数还差 R-3。
4. **编辑后对账不再把"缺锚"当成空串**（`src/bookmarks.ts` 的 `reconcileBookmarks`）——纯内部。

## 可销账

- `docs/wiring-requests-2026-10-06-bookmarks.md` 的 W-3 **仍然有效**（未闭环），本文件 R-1/R-2 是它的可粘贴版；
  原文件那份给的片段与现文件逐字一致（本轮核对过），主代理二选一即可，**别两处都改**。

## 处理结果（wiring-backlog lane，2026-10-06）

**真接了 3 条（R-1 / R-2 / R-4），跳过 2 条给别的 owner。**

- **R-1 已接线** `src/components/TabContextMenu.vue:68-70`：三行顺序改成上游组内顺序（添加另一书签… / 编辑描述 / Toggle），可见性条件逐字未动。
- **R-2 已接线** `src/App.vue:2511-2512`：项目视图右键那三行同序（`addFileBookmarkToAnotherList` + `editBookmarkAt` 合并在 :2511，Toggle 移到 :2512），两个 `@click` 表达式逐字保留。
- **R-4 已接线**：① `src/menus/navigateMenu.ts:27` `NavigateContext` 补 `cycleBookmarkInEditor: any`；② 同文件 `:184-185` 在 `navigate.bookmarkPrevious` 之后补两行 `navigate.bookmarkNextInEditor` / `navigate.bookmarkPreviousInEditor`（不写 `keys`，`enabled: ctx.hasEditor`）；③ `src/App.vue:1325` 解构补 `cycleBookmarkInEditor`、`:1591` `navigateMenuContext` 补该键。上游 `intellij.platform.bookmarks.xml:74-79`，模型侧 `src/bookmarkActions.ts:327` 已在 `:375` 的 return 里。
- **R-3 跳过** —— 目标 `src/toolViewContext.ts` **不在本 lane 名下**（lane 所有权只有 `src/App.vue` / `src/components/**`（除四文件）/ `src/menus/**`）。需 `src/toolViewContext.ts` 的 owner 处理：把 `bookmarkLists` 那段 `.filter(!isDefault)` 换成 `panelSections(...)` + 顶部 `import { panelSections } from './bookmarkLists.ts'`。
- **R-5 跳过** —— 核心挂点是 `src/keymap.ts`（F11 四态 + `alt 2`）与 `src/menus/navigateMenu.ts:183` 的 `keys`，`src/keymap.ts` **不在本 lane 名下**。`src/components/BookmarksPopup.vue` 虽属本 lane 可建，但请求原文自己写明「组件出现之后再动键位，否则 Shift+F11 会退化成什么都不做，比现状更差」；在拿不到 `keymap.ts` 的前提下建它 = 零消费组件。需 `src/keymap.ts` 的 owner 处理（键位 + `openBookmarksPopup('line'|'type')`），之后本 lane 可补组件。

App.vue 行数：2677 → 2677（R-2 是同块内换序、R-4 是同行内加词，净 0）。
