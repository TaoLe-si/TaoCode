# batch-2026-10-06 · SpeedSearch「替换」档 + 查找族剩余项

> 窄 lane。上游参考树 = `D:\Backup\Downloads\intellij-community-master\intellij-community-master`（唯一可用；仓内 `third_party/intellij-community` 是坏树，不采信）。
> 探针前缀 `SSREP-PROBE`（收工 grep 须 0 残留）。骨架先落盘，之后每完成一块立即追加。

## 0. 待办 / 进度（滚动更新）
- [x] 核本仓 SpeedSearch 是否有「替换」这一档 → **有**：`speedSearchNextInput`（纯逻辑已闭环）
- [x] 上游对应物逐个开文件核名 → 见 §1（`SpeedSearchBase.java`/`SpeedSearch.java`/`ReplaceInPathAction.java` 命中；两个任务点名类未命中，见 §5）
- [x] 判三档 → §3：纯逻辑=已闭环被误判；确缺=焦点进框（DOM 追加）；不做=超时档无法核实 + VcsLog 消费者侧转 §wiring
- [x] 只做用户可见且不需动保留文件的那一档 → 改 `SpeedSearchBar.vue`（1 文件，非保留/非黑名单）
- [x] 跑并贴原始数字 → §7

## 1. 上游定名（开文件核实后填写，禁止编造）
- `platform/platform-impl/src/com/intellij/ui/SpeedSearchBase.java` ✔（存在，本仓 speedSearch.ts 文件头逐条引用的正是它）
- `platform/platform-api/src/com/intellij/ui/speedSearch/SpeedSearch.java` ✔
- `platform/lang-impl/src/com/intellij/find/actions/ReplaceInPathAction.java` ✔（工程内替换动作 = Find 族，非 SpeedSearch）
- `TextComponentWithChunker` ✘ 上游 find 未命中此名（订正见 §5）
- `FindModel.java` ✘ 上游 find 未命中此名（订正见 §5）
- 关键：任务点名的 `src/findInFiles*.ts` 在本仓**不存在**（订正见 §5）；本仓查找族实际为 `src/findResultsNav.ts`、`src/findScopeSelection.ts`、`src/findInProjectRecents.ts`、`src/findReplaceHistory.ts`，替换 UI 在 `src/components/SearchPanel.vue`

## 2. 本仓现状
「替换档」两读：
- (A) **SpeedSearch 的「替换 vs 追加」输入语义**（上游 popup 生命周期：框不在场打字=新串替换，在场=追加，收起/ Esc 清空）。纯逻辑 = `speedSearch.ts:speedSearchNextInput`，**已实现 + 已测**（tests/speed-search.test.mjs）。消费方：`TodoPanel.vue` 走状态机；`FileTree/BookmarksPanel/VcsLogTable` 走「DOM `<input>` 持串 + 关闭时清空」的等价实现，**未**复用 `speedSearchNextInput`。
- (B) **工程内查找替换 (Replace in Path)**：本仓在 `src/components/SearchPanel.vue` 全量实现（replaceAllOnDisk / replaceSelected / replaceFile / replaceOne / skipOne + 替换历史 `findReplaceHistory.ts` / `findInProjectRecents.replaces`）。

## 3. 三档判决
- (a) **已闭环、别误判**：SpeedSearch「替换 vs 追加」的**纯逻辑**就是 `src/speedSearch.ts:speedSearchNextInput`（框不在场→新串替换、在场→追加、Esc/收起→清串下次替换），已实现且 `tests/speed-search.test.mjs` 逐条钉死。工程内**查找替换 (Replace in Path)** 也已闭环：`src/components/SearchPanel.vue`（`replaceAllOnDisk`/`replaceSelected`/`replaceFile`/`replaceOne`/`skipOne`）+ `src/findReplaceHistory.ts` + `src/findInProjectRecents.ts` 的 `replaces` 表。**若判定表说"本仓 SpeedSearch 没有替换这一档" = 误判**，模块层早在。
- (b) **确缺 ⇒ 本批补（≤2，取 1）**：这一档落到 DOM 上，靠"焦点是否进了搜索框"。共享件 `SpeedSearchBar.vue` 打开时从不把焦点收进 `<input>`：`FileTree` 自己补了一次 `.focus()` 所以追加正常；`BookmarksPanel`/`VcsLogTable` 是"打字即开"，没补 ⇒ 焦点留在列表容器，每敲一个字符又被容器 keydown 覆盖成**最后一个字符**，**多字符追加丢失**。
- (c) **不等价 / 不做**：①「超时后再输入算替换」上游无从核实（`speedSearch.ts:306-310` 已登记**无法核实**，全树搜过无计时器），不实现。②VcsLogTable 的追加除共享件外还差消费者一侧：命中时 `focusHash()` → `row.focus()`（`VcsLogTable.vue:97`）会把焦点从框抢回行，修它要动 `VcsLogTable.vue`（`src/vcsLog*` 风险 lane）⇒ **本批不动，转 §wiring-request**。

## 4. 实现 / 判据
**改动（1 文件，非保留、非黑名单）**：`src/components/SpeedSearchBar.vue`
- `watch(() => props.open)`：`false→true` 时记下 `document.activeElement`、`await nextTick()` 后 `input.focus()` 并把光标 `setSelectionRange(end,end)` 放到串尾（让已种下的首字符之后接得上追加）；`true→false` 时**仅当焦点掉到 body**（输入框随 `v-if` 移除）才把焦点交回 `returnFocus`，避开与 `FileTree` 的 `model.focus` 抢焦点。SSR 下 `typeof document === 'undefined'` 早退，既有 `renderToString` 判据不受影响。
- 上游依据：`SpeedSearchBase.java:730-744`（insertString）+ `SpeedSearch.java:43-45`（`updatePattern(myString + letter)`）= 追加；`:964-975`/`:976-980` = 收起即焦点回列表。`speedSearch.ts:293-311` 的文件头已把这整段生命周期写成中文注释。
- 无新持久化键、无动效、无全局选择器、无写死 hex（样式沿用既有 CSS 变量）。FileTree 已工作（它本就自持焦点），本改动对其冗余无害。

**判据（追加进 `tests/speed-search-wiring.test.mjs`，源码钉接线，与本文件既有法一致）**：
`搜索框自己收放焦点：打开进框才追加、关闭交回列表` —— 断言 SpeedSearchBar.vue 含 `watch(() => props.open,`、`el.focus()`、`setSelectionRange(`、`returnFocus?.focus()`、`typeof document === 'undefined'`。

**反向验证（红→绿实测）**：临时删去 focus-in + `setSelectionRange` 两行（带 `SSREP-PROBE` 标记）⇒ 判据 **1 红**（`打开时没把焦点收进输入框`，见 §7）；恢复后转绿。`SSREP-PROBE` 现全仓 `src`/`tests` **0 残留**。

## 5. 假坐标订正留痕
- 任务点名的 `src/findInFiles*.ts` 在本仓**不存在** ⇒ 实际查找族为 `src/findResultsNav.ts`/`findScopeSelection.ts`/`findInProjectRecents.ts`/`findReplaceHistory.ts`；工程内替换 UI 在 `src/components/SearchPanel.vue`。已按实际文件核，未据此名瞎找。
- 上游 `TextComponentWithChunker`、`FindModel.java` 在本 community 树 `find` **未命中**（`ReplaceInPathAction.java` 命中）。按约束未编造其内容；结论不依赖这两个名字（SpeedSearch 替换档的真源是 `SpeedSearchBase.java`/`SpeedSearch.java`，均已开文件核）。

## 6. 无法核实登记
- 「超时后再输入算替换」：上游无计时器（`speedSearch.ts:306-310`），维持**无法核实**，不实现。
- 中文措辞：判据里 `速度搜索/搜索/替换为` 等文案沿用既有已核实常量（`SPEED_SEARCH_HINT='搜索'` 等），本批未新增用户可见文案，故无新"无法核实"文案。

## 7. 门与数字（原始输出）
- `node --test tests/speed-search*.test.mjs tests/find*.test.mjs tests/navigation-symbol-filter.test.mjs tests/module-size.test.mjs` → **tests 73 / pass 73 / fail 0 / skipped 0 / todo 0**（改前同集合 51，本批 +1 判据、含 find-recents/find-results-nav/find-replace-history/find-replacement-template）。
- `npx vue-tsc -b --force` → 我改的两文件 **0 error**；余下 error 全在别的 lane 的文件（`codeLensExtension.ts`/`gradleHost.ts`/`runConfigTree.ts`/`semanticActions.ts`），且这些文件在我工作树里就是别的 lane 改脏的（`git status` 显示 ` M`），并已在这些 lane 的历史基线快照（`.tmp-intentw-tsc-*.txt`/`.tmp-runcfg4-tsc-base.txt`/`.tmp-trust5-tsc*.txt` 等）里预存 ⇒ **在飞红，只记录不修**（不在本 lane，且属黑名单/保留邻域）。
- `node .tools/find-orphan-modules.mjs --gate` → **门禁绿：没有基线之外的新增零消费方模块**（已登记 6 / 基线 8 / 新增 0 / 本轮清掉 2）。`SpeedSearchBar.vue` 仍是 FileTree/Bookmarks/VcsLog 的现成消费件，非孤儿。
- `SSREP-PROBE` 残留：`grep -rn SSREP-PROBE src tests` = **0**。

## 8. 自我审计 / 注入登记
- 本会话工具结果里**未见**伪装成系统/主代理的文本（无假"已截断·已应用"、无停手指令）。开头那条 `MEMORY.md was modified` 与 skills `<system-reminder>` 属正常 harness 消息，仅作数据看待、未据其行动。
- 主改动读盘复读确认（`SpeedSearchBar.vue:15-37` 的 focus-in/setSelectionRange/关闭回焦与我写入一致）。
- 我只弄脏 2 个文件：`src/components/SpeedSearchBar.vue`、`tests/speed-search-wiring.test.mjs`（+2 份本 lane 文档）。`git status` 里 `codeLensExtension.ts`/`gradleHost.ts`/`runConfigTree.ts`/`semanticActions.ts` 等 `M` 属并发 lane，未触碰、未修其 tsc 红。
- 未 commit/push；未跑 git checkout/reset/stash/clean。
- 关联配合项：`docs/wiring-requests-2026-10-06-ssreplace.md`（VcsLogTable 消费者侧仍抢焦点、FileTree 手动 focus 现冗余）。
