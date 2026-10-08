# 接线请求 · 层级 / 用法（2026-10-06，代号 hierarchy）

本批把层级/用法的**模块侧**都核到"已实现且被生产消费"，剩下 4 处缺项全部卡在**他人独占 / 冻结的宿主文件**上。
每条给：目标文件 + 目标行号 + import + 可照抄替换段 + 上游依据。宿主模板的最终类名/样式以现网为准，
本请求给的是**必须消费的本仓契约**（`src/hierarchyView.ts` / `src/hierarchyRenderer.ts` / `src/hierarchyScopes.ts` 已导出并判据覆盖）。

> 上游行号仅对层级族给出（本批逐行开参考树自数核对，且与 `src/hierarchyRenderer.ts`/`src/hierarchyScopes.ts` 头一致、引用门当前绿）；
> 引用面板分组、find-usages 标题层只给类名不带行号——转抄他族行号会被引用门当新引用核，省行号即规避（agent-rules §5）。

---

## W-1（`appvue`）· 层级行消费 `hierarchyRowModel`，别在模板里重算一遍

**现状**：`src/App.vue:2229-2240` 用 `node.item.name` / `node.item.detail` / 内联三元式自己拼行，
把 `hierRows` 里已经算好的 `row`（`{ segments, icon, position, trailing, toggleLabel }`）整个丢掉了。
两个后果：① `src/hierarchyRenderer.ts` 的判定形同虚设（改了不生效）；② detail 段**没有 `" : "` 分隔**、
没有按 kind 的图标——这两条正是上游 `LspHierarchyNodeDescriptor.kt:25-31`（`addText(" : $detail", getPackageNameAttributes())`）
与 `HierarchyNodeRenderer.java:32-43`（复合文本 + `setIcon`）要求、而 `src/hierarchyRenderer.ts` 已实现的。

**目标文件 / 行**：`src/App.vue` 模板第 2229-2240 行（`v-for="({ node, depth }, index) in hierRows"` 整块）。

**import**（`src/App.vue` 顶层 `<script setup>`，`hierarchyRenderer` 已导出 `HierarchyTextSegment` 类型，无需新依赖）：
```ts
// 无需新 import：hierarchyRowModel 的产物已随 hierRows 每行的 row 字段返回。
```

**可照抄替换段**（把 `({ node, depth }, index)` 改成带 `row`，其余判定交给 `row`）：
```html
<div v-for="({ node, depth, row }, index) in hierRows" :key="index" class="call-row" role="listitem" :style="{ paddingLeft: `${depth * 18 + 8}px` }">
  <button class="icon-button" :title="row.toggleLabel" :aria-label="row.toggleLabel" :aria-expanded="node.expanded" :disabled="node.loading || node.recursive || node.children?.length === 0" @click="toggleHierarchy(node)">
    <ChevronDown v-if="node.expanded" :size="iconSize.control" /><ChevronRight v-else :size="iconSize.control" />
  </button>
  <button class="call-jump" :disabled="!node.item.path" :title="`${node.item.path}:${(node.item.line ?? 0) + 1}`" @click="revealLocation({ path: node.item.path, line: node.item.line ?? 0 })">
    <component :is="row.icon" v-if="row.icon" :size="iconSize.menu" />
    <span v-for="(seg, si) in row.segments" :key="si" :class="seg.tone === 'muted' ? 'call-detail' : 'call-name'">{{ seg.text }}</span>
    <span class="call-path">{{ node.item.path }}</span>
    <span v-if="row.position" class="call-pos">{{ row.position }}</span>
  </button>
  <span v-if="row.trailing" class="call-detail" role="status">{{ row.trailing }}</span>
  <button v-if="node.item.callLine !== undefined" class="icon-button" :title="`调用点 ${(node.item.callLine ?? 0) + 1}:${(node.item.callChar ?? 0) + 1}`" aria-label="跳到调用点" @click="revealLocation(callSiteTarget(node))"><ArrowRight :size="iconSize.control" /></button>
</div>
```
说明：`row.segments` 已含 `[失效] ` 前缀去重 + ` : detail` 次要色段（判据 `tests/hierarchy-renderer.test.mjs`）；
`row.icon` 未识别 kind 时为 `null` → `v-if` 掉不占位；`row.position`/`row.trailing` 把原先散在模板里的
`+1` 与四条三元式收成单一真源。**不新增样式类**（`.call-name`/`.call-detail` 已存在）。

---

## W-2（`appvue`）· 层级面板补范围下拉，消费 `hierScope` / `pickHierarchyScope` / `hierScopeNotice`

**现状**：`src/hierarchyView.ts:58-93` 已就绪 `hierScope`（默认 `All`）、`pickHierarchyScope(id)`（白名单校验）、
`hierScopeNotice`（"生产代码：3 / 5"），`hierRows` 已按 `nodeInScope` 过滤——但 `src/App.vue` **没有任何控件能切档**，
范围收窄永远停在 `All`、过滤形同空转。这是判词 `lp/hierarchy` 说的"范围收窄"在**面板模板**那一半。
**上游**：`platform/lang-impl/src/com/intellij/ide/hierarchy/HierarchyBrowserBaseEx.java:775`（把本地 scope 加进下拉）、
`:235-243`（每档呈现名）；五档 id = `platform/lang-impl/src/com/intellij/ide/hierarchy/HierarchyBrowserScopes.java:8-12`。

**目标文件 / 行**：`src/App.vue` 层级工具条块（`重新查询`/`导出` 按钮所在的 `<div>`，约第 2224-2226 行内、导出按钮之后）。

**import**（`<script setup>` 里已从 `createHierarchyView` 解构；若未解构，补上）：
```ts
// hierarchyView 返回值里加：
//   hierScope, pickHierarchyScope, hierScopeNotice, HIERARCHY_SCOPES
import { HIERARCHY_SCOPES } from './hierarchyScopes.ts'
```
（`hierScope` / `pickHierarchyScope` / `hierScopeNotice` 在 `src/hierarchyView.ts:235-238` 的 `return {}` 里已导出。）

**可照抄替换段**（一个 `<select>`，选项即 `HIERARCHY_SCOPES`；无宿主函数就不渲染的规矩此处天然满足——视图总有 `hierScope`）：
```html
<label class="hier-scope" :title="hierScopeNotice">
  范围
  <select :value="hierScope" @change="pickHierarchyScope(($event.target as HTMLSelectElement).value as import('./hierarchyScopes.ts').HierarchyScopeId)">
    <option v-for="entry in HIERARCHY_SCOPES" :key="entry.id" :value="entry.id">{{ entry.label }}</option>
  </select>
</label>
```
（若嫌 `as` 难看，可在 `<script setup>` 包一层 `const setHierScope = (v: string) => pickHierarchyScope(v as HierarchyScopeId)` 再 `@change="setHierScope($event.target.value)"`。）

---

## W-3（`appvue`）· 引用面板把平表改成 `buildUsageTree` 的目录树

**现状**：`src/App.vue:2217` `v-for="(ref, index) in references"` 逐条平铺。分组规则本仓早已有生产消费方
（`src/usageViewGrouping.ts:56` `buildUsageTree` 已被 `src/refactorPreview.ts:15,198` 用），只是引用面板没用它——
正是判词 `lp/usage-view` 说的"面板现状是平表"。
**上游**：`UsageViewImpl` 的用法树分组（类名，行号见判词 `lp/usage-view` 行）。

**目标文件 / 行**：`src/App.vue` 第 2216-2217 行的 `references` 渲染块。

**import**：
```ts
import { buildUsageTree, usageSummary, type UsageTreeNode } from './usageViewGrouping.ts'
const usageTree = computed(() => buildUsageTree(references.value))
```

**做法（示意，交给 `appvue` 落最终模板）**：把 `v-for` 的数据源从 `references`（平表）换成 `usageTree`（`UsageTreeNode` 目录/文件节点，
目录 `count` 已是子树合计、目录在前），叶子文件下再列 `references`。判据 `tests/usage-view-grouping.test.mjs` 已覆盖 `buildUsageTree` 的排序/计数。
**注意**：只换数据源、不改 `revealLocation` 单击导航行为；本请求不新增样式。

---

## W-4（`find-usages` / `toolContents` 归属代理，非 appvue）· 用法树标题的"描述名/类型标签"provider 层

**现状**：判词 `ixa/find-usages` 的"按语言 provider：`getDescriptiveName`/`getType`/`getNodeText`（决定 `Usages of 'x'` 标题）"。
本仓取搜索词是 `src/semanticActions.ts` 的 `wordAt`（对所有语言一视同仁），标签/标题拼在
`src/toolContents.ts` 的 `usagesTabName` / `usagesPanelTitle`（`src/referenceContents.ts:100-102` 调用它们）。
这两个文件**都不在本批可改面**（`referenceContents.ts` 在我名下、但它只消费标题；标题生成在他处）。

**要谁接**：负责 `semanticActions.ts` / `toolContents.ts` 的代理。
**契约（本批已核过、供其消费）**：本仓符号唯一来源 LSP `references`/`workspace/symbol`，`Location` 不带元素种类 ⇒
`getType`/读写的逐引用种类**给不出**（见 batch 报告 §6.1），只能做"文件名档"的描述名（`DescriptiveNameUtil` 的文件名那一档，
上游 `platform/…/DescriptiveNameUtil.java`，类名）。若将来 `documentHighlight` 带 kind，`usageViewGrouping`/`referenceContents` 可扩一个按 kind 的分档键——**现在无消费链路，不预先造模块**。

**上游**：`FindUsagesProvider`/`LanguageFindUsages`/`DescriptiveNameUtil`（类名，行号见判词 `ixa/find-usages` 行）。

## 处理结果（wiring-backlog lane，2026-10-06）

- **W-1 已接线**：`src/App.vue:2335` 的 `v-for` 已消费 `row`（`row.segments` / `row.icon` / `row.position` / `row.trailing`，见 `:2341` 附近），与 `src/hierarchyView.ts:102/:111` 的 `hierarchyRowModel` 同源。
- **W-2 已接线**：`src/App.vue:2329-2330` 已有范围下拉（`hierScope` + `pickHierScope` + `hierScopeOptions`），解构在 `:1405-1406`。
- **W-3（引用面板换 `buildUsageTree` 树）** —— 已接（不同落点）：引用面板渲染已移到 `src/components/ToolWindowView.vue:222` 的 `<ReferencePanel :rows="ctx.referenceRows" …>`，数据源 `src/toolViewContext.ts:202` 的 `referenceRows`（= `src/referenceContents.ts:231` 的 `usageTreeRows`）。判据 `tests/usage-view-panel-rows.test.mjs` **pass 22 / fail 0**。App.vue 侧那一格（`:2319-2321`）现在是 `<ToolWindowView view="references">`，平表渲染已不存在 ⇒ 原请求的 old 段已不适用。

结论：W-1/W-2/W-3 均已在真实链路里（W-3 换了落点），未改任何文件。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「W-1/W-2/W-3 均已在真实链路里（W-3 换了落点），未改任何文件。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
