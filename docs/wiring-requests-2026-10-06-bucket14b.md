# 接线请求 · 桶 14b（结构视图 / 本地历史 / TODO）· 2026-10-06

只读文件挂点请求，共 1 条。目标文件都不在桶 14b 名下（`ToolWindowView.vue` / `App.vue` / `src/toolViewContext.ts` 均为保留文件），所以按规约写请求不代改。

---

## W1 · 把编辑器光标喂给结构视图（「跟随编辑器光标」开关的数据源）

- **目标文件 / 行号**：`src/components/ToolWindowView.vue:172`（`<OutlinePanel>` 那一行）
- **数据源本仓已有**，不需要新写任何后端：
  - `src/App.vue:199` 已有 `const todoSource = computed(() => active.value ? { path: active.value.path, line: active.value.line } : null)`
  - `src/App.vue:889` 已把 `todoSource` 放进 ctx
  - `src/components/ToolWindowView.vue:42` 的 `ToolWindowViewContext` 已声明 `todoSource: any`
  - `src/toolViewContext.ts:75 / :116` 已把它透传出来
  - 同一份数据 `TodoPanel` 已经在吃（`src/components/ToolWindowView.vue:171` 的 `:source="ctx.todoSource"`）
- **可照抄的整段替换**（把 172 行整行换成下面这一行，只加 `:source=`，别的一字不动）：

```vue
  <OutlinePanel v-else-if="view === 'outline'" :path="ctx.activeTabPath" :symbols="ctx.outline" :available="ctx.lspReady" :source="ctx.todoSource" @jump="({ line, character }: { line: number; character: number }) => ctx.onReveal({ path: ctx.activePath, line, column: (character ?? 0) + 1 })" />
```

- **上游依据（基准树实测坐标）**：
  - `platform/structure-view-impl/src/com/intellij/ide/structureView/newStructureView/StructureViewComponent.java:804-849`
    —— `MyAutoScrollFromSourceHandler`（`:831-834` 注册 `addEditorPositionListener`，`:841` 的
    `isAutoScrollEnabled()` 读 `getSettings().AUTOSCROLL_FROM_SOURCE`）：编辑器光标一动就把树里的选中项跟着走。
  - 同文件 `:655-661` —— `scrollToSelectedElement()`，开头就有
    `if (!isShowing() || !getSettings().AUTOSCROLL_FROM_SOURCE) return;`：这根光标链的落点。
  - `platform/structure-view-impl/src/com/intellij/ide/structureView/impl/StructureViewFactoryImpl.java:49-50`
    —— `AUTOSCROLL_MODE = true` / `AUTOSCROLL_FROM_SOURCE = false`：本仓两个开关的默认值就是这两个数。
- **本仓已备好的那一半**（W1 一到就自动生效，不需要再改 `OutlinePanel.vue`）：
  - `src/components/OutlinePanel.vue:116` 的开关按 `v-if="source"` 条件渲染 —— 现在拿不到光标 ⇒ 整格不画（「不放假控件」）。
  - `src/components/OutlinePanel.vue:73-86` 的光标 watch、`src/outlineView.ts:127` `caretSymbolInTree`、
    `src/structureFollow.ts:63/:71/:75` 的包含判定 —— 逻辑与判据（`tests/structure-follow.test.mjs`，10 项）都过了，缺的只有这一个入参。
  - 门禁 `tests/outline-view.test.mjs`「the follow-editor toggle is not rendered without caret data」会在
    172 行补上 `:source=` 之前一直要求 `v-if` 存在；补上之后该条仍绿（它允许 `:source=` 已传的分支）。
- **不接的后果**：结构视图只剩「选中 → 跳源码」这一向（`StructureViewComponent.java:794-802` 的 `scrollToSource`，本仓已可用），
  反向的「光标 → 树中定位并滚过去」（`:655`）用户看不见，判词 `docs/inventory/verdict-projectviews.md:30` 里
  「autoscroll to/from source 两个开关」只能算做了一半。
