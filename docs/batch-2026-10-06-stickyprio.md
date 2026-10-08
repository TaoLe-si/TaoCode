# 批 2026-10-06 · 代号 `stickyprio`（粘性行：视图优先级 + 多分栏各一份的**模块侧**缺项）

只动 `src/stickyLines.ts`、`tests/sticky-lines.test.mjs`、`tests/sticky-line-viewport.test.mjs`；
保留文件一行未改 ⇒ 宿主那一半写在 `docs/wiring-requests-2026-10-06-stickyprio.md`（W1/W2/W3）。

## 一、上一任落到哪一步（先 `git diff` 读磁盘，不重做）

`src/stickyLines.ts` 的上一条 lane（未提交的工作区改动）只落了**一件事**：退化路径的裁剪方向
从 `slice(-N)` 改成 `slice(0, N)`（留最外 N 条），并把它两条 sticky 测试的期望同步翻了
（`['load','tiny']`→`['Config','load']`、`['load','Inner']`→`['Config','load']`），加了
「limit 小于层数时两路同向」那条判据。**没落的就是本批这一件**：
`createStickyLines` 这个**宿主唯一入口**仍然只收一块 `view`、只吐一份列表 ——
视口模块里的 `orderStickyViews` / `primaryStickyView` / `stickyLinesPerView`（`hier3` 那轮已提交）
在入口上接不到，`src/App.vue:544` 因此永远只能拿到「按聚焦栏算的一份」，多分栏各一份做不成。

## 二、本批补的那一项（模块侧）

- `StickyLinesDeps` 加 `views?: () => StickyView[]`（一块面板一项）与 `currentLineOf?: (viewId) => number | undefined`
  （退化路径也要各栏各自的光标行）；只给旧 `view` 时等价于 `views: () => [view]`。
- 出口 `createStickyLines` → `{ stickyLines, stickyLinesByView }`（新增 `StickyLinesResult`）：
  `stickyLinesByView` 每块面板按**自己的**顶行各算一份，**键序 = `orderStickyViews` 的稳定序**；
  `stickyLines` = `primaryStickyView` 那块的那一份（本仓顶边只有一个容器）；
  一块面板身份都不给时保持原来的按光标行退化路径（旧调用方行为逐字不变）。
- 两道闸门（`showStickyLines`/`stickyLinesLimit`/按语言表）收进一个 `gate` computed ⇒
  两份出口同一条命，不会一边画一边不画。
- 每栏候选**按本栏顶行现取**（`stickyWindowScopes`），没有把几栏塞进 `stickyLinesPerView` 的共享候选池：
  上游那一刀判的是「起始行滚出了**这一块**面板的顶边」，共享池会把「本栏还看得见起始行」的层也钉一遍。
  `stickyLines.ts` 145→258 行。

## 三、上游核对（逐行 `sed -n` 开参考树，行号是本轮自数）

- `StickyLinesManager.kt:15-34`（`:15` `internal class StickyLinesManager(private val editor: Editor, …)`、
  `:32` `editor.scrollingModel.addVisibleAreaListener(this, this)`）+ `:86-99`（`visibleAreaChanged` 只驱动自己那块）
  ⇒ **每个编辑器一块面板、各算各的**；`StickyLinesModelImpl.java:93-100` ⇒ 模型挂在**文档**的 MarkupModel userData 上
  ⇒ 同文档两栏共享层、显示各一份 —— 本批出口就是这个形状。
- `VisualStickyLines.kt:134`（`if (startY2 < stickyY && stickyY <= endY2)`）、`:145`（`withYLocation.size >= lineLimit` 后 `break`）、
  `:111` `visualLines.sort()` + `VisualStickyLine.kt:21-27`（primaryLine 升序、同起点 scopeLine 降序）
  ⇒ 裁的是最内那一条（与上一任那条方向一致，未翻回来）。`StickyLinesCollector.kt:36-51`/`:77-79` 复核无误。
- **无法核实**（不编）：跨视图的先后。本轮对 `platform/platform-impl/src/com/intellij/openapi/editor/impl/stickyLines/`
  与 `platform/lang-impl/src/com/intellij/codeInsight/stickyLines/` 两目录 grep `priority` ⇒ **零命中**（count 0）。
  ⇒ 档位只能由宿主给（`StickyView.priority`），模块只做稳定序；文件头与 `views` 的注释都标了这条留痕。
  任务里说的 `platform/editor-ui-impl` 在这棵树里**不存在**（只有 `platform/editor`、`editor-ui-api`、`editor-ui-ex`；
  stickyLines 一族在 `platform-impl` 与 `lang-impl`），照实际路径核。

## 四、判据与反向验证

- `node --test tests/sticky-lines.test.mjs tests/sticky-line-viewport.test.mjs tests/module-size.test.mjs`
  ⇒ **tests 30 / pass 30 / fail 0**（两个 sticky 文件 25 条 + module-size 5 条）。
  新增 4 条：两块面板按各自顶行各算一份 + 键序按档位；退化路径按 `currentLineOf` 各栏一份；
  向后兼容（单 `view` / 不给 `view` / 无面板却给了 `currentLineOf` 时不越界）+ 闸门同时清空两份出口；
  provider 白名单与上限对每块面板各自生效。
- 变异反证（每条改完必须红、复原后 md5 回到原值）：① 去掉 `orderStickyViews` ⇒ 键序那条红；
  ② `linesForView` 忽略 `currentLineOf` ⇒ 各栏一份那条红；③ `primaryStickyView` 改成 null ⇒ 4 条红。
- 类型：`npx tsc --noEmit --strict …src/stickyLines.ts`（不写任何产物）⇒ 0 错。

## 五、留痕上报（两处，都要主代理知情）

1. **工具结果与磁盘不符**：`Read` 给我的 `src/stickyLines.ts:19` 是「保留**下面这条**按光标行的退化路径」，
   磁盘（`node` 直读 + `md5sum`）是「保留**上面这份**…」——4 个字不同，导致我前两次 `Edit` 落空。
   不是指令、也没执行任何东西，但它说明**行内文本必须以磁盘为准**；本批所有锚点之后都改用 `node` 逐行取原文。
   同一轮里 `src/App.vue:2191`（模块注释原写的粘性行渲染行号）磁盘实为 **2172/2173** ⇒ 已在本文件里重订并注明。
2. **我自己的 `sed` 误伤（已复原）**：反证②复原时用 `sed -i` 全局替换 `const line = deps.currentLine()`，
   把无面板那条退化路径也一并改了（引入了不在作用域里的 `view.id`）。当场 `md5sum` + 复读发现后已用 `Edit`
   改回原句，并补了一条判据（没有面板身份时不许问 `currentLineOf`）钉住这个形状。此后复原一律用 `Edit` 不用 `sed`。

## 六、仍未闭环（不是本批范围）

- 宿主实参：W1 `CodeEditor.vue` 透度量（含**怎么腾那 3 行**的三条实测办法）、W2 `App.vue` 给 `views`/`currentLineOf`
  与按栏渲染、W3 判词那一行（`scripts/verdict_table.py:321` / `docs/inventory/verdict-platform_rest.md:362`，归主代理）。
- `stickyPassNeeded`（daemon 合帧）在入口上还没被调：它要的是「每个视图第一次必跑」的**驱动**，属宿主接线，未做假控件。
