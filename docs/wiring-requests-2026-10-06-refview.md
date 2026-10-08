# wiring requests · 2026-10-06 · refview（引用这一格的最后一跳：App.vue 的挂载点）

本批（`docs/batch-2026-10-06-refview.md`）把 `references` 补成了工具窗口宿主里的一条**可打开、有内容、可关闭**
的 content：新组件 `src/components/ReferencePanel.vue`、宿主分支
`src/components/ToolWindowView.vue`（`view === 'references'`）、数据源透传 `src/toolViewContext.ts`。
**唯一还差的一跳**在保留文件 `src/App.vue` 里：底部那一格现在仍然自己画那张平表，没走宿主。

主代理只需要贴下面这一处（S-TW-1 是顺手清出来的另一条，与本批的引用格无关，可分开决定）。

## S-RV-1 `src/App.vue`：把引用那一格交给工具窗口宿主（逐字 old/new）

**目标**：`src/App.vue` 的 `bottomTab === 'references'` 那一段（本轮开始时在 `:2240-2243`；
`src/App.vue` 是保留文件、别的代理在并行改，贴之前按内容搜而不是按行号数）。

old（**逐字**，四行）：

```html
          <div v-else-if="bottomTab === 'references'" class="ref-list" role="list" aria-label="符号引用">
            <p v-if="!references.length" class="ref-empty">没有找到引用。</p>
            <button v-for="(ref, index) in references" :key="`${ref.path}:${ref.line}:${ref.character}:${index}`" class="ref-item" @click="revealLocation({ path: ref.path, line: ref.line })"><FileCode2 :size="iconSize.menu" /><span class="ref-path" :title="ref.path">{{ ref.path }}</span><span class="ref-pos">{{ ref.line + 1 }}:{{ ref.character + 1 }}</span></button>
          </div>
```

new（**逐字**，两行；与它下面那条「停靠在底部的工具窗口」用同一个宿主、同一个容器类）：

```html
          <div v-else-if="bottomTab === 'references'" class="bottom-view-host">
            <ToolWindowView view="references" :active="bottom" :ctx="toolViewCtx" />
          </div>
```

**不需要新增 import**：`ToolWindowView` 已在 `src/App.vue:27` 导入、`toolViewCtx` 已在 `:861` 定义
（`computed<ToolWindowViewContext>(() => createToolViewContext({...}))`），引用面板的六栏数据
由 `src/toolViewContext.ts:197-208` 自己从 `src/referenceContents.ts` 读，宿主不用传任何东西。

**为什么算"接线"而不是"重写"**：这一换把渲染点从宿主外挪进宿主内，行为差异只有三处，全都是
上游有的：
1. 行来源 `references`（平表）→ `referenceRows`（分组树：文件组 + 位置叶子，
   上游 `platform/usageView-impl/src/com/intellij/usages/impl/rules/UsageGroupingRulesDefaultRanks.java:26-32`
   的 FILE_STRUCTURE=500 那一档；本仓规则在 `src/usageViewGrouping.ts`）；
2. 单击导航多带一个**列**（`ReferencePanel.vue:66-70` 发 `{path, line, column: character + 1}`，
   `column` 是编辑器口径 1 基，与 `ToolWindowView.vue:170` 结构视图那条挂载点同一口径；
   上游导航落在 offset 上：`platform/usageView-impl/src/com/intellij/usages/impl/UsageViewImpl.java:1906` 起）；
3. 空态从一句变三句（正在查找 / 没有用法 / 没有匹配），出处见 `ReferencePanel.vue` 文件头
   （`UsageViewBundle.properties:8`、`:131`）。

**落地后要顺手看的两处**（都不需要改代码，只会被这处改动撞红才需要动）：
- `src/App.vue:165` 的 `import { references, referenceTabs } from './referenceContents'`：
  `references` 还被 `:404` 的 `get references() { return references }`（工具窗口动作域）用着，
  `referenceTabs` 被标签条用着 ⇒ **两个都留着**，不许顺手删成 `{ referenceTabs }`。
- `FileCode2` 在 `src/App.vue` 还有 6 处用处（本批后仍 ≥1），不用动 import。
- 既有测试里没有钉 `没有找到引用。` 这句的（`tests/reference-contents.test.mjs:48`、
  `tests/usage-view-panel-rows.test.mjs:291` 只是在注释里提到），所以这一替换不会撞红既有判据；
  `tests/reference-panel-host.test.mjs` 钉的是宿主这一侧，落地前后都该是绿的。

## S-TW-1 `src/components/ToolWindowView.vue`：项目树的「全部展开」没有渲染点（本批核出来的，非引用域）

现状：模板里只有「递归展开」(`:237`) 与「全部折叠」(`:238`)，**没有**「全部展开」按钮，
但 `ToolWindowViewContext.onExpandAll` 是必填字段，而它唯一的渲染点在 `view === 'gradle'` 那一支
（`GradlePanel` 的 `@expand-all`）—— 也就是说这个字段的名字骗人：它服务的是 Gradle 面板，不是项目树。

本批把 `onExpandAll` 改成**可选**（`src/components/ToolWindowView.vue:139-142` 有留痕注释），
因为必填会让任何手写 ctx 的宿主少一栏就变类型错，而它本来就没有树侧渲染点。

要不要补「全部展开」给项目树，是主代理的决定：上游 `ProjectViewImpl.java:1169` 那组齿轮动作里
ExpandAll 被 ExpandRecursively 取代（模板 `:234-235` 的注释已经写了这条，出处
`PlatformActions.xml:1178-1184`），所以**不补才是上游行为**。要补就同时把
`ctx.onExpandAll` 改名成 `onTreeExpandAll`、把 Gradle 那一支的 `@expand-all` 单独走
`ctx.onGradleExpandAll`，别再让一个名字挂两个窗口。

## 处理结果（wiring-backlog lane，2026-10-06）

- **S-RV-1 已接线**（落点迁移）：`src/App.vue:2319-2321` 现为 `<ToolWindowView view="references" :ctx="toolViewCtx">`，引用面板渲染在 `src/components/ToolWindowView.vue:222`。
- **S-TW-1（项目树「全部展开」渲染点）** —— `src/components/FileTree.vue:207/:258` 已 `defineExpose({ collapseAll, expandAll, … })`；`ToolWindowView.vue:142` 注明归属在 GradlePanel。复核 `FileTree` 的 `expandAll` 有出口但 ToolWindowView 未挂渲染点 —— 登记为待办。

结论：S-RV-1 已接线；S-TW-1 登记。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「S-RV-1 已接线；S-TW-1 登记。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
