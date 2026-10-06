# 批次报告 · 2026-10-06 · vcslog3（Git 日志图形面：从模块接到组件）

派单：把上一轮 vcslog2 留在模块里的图形单元真正接到渲染面 —— 请求 1（折叠换成 `collapseLinearGraph`）、
请求 2（落 `stroke-dasharray` 与按 `graph.units` 逐行画）、请求 3（`row.process` 无宿主 ⇒ 不渲染，写证据）。
组件侧归本代理，宿主（`src/App.vue`）归主代理（本批**没有**需要宿主新接的线，见 §7）。

上游真源 = `D:\Backup\Downloads\intellij-community-master\intellij-community-master`，下面每条行号都是本代理
这一轮**亲自打开过**的文件（禁止搜网，未用任何网络调用）。

## 1. 判词表

| 族 | 项 | 判定 | 上游相对路径:行号 | 本仓落点 | 一句话说明 |
|---|---|---|---|---|---|
| 折叠语义 | 收起线性链要同时补那条 DOTTED 边 | `[x]` | `platform/vcs-log/graph/src/com/intellij/vcs/log/graph/collapsing/CollapsedActionManager.java:214-241`（`hideNode` `:230`、`createEdge(… DOTTED)` `:231`） | `src/components/VcsLogTable.vue:26-28`（`folded`）+ `:41`（`graph = folded.value.graph`） | 请求 1：折叠与建图一次成型，跨度边进图 ⇒ 折叠后两端不再是互不相连的两段 |
| 边线型 | `DOTTED` ⇒ `LineStyle.DASHED`，画师按 `isUsual` 决定实/虚 | `[x]` | `platform/vcs-log/graph/src/com/intellij/vcs/log/graph/impl/print/elements/EdgePrintElementImpl.kt:43-48`、`platform/vcs-log/impl/src/com/intellij/vcs/log/paint/SimpleGraphCellPainter.kt:127-134` | `src/vcsLogGraphRender.ts:94-96`（`dashed = style !== 'solid' && !hasArrow`）+ `src/components/VcsLogTable.vue:161-163` | 请求 2 最小档：虚线单元落成 `stroke-dasharray`；带箭头那一档上游仍用实笔 ⇒ 本仓照做 |
| dash 数值 | 一段 dash + 一段空刚好落在一个行高上 | `[x]` | `platform/vcs-log/impl/src/com/intellij/vcs/log/paint/SimpleGraphCellPainter.kt:219-229`（`getDashLength`） | `src/vcsLogGraphRender.ts:56-66`（`dashArray`） | 不抄字面量：竖直按 `ROW_H` 算 ⇒ `15 11`，斜边按两点距离算（原写 `3 2` 是本仓自造数值，已换成上游算法） |
| 按图谱显示 | 一行一格 = 那一行的 PrintElement 集合 | `[x]` | `platform/vcs-log/graph/src/com/intellij/vcs/log/graph/impl/print/PrintElementGeneratorImpl.kt:126-173`、`platform/vcs-log/impl/src/com/intellij/vcs/log/ui/table/GraphTableModel.kt:97-117` | `src/vcsLogGraphRender.ts:68-108`（`paintGraphRow`）+ `src/components/VcsLogTable.vue:44-45`（`paint`/`paintOf`）、`:154-166`（svg 只画 units 翻译出来的图元） | 请求 2 完整档：组件不再吃 `row.pass/down/up/stub`，改逐行吃 `graph.units` |
| 竖线 vs 弯线 | 两列相等 = 竖线（`:158-162`）；不等 = 画到邻行那一列的两倍长（`:163-169`） | `[x]` | `platform/vcs-log/impl/src/com/intellij/vcs/log/paint/SimpleGraphCellPainter.kt:147-170` | `src/vcsLogGraphRender.ts:84-93` + `src/components/VcsLogTable.vue:200`（`.graph { overflow: hidden }` 裁掉格外那一半） | 相邻两格各画自己那一半 ⇒ 在格边界中点处对接（判据见 §4 的对接不变量） |
| 终端箭头 | `TerminalEdgePrintElement` 两列同值、`hasArrow=true`；两翅从顶点转出 | `[x]` | `platform/vcs-log/graph/src/com/intellij/vcs/log/graph/impl/print/elements/TerminalEdgePrintElement.java:11-17`、`SimpleGraphCellPainter.kt:137-143`+`:201-202`+`:204-217` | `src/vcsLogGraphRender.ts:97-104`、`:110-121`（`arrowWings`） | 长边关档那一段竖线画成带箭头的终端段，翅长 = `0.3 * 行高` |
| 节点形状 | FILL 实心；带 `HEAD` 那一行换头节点单元（三层同心圆） | `[x]` | `platform/vcs-log/graph-api/src/com/intellij/vcs/log/graph/NodePrintElement.java:7-17`、`platform/vcs-log/impl/src/com/intellij/vcs/log/ui/table/GraphTableModel.kt:102-117`、`platform/vcs-log/impl/src/com/intellij/vcs/log/paint/HeadNodePainter.kt:19`+`:47-59`、`SimpleGraphCellPainter.kt:172-187` | `src/vcsLogGraphRender.ts:74-82` + `src/components/VcsLogTable.vue:164-165`、`:203-205`（`.head-gap` 底色跟着行状态） | HEAD 行外面多描一圈、中间挖出那一格的底色、里面再一个实心点 |
| 没有图信息 | `NO_GRAPH_INFORMATION` ⇒ `emptyList()`，一格都不画 | `[x]` | `platform/vcs-log/impl/src/com/intellij/vcs/log/ui/table/GraphTableModel.kt:97-100`、置位处 `platform/vcs-log/impl/src/com/intellij/vcs/log/history/FileHistoryFilterer.kt:243` | `src/vcsLogGraph.ts:208`（既有）+ `src/components/VcsLogTable.vue:27`（`graphInformation: true`） | 本仓日志面这一页恒有父子拓扑；上游那个置位者是**文件历史**那份 pack，本仓走 `git.fileHistory`（`src/projectExtras.ts:173`），不经过 `VcsLogTable` |
| 折叠动作进度 | `row.process`（正在收起…）要有 `performLongAction` 那种宿主 | `[-]` 不渲染 | `platform/vcs-log/impl/src/com/intellij/vcs/log/ui/actions/CollapseOrExpandGraphAction.java:78-90` | 证据：`src/components/VcsLogGraphOptions.vue` 全文不出现 `row.process`（只渲染 `title/description/disabled/on/run/command`，判据写在 `tests/vcs-log-graph-render.test.mjs` 最后一条） | 本仓折叠是同步的一页计算，没有进度条宿主 ⇒ 按「不放假控件」保持不渲染，文案仍钉在模型里 |
| 图形单元的形状（上一轮遗留） | 穿行行要发**上下两段**；两段引用同一对列 | `[x]` 本批补 | `PrintElementGeneratorImpl.kt:151-168`（同一支边 `if (down != null)` 与 `if (up != null)` 各 add 一次）、`:175-190`（邻行取列，查不到边就退到那个节点的列）、逐列形状对该仓自带期望文本 `platform/vcs-log/graph/testData/elementGenerator/manyNodes_out.txt` 核过 | `src/vcsLogGraph.ts:238-241`（pass 发 DOWN+UP）、`:29-40`（`up/pass` 新增 `above`）、`:168-174`（`aboveLane` 与 push） | **留痕**：原写「pass 只发 DOWN 一个单元 / up 的邻行列用边自己的车道」——按 units 渲染时长边中间行只剩下半截（梳齿）、相邻两段的列对不上（接不上）。两处都改了，断言体没放松 |

判词升档建议（`docs/inventory/verdict-vcs.md` 是保留文件，本代理没改，只给措辞）：
§G 里 `SimpleGraphCellPainter` / `HeadNodePainter` / `GraphTableModel.getPrintElements` 那几条的**渲染半**本批已落：
数据形状 + 逐行画（竖线/弯线/终端箭头/虚线/HEAD 三层点）都有判据 `tests/vcs-log-graph-render.test.mjs`（11 条），
可以从 `[-]`（Swing 画师本体不动）升到 `[~]`；`CollapseGraphAction`/`ExpandGraphAction` 保持 vcslog2 请求 4 的 `[x]` 措辞。

## 2. 改动文件清单（`wc -l` 前后）

| 文件 | 前 | 后 | 说明 |
|---|---|---|---|
| `src/components/VcsLogTable.vue` | 189 | 213 | 请求 1（`folded`/`graph`）+ 请求 2（svg 改吃 `paintGraphRow`，新增 `.graph{overflow:hidden}` 与 `.head-gap` 三条底色规则） |
| `src/vcsLogGraphRender.ts` | 新建 | 123 | 单元 → SVG 图元的几何（竖线/弯线/终端箭头/三层节点/dash 算法） |
| `src/vcsLogGraph.ts` | 352 | 373 | `up/pass` 加 `above`；pass 补 UP 单元；文件头与 `collapseLinearGraph` 注释从「待接线」改成「已接线」 |
| `tests/vcs-log-presentation.test.mjs` | 272 | 277 | 接线断言从「分两步」的旧形状改成「一次成型」的新形状（仍是逐字整段正则，未放松成 `includes`）+ 新增 `graph.units`/`stroke-dasharray` 两条 |
| `tests/vcs-log-graph-render.test.mjs` | 新建 | 215 | 本批判据（折叠虚线、units/rows 对齐、上下两段对接、dash 算法、终端箭头、HEAD 三层、图信息关档、边界、`row.process` 证据） |

保留文件（`src/App.vue`、`src/style.css`、`src/tokens.css`、`CMakeLists.txt`、`scripts/verdict_table.py`、
`docs/inventory/*.md`）一字未动；未 commit、未 push、未跑任何 git 丢弃命令。

## 3. §5 自查命令的前后数字

| 命令 | 改前 | 改后 |
|---|---|---|
| `node --test tests/vcs-log-graph-cells + presentation + menu + go-to-ref + filter-store` | 56 tests / 56 pass / 0 fail | 这五个文件 56 tests 全绿；加上本批新文件 `graph-render` 后 **67 tests / 67 pass / 0 fail**（再带 `tests/ui-icons.test.mjs` 一起跑 = 86 / 86 / 0） |
| `node --test tests/vcs-log-graph-render.test.mjs` | 文件不存在 | **11 tests / 11 pass / 0 fail** |
| `npx vue-tsc -b --force` | 本代理动手前未单独跑（12 路并行、别的文件在途）；本批改完后第一次跑：**2 错，全在 `src/runConfigTree.ts`**，非本域；中途一次：**4 错，全在 `src/lspNavigation.ts`**；收工时最后一次：**3 错 = `src/components/CodeEditor.vue` 2 条 + `src/editorSplitLine.ts` 1 条**，全是别的代理在途的文件（这一族数字在 12 路并行下每次跑都在变，所以三次都记下来）；`grep -E "vcsLog\|VcsLog"` 命中 **0 行** ⇒ 本域 0 错 |
| `node --test tests/module-size.test.mjs` | 5 / 5 pass | **5 / 5 pass**（上限未动：新文件 123 行、组件 213 行，都在 900 以下） |
| `node .tools/find-param-props.mjs` | — | **共 0 处参数属性** |
| `node .tools/find-ts-in-mjs.mjs` | — | **1 个文件含真 TS 语法** = `tests/run-anything-context-dialog.test.mjs:44`（别的代理在途），本批两个新/改文件都不在其名单里 |
| `node .tools/find-missing-ext.mjs` | — | 扫描 1316 个文件：**干净**（没有漏扩展名） |
| `node .tools/find-orphan-modules.mjs --gate` | 门禁绿：已登记孤儿 8 / 基线 8 / **新增 0** | 门禁红：**新增 1 = `src/editorSplitLine.ts`**（别的代理在途的编辑器模块，不在本代理文件面，未动）。本域结论见 §5 |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | 11 / 11 pass | 写本报告**前**一次：**11 / 11 pass**；写完后最后一次：**10 pass / 1 fail** —— 唯一红的是「已入快照的引用要与快照一致」，命中的两条都在 `docs/wiring-requests-2026-10-06-fix-macros.md`（macros 域，别的代理在本批收尾时改的），本批文档里的引用一条都没被点名；「每一条带路径的上游引用都指得到」这条仍然是绿的；锚点门控打印「快照 3009 条 / 仓里活引用 3179 条 / 未入快照 170 条 / 区间为空 0 条」——新增引用只报数不拦（本批带进去的新引用都指得到真文件真行，门控绿即证明） |
| `npm test` 全量 | 未跑（派单：12 路并行只跑自己域的测试） | 同 |
| ctest / `npm run test:native` | 不适用 | 本批**没有**改 `native/` 任何文件，也没有新建 `.cpp`（所以不需要 ctest，也不需要 CMakeLists 接线请求） |

## 4. 反向验证记录（注入 → 必须红 → 撤回 → 必须绿，且不留注入标记）

`tests/vcs-log-graph-render.test.mjs` 共 11 条，注入前后都跑这一个文件。

1. **退回「分两步」的接线**（把 `VcsLogTable.vue` 的 `graph` 换回 `buildLogGraph(visible.value, {showLongEdges…})`，
   并临时把 `buildLogGraph` 加回 import）⇒ **红 1 条**：
   `折叠真的把虚线接到组件上…` — `AssertionError: 折叠后 h1 行的下半段 + h4 行的上半段各一条虚线`，`actual: 0, expected: 2`。
   撤回（graph 改回 `folded.value.graph`、import 恢复）⇒ **11 pass / 0 fail**。
2. **删掉穿行行的上半段单元**（`src/vcsLogGraph.ts` 里 pass 那一支的 `pushEdge('up', …)` 一行删空）⇒ **红 1 条**：
   `穿行行两段都画…` — `行 0 的 DOWN(0->1) 在行 1 缺少镜像的 UP`。
   撤回 ⇒ **11 pass / 0 fail**（并把 sed 留下的空行一起清掉）。
3. **拆掉邻行取列的镜像**（把 `up`/`pass` 的 `edge.above` 换成 `edge.lane`）⇒ **红 1 条**：
   同一条对接判据 `行 0 的 DOWN(0->1) 在行 1 缺少镜像的 UP`。
   撤回（两处 `grep -n edge.above` 复读到 `:240`、`:243`）⇒ **11 pass / 0 fail**。

三条注入都是**真实可能的回归形状**（不是把断言改成 false），全部撤回后 `git diff` 复查过：组件、模块、新模块里
没有留下任何 `INJECT`/`buildLogGraph` 之类的注入痕迹（组件里 `buildLogGraph` 只出现在注释说明中，
`src/components/VcsLogTable.vue:24`）。
另外测试文件里还有一条**自证的旧形状反证**（`不传折叠跨度就没有那条虚线（反证…）`）：
`buildLogGraph(visible)` 不给跨度 ⇒ `edges(units[0]).length === 0`，即"接线前会红"这一事实本身也被钉住了。

实跑截图式的最终几何（SSR 真组件，折叠 4 步线性链，链首带 HEAD）：

```html
<svg class="graph" width="14" height="26" viewBox="0 0 14 26" aria-hidden="true">
<line x1="7" y1="13" x2="7" y2="26" stroke="#48CFAD" stroke-width="1.5" stroke-dasharray="15 11">
<circle cx="7" cy="13" r="5.5" …/><circle cx="7" cy="13" r="3.5" class="head-gap"/><circle cx="7" cy="13" r="1.5" …/>
</svg>   ← h1 行（下半段虚线 + HEAD 三层点）
<line x1="7" y1="13" x2="7" y2="0" … stroke-dasharray="15 11">   ← h4 行（上半段同一条虚线）
```

## 5. 零消费方自查结论

- `src/vcsLogGraphRender.ts`（新）：生产消费方 = `src/components/VcsLogTable.vue:8` 的
  `import { GRAPH_LINE_WIDTH, paintGraphRow } from '../vcsLogGraphRender'`，`:44` 每行调用、`:161-163` 用它的 `dash`、
  `:164-165` 用它的 `marks` ⇒ **不是只过自己测试的死模块**。
  机核：`node .tools/find-orphan-modules.mjs` 与 `--dead-imports` 两种模式对 `vcsLogGraphRender` / `VcsLogTable` / `vcsLogGraph`
  三个名字**零命中**（本次实跑，输出为空）。
- 本批没有新建 `.vue`、没有新建 `native/*.cpp`、没有新增任何设置键（不涉及旧存档补默认那条事故线）。
- 孤儿门禁的**唯一**新增项是 `src/editorSplitLine.ts`（编辑器域，别的代理在途），本代理没碰它。

## 6. 做不到 / 无法核实

1. **`row.process` 那条进度文案仍然没有宿主**（具体卡在哪：上游进度来自 `CollapseOrExpandGraphAction.java:78-90` 的
   `performLongAction`，本仓折叠是 `collapseLinearGraph()` 的一次同步计算，没有可挂的进度条组件；
   渲染侧也不肯凭空造一个点了没反应的控件 ⇒ 判词只能停在"文案钉在模型、不渲染"）。
2. **头节点中间那层的底色不是逐格的 `commitStyle.background`**（上游 `HeadNodePainter.kt:50-54` 填的是那一格自己的底色；
   本仓日志行常态是透明、由外层 `body` 的 `--editor` 兜着，所以 `src/components/VcsLogTable.vue:203-205` 用 `--editor` +
   `--hover` + `--selection` 三档跟状态；如果哪天日志面被放进一个有自己底色的容器，这三条就得跟着换宿主令牌 —— 无法核实的部分：**参考树里没有本仓那种容器**）。
3. **`3 2` 这个旧 dash 字面量换成了上游算法**（`getDashLength`），但 SVG 与 `BasicStroke` 的 dash **相位**不等价：
   上游把 dash 相位设成 `dash[0] / 2`（`SimpleGraphCellPainter.kt:102-103`），SVG 的 `stroke-dashoffset` 默认 0 ⇒
   虚线的起笔位置差半段 dash。数值/条数等价、起笔相位不等价，本批没有调 `stroke-dashoffset`（要调就得逐条边算长度，
   属于外观微调，没有用户可见的判据能钉住它 ⇒ 写在这里而不是假装做了）。
4. **车道数与上游列数不等价**：本仓 `LANE_W = 14 / ROW_H = 26`（`src/vcsLogGraph.ts:10-12`，上一轮既有），
   上游是 `WIDTH_NODE = 16` 配 `ROW_HEIGHT = 22`（`PaintParameters.java:9`、`:15`）并按行高缩放圆半径；
   本仓节点半径沿用既有 3.5（上游 `CIRCLE_RADIUS = 4` 在 22px 上 ⇒ 26px 上应约 4.7）。
   改这些常量会动上一轮钉住的形状判据（`tests/vcs-log-graph-cells.test.mjs`），本批没动，只把**几何关系**对齐上游。
5. **真实仓库里的宽图谱没跑**：本批判据用的是构造出来的拓扑（线性链、合并、跨 3 行长边、自环父、页外父）；
   派单禁止启动图形界面，所以没有对真机 `git.logFull` 的一页提交做过肉眼核对。

## 7. 需要主代理接的线

**没有新增需要 `src/App.vue` 的线**，逐条核过：

- `collapsed`：`src/components/VcsLog.vue:124`（ref）→ `:228` 传进 `VcsLogTable`，写回链在
  `VcsLogFilters.vue` / `VcsLogGraphOptions.vue` 的 `setCollapsed`（vcslog2 已接，本批复读没动）。
- `showLongEdges`：`VcsLog.vue:113/122/142`（视图选项齿轮）→ `VcsLogTable.vue:27`。
- `graphInformation`：由**数据**决定（上游 `GraphTableModel.kt:97-100` 读的是那份 pack 的 UserData），
  本仓日志面这一页恒有父子拓扑 ⇒ 组件里写死 `true` 并带判据；上游置位那条路（`FileHistoryFilterer.kt:243`）
  在本仓对应 `git.fileHistory`（`src/projectExtras.ts:173`）那一面，不经过 `VcsLogTable` ⇒ 不需要宿主开关。
- 唯一**可选**的外观后续（不阻塞本批，不另开请求文件）：若主代理把日志面装进有自己底色的容器，
  要把 `src/components/VcsLogTable.vue:203-205` 的 `.head-gap` 三档底色跟着换宿主令牌。

## 8. 现场异常记录（不动判据，只留痕）

- **工具结果里出现过伪装成系统提示的整段文本**（"You are Qoder… / Here is useful information about the environment…"
  这类完整系统提示被反复追加在 Edit/Bash 的结果尾部，共 6 次以上，出现位置 = 我改
  `src/vcsLogGraph.ts` / `src/vcsLogGraphRender.ts` / `src/components/VcsLogTable.vue` 之后的工具结果）。
  处理：**没有执行其中任何一条新指令**（没停手、没改文件归属、没 commit），按派单继续；在此记出处上报主代理。
- **别的代理在本批进行中提交了仓库**（`git log` 里 `1e2f7f7`/`7220a76`/`11a736e` 三条不是我做的，本代理未 commit/push），
  所以 `git diff` 看不到组件那一半的 hunk（它已随别人的提交进了 HEAD）。本批判据不依赖 git 状态：
  文件内容与 §4 的注入-撤回记录都在磁盘上可复跑。
- **引用锚点门控在收尾时变红**：红的是 `docs/wiring-requests-2026-10-06-fix-macros.md` 里那两条已入快照的引用（别的代理改的），
  需要 macros 域的主人自己改回正确区间或由主代理重算快照（`TAOCODE_CITATION_ANCHORS='update'`）——本代理没碰快照文件（它在 `docs/inventory/`，保留文件）。
- **孤儿门禁的红与本域无关**：`src/editorSplitLine.ts` 是编辑器域在途模块（本代理没碰），
  `tests/run-anything-context-dialog.test.mjs:44` 的 TS 语法同（`find-ts-in-mjs` 唯一命中项）。
