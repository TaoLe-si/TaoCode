# 接线请求（代号 usage3，2026-10-06）

本代理不能改 `src/App.vue`（保留文件，归 `appvue`）。下面三条是**宿主挂载点**，
模块侧已经全部做完并有判据（`tests/usage-view-panel-rows.test.mjs`、
`tests/hierarchy-scopes.test.mjs`、`tests/hierarchy-view-scope.test.mjs`），
不接就不会在界面上出现——本仓的规矩是"没有消费链路的 UI 一律不渲染"，所以模块侧**故意**不画。

---

## R-1 引用面板：把那张平表换成行模型（一次 `v-for`）

- 目标文件：`src/App.vue`
- 目标位置：底部面板里 `bottomTab === 'references'` 那一格，搜索关键字 `class="ref-list"`
  （本批开始时在 `src/App.vue:2226-2228`，工作区共享、行号可能已被他人位移，请按字符串定位）
- 与本请求同源的另一半：`docs/wiring-requests-2026-10-06-navigation2.md` 的 **N-1**
  （同一条挂载点，那一份写的是"树形行 + 折叠三动作"，这一份补上**成员层**与**速度搜索**）。
- import 语句（替换现有那一行 `import { references, referenceTabs } from './referenceContents'`，
  该行现在在 `src/App.vue:165`）：

```ts
import { referenceRows, references, referencesSpeedSearch, referenceTabs, toggleUsageGroup } from './referenceContents'
```

- 可照抄的整段替换（把那一格里 `v-for="(ref, index) in references"` 的那三个元素换掉；
  `references` 仍要留着——它是 `bottomTabAvailable`/计数等既有判据的数据源）：

```html
<div v-else-if="bottomTab === 'references'" class="ref-list" role="list" aria-label="符号引用">
  <input v-model="referencesSpeedSearch" class="ref-speed-search" type="search" placeholder="搜索" aria-label="搜索引用" />
  <p v-if="!referenceRows.length" class="ref-empty">没有找到引用。</p>
  <template v-for="row in referenceRows" :key="row.key">
    <div v-if="row.kind !== 'usage'" class="ref-group" :style="{ paddingLeft: `${row.depth * 12}px` }" role="listitem">
      <button class="icon-button ref-toggle" :aria-label="row.toggleLabel" :title="row.toggleLabel"
              :aria-expanded="!row.collapsed" @click.stop="toggleUsageGroup(row.key)"><ChevronRight v-if="row.collapsed" :size="iconSize.dense" /><ChevronDown v-else :size="iconSize.dense" /></button>
      <span class="ref-group-label" :title="row.path">{{ row.label }}</span>
      <span class="ref-count">{{ row.detail }}</span>
    </div>
    <button v-else class="ref-item" :style="{ paddingLeft: `${row.depth * 12 + 20}px` }"
            @click="revealLocation({ path: row.path, line: row.line })"><FileCode2 :size="iconSize.menu" /><span class="ref-path" :title="row.path">{{ row.path }}</span><span class="ref-pos">{{ row.label }}</span></button>
  </template>
</div>
```

- 上游依据：
  - 树形行与层序 = `platform/usageView-impl/src/com/intellij/usages/impl/rules/UsageGroupingRulesDefaultRanks.java:26-32`
    （DIRECTORY_STRUCTURE=400 在 FILE_STRUCTURE=500 之前）+
    `java/java-backend/resources/META-INF/JavaPlugin.xml:566-567`（类在方法之前）；
  - 组行的计数 = `platform/usageView-impl/src/com/intellij/usages/impl/UsageViewTreeCellRenderer.java:95-98`
    （`node.getRecursiveUsageCount()` + `usage.view.counter`）；
  - 折叠/展开两个动作 = `platform/usageView-impl/src/com/intellij/usages/impl/UsageViewImpl.java:1081-1082`
    → `:1338-1343`（`TreeUtil.collapseAll` 后 `expandRow(0)`）与 `:1313-1319`（`expandTree(2)`）；
  - 速度搜索那一串 = `UsageViewImpl.java:978-983`（`installTreeSpeedSearch` + `getPlainTextForNode`）。
- 注意：`row.count` 在过滤后是**可见行**的合计（判据 `速度搜索过滤后的行归属` 那一条钉死了这一点），
  宿主不要再自己 `filter()` 一遍行数组，否则计数与屏上不符。

## R-2 给引用面板接上符号源（成员层的数据）

- 模块侧入口（已实现、已被判据覆盖）：`src/referenceContents.ts` 的

```ts
provideUsageSymbols((path: string) => readonly UsageMemberSymbol[] | undefined)
provideUsageSymbols(null)   // 拔掉（例如切工程）
```

  `UsageMemberSymbol = { name; kind; startLine; endLine; startChar?; endChar?; detail?; children? }`，
  与 `src/bridge.ts:143` 的 `LspDocumentSymbol` 结构兼容（可直接把那份数组递进来，
  顺序既不要求嵌套也不要求排好——`usageSymbolsOutsideIn` 会自己摊平成"由外到内"）。
- 请宿主在**引用结果回来后**，对结果里出现的每个文件用它现成的 `documentSymbol` 通道
  （`src/bridge.ts:176` 的 `LspRequestKind` 里的 `'documentSymbol'`；缓存可走 `src/lspPerFileCache.ts`）
  注册一次这个 provider。**由谁缓存、什么时候取，宿主定**——模块只认这一份回调。
- 行为契约（不接也不报错，但界面就是现在这两层）：
  - 没有 provider ⇒ 树 = `文件 → 行`，齿轮「分组」组里**只有**「目录结构」一条
    （`src/usageViewGear.ts` 的 `usageSymbolsAvailable()` 判定，判据
    `齿轮「分组」组：目录结构在前、文件结构在后（有符号源才给第二条）`）；
  - 有 provider ⇒ 树 = `文件 → 类 → 方法 → 行`，齿轮多出「文件结构」一条，默认**勾着**
    （上游 `platform/usageView/src/com/intellij/usages/UsageViewSettings.kt:21` 的
    `isGroupByFileStructure: Boolean = true`）。
- 上游依据：`platform/usageView-impl/src/com/intellij/usages/impl/rules/ActiveRules.java:59-62`
  （这一档由 `FileStructureGroupRuleProvider` 那一族提供，开关为真才装）、
  `java/java-impl/src/com/intellij/usages/impl/rules/ClassGroupingRule.java:44-62`/`:114-122`、
  `.../MethodGroupingRule.java:63-73`/`:87-91`。

## R-3 层级面板的范围下拉（W-2 的宿主那一半）

- 目标文件：`src/App.vue`；目标位置：`bottomTab === 'hierarchy'` 那一格
  （本批开始时在 `src/App.vue:2243`，`class="call-panel"`）。
- 该格现在**没有**任何切档控件（`grep -n "hierScope" src/App.vue` = 0 命中），
  所以下面这段是新增，不是替换。`createHierarchyView` 已经把三样东西都递出来了
  （`src/hierarchyView.ts:99` `hierScopeOptions`、`:104-109` `setHierarchyScope`、`src/hierarchyView.ts:78` `hierScopeNotice`）：

```html
<select class="hier-scope" :value="hierScope" aria-label="层级范围"
        @change="setHierarchyScope(($event.target as HTMLSelectElement).value)">
  <option v-for="entry in hierScopeOptions" :key="entry.id" :value="entry.id">{{ entry.label }}</option>
</select>
<span class="hier-scope-notice">{{ hierScopeNotice }}</span>
```

- 顺序与呈现名**由模块给**（宿主不要自己列一遍）：`src/hierarchyScopes.ts:44-63` 的
  `HIERARCHY_SCOPES` = `Production → Tests → All → This Class → This Module`，
  依据 `platform/lang-impl/src/com/intellij/ide/hierarchy/HierarchyBrowserBaseEx.java:770-776`
  （建列表）与 `:811-813`（按这个序一条一条加进下拉），呈现名分别是
  `platform/analysis-api/src/com/intellij/psi/search/scope/ProjectProductionScope.java:36` +
  `platform/analysis-api/resources/messages/AnalysisBundle.properties:127`（Production）、
  `platform/analysis-api/src/com/intellij/psi/search/scope/TestsScope.java:22` +
  `AnalysisBundle.properties:205`（**Tests**，注意常量是 `Test`，屏上是 `Tests`，
  `HierarchyBrowserScopes.java:12`）、`AnalysisBundle.properties:206`（All）、
  `platform/lang-api/resources/messages/LangBundle.properties:348`/`:349`（This Class / This Module）。
- 求值不在模板里：过滤一行都用
  `src/hierarchyScopes.ts:120-128` 的 `scopeFilterFor(scope, base)`（纯函数，
  `HierarchyTreeStructure.java:161-169` 的 `isInScope` 的本仓形态）；
  认不出的档位按默认档 `All` 兜底（`HierarchyBrowserBaseEx.java:165`），绝不清空列表。
- 命名作用域那一长串（`HierarchyBrowserBaseEx.java:778-782`）与
  `ConfigureScopesAction`（`:815`）本仓没有宿主 ⇒ **不给行**，不做假控件。
