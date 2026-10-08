# lane dbg-frames（2026-10-08）—— `dbg/frames-vars`(103) + `dbg/evaluate`(11)

## 1. 逐句核实
两族判词点名的本仓落点**逐条开文件核过，全部仍在**（DebugPanel 的帧/作用域/变量树 + `setVariable`/`setExpression`；`src/debugDataView.ts` 五格开关；`src/debugValueCopy.ts`+`DebugRowMenu.vue`；`src/debugWatches.ts`/`src/debugWatchActions.ts`/`src/debugWatchesStore.ts`/`DebugWatchesPane.vue`；`DebugInspectWindow.vue`+`src/debugValueHistory.ts`；`src/debugCompareClipboard.ts`+`DebugClipboardCompare.vue`；求值框 Alt+F8 + `src/debugEvaluateHistory.ts`/`src/debugCompletions.ts`/`DebugEvaluateDialog.vue`/`src/debugMultilineEvaluate.ts`/`src/debugQuickEvaluate.ts`+`src/quickEvaluateHint.ts`）。
「缺」逐条：① `ShowReferringObjectsAction`、② `XJumpToTypeSourceAction` **仍缺且不可做**（`src/bridge.ts` 的 `Method` union 没有引用查询/类型源码位置请求，本轮冻结）；⑤ 监视分组**不该再叫缺** —— 上游 `XWatchesTreeActionBase.java` 那一族里没有「组节点」这条能力，本仓单层列表与上游同形；⑥ 按类型分组仍是用户开关（规格已建模、数据面不是容器自报）；`dbg/evaluate` ② 本轮补真实现。
**机械信号订正**：`XValue | 真实代码` 是**误报** —— `scripts/verdict_signals.py` 的 `strip_comments` 不剥 HTML 注释，全仓去注释后唯一命中是 `src/components/DebugPanel.vue` 的 `<!-- IDEA 的 XValue.setValue … -->`，`XValue.java` 本体本仓没有等价实现。两族判词已按此回填（只改这两个族键；逐类行/档位/计数一格未动）。

## 2. 做了什么（纯逻辑 + 判据 + 独立子组件）
1. **求值历史树**（上游 `DebuggerTreeWithHistoryPanel`/`DebuggerTreeWithHistoryContainer` 的树那一半）：纯规则 `src/debugHistoryTree.ts`（条目从 `evaluate` 回参造、句柄 `reference` 优先、分页规模只认适配器；根/孩子/省略号三行；行动作按能力门控）+ 独立子组件 `src/components/debug/DebugHistoryTree.vue`（工具条「设为根/Alt+←/Alt+→」直接复用 `src/debugValueHistory.ts` 的容器规则；展开经 `dapEvaluate`/`dapVariables` 自取数；行菜单 `copy-value`/`copy-name` 组件自己做，其余动作要宿主 `delegate` 白名单）。由此 ①/② 两条缺**在代码里可复核**：`referrersProvider`/`canNavigateToTypeSource` 为假 ⇒ `show-referring`/`jump-to-type-source` 证明性地不出现（给了通道就回来，判据正反两向都钉住）。
2. **清掉一个真孤儿**：`src/debugTypeGrouping.ts`（`XValue` 节点动作表/五格孩子/组规格）此前只被测试 import，现由上面模块与组件真调用（`historyRowActions`/`historyRowMenuItems`/`historyTreeRows`）。
3. 宿主接线：`src/components/DebugEvaluateDialog.vue` 的历史面板下挂载该树（有历史才画）。

## 3. 判据与条数
新增 `tests/debug-history-tree.test.mjs` **10 条**，先红后绿可核：接线前 **7 过 / 3 红**（两条我自己写错的断言 + 一条接线锚点），修复后 **10 / 10**。既有断言未删、未放宽、未改形状。

## 4. 门禁读数（原始）
- 三件套 `debug-frame-context`/`debug-watch-actions`/`debug-breakpoint-groups` ⇒ **32 / 32 / 0**；新增 `debug-history-tree` ⇒ **10 / 10 / 0**；`module-size` ⇒ **5 / 5 / 0**（未抬上限）；`verdict-generated` ⇒ **5 / 5 / 0**；`verdict-table-check`（含 T-4 逐域 `--check`）⇒ **7 / 7 / 0**；六个文件合跑 ⇒ **52 / 52 / 0**。
- 域内 `tests/debug-*.mjs`+`tests/xdebugger-*.mjs` ⇒ **255 / 255 / 0**；`source-citations` 一族 48/48；`npx vue-tsc --noEmit` ⇒ **0 错**。
- `find-orphan-modules.mjs --gate` ⇒ 新增零消费方 42 个（全是别的 lane 在途文件）；我的 3 个新文件与 `debugTypeGrouping.ts` 都不在清单里（本 lane 净清 1 个孤儿、净增 0）。
- 判决表刷新：`python scripts/verdict_table.py` 覆盖 7 个域（含合并判决书 `verdict-execution-debug.md`）；`actions`/`find-diff` 的判决书有手写 §G，刷新时先把该 .md 挪开、生成后原样放回（前后 sha256 相同）。`scripts/verdict_table.py` 本轮被多 lane 并发编辑（核到一次他人语法错，已被对方修掉）。

## 5. 族档位变化
两族仍为 `~`（没有整族 `[x]`）：`dbg/frames-vars` 追加复核 + ⑤/⑥ 改口 + `XValue` 误报订正；`dbg/evaluate` 追加复核 + ② 由「缺」改「已落真实现，缺宿主一根线」。逐类表与计数未动（635 类，19/320/0/296）。

## 6. 仍缺什么
① 引用查询（DAP 无该请求）；② 类型源码位置（`variables` 不带）；⑤ 上游无此能力（口径已改）；⑥ 分组数据面不是容器自报的 `XValueGroup`；历史树本版展开**一层**（根+孩子+省略号行），更深层留在 Variables/检查窗口两条既有路径。

## 7. 接线清单（`DebugPanel.vue` 冻结，请协调者落这 2 行）
1. `<DebugEvaluateDialog …>` 加 `:frame-id="selectedFrame?.id ?? 0"`（对话框已有该 prop；缺它走 0 号帧兜底），可选 `:generation="frameGeneration"`（上游 `sessionPaused → rebuild()` 的等价物）。
2. 想让行菜单多出检查/添加到监视/在控制台中求值，就传 `:delegate="['inspect','add-to-watch','evaluate-in-console']"` 并接 `@action`（不给就不画，不是点不动的按钮）。
注：协调者提交 `545eb6b` 扫进了 `src/debugHistoryTree.ts` 的**较早状态**（少 39 行：缺 `historyValueEntry` 与行的 value/type）；组件、判据、对话框接线尚未提交，工作树里是完整版。
