# wiring-requests-2026-10-06-hierlevel — 层级「范围下拉 + 行模型」宿主那一半

来自 hierlevel 路（判词见 `docs/batch-2026-10-06-hierlevel.md`）。
**模块侧已经做完并有判据**（`src/hierarchyScopes.ts`、`src/hierarchyView.ts`、`src/hierarchyRenderer.ts`、
`src/hierarchyRows.ts`；判据 `tests/hierarchy-rows.test.mjs` 12 条 + `tests/hierarchy-view-scope.test.mjs`），
下面三条只需要 `src/App.vue`（`appvue` 名下）与一条测试锚点的同步改。

**净行数核算**（`src/App.vue` 余量 30）：三条全部落在既有行内 ⇒ **净增删 0 行**（不新增行、不删行）。
`src/bridge.ts`（0 贴顶）**一个字没动**，本批也不需要动它：层级项的
`path/name/kind/line/character/callLine/callChar` 早已在 `LspHierarchyItem`（`src/bridge.ts:168`）里。

---

## H-1（`appvue`）· 范围下拉只在"上游真有这只下拉"的方向上出现

**目标文件 / 行**：`src/App.vue:2279-2281`（层级工具条里 `<label class="call-direction" :title="hierScopeNotice">范围 …` 那一段）。
**为什么**：上游的范围动作是**逐个视图注册**的 ——
`platform/lang-impl/src/com/intellij/ide/hierarchy/HierarchyBrowserBaseEx.java:489-490`（基类不加）、
`CallHierarchyBrowserBase.java:61`（调用层次加）、`MethodHierarchyBrowserBase.java:85`（方法层次加）、
`TypeHierarchyBrowserBase.java:89-94`（类型层次基类**不加**）、
`java/java-impl/src/com/intellij/ide/hierarchy/type/TypeHierarchyBrowser.java:47-54`
（Java 类型层次自己加，但 `isEnabled()` 在**父类型视图**返回 false，`:51-52`）、
`plugins/kotlin/code-insight/kotlin.code-insight.k2/src/org/jetbrains/kotlin/idea/k2/codeinsight/hierarchy/types/KotlinTypeHierarchyBrowser.kt:34-40`（同写法）。
判定源也对得上：`SupertypesHierarchyTreeStructure.java` 全文零 scope 引用，而
`SubtypesHierarchyTreeStructure.java:47`、`CallerMethodsTreeStructure.java:90`、`CalleeMethodsTreeStructure.java:73,80` 都吃范围。
⇒ 「类型层次 · 父类型」那一向的下拉是**假控件**，模块已按此把 `hierScopeOptions` 给成空表。

**import / 解构**：`src/App.vue:1364` 那一串从 `createHierarchyView` 解构的名字里补一个 `hierScopeSupported`
（出口名就叫 `hierScopeSupported`，定义在 `src/hierarchyView.ts:140`，返回值 `src/hierarchyView.ts:325` 附近那一行已导出）。
其余四个名字（`hierScope`/`hierScopeOptions`/`hierScopeNotice`/`setHierarchyScope`）已经在用，不动。

**可照抄替换段**（old/new 逐字，只加一个 `v-if`，不加类、不加样式、不加行）：

old（`src/App.vue:2279`）
```html
              <label class="call-direction" :title="hierScopeNotice">范围
```
new
```html
              <label v-if="hierScopeSupported" class="call-direction" :title="hierScopeNotice">范围
```
`:2280` 那一行（`<select …><option v-for="entry in hierScopeOptions" …>`）**一字不改**：
`hierScopeOptions` 不支持时是空表，`v-if` 已经把整段挡住了，不会出现空 `<select>`。
`:2278` 那条 HTML 注释建议改成（可选，纯注释）：
`<!-- 范围那一档：档位表与校验在 src/hierarchyScopes.ts（五档 id = HierarchyBrowserScopes.java:8-12），
     "这一向到底有没有这只下拉"由 hierarchyScopeSupport 判（父类型向 = 上游 isEnabled()=false）。 -->`

**空行数**：+0 / -0。

---

## H-2（`appvue` + `tests/hierarchy-renderer.test.mjs`）· 层级行的 `:key` 换稳定 id

**目标文件 / 行**：`src/App.vue:2285`。
**为什么**：现在钉的是 `:key="index"` —— 任何一次展开/折叠/切范围都会让整列重挂 DOM
（上游不存在这个问题：`HierarchyTreeStructure.java:60-68` 的节点身份是 descriptor 对象本身）。
本批已经在每一行上递出 `id`（内容派生 + 同一份内容第二遍出现追加 `NUL#n`，
`src/hierarchyRows.ts:84-96`、装配在 `src/hierarchyView.ts:101-118`）。
引用面板那边是同一件事（`docs/wiring-requests-2026-10-06-refview3.md`），两侧共用一条规则。

**可照抄替换段**：

old（`src/App.vue:2285`）
```html
              <div v-for="({ node, depth, row }, index) in hierRows" :key="index" class="call-row" role="listitem" :style="{ paddingLeft: `${depth * 18 + 8}px` }">
```
new
```html
              <div v-for="{ node, depth, row, id } in hierRows" :key="id" class="call-row" role="listitem" :style="{ paddingLeft: `${depth * 18 + 8}px` }">
```
（`index` 在这一行的循环体里没有被别处用到 —— 体内部自己的 `v-for="(seg, si) in row.segments"` 用的是 `si`，不受影响。）

**必须同批改的那条锚点**（否则改完全仓多一条红，不是这次改错了）：
`tests/hierarchy-renderer.test.mjs:118`

old
```js
  assert.match(app, /v-for="\(\{ node, depth, row \}, index\) in hierRows"/,
```
new
```js
  assert.match(app, /v-for="\{ node, depth, row, id \} in hierRows"/,
```
强度不降：这条锚点的意思仍然是"行必须解构出 `row`（丢掉它等于 `hierarchyRenderer` 的判定形同虚设）"，
`row` 与 `node`/`depth` 都还在解构里，并且现在额外要求 `id` 被消费 ——
`:2286` 之后那几条（`:title="row.toggleLabel"`、`:is="row.icon"`、`row.segments`、`row.position`）一条都不用动。

**空行数**：+0 / -0。

---

## H-3（主代理裁决）· "隐藏"还是"灰掉"，以及**要不要整条撤**

1. **隐藏 vs 灰掉**：上游是**灰掉**（`HierarchyBrowserBaseEx.java:788-792` 的
   `presentation.setEnabled(isEnabled())`，按钮仍画着、当前档名仍写在上面 `:795`）。
   H-1 给的是 `v-if` **隐藏**，理由是：本仓的选项表由模块按适用面给（父类型向 = 空表），
   灰掉会留下一只**没有任何一项**的 `<select>`，那是另一种假控件。
   若主代理要严格照上游（保留按钮、灰掉），就要同时决定"灰掉的 select 里显示什么当前档名"——
   上游是"上一回全局选的那档"（`settings.SCOPE`），本仓等价物是 `hierScope` 的兜底值（All），
   这条改法仍然 0 行（`v-if` 换 `:disabled="!hierScopeSupported"`），但模块的空表就要换成"五档 + disabled"，
   需要我改一行 `hierarchyScopeSupport` 的返回（不在本批擅自做，等裁决）。
2. **要不要整条撤**：本仓数据源只有 LSP，而上游 LSP 路径**两种层次都把这个动作摘掉了**
   （`platform/lsp-impl/src/impl/features/hierarchy/call/LspCallHierarchyBrowser.kt:30-35` 调完 super 把
   `ChangeScopeAction` 全 remove；`.../type/LspTypeHierarchyBrowser.kt:33-37` 不调 super；
   `.../LspAbstractHierarchyTreeStructure.kt:20-30` 从不按范围过滤）。
   严格照抄 = 层级面板根本没有「范围」下拉，`src/hierarchyScopes.ts` 的五档过滤与
   `tests/hierarchy-scopes.test.mjs` 一并退回。本批只撤了**上游自己也禁用**的那一向，
   取舍与退路写在 `src/hierarchyScopes.ts:44-63` 与 `docs/batch-2026-10-06-hierlevel.md` §6.1、§8.4。

## 本批不需要、也没动的东西

- `src/bridge.ts`：无新字段、无新 kind（层级四个 kind 早已在 `LspRequestKind`，`src/bridge.ts:176`）。
- `native/**`：路径的"根外=绝对形态"是 `native/lsp_host_bootstrap.cpp:18-31` **已有**行为，只是模块以前没用；
  没有新通道、不需要 CMakeLists 改动。
- `src/settingsModel.ts` / 持久化 schema：范围的 sheet 记忆与"最后一次选的档"都在**本次会话内**
  （上游那份应用级 `SCOPE` 是 `HierarchyBrowserManager` 的 state，本仓等价物要落盘就得动设置 schema ⇒
  本批**没有**加持久化键，因此旧存档缺键的风险为零）。若主代理要把它持久化，另开一批（要配
  "缺键补默认"的判据，别按字段数判损坏）。

## 处理结果（wiring-backlog lane，2026-10-06）

- **H-1 已接线**：`src/App.vue:2329` 的范围下拉已加 `v-if="hierScopeSupported"`，解构 `:1406` 补了 `hierScopeSupported`（父类型向不渲染 = 不放假控件）。
- **H-2 已接线**：`src/App.vue:2335` 的 `:key` 已从 `index` 换成 `id`（`src/hierarchyView.ts` 的 `hierarchyRowIds` 产出的稳定 id）。

App.vue 行数：2695 → 2695（H-1 同行加属性、H-2 同段改 key，净 0）。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
