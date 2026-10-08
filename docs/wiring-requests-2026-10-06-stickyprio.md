# 接线请求 2026-10-06 · 代号 `stickyprio`（粘性行：多分栏各一份 + 视图优先级的宿主实参）

本批**只动** `src/stickyLines.ts` + `tests/sticky-lines.test.mjs` + `tests/sticky-line-viewport.test.mjs`。
下面三条是给保留文件（`src/App.vue`、`src/components/CodeEditor.vue`）的**请求**，本批一行都没改。

上游基准树（只读，本轮逐行开过）：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`
- `platform/platform-impl/src/com/intellij/openapi/editor/impl/stickyLines/StickyLinesManager.kt:15-34`
  （`internal class StickyLinesManager(private val editor: Editor, ...)` 在 `:15`，`:32`
  `editor.scrollingModel.addVisibleAreaListener(this, this)` ⇒ **每个编辑器一个 manager + 一块面板**）
- 同文件 `:86-99`（`visibleAreaChanged` 只驱动自己那块面板重算）
- 同目录 `StickyLinesModelImpl.java:93-100`（模型挂在**文档**的 MarkupModel userData 上 ⇒ 一份文档一份模型）
- 同目录 `VisualStickyLines.kt:134`（`if (startY2 < stickyY && stickyY <= endY2)` ⇒ 「起始行滚出**本栏**顶边」才算一层）
- **无法核实**：跨视图的先后。本轮再对 `platform/platform-impl/.../editor/impl/stickyLines/` 与
  `platform/lang-impl/.../codeInsight/stickyLines/` 两目录 grep `priority` —— 都**零命中**（`wc -l` = 0）。
  ⇒ 档位只能由宿主给，模块不编「哪个分栏在上/有焦点」。

模块侧现状（已就位，只差宿主实参）：`src/stickyLines.ts` 的 `StickyLinesDeps.views` / `currentLineOf`
与出口 `stickyLinesByView`（键序 = `orderStickyViews` 的稳定序）、`stickyLines`（= `primaryStickyView` 那块的那一份）。
判据：`tests/sticky-line-viewport.test.mjs` 后 3 条、`tests/sticky-lines.test.mjs` 末 1 条。

---

## W1 `src/components/CodeEditor.vue`：把**本栏**的可视区度量透出去（+1 行；上限 1147、现 1144 ⇒ 腾 3 行的办法在下面）

- **要接什么**：在已有的 `defineExpose({ … })`（`:423` 起）里加**一行**：
  ```ts
  stickyView: () => (view ? stickyViewFrom(view) : undefined),
  ```
  `stickyViewFrom` 放**非保留侧**新建的 `src/stickyMetrics.ts`（`export function stickyViewFrom(v: EditorView): StickyView`），
  把多行算术留在模块里，保留文件只留这一行 —— 与 `docs/wiring-requests-2026-10-06-fold3b.md` W2 同一口径，
  那份写的是 `stickyMetrics()`，本批入口改收 `StickyView`（要带 `id`/`priority`），故换名，二者取其一即可。
- **`stickyViewFrom` 里能用的 API（本批逐个在 `node_modules/@codemirror/*/dist/index.d.ts` 里核实过行号）**：
  - `view.viewport: { from: number; to: number }` —— `@codemirror/view` `index.d.ts:750-753`
  - `view.lineBlockAt(pos): BlockInfo` —— `:933`；`view.lineBlockAtHeight(height): BlockInfo` —— `:917`
  - `view.scrollDOM: HTMLElement` —— `:798`（视口像素高取 `scrollDOM.clientHeight`）
  - `state.doc.lineAt(pos): Line`（`Line.number` 是 **1 基**）—— `@codemirror/state` `index.d.ts:43`
  - ⚠️ `view.viewport` 是**已绘制**区（含上下 margin），可能比真正可见区更靠上 ⇒ 顶行会偏早；
    要准的那一条是 `view.lineBlockAtHeight(view.scrollDOM.scrollTop)`。两者都由 `stickyViewFrom` 一处决定，
    别在保留文件里试。`view.defaultBlock` 本批**没能在 d.ts 里核到** ⇒ 不许照抄 fold3b W2 里那句 `view.defaultBlock.height`。
- **怎么腾这 3 行**（现 1144/1147；三条都在 `defineExpose` 里，纯并行、语义逐字不变，任选一条即够）：
  1. `hasSelection`（`:456-459`，4 行）并成 1 行：
     `hasSelection: () => { const range = view?.state.selection.main; return Boolean(range && !range.empty) },` ⇒ **净 -3**。
  2. `selectionText`（`:442-445`，4 行）并成 1 行：
     `selectionText: () => { const range = view?.state.selection.main; return view && range && !range.empty ? view.state.sliceDoc(range.from, range.to) : '' },` ⇒ **净 -3**。
  3. `getCursorCoords`（`:460-464`，5 行）并成 2 行（`if (!view) return null` 与 `coordsAtPos` 各自一行不变，
     把 `const coords = …` 与 `return coords ? … : null` 合成一行）⇒ **净 -2**。
  本仓已有同形状的先例（`src/App.vue:99` 两条 import 并一行、`CodeEditor.vue:33` 四条 import 并一行），
  并行不算风格倒退。**不要**用「删 `getCursor`」腾位——它有生产消费方，删了是拆接线不是腾行。
  ⚠️ 别顺手把 `expandAtCursor`（`:432-438`）改成走 `insertTextAtCaret`：那个 helper（`src/editorPaste.ts:29-37`）
  替换的是 `selection.main` 的 `[from,to]`，而这里只在 `head` 插入 —— 有选区时行为不同，不是等价改写。

## W2 `src/App.vue`：给**面板清单**而不是单块面板（约 +6 行，现 2706/2737 ⇒ 余量够）

1. 加一个每栏编辑器取用器（`editorFor` 只按 path 找、`pane` 混着命中的那一个，`:187`，不够用）：
   `const editorInPane = (pane: Pane, path: string) => editorRefs.get(\`\${pane}:\${path}\`)` —— 键的形状见 `:182`。
2. `createStickyLines` 的调用（`:544`）加三个实参：
   ```ts
   views: () => [0, 1].map(p => { const t = groupActive(p); const m = t && editorInPane(p, t.path)?.stickyView(); return { id: String(p), ...(m ?? {}), priority: focusedPane.value === p ? 0 : 1 } }),
   currentLineOf: id => groups[Number(id) as Pane]?.line,
   ```
   `{ …views }` 那一段展开写就是 4-6 行 ⇒ 建议把整个数组构造收进 `src/stickyMetrics.ts` 的
   `stickyViewsFor(panes, metricsOf, focusedPane)`，`App.vue` 只留 `views: () => stickyViewsFor(...)` 一行。
   `priority` 就是「聚焦那块在前」——这是**宿主**知道的档位，不是模块编的（见上面**无法核实**那条）。
3. 渲染那两条（`:2172` 容器、`:2173` `v-for`）改成按栏取：
   `paneSticky = (pane: Pane) => stickyLinesByView.value.get(String(pane)) ?? stickyLines.value`（+1 行 script），
   模板 `v-for="symbol in paneSticky(pane)"`；`v-if` 里那句 `pane === focusedPane` 也该去掉
   （上游 `StickyLinesManager.kt:15-34` 每块面板各自画，不画非聚焦那块是本仓的旧折衷，不是上游行为）。
   `:key="symbol.startLine"` 保留 —— 每份列表内部同行号仍只有一条（`stickyScopes`/`stickyVisualLines` 都去了重）。
4. ⚠️ **会撞的一条判据**：`tests/tab-sticky-lines.test.mjs:73` 的正则是
   `/createStickyLines\(\{[^}]*language: \(\) => \(active\.value \? …/` —— `language:` **之前**不许出现 `}`。
   所以新实参要么排在 `language:` 之后，要么把带对象字面量的那一条（`views:`）整体挪到 helper 里。
   本仓这类「按源码文本钉住接线」的门禁还有 `tests/editor-sticky-navigate.test.mjs:57`（钉 import 那一行）。

## W3 判词那一行（`scripts/verdict_table.py` 与 `docs/inventory/` 都归主代理，本批没动）

`docs/inventory/verdict-platform_rest.md:362`（生成源 `scripts/verdict_table.py:321`）结尾仍写
「缺：… `StickyLinesPass` 的 daemon 合帧与按视图优先级排序」。按本轮核对结果建议改成两条事实：
- 「daemon 合帧」⇒ 模块侧已补齐（`stickyPassNeeded`/`emptyStickyPassState`，`StickyLinesCollector.kt:36-51` 的
  `ModStamp.isChanged`，`:39` 注释「always run pass on editor opening IJPL-158818」），端到端仍缺宿主驱动；
- 「按视图优先级排序」⇒ 上游**指不到行号**（两目录 grep `priority` 零命中，`stickyprio` 本轮再核）；
  能核实的只有「每编辑器各算一份」与「同文档层按 `StickyLinesModelImpl.java:287-296` 比较器排」。
  本仓落成的形状 = 宿主给档位（`StickyView.priority`）+ 模块给稳定序（`orderStickyViews`）+ 每栏一份出口
  （`stickyLinesByView`），仍差 W1/W2 的宿主实参 ⇒ 档位维持 `[~]`，只改措辞。

## 处理结果（wiring-backlog lane，2026-10-06）

- **W1** —— `src/components/CodeEditor.vue`（禁改）。需 CodeEditor owner。
- **W2** —— `src/App.vue`（本 lane），依赖 W1 的度量出口 ⇒ 需 CodeEditor owner 先落。
- **W3** —— 判词，非本 lane。

结论：零接线（串在 CodeEditor 上）。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「零接线（串在 CodeEditor 上）。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
