# 批次报告 · 终端族第一轮（代号 `terminal`，2026-10-06）

> **这份文档是补落盘的**（留痕）：`terminal` 那一轮在 150 次工具调用上限被切断，
> 最后一句是「现在写终端超链接模块」，但它其实已经把终端超链接那一族**全部落完并接线**了
> （模块 + 判据 + 面板三处接线 + 两条鼠标行为），只是这份报告和
> `docs/wiring-requests-2026-10-06-terminal.md` 没来得及写。
> 代其收尾的是第二轮代理 `terminal2`（派单第 3 条「把它留在 docs 里未落的两份文档补完」）。
>
> **可信度口径**：下表每一条上游坐标都是 `terminal2` **自己重开文件数过行号**的
> （`UrlFilter.java` 全文、`URLUtil.java:40-62`、`Osc8UrlHyperlinkFilter.kt`、`JBTerminalWidget.java:85-92`、
> `JediTermHyperlinkFilterAdapter.kt:47/49/56-58/96-97/115/131-141`、`CompositeFilterWrapper.java:52-62`、
> `JBTerminalSystemSettingsProviderBase.java:295-304`、`OpenUrlHyperlinkInfo.java:44-72`）——
> 逐条对得上，没有发现编的行号。门禁数字是 `terminal2` 接手时（本轮动手**前**）在当前工作区实测的。
> 控制台那一半不在本份里，见 `docs/batch-2026-10-06-terminal2.md`。

## 1. 判词表

族 = 派单给的 `ex/terminal` 剩下的可见项 + 「控制台/终端里的超链接」的**终端**半边。
判定标记：`[x]` 已做 · `[~]` 部分（写「本仓已有」+「还差」）· `[ ]` 未做 · `[-]` 不适用（给具体理由）。

| # | 项 | 判定 | 上游相对路径:行号 | 本仓落点 | 一句话说明 |
| --- | --- | --- | --- | --- | --- |
| 1 | 终端装两层链接过滤器（普通链接 + OSC 8） | `[x]` | `platform/execution-impl/src/com/intellij/terminal/JBTerminalWidget.java:87-90` | `src/components/TerminalPanel.vue:497`（`linkHandler` 构造参数）、`:494`（`attachLinkProvider(instance)`） | 同一件事在本仓是 xterm 的 `registerLinkProvider` + `linkHandler` |
| 2 | OSC 8 的 URI 要再过一遍 URL 判定 | `[x]` | `platform/execution-impl/src/com/intellij/terminal/Osc8UrlHyperlinkFilter.kt:11`（`delegate = UrlFilter(project)`）、`:13-17`（`apply(line)`） | `src/terminalHyperlinks.ts:226-228`、面板 `:390-401`（`osc8LinkHandler`） | 不是「协议里写了什么就照开」；总是装自己的 handler，绕开 xterm 默认的 `confirm` + `window.open` |
| 3 | 行内 URL 与 `file:` 的区间判定 | `[x]` | `platform/execution-impl/src/com/intellij/execution/filters/UrlFilter.java:44-52`、`:54-79`；`platform/util/src/com/intellij/util/io/URLUtil.java:50`、`:52`、`:60-62` | `src/terminalHyperlinks.ts:72-120` | 两条预检（`canContainUrl` 与 `isPotentialUrl`）与「先 `file:` 后 URL」的次序原样搬 |
| 4 | 命中的落点两分支（文件 / 浏览器） | `[x]`（判定）· `[~]`（终端可见行为） | `UrlFilter.java:89-92`、`:94-123`（`.html` 不当文件、`":行"`/`":行:列"` 只在整数时算、冒号要在协议前缀之后） | `src/terminalHyperlinks.ts:167-199` | **还差**：面板没有编辑器通道 ⇒ `file:` 命中被判成「点不开」不画（接线请求 T1） |
| 5 | 协议前缀 / `/C:/x` 去前导斜杠 / 百分号解码 | `[x]` | `UrlFilter.java:125-133`、`:135-141`、`:143-150` | `src/terminalHyperlinks.ts:128-150` | 坏转义不抛错、照原文（`decode` 的那个 catch） |
| 6 | 点开 = 交给浏览器 | `[x]` | `platform/execution-impl/src/com/intellij/ide/browsers/OpenUrlHyperlinkInfo.java:69-72`（`navigate` = `BrowserLauncher.browse`） | `src/components/TerminalPanel.vue:347-352` | 本仓唯一出口 `shell.openUrl`（`src/bridge.ts:109`） |
| 7 | 逐浏览器的右键菜单 | `[ ]` | `OpenUrlHyperlinkInfo.java:44-56`（逐个活动浏览器一行）、`:58-65`（复制那行） | 无 | 宿主没有「用指定程序打开 URL」的通道（`src/browsers.ts:159`），画出来就是假控件 ⇒ 接线请求 T2 |
| 8 | 过滤器合成（自定义 + 项目预置，全部都要跑） | `[~]` | `platform/execution-impl/src/com/intellij/terminal/CompositeFilterWrapper.java:57-59`（`ContainerUtil.concat` + `setForceUseAllFilters(true)`） | 本仓已有：`src/terminalHyperlinks.ts:109-120`（两族命中并成一张表）。**还差**：没有「用户/项目注册的额外过滤器」注册表可 concat ⇒ 并集只有本仓内置这两条 | xterm 的 `ILink.range` 一格只能挂一条 ⇒ 区间交叠时保留先算出的那条（`src/terminalHyperlinks.ts:102-108` 写了这条偏离） |
| 9 | 链接判定异步 + 限流 + 过期行不算 | `[-]` 不适用（具体理由） | `JediTermHyperlinkFilterAdapter.kt:49`（`Channel(MAX_BUFFERED_REQUESTS, DROP_OLDEST)`）、`:58`（`limitedParallelism(1)`，注释 `:56-57`「超链接是附加功能，不能吃 CPU」）、`:97`（`lineInfo.line ?: return null`）、`:115`（`MAX_BUFFERED_REQUESTS = 10000`） | `src/terminalHyperlinks.ts:40-43` 的文件头第 1 条 | 本仓判定挂在 xterm 的 link provider 上，宿主本身就是「按行问一次、只在悬停那一行问」⇒ 队列/背压/过期行这三件事没有对应物。上游那层的**用户可见结果**（链接会稍后出现、不拖慢输出）由 xterm 的调用节奏给到 |
| 10 | 中键粘贴 | `[x]` | `platform/execution-impl/src/com/intellij/terminal/JBTerminalSystemSettingsProviderBase.java:302-304`（`pasteOnMiddleMouseClick()` 无条件 `true`） | `src/terminalClipboard.ts`（`terminalIsMiddleButton` / `terminalPasteOnMiddleClick`）+ 面板 `:334-341`、`:478-479`（捕获阶段 `addEventListener(…, true)`） | 在捕获阶段吃掉事件，否则 xterm 自己那条中键粘贴会再补一次（用户看到双份） |
| 11 | Linux「选中即复制」 | `[x]` | 同文件 `:297-299`（`copyOnSelect()` = `SystemInfo.isLinux`） | 面板 `:90-95`（`ON_LINUX` 判定）、`:457-463` | 只有 Linux 做；Windows/macOS 不做 —— 照上游同一个门，不把它当通用行为 |
| 12 | 链接动作再经终端动作包装（右键菜单里那几条是终端动作） | `[-]` 不适用（具体理由） | `JediTermHyperlinkFilterAdapter.kt:131-141`（`setNavigateCallback`；`HyperlinkWithPopupMenuInfo` 时 `expandGroup` → `TerminalActionUtil.createTerminalAction`） | 无 | 这条的存在前提是 #7 那个弹层；#7 落不了地，这里就没有消费方（做了就是只过自己测试的死代码） |
| 13 | 悬停提示（上游 hover 出 tooltip 与指针形状） | `[x]`（本仓等价） | 上游没有「一行 title」这个形状：hover 只在 `EditorHyperlinkSupport.java:141-148` 的 `mouseMoved` 里换 cursor | 面板 `:366-368`（`hover`/`leave` 写 `instance.element.title`） | 架构不等价 ⇒ 把动作写成一行 title；文案在 `src/terminalHyperlinks.ts:231-234`。**不是**上游逐字行为，已按「上游没有的中文不要编」的口径写成一句人话 |

## 2. 改动文件清单（wc -l 前后）

| 文件 | 本轮前 | 本轮后 | 说明 |
| --- | --- | --- | --- |
| `src/terminalHyperlinks.ts` | 不存在 | 234 | 新增：判定层（区间、落点、能否点开、OSC 8、tooltip） |
| `tests/terminal-hyperlinks.test.mjs` | 不存在 | 161 | 新增：判据（含 1 条读面板源码的消费链用例） |
| `src/components/TerminalPanel.vue` | 633（`git show HEAD:` 实数） | 720 | `+95/-4`：link provider、OSC 8 handler、中键粘贴、Linux 选中即复制 |
| `src/terminalClipboard.ts` | 190 | 217 | 三条判定函数（中键、粘贴门、选中即复制门） |

`git status --porcelain` 现场：前两个是 `??`（未跟踪 = 上一轮没 commit，本轮也不 commit），
后两个是 `M`。**没有半截文件**：本轮逐个符号 grep 过消费方（见 §5）。

## 3. §5 自查命令的数字（本轮动手前的基线，`terminal2` 实测）

| 命令 | 基线数字 |
| --- | --- |
| `npx vue-tsc -b --force` | 0 错 |
| `node --test tests/terminal-*.test.mjs tests/console-*.test.mjs tests/run-*.test.mjs tests/module-size.test.mjs` | 176/176 通过、0 失败 |
| `node --test tests/module-size.test.mjs` | 绿（`TerminalPanel.vue` 720 / 上限 900） |
| `node .tools/find-param-props.mjs` | 0 处 |
| `node .tools/find-ts-in-mjs.mjs` | 干净 |
| `node .tools/find-missing-ext.mjs` | 干净（1257 个文件） |
| `node .tools/find-orphan-modules.mjs --gate` | 已登记孤儿 9 / 基线 9 · 新增 0 |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | 11/11 绿；快照 1627 条 / 活引用 1978 条 / 未入快照 351 条 / 区间为空 3 条 |
| ctest（`npm run test:native`） | 不适用：`native/**` 没动（`git status` 里那批 `native/*.cpp` 属于 vcs/search/zipstore 几路） |

## 4. 反向验证记录

上一轮没跑「新门禁」的反向验证记录（报告被切断 ⇒ 无从取证）。
`terminal2` 复核时能确认的等价保证有两条：
1. `tests/terminal-hyperlinks.test.mjs:137-149` 那条消费链用例**只认行首语句**
   （注释里同样的代码文字骗不过正则 —— 这是本仓防「假绿」的写法，见 `tests/console-hyperlinks.test.mjs` 同一条款）；
2. `terminal2` 在自己的批次里对**同类**断言做了三步反向验证（注入 → 红 → 撤 → 绿，数字见
   `docs/batch-2026-10-06-terminal2.md` §4），用的正则风格就是这一族。
   ⇒ 上一轮那 15 条判据本身没有放松任何既有断言（本轮逐条读过：全是 `deepEqual`/`equal`/`match`，无放宽形状）。

## 5. 零消费方自查结论（本轮落地内容）

- `src/terminalHyperlinks.ts` 的 7 个导出：`terminalHyperlinkRanges`、`terminalLinkActivatable`、
  `terminalLinkTarget`、`terminalLinkTooltip`、`terminalOsc8Target` 被面板 `:38` 一次引入并各有调用点；
  `terminalLineMayContainUrl`、`terminalUrlWordPresent` 只被测试引用 ⇒
  它们**是** `terminalHyperlinkRanges` 的内部步骤被导出的结果（判据直接钉上游那两条预检），
  orphan 门按模块粒度判，面板 import 了这个模块 ⇒ 不算零消费方模块。
- `src/terminalClipboard.ts` 新增三函数各有面板调用点（`onMiddleClick` 两条、`onSelectionChange` 一条）。
- orphan `--gate`：基线 9 / 现状 9 / 新增 0 ⇒ 没有「只过自己测试的死模块」。

## 6. `做不到 / 无法核实` 清单

1. **无法核实**：上一轮当时的门禁数字与它自己有没有跑过反向验证（报告被切断，什么都没留）。
   本份 §3 是 `terminal2` 接手时的实测，不是当时的。
2. **做不到（缺宿主通道）**：#7 逐浏览器菜单。卡点具体在 `src/bridge.ts:109` 的 `Method` 联合类型里没有
   `shell.openUrlWithBrowser`（`src/browsers.ts:336-348` 把折算规则与请求体都写全了，只差通道本身）。
3. **做不到（保留文件）**：#4 的「还差」那半 —— 终端面板的编辑器通道要改 `src/App.vue` 的
   `<TerminalPanel>` 属性列表（一行），已写成 T1 并给了可照抄的替换段与验收判据。
4. **无法核实**：xterm 在同一格被多个 link provider 争用时的实际优先级
   （`node_modules/@xterm/xterm` 的 typings 没写这条），所以本仓只保证「一个 provider 内部顺序确定」。
5. **不适用**：#9 那层限流/队列、#12 的动作包装 —— 理由写在表里，不是「没来得及」。
