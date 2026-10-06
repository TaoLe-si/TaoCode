# 接线请求 · 导航 / 层级 / 用法（2026-10-06，代号 navigation2）

本批把 `docs/wiring-requests-2026-10-06-hierarchy.md` 的 W-1..W-4 里**不指 App.vue 的那一半全部做完**，
剩下的宿主行交回这里；另加两条本批新发现的宿主行（齿轮登记表、引用面板工具条）。
每条给：目标文件 + 目标行号 + import + 可照抄的整段替换 + 上游依据（全部本批逐行开参考树自数核对）。

> 引用门：只有从参考树根写起的完整路径才会被核（`tests/source-citations.test.mjs` 的 `TOP_DIRS`），
> 所以本文件里的上游坐标一律给完整路径。

---

## N-1（`appvue`）· 引用面板换用 `referenceRows`（原 W-3 的宿主那一半）

**现状**：`src/App.vue:2215-2218` 的 `v-for="(ref, index) in references"` 仍是平表。
模块侧本批已补齐：`src/referenceContents.ts:122-236` 给 `referenceRows`（深度优先摊平、目录/文件/用法三种行、
带折叠态与计数）、`toggleUsageGroup` / `collapseAllUsageGroups` / `expandAllUsageGroups` /
`exportReferencesText`，规则与文本口径全在 `src/usageViewGrouping.ts`，判据 `tests/usage-view-panel-rows.test.mjs`（12 条）。

**目标文件 / 行**：`src/App.vue` 第 2215-2218 行（`bottomTab === 'references'` 那一块）。

**import**（`src/App.vue:165` 那一行已 `import { references, referenceTabs } from './referenceContents'`，补上）：
```ts
import { references, referenceRows, referenceTabs, toggleUsageGroup } from './referenceContents'
```
（`ChevronDown` / `ChevronRight` / `FileCode2` / `FolderOpen` 都在 `src/App.vue:4` 的 lucide 列表里，无需新增；
**不新增样式类** —— `.ref-list` / `.ref-item` / `.ref-path` / `.ref-pos` / `.ref-empty` / `.icon-button` 全部已存在，
缩进走 `:style` 的内联 paddingLeft，与层级行 `src/App.vue:2229` 同一个写法。）

**可照抄替换段**（叶子的可见内容与单击导航与现状**一字不差**，只是挂到自己文件组下面）：
```html
          <div v-else-if="bottomTab === 'references'" class="ref-list" role="list" aria-label="符号引用">
            <p v-if="!references.length" class="ref-empty">没有找到引用。</p>
            <template v-for="row in referenceRows" :key="row.key">
              <div v-if="row.kind !== 'usage'" class="ref-item" :style="{ paddingLeft: `${row.depth * 18 + 14}px` }" role="listitem">
                <button class="icon-button" :title="row.toggleLabel" :aria-label="row.toggleLabel" :aria-expanded="!row.collapsed" @click="toggleUsageGroup(row.key)"><ChevronDown v-if="!row.collapsed" :size="iconSize.control" /><ChevronRight v-else :size="iconSize.control" /></button>
                <FolderOpen v-if="row.kind === 'directory'" :size="iconSize.menu" /><FileCode2 v-else :size="iconSize.menu" />
                <span class="ref-path" :title="row.path">{{ row.label }}</span>
                <span class="ref-pos">{{ row.detail }}</span>
              </div>
              <button v-else class="ref-item" :style="{ paddingLeft: `${row.depth * 18 + 14}px` }" @click="revealLocation({ path: row.path, line: row.line })"><FileCode2 :size="iconSize.menu" /><span class="ref-path" :title="row.path">{{ row.path }}</span><span class="ref-pos">{{ row.label }}</span></button>
            </template>
          </div>
```
说明：
· 组行的 `row.detail` 就是上游那条计数 —— `platform/usageView-impl/src/com/intellij/usages/impl/UsageViewTreeCellRenderer.java:95-98`
  给每个组节点追加 `usage.view.counter`（`platform/usageView/resources/messages/UsageViewBundle.properties:131`）；
· 目录行默认**不出现**（`platform/usageView/src/com/intellij/usages/UsageViewSettings.kt:26` 的
  `isGroupByDirectoryStructure=false`），出现与否由齿轮那一条切（见 N-2），模板不需要再加判断；
· 组行画成 `div`（不可点）而不是"点下去没反应"的按钮 —— 上游的组节点确实能 `navigate`
  （`.../rules/FileGroupingRule.java:131-133` 开文件），要接就在文件组那一行加
  `@click="revealLocation({ path: row.path, line: 0 })"`，但**别给目录行加**（本仓没有"打开目录"的宿主动作时就是假控件）；
· `references` 这个数据源**不许删**：它仍是没有结果时那行提示的判据，也是 `src/menuUi.ts` /
  `src/toolWindowActions.ts` 的既有消费点。

**可选 N-1b（同一块，面板自己的三个按钮）**：`collapseAllUsageGroups` / `expandAllUsageGroups` /
`exportReferencesText` 已就绪，上游对应 `platform/usageView-impl/src/com/intellij/usages/impl/UsageViewImpl.java:1081-1082`
（Expand All / Collapse All）与 `:2260`（`PlatformDataKeys.EXPORTER_TO_TEXT_FILE` → `ExportToTextFileAction`）。
本仓引用面板**没有工具条那一层**（只有 `.ref-list` 一个 div），加就是新增布局 —— 交给 `appvue` 决定；
加了就必须带 `v-if="references.length"`（没结果时不出现，别留点不动的按钮）。
导出落点可照抄层级那一处：`src/App.vue:1333-1337` 的 `dialog.saveFile` + `app.writeExportFiles` 两跳。

---

## N-2（`src/menus/toolWindowGear.ts` 归属代理）· 齿轮登记表补一行，否则「分组」组不渲染

**现状**：`src/usageViewGear.ts:56-84` 本批多回一组 `'usage.groupBy'`（标题=「分组」，成员一条「目录结构」，
状态 = `src/referenceContents.ts:118-120` 的 `referencesGroupByDirectory`，默认 false）。
`usageViewGearRows()` 返回的是**宿主行字典**，但渲染要过 `TOOL_WINDOW_GEAR_SPEC` 那道表：
`src/menus/toolWindowGear.ts:63` 只登记了 `usage.viewOptions`，表里没有的 id 会被
`src/menus/toolWindowGear.ts:105-106` 丢掉（`if (!row) continue`）—— 所以现在这一组**不会出现**
（不会出现 = 没有假控件，符合规矩；但也接不上）。

**目标文件 / 行**：`src/menus/toolWindowGear.ts` 第 63 行之后插一行：
```ts
  { action: 'usage.groupBy', fromHost: true, contentsScoped: true },
```
**位置必须在 `usage.viewOptions` 之后**：上游 `additionalGearActions` 在齿轮组里就是排在最前的那一条
（`platform/platform-impl/src/com/intellij/openapi/wm/impl/ToolWindowImpl.kt:859-868`），
而本仓 `tests/usage-view-gear.test.mjs:91` 钉的就是 `TOOL_WINDOW_GEAR_SPEC[0].action === 'usage.viewOptions'`。

**顺带要改的同一条判据（不是放松，是跟着变严）**：`tests/usage-view-gear.test.mjs:96-97` 与 `:98-99`
的 `deepEqual(...map(id))` 期望值要从 `['usage.viewOptions', 'window.resizeToolWindow']`
改成 `['usage.viewOptions', 'usage.groupBy', 'window.resizeToolWindow']`（形状变长、断言强度不变）。

**上游依据**：`platform/usageView-impl/src/com/intellij/usages/impl/UsageViewImpl.java:1089-1098`
（Group By 那个弹出组）与 `platform/usageView-impl/src/com/intellij/usages/impl/actions/GroupByDirectoryStructureAction.java:10-26`
（成员之一，文本 = `platform/usageView/resources/messages/UsageViewBundle.properties:21` "Directory Structure"，
组标题 = 同文件 `:19` "Group By"）。本仓把这一组放进齿轮而不是工具条，理由写在 `src/usageViewGear.ts` 的注释里
（引用面板没有工具条那一层）。

---

## N-3（`appvue`）· 层级行消费 `row`（原 W-1 全文照旧，仍待接）

本批核实：`src/hierarchyRenderer.ts:126-138` 的 `hierarchyRowModel` 产物已经随
`src/hierarchyView.ts:60-76` 的 `hierRows` 每行返回（`{ node, depth, row }`），
`row.icon` 是 `Component | null`、`row.segments` 已含 `" : detail"` 与 `[失效] ` 前缀。
**W-1 给的替换段照抄即可，本批没有改动它需要的任何东西**（原文见
`docs/wiring-requests-2026-10-06-hierarchy.md` §W-1）。
现状仍是 `src/App.vue:2229-2240` 在模板里自己拼行。

---

## N-4（`appvue`）· 层级范围下拉：原 W-2 的 `as` 断言可以去掉了

本批在 `src/hierarchyView.ts:94-110` 补了两样宿主需要的东西（判据 `tests/hierarchy-view-scope.test.mjs`，4 条）：
· `hierScopeOptions` = 那五档本身（`src/hierarchyScopes.ts:44-50` 的同一份表，不是复制）；
· `setHierarchyScope(value: string)` —— `<select>` 的 `@change` 给的就是字符串，白名单校验在模块里，
  非法档位整档不动。

**目标文件 / 行**：`src/App.vue` 层级工具条那一块（原请求写在第 2224-2226 行区间内、导出按钮之后）。
**import**：`src/App.vue:1324` 那一串从 `createHierarchyView` 解构的名字里补 `hierScope, hierScopeOptions, hierScopeNotice, setHierarchyScope`
（`src/hierarchyView.ts:250-254` 的 return 已导出）；**不需要**再 `import { HIERARCHY_SCOPES } from './hierarchyScopes.ts'`。

**可照抄替换段**（没有 `as`、没有新样式类；`<select>` 用现成的表单默认样式，与原请求同一形状）：

`<script setup>` 里加一行（`$event.target` 在 vue-tsc 下是 `EventTarget | null`，
**模板里**取 `.value` 过不了类型检查，所以这层窄化放在脚本里而不是模板里）：
```ts
const pickHierScope = (event: Event) => setHierarchyScope((event.target as HTMLSelectElement).value)
```
模板那一条：
```html
              <label class="call-direction" :title="hierScopeNotice">范围
                <select :value="hierScope" @change="pickHierScope"><option v-for="entry in hierScopeOptions" :key="entry.id" :value="entry.id">{{ entry.label }}</option></select>
              </label>
```
（`class="call-direction"` 是这一条工具栏里已有的那一组按钮的容器类，用它只是为了有同样的间距；
若嫌语义不合，去掉 class 也不会缺样式 —— **别新增 style.css 里的类**，那是主代理名下。）

---

## N-5（`src/semanticActions.ts` / `src/toolContents.ts` 归属代理）· 用法树标题的 provider 层（原 W-4）

原请求 W-4 的两个落点**都不在 navigation2 的可改面**，本批核实后**未动**：
· 取搜索词：`src/semanticActions.ts:128` `startReferences(symbol, `${payload.path}#${symbol}`)`
  （`symbol` 来自 `wordAt`，对所有语言一视同仁）；
· 标题拼装：`src/toolContents.ts:153-160` 的 `usagesTabName` / `usagesPanelTitle`。

可核的上游契约（本批逐行开过）：`platform/indexing-api/src/com/intellij/lang/findUsages/DescriptiveNameUtil.java:23-36`
—— 元数据档 `:26-29`、**文件名档 `:31-33`（`PsiFile` → `file.getName()`）**、其余交给
`LanguageFindUsages.getDescriptiveName`（`:35`）；空名回 `''`（`:20`）。
本仓能做到的只有**文件名档**：符号唯一来源是 LSP `references`/`workspace/symbol`，
`native/lsp_navigation.cpp:38` 往结果里只写 `{path, line, character}` 三件（没有元素种类、没有 provider EP），
所以 `getType`/逐引用读写**给不出**，标题只能取"文件名或符号名"这一档。
建议改法（**由那两个文件的归属代理落**）：把 `payload.path` 那一段换成"根元素所在文件的文件名"，
即 `${baseName(payload.path)}#${symbol}` 的形状，其余一字不动；本批不越界去改。
