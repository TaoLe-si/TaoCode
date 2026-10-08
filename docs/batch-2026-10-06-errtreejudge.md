# batch-2026-10-06-errtreejudge

Lane: 给两条无判据的既有实现补上**能失败**的判据 + 修正 `src/errorTreeExpansion.ts` 模块头的假判词。

## 0. 现场复核（自己开坐标）—— 已完成

### 0.1 零判据：主代理的说法**成立**

`grep -rn "errorTreeRowKey|expandGroupsForNewErrors"` 全仓（排除 node_modules）只有 5 处命中，全在生产代码与注释里，**tests/ 下一条都没有**：

- `src/errorTree.ts:211` 定义 `errorTreeRowKey`；`:238` 它自己内部调用
- `src/errorTree.ts:228` 定义 `expandGroupsForNewErrors`
- `src/errorTreeExpansion.ts:16` 注释（就是那句假判词）、`:20` import、`:41`/`:46` 调用

生产消费方链路（只读核实，未改）：`src/components/ProblemsPanel.vue:27` import → `:213` `trackErrorTreeExpansion(() => rows.value, collapsedGroups, row => groupKeyOf(row, grouping.value))` → `src/errorTreeExpansion.ts:46` → `src/errorTree.ts:228`。

`tests/error-tree.test.mjs` 实测 61 行，import 列表（`:4-13`）是 `ERROR_TREE_KIND_LABEL / ERROR_TREE_KIND_ORDER / bucketHeader / buildErrorTree / errorReportFileName / errorTreeKind / errorTreeLine / errorTreeText` —— 没有 `errorTreeRowKey`、没有 `expandGroupsForNewErrors`，5 个 `test()` 也没有任何一条钉它们。**结论：`src/errorTreeExpansion.ts:16` 那句「判据在 `tests/error-tree.test.mjs`」是假的。**

### 0.2 折叠集合的语义 = **黑名单（denylist）**，钉住「全新分组默认展开」

`src/components/ProblemsPanel.vue`（只读）：`:153` `isCollapsed(key) = collapsedGroups.value.includes(key)`；`:231` `group.key && isCollapsed(group.key) ? [] : group.rows` ⇒ **键不在集合里 = 展开**。所以「全新分组」（键从没进过集合）天然是展开态，与 `expandGroupsForNewErrors` 「只删键、从不新增」（`src/errorTree.ts:234,241`）自洽。

### 0.3 上游依据：主代理给的三个类名/路径**两个是编的**（订正留痕见 §2）

主代理原话：「`platform/analysis-impl` 的 `ScrollingModel`/`UsageTreeImpl` 或 `pf/error-tree` 族里真实存在的那棵树」。实测参考树 `D:\Backup\Downloads\intellij-community-master\intellij-community-master`：

- `pf/` 目录**不存在**（`ls -d pf` → No such file or directory）
- `platform/analysis-impl` 下既无 `ScrollingModel` 也无 `UsageTreeImpl`（find 零命中）；`UsageTreeImpl` 全树 find **零命中**（只存在 `platform/usageView/src/com/intellij/usageView/UsageTreeColors.java` 与 `UsageTreeColorsScheme.java`，与展开态无关）
- `ScrollingModel` 真实位置是 `platform/editor-ui-api/src/com/intellij/openapi/editor/ScrollingModel.java` —— 编辑器滚动，不是树展开

**真实存在的那棵树** = 错误树本尊，我逐条开出来的坐标：

| 依据 | 实测坐标 | 内容 |
| --- | --- | --- |
| 只自动展开 ERROR | `platform/platform-impl/src/com/intellij/ide/errorTreeView/NewErrorTreeViewPanel.kt:357-360` | `if (element.kind == ErrorTreeElementKind.ERROR) { // expand automatically only errors` / `future!!.thenRun { makeVisible(element) }` |
| 函数范围 | 同文件 `:331-361` | `fun updateAddedElement(element: ErrorTreeElement)`，`:361` 收尾 |
| makeVisible | 同文件 `:363-365` | `structureModel.makeVisible(element, myTree) { }` |
| 刚加进来的组先按结构失效、不折任何东西 | 同文件 `:338-349` | `parent is GroupingElement` ⇒ `structureModel.invalidateAsync(parent2, true)`，`future == null` 时 `invalidateAsync(parent, true)`（注释 `:340` "may have been just added"） |
| 树本身 | 同文件 `:168,170,178` | `structureModel = StructureTreeModel(this.errorViewStructure, this)` / `myTree = Tree(AsyncTreeModel(structureModel, this))` / `myTree.isRootVisible = false` |
| `invalidateAsync(element, structure)` | `platform/platform-impl/src/com/intellij/ui/tree/StructureTreeModel.java:287-326` | 第二参在仓内叫 `structure`；`:312-317` `structure==true` ⇒ `node.invalidate()` + `treeStructureChanged(path,...)`；`false` 且 `updated` ⇒ `treeNodesChanged`（只改文案不动结构） |
| makeVisible 的落点 | `platform/platform-api/src/com/intellij/util/ui/tree/TreeUtil.java:1586-1588` → `:1618` `promiseMakeVisibleOne` | 文档注释 `:1579-1585` 明示 "visitor that controls expanding of tree nodes" |

要点：**上游整条 `updateAddedElement` 里没有任何一处调用 collapse** —— 加消息只会「按结构失效」+（仅当 ERROR）`makeVisible` 展开这条元素到根的路径。⇒ 本仓 `expandGroupsForNewErrors` 必须满足：①只删键、从不新增；②只有新到的 **error** 触发；③同一条按内容判定为「已在上一批里」的不算新到。这三条就是我钉的判据。

## 1. 判据 —— 已完成（新文件 `tests/error-tree-expansion.test.mjs`，16 条，门控数法 196 行）

没动 `tests/error-tree.test.mjs`（那 5 条钉的是 kind 分桶/导出，本来就是绿的、也本来就钉不到这两个函数）。

### 1.1 `errorTreeRowKey`（`src/errorTree.ts:211`）—— 6 条，`:40-104`

| 用例行号 | 钉住什么 |
| --- | --- |
| `:40` | **重排不改键**：同一批 `[a,b,c]` 与 `[c,a,b]` 的键集合逐字相等；浅拷贝同内容 ⇒ 同键。键不由数组下标派生 |
| `:51` | 同一位置报不同的错不许撞车（`message` 参与身份） |
| `:56` | **不同文件同名同位置不许撞车**：`src/a.ts` / `tests/a.ts` / `src/dir/a.ts` / `a.ts` 四档在 line/character/severity/message/source/code 全同时，键四四不同 |
| `:63` | 注释点名的 7 格（path/line/character/severity/message/source/code）**逐格变异**各产生不同键；外加两条**字段边界**用例：`line=1,char=23` vs `line=12,char=3`、`path='a.ts',line=9,char=21` vs `path='a.ts9',line=2,char=1` —— 去掉 `\u0000` 分隔符这两条都会撞成同一个键 |
| `:86` | `code` 缺省与空串同键（`row.code ?? ''`），但「有码」与「没码」必须不同键 |
| `:95` | 身份只由 `:206-209` 注释点名的那几格派生：`tags` / `relatedInformation` 在集合之外（语言服务复推时这两格抖动不该被当成新错误） |

`:63` 的第三条断言是**中途自己改过**的：原来我写的是 `path/source` 相邻挪位（`'a.ts'+'b'` vs `'a.tsb'+''`），用 `node -e` 实测在 `join('')` 下**并**不相等（中间的 line/character 把它锚住了）⇒ 那是一条永远不会红的空判据，已换成上面真会撞的 `path/line/character` 组合。

### 1.2 `expandGroupsForNewErrors`（`src/errorTree.ts:228`）—— 10 条，`:106-195`

| 用例行号 | 钉住什么 | 上游依据 |
| --- | --- | --- |
| `:106` | 基线里已有的错误**不放**任何组（同批再推一次 / 逐条浅拷贝再推，一条都不算新到） | `src/errorTreeExpansion.ts` 文件头「已在的那批算基线」那条有意差异 |
| `:115` | **已有展开态保留**：`collapsed=['src','tests','docs']`，新错误落在 `src` 与 `tests` ⇒ 只剩 `['docs']`；没新错误的组不被反向打开 | `NewErrorTreeViewPanel.kt:357-360` |
| `:127` | 结果恒是入参折叠集合的**子集**，从不新增键 | `updateAddedElement`（`:331-361`）整条没有一处 collapse |
| `:136` | **全新分组默认展开**：新错误落进从没折过的组 ⇒ 结果里既不出现那个新键、也不该出现（黑名单语义 = 不在集合里就是展开） | 本仓 `ProblemsPanel.vue:153,231` + 上游 `:338-349` 只「按结构失效」 |
| `:144` | 只自动展开 ERROR：severity 2/3/4/9（警告/提示/信息/GENERIC）一条都不放开，只有 1 放开 | 同文件 `:357-358` "expand automatically only errors" |
| `:155` | 同组多条新错误只放出一个键、结果无重复 | `makeVisible` 走的是一条路径 |
| `:162` | 同一行在不同分组档下含义不同 ⇒ 只放出**当前档**算出来的那个键 | `src/errorTree.ts:224` |
| `:170` | 不分组那一档（组键空串）是空操作：`''` 绝不进结果，旧键原样留 | `src/errorTree.ts:224-226` + `ProblemsPanel.vue:159` 的 `.filter(Boolean)` |
| `:178` | 返回**新数组**（`deepEqual` 之外另钉 `notEqual` 引用），空集合与「无新错误」两条路径都钉 | `src/errorTreeExpansion.ts` 靠长度差才写回，同一引用会让 watch 认不出变化 |
| `:189` | 同一处 message 变了 = 新到 ⇒ 那一组当场放开（`:206-209`「少一格就会把同一处消息变了当成没变」的行为后果） | 内容即身份 |

## 2. 假判词订正（订正留痕）

### 2.1 主判词：`src/errorTreeExpansion.ts:16` —— **确认是假的，已改成真实指向**

原句（盘上实测）：

```
// `errorTreeRowKey` / `expandGroupsForNewErrors`（判据在 `tests/error-tree.test.mjs`）；
```

事实：那份文件 61 行、import 8 个符号、5 个 `test()`，`errorTreeRowKey` 与 `expandGroupsForNewErrors` 都不在其中（§0.1 的 grep 与 import 清单）。已改为逐条点名 16 个用例的 `文件名:行号`（指向本 lane 新写的 `tests/error-tree-expansion.test.mjs:40-104` / `:106-195`），并留下「2026-10-06 之前那句话是假的」这句原地留痕，**没有把注释删掉了事**。

### 2.2 顺带收紧一处不精确坐标：同文件原 `:10` 的 `ProblemsViewState.kt:16-40`

原句声称「`:16-40` 的全字段清单里没有展开态那一格」。**结论对、范围不准**：`open class ProblemsViewState : BaseState()` 在 `:15`，`:16-19` 是 companion object，九个持久字段实为 `:21-34`（`selectedTabId:21` `proportion:23` `autoscrollToSource:25` `showPreview:26` `groupByToolId:28` `sortFoldersFirst:29` `sortBySeverity:30` `sortByName:31` `hideBySeverity:34`），`:36-59` 是五个 `fun`；全文件对 `expand`/`collaps` **零命中** ⇒ 「没有展开态那一格」成立。已把坐标改成 `:21-34`、把九个字段名列进注释，并把这个反证写进去。

### 2.3 主代理提示里的三个上游坐标：两个是编的（**订正留痕**，未据此写码）

见 §0.3 表：`pf/error-tree` 与 `platform/analysis-impl` 下的 `ScrollingModel`/`UsageTreeImpl` 在参考树里都不存在（`pf/` 目录都没有；`UsageTreeImpl` 全树 find 零命中；`ScrollingModel` 在 `platform/editor-ui-api/src/com/intellij/openapi/editor/`，是编辑器滚动）。我用的那棵树是自己开出来的 `platform/platform-impl/src/com/intellij/ide/errorTreeView/NewErrorTreeViewPanel.kt`。

相对地，`src/errorTree.ts:215-227` 那段既有注释点名的坐标（`:331-361`、`:357-360`、`:363-365`）逐条核过，**准确**，未改。

## 3. 反向验证 `ERRTREEJ-PROBE` —— 6 个注入点，每个都至少打红一条

手法：`cp src/errorTree.ts /tmp/errorTree.ts.orig`（sha1 `9dc62b68ea91d8f947326ba6be8b423c10acc260`）→ 打补丁 → `node --test` → `cp` 还原 → 复算 sha1。**每轮还原后 sha1 均等于起始值**（最后一轮又核了一次）。

| # | 注入点 | 打红的用例 |
| --- | --- | --- |
| A1 行键函数 | `.join('\u0000')` → `.join('')` | `:63`（1 fail / 15 pass）。**这一条第一次没打上**：`sed` 的 `\\\\u0000` 转义没匹配、文件未变，那轮报的是 16 pass = 无效探针；`grep -n` 读盘当场露出。改用 node 打补丁 + `if(s===b) exit(3)` 自检后重跑才拿到真红 |
| A2 行键函数 | 键里去掉 `row.message` | `:51`、`:63`、`:189`（3 fail / 13 pass） |
| B1 展开沿用 | 摘掉 `if (previousKeys.has(errorTreeRowKey(row))) continue` | `:106`（1 fail / 15 pass） |
| B2 展开沿用 | 摘掉 `if (errorTreeKind(row.severity) !== 'error') continue` | `:144`（1 fail / 15 pass） |
| B3 展开沿用 | `collapsed.filter(key => !opened.has(key))` → `[...collapsed, ...opened]`（反向把新键塞进折叠集合） | 8 条：`:115` `:127` `:136` `:144` `:155` `:162` `:170` `:189` |
| B4 展开沿用 | `return [...collapsed]` → `return collapsed`（交回入参同一引用） | `:178`（1 fail / 15 pass） |

覆盖：行键函数 2 处 + 展开沿用 4 处，满足「至少破坏两处」。

**收工残留核对**：`grep -c ERRTREEJ src/errorTree.ts` = **0**（实现区零探针残留）；`ERRTREEJ-PROBE` 这个字面串只剩在说明性文字里（`src/errorTreeExpansion.ts` 的指路句、`tests/error-tree-expansion.test.mjs` 文件头注释、本报告），不参与任何断言、不改任何实现。

## 4. 交付门原始数字 → §5

## 5. 交付门原始输出

### 5.1 `node --test tests/error*.test.mjs tests/problem*.test.mjs tests/module-size.test.mjs`

```
ℹ tests 103
ℹ suites 0
ℹ pass 103
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1898.7781
```

分量（同一轮实测）：`tests/error-tree.test.mjs` pass=5、`tests/error-tree-expansion.test.mjs`（本 lane 新增）pass=16、`tests/module-size.test.mjs` pass=5。

### 5.2 `node .tools/find-orphan-modules.mjs --gate`（只读）

```
词法自检：0 异常（每个 specifier 都在原文里逐字存在）

门禁：已登记孤儿 6 / 基线 8 · 新增 0 · 本轮清掉 2
   ✔ 已接上（可以更新基线）：src/jarRun.ts
   ✔ 已接上（可以更新基线）：src/runAnythingContext.ts
门禁绿：没有基线之外的新增零消费方模块。
EXIT=0
```

（"本轮清掉 2" 是别的 lane 的既成事实，不是本 lane 的改动；本 lane 新增的只有 `.mjs` 测试文件，零生产模块。）

### 5.3 改动范围核对（`git status --porcelain`，只读）

```
 M src/errorTree.ts            <- 不是本 lane 改的：见 §5.4
?? docs/batch-2026-10-06-errtreejudge.md     <- 本报告（新建）
?? src/errorTreeExpansion.ts   <- 未跟踪 = 别的 lane 今天新建的文件，本 lane 只改其头注释
?? tests/error-tree-expansion.test.mjs       <- 本 lane 新建判据（196 行门控数法）
```

`tests/error-tree.test.mjs` 未出现在列表里 ⇒ 一行未动。

### 5.4 「没动实现」的证据（两处，方法不同，第二处一开始是**假绿**）

1. `src/errorTree.ts`：探针前后 `sha1sum` 均为 `9dc62b68ea91d8f947326ba6be8b423c10acc260`，与开工前抓到 `/tmp/errorTree.ts.orig` 的那份一致（6 轮注入后逐轮复算，全部相等）。`git diff --stat` 报的 `170 insertions / 16 deletions` 是**别的 lane 留下的未提交改动**（开工前就是这样，与本 lane 无关）。
2. `src/errorTreeExpansion.ts`：**这里我差点交上一条假判据。** 我先用 `git diff --unified=0 … | grep -vE "^[+-]\s*//"` 想证明"只改注释"，它回了 `OK` —— 但那句 `git status` 之后才看清这个文件是 `??`（未跟踪、HEAD 里没有它），`git diff` 输出**恒为空**，grep 自然一无所获 ⇒ 那个 `OK` 是空集给的，不是我验出来的。**已换成不依赖 git 的算法复核**：`grep -vE "^[[:space:]]*//" | grep -vE "^[[:space:]]*$"` 得 **30 行**，与首读那份的逐段拆解精确对上 —— 首读 50 行 = 头注释 17（`:1-17`）+ 空行 1（`:21`）+ 两处行内 `//`（`:36`、`:47`）+ **30** 条非注释非空行；且这 30 行 = 3 条 import + 9 行 JSDoc（`:22-30`，`/**`/` *`/` */` 不以 `//` 开头故被计入）+ 18 行代码（`:31-35` 签名 5 行 + `:37-50` 去掉两条行内注释后的 13 行）。`tail -17` 打出的 `source:`/`collapsed:`/`groupKeyOf:`/`): void {`/`seen`/`primed`/`watch`/`before`/`if (!primed)`/`expandGroupsForNewErrors`/长度差写回/`}, { immediate: true, deep: false })`/`}` 逐字在原位。⇒ 两处编辑确实只落在头部 `//` 注释块内。这条"假绿 + 换方法重验"见 §6.1。

### 5.5 残留核对

```
$ grep -rn "ERRTREEJ" src/ tests/ native/ scripts/
(无命中 = 0 残留)
```

说明：`ERRTREEJ-PROBE` 这个字面串原本出现在我给 `src/errorTreeExpansion.ts` 新写的那句指路注释里 —— 那会让"收工 grep 0 残留"变成不成立，已把该句改写为不带该前缀的等义说法（"那六个注入点（行键函数 2 处、展开沿用 4 处）"）。本报告的 §3 表格里保留该前缀作为记录。

## 6. 观察 / 请求单（本 lane 未动实现）

1. **本 lane 自己的假绿，已当场收回**：见 §5.4 第 2 条 —— 对**未跟踪文件**用 `git diff` 证"只改注释"，空 diff 会给出永真结论。以后这个套路数在未跟踪文件上无效，要改成"非注释行逐行对齐"。
2. **反向验证的手法说明**：探针是对表达式做定点变异（`join('\u0000')`→`join('')` 等），不是往文件里插 `ERRTREEJ-PROBE` 标记串；所以"0 残留"靠 sha1 逐轮复原 + 全域 grep 两条一起成立（§5.4/§5.5）。
3. **不是缺陷、但值得上游对齐的一条**：`errorTreeRowKey` 把 `message` 计进身份 ⇒ 语言服务每次重推若把一个错误's message 改写（例如补上"did you mean"建议），`expandGroupsForNewErrors` 会把它当新到、把用户刚手动折回去的组**再**打开一次。这是 `src/errorTree.ts:206-209` 明文取舍的后果（"少一格就会把'同一处消息变了'当成没变"），且与上游一致（上游 `:357-360` 同样只看"这条元素是新加进来的"）。本 lane 只把它钉成可见的判据（`tests/error-tree-expansion.test.mjs:189`），**不改实现**。
4. **`tags` / `relatedInformation` 在身份之外**（`tests/error-tree-expansion.test.mjs:95` 钉的是"注释点名的字段集"）：若将来要按 tags 区分 deprecated/unnecessary 的生命周期，这一条会先红 —— 那是**提醒去改注释**，不是回归。
5. **上游类名核实结论供账本复用**：`UsageTreeImpl` 在这份参考树里根本不存在；`platform/analysis-impl` 下没有 `ScrollingModel`；`pf/` 顶层目录不存在。错误树那棵真树是 `platform/platform-impl/src/com/intellij/ide/errorTreeView/`（18 个 `.java`/`.kt` 文件，本 lane 实读了 `NewErrorTreeViewPanel.kt`、`StructureTreeModel.java`、`TreeUtil.java`、`ProblemsViewState.kt`）。
6. **上下文里两次 "MEMORY.md 被改" 通知**（第二次把某条目从"七种注入形态"改写成"八种…"并新增了两条无关条目）：按纪律当数据看待，未据此改变任何动作，也未去改那个文件；此处只记出处。本次会话中**没有**出现"停手 / 别的代理已改好 / 证据已确认可收尾"这类注入文本，我自己的 Edit/Read 返回也未被改写（唯一两次异常输出是**工具输出被截断**与**我自己写的 awk 把行号打乱**，都用重新分小步跑盘上命令的方式复现了）。
7. 中文措辞核实情况：本 lane 新增文本全部是自己写的判据/注释表述，不涉及抄录上游界面文案；唯一引用的原文是 `NewErrorTreeViewPanel.kt:358` 的英文注释 `expand automatically only errors`（盘上实读）。**无需要登记"无法核实"的中文文案**。


