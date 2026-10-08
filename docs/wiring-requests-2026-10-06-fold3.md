# 接线 / 判词请求 2026-10-06 · 代号 `fold3`（折叠域）

本批不改任何保留文件。R 段 = 判词升档/订正（`docs/inventory/*.md` 与 `scripts/verdict_table.py` 都归主代理）；
W 段 = 宿主侧接线（`src/App.vue`、`src/components/*.vue`、`src/settingsModel.ts`、`native/*` 归主代理 / 相应域代理）。
每条都给「条目原文（在哪一行）→ 新档位 → 证据坐标 → 要改的那一行」。

先记一条**文件归属事实**（省得主代理改错文件）：`docs/inventory/verdict-folding.md` 是**手写**判决
——里面有 `## G. 逐条总表`（该行在 `docs/inventory/verdict-folding.md:133`），而
`scripts/verdict_table.py:940` 的生成器遇到含这段标题的文档就拒绝覆盖（除非 `--force`）。
所以本域逐条表里的档位**只能直接改 md**；而 `verdict-platform_rest.md` / `verdict-find-diff.md` 这类
由 py 生成的族，要改的是 py 里那条 tuple（否则下次生成会被覆盖回去）。

## R-1 `lp/custom-folding`：`[~]` → `[x]`

- **条目原文位置**：`scripts/verdict_table.py:312`（tuple `"lp/custom-folding": ("~", …)`，产物在
  `docs/inventory/verdict-platform_rest.md:325`；族映射在 `scripts/verdict_table.py:587`）。
- **原文结尾那句「缺」**：`缺：CustomFoldingRegionsPopup/GotoCustomRegionAction（区域列表与上/下一个区域）；CustomFoldingSurroundDescriptor（用标记包围选区）；按 provider 的标记配置面`
- **新档位**：`x`。
- **证据坐标（本仓）**：`src/customFoldingPopup.ts`（弹层 + 上/下一个区域，152 行）、`src/customFoldingRegions.ts:111-138`（排序与层数缩进）、`src/customFoldingSurround.ts:48-71`、`:123-131`（用标记包围选区 + 三个 provider 各一条）、`src/customFoldingProviders.ts:133-152`、`:157-185`、`:197-203`。判据：`tests/editor-custom-fold-regions.test.mjs`、`tests/folding-custom-region-providers.test.mjs`、`tests/folding-custom-region-surround.test.mjs`、`tests/folding-region-navigate.test.mjs`。
- **证据坐标（上游）**：`platform/lang-impl/src/com/intellij/lang/customFolding/CustomFoldingRegionsPopup.java`、`GotoCustomRegionAction.java`、`platform/lang-impl/src/com/intellij/lang/folding/CustomFoldingSurroundDescriptor.java`。
- **要改的那一行**：`scripts/verdict_table.py:312` 把 tuple 第一个元素 `"~"` 改成 `"x"`，并把结尾那句「缺：…」换成「已做：区域列表弹层 / 上一下与下一个区域 / 用标记包围选区；剩下的只有 `按 provider 的标记配置面`（上游没有那一页，判 `[-]`）」。
- **「要改的 py 行」写法**：整行替换（行号 312，单行 tuple）。

## R-2 `BaseFoldingHandler` / `CollapseAllRegionsAction` / `ExpandAllRegionsAction`：`[~]` → `[x]`

- **条目原文位置**：`docs/inventory/verdict-folding.md:184`、`:185`、`:191`（手写 md）。
- **原文的「缺」**：三行都写 `缺 getFoldRegionsForSelection（带选区时"全部收起/展开只作用于选区内的区间"）`。
- **新档位**：`x`（选区作用域与两段式退化都已落；`:185` 行里那段「两段式退化成一段」的分析仍然成立、原样保留）。
- **证据坐标（本仓）**：`src/editorFolding.ts:645`（`selectionScoped`，消费方 `:659` `foldAllCommand`、`:676` `unfoldAllCommand`）+ 判据 `tests/folding-selection-scope.test.mjs:60-71`、`:96-134`。
- **证据坐标（上游）**：`platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/BaseFoldingHandler.java:44-56`（有选区时「搭界 且 整条在选区里」，一条都没有就 `getAllFoldRegions()`）。
- **要改的那一行**：md 的 184/185/191 三行：`[~]` → `[x]`，并把「**缺** …」那句换成「已落：选区作用域走 `selectionScoped`」。表尾四档计数在 `docs/inventory/verdict-folding.md:207`，三条同升 ⇒ `[x]` 3 → 6、`[~]` 37 → 34（该行的数字也要跟着改，`tests/b4-verdict.test.mjs` 的门禁 4「四档计数自洽」会盯着它）。

## R-3 `UpdateFoldRegionsOperation`：`[~]` → `[x]`

- **条目原文位置**：`docs/inventory/verdict-folding.md:180`；同一条还写在 §C⑤ 结尾 `docs/inventory/verdict-folding.md:85-86`（「仍缺：`ApplyDefaultStateMode` 的另外两种模式、`getFoldRegionsForSelection`」）。
- **新档位**：`x`。
- **理由与证据**：三档里 `EXCEPT_CARET_REGION` 与 `NO` 是本仓有消费者的两档 ——
  前者：`src/editorFolding.ts:813`（`unfoldIntersecting`）+ `src/editorFoldingController.ts:126`（`applyNavigation`，管道 ⑦）；
  后者：**本批新落** —— `src/editorFoldingController.ts:82-95`（重算轮次只展开"关着的那一族"，不再按默认折）+ `:50`（`builtFor`）+ `:169`（真拿到区间才打标记），判据 `tests/folding-navigate-unfold.test.mjs:139-181`。
  `YES` 在社区树里没有调用方：`platform/foldings/src/com/intellij/codeInsight/folding/impl/FoldingUpdate.java:154-156` 只在 `NO` 与 `EXCEPT_CARET_REGION` 之间选 ⇒ 判 `[-]` 附理由。
  `getFoldRegionsForSelection` 见 R-2。
- **要改的那一行**：md:180 的档位与「**缺** …」段；md:85-86 那句「仍缺」整段划掉（改成「已落，见 §G 该行」）。

## R-4 `CodeFoldingManager` / `CodeFoldingManagerImpl`：`[~]` → `[x]`（或把「缺」改成具体缺口）

- **条目原文位置**：`docs/inventory/verdict-folding.md:155`、`:156`（镜像行 `docs/inventory/verdict-editor.md:1289`、`:1291`）。
- **原文的「缺」**：`缺按偏移查询折叠区间这类公开面`。
- **核对结果**：**这一句已经不成立** —— 公开面都在：`src/editorFolding.ts:274`（`areasContaining`，含端点 + 起点降序，逐条对应 `FoldingUtil.java:46-58`）、`:392`（`enclosingAreas`）、`:475`（`foldedAreasOf` ↔ `CodeFoldingManager.saveFoldingState`）、`:480`（`candidatesOf` ↔ `isCollapsedByDefault` 的入参）、`:258`（`isCollapsedIn` ↔ `FoldingUtil.java:69-72` 的用途那一半）；调度面 ↔ `src/editorFoldingController.ts` 的 `schedule`/`run`/`capture`/`restore`（`updateFoldRegionsAsync` ↔ `schedule`、`releaseFoldings` ↔ `dispose`）。
- **新档位**：`x`，或保留 `[~]` 但把「缺」换成剩下的那一件：`isHighlighterFolded`（`FoldingUtil.java:60-67`，读 `RangeHighlighterEx` 的 affected-area 偏移 —— 本仓没有 markdown/注入高亮那一层 ⇒ 建议改判 `[-]`，见 R-5）。
- **要改的那一行**：md:155/156（+ 镜像的 verdict-editor.md:1289/1291）。

## R-5 `FoldingUtil` 行的「缺」换掉（`isHighlighterFolded` 应判 `[-]`）

- **条目原文位置**：`docs/inventory/verdict-folding.md:182`。
- **建议改法**：保留 `[~]`（其余函数有落点），把「**缺** `isHighlighterFolded`（`:60-67`，依赖 markdown highlighter 那一层）与 PSI 版重载」改成「`isHighlighterFolded` 与 PSI 版重载 ⇒ `[-]`：上游那两个重载的入参是 `RangeHighlighterEx`/`PsiElement`（`FoldingUtil.java:60-67`），本仓既无注入高亮也无 PSI」。
- **同批要顺手订正的一处措辞**：该行把 `isCollapsedIn` 对到 `isTextRangeFolded:69-76`，实际行号是 `:69-72`（文件只有 121 行）；`createFoldTreeIterator` 是 `:77-119`（原文写的 `:77-` 没问题）。

## R-6 `DocumentFoldingInfo` 行：时间戳那一半的判词要写准

- **条目原文位置**：`docs/inventory/verdict-folding.md:166`（镜像 `:71-72` 的 §C③ 结尾句）。
- **原文的「缺」**：`缺上游用文件时间戳挡"磁盘上改过"（:333 的 date != …），本仓用轻签名当替身`。
- **核对结果**：上游那道闸**只管手工区间那一半** —— `DocumentFoldingInfo.java:314-341`：`date` 在 `MARKER_TAG` 那一支才问（`:326-335`，还叠加 `isDocumentUnsaved`），`ELEMENT_TAG`（按元素签名存的）不看日期。本仓对**每一档**都验「偏移 + 起点整行原文」（`src/editorFoldingState.ts:205-228` 的 `restorePlan`：偏移与签名都对得上才原处放回，否则拿签名去候选里认回，认不回就放弃）⇒ 替身比上游那道闸更细，不是"缺"。
- **建议**：`[~]` → `x`，「缺」改成「时间戳那一档的替身是逐条轻签名（更强的判据），前端拿不到 mtime（见 `src/editorFoldingState.ts` 文件头）」；如果主代理要的是**真 mtime**，那需要原生侧把文件 mtime 随 `foldingState` 一起回，属新设置键 ⇒ 走 W-3。

## R-7 `CodeFoldingSettings` / `CodeFoldingSettingsImpl` 那三个键（要么给宿主，要么钉 `[-]`）

- **条目原文位置**：`docs/inventory/verdict-folding.md:153`、`:154`（镜像 `docs/inventory/verdict-editor.md:1229`）。
- **现状**：判词的「本仓没有语言侧 builder ⇒ 设置页不渲染这三行」是**对的**，三条键（`COLLAPSE_METHODS` / `COLLAPSE_FILE_HEADER` / `COLLAPSE_DOC_COMMENTS`）在上游只被语言侧 builder 读（`java/java-psi-impl/src/com/intellij/codeInsight/folding/impl/JavaCodeFoldingSettingsBase.java:67`、`:106`、`:116`），上游 LSP 路径对它们传 null（`platform/lsp-impl/src/impl/features/folding/LspFoldingBuilder.kt:41-46`）⇒ 渲染出来就是没有消费方的空壳（规约 §3）。
- **建议**：把这两行的「缺」改成 `[-]` 附上述理由（档位仍留 `[~]`，因为前两条键是 `[x]` 的）。
- **如果产品要这三行**：那是**新设置键**，本批给不出可照抄的实现（要同时动 4 个保留文件），需要主代理按这个顺序落：
  `native/settings_schema.hpp` 的 `EDITOR_SETTING_KEYS` → `native/settings_schema.cpp` 的 `editor_defaults_impl()`（默认值照 `platform/core-api/src/com/intellij/codeInsight/folding/CodeFoldingSettings.java:7-11`）→ `src/settingsModel.ts` 的 `EditorSettings` + **旧存档缺键补默认**（不许按键数判损坏）→ `src/editorFoldingSettings.ts` 的 `FOLDING_SETTING_ROWS`/`autoCollapseKinds` → `src/components/CodeFoldingSettingsPage.vue` 的复选框。
  注意：`autoCollapseKinds` 现在只映射 `imports`/`region`，判据 `tests/editor-folding-settings.test.mjs:23-32` 钉死了「comment 不映射」，加行要一并改那几条断言并给上游理由。

## R-8 控制台折叠那一批的证据句是错的（`[ ]` 的取证语句要订正）

- **条目原文位置**：`docs/inventory/verdict-settings-run.md:867`（`ConsoleFolding`）、`:1579`（`ConsoleFoldingSettings`）、`:1592`（`CustomizableConsoleFoldingBean`）、`:1597`（`FoldLinesLikeThis`）、`:1607`（`SubstringConsoleFolding`）、`:2515`（`WslDistributionConsoleFolding`），以及 `:298`–`:300`（`StackTraceFolding*`）。
- **原文的证据句**：`X 在本仓 src/+native/ 的真实代码与注释里都从未出现`、`缺：控制台折叠/超链接/过滤（src/consoleFold.ts/src/runHyperlinks.ts 无对应）`。
- **核对结果**：`src/consoleFold.ts:1-45` **存在且被运行面板消费**（`foldConsoleLines`：连续重复且命中折叠规则的行合并成一条带 `×N`，设置里的两族规则/例外也在那里）⇒「从未出现」这句对 `ConsoleFolding` 一族是**取证口径错了**（它扫的是类名而不是功能名）。
- **建议**：这六行的档位维持 `[ ]`（用户可见面确实只做了"连续重复行合并"那一档），但证据句换成「本仓已有 `src/consoleFold.ts` 的连续重复合并；还差：`FoldLinesLikeThis`（右键"折叠类似的行"）、`SubstringConsoleFolding` 的按子串分组、`ConsoleFoldingSettings` 的持久化键、控制台视图里的 fold region 宿主」。`WslDistributionConsoleFolding` 与 `StackTraceFolding*` 属于 WSL/Java 运行栈那一族，本仓无宿主 ⇒ 建议 `[-]` 并给具体理由。
- **要改的那几行**：md 的 867、1579、1592、1597、1607、2515、298-300（若该文档由 py 生成，则改 `scripts/verdict_table.py` 里对应 tuple；本批没有核实到那一族的 py 条目键名，**不写行号以免编造**）。

## W-1 编辑器内 hint + 重叠确认框（折叠选区那一族的最后两处宿主）

- **落点**：`src/components/CodeEditor.vue`（hint 通道）与 `src/App.vue`（模态框）。
- **模块侧已经给好的出口**（可直接照抄）：`src/editorFolding.ts:686`（`CANNOT_REMOVE_AUTOGENERATED_REGION`，文案取自中文包）、`:692`（`foldSelectionOutcome`：`autogenerated` / `overlapping` 两档要提示）、`:732`（`collapseSelectionAfterOverlapConfirm`：用户按「确定」之后要做的那一步）。
- **上游依据**：`platform/foldings/src/com/intellij/codeInsight/folding/impl/CollapseSelectionHandler.java:39-45`（`:44` 是那条 `HintManager.showInformationHint(..., "collapse.selection.existing.autogenerated.region")`，即"不许移除自动生成的区域"的提示）与 `:49-58`（`Messages.showDialog(…, {OK, CANCEL}, 1 /* 默认 CANCEL */, WARNING)`，返回值不是 0 就 return）。
- **要求**：默认按钮必须是「取消」（与本仓 `foldSelectionOutcome` 的 `overlapping` 那一档同果）；按「确定」才调 `collapseSelectionAfterOverlapConfirm`。
- 与上一批 `docs/wiring-requests-2026-10-06-folding.md` 的 W-6/W-7 不冲突（那两条是"无区域提示"与 `preparePlaceholder`）。

## W-2 折痕占位文字接上之后，「折叠代码块」要显示 `{...}`

- **落点**：`src/components/CodeEditor.vue` 的 `codeFolding({ preparePlaceholder })`（即上一批的 W-7）—— 先接 W-7，本条才有消费方。
- **上游依据**：`platform/foldings/src/com/intellij/codeInsight/folding/impl/CollapseBlockHandlerImpl.java:55`（`model.addFoldRegion(start, end, getPlaceholderText())`）+ `:82`（`protected @NotNull String getPlaceholderText() { return "{...}"; }`）；对照 `platform/foldings/src/com/intellij/codeInsight/folding/impl/UpdateFoldRegionsOperation.java:162`（builder 建的那些才是 `placeholder == null ? "..."`）。社区树里唯一的实现 `java/java-impl/src/com/intellij/codeInsight/folding/impl/JavaCollapseBlockHandler.java` 没有覆盖 `getPlaceholderText` ⇒ Java 走的就是 `{...}`。
- **本批为什么没做**：CodeMirror 的 `foldEffect` 不带占位文字，唯一出口是 `preparePlaceholder`（宿主未接 ⇒ `foldPlaceholderFor`（`src/editorFolding.ts:854`）现在只被测试消费）。要让"块折叠"显示 `{...}` 就得再挂一个 StateField 记录折痕来源，而它此刻**没有任何生产消费方** ⇒ 按规约 §3 不做假链路。W-7 落地后：`foldBlockAtCaret` 记一条"这条折痕来自 fold.block"，`foldPlaceholderFor` 认出它就返回 `{...}`（`applyAreas` 那一步在同文件，改动量很小）。

## W-3 （可选，R-6 的另一条路）真 mtime 而不是轻签名

- **落点**：`native/` 把文件 mtime 随项目设置里的 `foldingState` 一起回，前端在 `src/editorFoldingState.ts` 的 `importFoldState`/`restorePlan` 处比较。
- **上游依据**：`platform/foldings/src/com/intellij/codeInsight/folding/impl/DocumentFoldingInfo.java:314-341`（`date` 只在 `MARKER_TAG` 那一支问，`:333` 那一条还叠加 `isDocumentUnsaved`）。
- **代价与建议**：R-6 已经说明本仓的逐条轻签名比上游那道闸更细；加 mtime 要新键、要"旧存档缺键补默认"、还要跨 native ⇒ **建议不做**，只订正判词。列在这里是为了「做不到/无法核实」那条有出口。

## 处理结果（wiring-backlog lane，2026-10-06）

- **R-1..R-8** —— 判词（`docs/inventory/*` / `scripts/verdict_table.py`），非本 lane。
- **W-1（编辑器内 hint + 重叠确认框）** —— 目标 `src/components/CodeEditor.vue`（禁改清单）+ `src/App.vue`（本 lane）。因确认框宿主在 CodeEditor 内，需 CodeEditor owner。
- **W-2（折痕占位文字）** —— 目标 `src/components/CodeEditor.vue`（禁改）。需 CodeEditor owner。
- **W-3** —— 可选。

结论：零接线（挂点全在 CodeEditor / 判词）。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「零接线（挂点全在 CodeEditor / 判词）。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
