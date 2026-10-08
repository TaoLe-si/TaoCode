# 接线请求 2026-10-06（patch2 域：补丁块头计数 / vc-diff 与 diff-merge 判词）

本文件由 `docs/batch-2026-10-06-patch2.md` 那一批产出。规则要求的**保留文件**（`src/App.vue`、
`src/bridge.ts`、`src/style.css`、`src/tokens.css`、`CMakeLists.txt`、`scripts/verdict_table.py`、
`docs/inventory/*.md`）一律没动，要改的都写在这里，给可照抄的替换文本 + 亲自打开过的证据行号。

上游真源树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（下列上游行号都逐行打开核对过）。

---

## 请求 A —— `scripts/verdict_table.py:408`（族 `vc/diff`，档位 `~`）：三处过期口径

**为什么归到这里**：族级判词的唯一真源就是 `scripts/verdict_table.py` 的 `FAMILIES` 表（脚本头 §产出说明），
`docs/inventory/vcs_verdict_table.md` / `.json` 是它的生成物（跑 `python scripts/verdict_table.py vcs` 重生成）。

**原文（逐字，取自 `scripts/verdict_table.py:408` 的那一段）**：

```
**仍缺**：三方合并编辑器（`MergeViewer` 的三栏与 `MergeResult` 模型；本仓只有 `src/mergeConflicts.ts` 的标记文本逐条接受）、
修订标题/元信息（…）、二进制补丁（…）、mail 头与 charset（…）、
GNU patch 的 fuzz/偏移搜索（`GenericPatchApplier`）、多文件合成差异（`CombinedDiffViewer`）与逐文件导航、
apply 的撤销对话框（`UndoApplyPatchDialog`）。
```

**核对结果（本批逐条打开过）**：

| 原写的「仍缺」 | 实际现状 | 证据 |
| --- | --- | --- |
| 「本仓**只有** `src/mergeConflicts.ts` 的标记文本逐条接受」 | 三方合并的**算**与两个真实入口已落：`src/mergeResolve.ts:45`（`MergeSide = 'left' \| 'base' \| 'right'`）、`:266`（`buildMergeRanges(left, base, right)`）、`:318`（`rangeTexts` 取三段文本）、`:329`（`tryResolveConflict`）、`:387`（`canAutoResolve`）、`:408`（`resolveConflictsInText(content, onlyNonConflicts)`，两档分别对上上游 `Diff.MagicResolveConflicts` / `Diff.ApplyNonConflicts`）、`:448`/`:450`（两条中文文案）；宿主 `src/mergeResolveHost.ts:38`（`resolveSimpleConflicts`）/ `:43`（`applyNonConflictingChanges`）/ `:54`（`acceptConflictSide`）；入口行菜单 `src/changesMenuActions.ts:66-67` → 分发 `src/components/SourceControl.vue:226-227`。判据 `tests/merge-resolve.test.mjs`、`tests/merge-conflicts.test.mjs` | 上述行号 |
| 「GNU patch 的 fuzz/**偏移搜索**（`GenericPatchApplier`）」 | 偏移搜索**已落**：`src/patchFuzzy.ts:24`（`MAX_WALK = 1000`，即上游 `apply/GenericPatchApplier.java:41` 的 `ourMaxWalk = 1000`）、`:57`（`findHunkPlacement` 先近后远）、`:89`（`applyHunksWithOffsetSearch`）；两级合流在 `src/patchApply.ts:305-311`（先逐块核对、失败再偏移）。真没做的只有**吃掉上下文行**那一档：上游 fuzz 循环 `apply/GenericPatchApplier.java:209-223`（`:212` 调 `complementInsertAndDelete`，函数体 `:312-320`）与 `:363-393` 的 `trySolveSomehow`，它会改写匹配处文本 | 上述行号（上游两处均已亲自打开） |
| （无「生成侧」这一条） | 本批补的是**生成侧**账目：`src/diffText.ts:127-145` 的 `generateUnifiedDiff` 原来把块头写死成 `@@ -1 +1 @@`（= 向读侧声明两侧各 1 行），正文却是整份文件 ⇒ 声明 ≠ 实际。现按正文实际行数声明（`-起始,行数 +起始,行数`），口径照上游 `UnifiedDiffWriter.writeHunkStart`（`platform/vcs-impl/src/com/intellij/openapi/diff/impl/patch/UnifiedDiffWriter.java:220-225`）与 `PatchHunkUtil.getRange`（`platform/vcs-api/vcs-api-core/src/com/intellij/openapi/diff/impl/patch/PatchHunkUtil.kt:10-30`）。判据 `tests/patch-hunk-counts.test.mjs`（8 条，含真 `git apply --check` 绿 / 旧写法红） | `src/diffText.ts:127-145` |

**请照抄替换（`scripts/verdict_table.py:408` 里，把下面三条原文子串换成对应新文）**：

1. 原文子串：`三方合并编辑器（\`MergeViewer\` 的三栏与 \`MergeResult\` 模型；本仓只有 \`src/mergeConflicts.ts\` 的标记文本逐条接受）`
   ➜ 新文：`三方合并**窗口**（\`MergeViewer\` 的三栏 UI；本仓落了它的算与两个入口 —— \`src/mergeResolve.ts\`（\`:45` 三档 side / \`:266` buildMergeRanges 吃 base / \`:329` tryResolveConflict / \`:408` resolveConflictsInText 两档 / \`:448`+\`:450` 文案）+ \`src/mergeResolveHost.ts:38`/`:43`/`:54` + 行菜单 \`src/changesMenuActions.ts:66-67\` → \`src/components/SourceControl.vue:226-227\`，判据 \`tests/merge-resolve.test.mjs\`；缺的是三栏那个窗口本身，本仓没有合并视图组件）`

2. 原文子串：`GNU patch 的 fuzz/偏移搜索（\`GenericPatchApplier\`）`
   ➜ 新文：`GNU patch 的「吃掉上下文行」那一档 fuzz（\`apply/GenericPatchApplier.java:209-223\` 的 fuzz 循环与 \`:312-320\` 的 \`complementInsertAndDelete\`、\`:363-393\` 的 \`trySolveSomehow\`；**偏移搜索已落** —— \`src/patchFuzzy.ts\`，\`ourMaxWalk\` 同款 1000，两级合流 \`src/patchApply.ts:305-311\`）`

3. 原文子串（追加在「本轮把 **patch/ 一族的文本子集**也落了」那句的末尾、也就是 `**仍缺**` 之前）：
   ➜ 新增文本：`本批再补**生成侧**的块头账目：\`src/diffText.ts\` 的 \`generateUnifiedDiff\` 按正文实际行数写 \`@@ -a,b +c,d @@\`（原写死 \`@@ -1 +1 @@\` ⇒ 声明与正文不符，\`git apply\` 直接拒），口径照上游 \`UnifiedDiffWriter.java:220-225\` + \`PatchHunkUtil.kt:10-30\`；判据 \`tests/patch-hunk-counts.test.mjs\`（含真 \`git apply --check\` 绿 + 旧写法红）。`

> 档位建议：`vc/diff` 保持 `~`（三栏窗口、二进制补丁、mail 头/charset、合成差异、撤销对话框确实还没有）。
> 改完请跑 `python scripts/verdict_table.py vcs --check` 复算生成物。

---

## 请求 B —— `docs/inventory/verdict-find-diff.md:507`：`ApplyNonConflictsAction` 判 `[~]` 的理由已过期，建议升 `[x]`

**条目原文（该文件第 507 行，逐字）**：

```
| `ApplyNonConflictsAction` | `platform/diff-impl/src/com/intellij/diff/merge/ApplyNonConflictsAction.kt` | `[~]` | 上游是三方合并与冲突解决（MergeRequestProcessor 一族）；本仓有对应物（`src/mergeConflicts.ts:52`，mergeConflicts.ts 的冲突标记模型 + editorMergeHost.ts 的接受/导航 + MergeBar.vue），缺「自动接受全部不冲突改动」（逐条接受已落，见 `src/mergeConflicts.ts` 的 acceptSide）。 |
```

**新档**：`[x]`。

**证据（上游语义 vs 本仓落点，都亲自打开）**：
- 上游 `platform/diff-impl/src/com/intellij/diff/merge/ApplyNonConflictsAction.kt:12-36`：`update` 用 `viewer.model.hasNonConflictedChanges(side)` 决定可用性（`:31`），`actionPerformed` 调 `viewer.applyNonConflictedChanges(side)`（`:35`），动作 id 三档 `Diff.ApplyNonConflicts.Left/./Right`（`:18`）。
- 本仓同一条用户可见行为：`src/mergeResolve.ts:408` 的 `resolveConflictsInText(content, onlyNonConflicts = true)` —— 文件头注释 `:404-406` 明确「`onlyNonConflicts = true`（`Diff.ApplyNonConflicts` 的口径）：**只**合 `type !== 'conflict'` 的」，即「一侧没动、另一侧改了」那批；文案 `src/mergeResolve.ts:450`（`APPLY_NON_CONFLICTS_TEXT = '应用所有不冲突的更改'`）；可用性谓词 = `available: c => Boolean(c.conflicted)`（`src/changesMenuActions.ts:67`，与上游「有可合的才给点」等价落点）；执行 `src/mergeResolveHost.ts:43` → `src/components/SourceControl.vue:227`。判据 `tests/merge-resolve.test.mjs`。
- **残余差异（如主代理认为这一条就足以保持 `[~]`，请按这条改文案而不是整条驳回）**：上游的粒度是**逐侧**（`ThreeSide` 左/基/右三档 id），本仓是**整文件**一档（没有三栏窗口，也就没有「在哪一侧按按钮」）。

**要同步改的行**（这张 §G 表是**手写**的，`scripts/verdict_table.py:933-955` 的护栏禁止脚本覆盖它 ⇒ 改文档本身，不改 py）：
- `docs/inventory/verdict-find-diff.md:507`：`[~]` → `[x]`，并把理由句尾的「缺『自动接受全部不冲突改动』」换成本仓落点与残余差异（上面那句）。
- `docs/inventory/verdict-find-diff.md:72`：四档计数 `[x] 31 / [~] 352 / [ ] 0 / [-] 247` → `[x] 32 / [~] 351`。
- `docs/inventory/verdict-find-diff.md:303`（「计数冻结」那条门禁描述里同一组四个数）同步。
- `docs/inventory/verdict-find-diff.md:941`：`合计 630 类：[x] 31、[~] 352、[ ] 0、[-] 247。` → `[x] 32、[~] 351`。
- `tests/b7-verdict.test.mjs:102`（注释）与 `:108` 的 `[31, 352, 0, 247]` → `[32, 351, 0, 247]`。

---

## 请求 C —— `docs/inventory/verdict-find-diff.md:525`：`MergeThreesideViewerActions` 的「仍无」清单要更正（建议保持 `[~]`）

**条目原文**：

```
| `MergeThreesideViewerActions` | `platform/diff-impl/src/com/intellij/diff/merge/MergeThreesideViewerActions.kt` | `[~]` | 这一族动作里只落了两个：接受左侧/接受右侧（`src/editorMergeHost.ts` 的 `createMergeState` 与 `src/components/MergeBar.vue` 上那两个按钮），外加冲突导航。`ApplyNonConflicts`、`ScrollToNextChange` 那些仍无（见 §B5）。 |
```

**核对**：清单里点名的两样**都已落** ——
- `ApplyNonConflicts`：见请求 B 的落点（`src/mergeResolve.ts:408` + `src/mergeResolveHost.ts:43` + `src/changesMenuActions.ts:67` + `src/components/SourceControl.vue:227`）。
- `ScrollToNextChange`（冲突导航）：`src/mergeConflicts.ts:122`（`nextConflict(conflicts, from, backwards)`）+ `src/editorMergeHost.ts:49`（`createMergeState`）+ `src/components/MergeBar.vue:30-31`（「上一个冲突 / 下一个冲突」两个按钮，带 `title` + `aria-label`）。

**真正还没落的**（打开上游文件核对到的族成员）：`MergeThreesideViewerActions.kt:21-84` 的
`ApplySelectedChangesActionBase` —— 按**选区**挑出被选中的改动再接受某一侧（`getSelectedChanges` 用 `DiffUtil.getSelectedLines` + `TextMergeChange.getStartLine(side)`，`:70-84`），
本仓没有「按选区接受」这条链（`acceptSide` 只吃整条冲突块，`src/mergeConflicts.ts:102`）。

**新档**：`[~]`（不变），**理由句**换成：
`这一族落了：接受左侧/接受右侧（\`src/editorMergeHost.ts:49\` + \`src/components/MergeBar.vue:33-34\`）、冲突导航（\`src/mergeConflicts.ts:122\` + \`MergeBar.vue:30-31\`）、\`ApplyNonConflicts\`（\`src/mergeResolve.ts:408\` 的 onlyNonConflicts 档 + \`src/changesMenuActions.ts:67\` 入口）。仍缺 \`ApplySelectedChangesActionBase\`（\`MergeThreesideViewerActions.kt:21-84\`）那条「按选区挑改动再接受一侧」。`

> 本条**不改四档计数**（档位没动），所以 `tests/b7-verdict.test.mjs` 不受影响。

---

## 请求 D —— `docs/inventory/verdict-find-diff.md:155-159`（§B5 叙述）同样过期

**原文（`docs/inventory/verdict-find-diff.md:155-159`，逐字摘录）**：

```
**与上游的差别（关键面）**：没有三栏视图、没有 base 栏可看、**没有逐片段（Fragment）级的接受**、
没有 `ApplyNonConflicts`（自动接受所有不冲突的改动）、没有 "Resolve/Cancel" 那套对话框语义，
也没有把结果写回索引三阶段的能力（本仓的结果就是编辑器缓冲区，保存即落盘）。

`MergeThreesideViewer` / `MergeThreesideViewerActions` 因此判 `[~]`：两个按钮与冲突导航有真实落点，
```

**要改的两处**：
1. `没有 base 栏可看` —— 半过期：base 那一侧的数据与三段文本取值都有（`src/mergeResolve.ts:45` 的 `'base'` 档、`:266` 的 `buildMergeRanges(left, base, right)`、`:318` 的 `rangeTexts` 返回 `{left, base, right}`），缺的是**画 base 栏的窗口**。建议改成「没有三栏视图，也就看不到 base 栏（三份文本的取值面在 `src/mergeResolve.ts:266`/`:318`）」。
2. `没有 \`ApplyNonConflicts\`（自动接受所有不冲突的改动）` —— **已落**，见请求 B；建议整句删掉或改写成「`ApplyNonConflicts` 是整文件一档，不是上游的逐侧一档」。
3. 第三行 `没有 "Resolve/Cancel" 那套对话框语义` 保持（`resolveConflictsInText` 落盘后不弹对比确认，`src/mergeResolveHost.ts:38`/`:43` 只 notify）。

> 同样只改判决文档本身（§G/§B 是手写表，`scripts/verdict_table.py` 的护栏不覆盖它）。

---

## 请求 E —— `docs/inventory/verdict-vcs.md` 里指向 `native/git.cpp` 的锚点已随搬运失效（`native/git.cpp` 现在只有 791 行）

逐条核对（左边是文档写的，右边是亲自打开 `native/git.cpp` / `native/git_log.cpp` 看到的）：

| 文档行 | 文档写的锚点 | 实际 |
| --- | --- | --- |
| `docs/inventory/verdict-vcs.md:149` | 「hunk 行模型在 `native/git.hpp` 的 `DiffHunk`（`:733` 产出）」 | `DiffHunk` 结构在 **`native/git.cpp:667`**（匿名命名空间；`native/git.hpp` 里没有这个类型），产出方 `diff_hunks` 在 **`native/git.cpp:689`** |
| `docs/inventory/verdict-vcs.md:549` | 「hunk 结构在 `native/git.cpp:826`（`split_fields` 解析 @@ 头）」 | `native/git.cpp` 全文 791 行 ⇒ `:826` 不存在；`split_fields` 已在 **`native/git_log.cpp:377`**，且它解析的是 `git log` 的记录字段，**不解析 `@@`**；解析/切 `@@` 块的是 **`native/git.cpp:671`**（`split_hunks`）与 **`native/history.cpp:868`**（读 `@@ -a,c +b,d @@`） |
| `docs/inventory/verdict-vcs.md:207`、`:764` | `native/git.cpp:751`（`diff_hunks`）/ `:770`（`apply_hunks`）/ `:909`（revert） | `diff_hunks` **`:689`**、`apply_hunks` **`:708`**、`revert` **`:764`** |
| `docs/inventory/verdict-vcs.md:741`、`:753`、`:786` | `native/git.cpp:345`（`patch`） | `patch` 在 **`native/git.cpp:355`** |
| `docs/inventory/verdict-vcs.md:207`、`:548` | `native/git.cpp:410`/`:414`（逐文件 stage/unstage） | **`:420`**（`stage`）/ **`:424`**（`unstage`） |
| `docs/inventory/verdict-vcs.md:398` | `native/git.cpp:590`（`merge`） | **`:584`** |
| `docs/inventory/verdict-vcs.md:553` | 落点见 `native/git.cpp:288` | `:288` 是 `request_cancel()` 后面的一句英文注释，与合并动作无关 |
| `docs/inventory/verdict-vcs.md:163`、`:168` | `native/history_diff.cpp:42`（`build_script`）+ `:95`（`render_hunks`） | `render_hunks` 确在 **`native/history_diff.cpp:95`**，它的块头在 **`:116-121`** 按实际行数算（本批 `src/diffText.ts` 的修法与之同口径，可当正面样板）；`build_script` 的行号请按该文件现状再核（本批没读到 `:42`） |

**要改的行**：就是上表左列那些文档行本身（`docs/inventory/*.md` 保留，主代理改）；`scripts/verdict_table.py` 里**没有**这些 `native/...` 锚点（族判词只写类名与本仓 `src/` 文件名），所以本请求不涉及 py。

---

## 说明 F —— `native/git.cpp` 的 `split_hunks` 不按声明行数收块（**建议保持现状**，写清理由）

`native/git.cpp:671-684` 的 `split_hunks` 是**贪心**切块：`@@` 之后的每一行都归上一块，不看 `@@` 里声明的 `b`/`d`。
它今天不会坏，因为：
1. 输入只有 `git diff -- path`（`native/git.cpp:333` 的 `diff`，单路径），块与块之间不会插别的文件头；
2. `apply_hunks`（`:708`）把选中的块原样拼回补丁，并让 git 用 **`--recount`**（`:729`）按正文重算行数 ⇒ 声明数根本不参与判定。

若主代理想让宿主与前端同口径（按 `@@` 声明行数收块，多余的丢掉，像 `src/patchApply.ts:153-166`），
那是 native lane 的活（`native/git.cpp` 不在本批可改面，且新建/改动 `native/*.cpp` 需要别人跑 ctest），本批**没动**。

## 做不到 / 无法核实

- `docs/inventory/verdict-vcs.md:163` 说的 `native/history_diff.cpp:42` 的 `build_script`：本批只核到同文件 `:95` 的 `render_hunks`，没有逐行确认 `:42` 是不是那个函数（写「请按现状再核」而不是断言它错）。
- 上游 `MergeThreesideViewer.model.hasNonConflictedChanges(side)` 的逐侧语义，本仓没有三份内容的实时模型（输入是文件里的冲突标记），无法逐侧复刻；只做了整文件一档。

## 处理结果（wiring-backlog lane，2026-10-06）

- 请求 A–E —— 判词与锚点订正（`scripts/verdict_table.py` / `docs/inventory/*`），非本 lane。说明 F —— 保持现状。

结论：零接线。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「零接线。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
