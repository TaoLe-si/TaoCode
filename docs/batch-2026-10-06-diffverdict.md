# batch diffverdict — 2026-10-06 — `src/diffAlign.ts` 上游行号漂移收口

任务（窄）：`tests/b7-verdict.test.mjs:124`「src/diffAlign.ts 引的上游行号没有漂」真红 ⇒ 逐条打开参考树数出正确行号，只改 `src/diffAlign.ts` 的**引用注释**；不动判定逻辑、不动账本、不重排别路代码。

参考树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（下称「树」）

## §0 接手实况

- 自己复跑 `node --test tests/b7-verdict.test.mjs` ⇒ **红在 `tests/b7-verdict.test.mjs:124`**，`tests 10 / pass 9 / fail 1`；失败明细 14 条（断言 actual 原样）：
  `Diff.kt:29-41`、`Diff.kt:118-127`、`Diff.kt:129-141`、`Diff.kt:64-75`、`Diff.kt:96-101`、
  `Enumerator.kt:16-25`、`MyersLCS.kt:10-11`、`MyersLCS.kt:38-42`、`MyersLCS.kt:64-70`、
  `MyersLCS.kt:96-190`、`MyersLCS.kt:175-186`、`MyersLCS.kt:186-188`、
  `IgnorePolicy.java:29-35`、`TrimUtil.kt:53-55`
  ⇒ 语义是「这 14 个字面量在 `src/diffAlign.ts` 里找不到了」，不是「参考树里没有」。
- 接手基线（§3 的门禁清单全跑）：`tests 197 / pass 195 / fail 2` —— 第 2 条红是 `tests/source-citations.test.mjs` 的
  `docs\batch-2026-10-06-findrep2.md :: platform/.../ConsoleViewImpl.kt:999999`，**非本 lane 文件**（§5 记录，未修）。
- `src/diffAlign.ts` mtime 2026-10-06 15:44:13、`src/diffChunks.ts` 15:44:14（其余 `src/diff*.ts` 更早：diffText 13:45、diffFold 00:05、diffComparison/diffSearch 昨日 23:57/23:58、diffSmartLines/diffWords/diffChars/diffNavigation/diffUnified 10-04~05）⇒ 前任 diff lane 在飞留下的改动 = Patience 退路整段新代码 + 头注行号重排。本 lane 动手前 `src/diffAlign.ts` 495 行（HEAD 262 行）。
- 门内数据本身（`b7-verdict.test.mjs:126-132` 的 `cited` 清单）钉的是一批**旧版上游**坐标；`tests/diff-align.test.mjs:151-166` 钉的是 mergeverdict 一轮的**实测**坐标。两道门的字符串集合不同 ⇒ 收口必须同时满足两边（做法见 §1/§2）。
- 参考树里 5 个类**全部存在且唯一**（`find -name` 逐条命中，路径与 `tests/diff-citations.test.mjs` 的 `BARE_NAMES` 一致）⇒ 本批**无「假坐标」**，漂的只是行号。

## §1 逐条订正表（旧 → 新，带上游实测证据）

证据栏全部是本 lane 用 `grep -n "" <文件>` / `sed -n` 打开树里真实文件逐行数出来的（不是抄 `docs/batch-2026-10-06-mergeverdict.md`）。处置：`live` = 文件里按实测行号活着引；`留痕` = 旧值只出现在新增的「行号订正留痕」块里（写明「原写 X / 实测 Y」），b7 的字面量检查靠它。

| # | 门钉的旧值 | 实测（树） | 实测证据（区间首末行原文） | 处置 |
|---|---|---|---|---|
| 1 | `Diff.kt:29-41`（`Diff.buildChanges`） | `:26-38` 泛型 Array 版、`:42-53` IntArray 版、`:15-17` CharSequence 版 | `platform/util/diff/src/com/intellij/util/diff/Diff.kt`（289 行）：26 `fun <T> buildChanges(objects1: Array<T>, objects2: Array<T>): Change? {` … 38 `}`；42 `fun buildChanges(array1: IntArray, array2: IntArray): Change? {` … 53 `}`；旧区间 29-41 跨了两个函数的接缝 | 留痕 + live 改 `:15`/`:42`/`:26-38` |
| 2 | `Diff.kt:118-127`（`getStartShift`） | `:104-112`（Array 版）、`:125-133`（IntArray 版） | 104 `private fun <T> getStartShift(o1: Array<T>, o2: Array<T>): Int {` … 112 `}`；125 `private fun getStartShift(o1: IntArray, o2: IntArray): Int {` … 133 `}`；`:118-127` 实际落在 `getEndCut`(Array) 体内 + IntArray 版头 | 留痕 + live `Diff.kt:104-112`（`diff-align` 也钉它） |
| 3 | `Diff.kt:129-141`（`getEndCut`） | `:114-123`（Array 版）、`:135-143`（IntArray 版） | 114 `private fun <T> getEndCut(o1: Array<T>, o2: Array<T>, startShift: Int): Int {` … 123 `}`；135 `private fun getEndCut(o1: IntArray, o2: IntArray, startShift: Int): Int {` … 143 `}` | 留痕 + live 改成 `:114-123`/`:135-143`（前任写的 `Diff.kt:115` 少一行、指向函数体第 2 行，一并订正） |
| 4 | `Diff.kt:64-75`（`doBuildChangesFast`） | `:55-66` | 55 `private fun doBuildChangesFast(length1: Int, length2: Int, startShift: Int, endCut: Int): Ref<Change>? {` … 66 `}`；68 是 `private data class Ref<T>`、70-71 是 `@Throws` + `private fun doBuildChanges` ⇒ 旧区间头尾都错位 | 留痕 + live `:55-66` |
| 5 | `Diff.kt:96-101`（Myers→Patience 退路） | `:88-97` | 88 `try {`、89-91 `MyersLCS(...).executeWithThreshold()`、93 `catch (_: FilesTooBigForDiffException) {`、94 `PatienceIntLCS(discarded[0], discarded[1])`、95 `patienceIntLCS.execute(true)`、97 `}`；96-101 是 `changes`/`reindex`/`return` | 留痕 + live `Diff.kt:88-97`（与 `diff-citations` ANCHORS:85 同一条） |
| 6 | `Enumerator.kt:16-25` | `:13-15` 数组入口、`:17-26` 共表赋 id（`:10` 才是那张 `HashMap`） | `platform/util/diff/src/com/intellij/diff/util/Enumerator.kt`（28 行）：13 `fun enumerate(objects: Array<T>, startShift: Int = 0, endCut: Int = 0): IntArray = IntArray(...)` … 15 `}`；17 `private fun enumerate(obj: T): Int {` … 26 `}`；10 `private val numbers = HashMap<T, Int>(expectedCapacity)` | 留痕 + live `Enumerator.kt:13-15`（`diff-align`:162 钉它）与补 `:17-26` |
| 7 | `MyersLCS.kt:10-11` | **未漂** | `platform/util/diff/src/com/intellij/util/diff/MyersLCS.kt`（228 行）：10 ` * Algorithm for finding the longest common subsequence of two strings`、11 ` * Based on E.W. Myers / An O(ND) Difference Algorithm and Its Variations / 1986`（12 是 `O(ND) runtime, O(N) memory`） | live 恢复 `MyersLCS.kt:10-11`（前任只写 `:11`，同一段但字面量不匹配 ⇒ 门红） |
| 8 | `MyersLCS.kt:38-42`（"两张 V 全程复用"） | `:45-46` | 44 `val totalSequenceLength = count1 + count2`、45 `VForward = IntArray(totalSequenceLength + 1)`、46 `VBackward = IntArray(totalSequenceLength + 1)`；38 是次构造器末行 `changes2 = BitSet(second.size))`、41-42 是 `changes1/changes2.set(...)` ⇒ 旧区间指错了东西 | 留痕 + live `MyersLCS.kt:45-46` |
| 9 | `MyersLCS.kt:64-70`（阈值公式） | `:76-78` | 76 `fun executeWithThreshold() {`、77 `val threshold = max(20000 + 10 * sqrt((count1 + count2).toDouble()).toInt(),`、78 `DiffConfig.DELTA_THRESHOLD_SIZE)`；64-70 是 `executeLinear` 收尾 + `fun execute()`（66-73） | 留痕 + live `MyersLCS.kt:76-78`（ANCHORS:86 同） |
| 10 | `MyersLCS.kt:96-190`（分治体） | `:90-193`（函数全体），体内 95-192 | 90 `private fun execute(`（六参 90-93）、94 `check(...)`、95 `if (oldStart < oldEnd && newStart < newEnd) {`、108 `loop@ for (d in 0..halfD) {`、190 `if (throwException) throw FilesTooBigForDiffException()`、193 函数收尾 `}` | 留痕写实测 `:90-193`；live 保留前任/`diff-align` 钉的 `MyersLCS.kt:90-191`（同一段，区间内锚点齐全，见 §2 第 3 条） |
| 11 | `MyersLCS.kt:175-186`（正序吃公共行） | `:200-211` | 200 `private fun commonSubsequenceLengthForward(oldIndex: Int, newIndex: Int, maxLength: Int): Int {` … 211 `}`；175-186 落在 `else if (td >= 0)` 那段递归后的线性扫描里 | 留痕 + live `MyersLCS.kt:200-211` |
| 12 | `MyersLCS.kt:186-188`（超估计抛出） | `:188-190`（throw 行 = 190） | 188 `else {`、189 `//The difference is more than the given estimate`、190 `if (throwException) throw FilesTooBigForDiffException()`；旧区间 186-188 = `}`/`}`/`else {` | 留痕 + live `MyersLCS.kt:188-190` / `:190` |
| 13 | `IgnorePolicy.java:29-35` | **未漂** | `platform/diff-impl/src/com/intellij/diff/tools/util/base/IgnorePolicy.java`（44 行）：29 `public @NotNull ComparisonPolicy getComparisonPolicy() {`、30 `return switch (this) {`、31-33 三个 case、34 `};`、35 `}` | live 恢复整段 `IgnorePolicy.java:29-35`（前任只写 `.../base/IgnorePolicy.java:29`） |
| 14 | `TrimUtil.kt:53-55` | `:53-56` 是 `fun trimStart` | `platform/util/diff/src/com/intellij/diff/comparison/TrimUtil.kt`（583 行）：53 `fun trimStart(text: CharSequence, start: Int, end: Int): Int {`、54 `return trimStart(start, end,`、55 `{ index -> text[index].isSpaceEnterOrTab() })`、56 `}`；旧区间少掉收尾那行 | 留痕（旧 53-55 / 实测 53-56）；live 侧把 TRIM 档的策略枚举改指 `ComparisonPolicy.kt:6`（5 `DEFAULT`、6 `TRIM_WHITESPACES`、7 `IGNORE_WHITESPACES`，实测） |

顺带复核（门没钉、但文件里活着的前任 live 值，逐条开树对过，全部成立 ⇒ 未动）：
`DiffConfig.kt:10`（`DELTA_THRESHOLD_SIZE: Int = 20000`）、`DiffConfig.kt:8`（`USE_PATIENCE_ALG = false`）、
`TextDiffSettingsHolder.kt:47`（`var IGNORE_POLICY: IgnorePolicy = IgnorePolicy.DEFAULT`，`:46` = `HIGHLIGHT_POLICY`）、
`DiffBundle.properties:277`（`option.ignore.policy.none=None`）、
`PatienceIntLCS.kt:11-159`（类 11 起、文件 159 行）、分治体 `:38-123` ✓、`execute(failOnSmallReduction)` `:30-35` ✓、
`UniqueLCS.kt:23-95`（`fun execute()`）✓、`binarySearch` `:101-105` ✓、`return null` `:59-61` ✓、`map.put(...,-1)` `:38`/`:54` ✓、
`Reindexer.kt:15`（`fun discardUnique`）✓、`Diff.kt:72-73`（discardUnique 调用点）✓、`Diff.kt:82-86`（USE_PATIENCE_ALG 分支）✓、
`DiffIterableUtil.kt:35`/`:53`（两处 `throw DiffTooBigException()`）✓、`IgnorePolicy.java:15`（`IGNORE_WHITESPACES_CHUNKS`）✓、`MyersLCS.kt:18-228` ✓、`MyersLCS.kt:213-224`（`commonSubsequenceLengthBackward` 18 行）✓。
唯一一处**前任比实测少一行**但被门钉住的：`PatienceIntLCS.kt:153-158` 的 `checkReduction` 真身在 `:154-158`（`:153` 是它的 `@Throws`）⇒ 区间仍含函数头，不算扑空，且 `diff-citations` ANCHORS 用 `153-157`，故未动（§5 记一笔）。

## §2 拒绝订正的理由

1. **没动 `tests/b7-verdict.test.mjs` 一行**：`cited` 清单（:126-132）与断言都原样。b7 靠 `src/diffAlign.ts` 侧的「行号订正留痕」块收绿 —— 该块逐条写明「原写 X / 实测 Y」，旧值只作为历史留痕存在，不再是 live 引用；读者按图索骥走的是实测行号。这是任务给的合法写法（「按门允许的写法……但必须留痕」），不是放松断言。
2. **没有把 live 引用改回旧值来糊门**：把 `Diff.kt:88-97` 改回 `:96-101` 之类是**主动造漂**（实测 `:96-101` 是 `patienceIntLCS.changes` + `reindexer.reindex` + `return`，不是 Myers→Patience 退路本体），拒绝。
3. **没有把 `MyersLCS.kt:90-191` 改成更精确的 `:90-193`**：`tests/diff-align.test.mjs:157` 钉的字面量就是 `MyersLCS.kt:90-191`，改精确值会红另一条门（两道门钉的字符串集不同，不是同一处矛盾的两解）。实测更精确的值写进留痕块（「本文件其余处按 mergeverdict 记作 `:90-191`，同一段」），两边都成立、区间不越界、锚点在区间内。
4. **没有改 `src/diffAlign.ts` 的任何代码骨架**：只碰 5 处注释（头注 4 行、论文行、IgnorePolicy 行、`getEndCut` 的 JSDoc 一行、新增 24 行留痕块）。前任在飞的 Patience 新代码（`uniqueLcs` / `insertionPoint` / `patienceAlign` 等 188 行）与它的行尾注释一字未动、未重排（归属证据见 §4）。
5. **账本一律未碰**：`docs/inventory/**`、`scripts/verdict_table.py` 归 `ledgerfix`。b7 的绿不依赖账本改动（判决书 §G/§E/§0 那几条本来就绿），所以本 lane 没有"为了绿"去动账本的必要；账本里的同类旧值改成 §6 的请求单交出去。
6. **没有用 `git add/checkout/stash/reset/clean`**：`src/diffAlign.ts` 的未提交改动全程留在工作树里，还原用的是 `cache/` 下的快照文件（`cache/` 未被跟踪）。

## §3 门禁原始数字

命令（与任务给的清单一致，`tests/diff*.test.mjs` 手工展开成 12 个文件）：
`node --test tests/b7-verdict.test.mjs tests/verdict-generated.test.mjs tests/diff-align.test.mjs tests/diff-chunks.test.mjs tests/diff-citations.test.mjs tests/diff-fair.test.mjs tests/diff-fold.test.mjs tests/diff-nav.test.mjs tests/diff-patch-copy.test.mjs tests/diff-patience.test.mjs tests/diff-policy-combo.test.mjs tests/diff-search.test.mjs tests/diff-smart-lines.test.mjs tests/diff-unified.test.mjs tests/diff-words.test.mjs tests/module-size.test.mjs tests/source-citations.test.mjs`

| 阶段 | tests | pass | fail | 失败条 |
|---|---|---|---|---|
| 接手（改之前） | 197 | 195 | 2 | ①`b7-verdict.test.mjs:124`「src/diffAlign.ts 引的上游行号没有漂」 ②`source-citations.test.mjs:85`（`docs\batch-2026-10-06-findrep2.md :: ConsoleViewImpl.kt:999999`，别路残留） |
| 收工（复跑） | 197 | **196** | **1** | 只剩 ②，非本 lane 文件、非本 lane 能改（`docs/batch-2026-10-06-findrep2.md` 是 findrep2 lane 名下） |

- **b7 现在几条绿**：`node --test tests/b7-verdict.test.mjs` ⇒ `tests 10 / pass 10 / fail 0`，其中目标那条「src/diffAlign.ts 引的上游行号没有漂」= ✔（0.4559ms）。
- `node .tools/find-orphan-modules.mjs --gate` ⇒ **门禁绿：没有基线之外的新增零消费方模块**（已登记孤儿 6 / 基线 8 · 新增 0 · 本轮清掉 2；词法自检 0 异常）。本 lane 没新增模块，未动基线。
- 隔离 tsconfig：`npx tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution Bundler --allowImportingTsExtensions --verbatimModuleSyntax --skipLibCheck src/diffAlign.ts src/diffChunks.ts` ⇒ **零输出**（无错）。`diffAlign.ts` 无 import，所以隔离检查不需要全项目 tsconfig（全项目那份含 `src/**/*.vue`，普通 tsc 吃不下，且会被别路在飞文件污染）。
- `tests/module-size.test.mjs`：全绿。`src/diffAlign.ts` 现 521 行（上限 `DEFAULT_LIMIT = 900`，不在「已登记大文件」表也不在 ≤600 的 focused 名单里）；留痕块 +24 行有余量。
- 附带（不在门禁清单，只为确认本 lane 没弄红）：`node --test tests/source-citation-anchors.test.mjs` ⇒ 8/6/2，两条红是 ②同一条 + 快照内容不一致 6 条，命中文件全在 `src/actionsOnSave.ts`、`src/breakpointGroups.ts`、`src/browsers.ts`、`src/buildContentRoots.ts`（别路名下），`src/diff*` 一条不沾 ⇒ 记账本快照那侧要 ledgerfix 重算（§6 末行）。

## §4 反向验证（前缀 `DIFFVERDICT`）

还原基准：`cache/diffAlign.fixed.bak.ts`（改好后先落盘快照，sha1 `3c460e6f4c64fec941b134c13f7e4d3df9856764`）。

| 反向用例 | 故意写错的东西 | 期望并实测到的红 | 还原 |
|---|---|---|---|
| RC1（b7 侧：门确实会咬旧值字面量） | 留痕块里 `原写 `+``Diff.kt:29-41` `` 改成 `Diff.kt:29-40` 并带 `DIFFVERDICT-RC1` | `node --test tests/b7-verdict.test.mjs` ⇒ `pass 9 / fail 1`，`AssertionError: 这些上游引用在 src/diffAlign.ts 里找不到了` actual = `['Diff.kt:29-41']` ⇒ 门不是空转 | `cp` 回快照 ⇒ `cmp` 无差异、sha1 与基准同为 `3c460e6f…` |
| RC2（live 侧：实测值写错会被本域判据咬） | `PatienceIntLCS.kt:11-159` 两处都改成 `PatienceIntLCS.kt:11-158` + `DIFFVERDICT-RC2` | `node --test tests/diff-align.test.mjs tests/diff-citations.test.mjs` ⇒ `pass 17 / fail 1`：`✖ 内核文件里的上游行号不许漂移（判据的判据） —— diffAlign.ts 里少了上游引用 PatienceIntLCS.kt:11-159`（`tests/diff-align.test.mjs:145`） | 同上，`cmp`/sha1 核过 |
| 残留扫描 | — | `grep -rn DIFFVERDICT src/ tests/` ⇒ **0** 条（本文件 §4 里留了标记名，属报告留痕，不在扫描范围） | — |

归属自查（`git diff -U0 -- src/diffAlign.ts` / `git diff --numstat`）：
- `src/diffAlign.ts` 未提交改动共 `+306 / -47`（本 lane 之后），`src/diffChunks.ts` `+94 / -0`。逐行核对：本 lane 只贡献头注 5 处替换 + 24 行留痕块；`+306/-47` 的其余部分是前任 diff lane 的 Patience 实现与它自己的行号订正（`MyersLCS.kt:98-99`、`:109-110`、`:123-136`、`:164-169`、`:170-187`、`:188-190`、`:200-211`、`:213-224` 的行尾注释，及 `uniqueLcs`/`insertionPoint`/`patience*` 整段新代码）。
- 代码骨架比对：变化行里凡带代码的，`-` 侧与 `+` 侧去掉行尾 `//` 注释后**逐字节相同**（5 处：`this.forward[...] = 0`、`for (let k = L; ...)`、`if (td > 1)`、`if (td >= 0)`、`return false`），即"只动注释"成立。
- `src/diffChunks.ts` 未改（mtime/内容都没碰），`src/diff*.ts` 其余文件未改。

## §5 无法核实 / 别路残留（只记录，未修）

1. `tests/source-citations.test.mjs:85` 那条红：出处 `docs/batch-2026-10-06-findrep2.md:124`（该行本身在叙述"中途红过一次"时把 `.../execution/impl/ConsoleViewImpl.kt:999999` 原样抄进了 md，而门扫 `docs/**` 的 `*.md` ⇒ 被当成 live 引用）。**不是本 lane 文件**（findrep2 lane 名下），未修。给该 lane / ledgerfix 的一句话：门的正则只认以 `platform|plugins|java|kotlin|python|wire|tools` 开头的完整路径，所以把那份路径写成省略形式（含 `...` 即被 `citationsOf` 跳过）或直接去掉占位数字即可解红；本条为免自绊，路径已按省略形式记在这里。
2. `tests/source-citation-anchors.test.mjs`「已入快照的每条引用内容必须仍一致」6 条红，命中 `src/actionsOnSave.ts`、`src/breakpointGroups.ts`、`src/browsers.ts`、`src/buildContentRoots.ts` —— 别路名下 + 快照归 ledgerfix，未修。
3. 参考树**版本口径**：本 lane 一切"实测"以 `D:\Backup\Downloads\intellij-community-master\intellij-community-master` 当前那份为准（`Diff.kt` 289 行 / `MyersLCS.kt` 228 行 / `Enumerator.kt` 28 行 / `IgnorePolicy.java` 44 行 / `TrimUtil.kt` 583 行）。b7 门内那 12 条旧值与本树的差，只能解释为**更早一版上游**的行位（`MyersLCS.kt` 头注版权 2025、`Enumerator.kt` 2025，且旧值整体像 Kotlin 重写前的排布）；树里没有第二份历史版本可对照（`ls /d/Backup/Downloads/*intellij*` 只有 master 这一份 + zip），所以"旧值当年对不对"无法核实，只能核实"今天按图索骥会扑空"。
4. `PatienceIntLCS.kt:153-158`（前任 live 值）实测是 `154-158`（`:153` 是 `@Throws(FilesTooBigForDiffException::class)`）：区间含函数头，不算扑空，且 `tests/diff-citations.test.mjs:91` 的 ANCHORS 用 `153-157` 也过 ⇒ 保留未改，登记待议。

## §6 账本订正请求（**本 lane 未动账本，交 `ledgerfix` 特批一路**）

同批旧值也活在 `docs/inventory/**` 里（`grep` 逐条定位，行号是账本文件的行）：

| 账本位置 | 现写 | 实测（本 lane 逐行开树） | 依据 |
|---|---|---|---|
| `docs/inventory/verdict-find-diff.md:42` | `platform/util/diff/src/com/intellij/diff/util/Enumerator.kt:16-25` | `:13-15`（数组入口）/ `:17-26`（共用 `numbers` 表赋 id） | `Enumerator.kt` 28 行，13 行是 `fun enumerate(objects: Array<T>, ...)` |
| `docs/inventory/verdict-find-diff.md:48` | `MyersLCS.kt:186-188`、`Diff.kt:96-101` | `MyersLCS.kt:188-190`（throw 在 `:190`）、`Diff.kt:88-97` | 190 `if (throwException) throw FilesTooBigForDiffException()`；93 catch / 95 `execute(true)` |
| `docs/inventory/verdict-find-diff.md:285`（§E 第 1 条） | `Diff.kt:96-101`、`MyersLCS.kt:64-70` | `Diff.kt:88-97`、`MyersLCS.kt:76-78` | 阈值公式在 `executeWithThreshold`（76-78） |
| `docs/inventory/verdict-find-diff.md:904` | `MyersLCS.kt:186-188` + 本仓 `src/diffAlign.ts:74` | 上游 `:188-190`；本仓 `FilesTooBigForDiff` 现在 `src/diffAlign.ts:115` | HEAD 时该类已在 `:77`（账本写 74 ⇒ **接手前就漂 3 行**），前任插入 +14、本 lane 留痕 +24 ⇒ 现 115 |
| `docs/inventory/verdict-find-diff.md:930` | `Enumerator.kt:16-25` + 本仓 `src/diffAlign.ts:51` | 上游 `:13-15`/`:17-26`；本仓 `enumerate()` 现在 `src/diffAlign.ts:92` | HEAD 时 `enumerate` 在 `:54`（账本写 51 ⇒ 同样接手前就漂） |
| `docs/inventory/verdict-settings-run.md:2459` | `MyersLCS.kt:186-188` + `src/diffAlign.ts:74`（"继承 B7"） | 同上两栏 | 与 find-diff 同批 |
| `docs/inventory/verdict-settings-run.md:2485` | `Enumerator.kt:16-25` + `src/diffAlign.ts:51`（"继承 B7"） | 同上两栏 | 与 find-diff 同批 |
| **未漂，无需动**（顺手确认） | `verdict-find-diff.md:85`/`:902` 的 `IgnorePolicy.java:29-35`、`:640` 的 `IgnorePolicy.java:31-33`、`:907` 的 `TrimUtil.kt:323-339`、`:204` 的 `TrimUtil.kt:341-368` | 29-35 = `getComparisonPolicy` 整段 ✓、31-33 = 三个 switch case ✓ | `diff-citations` ANCHORS 里 `TrimUtil.kt:*` 已由门核过 |

配套提醒（都归 ledgerfix，不是本 lane 的动作）：
- `docs/inventory/citation-anchors.json` 里确实存在 `docs/inventory/verdict-find-diff.md | platform/util/diff/src/com/intellij/diff/util/Enumerator.kt | 16-25` 这条锚点 ⇒ **改账本后必须重算快照**：`TAOCODE_CITATION_ANCHORS=update node --test tests/source-citation-anchors.test.mjs`。
- `tests/b7-verdict.test.mjs:126-132` 的 `cited` 清单（门内数据，非账本）目前仍钉这 12 条旧值。本 lane 用 `src/diffAlign.ts` 的留痕块把它保绿；若要把门改成实测值，必须**同批**改门内清单 + 留痕块，并让 `tests/diff-align.test.mjs:151-166` 的 live 清单一起过（两份字符串集不同，单边改必红另一边）。
- 判决簿四档计数（`[x] 32 / [~] 351 / [ ] 0 / [-] 247`）与 `scripts/verdict_table.py`：本 lane 一条没碰，b7 的绿也不依赖它。
