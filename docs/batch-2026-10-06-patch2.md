# 批次报告 2026-10-06 · patch2 域（补丁块头声明行数 / vc-diff 与 diff-merge 判词核对）

开工先读 `.tools/agent-rules.md`（全量读完）。**`AGENTS.md` 在本仓不存在**（`cat D:/TaoCode/AGENTS.md` ⇒
`No such file or directory`），本次派单里要求先读的那份没有可读，规约以 `.tools/agent-rules.md` 为准。

---

## 1. 判词表

| 族 | 项 | 判定 | 上游相对路径:行号（亲自打开） | 本仓落点 文件:行号 | 一句话 |
| --- | --- | --- | --- | --- | --- |
| patch/生成 | 块头必须声明真实两侧行数 | `[x]`（本批修） | `platform/vcs-impl/src/com/intellij/openapi/diff/impl/patch/UnifiedDiffWriter.java:220-225`（`writeHunkStart` 的 `@@ -%s,%s +%s,%s @@`）+ `platform/vcs-api/vcs-api-core/src/com/intellij/openapi/diff/impl/patch/PatchHunkUtil.kt:10-30`（`getRange`：REMOVE 只加 before、ADD 只加 after、CONTEXT 两侧都加） | `src/diffText.ts:127-145`（`generateUnifiedDiff`：行数由正文累加得出，纯增/纯删那侧按 git 惯例报 0 基插入点） | 原来写死 `@@ -1 +1 @@`（省略第二个数=1，见 `PatchReader.java:359`），正文却是整份文件 ⇒ 声明≠实际 |
| patch/解析 | 按 `@@ -a,b +c,d @@` 的 `b`/`d` 精确收块，多余的行丢掉、不吸下一块 | `[x]`（**早做过**，本批核实并留证） | `platform/vcs-impl/src/com/intellij/openapi/diff/impl/patch/PatchReader.java:335-392`（`readNextHunkUnified`；`:375` 的 `before < linesBefore \|\| after < linesAfter`、`:376-379` 的 `iterator.previous(); break`） | `src/patchApply.ts:88-97`（`parseHunkHeader`）、`:139-143`（`pushLine` 记账）、`:153-166`（凑满即停手、多余行进 `problems` 或被丢弃）+ 判据 `tests/patch-apply.test.mjs:240-265` | 读侧没有「把实际行数当声明行数」的毛病；`||` 条件与上游一致（上游也是两侧**任一**没凑满就继续吃），本批**没动**这个判定，否则会违背上游并打脸既有断言 |
| patch/生成（宿主侧） | `git.diffHunks` / `git.applyHunks` 的收块口径 | `[-]` 不改（**具体理由**） | —— 非上游口径问题 | `native/git.cpp:671-684`（`split_hunks` 贪心）、`:729`（`git apply --cached --recount`） | 输入只有 `git diff -- path` 的原文，且 `--recount` 让 git 按正文重算 ⇒ 声明数不参与判定，现状不会坏；`native/*.cpp` 不在本批可改面，理由与替代方案写在请求 F |
| vc/diff（族判词，`~`） | 「仍缺：三方合并编辑器…本仓**只有** `mergeConflicts.ts` 的逐条接受」 | `[~]` 保持，**理由过期** | `platform/diff-impl/src/com/intellij/diff/merge/ApplyNonConflictsAction.kt:12-36` | `src/mergeResolve.ts:45`/`:266`/`:318`/`:329`/`:408`/`:448`/`:450` + `src/mergeResolveHost.ts:38`/`:43`/`:54` + `src/changesMenuActions.ts:66-67` → `src/components/SourceControl.vue:226-227` | 三份内容（含 base）与两个入口都已落，缺的只是三栏窗口本体 |
| vc/diff（族判词） | 「仍缺：GNU patch 的 fuzz/**偏移搜索**」 | `[~]` 保持，**理由过期** | `apply/GenericPatchApplier.java:41`（`ourMaxWalk = 1000`）、`:74`（两级 `apply`）、真没做的：`:209-223` 的 fuzz 循环 + `:312-320` 的 `complementInsertAndDelete` + `:363-393` 的 `trySolveSomehow` | `src/patchFuzzy.ts:24`/`:57`/`:89` + 两级合流 `src/patchApply.ts:305-311` | 偏移搜索已做；只缺「吃掉上下文行」那档（会改写文本，本仓不引入） |
| diff-merge（逐类，`§G` 手写表） | `ApplyNonConflictsAction` 判 `[~]` | 建议升 **`[x]`** | `ApplyNonConflictsAction.kt:18`（三档 id）、`:31`（可用性谓词）、`:35`（`applyNonConflictedChanges`） | 同上（`src/mergeResolve.ts:408` 的 `onlyNonConflicts` 档 = 上游 `Diff.ApplyNonConflicts` 口径，入口两处） | 残余差异只有「整文件一档 vs 上游逐侧一档」，写在请求 B |
| diff-merge（逐类） | `MergeThreesideViewerActions` 的「`ApplyNonConflicts`、`ScrollToNextChange` 那些仍无」 | `[~]` 保持，**清单要更正** | `platform/diff-impl/src/com/intellij/diff/merge/MergeThreesideViewerActions.kt:21-84`（`ApplySelectedChangesActionBase` 按选区挑改动，`:70-84`） | 导航：`src/mergeConflicts.ts:122` + `src/components/MergeBar.vue:30-31`；`ApplyNonConflicts` 见上；**按选区接受确实没有**（`src/mergeConflicts.ts:102` 只吃整条冲突块） | 两样点名的都已落，真正缺的那条文档没写 |
| diff-merge（逐类） | `MergeThreesideViewer`「没有 base 栏可看」 | `[~]` 保持 | `MergeThreesideViewer.java:333-336`（文档既有引用） | `src/mergeResolve.ts:45`（`'base'`）、`:266`、`:318`（`rangeTexts` 返回三段） | 数据面有 base，缺的是画它的那栏 |
| 判词锚点 | `docs/inventory/verdict-vcs.md` 指向 `native/git.cpp` 的 8 处行号 | **失效**（`native/git.cpp` 现 791 行，`:826`/`:909` 越界） | —— | 实际：`split_hunks` `native/git.cpp:671`、`diff_hunks` `:689`、`apply_hunks` `:708`、`--recount` `:729`、`stage/unstage` `:420`/`:424`、`patch` `:355`、`merge` `:584`、`revert` `:764`、`DiffHunk` 结构 `:667`（文档写的 `native/git.hpp` 里没有）、`split_fields` 已搬 `native/git_log.cpp:377` 且不解析 `@@` | 逐条对照表在请求 E |

**正面样板（同域已正确实现的先例，本批照它的口径改 TS 侧）**：`native/history_diff.cpp:116-121` ——
`render_hunks` 先按实际行累加 `a_count`/`b_count`，再 `snprintf("@@ -%zu,%zu +%zu,%zu @@\n", a_start, a_count, …)`，
纯增/纯删那侧起始号退成 0 基。判据 `native/history_test.cpp:281-284` 钉死了这三行形状。

---

## 2. 改动文件清单（`wc -l` 前后）

| 文件 | 前 | 后 | 改了什么 |
| --- | --- | --- | --- |
| `src/diffText.ts` | 117 | 146 | `generateUnifiedDiff` 的块头从写死 `@@ -1 +1 @@` 改成按正文实际行数声明（`+29` 行里绝大部分是上游依据注释，函数体本身 12→20 行；正文一行没动，既有 `slice(3)` 形状保持） |
| `src/patchApply.ts` | 458 | 462 | 只改文件头两处注释：① 「与导出侧成对」补上真正的 TS 生成侧 `src/diffText.ts` 与新判据；② 「吃上下文那一档」的上游行号写准（`:209-223` 是 fuzz 循环、`:212` 才是调用点、函数体 `:312-320`）。**解析/应用逻辑零改动** |
| `tests/patch-hunk-counts.test.mjs` | —— | 196（新增） | 本批判据：8 条，含失败用例与真 `git apply --check` |
| `docs/wiring-requests-2026-10-06-patch2.md` | —— | 新增 | 请求 A–F（`vc/diff` 族判词三处、`verdict-find-diff.md` 三处升档/更正、`verdict-vcs.md` 锚点失效清单、native `--recount` 不改的理由） |

`git diff -U1 -- src/patchApply.ts` 自查：本批只有那两个注释 hunk（`git diff --stat` 显示该文件共 98 行变更，
其余是同域另一路代理 09:26 的在途改动，不是我顺手重排的）。

**没动**：`src/App.vue`、`src/bridge*`、`src/style.css`、`src/tokens.css`、`CMakeLists.txt`、`scripts/verdict_table.py`、
`docs/inventory/*.md`、`tests/module-size.test.mjs`、`native/*`。没有 commit / push / checkout / reset / stash / clean。

---

## 3. §5 每条自查命令的前后数字

| 门禁 | 改前基线 | 改后 | 归属 |
| --- | --- | --- | --- |
| `node --test tests/patch-hunk-counts.test.mjs` | 文件不存在（0 条） | **8 tests / 8 pass / 0 fail** | 本批新增 |
| 本域 8 个测试文件合跑（`patch-hunk-counts` + `patch-apply` + `patch-fuzzy` + `patch-export` + `diff-align` + `diff-unified` + `merge-resolve` + `merge-conflicts`） | —— | **129 pass / 0 fail**（其中既有 120 条断言一条没放松：`deepEqual`/`match` 全部原样） | 本域 |
| `npx vue-tsc -b --force` | 我第一次跑（本批改动落地后）：**0 错** | 收工前最后一次跑：**5 处错，分布在我没碰的 5 个文件**（`src/components/PluginDialog.vue:132`、`src/editorSemanticField.ts:148`、`src/refactorPreview.ts:207`、`src/runActions.ts:205-206`、`src/semanticHighlighting.ts:161`/`:210`）；`grep diffText\|patchApply` 在错误列表里 **0 命中** | 别的 lane 在途，不算本批 |
| `node --test tests/module-size.test.mjs` | 5 / 5 绿 | **5 / 5 绿**（上限没动；`src/diffText.ts` 146、`src/patchApply.ts` 462，都远在 900 以下） | 本批 |
| `node .tools/find-param-props.mjs` | 0 处 | **1 处**：`src/semanticHighlighting.ts:210` 的 `constructor(readonly featureId =)` —— 不是我的文件，且它本身就是截断的语法错 | 别的 lane |
| `node .tools/find-ts-in-mjs.mjs` | 干净 | **干净**（新 `.mjs` 里无任何 TS 语法） | 本批 |
| `node .tools/find-missing-ext.mjs` | 干净 | 扫描 1288 文件、**干净**（新测试的 `.ts` 值 import 全带扩展名） | 本批 |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | 改前红：7 条越界引用，全在别人的 `docs/batch-*` / `docs/wiring-requests-2026-10-06-vcs2.md` | 改后仍红（别人的在途文档涨到含 `status2defect.md` 的多条），**锚点快照那条绿**；本批文件（`src/diffText.ts`、`src/patchApply.ts` 注释、`tests/patch-hunk-counts.test.mjs`、我的两个 docs）**一条都没进 offender 列表** ⇒ 我写的上游 `路径:行号` 全部指得到 | 别的 lane（我没造新假引用） |
| `node .tools/find-orphan-modules.mjs --gate` | 基线 9 / 已登记 9 | 门禁红 1 条：别人在途的 `src/pluginSearchSuggest.ts`（两次跑之间 offender 换了人，都是同一类在途文件）。**本批没新增任何 `src/` 模块**，只加了一个 test 文件 | 别的 lane |
| ctest（`npm run test:native`） | —— | **没跑**：本批一个字节都没改 `native/`（见 §6） | —— |

---

## 4. 反向验证记录（新判据的三步数字）

1. **注入违规**：把 `src/diffText.ts` 的返回语句临时改回旧写法 `['--- 当前文件', '+++ 剪贴板', '@@ -1 +1 @@', ...body]`（行数为旧值）。
2. **确认变红**：`node --test tests/patch-hunk-counts.test.mjs` ⇒ **8 tests / 3 pass / 5 fail**。红的 5 条正是：
   ① 生成侧「声明=实际」；② 纯增/纯删 0 基插入点；③ 读侧往返；④ 故意把声明改小的失败用例；
   ⑤ **真 `git apply --check` 应为绿**（旧写法下 git 直接拒，红得最硬）。
   仍绿的 3 条是刻意的反向对照：两条「多余行不许进块 / 不吸下一块」的解析器断言（与生成侧无关）+
   一条「块头改回旧写法 ⇒ git 必须拒」（它不依赖生成侧，是判据的判据）。
3. **撤掉后复绿**：恢复 `const header = \`@@ -${beforeCount === 0 ? 0 : 1},${beforeCount} +…\``，
   同文件 **8 / 8 绿**；本域 8 个文件合跑 **129 / 129 绿**。

另外，判据里的真 git 实测本身自带反向对照：`tests/patch-hunk-counts.test.mjs` 最后一条把**同一份**补丁的块头
手动改回 `@@ -1 +1 @@`，断言 `git apply --check` 必须失败（git 2.55.0，`corrupt patch`）。
临时仓库建在 `build/patch-hunk-counts-*`（已 gitignore），`t.after` 里 `rmSync` 删干净 —— 收工时 `ls build | grep patch-hunk` 为空。

---

## 5. 零消费方自查结论

本批**没有新增 `src/` 模块**：改动落在已有的 `src/diffText.ts`（生产消费方 3 处：`src/editorFileOps.ts:14`、
`src/vcsActions.ts:12`、`src/components/DebugClipboardCompare.vue:12`）与
`src/patchApply.ts`（`src/patchApplyHost.ts` 消费，注释改动不影响）；新增的只有一个测试文件。
`find-orphan-modules --gate` 那条红是别人的 `src/pluginSearchSuggest.ts`（两次跑 offender 换人，均为在途文件），与本批无关。

**顺手核到的一条现状（不改，理由：不在本批可改面）**：`generateUnifiedDiff` 的产物被塞进 `DiffView` 的
`unified` prop（`src/App.vue:2340`、`:2361`），但 `src/components/DiffView.vue:33` 声明了 `unified: string`
之后**全文没有一处 `props.unified`** —— 那份补丁文本目前没有可见消费者，统一档画的是 `buildUnifiedRows(rows)`。
所以「块头写错」在真机上看不出来，但它一旦被接上（比如「复制补丁」）就是坏补丁；本批把账目修正确并留了判据。

---

## 6. 做不到 / 无法核实

- **`AGENTS.md` 不存在**：派单要求先读，实际 `cat` 报 No such file or directory；已按 `.tools/agent-rules.md` 执行。
- **本批没跑 ctest**：`native/` 一个字节都没改（`split_hunks`/`--recount` 那条我只写成说明 F 的分析与理由，
  要真按声明行数收块得动 `native/git.cpp` 并由 native lane 跑 `vcvars64 + npm run test:native`）。
- **无法核实 `docs/inventory/verdict-vcs.md:163` 说的 `native/history_diff.cpp:42` 是不是 `build_script`**：
  本批只逐行确认了同文件 `:95` 的 `render_hunks` 与 `:116-121` 的块头算法（所以拿它当正面样板），
  `:42` 那个行号没打开核对 ⇒ 在请求 E 里写的是「请按现状再核」，没有断言它错。
- **上游 `MergeThreesideViewer` 的逐侧（`ThreeSide`）可用性谓词做不到**：本仓合并输入是文件里的冲突标记，
  没有三份内容的实时模型，`resolveConflictsInText` 只能整文件一档；这条差异如实写在请求 B 的「残余差异」。
- **`git apply` 的 8 条真机实测只在 Windows（git 2.55.0.windows.5）跑过**；测试里对没有 git 的机器走 `t.skip`，
  没有放松任何断言（skip 只影响那 3 条真机用例）。

---

## 7. 需要主代理接的线

全部在 `docs/wiring-requests-2026-10-06-patch2.md`：
- **A**：`scripts/verdict_table.py:408` 族 `vc/diff` 三处过期口径（两条「仍缺」其实已落 + 一条本批新增的生成侧），给可照抄的子串替换。
- **B**：`docs/inventory/verdict-find-diff.md:507` `ApplyNonConflictsAction` `[~]` → `[x]`，并同步 `:72`、`:303`、`:941` 的四档计数与 `tests/b7-verdict.test.mjs:102`/`:108` 的 `[31,352,0,247]` → `[32,351,0,247]`（§G 是手写表，脚本护栏禁止覆盖 ⇒ 只改文档，不改 py）。
- **C**：同文件 `:525` `MergeThreesideViewerActions` 的「仍无」清单更正（保持 `[~]`，不动计数）。
- **D**：同文件 `:155-159` §B5 叙述的「没有 base 栏 / 没有 ApplyNonConflicts」更正。
- **E**：`docs/inventory/verdict-vcs.md` 里 8 处指向 `native/git.cpp` 的失效锚点（逐条「文档写的 → 实际行号」）。
- **F**：`native/git.cpp:671` 贪心收块 + `:729` `--recount` 的现状说明与建议保持（若要让宿主也按声明行数收，是 native lane 的活）。
