# 接线请求 · 2026-10-06 · vcslog2（Git 日志图形行：折叠档与行内图形单元）

本文件只列**本代理不能改的文件**（`src/components/*.vue` 归组件代理；`src/App.vue` 归 appvue）。
模块侧已经落地的东西在 `src/vcsLogGraph.ts` / `src/vcsLogGraphOptions.ts`，判据在 `tests/vcs-log-graph-cells.test.mjs`。
上游依据全部逐行开过（唯一真源 `D:\Backup\Downloads\intellij-community-master\intellij-community-master`）。

> 派单里给的两条"上游坐标候选"经核实**都不存在**，本仓改用下面这些真路径（留痕，不写假路径）：
>  · 原写 `plugins/git4idea/src/git4idea/ui/GitGraphPanel.java` —— 参考树里 `plugins/git4idea/` 下**没有** `src/git4idea/ui/`
>    这一层（只有 `backend` / `frontend` / `shared` / `tests` 等目录），全树也搜不到 `GitGraphPanel` 这个文件名。
>  · 原写 `platform/vcs-log/impl/src/com/intellij/community/components/graph/GraphCellProvider.java` —— 全树搜不到
>    `*CellProvider*`，`com/intellij/community/` 只在 `python/python-exec-service/tests/` 下出现。
>  · 真身 = 上游的 PrintElement 一族 + 画师：
>    `platform/vcs-log/graph-api/src/com/intellij/vcs/log/graph/PrintElement.kt:7-12`、
>    `platform/vcs-log/graph-api/src/com/intellij/vcs/log/graph/EdgePrintElement.kt:4-21`、
>    `platform/vcs-log/graph-api/src/com/intellij/vcs/log/graph/NodePrintElement.java:7-17`、
>    `platform/vcs-log/graph/src/com/intellij/vcs/log/graph/impl/print/PrintElementGeneratorImpl.kt:126-173`、
>    `platform/vcs-log/graph/src/com/intellij/vcs/log/graph/impl/print/elements/EdgePrintElementImpl.kt:43-48`、
>    `platform/vcs-log/graph/src/com/intellij/vcs/log/graph/impl/print/elements/TerminalEdgePrintElement.java:11-17`、
>    `platform/vcs-log/impl/src/com/intellij/vcs/log/paint/SimpleGraphCellPainter.kt:147-170`（线）与 `:172-187`（点）、
>    `platform/vcs-log/impl/src/com/intellij/vcs/log/ui/table/GraphTableModel.kt:97-117`（取一行的单元 + HEAD 换头节点单元）。

## 请求 1 · `src/components/VcsLogTable.vue`：折叠后要把两端连上（现在的两步调用会丢掉那条边）

目标文件：`src/components/VcsLogTable.vue`
目标行：`:7`（import）、`:21`（visible）、`:34`（graph）

现状（`:34`）：`const graph = computed(() => buildLogGraph(visible.value, { showLongEdges: props.showLongEdges !== false }))`
—— `visible.value` 里被收起的那些提交已经没了 ⇒ `buildLogGraph` 查不到父哈希 ⇒ **那条边整条不画**，
折叠后 h1 行与 h4 行之间是空的。上游 `COLLAPSE_ALL` 在 `hideNode` 的同一次修改里
`createEdge(new GraphEdge(up, down, null, GraphEdgeType.DOTTED))`
（`platform/vcs-log/graph/src/com/intellij/vcs/log/graph/collapsing/CollapsedActionManager.java:231`，同案 `:214-241`），
所以 IDEA 里折叠后两端之间有一条**虚线**。

照抄替换（三处，其它行不动）：

```ts
// :7 —— 去掉不再用到的两个名字，换成一次成型的 collapseLinearGraph
import { collapseLinearGraph, lanePath, laneX, logDate, rootColor, ROW_H } from '../vcsLogGraph'

// :21 —— 表、视口、键盘导航、aria 仍然吃这一份（形状与 collapseLinearBranches 完全一致）
const folded = computed(() => collapseLinearGraph(
  props.commits, props.collapsed === true, { showLongEdges: props.showLongEdges !== false, graphInformation: true }))
const visible = computed(() => folded.value.visible)

// :34 —— 直接吃 folded 的图：折叠跨度已经在里面（线型 dashed）
const graph = computed(() => folded.value.graph)
```

（注意 `:18` 的 `columnRows`、`:29` 的视口 `useLogViewport(list, computed(() => visible.value.length), …)`
仍以 `visible` 为准，不用改；`buildLogGraph` / `collapseLinearBranches` 两个导出仍留在模块里，
`tests/vcs-log-presentation.test.mjs:200-232` 钉的就是它们各自的旧形状，不许顺手删。）

## 请求 2 · 同一文件 `:143-149`：让"折叠 = 虚线"与"HEAD 行 = 空心带点"真看得见

**最小档**（只加一个属性，不改结构）—— 把 `style === 'dashed'` 落成 dash：

```html
<line v-for="(line, i) in row.pass" :key="`p${i}`" :x1="laneX(line.lane)" y1="0" :x2="laneX(line.lane)" :y2="ROW_H" :stroke="line.color" stroke-width="1.5" :stroke-dasharray="line.style === 'dashed' ? '3 2' : undefined" />
<line v-for="(stub, i) in row.up" :key="`u${i}`" :x1="laneX(stub.lane)" y1="0" :x2="laneX(stub.lane)" :y2="ROW_H / 2" :stroke="stub.color" stroke-width="1.5" :stroke-dasharray="stub.style === 'dashed' ? '3 2' : undefined" />
<line v-for="(stub, i) in row.stub" :key="`s${i}`" :x1="laneX(stub.lane)" :y1="ROW_H / 2" :x2="laneX(stub.lane)" :y2="ROW_H" :stroke="stub.color" stroke-width="1.5" :stroke-dasharray="stub.style === 'dashed' ? '3 2' : undefined" />
<path v-for="(edge, i) in row.down" :key="`d${i}`" :d="lanePath(edge.from, edge.to)" fill="none" :stroke="edge.color" stroke-width="1.5" :stroke-dasharray="edge.style === 'dashed' ? '3 2' : undefined" />
```

依据：`GraphEdgeType.DOTTED` ⇒ `EdgePrintElement.LineStyle.DASHED` 的唯一映射点在
`platform/vcs-log/graph/src/com/intellij/vcs/log/graph/impl/print/elements/EdgePrintElementImpl.kt:43-48`（`DOTTED`/`DOTTED_ARROW_UP`/`DOTTED_ARROW_DOWN` 三条都归 DASHED，
`LineStyle.DOTTED` 那一档**没有生成者** ⇒ 本仓也不产它）；画师按 `isUsual` 决定实线/虚线：
`platform/vcs-log/impl/src/com/intellij/vcs/log/paint/SimpleGraphCellPainter.kt:147-150`。
（`3 2` 是本仓画法，上游是 `BasicStroke` 的 dash 参数 —— 数值不等价、语义等价，已在此说明。）

**完整档**（按图谱显示 = 吃 `graph.units`，列号密排 + 终端箭头 + HEAD 空心圈）：
把 `:143-149` 那一块换成按 `graph.units[index]` 循环，`kind === 'node'` 画圆
（`shape === 'outlineAndFill'` ⇒ 外面再描一圈：`platform/vcs-log/impl/src/com/intellij/vcs/log/ui/table/GraphTableModel.kt:102-117` +
`platform/vcs-log/impl/src/com/intellij/vcs/log/paint/SimpleGraphCellPainter.kt:179-186`），
`kind === 'edge'` 用 `position`/`otherPosition` 换算 x（`platform/vcs-log/impl/src/com/intellij/vcs/log/paint/SimpleGraphCellPainter.kt:153-168`：
两列相等 = 竖线，不等 = 弯到邻行那一列），`hasArrow` 的那一条在末端画箭头（`…/TerminalEdgePrintElement.java:11-17`）。
列号→像素请沿用模块里的 `laneX()`（车道宽 14 / 行高 26，`:4-8`），不要把常量抄进组件。

## 请求 3 · 图选项弹层：文案已经跟着显示档换字，组件不用动

`src/vcsLogGraphOptions.ts` 的 `logGraphOptionsModel()` 现在把收起/展开两行的 `title`/`description`/`process`
交给 `collapseActionTitles()` 求值（判据 `CollapseOrExpandGraphAction.java:51-69` +
`CollapseGraphAction.java:14-19` 的两族 key；`action.title.collapse.merges` = Collapse Merges 在
`platform/vcs-log/impl/resources/messages/VcsLogBundle.properties:42`）。
`src/components/VcsLogGraphOptions.vue` 渲染的是模型里的 `row.title` ⇒ **零改动**就跟得上。
`row.process` 目前没有消费方（本仓日志的折叠是同步的一页计算，不跑 `performLongAction` 那种进度条，
`platform/vcs-log/impl/src/com/intellij/vcs/log/ui/actions/CollapseOrExpandGraphAction.java:78-90`），
所以**没有**渲染成新控件；留着它是把上游那条进度文案钉在模型里，判据逐条对着 `VcsLogBundle.properties:32-44`。
新增的 `linearBek` 状态项**不是**新勾选：上游把它门在 Registry `vcs.log.linear.bek.sort` 后面且默认关
（`platform/vcs-log/impl/src/com/intellij/vcs/log/util/BekUtil.java:13-15`），本仓弹层里也不渲染这一档
（继续留在 `LOG_GRAPH_OPTION_GAPS`，`src/vcsLogGraphOptions.ts` 文件尾）。

## 请求 4 · 判词升档（`docs/inventory/verdict-vcs.md` 与 `vcs_verdict_table.json` 是保留文件，本代理没改）

`scripts/verdict_table.py` 不动。逐行的现成措辞（§C 表在 `docs/inventory/verdict-vcs.md:76-93`，§G 表在同文件 `:1712-1736` 一带）：

| 判词行 | 类 | 现判 | 建议判 | 依据（可直接抄） |
|---|---|---|---|---|
| `:81` / §G `:1712` | `CollapseGraphAction` | `[ ]` | `[x]` | 收起 = 隐掉线性链中间提交，本仓 `src/vcsLogGraph.ts:277`(`collapsedLinearHashes`) + `:297` + `:302`；菜单行 `src/vcsLogGraphOptions.ts:206-221`；判据 `tests/vcs-log-presentation.test.mjs:221-232` |
| `:84` / §G `:1718` | `ExpandGraphAction` | `[ ]` | `[x]` | `src/vcsLogGraphOptions.ts:216-219`（`disabled: !state.collapsed`）+ `src/vcsLogGraph.ts:302`（`collapsed=false` 逐字返回原列表）；判据 `tests/vcs-log-presentation.test.mjs:224` |
| `:82` / §G `:1713` | `CollapseOrExpandGraphAction` | `[ ]` | `[~]` | 可见/可点判据 + **文案随 `GRAPH_OPTIONS` 换档**已落（`src/vcsLogGraphOptions.ts:97-130`，上游 `CollapseOrExpandGraphAction.java:51-69`）；**还差** 进度条长动作（本仓折叠是同步一页计算，无 `performLongAction` 宿主） |
| `:88` / §G `:1736` | `ShowLongEdgesAction` | `[ ]` | `[x]` | `src/vcsLogGraph.ts:103-108` + `:153-158`（关档只留竖线）；判据 `tests/vcs-log-presentation.test.mjs:200-211`；另有终端箭头单元 `:194-228` |
| §G `:1398`、`:1401`、`:1426`、`:1475`、`:1476`、`:1479`、`:1685` | `EdgePrintElement`/`NodePrintElement`/`PrintElementGenerator`/`PrintElementGeneratorImpl`/`EdgePrintElementImpl`/`TerminalEdgePrintElement`/`SimpleGraphCellPainter` | `[-]` | `[~]` | 族理由是"Swing 自绘/平台抽象"，但这几条的**用户可见部分**（每行的列、竖线 vs 弯线、终端箭头、HEAD 空心圈、虚线折叠边）已在本仓模块等价实现：`src/vcsLogGraph.ts:42-78`、`:170-228`、`:314-319`；判据 `tests/vcs-log-graph-cells.test.mjs:94-138`。Swing 画师本体仍 `[-]`，只升"数据形状"这一半 |
| `:79`、`:80`、`:83`、`:85`、`:86`、`:87`、`:89`、`:93` | `AlignLabelsAction`/`ChangeDiffPreviewLocationActions`/`CompactReferencesViewAction`/`ShowChangesFromParentsAction`/`ShowCommitInLogAction`/`ShowCommitTooltipAction`/`TwoStepCompletionProvider`/`VcsLogSpeedSearch` | `[ ]` | `[x]`（除前四条由别的批次落，本批逐条开文件核过消费链） | 落点分别在 `src/vcsLogPresentation.ts:34-45,130-157,195-199,206-212,214-225` + `src/components/VcsLog.vue:114,122,145,183-187,244` + `src/components/VcsLogChanges.vue:10` + `src/components/VcsLogTable.vue:36-39,140-153` + `src/vcsLogGoToRef.ts:105-130`；判据 `tests/vcs-log-presentation.test.mjs` 与 `tests/vcs-log-go-to-ref.test.mjs`（45 条全绿） |
| `:90`、`:91`、`:92`、`:77`、`:78` | `FileHistoryOneCommitAction`/`ShowAllAffectedFromHistoryAction`/`MultipleCommitInfoDialog`/`UpdateOptionsDialog`/`UpdateOrStatusOptionsDialog` | `[ ]` | 维持 `[ ]` | 本批**没做**，落点在组件/native（不属本代理文件面），一句话理由照 §C 原表即可 |

## 处理结果（wiring-backlog lane，2026-10-06）

- **请求 1 / 2** —— 目标 `src/components/VcsLogTable.vue`（本 lane 可改面，属 VCS 半区），登记为待办。
- **请求 3** —— 无需改。**请求 4** —— 判词，非本 lane。

结论：零接线（请求 1/2 登记）。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「零接线（请求 1/2 登记）。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
