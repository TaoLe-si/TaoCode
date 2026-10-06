// 折叠命令族的判据（B4 = `codeInsight/folding`，判决 `docs/inventory/verdict-folding.md`）。
// 盯着三件事：① 纯逻辑（层级 / 最内层 / 子树 / 文档注释 / 到级别）与上游语义一致；
// ② 命令表与键位照上游那套（`$default.xml` 逐条核过，键位表抄在判决 §A）；
// ③ 菜单落点是 Code 菜单里的 `FoldingGroup`（上游 `LangActions.xml:270-303`），文案逐字取 ActionsBundle。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { codeFolding, foldEffect, foldedRanges, foldable } from '@codemirror/language'
import { keymap, runScopeHandlers } from '@codemirror/view'
import { javascript } from '@codemirror/lang-javascript'
import { EditorState } from '@codemirror/state'
import { blockAt, blockFoldPlan, blockRanges, commentRanges, depthOf, docCommentRanges, enclosingAreas, foldingRanges,
  innermostAt, isDocCommentLine,
  levelPlan, lspFoldService, nestedWithin,
  rootAtLine, setFoldingRanges, areaStartingAtLine, areasContaining, collapseTarget, expandTarget, toggleTarget,
  recursiveScope } from '../src/editorFolding.ts'
import { editingCommands } from '../src/editorCommands.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

// 一棵三层嵌套的树：A ⊃ B ⊃ C，另有一条注释区间与一条 imports 区间。
const ranges = [
  { startLine: 0, endLine: 20 },                    // A（深度 1）
  { startLine: 1, endLine: 10 },                    // B（深度 2）
  { startLine: 2, endLine: 5 },                     // C（深度 3）
  { startLine: 7, endLine: 9 },                     // D（深度 3，B 的另一个孩子）
  { startLine: 22, endLine: 24, kind: 'comment' },  // 注释
  { startLine: 26, endLine: 28, kind: 'imports' },  // imports
]

test('层级：祖先条数 + 1（上游 createFoldTreeIterator 的层数）', () => {
  assert.equal(depthOf(ranges, ranges[0]), 1)
  assert.equal(depthOf(ranges, ranges[1]), 2)
  assert.equal(depthOf(ranges, ranges[2]), 3)
  assert.equal(depthOf(ranges, ranges[3]), 3)
})

test('最内层：光标行所在的最内区间（相等起点的取后者，与 findFoldRegionsAtOffset 的"第一个"一致）', () => {
  assert.equal(innermostAt(ranges, 3), ranges[2], '第 3 行落在 C 里')
  assert.equal(innermostAt(ranges, 8), ranges[3], '第 8 行落在 D 里')
  assert.equal(innermostAt(ranges, 15), ranges[0], '第 15 行只落在 A 里')
  assert.equal(innermostAt(ranges, 100), null, '区间外没有')
})

test('子树：严格套在里面的那些（递归收起/展开要动的集合）', () => {
  assert.deepEqual(nestedWithin(ranges, ranges[0]), [ranges[1], ranges[2], ranges[3]])
  assert.deepEqual(nestedWithin(ranges, ranges[1]), [ranges[2], ranges[3]])
  assert.deepEqual(nestedWithin(ranges, ranges[2]), [])
})

test('折叠代码块：跳过 comment / imports（上游找的是语言块）', () => {
  assert.equal(blockAt(ranges, 3), ranges[2])
  assert.equal(blockAt(ranges, 23), null, '注释区间不是"代码块"')
  assert.equal(blockAt(ranges, 27), null, 'imports 区间不是"代码块"')
})

test('文档注释那一组只挑 kind=comment 的区间', () => {
  assert.deepEqual(commentRanges(ranges), [ranges[4]])
})

// 2026-10-04 本轮：收起/展开文档注释要**只动文档注释**（上游 CollapseExpandDocCommentsHandler
// 靠 `PsiDocCommentBase` / `CodeDocumentationAwareCommenter` 的 doc 记号区分；本仓按起始行记号的词法判定）。
test('文档注释判定：/** 与 Python 三引号算，普通注释不算', () => {
  assert.equal(isDocCommentLine('/** 说明 */'), true, 'Javadoc/JSDoc')
  assert.equal(isDocCommentLine('  /**'), true, '缩进后的 Javadoc 开头')
  assert.equal(isDocCommentLine('/**/'), false, '空的单行注释不是文档注释')
  assert.equal(isDocCommentLine('/* 普通块注释 */'), false, '普通块注释不算')
  assert.equal(isDocCommentLine('// TODO'), false, '行注释不算')
  assert.equal(isDocCommentLine('"""docstring 开头'), true, 'Python 文档字符串')
  assert.equal(isDocCommentLine("'''docstring 开头"), true, 'Python 文档字符串（单引号）')
  assert.equal(isDocCommentLine('x = 1'), false, '代码行不算')
})

test('文档注释区间：起始行不是 doc 记号的 comment 区间被排除', () => {
  const lines = ['/** 文档 */', 'int a = 1;', '// 普通注释', '/* 普通块 */', '"""文档字符串']
  const all = [
    { startLine: 0, endLine: 2, kind: 'comment' },   // 文档注释 → 选中
    { startLine: 2, endLine: 3, kind: 'comment' },   // 行注释 → 排除
    { startLine: 3, endLine: 4, kind: 'comment' },   // 普通块注释 → 排除
    { startLine: 4, endLine: 6, kind: 'comment' },   // Python docstring → 选中
    { startLine: 1, endLine: 3, kind: 'imports' },   // 不是注释 → 排除
  ]
  assert.deepEqual(docCommentRanges(lines, all), [all[0], all[3]])
  assert.deepEqual(docCommentRanges(lines, []), [])
})

test('fold.docs 命令：只折文档注释那条区间（普通注释保持展开）', () => {
  const doc = ['/** 文档 */', 'class A {', '  // 普通注释', '  int a = 1;', '}', '"""docstring'].join('\n')
  const base = EditorState.create({ doc, extensions: [codeFolding(), foldingRanges, lspFoldService] })
  const placed = base.update({ effects: setFoldingRanges.of([
    { startLine: 0, endLine: 2, kind: 'comment' },
    { startLine: 2, endLine: 3, kind: 'comment' },
  ]) }).state
  let after = placed
  const folded = editingCommands['fold.docs']({ state: placed, dispatch: spec => { after = placed.update(spec).state } })
  assert.equal(folded, true, '有文档注释时命令要生效')
  const spans = []
  for (const iterator = foldedRanges(after).iter(); iterator.value; iterator.next()) spans.push([iterator.from, iterator.to])
  assert.deepEqual(spans, [[after.doc.line(1).from, after.doc.line(3).to]],
    '折起来的只有文档注释那一块（第 1–3 行），普通注释那块不动')
  // 再按一次 unfold.docs：文档注释那块展开，普通注释始终没被碰过。
  let restored = after
  const unfolded = editingCommands['unfold.docs']({ state: after, dispatch: spec => { restored = after.update(spec).state } })
  assert.equal(unfolded, true, '展开文档注释要有实际动作')
  const left = []
  for (const iterator = foldedRanges(restored).iter(); iterator.value; iterator.next()) left.push([iterator.from, iterator.to])
  assert.deepEqual(left, [], '展开后没有残留折叠')
})

test('展开到第 N 层：比 N 浅的展开、正好第 N 层的折起、更深的原样不动（BaseExpandToLevelAction:64-69）', () => {
  // 根 = B：相对层级 B=0、C/D=1 ⇒ 展开 B、折起 C/D。
  assert.deepEqual(levelPlan(ranges, ranges[1], 1).expand, [ranges[1]])
  assert.deepEqual(levelPlan(ranges, ranges[1], 1).collapse, [ranges[2], ranges[3]])
  // 根 = A：A=0、B=1、C/D=2 ⇒ 展开 A、折起 B，C/D 不许动（上游对更深的层什么都不做）。
  assert.deepEqual(levelPlan(ranges, ranges[0], 1).expand, [ranges[0]])
  assert.deepEqual(levelPlan(ranges, ranges[0], 1).collapse, [ranges[1]])
  assert.deepEqual(levelPlan(ranges, ranges[0], 2).collapse, [ranges[2], ranges[3]])
  assert.deepEqual(levelPlan(ranges, ranges[0], 5).collapse, [])
  // 第 5 层：作用域里全部展开（含根自己）。
  assert.deepEqual(levelPlan(ranges, ranges[1], 5).expand, [ranges[1], ranges[2], ranges[3]])
  // 「全部展开到第 N 层」：根按文件顶层算 ⇒ 顶层（A / 注释 / imports）相对层级 0。
  assert.deepEqual(levelPlan(ranges, null, 1).expand, [ranges[0], ranges[4], ranges[5]])
  assert.deepEqual(levelPlan(ranges, null, 1).collapse, [ranges[1]])
})

test('挑根：起始行正好是光标行的那条，认不出（没有 / 不止一条）才退回最内层', () => {
  assert.equal(rootAtLine(ranges, 1), ranges[1], '第 1 行同时是 A 与 B 的起点 ⇒ 认不出，退回最内层 B')
  assert.equal(rootAtLine(ranges, 2), ranges[2], '第 2 行是 C 的起点，也只有 C')
  assert.equal(rootAtLine(ranges, 8), ranges[3])
  assert.equal(rootAtLine(ranges, 15), ranges[0], '第 15 行谁都不从这里起 ⇒ 最内层 A')
  assert.equal(rootAtLine(ranges, 100), null)
})

// ── 区域层：逐个动作怎么挑目标（上游那几条 action 的挑法） ────────────────────────────────
// 一棵 A ⊃ B ⊃ C 的区域树（偏移） + 一条与 B 无关的 D，另配一组"已经折着"的区间。
const A = { from: 0, to: 300, auto: true }
const B = { from: 20, to: 200, auto: true }
const C = { from: 40, to: 100, auto: true }
const D = { from: 220, to: 260, auto: false }   // 手工折的那条（Ctrl+. 建的）
const areas = [A, B, C, D]
const bounds = area => ({ from: area.from, to: area.to })

test('起始行那条：只有一条才算（上游多于一條就返回 null ⇒ 退回最内层那条）', () => {
  // 光标行 [20,39)：只有 B 从这里起。
  assert.equal(areaStartingAtLine(areas, 20, 39)?.from, B.from)
  // 光标行 [0,19)：只有 A 从这里起。
  assert.equal(areaStartingAtLine(areas, 0, 19)?.from, A.from)
  // 同一行里两条起点（B 与 C 都起在第 40 行附近）⇒ 认不出。
  assert.equal(areaStartingAtLine(areas, 20, 120), null)
  // 认不出时的退路：光标处最内层那条照样落在同一块上。
  assert.equal(collapseTarget(areas, [], 50, 20, 120), C)
})

test('光标处套着的区域按最内层在前排（上游 BY_START_OFFSET 降序）', () => {
  assert.deepEqual(areasContaining(areas, 50).map(area => area.from), [C.from, B.from, A.from])
  assert.deepEqual(areasContaining(areas, 230).map(area => area.from), [D.from, A.from])
  assert.deepEqual(areasContaining(areas, 1000), [])
})

test('收起：先看起始行那条（还展开着就用它），否则光标处最内层没折的那条', () => {
  // 光标在 B 的起始行里，B 还没折 ⇒ 折 B。
  assert.equal(collapseTarget(areas, [], 50, 20, 39), B)
  // B 已经折着 ⇒ 起始行那条用不了，退到光标处最内层未折的：C 折着、B 折着 ⇒ 只剩 A。
  assert.equal(collapseTarget(areas, [bounds(B), bounds(C)], 50, 20, 39), A)
  // 光标在 D 里（手工那条）⇒ 折 D。
  assert.equal(collapseTarget(areas, [], 230, 220, 260), D)
})

test('展开：先看起始行那条（折着才是它），否则光标处**最外层**折着的那条', () => {
  // 光标在 C 的起始行、C 折着 ⇒ 展开 C（尽管 A/B 也折着）。
  assert.equal(expandTarget(areas, [bounds(A), bounds(B), bounds(C)], 45, 40, 60), C)
  // 光标在 B 的第 2 行改不了起始行那条 ⇒ 跳到最外层折着的 A。
  assert.equal(expandTarget(areas, [bounds(A), bounds(B)], 50, 45, 46), A)
  // 一条都没折 ⇒ 没目标。
  assert.equal(expandTarget(areas, [], 50, 45, 46), null)
})

test('切换：起始行那条优先，否则光标处最内层（ExpandCollapseToggleAction:17-25）', () => {
  assert.equal(toggleTarget(areas, [], 50, 20, 39), B)
  assert.equal(toggleTarget(areas, [], 50, 45, 46), C)
  assert.equal(toggleTarget(areas, [], 1000, 1000, 1010), null)
})

// ── 折叠代码块：沿块往外爬那一套（`CollapseBlockHandlerImpl.invoke:19-76`） ────────────────
// `areas` 按**最内层在前**给（生产里是 `areasContaining(blocks, pos)`，与上游沿 `findParentBlock`
// 往外爬的顺序一致，见 `FoldingUtil.getFoldRegionsAtOffset:56` 的 BY_START_OFFSET 降序）。
const insideC = { from: 30, to: 60, auto: false }     // 跨过 C 起点的一条手工折痕
const acrossB = { from: 50, to: 250, auto: false }    // 跨过 B **尾端**的那条（B.from 在它外面、B.to 在它里面）
const endsAtBStart = { from: 5, to: 20, auto: false }    // 尾端正好**搭**在 B 起点上的一条（containsStrict 两端都不含）

test('折叠代码块：折光标处最内层那块，并把光标放到它末尾（:44-47、:55-63、:75）', () => {
  assert.deepEqual(blockFoldPlan([C, B, A], [], 50), { from: C.from, to: C.to, caret: C.to, collapse: true })
  // 光标压在块的起止那一列上**也算**这一块：`range.containsOffset(offset)` 含端点
  //（`CollapseBlockHandlerImpl.java:36` + `TextRange.java:121-123`）。
  assert.deepEqual(blockFoldPlan([C, B, A], [], C.to), { from: C.from, to: C.to, caret: C.to, collapse: true })
  // 光标落在 B 与 C 之间（C 外面）⇒ C 不含光标，跳过它折 B（`:36-39` 那一支的 continue）。
  assert.deepEqual(blockFoldPlan([C, B, A], [], 150), { from: B.from, to: B.to, caret: B.to, collapse: true })
})

test('折叠代码块：那块已经折着就往外爬一层（:48-52 记 previous、:44 折已有的展开区域）', () => {
  // C 折着 ⇒ 折父块 B（上游 C 是"已折的区域"、B 是"展开着的区域" ⇒ `setExpanded(false)` 落在 B 上）。
  assert.deepEqual(blockFoldPlan([C, B, A], [bounds(C)], 50), { from: B.from, to: B.to, caret: B.to, collapse: true })
  // C 与 B 都折着 ⇒ 折 A。
  assert.deepEqual(blockFoldPlan([C, B, A], [bounds(C), bounds(B)], 50),
    { from: A.from, to: A.to, caret: A.to, collapse: true })
})

test('折叠代码块：爬到顶全是折着的就只挪光标，不再叠一条（:66-73 的 previous 那一支）', () => {
  const plan = blockFoldPlan([C, B, A], [bounds(C), bounds(B), bounds(A)], 50)
  assert.deepEqual(plan, { from: A.from, to: A.to, caret: A.to, collapse: false },
    '上游这一段 `previous.setExpanded(false)` 对已折着的是空操作，可见效果只有 :75 的 moveToOffset')
  // 一条都不含光标 ⇒ 没目标（上游 :30 `element == null` 就 return）。
  assert.equal(blockFoldPlan([C, B, A], [bounds(A)], 1000), null)
})

test('折叠代码块：有折痕跨过这块的边界就不许新建（:54 intersectsRegion + :64 break）', () => {
  // `FoldRegionsCache.java:268-275`：某条区域严格含住两端**之一**就算搭界。
  assert.deepEqual(blockFoldPlan([C, B, A], [], 50).from, C.from, '没有那条手工折痕时折 C')
  assert.equal(blockFoldPlan([C, B, A], [insideC], 50), null, 'C 的起点被跨住 ⇒ 停，且前面没记 previous')
  // C 自己已经折着（不需要新建，也就谈不上搭界）⇒ 往外一层；B 的**尾**被跨住 ⇒ 停在这里，
  // 落到 :66-73 那一支：不折，只把光标放到记下的那条 previous（= C）末尾。
  assert.deepEqual(blockFoldPlan([C, B, A], [bounds(C), acrossB], 50),
    { from: C.from, to: C.to, caret: C.to, collapse: false })
  // 跨界的那条只搭着 B 的起点一端（`containsStrict` 两端都不含）⇒ 不算搭界，B 可以折。
  assert.deepEqual(blockFoldPlan([C, B, A], [bounds(C), endsAtBStart], 50),
    { from: B.from, to: B.to, caret: B.to, collapse: true })
})

test('blockRanges：注释 / imports / region 那一三族不算"代码块"（CollapseBlockAction 找的是语言块）', () => {
  const kinds = [
    { startLine: 0, endLine: 5 },
    { startLine: 1, endLine: 3, kind: 'comment' },
    { startLine: 6, endLine: 8, kind: 'imports' },
    { startLine: 9, endLine: 12, kind: 'region' },
  ]
  assert.deepEqual(blockRanges(kinds), [kinds[0]])
  assert.equal(blockAt(kinds, 2), kinds[0], '行 2 上只有那条不带 kind 的块')
  assert.equal(blockAt(kinds, 7), null, 'imports 区间不是代码块')
})

// 端到端：命令层确实按上面那套走，并且**真的把光标挪了**（判据看的是最后那份 state）。
const BLOCK_DOC = ['function outer() {', '  function inner() {', '    return 1', '  }', '  return 2', '}'].join('\n')
const BLOCK_RANGES = [{ startLine: 0, endLine: 5 }, { startLine: 1, endLine: 3 }]

const blockState = (caret, folded, withRanges = BLOCK_RANGES) => {
  const placed = EditorState.create({ doc: BLOCK_DOC, selection: { anchor: caret },
    extensions: [codeFolding(), foldingRanges, lspFoldService] })
    .update({ effects: setFoldingRanges.of(withRanges) })
  return folded.length ? placed.update({ effects: folded.map(bounds => foldEffect.of(bounds)) }).state : placed.state
}
const blockSpans = state => {
  const out = []
  for (const iterator = foldedRanges(state).iter(); iterator.value; iterator.next()) out.push([iterator.from, iterator.to])
  return out
}
/** 跑一次 fold.block，返回（新状态, 命令返回值）。view.state 要是**活的**：命令折完还会另发一笔挪光标。 */
const pressBlock = state => {
  let next = state
  const view = { get state() { return next }, dispatch: spec => { next = next.update(spec).state } }
  const done = editingCommands['fold.block'](view)
  return { next, done }
}

test('fold.block 端到端：折最内层那块，光标落到它末尾（CollapseBlockHandlerImpl:44-47、:75）', () => {
  const doc = EditorState.create({ doc: BLOCK_DOC }).doc
  const inner = { from: doc.line(2).from, to: doc.line(4).to }       // 服务端给的那块（第 2–4 行）
  const caretIn = doc.line(3).from + 2                                // 光标在第 3 行（return 1）里
  const { next, done } = pressBlock(blockState(caretIn, []))
  assert.equal(done, true)
  assert.deepEqual(blockSpans(next), [[inner.from, inner.to]], '折的是最内层那一块')
  assert.equal(next.selection.main.head, inner.to, '光标落到这块的末尾（上游 :46 的 existing.getEndOffset()）')
})

test('fold.block 端到端：再按一次往外折一层；第三次只挪光标', () => {
  const doc = EditorState.create({ doc: BLOCK_DOC }).doc
  const inner = { from: doc.line(2).from, to: doc.line(4).to }
  const outer = { from: doc.line(1).from, to: doc.line(6).to }
  const caretIn = doc.line(3).from + 2
  const first = pressBlock(blockState(caretIn, [])).next
  const second = pressBlock(first).next
  assert.deepEqual(blockSpans(second), [[outer.from, outer.to], [inner.from, inner.to]],
    '第一层折完再按 ⇒ 外层也折上（上游 :48-52 记 previous、:44 折展开着的父块）')
  assert.equal(second.selection.main.head, outer.to, '光标跟着落到外层的末尾')
  const third = pressBlock(second)
  assert.equal(third.done, true, '三条全折着仍然做事（挪光标）')
  assert.deepEqual(blockSpans(third.next), blockSpans(second), '不许叠第四条折痕')
  assert.equal(third.next.selection.main.head, outer.to, '光标停在外层末尾（:72 的 previous.getEndOffset()）')
})

test('折叠代码块的退路仍然走语法树（没接语言服务的文件）', () => {
  const folding = read('src/editorFolding.ts')
  // 服务端一条区间都没给时，候选链 = 光标行那块 + 祖先链（`enclosingAreas`），
  // 而且这条链现在**整条**参与往外爬（旧版只取最内层那一条）。
  assert.match(folding, /syntaxArea\(view\.state, pos\) \?\? enclosingAreas\(view\.state, pos\)\[0\]/,
    '光标行那块优先，摸不到才用祖先链的第一条')
  assert.match(folding, /for \(const area of enclosingAreas\(view\.state, pos\)\)/, '祖先链整条都是候选')
  assert.match(folding, /const plan = blockFoldPlan\(areasContaining\(blocks, pos\), foldedBounds\(view\.state\), pos\)/,
    '目标与光标落点由 blockFoldPlan 定')
})

test('递归：根 + 套在里面的全部；收起时根已折着就换成光标处展开的那条（BaseFoldingHandler:61-76）', () => {
  assert.deepEqual(recursiveScope(areas, [], 50, 20, 39, true), [B, C])
  assert.deepEqual(recursiveScope(areas, [], 250, 220, 260, false), [D])
  // 收起且起始行那条（B）已经折着 ⇒ 换成光标处展开态的那条：C 折着、B 折着 ⇒ A（D 也套在 A 里，一并算上）。
  assert.deepEqual(recursiveScope(areas, [bounds(B), bounds(C)], 50, 20, 39, true), [A, B, C, D])
  assert.deepEqual(recursiveScope(areas, [], 1000, 1000, 1010, true), [])
})

test('命令表：上游那一族的名字都在，且都真的指向折叠命令', () => {
  for (const name of ['fold', 'unfold', 'foldAll', 'unfoldAll', 'fold.recursively', 'unfold.recursively',
    'fold.toggle', 'fold.block', 'fold.selection', 'fold.docs', 'unfold.docs',
    'unfold.level1', 'unfold.all.level1', 'unfold.level5', 'unfold.all.level5']) {
    assert.ok(name in editingCommands, `命令表缺 ${name}`)
    assert.equal(typeof editingCommands[name], 'function', `${name} 不是命令`)
  }
})

// 键位的光靠字符串比对不够：得按**浏览器真实报出来的键名**验一遍。
// `w3c-keyname` 按 keyCode 查表（109/189 → '-'、107/187 → '='、106 → '*'），数字键盘与主键区算同一个名字，
// Shift 变体会先命中不带 Shift 的那条 —— 所以下面既验"按得出来"，也把**分不开的那几条**钉住。
test('键位在浏览器的键名规则下真的对得上（用 CodeMirror 的匹配器验）', () => {
  const editor = read('src/components/CodeEditor.vue')
  const block = editor.slice(editor.indexOf("{ key: 'Ctrl--', preventDefault: true, run: editingCommands.fold! }"),
    editor.indexOf("{ key: 'Alt-Shift-Insert'"))
  const entries = [...block.matchAll(/\{ key: '([^']+)', preventDefault: true, run: editingCommands(?:\.([A-Za-z.]+)|\['([^']+)'\])! \}/g)]
    .map(m => ({ key: m[1], command: m[2] || m[3] }))
  assert.equal(entries.length, 9, `折叠键位应有 9 条，实际 ${entries.length}`)
  // 注释里会拿 `Ctrl-NumPad-` 当反例讲，所以只看**真的写进 keymap 的那些键**。
  const written = [...editor.matchAll(/\{ key: '([^']+)', preventDefault:/g)].map(m => m[1])
  assert.ok(!written.some(key => /NumPad|Numpad/.test(key)), '不许写 NumPad 这种 CodeMirror 匹配不到的键名（它只当后缀名，永远不命中）')

  let hits = []
  const bindings = entries.map(entry => ({ key: entry.key, run: () => { hits.push(entry.command); return true } }))
  const state = EditorState.create({ doc: 'a' + String.fromCharCode(10) + 'b', extensions: [keymap.of(bindings)] })
  const press = shape => {
    hits = []
    runScopeHandlers({ state }, { preventDefault() {}, stopPropagation() {}, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...shape }, 'editor')
    return hits.join(',')
  }
  const at = (key, keyCode, mods) => ({ key, keyCode, ...mods })
  // 主键区：$default.xml 的 MINUS/EQUALS/PERIOD/MULTIPLY 那一套。
  assert.equal(press(at('-', 189, { ctrlKey: true })), 'fold', 'Ctrl+-')
  assert.equal(press(at('=', 187, { ctrlKey: true })), 'unfold', 'Ctrl+=')
  assert.equal(press(at('_', 189, { ctrlKey: true, shiftKey: true })), 'foldAll', 'Ctrl+Shift+-（浏览器报 _，走 Shift 回退匹配）')
  assert.equal(press(at('+', 187, { ctrlKey: true, shiftKey: true })), 'unfoldAll', 'Ctrl+Shift+=')
  assert.equal(press(at('-', 189, { ctrlKey: true, altKey: true })), 'fold.recursively', 'Ctrl+Alt+-')
  assert.equal(press(at('=', 187, { ctrlKey: true, altKey: true })), 'unfold.recursively', 'Ctrl+Alt+=')
  assert.equal(press(at('.', 190, { ctrlKey: true })), 'fold.selection', 'Ctrl+.')
  assert.equal(press(at('>', 190, { ctrlKey: true, shiftKey: true })), 'fold.block', 'Ctrl+Shift+.')
  assert.equal(press(at('*', 106, { ctrlKey: true })), 'unfold.level1', 'Ctrl+*（数字键盘乘号）')
  // 数字键盘的加减号与主键区同名 ⇒ 主键区那一条就覆盖了（上游 $default.xml 的 SUBTRACT）。
  assert.equal(press(at('-', 109, { ctrlKey: true })), 'fold', 'Ctrl+数字键盘减号 = 主键区减号')
  // 分不开、也不硬凑的三条（判决 §A 登记）：数字键盘 ± 不随 Shift 改名，会先命中不带 Shift 的那条。
  assert.equal(press(at('-', 109, { ctrlKey: true, shiftKey: true })), 'fold', 'Ctrl+Shift+数字键盘减号只能给收起')
  assert.equal(press(at('+', 107, { ctrlKey: true })), '', '数字键盘加号没有可靠写法')
  assert.equal(press(at('*', 106, { ctrlKey: true, shiftKey: true })), 'unfold.level1', 'Ctrl+Shift+数字键盘乘号只能给展开到级别 1')
})

test('键位照 $default.xml（级别那一条只绑到 1）', () => {
  const editor = read('src/components/CodeEditor.vue')
  // 折叠键位必须在**常驻** keymap 里（`onMounted` 那个数组，含 `Mod-slash` 那一段），
  // 不能挂在 `lspExtensions()` 上 —— 未接语言服务的文件也要能折叠（真机上踩过）。
  const alwaysOn = editor.slice(editor.indexOf("keymap.of([{ key: 'Mod-s'"), editor.indexOf('Alt-Shift-Insert'))
  const lspPart = editor.slice(editor.indexOf('function lspExtensions()'), editor.indexOf('onMounted('))
  assert.ok(alwaysOn.includes("key: 'Ctrl--'") && alwaysOn.includes("key: 'Ctrl-*'"), '常驻 keymap 里要有折叠这一族')
  assert.ok(!lspPart.includes("key: 'Ctrl--'"), 'lspExtensions() 里不该有折叠键位')
  // 名字带点的写 `editingCommands['x']`，简单名字写 `editingCommands.x`（与源码一致）。
  const pairs = [
    ['Ctrl--', 'editingCommands.fold'], ['Ctrl-=', 'editingCommands.unfold'],
    ['Ctrl-Alt--', "editingCommands['fold.recursively']"], ['Ctrl-Alt-=', "editingCommands['unfold.recursively']"],
    ['Ctrl-Shift--', 'editingCommands.foldAll'], ['Ctrl-Shift-=', 'editingCommands.unfoldAll'],
    ['Ctrl-.', "editingCommands['fold.selection']"], ['Ctrl-Shift-.', "editingCommands['fold.block']"],
    ['Ctrl-*', "editingCommands['unfold.level1']"],
  ]
  for (const [key, run] of pairs) {
    assert.ok(editor.includes(`{ key: '${key}', preventDefault: true, run: ${run}`), `缺键位 ${key} → ${run}`)
  }
})

test('菜单：Code 菜单里的「折叠」子菜单照 FoldingGroup 的顺序与文案', () => {
  const code = read('src/menus/codeMenu.ts')
  const group = code.slice(code.indexOf("id: 'code.folding'"))
  const order = ["'unfold'", "'unfold.recursively'", "'unfoldAll'", "'fold'", "'fold.recursively'", "'foldAll'",
    "'code.folding.caretLevels'", "'code.folding.allLevels'", "'unfold.docs'", "'fold.docs'",
    "'fold.toggle'", "'fold.selection'", "'fold.block'"]
  let last = -1
  for (const name of order) {
    const at = group.indexOf(name)
    assert.ok(at > last, `折叠子菜单里 ${name} 的位置不对（应在上一个之后）`)
    last = at
  }
  for (const text of ['展开', '递归展开', '全部展开', '收起', '递归收起', '全部收起', '展开到级别(_E)',
    '全部展开到级别(_L)', '展开文档注释(_D)', '收起文档注释(_O)', '切换折叠', '折叠选区/移除区域(_S)', '折叠代码块(_B)']) {
    assert.ok(group.includes(`'${text}'`), `缺文案「${text}」（ActionsBundle 原文）`)
  }
  const edit = read('src/menus/editMenu.ts')
  assert.ok(!edit.includes("ctx.editable('foldAll'"), '折叠这一族不在编辑菜单里（上游在 Code 菜单的 FoldingGroup）')
  assert.ok(!edit.includes('全部折叠'), '「全部折叠」不是包里的字（上游是「全部收起」）')
})

test('收起/展开走的是上游那两个动作（不是 CodeMirror 自带的 foldCode/unfoldCode）', () => {
  const commands = read('src/editorCommands.ts')
  assert.match(commands, /fold: foldAtCaret, unfold: unfoldAtCaret/, '命令表的收起/展开要指向上游语义那两条')
  assert.ok(!/fold: foldCode/.test(commands), '收起不能再用 CodeMirror 自带的 foldCode')
  const module = read('src/editorFolding.ts')
  // 服务端没给区间时靠**语法树候选**顶（`foldable` 是 foldService + 语法树两段合一的入口），
  // 不能再退回 `foldCode`/`unfoldCode` —— 那两条只看光标行，挑不到 LSP 区间。
  // 只要求"从 @codemirror/language 里 import 了 foldable 与 foldedRanges"，不要求它们排在行首 ——
  // 2026-10-04 往这条 import 里加 `ensureSyntaxTree` 时，原先 `/import \{ foldable, foldedRanges/`
  // 的写法被顺带打断过一次（判据不该锁死同一行里的相邻顺序）。
  assert.match(module, /import \{[^}]*\bfoldable\b[^}]*\bfoldedRanges\b[^}]*\} from '@codemirror\/language'/, '区域层要用 foldable 拿候选')
  assert.ok(!/foldCode\(|unfoldCode\(/.test(module), '模块里不该再出现 foldCode/unfoldCode')
  // 折叠代码块在没有服务端区间时也要能落到"光标套在里面的块"（真机上光标在 return a 里按 Ctrl+Shift+. 修过一次）。
  assert.match(module, /syntaxArea\(view\.state, pos\) \?\? enclosingAreas\(view\.state, pos\)\[0\]/, '折叠代码块的退路要用祖先链')
  // 早先排查键位用的调试钩子必须已经拆掉（真机上留过 `window.__foldDebug`）。
  assert.ok(!module.includes('__foldDebug'), '调试脚手架不许留在源码里')
})

test('服务端的区间真的接到了 CodeMirror 的折叠服务上（不用 DOM 也能验）', () => {
  const doc = ['export function demo() {', '  const a = 1', '  if (a < b) {', '    return a', '  }', '  return b', '}', '', '// tail'].join('\n')
  const base = EditorState.create({ doc, extensions: [lspFoldService, foldingRanges] })
  const line = number => base.doc.line(number)
  assert.equal(foldable(base, line(3).from, line(3).to), null, '服务端还没给区间时折不了（语法树里 this 文件没有语言）')
  const withRanges = base.update({ effects: setFoldingRanges.of([{ startLine: 2, endLine: 4 }]) }).state
  // 第 3 行（`if (a < b) {`）的折叠候选 = 服务端给的整块（第 3 行行首 → 第 5 行行尾）。
  assert.deepEqual(foldable(withRanges, withRanges.doc.line(3).from, withRanges.doc.line(3).to),
    { from: withRanges.doc.line(3).from, to: withRanges.doc.line(5).to })
  // 文档一改，旧区间（行号对不上了）必须立刻作废。
  const edited = withRanges.update({ changes: { from: 0, insert: '\n' } }).state
  assert.equal(foldable(edited, edited.doc.line(4).from, edited.doc.line(4).to), null, '改过文档后旧区间要作废')
})

// 光标在块**中间**时，服务端不给区间的话只有语法树祖先链能摸到外层块（真机上踩过：
// 光标放在 `return a` 上按 Ctrl+- 一动不动 ⇒ 补了 enclosingAreas）。
test('套在外面的语法块按最内层往外排（enclosingAreas）', () => {
  const doc = ['export function outer() {', '  const a = 1', '  if (a < b) {', '    while (a) {', '      return a', '    }', '  }', '  return b', '}'].join('\n')
  const state = EditorState.create({ doc, extensions: [javascript({ typescript: true })] })
  const found = enclosingAreas(state, state.doc.line(5).from + 6)   // 光标落在 `return a` 里
  assert.equal(found.length, 3, `祖先链上应有 while / if / function 三层，实际 ${found.length}`)
  // 折的区间是**花括号里头**（`foldInside` 的边界：跳过 `{` 与 `}` 本身），从最内层往外排。
  assert.deepEqual(found.map(area => doc.slice(area.from, area.to)), [
    '\n      return a\n    ',
    '\n    while (a) {\n      return a\n    }\n  ',
    '\n  const a = 1\n  if (a < b) {\n    while (a) {\n      return a\n    }\n  }\n  return b\n',
  ])
  assert.ok(found.every(area => area.auto), '语法树来的都算自动生成')
  // 光标在文件顶层（函数外）时没有祖先块可折。
  assert.deepEqual(enclosingAreas(state, state.doc.length), [])
})
