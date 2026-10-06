# 接线请求（2026-10-06 · b89：verdict / 折叠域收口）

本文件只交接**不在 b89 可改面**的那一处文档改动。b89 的可改面是
`tests/b8-verdict.test.mjs`、`tests/b9-verdict.test.mjs`、`docs/inventory/verdict-editor.md`、
`docs/inventory/verdict-folding.md`、`scripts/verdict_table.py`；`docs/inventory/verdict-settings-run.md`
与 `docs/inventory/verdict-find-diff.md` 是 settings-run / find-diff 两条 lane 的现场，**没动一个字节**。

## W-1 把 `ApplyNonConflictsAction` 的 B9 镜像行与 B7 对齐（改完必须删 b9 的登记条目）

**现象**：`tests/b9-verdict.test.mjs` 的「与 B7 的 630 条重叠类逐条交叉核对」红在一条上 ——
同一份 §G 镜像行和 B7 的 §G 给了不同档位：`docs/inventory/verdict-find-diff.md:508` 判 `[x]`，
`docs/inventory/verdict-settings-run.md:658` 判 `[~]`，而且 `[~]` 那一行的缺口句已经**不成立**。

**b89 自己开两侧核对过的结论**：B7 的 `[x]` 是对的，B9 的镜像行是**漏同步的旧档**（不是 B7 升错了）。

- 上游（基准树 `D:\Backup\Downloads\intellij-community-master\intellij-community-master`，全文件 37 行）：
  `platform/diff-impl/src/com/intellij/diff/merge/ApplyNonConflictsAction.kt:31`
  = `e.presentation.setEnabled(viewer.model.hasNonConflictedChanges(side) && …)`（可用性谓词）、
  `:35` = `viewer.applyNonConflictedChanges(side)`（执行）。用户可见行为就这两件事。
- 本仓同一条链（逐个 `文件:行号` 打开核过，行号就是那一行）：
  `src/mergeResolve.ts:408` `resolveConflictsInText(content, onlyNonConflicts = false, …)`；
  `src/mergeResolve.ts:427` `const take = onlyNonConflicts ? type.type !== 'conflict' : type.canBeResolved`
  （= 只合「一侧没动」的那批，正是 `:31` 的谓词口径）；
  `src/mergeResolve.ts:450` `APPLY_NON_CONFLICTS_TEXT`（文案「应用所有不冲突的更改」）；
  `src/changesMenuActions.ts:67` 更改右键表里的 `applyNonConflicts` 行；
  `src/mergeResolveHost.ts:43` `applyNonConflictingChanges` → `src/components/SourceControl.vue:227` 的 `case 'applyNonConflicts'`（执行落盘）。
  判据：`tests/merge-resolve.test.mjs:215`（文案）、`:224`（host 走 `applyResolution(path, true, deps)`）、`:394-395`（`resolveConflictsInText(text, true)` 的行为断言）。
- 所以 B9 那一行写的「缺：『自动接受全部不冲突改动』」是**旧账**（该缺口由 2026-10-06 fold3 lane 落的，
  见 `docs/inventory/verdict-find-diff.md:73` 与 `docs/batch-2026-10-06-merge3.md`）。

**请 settings-run lane 做这四步（逐字可照抄）**：

1. `docs/inventory/verdict-settings-run.md:658` —— 把档位从 `[~]` 改成 `[x]`，并把缺口句换成残余差异（整行替换）：

   ```
   | `ApplyNonConflictsAction` | `platform/diff-impl/src/com/intellij/diff/merge/ApplyNonConflictsAction.kt` | `[x]` | 继承 B7 判决（find/diff §G 同一行，2026-10-06 同步：B7 已按行为 `[~]` → `[x]`，本行原写「缺：『自动接受全部不冲突改动』」是漏同步的旧档 —— 整条链在 `src/mergeResolve.ts:408`（`onlyNonConflicts` 档，选择口径 `:427`）+ 文案 `src/mergeResolve.ts:450` + 可用性谓词 `src/changesMenuActions.ts:67` + 执行 `src/mergeResolveHost.ts:43` → `src/components/SourceControl.vue:227`，判据 `tests/merge-resolve.test.mjs`；上游 `ApplyNonConflictsAction.kt:31` 的 `hasNonConflictedChanges(side)` 与 `:35` 的 `applyNonConflictedChanges(side)` 逐行开过）。**残余差异（与 B7 同口径，如实记）**：上游粒度逐侧（`:18` 的 `Diff.ApplyNonConflicts.Left` / 中间档 / `.Right`），本仓是整文件一档（没有三栏合并窗口，也就没有「在哪一侧按这个按钮」）；三栏窗口本身记在 `MergeThreesideViewer` 那一族。 |
   ```

2. 头部和数 `docs/inventory/verdict-settings-run.md:11`：
   `> 四档合计 **[x] 35 + [~] 388 + [ ] 2526 + [-] 298 = 3247**` → `> 四档合计 **[x] 36 + [~] 387 + [ ] 2526 + [-] 298 = 3247**`。
3. 小节标题：`:43` `## A. 已移植（\`[x]\`，全表 35 类）` → `全表 36 类`；`:55` `## B. 部分移植（\`[~]\`，全表 388 类）` → `全表 387 类`。
   （§A 的代表行表是否补这一行由该 lane 决定；`[x]` 的**权威数**是 §G 逐条统计，`tests/b11-verdict.test.mjs` 与
   `tests/b9-verdict.test.mjs` 都按 §G 重数，标题与头部必须跟着改。）
4. 删掉 `tests/b9-verdict.test.mjs` 里 `REGISTERED_DRIFT` 的 `ApplyNonConflictsAction` 条目
   （b89 为这次未同步登记的临时条目；不删就会红在「这些登记已经不再对应任何真实漂移」上 —— 这是刻意留的自清理钩子）。

**门禁影响**：改完后 `tests/b9-verdict.test.mjs`（四档和数由 §G 逐条重数、非钉数）与 `tests/b11-verdict.test.mjs`
（头部「当前已判 N 行」/四档和数同样动态）都应绿；`docs/inventory/settings-run_verdict_table.md` 与本请求无关
（那是族级生成物，`scripts/verdict_table.py settings-run` 的产物，§G 手写表被护栏排除在比对之外）。

## W-2（b89 收工前一度出现的第三条红 —— 已由该 lane 自行同步，本条只留痕，不需要接线）

b89 的两条派单红修完并复跑绿之后，并行提交 `dfbda4e`（「15 路并行移植收口」）改了
`docs/inventory/verdict-settings-run.md` 的 §G 档位却没跟着改头部与小节标题 ⇒
`tests/b9-verdict.test.mjs:94`「四档相加等于总数，且文档头部的和数与表一致」变红：

```
AssertionError: 头部和数没跟着改：头部 35 + 388 + 2526 + 298，§G 实为 35 + 407 + 2507 + 298
```

b89 用脚本逐条重数该文档 §G 的 3247 行（与 `tests/b9-verdict.test.mjs` / `tests/b11-verdict.test.mjs` 同一解析口径）：
`[x]` **35**、`[~]` **407**、`[ ]` **2507**、`[-]` **298**（合计 3247 ✓，头部那句「当前已判 **3247** 行」也 ✓）。
⇒ 文档自己缺两处同步（b89 不可改这份，规则 §2）：

1. `docs/inventory/verdict-settings-run.md:11`
   `> 四档合计 **[x] 35 + [~] 388 + [ ] 2526 + [-] 298 = 3247**`
   → `> 四档合计 **[x] 35 + [~] 407 + [ ] 2507 + [-] 298 = 3247**`
2. `:55` `## B. 部分移植（`[~]`，全表 388 类）` → `全表 407 类`

（`## C. 未移植与缺失设置项（`[ ]` + 上游设置键对照）` 的标题不带数字，无需改；`:43` §A＝35 ✓、`:196` §D＝298 ✓ 已经对得上。）

**状态：已在 b89 收工前由 settings-run lane 自己同步**（工作区 `M docs/inventory/verdict-settings-run.md`），
b89 复核：§G 逐条重数＝`[x]` 35 / `[~]` **408** / `[ ]` **2506** / `[-]` 298，与 `:11` 头部与 `:55` §B 标题逐档相等，
`node --test tests/b9-verdict.test.mjs` ⇒ tests 9 / pass 9 / fail 0。本节留在文件里是为了留痕（这条红是谁的、怎么没的）。

顺带建议（不是本条红的必要条件）：把 `tests/b8-verdict.test.mjs` 里 b89 新加的「§A–§D 小节标题的
「全表 N 类」必须与 §G 逐档实数逐字相等」那组断言同样搬到 `tests/b9-verdict.test.mjs` / `tests/b11-verdict.test.mjs`
—— 本域这处漏同步（和 W-1 那次 §A/§B 停在 43/1044）正是同一类「只写在断言消息里、没人核」的缺陷。
`tests/b11-verdict.test.mjs` 完全不在 b89 的可改面，所以这条只提不改。

## 为什么 b89 不自己改

`docs/inventory/verdict-settings-run.md` 不在派单的可改面里，规则 §2 写「派单没写的一律只读」。
b89 的处理是把这条漂移**逐条登记 + 机械钉死**在 `tests/b9-verdict.test.mjs`：档位对必须等于登记的
`B7=[x] / B9=[~]`、B9 行必须仍写着「继承 B7 判决」、五条本仓 `文件:行号` 与两条上游 `路径:行号` 每次跑门
都要仍在那一行上（符号不在 ⇒ 红）、漂移修好后条目不删 ⇒ 红。交叉核对的范围没缩（仍 630 条逐条、
`declared + justified + registered == shared.length`、`declared >= 300` 一条没松）。
