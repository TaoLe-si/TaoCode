# wiring requests — dnd8（桶8：工具窗口条 / 拖放）

> 这份文档原本**从未落盘**（`docs/batch-2026-10-06-lane-board.md:317` 写「它的请求文档已在盘」，实测 `ls` + `grep -rln dnd8 docs/` 双确认盘上 0 个该文件），
> 而 `src/toolStripeDrag.ts:114` 与 `tests/dnd-stripe-drop-marker.test.mjs:16` 两处都在引它 ⇒ 悬空引用。
> 现由 stripefix 按**磁盘实况**补齐（坐标全部本机开上游树核过，未采信任何既有报告的行号）。
> 上游树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`。

## D-1 · 删掉宿主那条被组件自持判据取代的 `drop-at-end`（保留文件 `src/App.vue`）

**状态：仍然成立，但内容变了。** 原来那条「右条画不出落点指示」的用户可见缺陷，dnd8 已经在**非保留文件**
`src/components/ToolStripe.vue:206` 用本侧自己的 `isDropBefore(side, null)` 补上（两侧对称、右条也画得出来，
判据 = `tests/dnd-stripe-drop-marker.test.mjs` 第 3、5 条）。现在剩下的是**一条重复判据**：
`dropAtEnd` 与 `isDropBefore(side, null)` 在拖放期间恒等
（`dropTarget` 只在 `draggingTool` 非空时被写，`onToolDrop`/`onToolDragEnd` 一起清两个位，
见 `src/toolStripeDrag.ts:73-107`）⇒ 它是"第二个真相源"，该删。删它**不需要新增任何行**，
所以 `src/App.vue` 现有 **30 行**余量（2707 / 上限 2737，按 `tests/module-size.test.mjs:157` 的 `split('\n').length` 数法实测）绰绰有余。

### 目标文件 + 行号（本仓）

| 位置 | 现状 | 要改成 |
|---|---|---|
| `src/App.vue:429` | 解构里带 `dropTarget`（全文件**只有** `:2073` 读它） | 摘掉那一个名字 |
| `src/App.vue:2073` | `:drop-at-end="dropTarget?.side === 'left' && !dropTarget.before"` | 删掉这一段绑定 |
| `src/App.vue:2127` | `:drop-at-end="false"`（右条写死 ⇒ 当初那条不对称） | 删掉这一段绑定 |
| `src/components/ToolStripe.vue:40-46`、`:206` | `dropAtEnd: boolean` 这条 prop + `v-if="dropAtEnd \|\| isDropBefore(side, null)"` | 删 prop、`v-if` 只留 `isDropBefore(side, null)` |

⚠ **必须同一批**：只删组件那条 prop ⇒ `App.vue` 的两个绑定会掉成 fallthrough attribute（DOM 上出现 `drop-at-end="…"`）；
只删宿主绑定 ⇒ `ToolStripe.vue` 的必填 prop 缺值，`vue-tsc` 当场红。两边一起改才自洽。

### 可照抄的整段替换

`src/App.vue:429`（原行）：

```ts
const { draggingTool, dropTarget, onToolDragStart, onToolDragOver, onToolDrop, onToolDragEnd, isDropBefore } = createToolStripeDrag({
```

改为：

```ts
const { draggingTool, onToolDragStart, onToolDragOver, onToolDrop, onToolDragEnd, isDropBefore } = createToolStripeDrag({
```

`src/App.vue:2073`（原行，左条）：

```html
        :is-drop-before="isDropBefore" :drop-at-end="dropTarget?.side === 'left' && !dropTarget.before" :width="stripeWidth('left')" :more-ids="moreButtonRows" :show-names="editorSettings.showToolWindowNames" :compact="editorSettings.compactMode" :more-on-this-side="moreButtonVisible('left')"
```

改为：

```html
        :is-drop-before="isDropBefore" :width="stripeWidth('left')" :more-ids="moreButtonRows" :show-names="editorSettings.showToolWindowNames" :compact="editorSettings.compactMode" :more-on-this-side="moreButtonVisible('left')"
```

`src/App.vue:2127`（原行，右条）：

```html
        :is-drop-before="isDropBefore" :drop-at-end="false" :width="stripeWidth('right')" :more-ids="moreButtonRows" :show-names="editorSettings.showToolWindowNames" :compact="editorSettings.compactMode" :more-on-this-side="moreButtonVisible('right')"
```

改为：

```html
        :is-drop-before="isDropBefore" :width="stripeWidth('right')" :more-ids="moreButtonRows" :show-names="editorSettings.showToolWindowNames" :compact="editorSettings.compactMode" :more-on-this-side="moreButtonVisible('right')"
```

`src/components/ToolStripe.vue:206`（本仓可改面，宿主那一批落地后我这边同一批改）：

```html
      <span v-if="dropAtEnd || isDropBefore(side, null)" class="stripe-drop-marker" aria-hidden="true" />
```

改为：

```html
      <span v-if="isDropBefore(side, null)" class="stripe-drop-marker" aria-hidden="true" />
```

同批删掉 `:46` 的 `dropAtEnd: boolean` 与 `:40-45` 里那段解释宿主不对称的注释；
`src/toolStripeDrag.ts:113-114` 的「宿主给右条写死 `false`」两句随之改成「宿主不再传这一位」。
三处测试夹具的 `dropAtEnd: false` 顺手摘掉：`tests/dnd-stripe-drop-marker.test.mjs:52`、
`tests/stripe-resize-more.test.mjs:244`、`tests/workbench-dock-render.test.mjs:93`（断言体一字不动）。
**不需要新增 import**。

### 上游依据（本机开树核过，逐行）

`platform/platform-impl/src/com/intellij/openapi/wm/impl/AbstractDroppableStripe.kt`：

- `:354`、`:375`、`:409`、`:436` —— 四档认领落点前都先问 `if (processDrop && !data.dragTargetChosen)`；
  置位在 `:400`、`:440`。⇒ **一次拖放只认一个落点**，与"谁先认领"有关，与它是第几根条纹无关。
- `:436-441` —— 一个按钮都没认领时才有 `data.dragInsertPosition = -1`（`:437`）+ `dragToSide = true`（`:438`）
  这条**末尾兜底**。
- `:443-444` —— 连兜底都没发生（落点在这条条纹之外）⇒ `drawRectangle` 归零，也就是不画。
- 左右条是同一条 `doLayout`：`LeftToolbar`/`RightToolbar` 只是两个薄子类，上游**没有**"右条不算末尾落点"这一档
  ⇒ 本仓宿主给右条写死 `false` 属形态缺陷，删掉即与上游一致。

## 处理结果（wiring-backlog lane，2026-10-06）

- **D-1 已接线**：`src/App.vue:436` 解构摘掉 `dropTarget`；`:2123`（左条）与 `:2177`（右条）的 `:drop-at-end` 绑定已删；`src/components/ToolStripe.vue:47` 的 `dropAtEnd` prop 已删、`:207` 的 `v-if` 只留 `isDropBefore(side, null)`（注释同步）。判据 `tests/dnd-stripe-drop-marker.test.mjs` **pass 7 / fail 0**。

App.vue 行数：2695 → 2695（同段删绑定，净 0）。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
