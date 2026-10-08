# 接线请求 · 2026-10-06 · 代号 `vcsloge`（Git 日志图形折叠 · §2 表 1-3 / 4 / 7）· 由收尾 lane 代写

派单原文要求：本文件列出**需要保留文件配合**的接线，并把三个保留文件的余量按门禁尺自己量一遍。
结论先说：**本批 0 条保留文件接线**（一条都不需要），但下面把"为什么不需要"逐条写清，并把**该别人接的**、
**本仓做不到的**、**判词措辞要改的**分开列，免得下次又变成"看着没人接就当没有"。

保留文件余量（自己量的，命令与口径都贴出来；本 lane 对这三个文件**一个字都没改**）：

```
node -e "const fs=require('fs');for(const f of ['src/App.vue','src/bridge.ts','src/components/CodeEditor.vue'])console.log(f, fs.readFileSync(f,'utf8').split('\n').length)"
src/App.vue 2707
src/bridge.ts 905
src/components/CodeEditor.vue 1145
```

门禁登记的上限（`tests/module-size.test.mjs:107/126/135` 那三条 `limit`）：`2737` / `905` / `1147`
⇒ 余量 **30 行** / **0 行（已贴顶，要加字段必须等额减行）** / **2 行**——与派单给的三个数一致。

## 1. 为什么本批一条保留文件接线都不需要（逐条排除，不是"没想过"）

| 候选 | 上游那一行（本 lane 实读） | 需要动保留文件吗 | 排除理由 |
|---|---|---|---|
| 把「收起 / 展开线性分支」做成**全局可搜索动作 + 快捷键**（`docs/batch-2026-10-06-verdict-vcs.md:34` 那句建议落点） | `platform/vcs-log/impl/resources/intellij.platform.vcs.log.impl.xml:193-194`（只有两条子类注册），全树 grep `Vcs.Log.CollapseAll` / `Vcs.Log.ExpandAll` 的 `<keyboard-shortcut>` = **0 命中** | 不需要，而且**不该做** | 上游没有键位 ⇒ 加键位就是编造（纪律②）。日志面板自己那颗齿轮弹层里已经有这两行（`src/vcsLogGraphOptions.ts:206-221` + `src/components/VcsLogGraphOptions.vue:31-33`），入口在，不用 `src/App.vue` 再挂一层 |
| 折叠态要跨页 / 跨刷新保持（上游 `CollapsedGraph.updateInstance:26-29`） | `platform/vcs-log/graph/src/com/intellij/vcs/log/graph/collapsing/CollapsedGraph.java:26-29` | **不需要** | 折叠态是组件里的 `collapsedSpans`（`src/components/VcsLog.vue:130`），本批把它按"两端还在本页就继续算"过筛（`src/vcsLogGraph.ts:366` 的 `activeLinearSpans()`），一行宿主都不用；也**不进持久化键**（上游也没把它存进 UI 属性：`VcsLogUiPropertiesImpl.kt:117-140` 那份 State 里没有折叠项） |
| §2 #4 长边档的持久化（上游出厂 false） | `impl/VcsLogUiPropertiesImpl.kt:121-122`（`LONG_EDGES_VISIBLE`）+ `graph/impl/facade/VisibleGraphImpl.kt:35` | **不需要** | 五档显示偏好已经走 `VcsLog.vue:116-125` 的 `localStorage` 族键（`viewPrefKey` `:118`、`readViewPref` `:119`，组件层直接读，不经 `src/bridge.ts`）；缺键补默认、不按字段数判损坏（`:109-115` 那段注释与实现都在） |
| §2 #7 紧凑引用要按 `GitLabelComparator` 排序 | `plugins/git4idea/backend/src/log/GitRefManager.kt:93-132`（`groupForTable` 先 `ContainerUtil.sorted(references, labelsComparator)`） | **不需要** | 引用的 `type`（`head` / `local` / `remote` / `tag`）已经在 `src/vcsLogTypes.ts` 的 `GitFullCommit.refs` 里（宿主 `%D` 解析在 `native/git_log.cpp:86-103`），排序是纯前端一步 ⇒ 落在 `src/vcsLogPresentation.ts:228-232` 那一族模块里就够，不用 `bridge.ts` 加字段 |
| 折叠的模态进度标题（`row.process`） | `impl/…/CollapseOrExpandGraphAction.java:75-91`（`ProgressManager.runProcessWithProgressSynchronously`） | **暂时不需要，且现在不该挂** | 本仓折叠是对已加载那一页的一次同步计算（`src/vcsLogGraph.ts` 的 `collapseLinearGraph()`），没有长动作 ⇒ 挂进度条 = 假控件。真要做的那一天需要的是**进度宿主**（`src/progress*` 一族，本轮是并发黑名单），不是这三个保留文件 |

⇒ **结论：`src/App.vue` / `src/bridge.ts` / `src/components/CodeEditor.vue` 本批一条接线请求都没有。**
`src/components/CodeEditor.vue` 与日志图形没有任何接触面（本批改的都在 `src/vcsLogGraph*.ts` + `src/components/VcsLog*.vue`），
所以那 2 行余量不是被我"省下来"，是**根本用不上**——写清楚免得下次误记成欠账。

## 2. 该别人接的两条（不是保留文件，是**别的 owner 的文件**，本 lane 未动）

| # | 事 | 上游那一行（本 lane 实读） | 请求落在哪个文件 | 为什么本 lane 不做 |
|---|---|---|---|---|
| W-1 | 悬停把收/展那一条链**描亮**（本仓只接了手形光标那一半） | `impl/…/ui/table/GraphCommitCellController.java:66-81`（`performMouseMove` → `MOUSE_OVER`）+ `graph/…/collapsing/CollapsedActionManager.java:255-256`（`createSelectedAnswer(delegatedGraph, Set.of(up, down))`）+ `graph/…/utils/LinearGraphUtils.java:88-95/98-106`（`HAND_CURSOR` + 选中集） | `src/components/VcsLogTable.vue`（`:205-206` 那一行的 `:class="{ selected … }"` 旁边多挂一个 `Set`，同一层的点击在 `:216`） | 组件层做得到，**不需要宿主**；但 `src/vcsLogGraph.ts:331` 原先那句"要的是多行同时高亮的宿主"**措辞过强**，本 lane 已按"未接 + 理由订正"登记（见 `docs/batch-2026-10-06-vcsloge.md` §6 第 4 条），改实现属扩面 |
| W-2 | §2 #7 紧凑档差的三半：排序 / 其余引用留在同一组 / 引用串宽度上限 | `GitRefManager.kt:93-132` + `impl/SimpleRefGroup.kt:20-21`、`:32-39` + `ui/render/GraphCommitCellRenderer.kt:278-279` | `src/vcsLogPresentation.ts`（排序与取第一个）+ `src/components/VcsLogTable.vue`（组 chip 的可达性与宽度） | 这一档不是 vcsloge 名下的活（vcslog2 那一窗落的），本 lane 只复核 + 给升档证据，不动别人的档 |

## 3. 归宿主 / 已经由别人提过请求的（**不重复登记**）

- `Vcs.Log.PreferCommitDate`（日期列显示提交日期还是作者日期）：要 `native/git_log.cpp:182` 的 `--format` 多带 `%cI`、
  出参 `:219-221` 加一列，并且 `src/bridge.ts` 的 `GitFullCommit` 要加一个字段 —— **`src/bridge.ts` 已贴顶（0 行余量）**，
  所以那条请求必须按"等额减行"来提。这条请求**已由 `vcslogd` 写在** `docs/batch-2026-10-06-vcslogd.md` §5 第 1 条，
  本文件只引用、不另开一份，避免同一件事两个版本。上游侧坐标本 lane 复核为实：
  `platform/vcs-log/impl/src/com/intellij/vcs/log/ui/actions/PreferCommitDateAction.java` 存在、
  `CommonUiProperties.PREFER_COMMIT_DATE` 的存取在 `impl/VcsLogApplicationSettings.kt:43/68/124-125`（出厂 `false`）。

## 4. 判词措辞的订正请求（`docs/inventory/verdict-vcs.md` 与 `docs/batch-2026-10-06-verdict-vcs.md` 都归主代理改，本 lane 未动）

| 那一行 | 现在写的 | 本 lane 复核到的 | 建议措辞 |
|---|---|---|---|
| `docs/batch-2026-10-06-verdict-vcs.md:34`（§2 #3） | "`src/menus/gitMenu.ts:32` 增一条可搜索动作 + **快捷键**" | `CollapseOrExpandGraphAction.java:25` 是 `abstract class`、注册表里无独立 id；那两条子类在全树 xml 里**没有任何 shortcut** | 删掉"快捷键"；改写成"父类的可见面 = `update()` 的 `isActionSupported` 门（`:55`）+ LinearBek 换文案（`:58-67`）+ 模态进度标题（`:75-91`）" |
| `docs/inventory/verdict-vcs.md:82` / `:84`（§C 的 `CollapseOrExpandGraphAction` / `ExpandGraphAction` 两行） | 落点写"`native/git_log.cpp:341` 分发处 + `src/vcsLogData.ts:4`" | 收起/展开是**纯视图态**，上游也不走 git 通道（`CollapsedActionManager.java:199-242` 全在图侧） | 落点改成前端图形模块（`src/vcsLogGraph.ts` 的 `collapseFragments()` 一族 + 齿轮弹层 `src/vcsLogGraphOptions.ts:206-221`） |
| `docs/inventory/verdict-vcs.md:88`（§C 的 `ShowLongEdgesAction`） | "`src/vcsLogGraphOptions.ts` 增一档，`buildLogGraph`:24 按档过滤边" | 档其实在 `src/vcsLogGraph.ts:106-107/155/195-201`（**不在** `vcsLogGraphOptions.ts`），齿轮行在 `src/vcsLogPresentation.ts:163-166` | 落点按上面两处重写；并注明上游出厂 = 关（`VcsLogUiPropertiesImpl.kt:121-122`） |
| `docs/inventory/verdict-vcs.md:83`（§C 的 `CompactReferencesViewAction`） | "`src/vcsLogPresentation.ts:60` 增档 + 表格引用列的截断规则" | 增档已有（`:151-155`）；"截断规则"其实是**只显第一个**（`:228-232`），上游还有"其余引用留在同一组"与"列宽 1/3 上限"两半（`SimpleRefGroup.kt:32-39`、`GraphCommitCellRenderer.kt:278-279`） | 按"本仓已有只显第一个；还差排序与组内可达与宽度档"写 `[~]` |

## 5. 反向验证与残留

本 lane 的探针前缀 = `VCSLOGEC-PROBE`（5 次，全部撤回）；收工自查：
`grep -rn "VCSLOGEC-PROBE" src tests native docs/inventory` = **0 命中**。
本文件没有注入前缀，也没有任何"待接线但已被当成完成"的表述：上面 §1 那五条候选**全部标了"不需要"**，
§2 那两条**明确是未完成**，§3 那条**由 vcslogd 名下继续挂着**。

## 处理结果（wiring-backlog lane，2026-10-06）

- 请求原文自述「本批一条保留文件接线都不需要」；其余为别人 owner / 判词订正。零接线。

结论：零接线（原文自述无需接线）。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「零接线（原文自述无需接线）。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
