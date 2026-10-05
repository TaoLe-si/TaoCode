# 批次报告 · B10 判决：`vcs` 域 1783 类逐条判决（2026-10-06）

产物（只新建了任务授权的文件）：

- `docs/inventory/verdict-vcs.md` —— §0 机械信号总账 / §A–§D 分档说明 / §E 如实不做 / §F 判据 / §G 逐类总表（**1926 行**）
- `docs/inventory/vcs_verdict_table.json` —— §G 的真源（path → 判档 + 依据），分批写盘靠它保证「任何时刻都被切断也有一份自洽产物」
- `tests/b10-verdict.test.mjs` —— 本判决的门控（10 条，**全绿**）
- 本报告

上游基准：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`，逐条实读；**未上网、未截图、未用「IDEA 一般是…」**。

## 1. 四档计数（与 §G 逐行数一致，门控第 3/4/5 条钉住）

| 档 | 类数 | 占比 |
|---|---:|---:|
| `[x]` 已移植 | 42 | 2.4% |
| `[~]` 部分 | 502 | 28.2% |
| `[ ]` 未移植 | 17 | 1.0% |
| `[-]` 不适用 | 1222 | 68.5% |
| **合计** | **1783** | 100% |

§G **已判 1783 / 1783 行**，与 `docs/inventory/vcs.txt` 一一对齐（门控第 5 条「逐类闭合」在满量时才生效，现已生效并通过）。

按模块：`vcs-impl` 907（x19/～254/□2/—632）· `vcs-log` 571（x15/～150/□15/—391）· `vcs-api` 246（x4/～83/—159）· `diff-impl` 24（～14/—10）· `platform-impl` 13（—13）· `editor-ui-api` 9（～1/—8）· `ide-core` 3（x2/—1）· `vcs-tests` 4、`java/vcs` 2、`lang-impl` 2、`platform-api` 2（x2）。

## 2. §C 里最值得先做的 20 条（每条给上游依据 + 本仓建议落点）

前 17 条就是 §G 里全部 `[ ]`；后 3 条从 502 条 `[~]` 里挑「只差一步、用户直接摸得到」的。

| # | 项 | 上游依据（相对路径） | 本仓建议落点 | 为什么先做 |
|---:|---|---|---|---|
| 1 | `CollapseGraphAction` | `platform/vcs-log/impl/src/com/intellij/vcs/log/ui/actions/CollapseGraphAction.java` | `src/vcsLogGraph.ts:24` 的行模型加折叠段；表格 `src/components/VcsLogTable.vue:1` 合并行 | 大仓库日志滚不动的根因是「整表渲染」，折叠是唯一能救可读性的档 |
| 2 | `ExpandGraphAction` | 同上目录 `ExpandGraphAction.java` | 同上（一条折叠状态数组即可） | 与 1 同一条改动 |
| 3 | `CollapseOrExpandGraphAction` | 同上 `CollapseOrExpandGraphAction.java` | `src/menus/gitMenu.ts:32` 增一条可搜索动作 + 快捷键 | 折叠没快捷键等于没有 |
| 4 | `ShowLongEdgesAction` | 同上 `ShowLongEdgesAction.java` | `src/vcsLogGraphOptions.ts`（选项表 `:27` 起）增一档，`src/vcsLogGraph.ts:7` 的 `lanePath` 按档过滤 | 图选项里唯一缺的可见档 |
| 5 | `VcsLogSpeedSearch` | `platform/vcs-log/impl/src/com/intellij/vcs/log/ui/table/VcsLogSpeedSearch.java` | `src/components/VcsLogTable.vue:1` + 复用 `src/branchPopup.ts:58` 的过滤套路 | 本仓其它面板都有速度搜索，日志表格是唯一没有的 |
| 6 | `ShowCommitTooltipAction` | `…/log/ui/actions/ShowCommitTooltipAction.java` | 表格行的 title → 换成浮层（`src/messageDialog.ts:1` 之外的轻浮层通道） | 悬停看作者/日期是 IDEA 的老肌肉记忆 |
| 7 | `CompactReferencesViewAction` | `…/log/ui/actions/CompactReferencesViewAction.java` | `src/components/VcsLogTable.vue:1` 的 refs 列截断规则 + `src/vcsLogPresentation.ts:60` 增档 | 分支名一长就把主题挤掉 |
| 8 | `ChangeDiffPreviewLocationActions` | `…/log/ui/actions/ChangeDiffPreviewLocationActions.kt` | `src/vcsLogPresentation.ts:60` 增「预览位置」档，持久化走 `src/vcsLogFilterStore.ts:51` | 与 §G 的 `DiffPreview`/`FrameDiffPreview` 两条 `[~]` 同一半缺口 |
| 9 | `ShowChangesFromParentsAction` | `…/log/ui/actions/ShowChangesFromParentsAction.java` | `src/vcsLogMenu.ts:66` 的行 + `native/git_log.cpp:210`（对每个父各取一次变更） | 合并提交的变更看不清是日志最常被抱怨的点 |
| 10 | `ShowCommitInLogAction` | `…/log/ui/actions/ShowCommitInLogAction.java` | `src/vcsLogGoToRef.ts:46` 的候选 + `src/vcsLogViewport.ts:3` 的滚动定位 | 从文件历史/注解回主日志缺一条回头路 |
| 11 | `MultipleCommitInfoDialog` | `platform/vcs-log/impl/src/com/intellij/vcs/log/ui/details/MultipleCommitInfoDialog.kt` | 多选语义已在 `src/vcsLogMenu.ts:56`，补一个合并信息弹层 | 多选提交目前只能按单选做事 |
| 12 | `TwoStepCompletionProvider` | `…/log/ui/actions/TwoStepCompletionProvider.java` | `src/vcsLogGoToRef.ts:46` 的候选生成（先补字段名再补值） | 跳转弹层只能前缀匹配，输入 `hash:` 之类没有引导 |
| 13 | `AlignLabelsAction` | `…/log/ui/actions/AlignLabelsAction.java` | `src/components/VcsLogDetails.vue:1` 的排版开关 | 详情面板标签/值不对齐，是纯样式级缺口 |
| 14 | `FileHistoryOneCommitAction` | `platform/vcs-log/impl/src/com/intellij/vcs/log/ui/actions/history/FileHistoryOneCommitAction.kt` | `native/git.cpp:850`（limit=1 档）+ `src/menus/gitMenu.ts:51` 增行 | 文件历史看单提交是常见动作 |
| 15 | `ShowAllAffectedFromHistoryAction` | `…/log/ui/actions/history/ShowAllAffectedFromHistoryAction.kt` | `native/git_log.cpp:210` + `src/vcsLogChanges.ts:5`，在历史侧加一行 | 数据全有，只差一行入口 |
| 16 | `UpdateOptionsDialog` | `platform/vcs-impl/src/com/intellij/openapi/vcs/update/UpdateOptionsDialog.kt` | `src/vcsActions.ts:41` 的 pull 前插参数选择（rebase/merge/ff-only） | 本仓「更新项目」是硬编码 `git pull`（`native/git.cpp:560`），用户无法改策略 |
| 17 | `UpdateOrStatusOptionsDialog` | `platform/vcs-impl/src/com/intellij/openapi/vcs/update/UpdateOrStatusOptionsDialog.java` | 同上（与 16 共用一个对话框，`src/dialogGeometry.ts:1` 的通道） | 与 16 一起做只多一次分支 |
| 18 | `ShelveChangesManager`（`[~]`→目标 `[x]`） | `platform/vcs-impl/src/com/intellij/openapi/vcs/changes/shelf/ShelveChangesManager.kt` | 现有一栈：`native/git.cpp:563`/`:574`/`:579`；**还差**按条目恢复 → 加 `git stash apply <n>` 一条函数 | 储藏现在是「只能弹最后一个」，多条目直接不可用 |
| 19 | `ApplyPatchDifferentiatedDialog`（`[~]`→目标 `[x]`） | `platform/vcs-impl/src/com/intellij/openapi/vcs/changes/patch/ApplyPatchDifferentiatedDialog.java` | `src/patchApplyHost.ts:63` 的计划执行前插按文件勾选（复用 `src/components/ChangedHunks.vue:1` 的 `picked` 套路） | 现在应用补丁是全量落地，失败只能整份重试 |
| 20 | `FileHistoryPanelImpl`（`[~]`→目标 `[x]`） | `platform/vcs-impl/src/com/intellij/openapi/vcs/history/FileHistoryPanelImpl.java` | 独立历史面板（复用 `src/components/VcsLogTable.vue:1` + `native/git.cpp:850` + `src/historyFollow.ts:50`） | 现在文件历史借用日志视图，缺「只看这个文件」的独立面 |

## 3. 门禁与反向验证

`node --test tests/b10-verdict.test.mjs` → **pass 10 / fail 0**（不跑全量 `npm test`）。

门控条目：① 枚举本身 1783；② §G 无重复且类名+路径必须对得上枚举（防造假引用）；③ §G 行数 == 文档声明的「当前已判 N 行」；④ 四档相加 == 已判行数 + 头部「四档合计 A + B + C + D = N」与计数行同步；⑤ 满 1783 行时逐类闭合；⑥ `[x]`/`[~]` 必须指到磁盘真实存在的 `src|native|tests|docs` 文件且带行号坐标（或写「无法核实」）；⑦ `[-]` 必须给具体理由（≥24 字 + 引用了东西 + 不是空话）；⑧ `[ ]` 也要写清缺什么；⑨ 测试源集/生成码一律 `[-]`；⑩ 文档骨架与 VCS 域口径必须在文里。

反向验证（三次注入，每次都确认「真的会红」再撤销）：

1. **第一轮**（骨架期，注入 4 行）：造假路径 `FakeClassForGateProbe` + 重复类 `FileStatus` + 把 `GraphBuilderTest` 判 `[~]` + `[-]` 理由只写「不适用」 + 计数行故意不自洽 → **5 条测试红**（②④⑥⑦⑨），撤销后回绿（10 pass）。
2. **第二轮**：把 `ProcessWaiter` 行**复制一份**（制造重复） → ②红；同时删掉 `VcsLogColumnManager` 一行 → ⑤红。
3. **第三轮**：只删 `PatchNameChecker` 一行（不补） → ③「§G 行数 == 声明」红 + ⑤闭合红 + ④四档红（3 条同时红）。
4. 恢复方式不是手改文本，而是用 `vcs_verdict_table.json` 重渲 §G（`b10_engine.save()`），重渲后 1783 行、四档 42/502/17/1222、门控全绿 —— 顺带证明「真源在受版本控制路径里，文本表可再生」。

## 4. 没做完的部分 / 还剩多少

**逐类判决本身已闭合**（1783/1783），剩下的是**核验深度**，不是行数：

1. **1222 条 `[-]` 里有约 65% 是「族理由」**：同一包共用一句理由（该句里的本仓落点都过了存在性检查），族内个别类的边角行为没有逐条打开上游文件核对。若要做二次精核，规模约 800 条（其余 400 余条与 §A/§B 引用同一族源码，已顺带核过）。
2. **行号坐标只对被点名的行写到函数级**：§A 的 42 条与 §B/§C 被点名的行都有 `文件:行号`；`[-]` 行的依据多写「上游类名 + 本仓等价函数行号」，没有逐条给上游行号。按取证口径「指不到写无法核实」，本域 `unreadable = 0`（1783 条上游文件都存在），所以没有「无法核实」条目，但**上游行号级引用**若要求逐条补齐，还剩约 1200 条。
3. **本仓落点的「接线状态」未逐条复查**：`native/git*.cpp` 与 `src/vcsLog*.ts`/`src/commit*.ts` 的路由按既有判据测试认定；2026-10-05 中断批次里「有模型有测试、零消费方」的那批模块未在本批逐个反查（playbook §0.5 的第 2 段是别的桶的活）。§E 第 3 条已如实登记。
4. **已知误判风险 4 处**（本批内部纠正记录）：`ApplyPatchAction`/`ApplyPatchFromClipboardAction`/`PatchNameChecker`/`GitPatchWriter` 起初按包名猜判成了 `[-]`，复核后改 `[x]`/`[~]`（落点 `src/patchApplyHost.ts:115`/`:134`/`:16`、`native/git.cpp:345`）；`VcsBundle` 那条曾引过不存在的 `src/locales/`，已改成真实常量表坐标。另有 `ShelveChangesSaver` 一名在枚举里不存在（真名 `VcsShelveChangesSaver`，已按真名判）。**这正是「判词只是待核实的断言」**：门控把不存在的引用直接打红，比人眼可靠。
5. **未动的东西**：`scripts/verdict_table.py` 与其它域的 `verdict-*.md` 一个字没改，也没跑 `python scripts/verdict_table.py`；git 只有新增文件，无 commit/push/reset/checkout。
