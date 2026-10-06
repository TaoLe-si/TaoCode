# 接线请求 · 层级 / 结构 / 粘性行 收尾（2026-10-06，代号 hier3）

本文件是 `docs/wiring-requests-2026-10-06-hierarchy.md`（W-1…W-4）与
`docs/wiring-requests-2026-10-06-usage3.md`（R-1…R-3）的**复核 + 续期**。
逐条对**当前工作区代码**判过（不是照抄旧文档），仍缺的都给「目标文件 + 定位字符串 + 逐字 old + 可照抄 new + 上游依据」。
保留文件（`src/App.vue`、`src/style.css`、`src/bridge.ts`、`src/settingsModel.ts` 等）一律只写请求，不动手。

工作区是共享的：下面所有行号都按 2026-10-06 本轮实测，**定位一律以字符串为准**，行号只是帮你跳过去。

---

## 0. 判定汇总

| 条 | 判定 | 现在卡在哪一环 | 本轮动过的地方 |
| --- | --- | --- | --- |
| W-1 层级行消费 `hierarchyRowModel` | **仍缺**（宿主） | `src/App.vue` 的层级行模板仍自己拼 `node.item.name/detail`，把 `hierRows` 里那份 `row` 丢掉 | 复核 `src/hierarchyView.ts:61`、`:70`（`row` 确实带着 `hierarchyRowModel` 的产物）、`src/hierarchyRenderer.ts:126-138`（五个字段全在） |
| W-2 层级面板范围下拉 | **前提变了**（宿主那一半仍缺） | 控件仍然没有：`grep -c hierScope src/App.vue` = 0 | 旧 W-2 要求宿主 `import { HIERARCHY_SCOPES }` + 事件表达式上写 `as`；现在模块已经递出 `hierScopeOptions`/`setHierarchyScope(value: string)`（`src/hierarchyView.ts:99`、`:104-109`），**按 R-3 那版落即可**，W-2 的写法作废 |
| W-3 / R-1 引用面板换行模型 | **仍缺**（宿主那一行） | `src/App.vue` 的 `bottomTab === 'references'` 那一格还是平表 `v-for="(ref, index) in references"` | 组件侧本轮复核：`UsageTreeRow`（`src/usageViewGrouping.ts:379-401`）在泛型化之后**字段一个没少**，R-1 那段模板要的 `key/kind/depth/label/detail/path/line/collapsed/toggleLabel` 全对得上 ⇒ 不需要改模块；**新增发现**：R-1 模板要的 5 个样式类不在 `src/style.css` 里（见 §3） |
| W-4 用法树标题的按语言 provider | **仍缺**（不在本代理可改面） | 标题层在 `src/toolContents.ts`（`usagesTabName`/`usagesPanelTitle`，被 `src/referenceContents.ts:18` import、`:251-252` 调用），取词在 `src/semanticActions.ts` 的 `wordAt` ⇒ 交这两个文件的归属代理 | 只复核消费链，没动文件 |
| R-2 给引用面板接符号源 | **仍缺**（宿主注册） | 模块入口 `provideUsageSymbols`/`usageSymbolsAvailable`（`src/referenceContents.ts:150-157`）零调用方 | 复核 `ActiveRules.java:59-62`：上游那道除了 `isGroupByFileStructure()` 还要 `FileStructureGroupRuleProvider.EP_NAME.hasAnyExtensions()` ⇒ 本仓的 `usageSymbolsAvailable()` 正是这一条的形态，**不用改**（本轮把这条依据补进 R-2） |
| R-3 层级范围下拉（宿主那一半） | **仍缺**（宿主那一行），写法有效 | 同 W-2 | 本轮逐行开参考树复核 `:770-776`、`:811-813`、`:165`、`HierarchyBrowserScopes.java:8-12` 全部对得上（无订正） |
| welcome2 R-1（结构视图补列） | **已闭环（模块侧），不需要宿主改 `src/App.vue`** | —— | 落点改到 `src/toolViewContext.ts:117-125` + `src/structureFollow.ts:76-107`（新增 `caretSourceWithCharacter`），判据 `tests/outline-caret-source.test.mjs` 新增两条 |
| 粘性行 S-1（多分栏视图档位） | **仍缺**（宿主实参） | `src/App.vue:526` 调 `createStickyLines` 时没给 `view`/`views` ⇒ 永远走「按光标行」的退化路径 | 模块侧本轮补齐：`StickyView.priority` + `orderStickyViews` + `primaryStickyView`（`src/stickyLineViewport.ts:46-101`），见 §1 |
| 粘性行 S-2（按语言的开关键） | **仍缺**（设置键在保留文件里） | `src/stickyLineProviders.ts:97-110` 的 `stickyLinesShownForLanguage` 有实现、有判据，但没有设置键能写它 | 语言解析层本轮补齐（`resolveStickyLanguage`），见 §2 |

---

## 1. S-1 · 粘性行的视图档位（`appvue` + `editorinput` 归属代理）

**现状**：`src/App.vue:526` 只递了 `{ editorSettings, outline, currentLine, language }`。
模块侧已经备好两条路径（`src/stickyLines.ts:144-163`）：给了 `view`（面板身份 + 可视区顶行）就走
上游那一层的完整判据，没给就退回「按光标行」。缺的是宿主的实参：可视区顶行要 `CodeEditor.vue` 透出来。

**模块侧本轮补的（可直接消费）**：

```ts
// src/stickyLineViewport.ts
export interface StickyView { id: string; firstVisibleLine?: number; lineHeight?: number; viewportHeight?: number; priority?: number }
export function orderStickyViews(views: readonly StickyView[]): StickyView[]        // priority 升序、没给档位的排最后、同档保持入参序
export function primaryStickyView(views: readonly StickyView[]): StickyView | null  // 共享顶边该显示哪一块
export function stickyLinesPerView(scopes, views, lineLimit): Map<string, T[]>       // 键序 = 上面的优先级序
```

**上游依据**：每个编辑器各算一份 = `platform/platform-impl/src/com/intellij/openapi/editor/impl/stickyLines/StickyLinesManager.kt:15-34`（类头 + `init` 注册 `visibleAreaListener`）与
`:86-99`（`visibleAreaChanged`）；模型挂在文档上 = `StickyLinesModelImpl.java:93-100`；
层的比较器 = `StickyLinesModelImpl.java:287-296`（起始升序、同起点结束降序）。
**跨视图的先后上游没有**（对 `platform/platform-impl/src/com/intellij/openapi/editor/impl/stickyLines/` 与
`platform/lang-impl/src/com/intellij/codeInsight/stickyLines/` 两个目录 grep `priority` 本轮各再核一次，都是零命中）
⇒ **档位由宿主给**（哪个分栏在上/有焦点只有 `App.vue` 知道），模块只把它落成稳定序。

**要谁做**：`CodeEditor.vue`（非保留）加一条 `visibleAreaChanged`/`firstVisibleLine` 的 emit，`App.vue`（保留）在
`createStickyLines({ ... })` 里加 `view: () => ({ id: pane, firstVisibleLine: ..., lineHeight: ..., viewportHeight: ..., priority: pane === focusedPane ? 0 : 1 })`。
分栏多于一个时用 `stickyLinesPerView`/`primaryStickyView`，别让每个分栏各算各的再拼一遍。

## 2. S-2 · 按语言的粘性行开关（`settingsModel` 归属代理）

**要什么**：一个持久化键 `EditorSettings.showStickyLinesPerLanguage`（`Record<string, boolean>`，
**旧存档缺键 = 空表 = 全部语言都开**，不许按字段数量判损坏），对应上游
`EditorSettingsExternalizable.java:1232` 的 `PROP_SHOW_STICKY_LINES_PER_LANGUAGE` 与
`EditorSettingsState.kt:217-224` 的 `myStickyLinesShownForLanguage`（读法：先 `supportedLang(it)` 再
`areStickyLinesShownFor(lang.id)`，语言没定就 `?: true`，注释原文
"Return true to avoid the late appearance of the sticky panel"）。

**消费方已经就绪**：`src/stickyLines.ts:152` 已经在读 `deps.stickyLanguages?.()`，
`src/stickyLineProviders.ts:97-110` 的 `stickyLinesShownForLanguage` 本轮起也过同一道语言解析
（`resolveStickyLanguage`），所以宿主把键接上就是**端到端生效**，不需要再改模块。
写这一项的两个入口在上游是弹层动作 `actions/StickyLinesDisableForLangAction.kt:24-29`
与设置页的语言复选框 `configurable/StickyLinesConfigurableUI.kt:52-62`；
设置页要「有哪些语言可列」= 本轮新增的 `stickySupportedLanguageIds()`（`src/stickyLineProviders.ts:74-83`，
形态对应 `StickyLinesLanguageSupport.kt:45-52` 的 EP 并集）。

## 3. R-1 / W-3 · 引用面板换成用法树行（`appvue`）—— 仍缺的就是这一格

**目标文件**：`src/App.vue`。import 那一行（现在 `src/App.vue:165`，按字符串定位）：

```diff
-import { references, referenceTabs } from './referenceContents'
+import { referenceRows, references, referencesSpeedSearch, referenceTabs, toggleUsageGroup } from './referenceContents'
```

**逐字 old**（`src/App.vue:2239-2242`，本轮实测原文）：

```html
          <div v-else-if="bottomTab === 'references'" class="ref-list" role="list" aria-label="符号引用">
            <p v-if="!references.length" class="ref-empty">没有找到引用。</p>
            <button v-for="(ref, index) in references" :key="`${ref.path}:${ref.line}:${ref.character}:${index}`" class="ref-item" @click="revealLocation({ path: ref.path, line: ref.line })"><FileCode2 :size="iconSize.menu" /><span class="ref-path" :title="ref.path">{{ ref.path }}</span><span class="ref-pos">{{ ref.line + 1 }}:{{ ref.character + 1 }}</span></button>
          </div>
```

**new（只用 `src/style.css` 里**已有**的类；见下面「样式缺口」）**：

```html
          <div v-else-if="bottomTab === 'references'" class="ref-list" role="list" aria-label="符号引用">
            <input v-model="referencesSpeedSearch" class="outline-filter" type="search" placeholder="搜索" aria-label="搜索引用" />
            <p v-if="!referenceRows.length" class="ref-empty">没有找到引用。</p>
            <template v-for="row in referenceRows" :key="row.key">
              <div v-if="row.kind !== 'usage'" class="ref-item" :style="{ paddingLeft: `${row.depth * 12 + 14}px` }" role="listitem">
                <button class="icon-button" :aria-label="row.toggleLabel" :title="row.toggleLabel" :aria-expanded="!row.collapsed" @click.stop="toggleUsageGroup(row.key)"><ChevronRight v-if="row.collapsed" :size="iconSize.dense" /><ChevronDown v-else :size="iconSize.dense" /></button>
                <span class="ref-path" :title="row.path">{{ row.label }}</span>
                <span class="ref-pos">{{ row.detail }}</span>
              </div>
              <button v-else class="ref-item" :style="{ paddingLeft: `${row.depth * 12 + 26}px` }" @click="revealLocation({ path: row.path, line: row.line })"><FileCode2 :size="iconSize.menu" /><span class="ref-path" :title="row.path">{{ row.path }}</span><span class="ref-pos">{{ row.label }}</span></button>
            </template>
          </div>
```

**注意（两条都是判据钉过的）**：
1. `references` **仍然要留着**（`bottomTabAvailable`/标签计数等既有判据读它）—— 只换渲染数据源，不删数据源。
   判据：`tests/usage-view-panel-rows.test.mjs`「接线：references 仍是那张平表…」。
2. `row.detail` 在过滤后是**可见行**的合计（`src/usageViewGrouping.ts:661` 的 `usageRowsForQuery`），
   宿主**不要再自己 `filter()` 一遍**，否则计数和屏上不符。
3. 单击导航行为不变（上游 `UsageViewImpl.java:978-983` 的 speed search 是**跳转**语义，本仓这张表是
   过滤 + 按可见行重算计数，差异写在 `src/usageViewGrouping.ts:602-659` 的 `filterUsageTree` 头上）。

**样式缺口（要 `style.css` 归属代理决定）**：旧 R-1 那段用了 `ref-group`/`ref-toggle`/`ref-group-label`/
`ref-count`/`ref-speed-search` 五个类，`src/style.css` 里**都没有**（本轮 grep：只有
`.ref-list:1155`、`.ref-item:1156-1158`、`.ref-path:1159`、`.ref-pos:1160`、`.ref-empty:1161`）。
所以上面的 new 改用了 `.ref-item/.ref-path/.ref-pos` + 既有的 `.outline-filter`（`src/components/OutlinePanel.vue`
那一格的过滤框同类）与 `.icon-button`；如果主代理更想要独立的组行样式，就得往 `style.css` 加那五条
（禁裸 hex / 硬编码毫秒，走 `--line`/`--muted`/`--dur-*` 令牌）。

**上游依据**：层序 = `platform/usageView-impl/src/com/intellij/usages/impl/rules/UsageGroupingRulesDefaultRanks.java:26-32`
（`DIRECTORY_STRUCTURE(400)` 在 `FILE_STRUCTURE(500)` 之前）；组行计数 =
`platform/usageView-impl/src/com/intellij/usages/impl/UsageViewTreeCellRenderer.java:95-98`
（`node.getRecursiveUsageCount()` + `usage.view.counter`）；两个折叠动作 =
`platform/usageView-impl/src/com/intellij/usages/impl/UsageViewImpl.java:1081-1082` →
`:1338-1343`（`TreeUtil.collapseAll` 后 `expandRow(0)`）与 `:1313-1319`（`expandTree(2)`）；
速度搜索 = 同文件 `:978-983`。

## 4. R-2 · 符号源注册（`appvue` / LSP 归属代理）

模块侧入口不变（`src/referenceContents.ts:150-157`）：

```ts
provideUsageSymbols((path: string) => readonly UsageMemberSymbol[] | undefined)  // 装
provideUsageSymbols(null)                                                        // 拔（切工程等）
```

宿主在**引用结果回来后**，对结果里出现的每个文件用它现成的 `documentSymbol` 通道（`src/bridge.ts` 的
`LspRequestKind` 里那条；按文件缓存可走 `src/lspPerFileCache.ts`；`src/lspNavigation.ts:466-472` 已经是
这条通道在结构视图上的用法）注册一次。`UsageMemberSymbol` 与 `LspDocumentSymbol` 结构兼容，
顺序不要求嵌套也不要求排好（`usageSymbolsOutsideIn` 自己摊平）。
**不接也不报错**：树退回「文件 → 行」，齿轮「分组」组里只给「目录结构」一条
（判据 `tests/usage-view-gear.test.mjs`）。
本轮复核补一条依据：上游那道是**两个**条件 —— `ActiveRules.java:59-62`
（`isGroupByFileStructure()` **且** `FileStructureGroupRuleProvider.EP_NAME.hasAnyExtensions()` 才装规则），
本仓的 `usageSymbolsAvailable()` 承担的就是后半句「有没有 provider」。
默认值两条不同别抄错：成员层 `UsageViewSettings.kt:21` = **true**、目录层 `:26` = **false**（本轮逐行核过）。

## 5. W-1 · 层级行消费行模型（`appvue`）—— 仍缺

**目标文件**：`src/App.vue`，层级那一格。无需新 import（`hierRows` 每行已经带 `row`）。

**逐字 old（其一，`src/App.vue:2253`）**：

```html
              <div v-for="({ node, depth }, index) in hierRows" :key="index" class="call-row" role="listitem" :style="{ paddingLeft: `${depth * 18 + 8}px` }">
```

**new**：

```html
              <div v-for="({ node, depth, row }, index) in hierRows" :key="index" class="call-row" role="listitem" :style="{ paddingLeft: `${depth * 18 + 8}px` }">
```

**逐字 old（其二，`src/App.vue:2257-2262`）**：

```html
                <button class="call-jump" :disabled="!node.item.path" :title="`${node.item.path}:${(node.item.line ?? 0) + 1}`" @click="revealLocation({ path: node.item.path, line: node.item.line ?? 0 })">
                  <span class="call-name">{{ node.item.name }}</span>
                  <span v-if="node.item.detail" class="call-detail">{{ node.item.detail }}</span>
                  <span class="call-path">{{ node.item.path }}</span>
                  <span class="call-pos">{{ (node.item.line ?? 0) + 1 }}:{{ (node.item.character ?? 0) + 1 }}</span>
                </button>
```

**new**：

```html
                <button class="call-jump" :disabled="!node.item.path" :title="`${node.item.path}:${(node.item.line ?? 0) + 1}`" @click="revealLocation({ path: node.item.path, line: node.item.line ?? 0 })">
                  <component :is="row.icon" v-if="row.icon" :size="iconSize.menu" />
                  <span v-for="(seg, si) in row.segments" :key="si" :class="seg.tone === 'muted' ? 'call-detail' : 'call-name'">{{ seg.text }}</span>
                  <span class="call-path">{{ node.item.path }}</span>
                  <span v-if="row.position" class="call-pos">{{ row.position }}</span>
                </button>
```

折叠那颗按钮的 `title`/`aria-label`（现在 `src/App.vue:2254` 内联的
`:title="`${node.expanded ? '收起' : '展开'} ${node.item.name}`"`）换 `row.toggleLabel`，
`row.trailing` 若要显示就再补一个 `<span class="call-detail" role="status">{{ row.trailing }}</span>`。
不新增样式类（`.call-name`/`.call-detail`/`.call-pos`/`.call-path` 都在 `src/style.css:1297-1301`）。

**为什么必须换**：现在这段模板把 `src/hierarchyRenderer.ts:126-138` 算好的 `row` 整个丢掉 ⇒
`hierarchyRowModel` 的分段/图标/`" : "` 分隔改了就无效。
**上游依据**：`platform/lsp-impl/src/impl/features/hierarchy/LspHierarchyNodeDescriptor.kt:25-31`
（`:28` `myHighlightedText.ending.addText(" : $detail", getPackageNameAttributes())`）与
`platform/lang-impl/src/com/intellij/ide/hierarchy/HierarchyNodeRenderer.java:32-43`
（`:37` 复合文本 + `:38` `setIcon(fixIconIfNeeded(...))`）—— 两处本轮都逐行开过，行号对得上。

## 6. W-2 / R-3 · 层级范围下拉（`appvue`）—— 仍缺，写法以 R-3 为准

`src/App.vue` 层级工具条那一行（现在 `src/App.vue:2249`，`重新查询`/`导出` 两个按钮所在）之后加：

```html
              <label class="hier-scope"><span class="call-detail">范围</span><select :value="hierScope" aria-label="层级范围" @change="setHierarchyScope(($event.target as HTMLSelectElement).value)"><option v-for="entry in hierScopeOptions" :key="entry.id" :value="entry.id">{{ entry.label }}</option></select></label><span class="call-detail">{{ hierScopeNotice }}</span>
```

`hierScope` / `hierScopeOptions` / `setHierarchyScope` / `hierScopeNotice` 都在 `createHierarchyView` 的
返回里（`src/hierarchyView.ts:252`、`:254`），宿主在 `src/App.vue:1341` 那一批解构里补上这四个名字即可；
**不需要** `import { HIERARCHY_SCOPES }`，也**不需要**在模板里写 `as HierarchyScopeId`
（`setHierarchyScope(value: string)` 内部做白名单校验，认不出的档位整档不动 ——
`src/hierarchyView.ts:104-109`，对应上游默认档 `HierarchyBrowserBaseEx.java:165`）。
`.hier-scope` 这个类 `src/style.css` 里没有 ⇒ 要么复用 `.call-detail`/`.icon-button`（上面这版就是），
要么主代理加样式。

**上游依据（本轮逐行开过，与旧文档一致）**：建列表 =
`platform/lang-impl/src/com/intellij/ide/hierarchy/HierarchyBrowserBaseEx.java:770-776`
（Production → Tests → All → This Class → This Module，`:772-776` 正好这个序）、
逐条加进下拉 = `:811-813`、命名作用域追加 = `:778-778`+`:779-782`、
`ConfigureScopesAction` = `:815`（本仓没有宿主 ⇒ **不给行**，不做假控件）、
每档呈现名 = `:235-243`、五档 id = `HierarchyBrowserScopes.java:8-12`
（注意常量是 `SCOPE_TEST = "Test"`，屏上呈现是 `TestsScope.INSTANCE.getPresentableName()` = Tests）、
过滤口径 = `HierarchyTreeStructure.java:161-169` 的 `isInScope`（本仓形态 `src/hierarchyScopes.ts:120-128` 的 `scopeFilterFor`）。

## 7. W-4 · 用法树标题的按语言 provider —— 仍缺（不在本代理可改面）

判词 `ixa/find-usages` 的「`getDescriptiveName`/`getType`/`getNodeText` 决定 `Usages of 'x'` 标题」这一档，
本仓的落点是 `src/toolContents.ts` 的 `usagesTabName`/`usagesPanelTitle`（消费方
`src/referenceContents.ts:18` import、`:251-252` 调用）与取词处 `src/semanticActions.ts` 的 `wordAt`
（对所有语言一视同仁）。**要谁接**：这两个文件的归属代理。
可消费的既有事实：本仓符号唯一来源是 LSP `references`/`workspace/symbol`，`Location` 不带元素种类 ⇒
`getType`/逐引用读写**给不出**，只能做「文件名档」的描述名（上游 `DescriptiveNameUtil`，类名）。
将来 `documentHighlight` 带上 kind 时，`src/usageViewGrouping.ts`/`src/referenceContents.ts` 可以扩一档
按 kind 的分组键 —— **现在没有消费链路，不预先造模块**。
