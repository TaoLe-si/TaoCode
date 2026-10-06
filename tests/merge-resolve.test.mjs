// 三方合并**模型与自动解决**的判据（纯算法在 `src/mergeResolve.ts`，宿主链在 `src/mergeResolveHost.ts`）。
//
// 上游依据（本机参考树 `intellij-community-master`，行号是自己数出来的）：
//   · 类型判定 `platform/util/diff/src/com/intellij/diff/util/MergeRangeUtil.kt:15-74`（getMergeType 的六个分支）
//     与行级入口 `:92-107`（getLineMergeType，第 4 个参数是 canResolveLineConflict）；
//   · 词级入口 `:158-168`（getWordMergeType，第 4 个参数写死 `{ false }`）—— 解决器内部判类型走它
//     （`platform/util/diff/src/com/intellij/diff/comparison/MergeResolveUtil.kt:152-154`）；
//   · 自动解决 `comparison/MergeResolveUtil.kt:70-141`（SimpleHelper.execute / appendBase / appendConflict）；
//   · 三方对齐 `comparison/ComparisonMergeUtil.kt:53-105`（FairMergeBuilder + add）与
//     `:107-158`（ChangeBuilder / IgnoringChangeBuilder）；
//   · 段模型 `util/MergeRange.kt:6-45`、类型模型 `util/MergeConflictType.kt:8-35`（isChange(BASE) 恒 true）；
//   · 两个动作的差别 `platform/diff-impl/src/com/intellij/diff/merge/MergeConflictModel.kt:141`
//     （getAutoResolvableChanges = MagicResolveConflicts）与 `:146-147`
//     （hasNonConflictedChanges = !isConflict && canResolveChangeAutomatically → ApplyNonConflicts）。
//
// 本仓口径差（`src/mergeResolve.ts` 文件头写了，这里钉住）：上游外层按行、内层按词，
// 本仓两层都是行 ⇒ 相邻两行「一侧改这行、另一侧改那行」在上游能被词级解决器合掉，
// 本仓按行判会留给用户（少自动合，不会合错）—— 见下面「相邻行的两侧改动」那一条。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildMergeRanges, canAutoResolve, conflictSides, isChangeOf, isEmptyRange, mergeLineType,
  rangeTexts, resolveConflictsInText, tryResolveConflict, APPLY_NON_CONFLICTS_TEXT, RESOLVE_SIMPLE_CONFLICTS_TEXT,
} from '../src/mergeResolve.ts'
import { parseConflicts, conflictStatus, nextConflict, unresolvedCount } from '../src/mergeConflicts.ts'
import { readFileSync, readdirSync } from 'node:fs'

const L = (...lines) => lines.join('\n')

/** 取整块（三侧全范围）的类型 —— 上游 getLineMergeType 对一个 fragment 的问法。 */
function wholeType(left, base, right, policy) {
  return mergeLineType({ left: [0, left.length], base: [0, base.length], right: [0, right.length] }, left, base, right, policy)
}

/** 上游是按**对齐出来的片段**问类型的，这里同款：片段范围 + 该片段的类型。 */
function fragmentTypes(left, base, right, policy) {
  return buildMergeRanges(left, base, right, policy).map(range => mergeLineType(range, left, base, right, policy))
}

// —— 一、类型判定（MergeRangeUtil.getMergeType 的六个分支）——

test('只有一侧改了：modified + 只有那一侧是 change', () => {
  const left = ['a', 'X', 'c'], base = ['a', 'b', 'c'], right = ['a', 'b', 'c']
  assert.deepEqual(buildMergeRanges(left, base, right), [{ left: [1, 2], base: [1, 2], right: [1, 2] }])
  assert.deepEqual(mergeLineType({ left: [1, 2], base: [1, 2], right: [1, 2] }, left, base, right),
    { type: 'modified', leftChange: true, rightChange: false, canBeResolved: true })
  assert.deepEqual(wholeType(['a', 'b', 'c'], base, ['a', 'Y', 'c']),
    { type: 'modified', leftChange: false, rightChange: true, canBeResolved: true })
})

test('两侧改成同一个东西：modified 且两侧都算改了（getMergeType 的 equalModifications 分支）', () => {
  assert.deepEqual(wholeType(['a', 'X', 'c'], ['a', 'b', 'c'], ['a', 'X', 'c']),
    { type: 'modified', leftChange: true, rightChange: true, canBeResolved: true })
})

test('两侧改得不一样：conflict，探路问不出结果就是不可自动解决', () => {
  assert.deepEqual(wholeType(['a', 'X', 'c'], ['a', 'b', 'c'], ['a', 'Y', 'c']),
    { type: 'conflict', leftChange: true, rightChange: true, canBeResolved: false })
})

test('一侧删掉、另一侧没动：片段是 deleted，只有动的那侧算改了', () => {
  const left = ['a', 'c'], base = ['a', 'b', 'c'], right = ['a', 'b', 'c']
  assert.deepEqual(buildMergeRanges(left, base, right), [{ left: [1, 1], base: [1, 2], right: [1, 2] }])
  assert.deepEqual(fragmentTypes(left, base, right),
    [{ type: 'deleted', leftChange: true, rightChange: false, canBeResolved: true }])
})

test('两侧都删掉：-=- 是 deleted，两侧都算改（getMergeType:59-60）', () => {
  const left = ['a', 'c'], base = ['a', 'b', 'c'], right = ['a', 'c']
  assert.deepEqual(buildMergeRanges(left, base, right), [{ left: [1, 1], base: [1, 2], right: [1, 1] }])
  assert.deepEqual(fragmentTypes(left, base, right),
    [{ type: 'deleted', leftChange: true, rightChange: true, canBeResolved: true }])
  assert.deepEqual(tryResolveConflict(left, base, right), ['a', 'c'])
})

test('删除与修改撞在同一段：conflict 且不可自动解决（上游给的是 null 策略）', () => {
  const left = ['a', 'c'], base = ['a', 'b', 'c'], right = ['a', 'B', 'c']
  assert.deepEqual(fragmentTypes(left, base, right),
    [{ type: 'conflict', leftChange: true, rightChange: true, canBeResolved: false }])
  assert.equal(tryResolveConflict(left, base, right), null)
})

test('基线为空、两侧各插一段不同的：=-= 一律 conflict 且不可解（插-插没有顺序可推）', () => {
  assert.deepEqual(wholeType(['a', 'L', 'c'], [], ['a', 'R', 'c']),
    { type: 'conflict', leftChange: true, rightChange: true, canBeResolved: false })
  assert.equal(tryResolveConflict(['a', 'L', 'c'], [], ['a', 'R', 'c']), null)
})

test('基线为空、只有一侧有内容：那是插入，不是冲突', () => {
  assert.deepEqual(wholeType(['x', 'a'], [], ['a']), { type: 'conflict', leftChange: true, rightChange: true, canBeResolved: false })
  // 上面那条是「两侧都非空且不相等」的 =-= 分支；只有一侧非空才走 --= / =--
  assert.deepEqual(mergeLineType({ left: [0, 1], base: [0, 0], right: [0, 0] }, ['x'], [], []),
    { type: 'inserted', leftChange: true, rightChange: false, canBeResolved: true })
  assert.deepEqual(mergeLineType({ left: [0, 0], base: [0, 0], right: [0, 1] }, [], [], ['y']),
    { type: 'inserted', leftChange: false, rightChange: true, canBeResolved: true })
})

test('三侧完全相同：没有任何改动段，自动解决就是基线本身', () => {
  assert.deepEqual(buildMergeRanges(['a', 'b'], ['a', 'b'], ['a', 'b']), [])
  assert.deepEqual(tryResolveConflict(['a', 'b'], ['a', 'b'], ['a', 'b']), ['a', 'b'])
})

test('isChange(BASE) 恒为 true，isEmpty 是三侧同时空（MergeConflictType.kt:25-31 / MergeRange.kt:44-45）', () => {
  const conflict = { type: 'conflict', leftChange: false, rightChange: false, canBeResolved: false }
  assert.equal(isChangeOf(conflict, 'base'), true)
  assert.equal(isChangeOf(conflict, 'left'), false)
  assert.equal(isChangeOf(conflict, 'right'), false)
  assert.equal(isEmptyRange({ left: [1, 1], base: [2, 2], right: [0, 0] }), true)
  assert.equal(isEmptyRange({ left: [1, 2], base: [2, 2], right: [0, 0] }), false)
})

test('rangeTexts 取的是三侧各自的行段（canResolveLineConflict 的 getLinesContent）', () => {
  const range = { left: [1, 3], base: [0, 2], right: [2, 4] }
  assert.deepEqual(rangeTexts(range, ['L0', 'L1', 'L2'], ['B0', 'B1'], ['R0', 'R1', 'R2', 'R3']),
    { left: ['L1', 'L2'], base: ['B0', 'B1'], right: ['R2', 'R3'] })
})

// —— 二、自动解决（MergeResolveUtil.SimpleHelper）——

test('自动解决：单侧改动取那一侧，两侧相同取相同，两侧不同返回 null', () => {
  assert.deepEqual(tryResolveConflict(['a', 'X', 'c'], ['a', 'b', 'c'], ['a', 'b', 'c']), ['a', 'X', 'c'])
  assert.deepEqual(tryResolveConflict(['a', 'b', 'c'], ['a', 'b', 'c'], ['a', 'Y', 'c']), ['a', 'Y', 'c'])
  assert.deepEqual(tryResolveConflict(['a', 'X', 'c'], ['a', 'b', 'c'], ['a', 'X', 'c']), ['a', 'X', 'c'])
  assert.equal(tryResolveConflict(['a', 'X', 'c'], ['a', 'b', 'c'], ['a', 'Y', 'c']), null)
})

test('两处互不相邻的改动会被切成两个片段并各自合掉（这就是「解决简单的冲突」能用的那一档）', () => {
  assert.deepEqual(tryResolveConflict(['X', 'b', 'b', 'c'], ['a', 'b', 'b', 'c'], ['a', 'b', 'b', 'Z']),
    ['X', 'b', 'b', 'Z'])
  assert.deepEqual(tryResolveConflict(['a', 'b', 'Z'], ['a', 'L', 'b', 'Z'], ['a', 'L', 'b', 'Q']),
    ['a', 'b', 'Q'])
})

test('相邻两行一侧改上行、另一侧改下行：按行的粒度判成真冲突，留给用户', () => {
  // 上游这一条会在词级解决器里合掉（MergeRangeUtil.kt:158-168 的词级 + canResolveLineConflict 的探路）；
  // 本仓两层同粒度，判成 conflict 更保守 —— 改动前先看清这条断言钉的是「不合」而不是「合错」。
  assert.deepEqual(buildMergeRanges(['A', 'b'], ['a', 'b'], ['a', 'B']),
    [{ left: [0, 2], base: [0, 2], right: [0, 2] }])
  assert.equal(tryResolveConflict(['A', 'b'], ['a', 'b'], ['a', 'B']), null)
})

test('忽略空白那一档下，只有缩进不同的改动算「一侧改了」并按 DEFAULT 剔掉空段', () => {
  const left = ['a', '  X  '], base = ['a', 'X'], right = ['a', 'X']
  assert.deepEqual(mergeLineType({ left: [1, 2], base: [1, 2], right: [1, 2] }, left, base, right, 'ignoreWhitespaces'),
    { type: 'modified', leftChange: true, rightChange: false, canBeResolved: true })
  assert.deepEqual(tryResolveConflict(left, base, right, 'ignoreWhitespaces'), ['a', '  X  '])
})

test('真冲突不再无限自问：单行三侧全不同也是干净返回 null（回归 RangeError）', () => {
  // 原写「解决器内部与外层用同一个探路」，实际会 mergeLineType → tryResolveConflict → mergeLineType(同样输入)
  // 无限递归：真冲突文件点「解决简单的冲突」抛 RangeError: Maximum call stack size exceeded。
  // 上游的内层探路是写死的 false（MergeRangeUtil.kt:168），这里照抄。
  assert.doesNotThrow(() => tryResolveConflict(['X'], ['b'], ['Y']))
  assert.equal(tryResolveConflict(['X'], ['b'], ['Y']), null)
  assert.doesNotThrow(() => resolveConflictsInText(L('<<<<<<< HEAD', 'mine', '||||||| base', 'base', '=======', 'theirs', '>>>>>>> f'), false))
})

// —— 三、标记文本上的三份内容与「能不能自动合」——

test('conflictSides 从 diff3 标记里取出三份，两路标记没有基线', () => {
  const diff3 = L('<<<<<<< HEAD', 'ours', '||||||| base', 'base', '=======', 'theirs', '>>>>>>> f')
  assert.deepEqual(conflictSides(diff3.split('\n'), parseConflicts(diff3)[0]), { base: ['base'], left: ['ours'], right: ['theirs'] })
  const twoWay = L('<<<<<<< HEAD', 'ours', '=======', 'theirs', '>>>>>>> f')
  assert.deepEqual(conflictSides(twoWay.split('\n'), parseConflicts(twoWay)[0]), { base: [], left: ['ours'], right: ['theirs'] })
})

test('canAutoResolve：一侧没动 / 两侧改成同一个 才能自动合', () => {
  assert.equal(canAutoResolve({ base: ['b'], left: ['X'], right: ['b'] }), true)
  assert.equal(canAutoResolve({ base: ['b'], left: ['X'], right: ['X'] }), true)
  assert.equal(canAutoResolve({ base: ['b'], left: ['X'], right: ['Y'] }), false)
  // 没有基线时两侧各留一份 = 上游的 =-= 插插冲突，推不出顺序，不可自动合
  assert.equal(canAutoResolve({ base: [], left: ['ours'], right: ['theirs'] }), false)
})

// —— 四、整份文本的批量解决（两个菜单动作的口径）——

test('混合文件：能合的合掉，真冲突原样留着，计数对得上', () => {
  const text = L('top',
    '<<<<<<< HEAD', 'L1', '||||||| base', 'B1', '=======', 'L1', '>>>>>>> other',
    'mid',
    '<<<<<<< HEAD', 'P', '||||||| base', 'Q', '=======', 'R', '>>>>>>> other',
    'end')
  const result = resolveConflictsInText(text, false)
  assert.equal(result.resolved, 1)
  assert.equal(result.remaining, 1)
  assert.equal(result.text, L('top', 'L1', 'mid',
    '<<<<<<< HEAD', 'P', '||||||| base', 'Q', '=======', 'R', '>>>>>>> other', 'end'))
})

test('两个开关确实不是一回事：整块算冲突但按片段能合掉时，只有「解决简单的冲突」会动它', () => {
  const block = L('<<<<<<< HEAD', 'a', 'a', 'a', 'b', '||||||| base', 'a', 'a', 'a', 'a', '=======', 'a', 'b', 'a', 'a', '>>>>>>> other')
  const magic = resolveConflictsInText(block, false)
  assert.deepEqual([magic.resolved, magic.remaining, magic.text], [1, 0, L('a', 'b', 'a', 'b')])
  const nonConflicts = resolveConflictsInText(block, true)
  assert.deepEqual([nonConflicts.resolved, nonConflicts.remaining], [0, 1])
  assert.equal(nonConflicts.text, block)
})

test('没有冲突的文件：文本一个字符都不动，计数为 0', () => {
  const text = L('a', 'b', '')
  assert.deepEqual(resolveConflictsInText(text, false), { text, resolved: 0, remaining: 0 })
  assert.deepEqual(resolveConflictsInText(text, true), { text, resolved: 0, remaining: 0 })
})

test('逐块解决不串味：前一块合掉后，后一块的行号仍然有效', () => {
  const text = L('<<<<<<< HEAD', 'X', '||||||| base', 'b', '=======', 'X', '>>>>>>> o',
    'mid',
    '<<<<<<< HEAD', 'Y', '||||||| base', 'y', '=======', 'Y', '>>>>>>> o')
  const result = resolveConflictsInText(text, false)
  assert.deepEqual([result.resolved, result.remaining, result.text], [2, 0, L('X', 'mid', 'Y')])
})

test('两个动作的文案是上游 key 的中文取值', () => {
  assert.equal(RESOLVE_SIMPLE_CONFLICTS_TEXT, '解决简单的冲突')
  assert.equal(APPLY_NON_CONFLICTS_TEXT, '应用所有不冲突的更改')
})

// —— 五、宿主链：入口把哪个 flag 传进来、什么时候才落盘 ——

const host = readFileSync(new URL('../src/mergeResolveHost.ts', import.meta.url), 'utf8')

test('宿主把两条菜单分别绑到两个 flag 上，整文件接受走 acceptSide', () => {
  assert.match(host, /resolveSimpleConflicts[\s\S]{0,200}applyResolution\(path, false, deps/)
  assert.match(host, /applyNonConflictingChanges[\s\S]{0,200}applyResolution\(path, true, deps/)
  assert.ok(host.includes('text = acceptSide(text, parseConflicts(text)[remaining - 1]!, side)'),
    '整文件接受逐块倒序换成一侧的内容')
})

test('宿主一处都没合掉时不写盘，只给一句为什么', () => {
  assert.match(host, /if \(!result\.resolved\) \{[\s\S]{0,400}return false/)
  assert.match(host, /await request\('file\.write'/)
  const writes = host.split("await request('file.write'").length - 1
  assert.equal(writes, 2, '两处写盘：逐块解决与整文件接受各一条')
})

// —— 六、四类判据（双方改同一行 / 改不同行 / 删 vs 改 / 基线缺失），期望写成逐行、逐字节精确 ——
//
// 每一块都同时钉三层：对齐出来的片段（`buildMergeRanges`）→ 片段类型（`getMergeType` 的分支）→
// 整份标记文本的解决结果（`resolveConflictsInText` 的 `text` / `resolved` / `remaining` 三个字段一起
// `deepEqual`，不用 `includes`，因此改一个字都会红）。

/** git 的 diff3 标记块（带 `|||||||` 基线段）。 */
const diff3Block = (ours, base, theirs) => ['<<<<<<< HEAD', ...ours, '||||||| base', ...base, '=======', ...theirs, '>>>>>>> other']
/** 两路（zebra/mergetool=default）标记块：**没有基线段**，即"基线缺失"。 */
const twoWayBlock = (ours, theirs) => ['<<<<<<< HEAD', ...ours, '=======', ...theirs, '>>>>>>> other']

test('判据一：双方改同一行 ⇒ 对齐出一个同位片段、类型 conflict、两个动作都逐字节不动文本', () => {
  const left = ['h', 'X', 't'], base = ['h', 'b', 't'], right = ['h', 'Y', 't']
  assert.deepEqual(buildMergeRanges(left, base, right), [{ left: [1, 2], base: [1, 2], right: [1, 2] }])
  assert.deepEqual(fragmentTypes(left, base, right),
    [{ type: 'conflict', leftChange: true, rightChange: true, canBeResolved: false }])
  assert.equal(tryResolveConflict(left, base, right), null)
  const text = L(...diff3Block(left, base, right))
  assert.deepEqual(resolveConflictsInText(text, false), { text, resolved: 0, remaining: 1 })
  assert.deepEqual(resolveConflictsInText(text, true), { text, resolved: 0, remaining: 1 })
})

test('判据一之二：同一行两侧改成**不同行数**也是 conflict（不许被长度差糊弄成"一侧没动"）', () => {
  const left = ['X1', 'X2'], base = ['b'], right = ['Y1']
  assert.deepEqual(fragmentTypes(left, base, right),
    [{ type: 'conflict', leftChange: true, rightChange: true, canBeResolved: false }])
  assert.equal(tryResolveConflict(left, base, right), null)
  const text = L(...diff3Block(left, base, right))
  assert.deepEqual(resolveConflictsInText(text, false), { text, resolved: 0, remaining: 1 })
  // 反向（右侧展开成两行）同理
  const flipped = L(...diff3Block(['Y1'], ['b'], ['X1', 'X2']))
  assert.deepEqual(resolveConflictsInText(flipped, false), { text: flipped, resolved: 0, remaining: 1 })
})

test('判据二：双方改**不同行**（隔开）⇒ 两个片段各自合掉，结果逐行精确；一侧单独改时两个口径都合', () => {
  const left = ['X', 'b', 'c', 'd', 'e'], base = ['a', 'b', 'c', 'd', 'e'], right = ['a', 'b', 'c', 'd', 'Y']
  assert.deepEqual(buildMergeRanges(left, base, right),
    [{ left: [0, 1], base: [0, 1], right: [0, 1] }, { left: [4, 5], base: [4, 5], right: [4, 5] }])
  assert.deepEqual(fragmentTypes(left, base, right), [
    { type: 'modified', leftChange: true, rightChange: false, canBeResolved: true },
    { type: 'modified', leftChange: false, rightChange: true, canBeResolved: true },
  ])
  assert.deepEqual(tryResolveConflict(left, base, right), ['X', 'b', 'c', 'd', 'Y'])
  const text = L(...diff3Block(left, base, right))
  assert.deepEqual(resolveConflictsInText(text, false), { text: L('X', 'b', 'c', 'd', 'Y'), resolved: 1, remaining: 0 })
  // 「应用所有不冲突的更改」按**整块**判类型（本仓的块粒度，与上游的片段粒度差一条，见文件头口径差）
  assert.deepEqual(resolveConflictsInText(text, true), { text, resolved: 0, remaining: 1 })
  // 只有一侧动 ⇒ 两个口径是同一件事
  const oneSided = L(...diff3Block(['X', 'b', 'c'], ['a', 'b', 'c'], ['a', 'b', 'c']))
  assert.deepEqual(resolveConflictsInText(oneSided, false), { text: L('X', 'b', 'c'), resolved: 1, remaining: 0 })
  assert.deepEqual(resolveConflictsInText(oneSided, true), { text: L('X', 'b', 'c'), resolved: 1, remaining: 0 })
})

test('判据三：一侧删、另一侧改**同一行** ⇒ conflict，两个动作都逐字节不动文本（正反两向）', () => {
  const delLeft = ['h', 't'], base = ['h', 'b', 't'], modRight = ['h', 'B', 't']
  assert.deepEqual(fragmentTypes(delLeft, base, modRight),
    [{ type: 'conflict', leftChange: true, rightChange: true, canBeResolved: false }])
  assert.equal(tryResolveConflict(delLeft, base, modRight), null)
  const text = L(...diff3Block(delLeft, base, modRight))
  assert.deepEqual(resolveConflictsInText(text, false), { text, resolved: 0, remaining: 1 })
  assert.deepEqual(resolveConflictsInText(text, true), { text, resolved: 0, remaining: 1 })
  // 左右互换（左侧改、右侧删）
  assert.equal(tryResolveConflict(modRight, base, delLeft), null)
  const swapped = L(...diff3Block(modRight, base, delLeft))
  assert.deepEqual(resolveConflictsInText(swapped, false), { text: swapped, resolved: 0, remaining: 1 })
  // 对照：一侧删、另一侧**没动** ⇒ 这是能自动并入的那一档，删除真的落进结果
  const untouched = L(...diff3Block(delLeft, base, base))
  assert.deepEqual(resolveConflictsInText(untouched, false), { text: L('h', 't'), resolved: 1, remaining: 0 })
  assert.deepEqual(resolveConflictsInText(untouched, true), { text: L('h', 't'), resolved: 1, remaining: 0 })
})

test('判据四：基线缺失 ⇒ 两侧不同一律 conflict；两侧相同自动取那一份；一侧空就取另一侧', () => {
  // (1) 两路标记（完全没有 `|||||||` 段）：conflictSides 的 base 就是空数组
  const differ = L(...twoWayBlock(['h', 'X', 't'], ['h', 'Y', 't']))
  assert.deepEqual(conflictSides(differ.split('\n'), parseConflicts(differ)[0]),
    { base: [], left: ['h', 'X', 't'], right: ['h', 'Y', 't'] })
  assert.equal(canAutoResolve({ base: [], left: ['h', 'X', 't'], right: ['h', 'Y', 't'] }), false)
  assert.deepEqual(resolveConflictsInText(differ, false), { text: differ, resolved: 0, remaining: 1 })
  assert.deepEqual(resolveConflictsInText(differ, true), { text: differ, resolved: 0, remaining: 1 })
  // (2) 两侧写了同一个东西：=-= 但内容相等 ⇒ 插入，自动取那一份（两个口径都合）
  const same = L(...twoWayBlock(['h', 'X', 't'], ['h', 'X', 't']))
  assert.deepEqual(resolveConflictsInText(same, false), { text: L('h', 'X', 't'), resolved: 1, remaining: 0 })
  assert.deepEqual(resolveConflictsInText(same, true), { text: L('h', 'X', 't'), resolved: 1, remaining: 0 })
  // (3) diff3 的基线段**存在但为空**（两侧各自新增文件，`|||||||` 紧跟 `=======`）
  const emptyBaseSection = L('<<<<<<< HEAD', 'h', 'X', 't', '||||||| base', '=======', 'h', 'Y', 't', '>>>>>>> other')
  assert.deepEqual(conflictSides(emptyBaseSection.split('\n'), parseConflicts(emptyBaseSection)[0]),
    { base: [], left: ['h', 'X', 't'], right: ['h', 'Y', 't'] })
  assert.deepEqual(resolveConflictsInText(emptyBaseSection, false), { text: emptyBaseSection, resolved: 0, remaining: 1 })
  // (4) 一侧整块删空、基线又没有 ⇒ 只能取另一侧
  const oursEmpty = L(...twoWayBlock([], ['h', 'Y', 't']))
  assert.deepEqual(resolveConflictsInText(oursEmpty, false), { text: L('h', 'Y', 't'), resolved: 1, remaining: 0 })
  // (5) 算法层：空基线的三种形状
  assert.equal(tryResolveConflict(['X'], [], ['Y']), null)
  assert.deepEqual(tryResolveConflict(['X'], [], ['X']), ['X'])
  assert.deepEqual(tryResolveConflict(['X'], [], []), ['X'])
})

// —— 七、两条不变量（随机输入，确定性种子）：对齐与整份解决都不许产生坏形状 ——

/** 确定性伪随机（mulberry32）：随机判据必须每次给出同一批样本，否则红一次绿一次没意义。 */
function random32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

test('不变量：每个改动片段都非空、不倒挂、不越界，且三侧起点按生成序单调', () => {
  const rnd = random32(20261006)
  const alphabet = ['a', 'b', 'c', 'd', 'e']
  const sample = max => {
    const n = Math.floor(rnd() * (max + 1))
    return Array.from({ length: n }, () => alphabet[Math.floor(rnd() * alphabet.length)])
  }
  const broken = []
  for (let i = 0; i < 500; i++) {
    const left = sample(5), base = sample(5), right = sample(5)
    const ranges = buildMergeRanges(left, base, right)
    let prev = [0, 0, 0]
    for (const range of ranges) {
      for (const side of ['left', 'base', 'right']) {
        const [from, to] = range[side]
        const length = { left, base, right }[side].length
        if (from > to || to > length || from < 0) broken.push(`片段越界/倒挂 ${side}=[${from},${to}) 长度 ${length}`)
      }
      if (isEmptyRange(range)) broken.push('空片段被当成改动段')
      if (range.left[0] < prev[0] || range.base[0] < prev[1] || range.right[0] < prev[2]) broken.push('生成序不单调')
      prev = [range.left[1], range.base[1], range.right[1]]
    }
    // 类型判定与自动解决都不许对合法输入抛（真冲突文件曾在这里 RangeError）
    for (const range of ranges) mergeLineType(range, left, base, right)
    tryResolveConflict(left, base, right)
  }
  assert.deepEqual(broken, [])
})

test('不变量：整份解决后 remaining 等于重解析出来的条数，resolved=0 时文本逐字节不变', () => {
  const rnd = random32(987654321)
  const alphabet = ['p', 'q', 'r', 's', 't']
  const seg = () => {
    const n = Math.floor(rnd() * 4)
    return Array.from({ length: n }, () => alphabet[Math.floor(rnd() * alphabet.length)])
  }
  const problems = []
  for (let i = 0; i < 300; i++) {
    const parts = []
    const blocks = 1 + Math.floor(rnd() * 3)
    for (let b = 0; b < blocks; b++) {
      parts.push('ctx' + b)
      parts.push(...(rnd() < 0.5 ? diff3Block(seg(), seg(), seg()) : twoWayBlock(seg(), seg())))
    }
    parts.push('tail')
    const text = parts.join('\n')
    const total = unresolvedCount(text)
    for (const onlyNonConflicts of [false, true]) {
      const result = resolveConflictsInText(text, onlyNonConflicts)
      const reparsed = unresolvedCount(result.text)
      if (reparsed !== result.remaining) problems.push(`remaining ${result.remaining} 与重解析 ${reparsed} 不一致`)
      if (result.resolved + result.remaining !== total) problems.push(`计数不闭合 ${result.resolved}+${result.remaining} != ${total}`)
      if (!result.resolved && result.text !== text) problems.push('一处都没合掉却改了文本')
    }
  }
  assert.deepEqual(problems, [])
})

// —— 八、两条上游默认（与判词对上，见报告 §3）——

test('上游默认一：无冲突块**不**自动采纳 —— 模型只在被动作调用时改文本，src 里除两个宿主动作外没有第三个入口', () => {
  // 上游每个 TextMergeChange 建出来就是未解决的（`resolved = BooleanArray(2)`，
  // platform/diff-impl/src/com/intellij/diff/merge/TextMergeChange.kt:25），结果栏初始化为**基线**
  // （platform/diff-impl/src/com/intellij/diff/merge/MergeConflictModel.kt:102）⇒ 打开工具不会自己并掉任何东西。
  const srcDir = new URL('../src/', import.meta.url)
  const callers = readdirSync(srcDir)
    .filter(name => /\.ts$/.test(name))
    .filter(name => readFileSync(new URL(name, srcDir), 'utf8').includes('resolveConflictsInText('))
    .sort()
  assert.deepEqual(callers, ['mergeResolve.ts', 'mergeResolveHost.ts'],
    '纯算法自己 + 宿主动作，别的模块不许绕过用户点按钮去改文件')
  // 自动解决是纯函数：同样的输入不产生副作用，也不"顺手"改原文
  const text = L(...diff3Block(['X'], ['b'], ['Y']))
  assert.equal(resolveConflictsInText(text, false).text, text)
})

test('上游默认二：模型侧序号 0 基、给人看的计数 1 基（上游同一处 index 与 index + 1）', () => {
  // 上游 `buildMergeChanges` 用 `mapIndexed` 发序号、`getByIndex` 直接当数组下标用
  // （platform/diff-impl/src/com/intellij/diff/merge/MergeConflictModel.kt:550-552 与 :439-441），
  // 给用户看的进度文案是 `index + 1`（platform/vcs-impl/src/com/intellij/openapi/vcs/merge/MultipleFileMergeDialog.kt:292）。
  const text = L(...diff3Block(['X'], ['b'], ['Y']), 'mid', ...twoWayBlock(['p'], ['q']))
  const conflicts = parseConflicts(text)
  assert.equal(conflicts[0].startLine, 0, '第一条冲突的标记行就是 0 基行号 0')
  assert.equal(conflicts[1].startLine, 8, 'diff3 块 7 行 + 一行 mid ⇒ 第二块的标记在 0 基第 8 行')
  assert.deepEqual([conflictStatus(conflicts, 0), conflictStatus(conflicts, 8)], ['1/2', '2/2'])
  assert.equal(nextConflict(conflicts, 8).startLine, 0, '最后一条之后回绕到 0 基第 0 条')
})
