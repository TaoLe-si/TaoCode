# 批次报告 · 桶9「搜索 / 比对」族 · 归属核对 + 门禁自查（2026-10-06）

lane: `searchdiffdoc`（只读 + 文档型）
生成时间：2026-10-06（本 lane 唯一允许的写操作产物 = 本报告 + `docs/wiring-requests-2026-10-06-searchdiff.md` 的增补）
待办欠账：`#160 桶9：门禁自查 + 交付报告 docs/batch-2026-10-06-searchdiff.md`

> 本报告**不抄任何 lane 的自述数字**。所有门禁数字都是本 lane 自己跑出来的原始输出（§4）。
> 所有归属结论以 `git status --porcelain` + `git diff --numstat` + mtime 三方交叉（§2、§3）。

---

## 0. 一句话结论

**这一族本轮没有半截的搜索/替换实现，但有三处"归属没写清"和一处新出现的红是别人的**：

1. **findrep2 那一半是完整的**：`preserveCaseReplacement`（默认档改成上游真默认=逐词，`registry.properties:1414` 本 lane 自己开树量过）与 `replaceAllConfirmNote` 都**导出+有生产消费点+有判据+能加载**，编辑器侧链路已闭；缺的那一半（工程内替换的 native 侧）本来就写着"要保留文件配合"，本 lane 已把它连同 ssreplace/ss4 的请求一起收进 `docs/wiring-requests-2026-10-06-searchdiff.md` 的增补节，**并逐条核对过出口名**（其中 ss4 点名的 `src/bridge.ts` 是错的，真出口是 `src/languages.ts:8`）。
2. **桶9 名下有一处"没人认领的已完成"**：`docs/wiring-requests-2026-10-06-searchdiff.md` 上面的 W-1（代码块结构支持）其实**早就接上了**（`editorCodeBlock.ts:41/:168-172` + `editorCommands.ts:187` + 判据 17/17 绿），请求单没销账，里面那 321 行"待恢复的实现"现在是**第二份真源的诱饵** ⇒ 已在本 lane 的增补节里销账并标注风险。
3. **桶9 名下有一处"没登记删除人"**：`tests/b9-verdict.test.mjs` 把唯一的漂移登记条目删空（0/−24）且门绿、账本两侧同档，但没有任何文档写过是谁删的（§1 末 + §3.2-3）。
4. **真正在飞的两路会把桶9 的数字作废**：`ssmatch` 在写 `src/speedSearch.ts`（**本 lane 两次读取之间 mtime 从 13:41:33 跳到 17:02:48、再跳 17:05:36，353→392 行，已停手登记 §3.1**；它的报告 §1–§7 全"待填"），`diffverdict` 的 `src/diffAlign.ts`（16:53:54）比它自己报告（16:43:38）还新。⇒ 本 lane 对这两份文件的一切数字**只到"快照时刻"有效**，引用必须现取。
5. **门禁**：族门 16:53 那次 **371/371 全绿**（`tests/replace*.test.mjs` 该档无匹配文件）；死模块门绿（基线 8 该降到 6）；引用门 **3 红**（1 条越界行号 = findrep2 的报告文件、4 条 moved 锚点 = commit/problems/run-startup 三路）；17:07 重跑多出的那 1 红是 **`native/workspace.cpp` 被别路在 17:02:47 写成 1482 行 > 上限 1385**，与桶9 无关。红名单本身在漂 ⇒ §6/§3.4 已把"跨 lane 引用锚点条数必错"记成规则。

## 1. 归属现状：这一族近一天被谁动过

`HEAD = 200232e (2026-10-06 12:33:24 +0800)` ⇒ **下表所有改动都是 12:33 之后落在工作树里的未提交内容**，`git diff --numstat` 是唯一的硬账（各 lane 自述的行数与它不一致时，本报告以 numstat 为准，见 §3.4）。

圈定方法（三方交叉，任一方单独都不可信）：`git status --porcelain` ∩ `git diff --numstat` ∩ `find src tests -newermt "-12 hours"` + 逐文件 `stat`。

| mtime 窗口 | 文件（`+添加/−删除` 为 numstat 原始值） | 落在谁名下（依据） |
| --- | --- | --- |
| 13:30–13:49 | `src/lspSymbolBridge.ts` 2/2（13:30:47）、`tests/navigation-symbol-filter.test.mjs` 4/2（13:31:09）、`src/speedSearch.ts` **240/31**（13:41:33）、`tests/speed-search.test.mjs` **175/3**（13:41:59）、`src/symbolSearch.ts` **26/11**（13:49:40） | **ss 族的"前一批"**（不是 ssmatch）：`docs/batch-2026-10-06-ssmatch.md` §0 自己写明接手时这些改动已经在盘上、未提交。⇒ `speedSearch` 的分隔符感知那一档**归属早于 ssmatch**，ssmatch 是核对方 + 报告方 |
| 15:21–15:25 | `tests/speed-search-wiring.test.mjs` 20/4（15:21:35）、`src/components/SpeedSearchBar.vue` 33/3（15:25:45） | **ssreplace**（`docs/batch-2026-10-06-ssreplace.md` mtime 15:27:34，正文点名"本批已在共享件 `SpeedSearchBar.vue` 补上打开即把焦点收进输入框"） |
| 15:37–15:46 | `tests/diff-align.test.mjs` 16/9（15:37:03）、`tests/diff-patience.test.mjs` **新增未跟踪**（15:42:33）、`tests/diff-fair.test.mjs` **新增未跟踪**（15:43:18）、`src/diffAlign.ts` **306/47**（15:44:13 那一次）、`src/diffChunks.ts` **94/0**（15:44:14）、`tests/diff-citations.test.mjs` 51/0（15:46:46） | **diff 族的"前任 lane"**（Patience 退路整段新代码 + fair 校验 + 行号订正）；diffverdict 自己在 §4 承认「`+306/-47` 的其余部分是前任 diff lane 的 Patience 实现」 |
| 15:42–15:46 | `src/editorFindController.ts` 4/2（15:42:56）、`tests/editor-find-options.test.mjs` 2/2（15:43:14）、`tests/preserve-case.test.mjs` 18/3（15:43:41）、`tests/search-replace-outcome.test.mjs` 37/2（15:44:24）、`src/searchReplaceOutcome.ts` 39/0（15:46:06）、`src/preserveCase.ts` 23/2（15:46:07）、`src/components/SearchPanel.vue` 4/4（15:46:08） | **findrep2**（其报告 §附 自列改动集 = 这 4 个 src + 这 3 个 test + 报告 + wiring，与 numstat/窗口逐条对得上） |
| 16:43–16:53 | `docs/batch-2026-10-06-diffverdict.md`（16:43:38）→ **`src/diffAlign.ts` 又被写了一次（16:53:54）** | **diffverdict 在飞**：源码 mtime 比它自己报告的 mtime **晚 10 分钟** ⇒ 收工后仍在动，本 lane 对它的一切判定只到"本次快照"为止 |
| 16:44 | `docs/batch-2026-10-06-ssmatch.md`（16:44:48，正文 §1–§7 **全是「（待填）」**） | **ssmatch 在飞**：报告骨架已落、内容未落 |

**桶9 名下但不由桶9 写的两处（归属缺口，重点）**：

- `tests/b9-verdict.test.mjs` **0/−24**（mtime 12:42:16，正好在 HEAD 提交 12:33:24 之后）：`REGISTERED_DRIFT` 里唯一一条 `ApplyNonConflictsAction` 被**整条删空**，登记表现在是 `[]`。
  内容域是 diff/merge（`src/mergeResolve.ts` 那条链），删表条件出自 b89 自己写的自清理规则「修好后不删条目 ⇒ 红」。
  本 lane 复核了**账本两侧现在同档**：`docs/inventory/verdict-find-diff.md:508` = `[x]`、`docs/inventory/verdict-settings-run.md:661` = `[x]`（后者仍在工作树未提交）⇒ 删条目与账本同步**互相自洽**，`node --test tests/b9-verdict.test.mjs` 本 lane 实测 **9 / 9 / 0 红**。
  ⇒ 但**没有任何一份桶9 文档登记过"是谁删的"**（`grep -rl REGISTERED_DRIFT docs/` 只命中 b89 一份）。归属建议：`mergeclose`（其报告 mtime 16:53:21，在飞）或主代理；见 §3.3。
- `src/findInProjectRecents.ts`：派单把它列进候选，实测**它根本不在这一族的改动集里** —— mtime `2026-10-04 23:09:59`、`git status` 干净、判据 `tests/find-recents.test.mjs` 在跑且绿 ⇒ **本族这一档一天内没人动**。

## 2. 逐文件判定：完整 / 半截 / 只改注释 / 有判据没实现

判定口径：**导出名存在 ∧ 生产侧有消费点 ∧ 判据点得到它 ∧ 模块能加载**。四样缺一就不算"完整"。
加载烟测（本 lane 实跑，node 24 直接 import `.ts`）：`lspSymbolBridge OK / symbolSearch OK " ()" / preserveCase OK true / searchReplaceOutcome OK / diffChunks OK` —— **没有一条加载期断链**。

| 文件 | 判定 | 依据（本 lane 自己打开核过的） |
| --- | --- | --- |
| `src/searchReplaceOutcome.ts` 74 行 | **完整** | 新增 `replaceAllConfirmNote` + `ReplaceAllConfirmInfo`（`:33-73`，净 +39）。消费点 `SearchPanel.vue:13` import、`:437`（作用域支）、`:446`（工作区支）两处都换掉了原先的内联模板串；判据 `tests/search-replace-outcome.test.mjs:15` 直接 import 该导出 |
| `src/preserveCase.ts` 167 行 | **完整 + 订正了注释里的事实错误** | 新增 `WORD_BASED_PRESERVE_CASE = true`（`:153`）与入口 `preserveCaseReplacement(found, replacement, wordBased?)`（`:164`）。**注释原先写"上游默认走 `replaceWithCaseRespect`、注册表项默认关"是反的** —— 本 lane 自己开树核实：`platform/util/resources/misc/registry.properties:1414` 确为 `ide.find.word.based.preserve.case=true`，`FindManagerBase.java:293-295` 确为 `Registry.is(...) ? applyCase(foundString, replacement) : replaceWithCaseRespect(replacement, foundString)`，`FindModel.kt:411` `var isPreserveCase: Boolean = false`（用户档默认关、算法默认逐词，两件事不矛盾）⇒ 改后的注释与上游一致 |
| `src/editorFindController.ts` 309 行 | **完整（薄接线，净 +2）** | `:18` 改引 `preserveCaseReplacement`、`:231` 唯一调用点 `state.preserveCase ? preserveCaseReplacement(found, text) : text`；顺序约束（正则展开在前、形态在后）写进 `:204-208` 注释并有判据 `tests/editor-find-options.test.mjs:131` + `tests/preserve-case.test.mjs:103,108` 双向钉住 |
| `src/components/SearchPanel.vue` 898 行（门口径） | **完整，且没把上限顶高** | 4/4 净 0 行：两处确认语改调纯函数。**注意它是"未登记大文件"**，默认上限 900 ⇒ 现余量只有 **2 行**（见 §5，findrep2 的"再加一颗 preserve 开关"必须先在它内部腾行） |
| `src/lspSymbolBridge.ts` 191 行 | **完整（曾经的加载期断链已闭）** | `:33` 引 `SPEED_SEARCH_STRUCTURE_SEPARATORS`、`:170` 作第三参传入。断链的修法是上游 `symbolSearch.ts:23` 补了 `export { SPEED_SEARCH_STRUCTURE_SEPARATORS }`（真身在 `speedSearch.ts:128 = ' ()'`）——**修的是被引方而不是引用方**，所以本文件 mtime（13:30）比 `symbolSearch`（13:49）早。判据 `tests/navigation-symbol-filter.test.mjs` 4/4 绿 |
| `src/symbolSearch.ts` 41 行 | **完整（在飞 lane 名下，本 lane 不动）** | re-export + `symbolMatchesQuery(name, query, hardSeparators = '')`（`:35`）参数化，转发给 `speedSearchMatches`。消费方 `lspSymbolBridge`。**风险登记**：它同时是 `ssmatch` 的禁区内文件，本 lane 只读 |
| `src/speedSearch.ts` 354 行（16:58 门口径；17:02 后 392 行，**本 lane 不再判它**） | **功能上完整，文档上半截** | 分隔符感知那一档实测已在盘上：`speedSearchMatches(pattern,text,hardSeparators)`、`patternSeparatorProfile`、`SPEED_SEARCH_STRUCTURE_SEPARATORS = ' ()'`（本 lane 16:56 数到的是 `:128`，**17:02 那次改写后挪到了 `:162`** ⇒ 这两个行号都只是快照，别抄，见 §3.1）。判据侧 `tests/speed-search.test.mjs`(+175/−3)/`speed-search-wiring`(+20/−4) 全绿。**但它的 lane 报告 `docs/batch-2026-10-06-ssmatch.md` §1–§7 全是「（待填）」** ⇒ 代码收工、交付未收工（在飞，不归本 lane 补） |
| `src/diffAlign.ts` 522 行（门口径） | **只改注释那一半成立；整文件仍在飞** | numstat 306/47 里：Patience 整段新代码 = 前任 diff lane；`diffverdict` 自述只贡献"头注 5 处替换 + 24 行留痕块"。本 lane 复核到 **mtime 16:53:54 晚于它自己报告的 16:43:38**，即"收工后源码又动过" ⇒ 不判它完整，只登记快照。门侧本 lane 实测 `tests/b7-verdict.test.mjs` **10/10 绿**、`tests/diff-align.test.mjs` 绿 |
| `src/diffChunks.ts` 299 行（门口径） | **半截（形态："实现 + 判据齐全，生产侧零调用"）** | 新增 12 个导出。逐符号查消费方（本 lane 自己 `grep -rl`）：`expandForward/expandBackward/optimizeSpans/pairsToSpans/spansToPairs/changedSpans/expandMatchGaps/wordShift/MatchSpan/ShiftFn/ShiftToken` **都有生产消费**（`src/diffChars.ts`、`src/diffSmartLines.ts`、`src/diffWords.ts`）；**唯 `setVerifyEnabled` 与 `verifyFairSpans` 生产侧 0 命中**，只被 `tests/diff-fair.test.mjs`、`tests/diff-patience.test.mjs`、`tests/diff-citations.test.mjs` 打开 ⇒ "公平性不变式"只在测试里成立，运行时不校验。归属：前任 diff lane / `diffverdict`，**在飞禁改**，本 lane 只登记（§3.2） |
| `src/findInProjectRecents.ts` 75 行 | **不属于本族本轮改动** | mtime 10-04、git 干净 |
| `src/components/SpeedSearchBar.vue` 54 行 | **完整（ssreplace 名下）** | 33/3：焦点收放上移到 `watch(open)`；判据 `tests/speed-search-wiring.test.mjs`(+20/−4) 绿。它的**遗留**是跨 lane 请求（`VcsLogTable` 仍丢追加），见 §5 |
| `tests/b9-verdict.test.mjs` | **自洽但无归属登记** | 见 §1 末与 §3.3 |

## 3. 半截现场排查（并发在跑 + 撞墙残留）

### 3.1 ⚠ 在飞实锤：`src/speedSearch.ts` 在本 lane 两次读取之间被改写（已停手）

本 lane 按纪律做了三次 mtime 快照，抓到了：

| 时点 | `src/speedSearch.ts` |
| --- | --- |
| 快照 A（16:53） | mtime `13:41:33.731993600` |
| 快照 B（16:55:26） | 同上 |
| 快照 C（16:58:18） | 同上；`wc -l` 353、gate 口径 **354** 行、`git diff --numstat` **240/31** |
| **17:02:58** | mtime **`17:02:48.290432600`** ⇒ 距上一次快照 4 分 40 秒后被写入；`wc -l` **392**、numstat **280/32** |

**证据是行号自己招的**：16:56 那次 `grep` 报 `speedSearch.ts:128 = export const SPEED_SEARCH_STRUCTURE_SEPARATORS`；17:02 再 `grep` 同一张表，`:128` 变成 `patternSeparatorProfile`、常量挪到 `:162`、末尾 `SPEED_SEARCH_HINT` 已在 `:387`（> 我数过的 354 行）。⇒ `ssmatch` 正在往这个文件加东西（它 §0 声明剩下的活是「**退格超时 / 取消过滤**」那一档）。

**本 lane 的处置**：`src/speedSearch*` 在禁改名单里，**没有写过它一行**；发现改写后立刻停止对它的一切内容判定。
连带后果：**§4.1 那 371/371 对应的是 16:53–16:55 的树，对 17:02 之后的树不再保证成立**（本 lane 的复跑见 §4.1 末，两次数字都贴）。
归属建议：这段增量（353→392 行）算 `ssmatch` 名下，请它在自己的报告 §2 里认领；**其他 lane 不得据此认为桶9 的 matcher 又缺了一档**。

其余在飞文件的核对（17:02:58 同一批 `stat`，**均未移动**）：`symbolSearch 13:49:40`、`diffAlign 16:53:54`、`diffChunks 15:44:14`、`lspSymbolBridge 13:30:47`、`SpeedSearchBar.vue 15:25:45`、`speed-search.test 13:41:59`、`diff-patience 15:42:33`、`diff-fair 15:43:18`。
⇒ 只有 `speedSearch.ts` 在动；但 **`diffAlign.ts` 的 mtime(16:53:54) 比 `diffverdict` 自己报告的 mtime(16:43:38) 还晚 10 分钟** —— 它那份报告写完后源码又落过一次，所以它的 §4「只动注释」结论要对 16:53:54 那一版重新自证（不归本 lane 做，登记给主代理）。

### 3.2 桶9 里现在真实存在的"半截"（三处，全部不归本 lane 修）

1. **`src/diffChunks.ts` 的 fair 校验只在测试里开**：`setVerifyEnabled` / `verifyFairSpans` 生产侧 **0 消费点**（`grep -rl` 实测：只命中 `tests/diff-fair.test.mjs`、`tests/diff-patience.test.mjs`、`tests/diff-citations.test.mjs`）。其余 11 个新导出都有生产消费（`src/diffChars.ts` / `diffSmartLines.ts` / `diffWords.ts`）。⇒ 形态 = "实现 + 判据齐、运行时不校验"。**是不是半成品由 `diffverdict` 判定**（该文件在它名下在飞），本 lane 不动。
2. **`docs/batch-2026-10-06-ssmatch.md` 代码在长、报告全空**：正文 §1–§7 全是「（待填）」，而它名下文件 17:02 还在被写 ⇒ 典型的"实现跑在交付前面"。欠账与桶9 的 `#160` 是同一类问题，只是它还没到撞线的时候。
3. **`tests/b9-verdict.test.mjs` 的漂移登记表被删空、无人认领**（详见 §1）：门本身现在是绿的（9/9），账本两侧也同档 `[x]`（`verdict-find-diff.md:508` / `verdict-settings-run.md:661`），**唯一缺的是"谁删的"这一行字**。⇒ 归属建议：`mergeclose`（在飞、报告 16:53:21 刚写过、条目内容域是 `src/mergeResolve.ts` 那条链）或主代理；请它在自己的报告里补一句认领，否则下一个人会以为"桶9 有人核过这条"。

### 3.3 撞墙 lane（`ss3`）的现场：**已被主代理还原，但看板口径与磁盘不符**

- `docs/batch-2026-10-06-lane-board.md`（mtime 17:02:10，主代理的板）第 21 行记：`ss3` 停在"准备写共享 matcher 扩展"，**扩展没写、报告没有**，并留下加载期断链 `src/lspSymbolBridge.ts:33 → symbolSearch.ts` 只 import 不导出；同板写明 **"✅ 主代理已补 `src/symbolSearch.ts` 的再导出"**。
- 本 lane 磁盘复核：`src/symbolSearch.ts:23` 确有 `export { SPEED_SEARCH_STRUCTURE_SEPARATORS }`；`node -e "import('./src/lspSymbolBridge.ts')"` **成功**（17:00 实跑）⇒ **断链确实已修，修的是被引方**，与板上那句话一致。
- 但板上那句「共享 matcher 的扩展（分隔符感知/退格超时）**仍未做**」**与磁盘不符**：`分隔符感知` 那一档早就在盘上（16:58 快照：`speedSearchMatches(pattern,text,hardSeparators)`、`patternSeparatorProfile`、`SPEED_SEARCH_STRUCTURE_SEPARATORS`，且 `tests/speed-search.test.mjs` 里"硬分隔符集逐字照上游 / 两处豁免 / 只查两个 hump 之间"那几条判据全绿）。⇒ **准确说法应是"退格超时/取消过滤仍未做"**（`ssmatch` §0 也正是这么写的）。这就是"没有归属表就会重复修"的现形：照板上的话再派一次 ss，会白做一半。
- `ss3` 名下**没有** `docs/batch-2026-10-06-ss3.md`（`ls docs | grep ss3` = 0 份），符合板上"报告没有"那一条；它的残留就是上面那条断链，已闭。

### 3.4 lane 自述数字与 `git diff --numstat` 的对账（不抄自述的代价）

| 文件 | lane 自述 | numstat 实测 | 差 |
| --- | --- | --- | --- |
| `src/speedSearch.ts` | ssmatch §0：「`+271/-` 改动」 | 16:58：**240/31**；17:02：280/32 | 16:58 时点差 31 行；17:02 后它变成对的 ⇒ **自述只对某一时刻成立**，引用必须带时间戳 |
| `src/symbolSearch.ts` | ssmatch §0：「`+37/-`」 | **26/11** | 自述多算 11 行；`symbolSearch` 是主代理 13:49 那一笔，不是 ssmatch 的 |
| `src/diffAlign.ts` | diffverdict §4：「`+306/-47`」 | **306/47** | 一致 ✓（它引的是 numstat，不是自述） |
| 锚点快照不一致条数 | diffverdict §3：「**6 条**，命中 `actionsOnSave.ts`/`breakpointGroups.ts`/`browsers.ts`/`buildContentRoots.ts`」 | 本 lane 16:54 实测 **4 条**，命中 `ProblemsPanel.vue`×2 / `commitChecks.ts` / `runStartupFocus.ts` —— **两组文件零交集** | 门的红名单**本身在漂**（每有 lane 动引注释的文件就换一批）。⇒ 任何"锚点红有几条"的陈述都要现跑现说，§6 按此处理 |
| `docs/wiring-requests-2026-10-06-findrep2.md`：`src/bridge.ts`「余量 **0**」 | 本 lane 复核（`split('\n').length` 口径，`tests/module-size.test.mjs:157`）：现 **905 行 / 上限 905** ⇒ 余量 **0** ✓ | 一致 ✓（派单里说的"0 贴顶"也对；但**同一段里 `src/App.vue` 的余量被到处写成 30，实测是 24**，见 §5） |

## 4. 门禁原始数字（本 lane 复跑，未转发他人自述）

跑的时间点：2026-10-06 16:53–16:55（+0800）。三条门都是本 lane 自己执行的原始输出，**逐字贴**。

### 4.1 族内测试门

```
$ node --test tests/find*.test.mjs tests/search*.test.mjs tests/replace*.test.mjs \
      tests/speed-search*.test.mjs tests/diff*.test.mjs tests/module-size.test.mjs
ℹ tests 371
ℹ suites 0
ℹ pass 371
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2936.6341
exit=0
```

**glob 核实结果**（`ls` 逐个核过，不是照抄任务给的档名）：

| 档 | 匹配 | 说明 |
| --- | --- | --- |
| `tests/find*.test.mjs` | 4 | `find-recents` / `find-replace-history` / `find-replacement-template` / `find-results-nav` |
| `tests/search*.test.mjs` | 12 | `search-everywhere`×4、`search-exclusions`、`search-history`、`search-preview`×2、`search-replace-outcome`、`search-scope-selection`、`search-stream` |
| `tests/replace*.test.mjs` | **0 —— 该档无匹配文件** | `ls` 报 `cannot access 'tests/replace*.test.mjs': No such file or directory`。`node --test` 对这个不匹配的 pattern **不报错、静默零贡献**（exit 仍 0），所以"跑了 replace 门"这种说法在本仓现在是不成立的：替换相关的实际落点在 `search-replace-outcome.test.mjs`、`find-replacement-template.test.mjs`、`structural-search-replace.test.mjs` 这三处，没有一档是以 `replace` 开头的 |
| `tests/speed-search*.test.mjs` | 2 | `speed-search`、`speed-search-wiring` |
| `tests/diff*.test.mjs` | 13 | `diff-align`、`diff-chunks`、`diff-citations`、`diff-fair`、`diff-fold`、`diff-nav`、`diff-patch-copy`、`diff-patience`、`diff-policy-combo`、`diff-search`、`diff-smart-lines`、`diff-unified`、`diff-words` |
| `tests/module-size.test.mjs` | 1 | 见 §4.4 |

⇒ **371 条全绿**，其中包含 `module-size` 那一档。注意这是"这一族自己的档"绿，不代表桶9 全绿（见 §4.5 的 b9-verdict）。

### 4.2 孤儿模块门

```
$ node .tools/find-orphan-modules.mjs --gate
词法自检：0 异常（每个 specifier 都在原文里逐字存在）
门禁：已登记孤儿 6 / 基线 8 · 新增 0 · 本轮清掉 2
   ✔ 已接上（可以更新基线）：src/jarRun.ts
   ✔ 已接上（可以更新基线）：src/runAnythingContext.ts
门禁绿：没有基线之外的新增零消费方模块。
exit=0
```

本族的模块**一个都不在孤儿名单里**：`searchReplaceOutcome.ts`、`preserveCase.ts`、`diffAlign.ts`、`diffChunks.ts`、`speedSearch.ts`、`symbolSearch.ts`、`lspSymbolBridge.ts` 都有真实消费方（§2 逐条给了消费点）。`"本轮清掉 2"` 那两条（`jarRun.ts`/`runAnythingContext.ts`）是别的桶的，基线仍写 8 ⇒ **基线本身该由主代理下调为 6**，本 lane 不动 `.tools`/账本。

### 4.3 引用门（共享门红，现状如实）

```
$ node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs
ℹ tests 11
ℹ pass 8
ℹ fail 3
exit=1
```

三条红的原文见 §6。

### 4.4 module-size 实测（本族 + 接线目标文件）

门自己跑的数（`tests/module-size.test.mjs:157` 的口径是 `readFileSync(...).split('\n').length`，**比 `wc -l` 多 1**，报余量必须用这一口径）：

```
$ node --test tests/module-size.test.mjs
✔ 没有未登记的巨型源文件（超上限就该拆模块） (100.2181ms)
ℹ tests 5 / pass 5 / fail 0
```

| 文件 | 现在（门口径） | 上限 | **真实余量** | 上限出处 |
| --- | --- | --- | --- | --- |
| `src/App.vue` | 2713 | 2737（已登记） | **24** | `tests/module-size.test.mjs:108` |
| `src/bridge.ts` | 905 | 905（已登记） | **0 ⇒ 贴顶，任何净增行当场判红** | `:127` |
| `src/components/CodeEditor.vue` | 1145 | 1147（已登记） | **2** | `:136` |
| `native/main.cpp` | 1846 | 2000（已登记，"上限固定 2000 行，新能力一律抽成 `native/xxx.cpp`"） | **154** | `:37` |
| `src/components/SearchPanel.vue` | 898 | 900（**未登记**，走 `DEFAULT_LIMIT`，`:22`） | **2** | `:22` |
| `src/components/EditorFindBar.vue` | 217 | 900（未登记） | 683 | `:22` |
| `src/speedSearch.ts` | 354（16:58 快照）→ **392**（17:02 被 ssmatch 改写后） | 900 | 508→509（在飞，别按本表记账） | `:22` |
| `src/diffAlign.ts` | 522 | 900 | 378 | `:22` |
| `src/diffChunks.ts` | 299 | 900 | 601 | `:22` |
| `src/editorFindController.ts` | 309 / `src/preserveCase.ts` 167 / `src/searchReplaceOutcome.ts` 74 / `src/symbolSearch.ts` 41 / `src/lspSymbolBridge.ts` 191 | 900 | 591 / 733 / 826 / 859 / 709 | `:22` |

⇒ **派单里"App.vue 余量 30"这个数字对不上：实测 24**（2713 vs 2737）。凡是照"30"排产线的接线都会差 6 行的预算。其余三个（`bridge.ts` 0 贴顶 / `CodeEditor.vue` 2 / `SearchPanel.vue` 2）实测一致。

### 4.5 桶9 判决书门 + 相邻门（任务给的清单里没有，本 lane 自己补跑）

| 命令 | tests | pass | fail | 备注 |
| --- | --- | --- | --- | --- |
| `node --test tests/b9-verdict.test.mjs` | **9** | **9** | **0** | 桶9 判决交叉核对；`REGISTERED_DRIFT` 现为 `[]`（§3.2-3） |
| `node --test tests/b7-verdict.test.mjs` | **10** | **10** | **0** | diff 侧上游行号那条（`diffAlign.ts` 留痕块）现在绿 |
| `node --test tests/structural-search*.test.mjs tests/find-*.test.mjs tests/editor-find-options.test.mjs tests/preserve-case.test.mjs tests/search-replace-outcome.test.mjs` | **160** | **160** | **0** | 结构搜索 + 查找历史/模板/recents 这一片的合跑 |
| `node --test tests/navigation-symbol-filter.test.mjs` | 4 | 4 | 0 | `lspSymbolBridge` 常量链那一条 |
| `node --test tests/module-size.test.mjs` | 5 | 5 | 0 | 见 §4.4 |

### 4.6 17:02 之后的补测（并发写入后重跑族门，两次数字都留）

`src/speedSearch.ts` 在 17:02:48、17:05:36 又被写了两次（§3.1）。本 lane 于 **17:07:46** 重跑同一条族门命令：

```
$ node --test tests/find*.test.mjs tests/search*.test.mjs tests/speed-search*.test.mjs \
      tests/diff*.test.mjs tests/module-size.test.mjs
ℹ tests 371
ℹ pass 370
ℹ fail 1
✖ 已登记的 native 大文件不许继续变大 (7.8226ms)
exit=1
```

原始断言（逐字）：

> `native/workspace.cpp 现在 1482 行 > 上限 1385（文件系统与工作区操作……上限 1480 降到 1385。）`

三条要点：

1. **这条红不是桶9 的**，也不是"16:53 那次绿是假的"：`native/workspace.cpp` 的 mtime 是 **17:02:47**、`git diff --numstat` 现在是 **135/22**（净 +113），而 **16:52 本 lane 开工那次 `git status` 里根本没有这个文件**（它和 `native/terminal.cpp`、`native/lsp_support.cpp`、`native/lsp_session.hpp` 一样是这次会话期间才变 M 的）。⇒ 归属：正在写 `native/workspace.cpp` 的那一路（本 lane 不知道是哪条 lane，**请主代理按 mtime 17:02:47 认领**）。
2. 处置建议给那一 lane：**按 `tests/module-size.test.mjs:70-79` 登记的理由拆一个新 `native/xxx.cpp`**（登记文本已经写明"helper 与新域应拆到 fsops/新文件"），**不许抬上限**（`:7` 的规约："抬数字就是堆砌"）。
3. **族内 371 条测试的条数两次完全一样**（16:53 与 17:07），而 `speedSearch.ts` 这中间净增 39 行 ⇒ ssmatch 这一段新增实现**还没有配套判据落盘**（也可能它正写到一半）。登记给 `ssmatch`，不归本 lane 补。

其余门在本 lane 会话期间的最终状态：`node --test tests/b7-verdict.test.mjs tests/b9-verdict.test.mjs` ⇒ 19/19 绿；`node .tools/find-orphan-modules.mjs --gate` ⇒ 绿；引用门 ⇒ 3 红（§6）。

## 5. 接线请求（收拢到独立产物）

产物：**`docs/wiring-requests-2026-10-06-searchdiff.md` 的「增补 · `searchdiff` lane」一节**（本 lane 写；原文件是 11a736e 提交的桶9 早期请求单，本 lane **只追加、没删它一行**）。

收拢结果一句话版：

| 编号 | 请求 | 目标（保留文件） | 状态 |
| --- | --- | --- | --- |
| **销账 W-1** | 代码块导航「结构支持」那一半 | `src/editorCodeBlock.ts`、`src/editorCommands.ts`（**都不是保留文件**） | **已经落地**：`editorCodeBlock.ts:41`+`:168-172`、`editorCommands.ts:50`+`:187`、`structuralCodeBlock.ts:532/541/548`、判据 `tests/editor-code-block.test.mjs:98`/`:116`（17/17 绿）。请求单里那 321 行「待恢复的实现」现在与真源重复 ⇒ **请标过期，别再恢复** |
| **W-2** | 工程内替换「保留大小写」全链（源 findrep2） | `native/main.cpp`（余量 154）、`src/bridge.ts:192`（**余量 0，只能一行内改**）、`src/components/SearchPanel.vue`（余量 2，加 toggle 正好贴顶） | 出口名**全部核对为真**：`main.cpp:1300` 那一条 `case` 分支 + `:1302-1310` 逐字段、`search.hpp:15 struct Options`（`:17-20` 四个字段逐个对过）、`search.cpp:750` 与 `:778/:782`。上游三条坐标本 lane 自己开树复量过（§5 表 + 报告 §2） |
| **W-3** | Python 结构档在生产走不到（源 ss4） | `src/components/CodeEditor.vue:91/:481`（余量 2）、`src/App.vue`（余量 24） | **来源点名有错并已订正**：ss4 说要动 `src/bridge.ts` ⇒ **不对**，真出口是 `src/languages.ts:8 EDITOR_LANGUAGES`（`bridge.ts:87` 只是原样 re-export，而它余量 0）。**另有硬门槛**：`@codemirror/lang-python` 不在 `package.json` 也不在 `node_modules` ⇒ 要引新依赖 |
| **W-4** | `VcsLogTable` 速度搜索追加仍丢（源 ssreplace） | 非保留文件，但归 vcsLog lane（该文件正被改：+103/−38） | 出口名全对、**行号全漂**：`focusHash` 实测 `:114`（原文 `:92-98`）、querySelector 抢焦点 `:118`（原文 `:96-97`）、`onSearchInput` `:154-155`（原文 `:132-133/:178-182`）。已给现值 |
| **W-5** | `FileTree.vue:231` 冗余 focus（源 ssreplace §2） | 非保留 | 可选清理，删不删归 project-tree lane |

"挂不上的退化后果"每条都写在了产物里（W-2 = 两个入口行为分叉、W-3 = 判据全绿但链路永远拿到 `'other'`、W-4 = 连打两字符只留最后一个）。

## 6. 已知共享门红：现状与归属建议（本 lane 不改）

`node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` ⇒ **tests 11 / pass 8 / fail 3 / exit 1**（16:54）。三条红的**原始 actual** 如下，账本与快照一律未碰（`docs/inventory/citation-anchors.json` 现在是别的 lane 改着的 +175/−0）。

### 6.1 越界行号（1 条，被两条门各报一次 ⇒ 占了 3 红里的 2 红）

```
（门的原始输出是一条「docs\batch-2026-10-06-findrep2.md :: 一条指向 ConsoleViewImpl.kt 的引用 + 六位占位行号 ⇒ 行号超出文件长度」。
 本节故意不照抄那条「路径:行号」完整形状 —— 照抄就会成为下一份报告里同一条红的出处，这条规则正是本节下面第 4 条自己论证过的。）
```

- 出处实测在 `docs/batch-2026-10-06-findrep2.md:124` —— 那一行是 findrep2 在叙述"中途红过一次"时，把并发 lane 当时的六位占位行号**原样抄进了 md**；门扫 `docs/**/*.md` ⇒ 把叙述当成了 live 引用。
- 本 lane 独立复核了那个"1730"：参考树里 `ConsoleViewImpl.kt` `wc -l` = **1729**，门的 `split('\n').length` 口径 = **1730** ⇒ 门的报错自洽，**六位行号必红**。
- 归属建议：**findrep2 名下（它自己的报告文件）**，本 lane 不碰。解法有两条且都不算放水：① 把路径写成省略形式（`platform/.../ConsoleViewImpl.kt`）—— 本 lane 打开门看了规则，`tests/source-citations.test.mjs:17-18` 只核以 `platform|plugins|java|kotlin|python|wire|tools` 打头的完整路径，且 `:67` 的自检用例逐字钉着"`platform/util/.../Util.java:5` 那种省略写法不核" ⇒ 这条解法**已被门的自证成立**；② 直接把 `999999` 换成实测 `1729/1730` 级别的真行号。**唯一不许做的**是把门的扫描范围调窄。
- 顺带：`999999` 这个占位数在全仓 `src`/`tests` 已查无（findrep2:124 那处是唯一残留），所以修掉文档这一处门就绿 —— **不需要动 `src/consoleScroll.ts`**。

### 6.2 锚点快照不一致（4 条 `moved`，全是别路名下）

原始 actual（逐字，只把长尾说明省略）：

```
moved :: src/commitChecks.ts|platform/vcs-impl/src/com/intellij/openapi/vcs/actions/commit/CommonCheckinFilesAction.kt|26-78
moved :: src/components/ProblemsPanel.vue|platform/analysis-api/src/com/intellij/codeInspection/SuppressIntentionAction.java|19-19
moved :: src/components/ProblemsPanel.vue|platform/lang-impl/src/com/intellij/codeInsight/intention/IntentionSource.java|37-40
moved :: src/runStartupFocus.ts|platform/execution/src/com/intellij/execution/RunnerAndConfigurationSettings.java|242-242
```

- 本 lane 对"为什么漂"只给证据、不下结论：这三个文件在工作树里**都正被改**（`src/commitChecks.ts` +93/−30、`src/components/ProblemsPanel.vue` +55/−68、`src/runStartupFocus.ts` +71/−38）⇒ 引用随代码挪了位，快照没跟着重算。
- 归属建议：门本身给的指示就是"**先确认引用指对了没有**（指错了→改回正确区间并让判词重新核过），**再来重算快照**"。⇒ 三个文件的**引用对不对**归各自 lane（commit / problems / run-startup）；`docs/inventory/citation-anchors.json` 的**重算**归 `ledgerfix`/主代理（`TAOCODE_CITATION_ANCHORS=update` 本 lane **没有跑**，跑它就是替别人销账）。
- **这份红名单本身在漂**：`docs/batch-2026-10-06-diffverdict.md` §3 早前报的是"**6 条**，命中 `src/actionsOnSave.ts`、`src/breakpointGroups.ts`、`src/browsers.ts`、`src/buildContentRoots.ts`"，与本 lane 16:54 实测的 4 条**文件集合零交集**（`tests/source-citation-anchors.test.mjs:280` 是同一条断言）。⇒ 结论：**任何"锚点红 N 条"的话都必须现跑现说**，跨 lane 引用这个数一定错（§3.4 对账表最后一行）。

### 6.3 会话期间新冒出来的共享红（1 条，同样不归桶9）

`已登记的 native 大文件不许继续变大` ⇒ `native/workspace.cpp 现在 1482 行 > 上限 1385`。
证据链见 §4.6：该文件 mtime 17:02:47、numstat 135/22，而 16:52 的 `git status` 里**没有它**。⇒ 请主代理按 mtime 认领那一路，处置是**拆新 `native/xxx.cpp`**（登记理由已经写了"helper 与新域应拆到 fsops/新文件"），**不许抬上限**。

### 6.4 账本侧的旧行号（已由 `diffverdict` 开单给 `ledgerfix`，本 lane 不重复开）

`docs/inventory/verdict-find-diff.md:42/:48/:285/:904/:930` 与 `verdict-settings-run.md:2459/:2485` 那批 `Enumerator.kt:16-25` / `Diff.kt:96-101` / `MyersLCS.kt:186-188` 类旧值，diffverdict §6 已列表并交 ledgerfix。**本 lane 一条没碰账本**，只补一句风险提示：改这些行必须与 `tests/b7-verdict.test.mjs:126-132` 的门内清单 + `src/diffAlign.ts` 的留痕块 + `tests/diff-align.test.mjs:151-166` 的 live 清单**同批**改（三份字符串集不同，单边改必红另一边），改完还要重算锚点快照。

## 7. 上游核对纪律与「无法核实」清单

参考树只用 `D:\Backup\Downloads\intellij-community-master\intellij-community-master`；**`third_party` 那份坏树本 lane 一次都没读**。所有坐标都先当候选，逐条 `sed -n` / `grep -n ""` 打开数过才写进本报告与产物；引用上游一律不写六位占位行号（§6.1 就是它造成的红）。

本 lane **亲自开树量过**的（不是转抄 lane 自述）：

| 坐标 | 实测原文 | 用途 |
| --- | --- | --- |
| `platform/util/resources/misc/registry.properties:1414` | `ide.find.word.based.preserve.case=true`（`:1415` = 描述 "New word-based preserve case implementation"） | 判 `src/preserveCase.ts` 那句"上游默认走逐词"**为真**，并判它改前的"默认关"**为错** |
| `platform/lang-impl/src/com/intellij/find/impl/FindManagerBase.java:288-296` | `:293-295` = `Registry.is("ide.find.word.based.preserve.case") ? PreserveCaseUtil.applyCase(foundString, replacement) : PreserveCaseUtil.replaceWithCaseRespect(replacement, foundString)`，整段在 `if (model.isPreserveCase())`（`:292`）里，且正则展开（`:290 getStringToReplaceByRegexp`）**在前** | 判 `editorFindController.ts:204-231` 的"先展开后套形态"顺序与上游一致 |
| `platform/indexing-api/src/com/intellij/find/FindModel.kt:411` | `var isPreserveCase: Boolean = false` | 用户档默认关（与上一条的"算法默认档"不矛盾），W-2 里 native 默认值取 `false` 的依据 |
| `platform/analysis-impl/resources/messages/FindBundle.properties:85` | `find.options.replace.preserve.case=Pr&eserve case` | W-2 的开关文案键 |
| `platform/analysis-impl/resources/messages/FindBundle.properties:108,109` | `find.replace.all.confirmation=<html><body>Replace {0} occurrences of ''{1}''<br>across {2} files with ''{3}''?` + `.long.text` 一档 | 判 `src/searchReplaceOutcome.ts:35-52` 注释里"四样信息一样不少（处数/被查串/文件数/替换成什么）"**为真** ⇒ 该文件判"完整"的依据之一 |
| `platform/lang-impl/src/com/intellij/execution/impl/ConsoleViewImpl.kt` | `wc -l` 1729 / 门口径 1730 | §6.1 那位数的复核 |

**无法核实清单**（写进产物与请求单时都标了原话）：

1. **所有中文措辞**：该树里 `find . -name "FindBundle_zh*.properties"` **0 命中**、`ls zh` **目录不存在** ⇒ 本仓 `Aa`/「保留大小写」/「将替换…处，涉及…个文件」这些中文说法**没有上游出处可核**，只能算本仓自定措辞（上游只有英文，见上表 `Pr&eserve case`）。
2. Ultimate 侧是否还有别的 `codeBlockSupportHandler` 注册项（本机是 community 树）⇒ W-3 的"只有 Python"只能核到 community 那一档。
3. `docs/inventory/verdict-find-diff.md` 里那批旧行号**当年对不对**：树里只有一版上游、没有历史版本可对照 ⇒ 只能核实"今天按图索骥会扑空"，不能核实"当初写错还是上游改了"（这条与 diffverdict §5-3 同一口径）。
4. 上游行位会随版本漂：本 lane 一切实测都以当前那份树为准（同 §6.4 的提醒）。

## 8. 本 lane 的边界声明

- 未改动：`src/**`、`tests/**`、`native/**`、`docs/inventory/**`、`scripts/verdict_table.py`、`src/settingsModel.ts`
- 未执行任何 `git checkout/reset/stash/clean/add/commit/push`
- 未执行 `TAOCODE_CITATION_ANCHORS=update`
