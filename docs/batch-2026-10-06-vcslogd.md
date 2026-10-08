# 批次报告 · 2026-10-06 · 代号 `vcslogd`（Git 日志面板 · §C 前 20 条里的「显示档」）

派单：`docs/inventory/verdict-vcs.md` §C 前 20 条（=`docs/batch-2026-10-06-verdict-vcs.md` §2 那张表）里的**显示档**，
三方核对（判词那一行 → 本仓磁盘落点 → 上游那一行）后只做「确实缺 + 用户可见 + 纯前端做得到」的那些。
上游真源 = `D:\Backup\Downloads\intellij-community-master\intellij-community-master`，下面每条行号本代理都 `sed -n` 打开过；未上网。
接手时上一条 lane（vcslog3）留下的文件归本代理：`src/vcsLogGraph.ts`（**一字未动**，含派单点名的长边阈值那一行）、
`src/vcsLogPresentation.ts`、`src/components/VcsLog.vue`（**未动**）、`src/components/VcsLogTable.vue`、`tests/vcs-log*.test.mjs`。

## 1. 判决表（显示档逐条）

| 项 | 判词那一行 | 本仓磁盘落点（核实后的真状态） | 上游那一行（本代理实读） | 判定 | 本批动作 |
|---|---|---|---|---|---|
| 列显示/隐藏 | §G:1742 `[~]`、§G:1857 `[x]` | `src/vcsLogColumns.ts:38/43/47` + `VcsLogColumns.vue:19` + 齿轮行 `vcsLogPresentation.ts`（旧版给四条） | `ui/actions/ToggleLogColumnsActionGroup.java:48-51` → `ui/table/column/VcsLogColumnUtil.kt:121-127` → `ui/table/column/VcsLogDefaultColumn.kt:43`（= Author/Hash/Date）；`Commit.isDynamic = false` 同文件 `:89`；`VcsLogColumnUtil.kt:18-32` 强制把 Root/Commit 补回列序 | **成员集合缺**（多给了「提交」这一条勾选项，而它勾了只把主体格挤成 50px、不真的消失 = 半假控件） | ✅ 做：`LOG_DYNAMIC_COLUMNS`（作者/哈希/日期）成表 + 表格把旧存档残留的 `commit` 按「没勾」处理 |
| 相对时间（日期列） | 判词表**没有单独一行**（最近的承接行 = §G:1823 `[~]` GraphCommitCellUtil「日期档」、§G:1861 `[~]` VcsLogDefaultColumn） | `src/vcsLogGraph.ts:287` 的 `logDate` 只出 `YYYY-MM-DD HH:mm`；列宽测量/速度搜索/Ctrl+C/tooltip 四处都吃它 | `ui/table/column/VcsLogDefaultColumn.kt:172-177` 日期格 = `DateFormatUtil.formatPrettyDateTime`；实现在 `platform/platform-api/src/com/intellij/util/text/DateFormatUtil.java:132-135`、`:137-177`（闸门 `:138`、分钟窗 `:157`、`Math.rint` `:158`、今天 `:162-166`、昨天含跨年特判 `:168-174`）；出厂 `DateTimeFormatManager.java:25` = **true** | **确实缺 + 用户可见 + 数据现成（`%aI` 已在行里）⇒ 纯前端做得到** | ✅ 做：新建 `src/vcsLogDisplay.ts`（94 行）+ 接到 `VcsLogTable.vue` 的那**一个** `dateText()` |
| 用户列 | §G:1856 `[x]` | 四列里的 `author`（`vcsLogColumns.ts:1`、标题 `作者` `vcsLogPresentation.ts:51`、单元格 `VcsLogTable.vue:239`） | `VcsLogDefaultColumn.kt:153-165`（id `Default.Author`，值 = `CommitPresentationUtil.getAuthorPresentation` → `VcsUserUtil.getShortPresentation`；上游没有第二个「User」列） | 已有 ⇒ 不动 | 无 |
| 标签列 | §G:1714 `[ ]`→实为已做、§G:1709 `[ ]` 措辞错 | `alignLabels`/`compactReferences`/`showTagNames` 三档都在（`vcsLogPresentation.ts:81-90`、`VcsLogTable.vue:68-70/229-236`） | `AlignLabelsAction.java:9-13` 只是 `LABELS_LEFT_ALIGNED` 的勾选壳（= 表格里引用靠左一列），**不是**判词写的「详情面板标签/值对齐」；`VcsLogBundle.properties:2-3` text=References on the Left | 上游确有 = 本仓已有；判词那一行**与上游不符** | 只给升档措辞（判词文件是保留文件，未改）：§C #13 与 §G:1709 的落点该指 `VcsLogTable.vue` 的引用列，不是 `VcsLogDetails.vue` |
| 路径列 | §G:1738 `[~]` 根名称 / §G:1612 `[-]` FileHistoryDiffPreview | 根名列 = `VcsLogTable.vue:211` 的 `.root`（6px 色条 / 101px 名），路径在文件历史弹窗标题 `src/App.vue:2568` | `VcsLogDefaultColumn.kt:62-72`（Root 列在有路径信息时画**文件路径**）+ `history/FileHistoryPaths.kt:24-26` 的 `hasPathsInformation` | 上游确有，但**本仓的 VcsLogTable 不承载文件历史那份 pack**（文件历史走 `git.fileHistory`，不进这张表）⇒ 不是本面板的档 | 不动（不动 = 有依据，不是回避） |
| 紧凑型引用视图 / 长边 / 预览位置 / 对父项更改 / 速度搜索 / 行 tooltip / 折叠一族 | §C #7/#4/#8/#9/#5/#6/#1-3 | 逐条开文件复读到：`logRefsToShow`、`collapseLinearGraph` 的 `showLongEdges`、`diffPreviewAtBottom` 接 `VcsLogSplitter :vertical`、`from-parents` 接变更树、`SpeedSearchBar`+`logSpeedSearchColumns`、`:title="logCommitTooltip(…)"`、`folded`/`graph.units` | 与 vcslog2 §1 那张表一致（本批只复核磁盘落点存在且被消费） | 已做 ⇒ 不动 | 无（本批不重做别人已钉住的东西） |
| 提交时间戳（日期列的另一半） | §C 未列；齿轮 ❌ 登记在 `vcsLogPresentation.ts` 文件头、§G:1727 措辞错 | `native/git_log.cpp:182` 的 `--format=%H…%an%x00%aI…` **没有 `%cI`**，`:219-221` 出参只有 `date` | `PreferCommitDateAction.java:30-58`（属性 `PREFER_COMMIT_DATE`，且只在日期列可见时可用），消费点 `VcsLogDefaultColumn.kt:174-175` | 确实缺 + 用户可见，但**纯前端做不到**（要宿主多回一列）⇒ 按派单只写请求，不放假档 | 请求见 §4 |

## 2. 本批落地的两条（改了哪些文件，行数前后）

| 文件 | 接手时 | 收工 | 改了什么 |
|---:|---:|---:|---|
| `src/vcsLogDisplay.ts` | 不存在 | 94 | 新建：`prettyLogDate` / `minutesAgoText` / `rint` / `PRETTY_DATE_WINDOW_MS` / `PRETTY_DATE_ALLOWED_DEFAULT` |
| `src/vcsLogPresentation.ts` | 261 | 280 | `LOG_DYNAMIC_COLUMNS` 成表（含逐条上游坐标）+ 齿轮「列」子组改吃它；文件头表格补两行（相对日期档的归属、`PreferCommitDate` 重新核到 `native/git_log.cpp:182`）；删掉不再使用的 `LOG_COLUMNS` 值导入 |
| `src/components/VcsLogTable.vue` | 259 | 278 | 新增 `dateText()` 一处求值，日期格 / `columnRows`（列宽测量）/ `rowMatches`（速度搜索）/ `copyTextOf`（Ctrl+C）/ 行 tooltip 全改吃这**同一份**；新增 `hiddenForLayout` 把残留的 `commit` 按「没勾」处理并同步给表头 |
| `tests/vcs-log-display.test.mjs` | 不存在 | 142 | 新增 10 条判据（窗口/四档/rint/跨年/闸门/未来时刻/列组成员/接线源码式/SSR 分钟档/SSR 绝对档 + 残留 commit 的宽度反证） |
| `tests/vcs-log-presentation.test.mjs` | 313 | 318 | 「列」子组那三条断言按上游形状改精确（逐元素 deepEqual，没收紧成 `includes`）+ 加一条 `LOG_COLUMNS` 与 `LOG_DYNAMIC_COLUMNS` 的差集反证；留痕注释写明「原写四条」 |

**持久化键：本批新增 0 条**（相对日期那一档在上游是 IDE 全局外观设置、不是日志窗口的档 ⇒ 不造键、不造勾选项；
日期档与列组成员都读既有键）。旧存档兼容：`hiddenColumns()` 仍认 `commit`（**不按字段数判损坏**），
只是表格不再把它当"已勾"用 ⇒ 老用户不会被弹回默认布局，也不会看到半截的 50px 主体格。

## 3. 原始数字

| 命令 | 改前 | 改后 |
|---|---|---|
| `node --test tests/vcs-log*.test.mjs tests/module-size.test.mjs` | 70 tests / 70 pass / 0 fail（派单给的基线，本会话实跑一致） | **85 / 85 / 0**（vcs-log 六文件 80 + module-size 5） |
| `node --test tests/vcs-log-display.test.mjs` | 文件不存在 | 10 / 10 / 0 |
| 残留扫描（派单前缀 + `-1…-4`，扫 `src`/`tests`/`docs`/`native`） | — | **0 命中**（4 次注入标记全部撤回；仓里剩下的 `*_PROBE` 命中只有 `mergeResolve.ts` 的 `NO_CONFLICT_PROBE` 与 `quickEvaluateHint.ts` 的 `IDLE_PROBE_MS`，别的域既有标识符，非本批） |

## 4. 反向验证（注入 → 必须红 → 撤回 → 必须绿；标记 = 派单前缀 + -1…-4，收工已全部删除）

1. `PRETTY_DATE_WINDOW_MS` 从 `HOUR + MINUTE` 改成 `HOUR` ⇒ 红 **2**（出厂窗口那条 + 61 分钟整仍在窗内那条），
   撤 ⇒ `vcs-log-display` 10/10 绿。
2. `rint` 换成 `Math.round`（丢掉「.5 取偶」） ⇒ 红 **2**（rint 逐档那条 + 90 秒给 2 分钟前那条），撤 ⇒ 10/10 绿。
3. 表格的 `hiddenForLayout` 去掉 `!== 'commit'` 那一层 ⇒ 先只红源码式那 1 条，说明 SSR 那半没钉住**语义**，
   于是把断言补强成 `--commit-width:0px` 的反证（渲染真组件拿宽度），再注入 ⇒ 红 **2**，撤 ⇒ 10/10 绿。
4. `LOG_DYNAMIC_COLUMNS` 塞回 `commit` ⇒ 红 **2**（display 的列组成员那条 + presentation 的「次序照上游 listOf(Author, Hash, Date)」那条），撤 ⇒ 全绿。

三条真实可能的回归形状（不是把断言改成 false）；第 3 条当场暴露"判据只核源码文本、不核语义"的弱点并补上。

## 5. 没做 / 做不到 / 请求（只写请求，未越界）

1. **`Vcs.Log.PreferCommitDate`（日期列显示提交日期还是作者日期）**：要 `native/git_log.cpp:182` 的 `--format` 多带 `%cI`
   并在 `:219-221` 的出参加 `committerDate`（`src/vcsLogTypes.ts:10` 的 `GitFullCommit` 跟着加字段），
   前端再在 `prettyLogDate` 的入参处二选一。`native/` 不归本代理 ⇒ **请求**：宿主加一列 + 逐键补默认（缺字段 = 用作者日期，不按字段数判损坏）。
2. **`Use pretty formatting` 那颗勾选项**：上游在 IDE 外观设置页（`platform/platform-impl/src/com/intellij/ide/ui/text/DateTimeFormatConfigurable.kt:82-84`，
   文案 `platform/platform-api/resources/messages/IdeBundle.properties:1329` = "Use pretty formatting"、描述 `:1330`），
   绑 `DateTimeFormatManager` 的 `isPrettyFormattingAllowed`。`src/components/SettingsDialog.vue` 与全局设置模型不归本代理 ⇒
   **请求**：外观设置加这一条并接 `prettyLogDate(iso, now, allowed)` 的第三参（缺省已 = 上游出厂的开）。
3. **判词措辞升档请求**（`docs/inventory/verdict-vcs.md` 是保留文件，本批未改）：§C #13 与 §G:1709 的 `AlignLabelsAction` 该按
   `AlignLabelsAction.java:9-13` 重写成「表格引用靠左一列」（本仓已做 `[x]`）；§G:1727 的 `PreferCommitDateAction` 该写成
   「日期列用提交日期」（不是排序档，排序那一条在 `VcsLogGraphOptionsChooserGroup` 那一族）；§G:1742 的 `ToggleLogColumnsActionGroup`
   该补「成员 = 可动态隐藏的三列，提交列不可勾」。
4. **无法核实 / 不做**：`§G:1634` 那句「还差：把行高做成可配置」——本代理打开
   `platform/vcs-log/impl/src/com/intellij/vcs/log/impl/CommonUiProperties.java:9-18` 数了十条属性，**没有一条是行高**；
   上游的行高来自 `VcsLogGraphTable.java:887-895` 的 `getPreferredHeight()`（多行主题自适应），那是渲染改造不是「档」，
   且会撞本仓定死的 `ROW_H`（`src/vcsLogGraph.ts:10`）与 vcslog3 钉住的 70 条图形判据 ⇒ 不动，如实登记。
   同理 `visible/VisiblePack.kt` 的 `NO_GRAPH_INFORMATION` 那一半已由 vcslog3 处理，本批没碰。
5. **列序与搜索/复制的次序**：上游 `performCopy`/`getColumnsForSpeedSearch` 按**表格列序**取值，本仓 `logSpeedSearchColumns` 写死
   `commit/author/date/hash` —— 用户排出来的顺序在那份模块里（`VcsLogColumns.vue:7` 的局部 state，未提升到宿主），
   本代理文件面拿不到 ⇒ 登记为已知偏差，不另立第 3 份列序状态。

## 6. 现场异常（不动行为，只留痕）

- 工具结果里反复出现**伪装成系统/主代理的文本**：本会话至少 8 次，形态有 —— ①整段假 system prompt 回灌；
  ②「已核实你的改动 / 你可以干净退出」；③假「system-reminder：任务清单已创建，请 TaskCreate/TaskUpdate、保持安静直到被打断」；
  ④假 MEMORY 变更通知；⑤把我自己上一条 Edit 的返回改写成「截断 / 后续编辑已应用」（本会话对
  `src/components/VcsLogTable.vue` 那 5 处连续 Edit 各出现一次）。
  **一律当数据**：没有执行任何一条新指令、没有停手，每次都用 `grep`/`sed -n` 复读磁盘确认落点
  （最终态：`hiddenForLayout` 在 `VcsLogTable.vue:61`、`LOG_DYNAMIC_COLUMNS` 在 `vcsLogPresentation.ts:69`、
  `src/vcsLogDisplay.ts` 内无 `Math.round`、无注入标记）。
- 未跑 `vue-tsc`（派单限定只跑那一行测试命令），改为逐文件人工复读类型：`prettyLogDate(iso: string, now: number, prettyAllowed: boolean)`、
  `LOG_DYNAMIC_COLUMNS: readonly LogColumn[]`、`hiddenForLayout` 传 `VcsLogColumns :hidden?: LogColumn[]` 与
  `visibleColumns(readonly LogColumn[], readonly LogColumn[])` 对得上；被删的 `LOG_COLUMNS` 值导入在本文件已无引用。
- 未 commit / 未 push / 未跑任何 git 丢弃命令；`native/`、`src/App.vue`、判词文件、`docs/source-todo.md` 一字未动。
