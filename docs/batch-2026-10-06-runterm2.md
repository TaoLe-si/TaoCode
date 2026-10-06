# 批次报告 · 运行/控制台/终端/大文件（代号 `runterm2`，2026-10-06）

派单三件事：① 收现网 2 红之一（GradlePanel 任务激活接线那条）；② `terminal2` 那轮的 T1/T2 —— T1（App.vue 一行）主代理已记着，
T2 阻塞在桥 ⇒ 交请求；③ `exec/run-instances`、`exec/ui`、`exec/console`、`ex/terminal*`、`lp/large-files` 五族判词**先核后做**。

## 0. 量现场（动手前实测）

| 命令 | 结果 |
| --- | --- |
| `node --test tests/gradle*.test.mjs tests/ext-*.test.mjs` | 收工时复跑 **135/135 通过、0 失败**（动手时那条红不在这两个 glob 里，见 §A） |
| `node --test tests/file-chooser-activation-wiring.test.mjs` | 09:02 首跑 **1 红**（第 37 行那条）→ 09:04 复跑 **4/4 绿**，红不是我灭的（见 §A） |
| `npx vue-tsc -b --force` | **0 错** |
| `node --test tests/terminal-*.test.mjs tests/console-*.test.mjs tests/run-*.test.mjs tests/large-file-*.test.mjs tests/module-size.test.mjs` | **197/197 通过**（域内基线，含 module-size 的 5 条） |
| 三个语法检测器 + orphan 门 | 0 参数属性 / `.mjs` 全 JS / 无漏扩展名 / 孤儿 9=基线 9、新增 0 |
| 引用双门 | **9 绿 / 2 红**，红的 7 条假路径全在别人的文档里（见 §6 与接线请求末尾那张表） |

---

## A. ① 那条红的归属：**roots lane，不在我面，且我没碰那两个文件**

- 派单把它写在 `tests/gradle*.test.mjs tests/ext-*.test.mjs` 名下；实测标题
  「GradlePanel 挂上任务激活：状态持久化、动作矩阵、右键入口、任务 tooltip」在
  **`tests/file-chooser-activation-wiring.test.mjs:28-39`**（`tests/ext-*` 这个 glob 也吃不到
  `tests/external-tasks-activation.test.mjs`，因为要求 `ext-` 前缀）。**留痕：原写 gradle/ext 名下，实际是这条。**
- 09:02 首跑红在第 37 行的 `assert.match(panel, /:title="taskActivationTitle\(task, build\.directory\)"/)`，
  `actual` 就是 `src/components/GradlePanel.vue` 全文 ⇒ **红因在 GradlePanel.vue 的模板**（`src/gradle*.ts` 无关：
  `node --test tests/gradle.test.mjs` 单独跑 43/43 一直绿）。
- `src/components/GradlePanel.vue` 是派单点名的 **roots lane 在途文件**（不可改），它的 mtime 是 09:03:34
  —— 也就是**我首跑之后、复跑之前**被那条 lane 改了；09:04 复跑该文件 4/4 绿，`tests/gradle*` + `tests/ext-*` 135/135 绿。
- 结论：**现网这条红由 roots lane 自己的编辑收掉，我面内没有任何可修的东西**（我没有为它改过一行，
  `git diff -- src/components/GradlePanel.vue` 里没有我的 hunk）。现网 2 红的另一条（引用门的 7 条假路径）也**不是我写的文档**，
  逐条列在 `docs/wiring-requests-2026-10-06-runterm2.md` 末尾。

---

## B. ③ 五族判词核对 + 本轮做的那一条

**先核的结果：五族的「缺」清单里有 6 条是陈账（早就做过）、3 条真缺但卡在冻结文件、1 条本轮做完。**

### `exec/console`（`docs/inventory/verdict-execution.md:41`）

| 项 | 判定 | 上游相对路径:行号 | 本仓落点 | 一句话 |
| --- | --- | --- | --- | --- |
| 控制台输出里的 **ANSI 色码要真上色** | `[x]` **本轮新做** | `java/execution/openapi/src/com/intellij/execution/configurations/JavaCommandLineStateUtil.java:17-21`（`ansiColoring` → `createColoredProcessHandler`）、`platform/platform-impl/src/com/intellij/execution/process/ProcessHandlerFactoryImpl.java:16-17`、`platform/lang-impl/src/com/intellij/tools/ToolRunProfile.java:97`、`platform/lang-impl/src/com/intellij/ide/actions/runAnything/execution/RunAnythingRunProfileState.java:55` | `src/consoleAnsi.ts`（新，380 行）+ `src/runIssues.ts:45-53` + `src/components/RunConsole.vue:120-146`、`:529-541` | 本仓宿主原样回传字节 ⇒ 带色输出在控制台里是一行行转义垃圾；现在解码成片段上色，无码的行**渲染路径零变化** |
| SGR 语义逐条（0/1/3/4/7/9/21/22/23/24/27/29、30-37/40-47/90-97/100-107、39/49、38/48 的 `5;n` 与 `2;r;g;b`、`:` 分隔、空段当 0、解不出整数即停、未知码跳过、非 SGR 的 CSI 忽略、不成形的当文本、没读完的留给下一块、其它 ESC 不剥） | `[x]` 本轮新做 | `platform/platform-util-io/src/com/intellij/execution/process/AnsiTerminalEmulator.java:122/126/128-131/136-138/147-211/189-194/198-203/204-206/278-293/396-434/424-434/647-652`；`AnsiEscapeDecoder.java:20-23/50-52/66-75/112-120`；`AnsiStreamingLexer.java:112-142/155-164/165-167/171-175/177-180/186-188` | `src/consoleAnsi.ts:157-327`（解码器）、`:330-352`（取色）、`:354-380`（CSS/按偏移取样式） | 每条都有判据钉住（23 条，`tests/console-ansi.test.mjs`）；取色规则照 `ColoredOutputTypeRegistryImpl.java:34-51/160-165/247-256/269-278/299-303/314-318` |
| FAINT/闪/隐藏/字体族/边框/表意下标**不画** | `[-]` 不适用（逐条理由） | `ColoredOutputTypeRegistryImpl.java:269-278`（`computeAwtFont` 只看 BOLD 与 ITALIC）与 `:247-256`（effects 里没有 blink/conceal/font） | `src/consoleAnsi.ts:104-131`（`CONSOLE_ANSI_NOT_RENDERED`） | 上游控制台本来也不画 ⇒ 不给自己加样式；常量导出可被门禁核对（判据里那条点名 6 档） |
| `ConsoleOptionsProvider` / `ConsoleRootType` 扩展点 | `[-]` 不适用 | 判词自述即「插件扩展点」 | 无 | 本仓没有插件贡献点宿主，接了就是空壳 |
| `GutterContentProvider` | `[-]` 不适用（具体理由） | `platform/lang-impl/src/com/intellij/execution/console/GutterContentProvider.java:11-38`；调用方只有 `LanguageConsoleBuilder.java:57/131/208-214` 与 `ConsoleGutterComponent.java:42-63` | 无 | 它是**语言控制台 REPL** 的装订线（`LanguageConsoleBuilder` 挂进去的），本仓运行控制台不是编辑器实例、没有装订线可画 |
| REPL 的 stdin 半边 | `[x]` 判词已订正（本轮复核一致） | `platform/lang-impl/src/com/intellij/execution/console/ConsoleExecuteAction.java:148-151`（`useProcessStdIn`） | `src/consoleInputHistory.ts` + `src/runActions.ts` 的 `sendRunInput` → `run.write` | 判词「本仓只有 stdin 行通道」实测成立，`docs/inventory/verdict-execution.md:41` 那句订正写得对 |
| REPL 的解释器半边（`myUseProcessStdIn == false`，`ConsoleExecuteAction.java:159-162`） | `[ ]` 未做 | 同上 | 无 | 要「起一个解释器子进程并把输出回填控制台」这一整层，本仓没有语言控制台实体；不是换壳能补的 |

### `exec/ui`（`docs/inventory/verdict-execution.md:31`）

| 项 | 判定 | 上游 | 本仓落点 | 一句话 |
| --- | --- | --- | --- | --- |
| `Runner.RestoreLayout` | `[-]` 不适用 | `RunnerContentUi.java:1491-1526`（restoreLayout 那族，见 `src/runToolWindowLayout.ts:156-163` 已登记的原文） | 无 | 标签条扁平、没有可移动的视图格 ⇒ 无可恢复状态（沿用那条 lane 的判定，本轮复核成立） |
| `MinimizeViewAction` | `[-]` 不适用 | `RunnerContentUi.java:408-409` 的「不可关才最小化」分支 + `MinimizeViewAction.java:28-45` | 无 | 运行视图都可关 ⇒ 分支不可达（复核成立） |
| `Runner.FocusOnStartup` | `[ ]` 未做，**但卡点写错了** | 登记 `platform/lang-api/resources/intellij.platform.lang.actions.xml:3`；组 `platform/execution-impl/resources/intellij.platform.execution.impl.actions.xml:89-94`（`Runner.View.Popup` › `Runner.Focus`）；判定 `platform/lang-api/src/com/intellij/execution/ui/actions/AbstractFocusOnAction.java:20-26`（`content.length == 1` 才可见）与 `:32-36`；状态 `platform/execution-impl/src/com/intellij/execution/ui/layout/impl/RunnerLayout.java:248-253/264-266`；**消费** `platform/execution-impl/src/com/intellij/execution/ui/layout/impl/RunnerContentUi.java:1828`、`:1860-1865`、`:1881` | 我的面（`src/runToolWindowLayout.ts` + `RunConsole.vue` 的「视图」弹层）**能落** | **留痕**：`src/runToolWindowLayout.ts:171-181` 写的「没有对象可标、上游只是打标记」只对了一半——上游确实在 UI 首次显示时聚焦被标的那个 Content。真正卡点是 `tests/runner-view-actions.test.mjs:105-113`（**不是我的测试面**：`tests/run-*` 不含 `tests/runner-*`）用 `deepEqual` 钉死了「不渲染」表恰好三条 ⇒ 已作为 **R3** 交主代理拍 |
| `RunnerLayoutSettings` / `CustomContentLayoutSettings` 布局设置页 | `[-]` 不适用 | `platform/execution-impl/src/com/intellij/execution/ui/layout/impl/RunnerLayoutSettings.java:18-41`（存 `runner.layout.xml`） | 无（本仓只存 `taocode.runnerLayout` 的 `tabLabelsHidden`，`src/runToolWindowLayout.ts:186-212`） | 格位 anchor/weight 没有对应物；`focusOnCondition` 那一格随 R3 一起落 |

### `exec/run-instances`（`docs/inventory/verdict-execution.md:28`）

| 项 | 判定 | 一句话（核对证据） |
| --- | --- | --- |
| ① `ExecutionListener` 扩展点 | `[-]` 不适用 | 没有插件贡献点宿主；实例事件已有内部消费者（`src/runInstances.ts` 的事件→镜像链） |
| ② 进程中介 / 远程 runner | `[-]` 不适用 | `native/run_host.cpp` 只做本机 CreateProcess；判词的「宿主没有远程 runner」实测成立 |
| ③ 提权运行 | `[ ]` 未做，**卡点是真的** | `RunStartParams` 在 `src/settingsModel.ts:51`（冻结），字段里没有提权位；`native/run_host.cpp` 的 `run.start` 只有 CreateProcess 一条路 ⇒ 作为 **R2** 交请求（含 native 侧要走 `ShellExecuteW(L"runas")` 的写法） |
| ④ 端口监视器 | `[x]` 早做过（判词自述） | `native/run_host.cpp` 的 `listening_tcp_ports` + `src/runInstances.ts` 的 `ports` + `RunConsole.vue` 的「进程」区 + `tests/run-instance-ports.test.mjs` 都在 |
| ④ 运行统计（FUS） | `[-]` 不适用 | 判词 `docs/inventory/verdict-execution.md:28` 本轮之前就已订正为「功能使用统计上报、无用户可见面」，与平台族 `statistics` 同一取舍；复核其列举的 10 个类名口径一致 |
| ⑤ JAR 运行表单 | `[~]` 部分（模块侧早做过） | 本仓已有：`src/jarRun.ts`（类型描述符/模板默认值/三步校验/`java -jar` 命令行，判据 `tests/jar-run.test.mjs`）；还差：表单挂进运行配置编辑器要 `RunConfig.type` 加 `'jar'`，`src/settingsModel.ts` 冻结 ⇒ 已登记在 `docs/wiring-requests-2026-10-06-runcfg.md`（不是我这轮新造的请求） |

### `ex/terminal` + `ex/terminal-actions`（`docs/inventory/verdict-platform_rest.md:172`、`:350`）

| 项 | 判定 | 一句话（核对证据） |
| --- | --- | --- |
| 「缺更多窗格形态（上下分屏、单标签三栏以上）」 | `[x]` **判词是陈账** | `src/terminalSplits.ts:43-138` 有 right/down 两向、**无窗格数上限**（`canTerminalSplit` 只留真实宿主前提）、`terminalGridSize`/`paneIndexAfterSplit`/`nextTerminalPaneCell`，面板按它排格；判据 `tests/terminal-splits.test.mjs` |
| 「缺 `IdeTerminalCopyPasteHandler`」 | `[x]` **判词是陈账** | `src/terminalClipboard.ts:1-38` 逐条引上游（复制要选区、Ctrl+C 有选区才复制、中键粘贴无条件、选中即复制只 Linux），面板四处接线；判据 `tests/terminal-clipboard.test.mjs` |
| 16 色 / 0-255 色号 / 前景→背景→默认回退 | `[x]` 早做过 | `src/terminalColors.ts:44-57/59-68/85-96/125-140`，默认前后景从主题令牌取（`TerminalPanel.vue:271-274`）；本轮**复用**这张表做控制台取色，不另写表 |
| 块颜色 / `AppendableTerminalDataStream` 的命令块 | `[ ]` 未做 | 上游那套是 jediterm/新块终端的自有渲染层；本仓终端是 xterm.js 画字符 + `native/terminal.cpp` 吃 VT 流，命令块要 OSC 133 一类的行协议，**不是本域换壳能补**（本轮没动 `native/terminal.cpp`） |
| 按色号的用户自定义（`JBTerminalSchemeColorPalette.kt:23-26` 逐 ANSI 键取色） | `[ ]` 未做 | 要设置页 + 设置键：`src/settingsModel.ts`、`src/settingsTreeMeta.ts`、`native/settings_schema.cpp` 全是保留文件 ⇒ 没入口就不渲染假旋钮（本轮未落） |
| 「缺统一动作上下文层」（`ex/terminal-actions`） | `[x]` **判词是陈账** | `src/terminalActions.ts:1` 起头的注释就是这个模块的名分——「终端动作的**统一上下文层**（上游 `.../terminal/actions/`：`TerminalBaseContextAction.java:18-21` …）」，十二动作表带启用矩阵与理由 |

### `lp/large-files`（`docs/inventory/verdict-platform_rest.md:93`）

| 项 | 判定 | 一句话（核对证据） |
| --- | --- | --- |
| ① 按字节判定接进编辑器 + `formatFileSize` 进提示 | `[x]` **判词是陈账** | `src/components/CodeEditor.vue:84-87`（`largeFilePolicyForText`/`utf8ByteLength`）、`:1133`（`largeFileNoticeText(largeBytes)`）已在；判据 `tests/editor-large-file-guard.test.mjs:45-51` |
| ② 打开即只读 + 隐藏/不再显示 | `[x]` **判词是陈账** | `src/largeFileNotice.ts`（`LARGE_FILE_DISABLE_KEY`、`isLargeFileNoticeDismissed`、文案）+ `CodeEditor.vue:126-136`、`:958-959`、`:1131-1134`（只读保护 + 「解除只读」按钮）已在 |
| ③ 大文件模式的动作替换（`PlatformActionsReplacer` 一族） | `[ ]` 未做 | 落点 `src/editorCommands.ts`（他人面）+ 键位与分发在冻结的 `CodeEditor.vue` ⇒ 登记 **R4** |
| ④ 按页加载的编辑器模型 | `[-]` 不适用 | 本仓 CodeMirror 单文档按视口虚拟化，没有第二个可换的查看器（判词自述同一件事） |
| ⑤ `LargeFileRegexSearchNotificationProvider` 的提示 | `[ ]` 未做 | 消费方是查找替换 UI（不是我的面）；单独做个 `src/largeFile*` 出口就是只过自己测试的死模块 ⇒ 不做 |

---

## C. 本轮改动（一件，做透）

**控制台 ANSI 色码**：解码器（一台状态机、跨行延续、按行喂）→ `src/runIssues.ts` 在折叠与
问题/链接识别**之前**把每行剥成可见文本并把样式挂在 `chunks` 上 → `RunConsole.vue` 三条分支分别上色：
可点片段按**片段起点**取样式、问题行整行取行首样式、纯文本行逐片段；调色板复用 `src/terminalColors.ts`，
并挂 `MutationObserver` 跟 `data-theme`（与终端面板同一机制，切主题不必等新输出）。
**没有样式的行不产生 `chunks`** ⇒ 那三条分支的旧渲染路径逐字不变（判据钉住这一条）。

## 2. 改动文件清单（wc -l 前后）

| 文件 | 本轮前 | 本轮后 | 说明 |
| --- | --- | --- | --- |
| `src/consoleAnsi.ts` | 不存在 | **380** | 新增（上限 900） |
| `tests/console-ansi.test.mjs` | 不存在 | **213** | 新增判据：23 条 |
| `src/runIssues.ts` | 59（HEAD 也是 59） | **72** | 每行先过 ANSI；`git diff --numstat` = `22 9` |
| `src/components/RunConsole.vue` | 见右注 | **591** | 本轮净 +38 行 ANSI 语义行（`grep -c` 实测 38）+ 换掉 3 条模板行；工作区共享、同文件另有他路在途 hunk，`git diff --numstat`（对 HEAD）= `187 13`，其中 13 行删除 = 我换掉的 3 条模板行 + 他路 10 行 |
| `docs/batch-2026-10-06-runterm2.md` | 缺 | 本文件 | 交付 |
| `docs/wiring-requests-2026-10-06-runterm2.md` | 缺 | 176 | R1（T2 桥）/R2（提权）/R3（FocusOnStartup 的测试归属）/R4（大文件三项）+ 他人假路径清单 |

**未动**：`src/components/GradlePanel.vue`、任何 `src/gradle*.ts`（roots lane）、`App.vue`、`CodeEditor.vue`、
`bridge*`、`settingsModel.ts`、`settings_schema.*`、`keymap*`、`src/junit*`、`src/diff*`、`src/problems*`、
任何 `native/**`（本轮没碰宿主 ⇒ 不需要 ctest）、`tests/runner-view-actions.test.mjs`（他人面）、`package.json`、`CMakeLists.txt`。

## 3. §5 每条自查命令的前后数字

| 命令 | 前 | 后 |
| --- | --- | --- |
| `npx vue-tsc -b --force` | 0 错 | **0 错** |
| `node --test tests/terminal-*.test.mjs tests/console-*.test.mjs tests/run-*.test.mjs tests/large-file-*.test.mjs tests/module-size.test.mjs` | 197/197 | **220/220**（+23 全是本轮新判据），0 失败 |
| `node --test tests/console-*.test.mjs` | 17/17 | **40/40** |
| `node --test tests/gradle*.test.mjs tests/ext-*.test.mjs` | 135/135（红的那条不在这两个 glob 里，见 §A） | **135/135** |
| `node --test tests/file-chooser-activation-wiring.test.mjs` | 1 红（37 行）→ 我复跑 4/4 | **4/4**（roots lane 自己收的） |
| `node --test tests/module-size.test.mjs` | 5/5 | **5/5**（新文件 380/213 在上限内；上限一字未动、无豁免） |
| `node .tools/find-param-props.mjs` | 0 处 | **0 处** |
| `node .tools/find-ts-in-mjs.mjs` | 干净 | **干净** |
| `node .tools/find-missing-ext.mjs` | 干净 | **干净**（1286 个文件，本轮 +2） |
| `node .tools/find-orphan-modules.mjs --gate` | 9/9、新增 0 | **9/9、新增 0、本轮清掉 0** |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | 9 绿 / 2 红；快照 1627 / 活引用 2415 / 未入快照 788 / 空区间 3 | **9 绿 / 2 红**（红的 7 条假路径全是他人文档，本轮新增引用**全部指得到**）；活引用与未入快照数见收工前最后一次实测（§3 表末注） |
| ctest | 不适用 | **不适用：本轮没改 `native/`**（`git status --porcelain -- native/` 里的 `plugins.cpp/search.cpp/settings_schema.cpp/zipstore.cpp/git*` 都是别的路） |
| `npm test`（全量） | 未跑 | **未跑**（规约 §5：12 路并行只跑自己域） |

## 4. 反向验证记录（新门禁三步）

本轮新增门禁 = `tests/console-ansi.test.mjs` 的 23 条（含 1 条消费链断言）。

1. **注入两处真语义**：
   (a) `src/consoleAnsi.ts` 的 `decodeIndexedColor` 把 `index >= 16 && index <= 255` 改成 `index >= 16`
   （等于摘掉上游 `decode8BitColor` 的越界返回 null，`AnsiTerminalEmulator.java:424-434`）；
   (b) `src/runIssues.ts` 把 `...(chunks.length > 0 ? { chunks } : {})` 改成无条件 `chunks,`
   （等于让没样式的行也走新分支，破坏「旧渲染路径零变化」那条承诺）。
2. **红**：`node --test tests/console-ansi.test.mjs` → `tests 23 / pass 21 / fail 2`，
   红的正是「38;5;n 越界与 38 缺参数：等于没设色」与「消费链：行样式在 runIssues 里就挂上…」。
3. **撤**：两处逐字还原 → `node --test tests/console-ansi.test.mjs` → **23/23**；
   域内四族 + module-size → **220/220**；`npx vue-tsc -b --force` → 0 错。

另：既有约束本轮特意没碰 —— `tests/console-hyperlinks.test.mjs:138/141/146/148` 钉着的
`const segments = consoleSegments(text, splitRunLine(text, links), props.isDesktop)`、
`hyperlinked: segments.some(...)`、`v-else-if="segment.url" class="run-issue-link"`、
`@contextmenu.prevent="openLinkMenu(segment.url, $event)"` 四条（模板变量名沿用 `segment`、
`:style` 加在 `class` 之后，断言体一字未动），以及 `tests/run-filters.test.mjs:123` 的
`jumpLink(segment.link)`。

## 5. 零消费方自查结论

- `src/consoleAnsi.ts` 的导出逐个查消费方：
  `createConsoleAnsiDecoder` ← `src/runIssues.ts:12`（值 import）+ `:43`（调用）；
  `consoleAnsiCss`、`consoleAnsiStyleAt`、`ConsoleAnsiChunk` ← `src/components/RunConsole.vue:120`（值/类型 import），
  调用点 `:141-146`（pieces/leadingStyle）与模板 `:533`（`:style="consoleAnsiCss(chunk.style, consolePalette)"`）；
  `ConsoleAnsiStyle`/`ConsoleAnsiColor`/`ConsoleAnsiLine`/`ConsoleAnsiDecoder`/`ConsoleAnsiUnderline` 是这些真值的类型面；
  `CONSOLE_ANSI_INITIAL_STYLE`/`isInitialConsoleAnsiStyle` 被模块内部的「初始态就不产生片段」判定用着（`:318`），
  并被判据直接核对；`CONSOLE_ANSI_NOT_RENDERED` 是「为什么不画」的在册理由（判据那条点名 6 档），
  与 `RUNNER_VIEW_ACTIONS_NOT_PORTED` 同一先例；`consoleAnsiColorCss` 是 `consoleAnsiCss` 的取色内核（生产路径 `:362-363`）。
- **本轮删掉过一个只过自己测试的出口**：`stripAnsiEscapes` 写完发现生产侧没人调（面板吃的是 `ConsoleAnsiLine.text`），
  已连同那条判据一起删除，改成核对 `CONSOLE_ANSI_NOT_RENDERED` 在册情况 —— 不留「只过自己测试的死符号」。
- orphan 门实测：`已登记孤儿 9 / 基线 9 · 新增 0`。新文件没有登记进任何基线/豁免表。

## 6. `做不到 / 无法核实`

1. **做不到（他人测试面）**：`Runner.FocusOnStartup` —— 卡点具体：判定与渲染都在我的面（`src/runToolWindowLayout.ts`
   + `RunConsole.vue` 的「视图」弹层），但它现在被登记成 `RUNNER_VIEW_ACTIONS_NOT_RENDERED` 的第三条，
   而 `tests/runner-view-actions.test.mjs:105-113` 用 `deepEqual` 钉着那张表恰好三条；该文件不匹配派单给我的
   任何一个测试 glob（`tests/run-*` 不吃 `tests/runner-*`），**改它=踩别人的门** ⇒ 交 R3 请主代理拍。
2. **做不到（冻结文件）**：提权运行（`RunStartParams` 在 `src/settingsModel.ts:51`）、
   按色号自定义 ANSI 色（设置键 + 设置页要 `settingsModel.ts`/`settingsTreeMeta.ts`/`native/settings_schema.cpp`）、
   JAR 表单（`RunConfig.type`）。三条都已在请求里写清入口。
3. **做不到（缺宿主通道）**：逐浏览器菜单行（R1）—— 规则侧 `browserLaunchPayload`（`src/browsers.ts:377-386`）齐了，
   `shell.openUrlWithBrowser` 不在 `src/bridge.ts:109` 的 `Method` 里；本轮**没有**渲染那些行。
4. **做不到（架构不等价，如实记三处）**：见 `src/consoleAnsi.ts:96-103` —— 上游 stdout/stderr 各一台状态机而本仓只有一条
   输出通道；缓冲截头时最老几行的样式不追；一个片段一种样式、可点片段按起点取色。**没有**声称逐字复刻。
5. **无法核实**：`execution/process/elevation` 那一族的**具体类与行号**（本轮只按判词给的包名登记，没逐个开文件 ⇒
   不写假坐标）；`customFolding` 之类与本域无关的更不必说。
6. **无法核实**：IDEA 中文本地化包不在本地树 —— 本轮新增的用户可见文案只有 tooltip/样式属性，没有新句子；
   上一轮的「复制 URL」等文案出处仍按 `IdeBundle.properties` 直译（不在本轮改动里）。
7. **不做**：块终端的 OSC 133 命令块与颜色块（要自有渲染层）、大文件里的正则搜索提示（消费方不是我的面，
   单做模块就是死模块）。

## 7. 需要主代理接的线

单放 `docs/wiring-requests-2026-10-06-runterm2.md`：
R1 = 旧 T2（`shell.openUrlWithBrowser`：`src/bridge.ts:109` + `native/workspace.hpp:99` + `native/workspace.cpp` + `native/file_queries.cpp:236-239`，含可照抄整段与 welcome 那两条设置键的先后关系）；
R2 = 提权运行；R3 = `Runner.FocusOnStartup` 的测试归属（附「原写 X、实际 Y」的订正）；R4 = 大文件三项的归属登记；
末尾附**引用门那 2 条红的 7 条假路径清单**（全在他人文档，按 §6 不代改）。
本轮**没有**新增设置键、没有新增动作 id、没有改 `CMakeLists.txt`、没有新 `native/*.cpp`。
