# 批次报告 · 终端族第二轮（代号 `terminal2`，2026-10-06）

派单：**主任务** = 控制台/终端里的超链接；**收尾** = 补完上一轮（代号 `terminal`）留在 `docs/` 里未落的两份文档。

## 0. 量现场（动手前的实测，全部原样保留）

| 命令 | 结果 |
| --- | --- |
| `git status --porcelain -- src/terminal* src/components/TerminalPanel.vue src/console* native/terminal*` | `M src/components/TerminalPanel.vue`、`M src/terminalClipboard.ts`、`?? src/terminalHyperlinks.ts`、`?? tests/terminal-hyperlinks.test.mjs`；`native/terminal*` **无改动** |
| `npx vue-tsc -b --force` | 0 错 |
| `node --test tests/terminal-*.test.mjs tests/console-*.test.mjs tests/run-*.test.mjs tests/module-size.test.mjs` | **176/176 通过、0 失败** |
| 三个语法检测器 + orphan 门 | 0 处参数属性 / `.mjs` 全 JS / 无漏扩展名 / 孤儿 9=基线 9、新增 0 |
| 引用双门 | 11/11 绿；快照 1627 / 活引用 1978 / 未入快照 351 / 区间为空 3 |

**结论（与派单给出的「最后一句是现在写终端超链接模块」不同，留痕）**：上一轮不是只写了模块，
它把**终端那一族的超链接 + 两条鼠标行为全部落完并接线**了（`src/terminalHyperlinks.ts` 234 行、
`src/components/TerminalPanel.vue` 里 link provider / OSC 8 handler / 中键 / 选中即复制四处接线、
15 条判据），门禁全绿。**没有半截文件、没有死代码需要删** —— 逐个导出符号 grep 过消费方（见 §5 与本仓
`docs/batch-2026-10-06-terminal.md` §5）。真正缺的只有那两份文档（`terminal` 那轮的批次报告与接线请求，
且 `src/terminalHyperlinks.ts:52` 正在引用后者）⇒ 已补完。

**派单给的坐标是假的（已按假路径处理，不写进任何生产代码）**：
`platform/ide-impl/src/com/intellij/execution/console/` 这个目录在参考树里**不存在**
（控制台那族文件在 `platform/lang-impl/src/com/intellij/execution/console/`，该目录下**没有**任何名字含
Hyperlink 的文件），`ConsoleViewHyperlinkImpl` 这一类也搜不到（全树 `find -iname "ConsoleViewHyperlink*"` 为空）。
真正的落点（逐个开过）：
- 控制台 URL 过滤器：`platform/execution-impl/resources/intellij.platform.execution.impl.xml:63`
  的 `<consoleFilterProvider implementation="com.intellij.execution.filters.UrlFilter$UrlFilterProvider"/>`，
  provider 本体 `platform/execution-impl/src/com/intellij/execution/filters/UrlFilter.java:152-161`；
- 构建控制台再显式挂一次：`java/compiler/impl/src/com/intellij/compiler/progress/BuildOutputService.java:131`；
- OSC 8 **只长在终端里**（全树带 `OSC8` / `]8;;` 字样的实现文件都在 `plugins/terminal/**` 与
  `platform/execution-impl/src/com/intellij/terminal/Osc8UrlHyperlinkFilter.kt`）⇒ 控制台不解析 OSC 8。

**既有契约（先读后复用，没重算）**：`src/terminalHyperlinks.ts`（区间/落点/能否点开）、
`src/runHyperlinks.ts`（`findRunHyperlinks` + `splitRunLine`，`file:line` 那一族）、
`src/buildOutput.ts` 的 `RunIssue`（1 基）与 `normalizeRunPath`、`src/components/AnchoredMenu.vue`（弹层外壳）、
`src/clipboard.ts` 的 `copyToClipboard`。本轮**没有新增任何正则、协议表、解码或前缀判定**。

## 1. 判词表（族：控制台/终端里的超链接）

| # | 项 | 判定 | 上游相对路径:行号 | 本仓落点 | 一句话说明 |
| --- | --- | --- | --- | --- | --- |
| 1 | 控制台一行里的 URL 命中可点 | `[x]` 本轮新做 | `intellij.platform.execution.impl.xml:63` + `UrlFilter.java:152-161`、`:54-79` | `src/consoleHyperlinks.ts:105-125`（`consoleUrlLinks`） | 复用 `terminalHyperlinkRanges`/`terminalLinkTarget`，不重算判定 |
| 2 | 控制台里的 `file:` 命中跳编辑器 | `[x]` 本轮新做 | `UrlFilter.java:89-92`、`:94-123`（0 基行列）、`:164-201`（`FileUrlHyperlinkInfo`） | `src/consoleHyperlinks.ts:90-92`（`jumpPayload`）与 `:105-125` 里的 file 分支 | 控制台**有** jump 通道（面板既有 `emit('jump')`，`src/App.vue:2206` 已接），所以这一支在控制台能落地——正是终端面板做不到的那一条（`terminal` 那轮的 T1） |
| 3 | 链接与既有 `file:line` 一族合成一张切片表 | `[x]` 本轮新做 | 上游两个过滤器同层挂区间（`CompositeFilterWrapper.java:57-59`） | `src/consoleHyperlinks.ts:127-155`（`consoleSegments`） | 组件仍先调 `splitRunLine(text, links)`（`src/components/RunConsole.vue:139`），本层只把**纯文本段**再切一次；无命中时排法与旧表逐字段相同（判据钉住） |
| 4 | 单击即跳（控制台不吃 Ctrl） | `[x]` 本轮新做 | `platform/platform-impl/src/com/intellij/execution/impl/EditorHyperlinkSupport.java:113-130`（BUTTON1、按下与抬起同点）、`:254-279` | `src/consoleHyperlinks.ts:95-97`（tooltip 文案无 Ctrl）、面板 `:165-169` | 与终端那一侧（Ctrl/⌘+单击，xterm 手势）**故意不同**，两条都有上游依据 |
| 5 | 两类落点同一个样式 | `[x]` 本轮新做 | `EditorHyperlinkSupport.java:425`（一律 `CodeInsightColors.HYPERLINK_ATTRIBUTES`） | 面板 `:416`（URL 片段复用 `.run-issue-link`） | 没有自加「外链」颜色/图标 |
| 6 | 链接的右键菜单（`HyperlinkWithPopupMenuInfo`） | `[x]` 本轮新做（部分见 #7） | `platform/execution-impl/src/com/intellij/execution/filters/HyperlinkWithPopupMenuInfo.java:24-27`；`OpenUrlHyperlinkInfo.java:44-67`；`UrlFilter.java:197-200`（文件命中委派给同一个菜单） | `src/consoleHyperlinks.ts:180-185`（`consoleLinkMenuItems`）、面板 `:180-189`（状态与派发）、`:416`（`@contextmenu.prevent`）、`:437-441`（弹层） | 全树只有那两个类实现这个接口 ⇒ 只给 URL 命中挂菜单，既有 `file:line` 那一族（上游 `MultipleFilesHyperlinkInfo`）不挂，交互不变 |
| 7 | 逐浏览器那几行 | `[ ]` 未做（通道缺） | `OpenUrlHyperlinkInfo.java:44-56`（逐个活动浏览器）、文案 `platform/platform-api/resources/messages/IdeBundle.properties:1048` | 无 | `shell.openUrlWithBrowser` 还没进 `src/bridge.ts:109` ⇒ 渲染出来是假控件；已登记 `docs/wiring-requests-2026-10-06-terminal.md` T2 |
| 8 | 「复制 URL」那一行 | `[x]` 本轮新做 | `OpenUrlHyperlinkInfo.java:58-65`、`IdeBundle.properties:1263`（`Copy URL`）与 `:1264`（说明） | `src/consoleHyperlinks.ts:183`、面板 `:188` | 文案直译「复制 URL」「将 URL 复制到剪贴板」。**留痕**：派单与本层文件头一度写成「复制 URL 路径」，实际 bundle 是 `Copy URL`（`IdeBundle.properties:1263`），已按真文案落 |
| 9 | 宿主打不开链接时如实播报 | `[x]` 本轮新做 | 上游没有对应控件（`BrowserLauncher` 自己吞异常），本仓沿组件既有同一模式 | 面板 `:158`（`consoleNote`）、`:171-174`、`:406`（`role="status"`） | 与同组件的 `coverageNote`、`processNote` 同一形状，只在真出错时出现 |
| 10 | 控制台解析 OSC 8 | `[-]` 不适用（具体理由） | 全树 OSC 8 实现只在 `plugins/terminal/**` 与 `platform/execution-impl/src/com/intellij/terminal/Osc8UrlHyperlinkFilter.kt`；`platform/lang-impl/src/com/intellij/execution/console/` 下无 hyperlink 类 | 无 | 上游控制台**不**解析 OSC 8（运行输出的 OSC 由 `ConsoleView` 那条链不吃），所以这不是缺口 |
| 11 | 链接判定异步 + 限流 | `[-]` 不适用（理由同上一轮） | `JediTermHyperlinkFilterAdapter.kt:49`、`:58`、`:97`、`:115` | `src/consoleHyperlinks.ts` 文件头「与架构不等价」那一段 | 本仓切片渲染在 computed 里同步做一次，xterm/控制台都不存在「后台按行算」这一层 |
| 12 | 终端半边（#1-#5 的终端版） | `[x]` 上一轮已做，本轮**未动** | 见 `docs/batch-2026-10-06-terminal.md` §1 | `src/terminalHyperlinks.ts`、`src/components/TerminalPanel.vue` | 本轮只读复用；`tests/terminal-hyperlinks.test.mjs` 15 条仍全绿 |

## 2. 改动文件清单（wc -l 前后）

| 文件 | 本轮前 | 本轮后 | 说明 |
| --- | --- | --- | --- |
| `src/consoleHyperlinks.ts` | 不存在 | **185** | 新增（上限 900） |
| `tests/console-hyperlinks.test.mjs` | 不存在 | **153** | 新增判据：12 条用例 |
| `src/components/RunConsole.vue` | 417（HEAD）/ 458（工作区，含他路在途的「正在运行」清单） | **523** | 本轮净 +65：切片改走 `consoleSegments`、URL 片段分支、右键菜单、`consoleNote` |
| `docs/batch-2026-10-06-terminal.md` | 缺 | 93 | 收尾：替 `terminal` 那轮补完 |
| `docs/wiring-requests-2026-10-06-terminal.md` | 缺（且 `src/terminalHyperlinks.ts:52` 正在引用它） | 111 | 收尾：补 T1/T2，含可照抄的 `src/App.vue:2248` 替换段 |
| `docs/batch-2026-10-06-terminal2.md` | 缺 | 本文件 | 交付 |

**未动**：`src/terminalHyperlinks.ts`、`src/terminalClipboard.ts`、`src/components/TerminalPanel.vue`、
`src/runHyperlinks.ts`、`src/runIssues.ts`、任何 `native/**`、任何保留文件。
`git diff` 自查：`RunConsole.vue` 的 hunk 全在 header/import/`DisplayLine`/`displayLines`/链接动作/输出行/样式这几处，
别人在途的「正在运行」清单那几个 hunk 一字未动（本轮前该文件的工作区 diff 共 46 行改动，
本轮后 `git diff --numstat` = `113 7`，多出来的全是本轮的）。

## 3. §5 每条自查命令的前后数字

| 命令 | 前（本轮动手前） | 后（收工） |
| --- | --- | --- |
| `npx vue-tsc -b --force` | 0 错 | **0 错** |
| `node --test tests/terminal-*.test.mjs tests/console-*.test.mjs tests/run-*.test.mjs` | 176（含 module-size 的 5 条） | **183 + 5 = 188**，0 失败 |
| `node --test tests/console-hyperlinks.test.mjs`（本轮新判据） | —— | **12/12** 通过 |
| `node --test tests/module-size.test.mjs` | 5/5 绿 | **5/5 绿**（新文件 185/153/523，全在上限内；上限未改、无豁免） |
| `node .tools/find-param-props.mjs` | 0 处 | **0 处** |
| `node .tools/find-ts-in-mjs.mjs` | 干净 | **干净** |
| `node .tools/find-missing-ext.mjs` | 干净（1257 个文件） | **干净**（1261 个文件：本轮 +2 文件、他路 +2） |
| `node .tools/find-orphan-modules.mjs --gate` | 9/9、新增 0 | **9/9、新增 0、本轮清掉 0** |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | 11/11；快照 1627 / 活引用 1978 / 未入快照 351 / 空区间 3 | **11/11**；快照 1627 / 活引用 **2030** / 未入快照 **403** / 空区间 **3**（新增的都是本轮真开过的文件行号；这两个计数把本份报告自己写的引用也算在内，收工前最后一次的实测值） |
| ctest | 不适用 | **不适用：本轮没改 `native/`**（`git status --porcelain -- native/terminal*` 为空；在途的 `native/git*.cpp`、`search.cpp`、`zipstore.cpp` 不属于本域） |
| `npm test`（全量） | 未跑 | **未跑**（按规约 §5 最后一条：12 路并行时只跑自己域，免得把他路在途红算进来） |

## 4. 反向验证记录（新门禁三步）

本轮新增的「门禁」是 `tests/console-hyperlinks.test.mjs` 的 12 条用例（含 1 条读面板源码的消费链断言）。

1. **注入**：两处各改一个真实语义 ——
   (a) `src/components/RunConsole.vue` 的 `consoleSegments(text, splitRunLine(text, links), props.isDesktop)`
   第三参改成常量 `true`（等于把「点不开的不画成链接」的门摘掉）；
   (b) `src/consoleHyperlinks.ts` 的 `terminalLinkActivatable(target, desktop)` 第二参改成常量 `true`
   （等于让浏览器预览也画链接）。
2. **红**：`node --test tests/console-hyperlinks.test.mjs` → `tests 11 / pass 9 / fail 2`，
   红的正是两条对应判据：「点不开的命中不画成链接…」与「消费链：面板用这一层的切片表…」。
   （注入时用例总数还是 11，因为菜单那条尚未加。）
3. **撤**：两处逐字还原 → `node --test tests/terminal-*.test.mjs tests/console-*.test.mjs tests/run-*.test.mjs
   tests/module-size.test.mjs` → **188/188、0 失败**；`npx vue-tsc -b --force` 0 错。

另外两条**不是**本轮新增门禁、但防的是同一类事故的既有约束，本轮特意没去碰：
`tests/run-filters.test.mjs:119` 钉着 `RunConsole.vue` 里有 `splitRunLine(text, links)` 这个调用点
（⇒ 面板现在仍是先 `splitRunLine` 再交给 `consoleSegments`，断言体一字未动），
`tests/terminal-hyperlinks.test.mjs` 的 15 条终端判据（⇒ 终端那一族的可见行为一字未动）。

## 5. 零消费方自查结论

- `src/consoleHyperlinks.ts` 的 4 个导出函数：`consoleUrlLinks`、`consoleSegments`、`consoleLinkAction`、
  `consoleLinkMenuItems` —— 全被 `src/components/RunConsole.vue:66`（值 import）引入并各有调用点：
  `:139`（切片）、`:167`（派发）、`:439`（菜单条目）。`ConsoleLinkAction` 这个联合类型不作为独立导出
  （避免只过自己测试的死符号）。判据引用在 `tests/console-hyperlinks.test.mjs` 顶部那条 import。
  **不是零消费方**（orphan 门「新增 0」实证）。
- 面板新增的 `hyperlinked` 字段只有一个消费点（输出行的 `v-if`），`linkMenu`/`consoleNote` 亦然 ⇒ 无悬空状态。
- 没有新文件被登记进任何基线/豁免表。

## 6. `做不到 / 无法核实` 清单

1. **做不到（缺宿主通道）**：逐浏览器的菜单行（#7）。卡点具体：`src/bridge.ts:109` 的 `Method` 里没有
   `shell.openUrlWithBrowser`；折算规则与请求体本仓已备（`src/browsers.ts:336-372`），通道要动的五个文件
   全是保留文件 ⇒ 已登记，不重复写请求正文。
2. **做不到（保留文件）**：终端面板 `file:` 链接跳编辑器（上一轮的 T1）。本轮**没有**替它改 `src/App.vue`，
   只把可照抄的替换段与验收判据写进 `docs/wiring-requests-2026-10-06-terminal.md`。
   顺带给了一条参照实现：控制台这一支已经跑通（同一套 0→1 基换算、同一个 `jumpToIssue`）。
3. **偏离上游、如实记的有两处**（不是「没做」，是架构不等价）：
   (a) 重叠区间的择一：上游点击时取「同层更短的那条」
   （`EditorHyperlinkSupport.java:305-312` + `platform/platform-impl/src/com/intellij/openapi/editor/impl/view/IterationState.java:894-897`），
   本仓切片渲染一格一动作 ⇒ 改成建表时「与文件位置区间重叠的 URL 命中丢掉」，
   并明确写了**不声称**复刻上游那条；两族模式实际不相交（`src/runHyperlinks.ts:31` 的路径字符类与 `:49-50` 的前置字符门），
   所以可见行为不变（判据里用一条手造的重叠用例把这条政策钉住）。
   (b) 右键菜单的 Esc / 焦点归还：本仓这类行内弹层（终端面板的粘贴历史菜单同一形状）只做了
   「点外面关闭」，注册进 `src/popupStack.ts` 的弹层栈要另开一层，本轮没做 ⇒ 记为未做，不自作主张改邻域。
4. **无法核实**：`jumpToIssue` 的下游 `revealLocation`（`src/lspNavigation.ts:286`）对
   **工作区外绝对路径**的处理细节——它本来就是既有 `file:line` 链接的同一通道（`normalizeRunPath`
   对工作区外的路径原样保留绝对形式），本轮没有新增风险，但也**没有**为 `file:` 命中额外查磁盘存在性
   （上游也不查：`UrlFilter.java:186-195` 是点开才弹「找不到文件」）。
5. **无法核实**：IDEA 中文本地化包不在本地树 ⇒ 菜单两行的文案按英文原文直译（`Copy URL` → 「复制 URL」），
   已按规约在注释里注明出处（`IdeBundle.properties:1263-1264`）。

## 7. 需要主代理接的线

单放 `docs/wiring-requests-2026-10-06-terminal.md`（T1 终端 `file:` 跳编辑器 / T2 逐浏览器菜单行）。
本轮**没有**新的挂点、键位、设置键需求：控制台的 URL 链接复用既有 `@jump`（`src/App.vue:2206`）与
既有 `shell.openUrl`（`src/bridge.ts:109`），不新增注册项、不改 `CMakeLists.txt`。
（代号 `terminal2` 名下无独立接线请求文件，避免把同一件事写两份。）
