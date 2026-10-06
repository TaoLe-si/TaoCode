# 批次报告 · 2026-10-06 · 代号 `ptree3`（项目视图四族：判词先核 + 模块侧三条）

上游唯一真源 `D:\Backup\Downloads\intellij-community-master\intellij-community-master`。
下面每条坐标都是我这一轮**亲自打开那一行**核对过的；没核的一律写进 §6「无法核实」。
可改面严格限制在 `src/projectTree*.ts` / `src/tree*.ts` / `src/structure*.ts` 与对应 tests/。
未 commit、未 push、未跑 `git checkout/reset/stash/clean`；`src/App.vue` 一个字没动。

---

## 1. 判词核对表（族 / 项 / 判定 / 上游坐标 / 本仓落点 / 一句话）

判定口径：`[x]` 已做且判据跑通 · `[~]` 部分（写「本仓已有」+「还差」）· `[ ]` 未做 · `[-]` 不适用（给具体理由）。

### 1.1 `pv/project-view-nodes`（判词原文见 `docs/inventory/verdict-projectviews.md:28`）

| 项 | 判词怎么说 | 实测判定 | 上游坐标（已逐条开文件） | 本仓落点（文件:行） |
|---|---|---|---|---|
| 文件嵌套的默认规则 | 「`NestingTreeStructureProvider`/`FileNestingBuilder` 的默认规则：同名同目录、只嵌一层，`src/projectTreeModel.ts` 消费」 | `[x]` | `platform/lang-impl/src/com/intellij/ide/projectView/impl/NestingTreeStructureProvider.java:48`（开关关掉原样返回）、`:50-58`（只取同目录的 PsiFileNode） | `src/projectTreeNesting.ts:69-76`（表）、`src/projectTreeModel.ts:47-48,92-98` |
| **传递规则** | 判词**没提**这一条（本仓此前也没有） | `[x]` 本轮做 | `.../FileNestingBuilder.java:43-81`，补规则的注释原话在 `:65`，两条 for 在 `:66-70`、`:72-76`；丢掉不可用对在 `:58-59` | `src/projectTreeNesting.ts:145-176`（`nestingRulePairs`）、`:214-227`（`nestSiblings` 改在整张候选表上判） |
| **后缀不分大小写 / 基名分** | 判词没提 | `[x]` 本轮做 | `FileNestingBuilder.java:91`、`:163-164`（`endsWithIgnoreCase`）；基名那一半是 `:92-93` 拼名后 `parentDir.findChild()` 的精确查找、`:137/:144` 的边表键 | `src/projectTreeNesting.ts:88-120`（`matchNamePattern`） |
| **父子同现时模式长的那一侧赢** | 判词没提 | `[x]` 本轮做 | `FileNestingBuilder.java:158-176`（判定在 `:166-173`） | `src/projectTreeNesting.ts:131-138`（`nestingRoleOf`） |
| **可编辑的嵌套规则** | 判词列在「缺」里：「上游 `FileNestingInProjectViewDialog`；本仓 `createProjectTreeModel` 没有设置页给 `nestingRules` 喂值，只用 `DEFAULT_NESTING_RULES`」 | `[x]` **判词过时** ⇒ 升档请求 §7-R1 | `.../FileNestingInProjectViewDialog.java:185-208`（`doValidate` 三条，本轮实测存在） | `src/projectTreeNestingDialog.ts:44,58,79,86`、`src/components/FileNestingSettings.vue:51-54`、`src/components/ProjectViewSortSettings.vue:34,67`、`src/components/ToolWindowView.vue:18,224`、`src/components/FileTree.vue:50`、判据 `tests/project-tree-appearance.test.mjs:117,243` |
| **规则表的落盘形态** | 判词没提 | `[x]` 本轮做 | `ProjectViewFileNestingService.java:102-103`（`SortedList(comparing(parentFileSuffix))`）、`:110-159`（一条=一对，`equals` 在 `:149-153`） | `src/projectTreeState.ts:50-93`（`normalizeNestingRules`）+ 两个入口 `:109`、`:141` |
| 压缩目录（`ProjectView.CompactDirectories`） | 判词的「本仓已有」与「缺」里**都没写**它 | `[x]` 早做过 ⇒ 记档请求 §7-R2 | `platform/projectView/shared/resources/intellij.platform.projectView.xml:98-99`、`platform/platform-resources-en/src/messages/ActionsBundle.properties:1459-1460`、`platform/lang-impl/src/com/intellij/ide/scopeView/ScopeViewTreeModel.java:595-610`（那条 while）、`:657-661`（`getSingleDirectory`）、`:789-792`（`/` 连接显示名） | `src/projectTreeCompactDirs.ts:54-93`、`src/projectTreeModel.ts:49-82,184-193`、判据 `tests/project-tree-appearance.test.mjs:28-116,269` |
| 包视图 flatten / compact middle packages | 判词列在「缺」里，理由「需 PSI/Java 模型」 | `[-]` 本仓无 PSI，且**与上一条不是一件事**：文件系统目录的合并（Compact Directories）本仓已做 | `ScopeViewTreeModel.java:594`（`!isPackage(icon) \|\| !flattenPackages` 这一支才走目录合并）、`:635-655`（`visitPackages` 是包专用） | 同上；判词应把「包视图」与「压缩目录」分开写 |
| 模块分组 / Detach-Attach 库 / 同一文件多 pane / inplace comments | 判词列在「缺」里 | `[ ]` 本轮未动（都不在 `projectTree*/tree*/structure*` 前缀里能闭环的位置） | 未核（本轮没有为这几条开上游文件） | — |

### 1.2 `pv/project-view`（判词原文见 `docs/inventory/verdict-projectviews.md:36`）

| 项 | 判定 | 上游坐标 | 本仓落点 |
|---|---|---|---|
| 树模型 / 懒展开 / 递归展开 / 全部展开折叠 | `[x]`（判词已升过） | `platform/lang-impl/src/com/intellij/ide/projectView/actions/ExpandRecursivelyAction.kt:29-31`、`.../ProjectViewExpandAllAction.kt:17-22`、`platform/platform-api/src/com/intellij/ide/DefaultTreeExpander.kt:21-36,42,49-59,73-78` | `src/projectTreeModel.ts:147-152,241-266,271-275` |
| **批量展开只开目录 ⇒ 嵌套父行开不出来** | `[x]` 本轮做（判词没提这条缺陷） | `DefaultTreeExpander.kt:21-36`（实现里没有任何「是目录」的条件）+ `platform/editor-ui-api/src/com/intellij/ide/util/treeView/AbstractTreeNode.java:138-140`（默认 `isIncludedInExpandAll=true`）+ `platform/lang-impl/src/com/intellij/ide/projectView/impl/nodes/ExternalLibrariesNode.java:61-64`（唯一让开的那条）+ `.../nodes/NestingTreeNode.java:43-51`（文件行是有孩子的节点） | `src/projectTreeModel.ts:241-266`（`visit`）、`:147-152`（`canExpandRecursively`）、`:271-275`（`expandRecursively` 去掉目录过滤） |
| **`MarkRootGroup` / `MarkAsContentRootAction`**：判词写「缺……项目树右键没有 Mark Directory As」 | `[x]` **判词过时** ⇒ 升档请求 §7-R3 | 本轮只核到本仓侧（上游那条我**没有**开文件核对 ⇒ 升档请求里标「上游坐标待补」） | `src/pvMarkRoots.ts`（成员与可见性规则）、`src/treeActions.ts:156-184`（`markRootMenu`/`applyMarkRoot`）、挂点 `src/App.vue:2461-2463`（我读到的行，未改） |
| **判词说 `src/projectTreeState.ts` 是「折叠状态持久化」** | **事实错** ⇒ 订正请求 §7-R4 | — | 该文件 :1-176 全文只有三组键：`sortKey` + 六个布尔行为键（`:17-18`）+ `useFileNestingRules`/`nestingRules`（`:75`），**没有任何折叠状态序列化**。折叠状态持久化我在本域没定位到（`grep -l collapse src/*.ts` 命中的是编辑器折叠那族：`editorFoldingState.ts` 等） |
| 多窗格项目视图 / `CustomizeTreesAction` / 预加载与性能面板 | 判词列在「缺」里 | `[ ]` 本轮未动（需要动 `App.vue`/`ToolWindowView.vue`，不在我可改面） | — |

### 1.3 `pv/structure-view`（判词原文见 `docs/inventory/verdict-projectviews.md:30`）

| 项 | 判定 | 上游坐标 | 本仓落点 |
|---|---|---|---|
| **autoscroll to/from source 两个开关**：判词写「缺」 | `[x]` **判词过时** ⇒ 升档请求 §7-R5 | `platform/structure-view-impl/src/com/intellij/ide/structureView/impl/StructureViewFactoryImpl.java:49`（`AUTOSCROLL_MODE = true`）、`:50`（`AUTOSCROLL_FROM_SOURCE = false`）；`.../newStructureView/StructureViewComponent.java:655`（`scrollToSelectedElement`）、`:794`（`scrollToSource`）、`:804-849`（`MyAutoScrollFromSourceHandler`，回调在 `:830/:835/:849`） | `src/structureFollow.ts:105-112`（`shouldRevealInEditor`）、`:88-90`（列口径换算）、`src/components/OutlinePanel.vue:31-32,63,74-77,116,121`、`src/outlineView.ts:127`（`caretSymbolInTree`）、判据 `tests/structure-follow.test.mjs`、`tests/outline-caret-source.test.mjs`（本轮 8 文件域跑：全绿） |
| **`VisibilitySorter` 一族：判词写「本仓只有名称与种类两档」** | `[x]` **判词过时** ⇒ 升档请求 §R5 的第二条 | `java/java-structure-view/src/com/intellij/ide/structureView/impl/java/VisibilityComparator.java:23-29`（`accessLevel2 - accessLevel1` = 级别大的在前；同级交给下一个比较器 `:26-27`）、`:16`（`UNKNOWN_ACCESS_LEVEL = -1`） | `src/structureFollow.ts:24-54`（四档 + unknown）、`src/outlineView.ts:39,93-94`、`OutlinePanel.vue:47,55` |
| `Show Inherited Members` | `[~]` 仍缺（判词成立）：本仓符号来自 LSP `documentSymbol`，宿主 `native/lsp_support.cpp` 的 `collect_symbols` 不区分继承成员 | 判词给的这条我没有再开上游核对（本轮不属于我做） | — |
| 「列精度」 | `[~]`：本仓已把编辑器的 1 基列换成 LSP 0 基（`src/structureFollow.ts:88-90`），宿主没把光标列传进窗格 ⇒ 已由 `projecttree` 桶挂了 W1 接线请求，**不重复** | — | `docs/wiring-requests-2026-10-06-projecttree.md:11` |

### 1.4 `pv/command`（判词原文见 `docs/inventory/verdict-projectviews.md:33`）

| 项 | 判定 | 说明 |
|---|---|---|
| 「文件新建/重命名/删除在 `src/explorerActions.ts`/`src/treeActions.ts` 直接落盘，不可撤」 | `[~]` **判词该改成「模型侧已有，卡 App.vue 落点」** | `src/pvFileUndoProvider.ts` 的 `copyStep/moveStep` 已在生产链上，`createStep/deleteStep` 零调用方，落点在 `src/App.vue`（保留文件）⇒ 上一桶已写 W2 请求（`docs/batch-2026-10-06-projecttree.md:82`）。本轮没有重复实现，也没有新证据可推翻它 |
| 跨文件全局撤销栈 | `[ ]` 本轮未动（需要 `App.vue` + `bridge.ts`，都保留） | — |

---

## 2. 本轮实现的三条（模块侧独立闭环）

### C1 `src/projectTreeNesting.ts` —— 传递规则 + 后缀大小写 + 父子同现长侧赢
上游：`FileNestingBuilder.java:43-81`（`:58-59` 丢不可用对、`:65-76` 补传递规则）、`:91`/`:163-164`（`endsWithIgnoreCase`）、`:92-93`（拼名后精确 `findChild`）、`:158-176`（角色判定）、`:191-201`（当过子的不再当父）。
本仓：新增 `nestingRoleOf`、`nestingRulePairs`、`nestingRulesFromPairs`；`matchNamePattern` 字面段不分大小写（少数 Unicode 小写变长时退回按原样比，避免下标错位）；`nestSiblings` 改成在**整张候选表**上判「谁是子」，于是
- `a.ts` + `a.js` + `a.d.ts`（规则 `*.ts←*.js`、`*.js←*.d.ts`）：`a.d.ts` 现在挂到 `a.ts` 下（此前掉回顶层）；
- `a.ts` + `a.d.ts`（本仓出厂表就有 `*.ts←*.js` 与 `*.js←*.d.ts`）：`a.d.ts` 也进 `a.ts`；
- `a.ts` + `a.JS`：照样嵌（上游 `endsWithIgnoreCase`）；`App.ts` + `app.js`：不嵌（基名分大小写）。
行序无关：`[a.ts, a.d.ts, a.js]` 与 `[a.ts, a.js, a.d.ts]` 给出同一棵树；互相认领时两条边一起作废（同 `:102-103`）。

### C2 `src/projectTreeModel.ts` —— 批量展开覆盖「文件嵌套」的父行
`visit()` 原来第一行就是 `entry.kind !== 'directory' ⇒ return`，所以「递归展开」永远开不出嵌套子行（齿轮按钮 `src/components/ToolWindowView.vue:208` 是真活的）。现在文件行只要有嵌套子项就 `expanded.add(...)` 并进它名下的子行；`expandRecursively()` 去掉目录过滤；`canExpandRecursively()` 从「选中有目录」放宽成「选中行开得出东西（目录或有嵌套子行）」。外部库的豁免不变（`expandAll` 那条 `synthetic(...)?.icon !== 'libraries'`）。

### C3 `src/projectTreeState.ts` —— 规则表落盘形态照上游
`normalizeNestingRules()`：一个父合并成一条、`(父,子)` 去重、父升序、子按 `父 + " " + 子` 的次序、空后缀与父子相等的丢掉；接在**仅有的两个写入口**（`updateNesting` 与存档回读 `readNestingRules`）。**不做**传递展开（上游补规则发生在应用时，存的那份仍是用户写的基础表 —— `FileNestingBuilder.java:44-45` 读的是 `getRules()`）。坏行的处理一个字没改（仍按没写处理、回落默认表，不按字段数量判损坏）。

---

## 3. 改动文件清单（`wc -l` 前后）

| 文件 | 前 | 后 |
|---|---:|---:|
| `src/projectTreeNesting.ts` | 141 | 246 |
| `src/projectTreeModel.ts` | 388 | 409 |
| `src/projectTreeState.ts` | 134 | 176 |
| `tests/project-tree-nesting.test.mjs` | 68 | 122 |
| `tests/project-tree-appearance.test.mjs` | 275 | 352 |

没动：`src/projectTreeCompactDirs.ts`(93)、`src/projectTreeDecorations.ts`(56)、`src/projectTreeNestingDialog.ts`(97)、`src/projectTreeSort.ts`(101)、`src/structureFollow.ts`(112)、`src/treeActions.ts`(190)。
保留文件（`src/App.vue`、`src/bridge.ts`、`src/style.css`、`src/tokens.css`、`CMakeLists.txt`、`scripts/verdict_table.py`、`docs/inventory/*.md`）**一个字没改**。

## 4. §5 每条自查命令的前后数字

| 门禁 | 接手时 | 收工时 |
|---|---|---|
| `node --test tests/project-tree-nesting.test.mjs`（C1 判据） | 1 红（`SyntaxError: … does not provide an export named 'nestingRoleOf'`，整文件加载失败） | **14/14 绿** |
| `node --test tests/project-tree-appearance.test.mjs`（C2/C3 判据） | 11 绿 + 新增 2 条各自红（`Expected values to be strictly deep-equal`：实际 `['demo','src','main.ts']` 里没有嵌套子行 / 规则表没被整形） | **17/17 绿** |
| 本域 8 文件（`project-tree-nesting`、`project-tree-appearance`、`project-tree-behavior`、`project-view-behavior`、`tree-rename-key`、`structure-follow`、`outline-view`、`outline-caret-source`） | — | **72/72 绿** |
| `npx vue-tsc -b --force` | — | 10 条错，**全在别人的在途文件**：`src/semanticHighlighting.ts`(5)、`src/components/ProblemsPanel.vue`(3)、`src/lspServerMessages.ts`(1)、`src/refactorPreview.ts`(1)；`grep -E "projectTree\|treeActions\|structureFollow"` = **0 条**。我名下 0 错（清单存 `.tmp-ptree3-tsc.txt`） |
| `node --test tests/module-size.test.mjs` | — | **4/5**；唯一红项是 `src/components/ProblemsPanel.vue(903 行)` 超 900 未登记 —— **不是本桶文件**，本桶最大文件 `projectTreeNesting.ts` 246 行 |
| `node .tools/find-param-props.mjs` | — | 共 0 处参数属性 |
| `node .tools/find-ts-in-mjs.mjs` | — | 干净 |
| `node .tools/find-missing-ext.mjs` | — | 干净（扫描 1301 文件） |
| `node .tools/find-orphan-modules.mjs --gate` | — | `已登记孤儿 9 / 基线 9 · 新增 0 · 本轮清掉 0` ⇒ **绿** |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | 2 红（上一桶 `docs/batch-2026-10-06-projecttree.md:171` 就登记过） | **3 红**，offender 全在**别人桶的文档**里（文件名 `batch-2026-10-06-status2defect.md`、`status2.md`、`welcome2.md`、`projecttree.md`、`wiring-requests-2026-10-06-plugins.md`、`wiring-requests-2026-10-06-vcs2.md`），被点名的三条假路径是 PsiUtil 那一条、SuppressIntentionAction 那一条、`structureView/StructureViewFactoryImpl`（真路径中间多一段 `impl/`，本轮实测在 `.../structureView/impl/`）、以及 EditorSettingsExternalizable 那一条 —— **假路径在这里不写成「路径:行号」的形状**（写出来就会被门禁止当成一条真引用收集，本轮第一版就踩了这条，已按门禁反馈改成不带坐标的转述）。本轮改动**没有**新增 offender |

## 5. 反向验证记录（注入违规 → 红 → 撤 → 绿）

一次注入三条违规（备份在 `build/ptree3-back/`，跑完删干净）：

| # | 注入的违规 | 变红的判据 |
|---|---|---|
| 1 | `src/projectTreeNesting.ts` 删掉 `for (const grandparent of childToParents.get(parent) ?? []) add(grandparent, child)`（传递补规则那一半） | `只嵌一层：…孙靠传递规则挂到祖先行下` + `传递规则：A←B 与 B←C 之间补一条 A←C（FileNestingBuilder.java:65-76）` |
| 2 | `src/projectTreeModel.ts` 把嵌套分支改成 `if (true) return`（文件行一律不开） | `递归展开与全部展开也开「文件嵌套」的父行（不是只开目录）` |
| 3 | `src/projectTreeState.ts` 的 `updateNesting` 退回原实现（不整形） | `规则表落盘形态照上游：一个父一条、(父,子) 去重、父升序（…）` |

结果：`node --test tests/project-tree-nesting.test.mjs tests/project-tree-appearance.test.mjs` ⇒ **tests 27 / pass 23 / fail 4**（C1 的注入同时打红 2 条）。
撤掉三处注入后（逐文件字节还原）⇒ `nesting + appearance + behavior` **31/31 绿**，再跑本域 8 文件 **72/72 绿**。
`git diff -- src/projectTreeNesting.ts src/projectTreeModel.ts src/projectTreeState.ts` 复查：hunk 全是本轮 C1/C2/C3 的，没有顺手重排别人的代码。

## 6. 零消费方自查

本轮新增/改动的导出全部有真实消费方，没有新登记孤儿（orphan 门禁 `新增 0` 已证）：
- `nestingRulePairs` / `nestingRulesFromPairs` / `nestingRoleOf`：`nestSiblings`/`parentCandidates`/`nestingParentOf` 内部消费 + `tests/project-tree-nesting.test.mjs` 判据；对外链路 `src/projectTreeModel.ts:4` → `FileTree.vue` → 齿轮 → `ToolWindowView.vue`（既有）。
- `visit/canExpandRecursively/expandRecursively`：`src/components/FileTree.vue:202,250` → `src/toolViewContext.ts:183-184` → `ToolWindowView.vue:208` 的「递归展开」按钮（活的那一条）。
- `normalizeNestingRules`：`updateNesting`（设置页「确定」）与 `readNestingRules`（存档回读）两个入口，消费点 `FileTree.vue:50` + `FileNestingSettings.vue`。
- 已知在途死线（**不是本轮造成、也没扩大**）：`onExpandAll` 只进 `ToolWindowView.vue:138` 的类型、没有渲染 —— 与上游一致：`ProjectViewExpandAllAction.kt:26-28` 在 registry `ide.project.view.replace.expand.all.with.expand.recursively`（默认 **true**）时把 `isVisible` 置 false，出厂就是「用递归展开替掉全部展开」。本轮没有为它画假按钮。

## 7. 需要主代理接的线（升档 / 订正请求，paste-ready）

`scripts/verdict_table.py` 与 `docs/inventory/*.md` 是保留文件，我一个字没改。请求另放
`docs/wiring-requests-2026-10-06-ptree3.md`（R1…R4 的 old/new 原文都在那里）。摘要：
- **R1** `pv/project-view-nodes`：把「可编辑的嵌套规则」从「缺」移进「本仓已有」。
- **R2** `pv/project-view-nodes`：把「压缩目录 `ProjectView.CompactDirectories`」记进「本仓已有」，并与「包视图 flatten」分开写。
- **R3** `pv/project-view`：把「`MarkRootGroup`/`MarkAsContentRootAction` 缺、项目树右键没有 Mark Directory As」改成「已有，挂点在 `src/App.vue:2461-2463`」（上游坐标由对应桶补，我未开那条文件）。
- **R4** `pv/project-view`：`src/projectTreeState.ts` 的括注「折叠状态持久化」是**事实错**，该文件是设置持久化；折叠持久化若另有落点请改指那个文件。
- **R5** `pv/structure-view`：把「autoscroll to/from source 两个开关」与「`VisibilitySorter` 族（只有名称与种类两档）」两条从「缺」移进「本仓已有」。

## 8. 做不到 / 无法核实 / 发现但没做（具体卡点）

1. **无法核实**：上游「出厂嵌套规则表」。`addFileNestingRules` 的实现在本地树里 **0 条**（`grep -rln` 只命中接口 `platform/lang-api/src/com/intellij/ide/projectView/ProjectViewNestingRulesProvider.java` 与 `ProjectViewFileNestingService.java`），EP 声明在 `platform/lang-api/resources/intellij.platform.lang.xml:177` ⇒ 条目由未随源码发布的插件贡献。本仓 `DEFAULT_NESTING_RULES` 因此仍按帮助页例子写，模块头已注明。
2. **无法核实（来源声明）**：`src/projectTreeNestingDialog.ts:26-27` 与 `src/projectTreeCompactDirs.ts:10-12` 说中文文案「取自 `plugins/localization-zh/lib/localization-zh.jar`」，而 `plugins/` 下**没有 localization 相关目录**（实测 `ls plugins/ | grep -i localization` 空）。本轮**没有**改这三条中文串：改串要动 `src/components/FileNestingSettings.vue` 的渲染文案并牵动 `tests/project-tree-appearance.test.mjs:257`，两者都不在我可改面。按规约的正确写法是直译上游英文并在注释注明来源，英文原文我已核到：`platform/lang-api/resources/messages/LangBundle.properties:149-151`（三条 `dialog.message.*`）与 `platform/platform-api/resources/messages/IdeBundle.properties:492-495`（对话框标题、复选框、表题、重置按钮）。⇒ 留给主代理决定改谁的文件面。
3. **核对后判「不改」**（留痕，免得下一轮再当成缺）：`BY_TYPE` 时目录是否恒在文件之前。判词与本仓实现都对：Project 窗格用的是 `platform/lang-impl/src/com/intellij/ide/projectView/impl/nodes/PsiDirectoryNode.java:410-412` —— `settings.isFoldersAlwaysOnTop() ? NodeSortOrder.FOLDER : super…`（`super` 见 `platform/lang-api/src/com/intellij/ide/projectView/ProjectViewNode.java:287-289` 返回 `MANUAL`/`UNSPECIFIED`），那条「BY_TYPE 也给 FOLDER」的写法在 `ScopeViewTreeModel.java:753-757`，**只作用于 Scope 窗格**（`ScopeViewPane.java:184` 才 new 它）。`GroupByTypeComparator.java:42-44` 先比 `getSortOrder`、`:53-65` 的权重步也 gated 在 `isFoldersAlwaysOnTop()`。所以 `tests/project-tree-behavior.test.mjs:16-20` 那条「folder grouping is independent of type sorting」钉的是对的，我没动它。
4. **发现但没做（预算）**：`collapseAll()` 把项目根行（`path === ''`）也一并收起（`src/projectTreeModel.ts:232-240` 的 `expanded.clear()`）。上游 `DefaultTreeExpander.kt:49-59` 的 `collapseAll(tree, 1)` 保留第一层（`TreeUtil.java:1102` 的 `keepSelectionLevel` 一路）。改法很小（清完把根重新 `add('')`），但要先确认 `tests/project-view-behavior.test.mjs` 里没有钉住旧形状 —— 本轮没跑这条改动。
5. **没做**：`pv/project-view` 的多窗格、`CustomizeTreesAction`、预加载与性能面板；`pv/command` 的全局撤销。四者的落点都在保留文件（`App.vue`/`bridge.ts`/`ToolWindowView.vue`），本轮按派单只写请求不接线。
6. **主代理在修的首屏崩溃**：本轮三条都不需要新挂点，`src/App.vue` 未改；C2 走的既有 `ctx.canExpandRecursively()`/`onExpandRecursively()` 链路。

## 9. 行号勘误（写完 §1-§2 后逐个 `grep -n` 复核，以本节为准）

正文里几处「区间」写法是我按编辑顺序估的，下面这组是**实测行号**（`grep -n` 的输出），引用时用它：

| 符号 | 实测位置 |
|---|---|
| `nestingRoleOf` | `src/projectTreeNesting.ts:121` |
| `nestingRulePairs` | `src/projectTreeNesting.ts:135` |
| `parentCandidates` | `src/projectTreeNesting.ts:184` |
| `nestSiblings` | `src/projectTreeNesting.ts:217` |
| `matchNamePattern` | `src/projectTreeNesting.ts`（在 `nestingRoleOf` 之上，同文件；正文写的 `:88-120` 是估的） |
| `canExpandRecursively` | `src/projectTreeModel.ts:147` |
| `visit`（批量展开那一趟） | `src/projectTreeModel.ts:254` |
| `expandRecursively` | `src/projectTreeModel.ts:277` |
| `normalizeNestingRules` | `src/projectTreeState.ts:64` |
| `normalizeNestingRules` 的两个入口 | `src/projectTreeState.ts:104`（存档回读）与 `:146`（`updateNesting`） |

⇒ §7 与 `docs/wiring-requests-2026-10-06-ptree3.md` 里出现的 `src/projectTreeNesting.ts:145-176`／`:214-227`／`:131-138`、`src/projectTreeState.ts:50-93`/`:109`/`:141`、`src/projectTreeModel.ts:241-266`/`:271-275` 一律按上表替换（判词文本里的**符号名**不变，只有区间以本节为准）。
`src/projectTreeNestingDialog.ts:44,58,79,86`、`src/components/FileNestingSettings.vue:51-54`、`src/components/FileTree.vue:50`、`src/treeActions.ts:156-184`、`src/structureFollow.ts` 各条、`tests/*` 各条都是读文件时抄的实际行号，不在勘误范围内。

临时件已清：`build/ptree3-back/`（注入反向验证用的三份备份）与 `.tmp-ptree3-tsc.txt` 都已删除。
