# 批次报告 · 2026-10-06 · 代号 `vcslog2`（Git 日志面 · §C 图形/日志族的模块侧缺项）

上游唯一真源：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（未上网、未截图）。
本批只动了 `src/vcsLogGraph.ts`、`src/vcsLogGraphOptions.ts` 与新增的 `tests/vcs-log-graph-cells.test.mjs`；
组件/判词文件一律没改。

## 0. 先纠两条假坐标（留痕：原写 X、实际 Y）

| 派单给的候选坐标 | 实际核实结果 | 本批改用（逐行开过） |
|---|---|---|
| `plugins/git4idea/src/git4idea/ui/GitGraphPanel.java` | **不存在**：参考树里 `plugins/git4idea/` 下只有 `backend`/`frontend`/`shared`/`localHistory`/`rt`/`resources`/`tests`… 没有 `src/git4idea/ui/` 这一层；全树 `find -iname GitGraphPanel*` = 0 命中 | 图形单元的真身是 PrintElement 一族：`platform/vcs-log/graph-api/src/com/intellij/vcs/log/graph/PrintElement.kt:7-12`（行、`positionInCurrentRow`、颜色、选中）、`.../EdgePrintElement.kt:4-21`（`positionInOtherRow:5`、`Type(UP/DOWN):11-14`、`LineStyle(SOLID/DASHED/DOTTED):16-20`、`hasArrow():9`）、`.../NodePrintElement.java:7-17`（`FILL/OUTLINE/OUTLINE_AND_FILL:14-16`） |
| `platform/vcs-log/impl/src/com/intellij/community/components/graph/GraphCellProvider.java` | **不存在**：全树 `find -name "*CellProvider*"` = 0 命中；`com/intellij/community/` 只出现在 `python/python-exec-service/tests/` 下 | 生成侧 `platform/vcs-log/graph/src/com/intellij/vcs/log/graph/impl/print/PrintElementGeneratorImpl.kt:126-173`（一行的单元）与 `:246-268`（行内元素集合）、`.../elements/EdgePrintElementImpl.kt:43-48`（边型→线型）、`.../elements/TerminalEdgePrintElement.java:11-17`（终端单元两列同值 + `hasArrow=true`）、渲染侧 `platform/vcs-log/impl/src/com/intellij/vcs/log/paint/SimpleGraphCellPainter.kt:147-170`（线）/`:172-187`（点）、HEAD 换头节点 `platform/vcs-log/impl/src/com/intellij/vcs/log/ui/table/GraphTableModel.kt:97-117` |

顺带纠正本仓两条旧断言：
· `src/vcsLogGraph.ts` 旧注释写「端点之间那条跨行的边 = 本仓用同一车道穿过中间行的竖线表示」—— **与代码不符**：中间提交被过滤后父哈希不在可见列表里，那条边整条不画（实测：折叠后两行 `down=[]`、`up=[]`）。已在本批改掉并补上虚线跨度边。
· `src/vcsLogGraphOptions.ts` 旧注释写分支操作组在 `VcsLogGraphOptionsChooserGroup.java:71` —— 亲测该行是 **`:72`**（`actions.add(ActionManager.getInstance().getAction(VcsLogActionIds.BRANCH_ACTIONS_GROUP));`）。两个坐标都留在文里：改 `:71` 会让 `docs/inventory/citation-anchors.json` 的锚点报 `moved`，而重算快照会连带改掉别人在途的锚点，12 路并行时不该由我发起。

## 1. 判词表（§C 图形/日志族逐条核现状；判定 = 本批**核实后的真状态**）

| 族 / 项 | 判词 | 核实判定 | 上游 `相对路径:行号` | 本仓落点 `文件:行号` | 一句话 |
|---|---|---|---|---|---|
| 图折叠 · `CollapseGraphAction` | `[ ]` | **`[x]` 已做 → 请升档** | `platform/vcs-log/impl/src/com/intellij/vcs/log/ui/actions/CollapseGraphAction.java:11-32` | `src/vcsLogGraph.ts:277`(`collapsedLinearHashes`)、`:297`(`canCollapseLinearBranches`)、`:302`(`collapseLinearBranches`)；`src/vcsLogGraphOptions.ts:206-221` 菜单行 | 收起 = 只把线性链的中间提交隐掉（上游 `hideNode`，`CollapsedActionManager.java:230`） |
| 图折叠 · `ExpandGraphAction` | `[ ]` | **`[x]` 已做 → 请升档** | 同上 `ExpandGraphAction.java:11-32`；动作体 `CollapsedActionManager.java:199-212`（`removeAdditionalEdges` + `resetNodesVisibility`） | `src/vcsLogGraphOptions.ts:216-219`（`expand` 行，`disabled: !state.collapsed`）、`src/vcsLogGraph.ts:302`（`collapsed=false` 逐字返回原列表） | 展开 = 逐字回到原列表，判据 `tests/vcs-log-presentation.test.mjs:224` |
| 图折叠 · `CollapseOrExpandGraphAction` | `[ ]` | **`[~]` 部分 → 请升档**（本批补一半） | `platform/vcs-log/impl/src/com/intellij/vcs/log/ui/actions/CollapseOrExpandGraphAction.java:44-48`（`isActionSupported` 才执行）、`:51-69`（可见/可点 + **文案随 `GRAPH_OPTIONS==LinearBek` 换**）、`:78-90`（进度条长动作） | 本批新增 `src/vcsLogGraphOptions.ts:113-130`(`collapseActionTitles`)、`:97-111`(`graphDisplayOptions`)；`:206-221` 两行吃这一份 | 本批接住"文案随显示档换"；**还差**：上游那条进度条（本仓折叠是同步一页计算，无宿主 ⇒ 只在模型里留 `process` 字段，不渲染假浮层） |
| 图折叠 · 「折叠已合并分支」一族（判词表里没有单列，属 `CollapseGraphAction` 的第二标题） | — | **`[x]` 本批新增** | `platform/vcs-log/impl/resources/messages/VcsLogBundle.properties:33-35,40-42`（`action.process.expanding.merges`/`description.expand.merges`/`title.expand.merges`/`process.collapsing.merges`/`description.collapse.merges`/`title.collapse.merges`）；换字判据 `CollapseOrExpandGraphAction.java:58-67` | `src/vcsLogGraphOptions.ts:77-82` 六个常量 + `:120-130` 求值 | LinearBek 出厂关（`BekUtil.java:13-15`）⇒ 默认仍走「收起线性分支」，判据测两种档都核 |
| 折叠的**虚线跨度边**（`GraphEdgeType.DOTTED`） | 判词表未列（§E 第 2 条把 `graph/test` 那 38 条整族判 `[-]`） | **`[x]` 本批新增**（原判词「本仓无折叠中间表示」不成立） | `platform/vcs-log/graph/src/com/intellij/vcs/log/graph/collapsing/CollapsedActionManager.java:214-241`（`:231` `createEdge(..., DOTTED)`）、`.../api/elements/GraphEdgeType.java:18-24`（`DOTTED(true)` ⇒ 普通边，照常穿中间行）、`.../impl/print/elements/EdgePrintElementImpl.kt:43-48`（DOTTED ⇒ **DASHED**） | `src/vcsLogGraph.ts:94-99`(`collapsedSpans` 选项)、`:144-150`(跨度边进边表，`style:'dashed'` 在 `:149`)、`:286-295`(`collapsedLinearSpans`)、`:314-319`(`collapseLinearGraph`) | 折叠后两端之间真的有一条虚线了；判据 `tests/vcs-log-graph-cells.test.mjs:51-67` |
| 显示档 · `ShowLongEdgesAction` | `[ ]` | **`[x]` 已做 → 请升档** | `platform/vcs-log/impl/src/com/intellij/vcs/log/impl/MainVcsLogUiProperties.java:16`；动作 `platform/vcs-log/impl/src/com/intellij/vcs/log/ui/actions/ShowLongEdgesAction.java`（纯勾选） | `src/vcsLogGraph.ts:104`(选项)、`:153-158`(关档只留竖线)；`src/vcsLogPresentation.ts:31-33,130-134` | 判据 `tests/vcs-log-presentation.test.mjs:200-211` |
| 行内图形单元 · `PrintElementGenerator` / `PrintElementGeneratorImpl` / `EdgePrintElementImpl` / `NodePrintElement` / `EdgePrintElement` / `SimpleGraphCellPainter` / `TerminalEdgePrintElement` | 判词全表 `[-]`（理由统一写「IDE 内部 VCS 日志抽象层，无独立可见行为」） | **`[~]` 部分 → 请升档**：这一族的**用户可见部分**（每行的列、竖线 vs 弯线、终端箭头、HEAD 空心圈、虚线）本批已在模块里等价实现 | 上面 0 节那批真路径（`PrintElement.kt:7-12`、`EdgePrintElement.kt:4-21`、`NodePrintElement.java:7-17`、`PrintElementGeneratorImpl.kt:126-173`/`:175-190`/`:246-268`、`SimpleGraphCellPainter.kt:147-187`、`GraphTableModel.kt:97-117`） | `src/vcsLogGraph.ts:42-78`(线型/形状/`GraphEdgeUnit`/`GraphUnit`/`CollapsedSpan`)、`:170-228`(`rowLanes` + `graphUnitsOfRows`)，`buildLogGraph` 返回值新增 `units` | 「Swing 自绘构件本体」那一堆仍成立 `[-]`；但**数据形状不是** Swing 专属 ⇒ 判词该按可见行为拆出来 |
| 按图谱显示（`NO_GRAPH_INFORMATION` 那一条真档） | 判词表未列 | **`[x]` 本批新增**（**不是**新勾选：由数据决定，与上游同一判据） | `platform/vcs-log/impl/src/com/intellij/vcs/log/ui/table/GraphTableModel.kt:97-100`（`emptyList()`）、`visible/VisiblePack.kt:80`（键）、`history/FileHistoryFilterer.kt:243`（置位） | `src/vcsLogGraph.ts:103-108`(`graphInformation` 选项)、`:186-195`(`graphUnitsOfRows` 的 `if (!graphInformation)`) | 关档 = 每行一个单元都不给（不是只画一个孤点）；判据 `tests/vcs-log-graph-cells.test.mjs:112-118` |
| `CompactReferencesViewAction` | `[ ]` | **`[x]` 已做 → 请升档** | `platform/vcs-log/impl/src/com/intellij/vcs/log/ui/actions/CompactReferencesViewAction.java`；渲染 `ui/render/GraphCommitCellRenderer.kt:133-136` | `src/vcsLogPresentation.ts:195-199`(`logRefsToShow`) + `src/components/VcsLogTable.vue:36-39` | 判据 `tests/vcs-log-presentation.test.mjs:200` 前后那两条（紧凑只给第一个） |
| `AlignLabelsAction` | `[ ]` | **`[x]` 已做 → 请升档** | `ui/actions/AlignLabelsAction.java`；`GraphCommitCellRenderer.kt:143-146` 的 `setLeftAligned` | `src/vcsLogPresentation.ts:34-36,135-140` + `src/components/VcsLogTable.vue:140-153` | 引用进独立左对齐列 |
| `ChangeDiffPreviewLocationActions` | `[ ]` | **`[x]` 已做 → 请升档** | `ui/actions/ChangeDiffPreviewLocationActions.kt`（`Layout.DiffPreviewVerticalSplit`） | `src/vcsLogPresentation.ts:37-42,159-176`；持久化 `src/components/VcsLog.vue:122`(`viewPrefKeys`) | 底部/右侧两档，缺省底部 |
| `ShowChangesFromParentsAction` | `[ ]` | **`[x]` 已做 → 请升档** | `ui/actions/ShowChangesFromParentsAction.java`；`MainVcsLogUiProperties.java:20` | `src/vcsLogPresentation.ts:43-45,152-157` → `src/components/VcsLog.vue:244` → `src/components/VcsLogChanges.vue:10` | 消费链完整（`from-parents` 真传进变更树） |
| `ShowCommitTooltipAction` | `[ ]` | **`[x]` 已做 → 请升档** | `ui/actions/ShowCommitTooltipAction.java:37-45` | `src/vcsLogPresentation.ts:214-225`(`logCommitTooltip`) + `VcsLogTable.vue` 行 `title` | 判据 `tests/vcs-log-presentation.test.mjs`（tooltip 三行） |
| `VcsLogSpeedSearch` | `[ ]` | **`[x]` 已做 → 请升档** | `ui/table/VcsLogSpeedSearch.java:60-66`（只比可见的元数据列） | `src/vcsLogPresentation.ts:206-212` + `src/components/VcsLogTable.vue:54-60` | 判据「速度搜索只比可见的元数据列」 |
| `TwoStepCompletionProvider` | `[ ]` | **`[x]` 已做 → 请升档** | `ui/actions/TwoStepCompletionProvider.java:32,43-58`（`TIMEOUT=100` 的池线程轮询预算） | `src/vcsLogGoToRef.ts:63-78`（映射说明）、`:105-130`（两批候选真跑） | 另一批已落，本批只核实现 |
| `ShowCommitInLogAction` | `[ ]` | **`[x]` 已做 → 请升档** | `ui/actions/ShowCommitInLogAction.java`；`VcsLogNavigationUtil.jumpToGraphRow` | `src/vcsLogMenu.ts:106`（`jumpToGraphRow` 注释锚）+ `src/components/VcsLog.vue:183,187`(`focusHash`) | 从别处跳进日志并定位那一行 |
| `MultipleCommitInfoDialog` / `FileHistoryOneCommitAction` / `ShowAllAffectedFromHistoryAction` | `[ ]` | **本批未做**（落点在 `src/components/VcsLogDetails.vue`、`vcsLogMenu.ts` 的历史支与 native 侧，属别的文件面/需要宿主方法） | 见 `docs/inventory/verdict-vcs.md:90-92` | — | 不是"做不了"，是**不在本代理文件面**，留给主代理派 |
| `UpdateOptionsDialog` / `UpdateOrStatusOptionsDialog` | `[ ]` | `[-]` for 本批：落点在 `native/git.cpp` + `SourceControl.vue`（本代理无权） | `docs/inventory/verdict-vcs.md:77-78` | — | 同上 |

`docs/inventory/verdict-vcs.md:71-95` 那 17 条里，**图形/日志族有 13 条其实是已做或半做**（原判词 `[ ]`），本批另新增 3 项模块侧行为（虚线跨度边、行内图形单元、按图谱显示档）。升档请求（改 `docs/inventory/verdict-vcs.md` §C/§G 与 `vcs_verdict_table.json` 的具体行）列在 `docs/wiring-requests-2026-10-06-vcslog2.md` 末尾 —— 判词文件与 `scripts/verdict_table.py` 是保留文件，一律没改。

## 2. 改动文件清单（`wc -l` 前后）

| 文件 | 前 | 后 | 说明 |
|---|---:|---:|---|
| `src/vcsLogGraph.ts` | 170 | 352 | 行内图形单元（`GraphUnit`/`graphUnitsOfRows`）、折叠虚线跨度（`collapsedLinearSpans`/`collapseLinearGraph`/`GraphOptions.collapsedSpans`/`graphInformation`）、`GraphRow` 四条边数组加可选 `style`；`buildLogGraph` 返回值新增 `units`（`rows`/`width` 形状不变 ⇒ 现有 45 条域测试零改动全绿） |
| `src/vcsLogGraphOptions.ts` | 171 | 268 | `LogGraphDisplayOption`/`graphDisplayOptions`（`GRAPH_OPTIONS` 单值归一）、`collapseActionTitles` + 「折叠已合并分支」一族 6 个文案常量、`LogGraphOptionState.linearBek`、`LogGraphOptionRow.process`、`hasNonDefaultGraphOptions` 改吃归一结果（真值表与旧实现逐条等价） |
| `tests/vcs-log-graph-cells.test.mjs` | — | 186 | 新增 11 条判据（含 3 条边界用例） |
| `docs/wiring-requests-2026-10-06-vcslog2.md` | — | 90 | 3 条 paste-ready 接线请求 + 升档请求 |

`git diff --stat` 自查：`src/vcsLogGraph.ts` +310/-12、`src/vcsLogGraphOptions.ts` +145/-3，两个文件的 hunk 全在本批范围内；`git status` 只有上面两个新文件是 untracked，没碰别人的文件。

## 3. §5 自查命令的前后数字

| 命令 | 结果 | 归属 |
|---|---|---|
| `node --test tests/vcs-log-graph-cells.test.mjs` | 改前不存在；改后 **11 tests / 11 pass / 0 fail** | 本批 |
| 域测试合跑（`vcs-log-presentation` + `vcs-log-menu` + `vcs-log-filter-store` + `vcs-log-go-to-ref`） | 45 tests / 45 pass / 0 fail（连跑两次，改前形状未变） | 本域既有 |
| 域测试合跑（上面四个 + 新文件） | **56 tests / 56 pass / 0 fail** | 本批 |
| `npx vue-tsc -b --force` | 全仓 **1** 条错：`src/lspServerMessages.ts(280,1): error TS1128`（别人在途文件）；本域文件 **0** 条。注：本会话第一次跑时全仓 7 条错（`App.vue`/`refactorPreview.ts`/`semanticHighlighting.ts`/`lspServerMessages.ts`），都在别人的文件里，且在我这批改动之后自己消掉了 6 条 ⇒ 并行工作区里这个数是动的，不是本批造成的 | 非本域 |
| `node --test tests/module-size.test.mjs` | 5 tests / 4 pass / **1 fail**：`src/components/ProblemsPanel.vue(903 行)` 超 900 未登记 —— 组件文件，不属本代理文件面，**未替别人改**。本批文件 `src/vcsLogGraph.ts` 352 / `src/vcsLogGraphOptions.ts` 268，均远低于 900 ⇒ 没有新增超限，也没动任何上限 | 非本域 |
| `node --test tests/source-citations.test.mjs` | 3 tests / 2 pass / **1 fail**：18 条假引用全在别人的 `docs/batch-2026-10-06-{projecttree,status2,status2defect,welcome2}.md` 与 `docs/wiring-requests-2026-10-06-{vcs2,plugins}.md` 里（「参考树里没有这个文件」）。**本批四个文件单独核：55 条可核引用 / 0 条不成立**（用同一 `citationsOf`+`verifyCitations`+`refLineReader` 跑的，脚本临时执行、未落盘） | 非本域 |
| `node --test tests/source-citation-anchors.test.mjs` | 8 tests / 7 pass / 1 fail（失败的就是上面那条被 import 进来的老门控，同因）；「已入快照的每条引用区间内容必须仍一致」那条**绿**：`快照 1627 / 仓里活引用 2696-2702 / 未入快照 1069-1075 / 区间为空 3 / problems = []` ⇒ 本批没有把任何已锚引用改指别处（新增的都是 uncovered，不拦） | 本批干净 |
| `node .tools/find-param-props.mjs` | 0 处参数属性 | 绿 |
| `node .tools/find-ts-in-mjs.mjs` | 干净：tests/*.mjs 全部纯 JS（新测试文件无 TS 语法） | 绿 |
| `node .tools/find-missing-ext.mjs` | 扫描 1300 个文件，干净：没有漏扩展名 | 绿 |
| `node .tools/find-orphan-modules.mjs --gate` | 已登记孤儿 9 / 基线 9 · **新增 0** · 清掉 0 ⇒ 门禁绿 | 绿 |
| native | 本批没碰 `native/` ⇒ 未跑 ctest（无 .cpp 改动） | 不适用（具体理由：改动只在 `src/` 两个 .ts + `tests/` 一个 .mjs + `docs/` 两个 .md） |

## 4. 反向验证记录（注入 → 变红 → 撤掉 → 复绿）

1. **语义注入**（证明折叠虚线的判据真的会响）：把 `src/vcsLogGraph.ts` 里跨度边的 `style: 'dashed'` 改成 `'solid'`（1 处）。
   ⇒ `node --test tests/vcs-log-graph-cells.test.mjs`：**11 tests / 9 pass / 2 fail**
   （红的是「折叠必须把两端连起来：那条边是 DASHED」与「边界：链跑到页尾时折叠仍然连得上」）。
   撤掉（从临时备份复制回）⇒ **11 / 11 / 0** 复绿。备份文件用完即删（`build/*.bak` 已 `rm`）。
2. **引用注入**（证明引用门拦得住我写错的上游行号）：往 `src/vcsLogGraph.ts` 塞一条假坐标
   `platform/vcs-log/graph-api/src/com/intellij/vcs/log/graph/EdgePrintElement.kt :900-901`（那文件实际 21 行）。
   （**2026-10-06 citefix 订正**：这条假坐标与下一行的门禁原文，在 `.kt` 与行号之间**多了一个空格** —— 引用门会把交付文档里**转述**的「路径:行号」也当成一条真引用收集（规约 §5），
   注入实验的原始坐标照抄进文档 = 全仓多一条永远修不掉的红；去掉空格即门禁原文，其余一字未动。）
   ⇒ `tests/source-citations` 的「仓里每一条带路径的上游引用都指得到」变红，诊断里逐字出现我这一条：
   `src\vcsLogGraph.ts :: ...EdgePrintElement.kt:900-901 —— 行号超出文件长度（901 > 22）`（该轮全仓 19 条，其中 **1 条**归属本批）。
   撤掉 ⇒ 本批四文件单核回到 `collectable=55 bad=[]`。
3. **锚点门的边界（如实记录，不是"我没试"）**：把本批新增的一条完整路径引用从 `...VcsLogGraphOptionsChooserGroup.java:139-142` 改成 `:139-141`，
   锚点门**没有**变红 —— 因为该门只核「已入快照」的锚点，新引用按设计只计入「未入快照」（那轮打印 `未入快照 1069→1075`）。
   这条正是 `tests/source-citation-anchors.test.mjs:11-13` 写的第 ③ 条口径 ⇒ 结论：本批改旧坐标才会被拦，
   所以 §0 里那条 `:71`/`:72` 我按"两个坐标都留着"处理，没有悄悄改掉任何已锚引用。撤掉该注入后文件回到实现态。
4. **既有断言零放松**：`tests/vcs-log-presentation.test.mjs` 一字未动，45 条全绿；新测试文件里唯一一处"改形状"是把一条
   我自己刚写的「位置必须逐列唯一」断言换成「同一格内完全相同的单元只出一份 + 列号从 0 密排 + 边在前节点在最后」——
   依据是上游确实会让同一列并存 UP/DOWN 两个单元（`PrintElementGeneratorImpl.kt:143-148`），属**钉错了形状**、不是放松。

## 5. 零消费方自查

· `graphUnitsOfRows` 被 `buildLogGraph` 自己调用（返回值 `units`），模块内不是孤儿符号；`collapsedLinearSpans` 被 `collapseLinearGraph` 调用；`collapseLinearGraph` **暂时没有组件消费方**（组件 `src/components/VcsLogTable.vue` 不归本代理改）⇒ 已在 `src/vcsLogGraph.ts:1-6` 文件头写清"为什么现在接不上 + 接线请求在哪"，并给出 paste-ready 替换（请求 1/2）。
· `collapseActionTitles` / `graphDisplayOptions` 都被同文件的 `logGraphOptionsModel` / `hasNonDefaultGraphOptions` 消费，而 `logGraphOptionsModel` 由 `src/components/VcsLogGraphOptions.vue:7` 渲染 ⇒ 文案换档是**真可见**行为，不是死代码。
· `node .tools/find-orphan-modules.mjs --gate`：新增 0（见 §3）。
· 没有新增 UI 行、没有新勾选项：`linearBek` 是求值入参、不渲染（上游把它门在 Registry 后面且默认关，`BekUtil.java:13-15`）；`row.process` 字段没有渲染点（本仓折叠不跑进度条），理由写在请求 3。

## 6. 做不到 / 无法核实

1. **「折叠已合并分支」的真行为做不了**：能核实的只有"文案随 `GRAPH_OPTIONS==LinearBek` 换"这一半（`CollapseOrExpandGraphAction.java:58-67`）。
   LinearBek 本体是 BEK 的**线性化重排**（`PermanentGraph.kt:65-68`），本仓 `buildLogGraph` 没有 BEK 那一遍、分页记账在 `src/vcsLogData.ts`，
   重排会打乱 offset/自动加载阈值 ⇒ 只接文案档，不接排序（仍登记在 `LOG_GRAPH_OPTION_GAPS`，`src/vcsLogGraphOptions.ts:266-269`）。
2. **列号与上游不等价**：上游一行的列 = 该行图元素排序后的下标（`PrintElementGeneratorImpl.kt:134`），排序键是 BEK 的 layout index
   （`GraphElementComparatorByLayoutIndex.java:26-74`）；本仓按**车道号**密排（`rowLanes`）。没有 BEK ⇒ `layout index` 无法核实到逐条对应，
   只能保证"从 0 密排 + 弯线由 `otherPosition` 表达 + 节点最后"这三条可核性质。这一点在代码注释里写明，不当已等价。
3. **`NodePrintElement.Type.OUTLINE` 与 `LineStyle.DOTTED` 无生产者**：在整个参考树里各只有画师那一条分支
   （`SimpleGraphCellPainter.kt:182-185` / `EdgePrintElementImpl.kt:43-48` 不产 DOTTED）⇒ 本仓类型里不列这两档，免得多出一个永远不成立的显示档。
4. **中文文案**：本地化包不在参考树（`VcsLogBundle.properties` 是英文原文），「折叠已合并分支/展开已合并分支/正在…」是按
   `action.title.collapse.merges` 等英文 key 直译，注释里逐条标了英文原文与 key 行号（`src/vcsLogGraphOptions.ts:65-76`）。
5. **`MultipleCommitInfoDialog` / `FileHistoryOneCommitAction` / `ShowAllAffectedFromHistoryAction` / 两条 `Update*Dialog`**：
   不在本代理文件面（组件 `VcsLogDetails.vue`、`SourceControl.vue`、`native/git.cpp`），未做也未判"做不了"。
6. `AGENTS.md`：`D:\TaoCode\AGENTS.md` 不存在（`Read` 直接报 no such file，`find -maxdepth 2` 在本仓无命中）⇒
   本批按 `D:\TaoCode\.tools\agent-rules.md` 全文执行；上游树根倒是有 `AGENTS.md`（那是 IntelliJ 自己的贡献者规约，与本仓派单无关，未据此改行为）。

## 7. 需要主代理接的线

见 `docs/wiring-requests-2026-10-06-vcslog2.md`：请求 1（`VcsLogTable.vue:7,21,34` 换成 `collapseLinearGraph`）、
请求 2（`:143-149` 落 dashed 与 `graph.units`）、请求 3（文案档组件零改动 + `row.process` 无消费方的说明）+ 升档请求（判词文件）。
另有两条**别人的红**要收：`src/components/ProblemsPanel.vue` 903 行（超 900，门禁红）与
`docs/batch-2026-10-06-{projecttree,status2,status2defect,welcome2}.md`、`docs/wiring-requests-2026-10-06-{vcs2,plugins}.md` 里的 18 条假上游引用。
