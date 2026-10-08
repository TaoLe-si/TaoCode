# 接线请求 2026-10-06 · lane vcslogdisp（VCS 日志「显示档」剩余项）

本批改的是 `src/vcsLogPresentation.ts` + `src/components/VcsLogTable.vue` + 两份判据测试。
**没有新建模块**、**没有加 bridge 方法**、**没有动 `src/bridge.ts` / `src/App.vue`**（那两处一个贴顶一个在册）。
下面两条都是"模型与判据已就位，只差别人文件里的一行/一处出口"，逐条先打开目标核对过行号。

---

## 请求 1：把仓库当前分支稳定交到日志窗口（点亮 `GitLabelComparator` 的 CURRENT_BRANCH 那一档）

**为什么要**：上游紧凑档"第一个引用是谁"由 `GitLabelComparator`（`plugins/git4idea/backend/src/log/GitRefManager.kt:190-216`）
决定，其中 `:204-208` 会把**当前分支那一条**从 LOCAL/MASTER 升档到 CURRENT_BRANCH（排在 `master`/`main` 之前）。
本仓已把这条比较器整支落进 `src/vcsLogPresentation.ts`（`LOG_REF_TIERS` / `logRefTier` / `compareLogRefs`），
`currentBranch` 做成**入参闸门**：不给值 = 那一档不参与，其余七档照上游排（不瞎猜、不在组件里读全局状态）。

**要谁配合**：`src/components/VcsLog.vue`（不在本 lane 名下）。

**具体那一行**：现在 `src/components/VcsLog.vue:251-252` 是

```
<VcsLogTable … :compact-references="viewPrefs.compactReferences" :align-labels="viewPrefs.alignLabels"
  :show-long-edges="viewPrefs.showLongEdges" :collapsed="collapsedSpans"
```

请补 `:current-branch="currentBranch"`（表格侧的 prop 已就位：`src/components/VcsLogTable.vue:16`
`currentBranch?: string`，它只是把它交给 `logRefGroups(…, { currentBranch })`）。

**值的来源必须是"打开日志就有的确定性状态"，不要走懒的那条**：
`src/vcsLogData.ts:190-198` 的 `loadBranchNames()` 已经在调 `request<GitStatus>('git.status')`
（`native/git.cpp:438-447` 的 `head(repo)` = `rev-parse --abbrev-ref HEAD`，detached 时是 `(分离于 …)`），
但它只在「转到哈希/分支/标记」第一次要候选时才发（`src/vcsLogGoToRef.ts` 那条路径）⇒
拿它当供给侧会让 chip 的选择**随用户是否开过补全弹层而变**，那是渲染不确定，不是接线。
建议：`vcsLogData.ts` 里加一次**随 `load()` 走**的 `git.status`（每个仓库根取一次、`watch(root)` 与
`forgetRefCompletionCache()` 一起作废），把 `data.head` 放进返回值 `currentBranch`；
`detached`（那个 `(分离于 …)` 形状）请交 `undefined` 而不是那串文本 —— 上游那一档比的是 `repository.currentBranch`
的真实分支名，detached 时走的是另一支 `DetachedHeadRefGroup`（`GitRefManager.kt:119-121`，本仓未接，已登记）。

**代价**：每次打开日志 +1 次 `git.status`（同一根只一次）。**收益**：紧凑档 chip 选出的名字与 IDEA 对齐
（当前分支是 feature 分支时，两边显的第一枚会不同 —— 这是这一档唯一用户摸得到的差别）。

**判据已就位**：`tests/vcs-log-presentation.test.mjs` 的「CURRENT_BRANCH 那一档：要仓库状态，给了就升到 MASTER 之前」
—— 不给值 / 给值两种输入都断住了，接线之后不需要新判据。

---

## 请求 2：把量到的列宽交回表格，才能落"引用串可用宽度"那一档

**为什么要**：`Vcs.Log.CompactReferencesView` 还剩的第三截是**宽度**，不是数量
（`platform/vcs-log/impl/src/com/intellij/vcs/log/ui/render/GraphCommitCellRenderer.kt:274-287`）：
`textAndLabelsWidth = 列宽 − graphWidth`（`:275`）、`freeSpace = textAndLabelsWidth − 主题的 preferredWidth`（`:276`）、
紧凑档 `allowedSpace = min(freeSpace, textAndLabelsWidth / 3)`（`:277-278`）、
非紧凑档 `max(freeSpace, max(textAndLabelsWidth / 2, textAndLabelsWidth − DISPLAYED_MESSAGE_PART))`
（`:280-283`，常量 `= 80` 在 `:321`），最后 `max(0, …)`（`:285`）。这一档管的是"分支名一长就把主题挤掉"那半件事。

**卡在哪**：两个入参都不在表格这一层。
`src/components/VcsLogColumns.vue:13-17` 才是唯一有 canvas `measureText` 与 `fitColumns` 结果的地方，
它把宽度只铺成 CSS 变量（同文件 `:56` 的 `--commit-width`），**数值没有出口**；
表格这边（`src/components/VcsLogTable.vue`）拿不到提交列的数值宽度，也量不到主题的 preferredWidth。

**要谁配合**：`src/components/VcsLogColumns.vue`（不在本 lane 名下）。
建议出口形状（择一即可，本仓另一处 `defineExpose` 的先例是 `VcsLogTable.vue:197` 的 `focusHash`）：
`defineExpose({ widths })`（`Ref<LogWidths>`）或 `emit('resized', widths)`，
外加一个 `measure(text: string): number`（同一份 canvas 上下文，主题那一行用它量）。

**为什么本批不先用 CSS 的 `calc(…/3)` 顶上**：CSS 里没有 `freeSpace` 这一半（主题的 preferredWidth 量不到），
`min(freeSpace, w/3)` 会退化成固定 `w/3`；而 `w` 本身（`--commit-width`）是那条**余量列**——
把表格的 CSS 变量当成模型入参会造出"齿轮看着接了、实际按另一套宽度算"的半截档 ⇒ 假控件形状，宁可不出现。
所以这一档整条登记为**未落**（`docs/batch-2026-10-06-vcslogdisp.md` §6），等这一个出口。

**接线时要一并做的判据**（留给接的那条 lane，别放松）：宽度档是**夹**而不是比例 ——
需要断"主题很短时 chip 能占满 `w/3`、主题很长时按 `freeSpace` 收、`freeSpace<0` 时给 0（一枚 chip 都不画）"，
上游这三步都出自那一个函数（`:277-285`）。

---

## 本批**不要**的接线（逐条排除，免得后面按图索骥找错地方）

| 想接的东西 | 为什么不提请求 |
|---|---|
| `bridge.ts` 加字段/方法 | 一行没加：当前分支走**已存在**的 `git.status`（`src/bridge.ts:109` 的 Method 联合里早有它），引用数据走已存在的 `commit.refs`。`bridge.ts` 0 行贴顶，不动 |
| `App.vue` | 齿轮状态在 `VcsLog.vue` 自己的 `viewPrefs`（`:116-125`），本批没加新档 ⇒ 不碰 30 行那份 |
| `docs/inventory/verdict-vcs.md` 升档 | 按 lane 规矩由主代理改；本批给的三栏证据在 `docs/batch-2026-10-06-vcslogdisp.md` §5 |
| `HistoryPanel.vue` | 它是本地历史那一面（`git.status` 只在 `:74`/`:129` 用于别的事），不在这条 chip 消费链上；本批一个字没动（它 15:42 的 mtime 属另一条 lane） |
| `VcsLogDetails.vue` 的引用排版 | `AlignLabels`（§2 #13）那一族的落点在详情侧，本批只改了表格里 chip 的**选择与可达**，没动详情侧 |
| `VcsLogGraphOptions.ts` / `vcsLogGraph.ts` | 只读坐标（vcslogeclose 刚收过）。本批引用它们的行号，不写 |

## 处理结果（wiring-backlog lane，2026-10-06）

- **请求 1 / 2** —— 目标 `src/components/VcsLog*.vue`（本 lane 可改面，属 VCS 半区），登记为待办。

结论：零接线（登记）。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「零接线（登记）。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
