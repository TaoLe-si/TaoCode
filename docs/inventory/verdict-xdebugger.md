# 判决：`xdebugger`

> 本文件由 `python scripts/verdict_table.py xdebugger` **生成**，不要手改：
> 族判词在脚本的 `FAMILIES` / `PLATFORM_FAMILIES` 表里（逐族读过源码给的），逐类表在 `docs/inventory/<域>_verdict_table.md`，
> 门禁 `tests/verdict-generated.test.mjs` 读同名 `.json`。

方法（与 B1–B7 同一口径，只是规模不同：本域 2243 类没法逐条手抄）：

1. **族级判词**：类按包归族（`RULES`），每族一条判词，写清用户可见行为在本仓落在哪个文件、缺什么；
   判词里引用的本仓路径由门禁逐个核对**真实存在**。
2. **逐类覆盖**：族档位落到族内每个类，再叠两类机械修正 ——
   ① `OVERRIDES` 的逐类例外（族整体一个档、个别类本仓真做了）；
   ② **Swing 降级**：族判 `[~]` 但类本身是 Swing 组件本体（`JComponent`/`paintComponent`/`JBPopup`/`JList`…）的判 `[-]`。
3. 机械信号由 `scripts/verdict_signals.py` 产出（行数 / Swing / 平台专属 / 在 TaoCode 里出现过没有），每行的档位都能复算。

## xdebugger（635 类）

| 档 | 类数 |
|---|---:|
| `[x]` | 0 |
| `[~]` | 338 |
| `[ ]` | 0 |
| `[-]` | 297 |
| 合计 | 635 |

| 族 | 档 | 判词（本仓落点 / 缺什么） | 类数 |
|---|---|---|---:|
| `dbg/misc` | `[-]` | 其余调试基础设施（`XDebuggerManagerImpl` 的注册/`XDebuggerUtilImpl` 的文件-行解析内部量/测试辅助）。没有 JVM 对象模型可移植 | 158 |
| `dbg/frames-vars` | `[~]` | 栈帧/变量/监视视图（`XDebuggerTree`/`XValue`/`XWatchesView`/`XVariablesView`）。本仓：`src/components/DebugPanel.vue`（帧列表按选中帧取作用域、变量树懒加载、就地改值 `setVariable`/`setExpression`）+ `src/debugDataView.ts`（树展开与数据视图选项：隐藏 null 值、按名排序、**按类型分组**、**按数组显示**、**库帧过滤**，设置页在「构建、执行、部署 › 调试器」，判据 `tests/debug-data-view.test.mjs`/`tests/debug-variable-views.test.mjs`）+ `src/debugValueCopy.ts` 与 `src/components/DebugRowMenu.vue`（行动作弹层：复制值/复制名称 —— 上游 `XCopyValueAction`/`XCopyNameAction`；**添加到监视** —— `XAddToWatchesTreeAction`；**在控制台中求值** —— `EvaluateInConsoleFromTreeAction`；**按数组显示**（任务书的 ViewAsArray 语义；上游 tree/actions 里没有同名类，语义对应把索引形态的孩子按 `[i]` 呈现），判据 `tests/debug-value-copy.test.mjs`/`tests/debug-actions.test.mjs`）+ `src/debugWatches.ts`（监视表达式**跨会话持久化**：表达式文本按项目根存 localStorage，经 ToolWindowView 的 root prop 读写，判据 `tests/debug-watches.test.mjs`）。缺：① `ShowReferringObjectsAction` 要 `XReferrersProvider` 的引用查询，DAP 没有该请求（`src/bridge.ts` 的 Method union 本轮冻结）；② `XJumpToTypeSourceAction` 要类型源码位置，DAP `variables` 不带；③ `XInspectAction` 的独立值检查窗口（求值结果树已有，独立对话框未做）；④ `XCompareWithClipboardAction` 与监视分组（`XWatchesTree` 的组节点）；⑤ 按类型分组是**用户开关把同层 type 相同的兄弟聚合**，不是上游由每个 `XValueContainer` 自报的 `XValueGroup`（DAP 只有扁平 `variables`，这个差异写在 src/debugDataView.ts 的注释里） | 129 |
| `dbg/attach` | `[~]` | 附加与会话生命周期（`XAttachDebuggerProvider`/`XDebugProcessStarter`/`XDebugSession`）。本仓：`DebugPanel` 的「附加」（`src/debugAttach.ts` 解析 PID/pipeName 选择器与错误文案）+ `native/dap.cpp` 的 initialize/launch/attach/configurationDone/disconnect/terminate/restart。本轮补**最近附加目标**（上游 `AttachToProcessDialog` 最近使用栏的等价物）：`src/debugAttach.ts` 的 `pushAttachTarget`/`loadAttachHistory`/`saveAttachHistory` 存 localStorage（机器级键 `taocode.debugAttachTargets`），面板附加输入挂 datalist，成功附加才记录，判据 `tests/debug-attach-history.test.mjs`/`tests/debug-attach.test.mjs`。缺：① 进程列表与筛选对话框（`AttachToProcessDialog`/`AttachToProcessItemsTree` 的 PID/用户/可执行/命令行四列、Show only my processes）—— **宿主没有进程枚举通道**：`native/main.cpp` 分派表里没有系统进程列表方法（既有 `run.instances` 只枚举本仓启动的实例，`native/run_host.cpp` 的 descendant_processes 只走自己那棵进程树），而 `src/bridge.ts` 与 `native/main.cpp` 本轮冻结，加不了；② 多 host 分组（`XAttachHostProvider` 的 Local/WSL/Remote）与附加器选择（`AttachDialogDebuggersFilter`）；③ `XDebugSession` 的多会话并行管理（本仓一次一个调试会话） | 81 |
| `dbg/actions` | `[~]` | 调试动作族（`ResumeAction`/`StepInto/Over/Out`/`PauseAction`/`DropFrameAction`/`RunToCursorAction`）。本仓：`src/keymap.ts`（F9 继续、F8/F7/Shift+F8 单步、Ctrl+F8 切行断点、Alt+F9 运行到光标、Ctrl+F2 停止）+ `src/menus/runMenu.ts`（查看断点/附加等入口）+ DAP `continue`/`next`/`stepIn`/`stepOut`/`pause`/`restartFrame`/`goto*`（`native/dap.cpp`），RunToCursor 走 `gotoTargets`+`goto`。本轮补：① `ShowExecutionPointAction`（面板「显示执行点」按钮：优先适配器报告的 `dapState.currentLocation`，经 jump 事件跳编辑器）；② `EvaluateInConsoleFromTreeAction`（行动作弹层「在控制台中求值」：DAP `repl` 上下文，命令与结果写进调试控制台 `dapConsole`）；③ `XAddToWatchesTreeAction`（弹层「添加到监视」，用适配器的 `evaluateName`）；④ `MuteBreakpointsAction`/`RemoveAllBreakpointsAction` 见 dbg/breakpoints；Drop/Reset Frame 已有（同一 DAP `restartFrame`）；判据 `tests/debug-actions.test.mjs`/`tests/debug-breakpoint-extras.test.mjs`。缺：① 强制单步（`ForceStepOver`/`ForceStepInto`）与 `SmartStepIntoAction` —— 需要新 DAP 请求 `stepInTargets` 与新 Method，`src/bridge.ts` 的 union 与 `native/main.cpp` 的分派表本轮都冻结；② 线程冻结/解冻（`FreezeActiveThreadAction`/`ThawAllThreadsAction`：JDI 挂起模型，DAP 无对应请求）；③ `MarkObjectAction`（JDI 对象标记/着色）；④ `PauseOutputAction` | 77 |
| `dbg/breakpoints` | `[~]` | 断点模型与对话框（`XBreakpointManager`/`XLineBreakpointType`/`BreakpointsDialog`/`XBreakpointProperties`）。本仓：`dapBreakpoints`（`src/bridge.ts` 的行断点仓）+ `src/breakpointLocations.ts`（`XLineBreakpointType.canPutAt` 的能力门控）+ `src/components/BreakpointsDialog.vue`（行断点按文件分组 `src/breakpointGroups.ts` + 异常断点分组 `src/exceptionBreakpoints.ts`，判据 `tests/debug-breakpoint-groups.test.mjs`）+ `src/components/DebugBreakpointsPane.vue`（断点区：条件/**命中次数**/**日志消息**三个编辑入口 + 临时断点（命中一次自删，`ToggleTemporaryLineBreakpointAction`）+ 依赖断点（触发者命中后启用，`XBreakpointDependency`）+ **静音**（`MuteBreakpointsAction`：给适配器发空数组、本仓册子不动；`unmuteOnStop` 设置消费）+ **移除所有断点**（`RemoveAllBreakpointsAction`）+ 移断点确认（`confirmBreakpointRemoval` 设置消费）），纯规则在 `src/debugBreakpointExtras.ts`，判据 `tests/debug-breakpoint-extras.test.mjs`。缺：① 用户可建的**逻辑断点组**（`XBreakpointGroup`/`XBreakpointCustomGroupingRule`：跨文件具名组、按组启用/禁用）—— 断点写入口在 Debug 面板（`BreakpointsDialog` 只有 close/open 两个 emit，接线在 `src/App.vue`，本轮冻结），没有可落的面板；② Java 专有的方法/字段断点类型；③ 临时/依赖是**会话级**内存态（`src/components/DebugBreakpointsPane.vue` 的 refs），不随项目保存（上游存断点状态）；④ 命中次数/日志只做单行输入与提示标记（L/#），没有上游对话框的富编辑 | 72 |
| `dbg/ui-swing` | `[-]` | 调试器的 Swing 组件（`XDebuggerTree` 的渲染器/`XDebuggerPanel`/`XDebuggerFramesList` 的 Swing 实现）。行为在 `DebugPanel.vue` 里以 DOM 重做，组件本体不可移植 | 40 |
| `dbg/evaluate` | `[~]` | 求值与表达式（`XDebuggerEvaluator`/`XDebuggerTreeWithHistory`/`XDebuggerEditor`/`XExpressionDialog`）。本仓：`DebugPanel` 的求值框（Alt+F8 取编辑器选区、在选中帧上下文求值）+ `src/debugEvaluateHistory.ts`（求值历史：去重前插 + 上限，输入框 datalist 候选）+ `src/debugCompletions.ts`（DAP `completions`，能力门控）。本轮补：① **多行求值对话框** `src/components/DebugEvaluateDialog.vue`（上游 `XExpressionDialog`/`XDebuggerMultilineEditor`；口径写死：DAP `evaluate` 只收表达式，多行**逐行、同帧、按顺序**求值、失败行标红不阻断，纯规则在 `src/debugMultilineEvaluate.ts`，判据 `tests/debug-multiline-evaluate.test.mjs`）；② **求值历史面板**（对话框右侧：最近成功求值的表达式，点击回填/单条移除/清空）；③ 设置 `debuggerEvaluationMode` 选择对话框是单行还是多行（`XDebuggerGeneralSettings.getEvaluationDialogMode` 的两档）。缺：① 快速求值（`QuickEvaluateHandler`/`ValueHint`/`XDebuggerTextPopup`：悬停出值提示）—— 要编辑器悬停通道 + 后台求值节流，未做；② `DebuggerTreeWithHistoryPanel` 那种可回看的**历史树**（本仓历史是文本候选 + 结果行列表，不是可展开的树） | 27 |
| `dbg/rpc` | `[-]` | 调试器 RPC 通道（`XDebuggerRpc`/`XDebuggerTreeRemoteApi`/protobuf 消息）。IDEA 用它把调试后端放到另一个进程；本仓的等价物是 DAP 的 JSON 协议（`native/dap.cpp` 自带分帧），RPC + protobuf 那一层没有对应物 | 20 |
| `dbg/settings` | `[~]` | 调试器设置（`XDebuggerSettings`/`XDebuggerGeneralSettings`/`XDebuggerDataViewSettings`）。本仓：设置页「构建、执行、部署 › 调试器」`src/components/DebuggerSettingsPage.vue` → `src/toolViewContext.ts` 的 debugView → 各消费点。本轮从两格扩到**六格 + 一个下拉**：隐藏 null 值、按名排序、**行内值**（`showValuesInline` → src/debugInlineValues.ts + src/editorDebugLine.ts）、**库帧**（`isShowLibraryStackFrames` → src/debugDataView.ts 的 visibleFrames）、**移断点确认**（`confirmBreakpointRemoval` → DebugBreakpointsPane）、**停在断点自动取消静音**（`unmuteOnStop` → src/debugBreakpointExtras.ts）、**求值对话框形态**（`evaluationDialogMode` ∈ expression/codeFragment → DebugEvaluateDialog）；键在 `src/settingsModel.ts` 与 native `GENERAL_SETTING_KEYS`/`general_defaults_impl`/`validate_general_patch` 两侧登记，异常断点过滤器仍是共享状态（src/exceptionBreakpoints.ts）。判据 `tests/debug-settings-keys.test.mjs`/`tests/debug-data-view.test.mjs`。缺：① `hideDebuggerOnProcessTermination`/`showDebuggerOnBreakpoint`（调试器工具窗口的显示/隐藏生命周期，宿主在 `src/App.vue`，本轮冻结）；② `scrollToCenter`（滚动居中要编辑器滚动通道）；③ `runToCursorGestureEnabled`（gutter 手势）；④ `valueLookupDelay`/`autoExpressions`（悬停值查找延迟与自动表达式，依赖未做的悬停快速求值） | 17 |
| `dbg/inline` | `[~]` | 内联调试（`InlineVariablesPanel`/`XDebuggerInlineValuesProvider`/`InlineWatch`/`InlineDebugRenderer`）。本仓本轮补上**行内值**：纯规则 `src/debugInlineValues.ts`（取当前帧第一个已加载作用域、`name = value` 压平截断、上限 8 条）+ 编辑器渲染 `src/editorDebugLine.ts`（**复用 CodeEditor 已在用的 `debugLineExtension`**：新增 `inlineValuesField` 与 `setDebugInlineValues` 向登记的 EditorView 派发 effect —— CodeEditor.vue 冻结，这是不碰它就能挂进扩展链的真实挂点）+ 设置 `debuggerShowValuesInline` 开关（DebugPanel 每次 refreshStack/选帧后推送，继续/卸载/会话结束清空），判据 `tests/debug-inline-values.test.mjs`（含 EditorState 级状态机）。缺：① 上游 `XDebuggerInlineValuesProvider` 按「变量出现在哪一行源码」过滤，DAP `variables` 没有逐变量行号，本仓是**当前帧的值提示挂执行行行尾**（差异写在 src/debugInlineValues.ts 文件头）；② `InlineWatch`（把监视表达式画进编辑器）已在本轮补上：规则层 `src/debugInlineWatch.ts`（位置/`getLineEndOffset` 行尾锚点/只在同一文件暂停时求值/`updatePosition` 重锚与失效即移除），接线层 `src/debugInlineWatchSync.ts`（面板监视行上的「行内」按钮 = 当前帧位置加/删、每次停住重算后推进、会话结束/卸载清空），编辑器侧 `src/editorDebugLine.ts` 的 `inlineWatchesField`（挂进编辑器**已在用**的 `debugLineExtension`，所以 CodeEditor 本轮一行没改），判据 `tests/debug-inline-watch-wiring.test.mjs`；如实差异：上游靠 `RangeMarker` 跟着文档偏移重锚，本仓编辑器与面板之间没有 RangeMarker 通道，文档改动后不重锚（行号越界即不画）；③ 行内的就地编辑（`InlineDebugRenderer` 的编辑面）未做 | 14 |

## 合计

`[x]` 0 + `[~]` 338 + `[ ]` 0 + `[-]` 297 = **635**
（`execution` 1608 + `xdebugger` 635）

**已知缺口（族判词里逐条写着，这里点名最要紧的几条）**：

- 运行/调试本仓是「通用表单 + 实例模型 + DAP」：**没有** per-type 配置编辑器、模板与共享配置、多运行目标；
- 测试侧：断言视图（`src/assertionView.ts`）与结构化事件通道（`smRunner` 等价物，`src/testEventChannel.ts`，判 `[~]`）已落地；JUnit 检查规则做了纯文本子集（`src/junitInspections.ts`，判 `[~]`）；覆盖率做了报告侧子集（`src/coverageReport.ts` 读 JaCoCo/Kover XML，判 `[~]`），采集通道仍缺（见 `exec/coverage` 判词）；
- 调试侧本轮补上行内值（`src/debugInlineValues.ts` + 复用 `debugLineExtension` 的 `inlineValuesField`）、多行求值对话框与历史面板、监视持久化、断点的命中次数/日志入口与临时/依赖/静音/全清、最近附加目标、`ShowExecutionPoint`/`EvaluateInConsole`；仍缺逻辑断点组（断点写入口过 `src/App.vue`，本轮冻结）、悬停快速求值、附加进程列表（宿主无进程枚举通道）、Smart Step Into/强制单步（`src/bridge.ts` 冻结，Method union 里没有 `stepInTargets`）；
- `[-]` 的两大来源：JVM 内部管线（`ProcessHandler`/`ExecutionUtil`/`RunProfileStarter`）与 Swing 组件本体。
