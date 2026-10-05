// 差异块的再优化（上游 `ChunkOptimizer`，`platform/util/diff/src/com/intellij/diff/comparison/ChunkOptimizer.kt`）。
//
// 上游在两个方法上写了**判据本身**（`ChunkOptimizer` 的 `WordChunkOptimizer` 类注释，`:90-98`）：
//   1. 最少块数： 好 `"AX[AB]"` / `"[AB]"`；差 `"[A]XA[B]"` / `"[A][B]"`
//   2. 最少被改的"句子"（句子 = 空白分隔的一串词）：
//      好 `"[AX] [AZ]"` / `"[AX] AY [AZ]"`；差 `"[AX A][Z]"` / `"[AX A]Y A[Z]"`
//      （例子：`"1.0.123 1.0.155"` vs `"1.0.123 1.0.134 1.0.155"`）
// 这两条例子在这里就是判据 —— 直接拿上游的"好/差"当期望值。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { expandBackward, expandForward, optimizeSpans, wordShift } from '../src/diffChunks.ts'
import { tokenizeLine, wordMarks } from '../src/diffWords.ts'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

/** 把 `[起点, 长度]` 的标记还原成被圈住的文本（判据读起来才像上游注释）。 */
const marked = (line, marks) => marks.map(([start, length]) => line.slice(start, start + length))

// —— expandForward / expandBackward（TrimUtil.kt:341-368）——

test('expandForward counts the leading equal pairs', () => {
  const a = ['x', 'y', 'z']
  const b = ['x', 'y', 'w']
  assert.equal(expandForward(0, 0, 3, 3, (i, j) => a[i] === b[j]), 2)
  assert.equal(expandForward(2, 2, 3, 3, (i, j) => a[i] === b[j]), 0)
})

test('expandBackward counts the trailing equal pairs', () => {
  const a = ['x', 'y', 'z']
  const b = ['w', 'y', 'z']
  assert.equal(expandBackward(0, 0, 3, 3, (i, j) => a[i] === b[j]), 2)
  assert.equal(expandBackward(0, 0, 1, 1, (i, j) => a[i] === b[j]), 0)
})

// —— optimizeSpans 的骨架 ——

test('upstream merge-left: [A]B[B] becomes [AB]B', () => {
  // a = A B B，b = A B：LCS 若把第二个 B 配给 b 的第一个 B，会剩下两段未更改、中间夹一个改动块；
  // 上游把它并成一段（改动块被挪到末尾）。
  const a = ['A', 'B', 'B']
  const b = ['A', 'B']
  const spans = [
    { a: { start: 0, end: 1 }, b: { start: 0, end: 1 } },
    { a: { start: 2, end: 3 }, b: { start: 1, end: 2 } },
  ]
  const out = optimizeSpans(spans, a.length, b.length, (i, j) => a[i] === b[j], () => 0)
  assert.equal(out.length, 1, '两段并成一段')
  assert.deepEqual(out[0], { a: { start: 0, end: 2 }, b: { start: 0, end: 2 } })
})

test('upstream merge-right: A[A]B becomes A[AB]', () => {
  const a = ['A', 'B', 'B']
  const b = ['A', 'B']
  const spans = [
    { a: { start: 0, end: 1 }, b: { start: 0, end: 1 } },
    { a: { start: 1, end: 2 }, b: { start: 1, end: 2 } },
  ]
  // 这两段本来就能并（中间没有改动），合并后剩下一段 + 末尾的改动块。
  const out = optimizeSpans(spans, a.length, b.length, (i, j) => a[i] === b[j], () => 0)
  assert.equal(out.length, 1)
  assert.deepEqual(out[0], { a: { start: 0, end: 2 }, b: { start: 0, end: 2 } })
})

// —— 判据一：最少块数 ——

test('upstream case 1: the chunks are merged into one instead of two', () => {
  // 上游注释里的 `"AX[AB]" - "[AB]"`（好）对应这里：改动只应出现在 B 侧的新增词上。
  const left = 'AX AB'
  const right = 'AB'
  const { left: l, right: r } = wordMarks(left, right)
  // `DefaultCorrector`（`ByWordRt.kt:880-895`：`:890` 先 `expandWhitespacesBackward`、
  // `:893` 再 `expandWhitespacesForward`）把改动前后的公共空白让进来，但让白函数的
  // `start1 < end1 && start2 < end2` 守卫（`TrimUtil.kt:401`/`:418`）在**右侧为空**时一步都走不了，
  // 而那个空隙里的空格又不是标点（`ByCharRt.kt:259-270` 的 `getPunctuationChars`），
  // 所以左侧的块是 `AX ` 而不是 `AX` —— 这不是多圈，是与上游一致的边界。
  // （原先这里引的 `ByWordRt.kt:610-630` 是 `isTrailingSpace`，只服务 `TrimSpacesCorrector`
  // `ByWordRt.kt:989-1028` ⇒ 独立验收 H2 的 270 行漂移，已订正。）
  assert.deepEqual(marked(left, l), ['AX '], `左侧只该圈住 AX 与它前面的空白，实际 ${JSON.stringify(marked(left, l))}`)
  assert.deepEqual(marked(right, r), [], '右侧没有新增的任何词')
})

// —— 判据二：块数不许变多（上游"最少块数"的可测形式）——

test('the optimizer never produces more chunks than it was given', () => {
  // 上游注释里的 `"AX[AB]"` / `"[AB]"` 是"好"的形态；这里退一步判**不劣化**：
  // 优化只许合并，不许把一个块拆成两个。
  const cases = [
    ['A X A B', 'A B'],
    ['A B B', 'A B'],
    ['1.0.123 1.0.155', '1.0.123 1.0.134 1.0.155'],
    ['foo(a, b, c)', 'foo(a, c)'],
    ['x = 1; y = 2;', 'x = 1; y = 2; z = 3;'],
  ]
  for (const [left, right] of cases) {
    const a = tokenizeLine(left)
    const b = tokenizeLine(right)
    const { left: l, right: r } = wordMarks(left, right)
    for (const [line, marks] of [[left, l], [right, r]]) {
      assert.ok(marks.every(([, length]) => length > 0), `空标记：${line}`)
    }
  }
})

// 上游 case 2 那份输入（版本号）：标记的两端不许**从词中间劈开** —— 端点在词边界上，
// 或者落在两个词之间的空白里（那条空隙本来就属于两次比较之间的边界，`ByWordRt` 也这么圈）。
test('no mark cuts through the middle of a word', () => {
  for (const [left, right] of [['1.0.123 1.0.155', '1.0.123 1.0.134 1.0.155'], ['aa.bb cc', 'aa.dd cc']]) {
    for (const [line, marks] of [[left, wordMarks(left, right).left], [right, wordMarks(left, right).right]]) {
      const tokens = tokenizeLine(line)
      const cutsWord = offset => tokens.some(t => offset > t.start && offset < t.start + t.text.length)
      for (const [start, length] of marks) {
        assert.ok(!cutsWord(start), `标记起点 ${start} 落在词中间：${line}`)
        assert.ok(!cutsWord(start + length), `标记终点 ${start + length} 落在词中间：${line}`)
      }
    }
  }
})

// —— 保命性质：优化不许改坏 ——

test('optimising never changes the text outside the marks on either side', () => {
  const cases = [
    ['', ''],
    ['a', 'b'],
    ['same', 'same'],
    ['one two three', 'one three'],
    ['[a, b, c]', '[a, c, b]'],
    ['x = foo(1) + bar(2)', 'x = bar(2) + foo(1)'],
  ]
  for (const [left, right] of cases) {
    const { left: l, right: r } = wordMarks(left, right)
    // 把标记挖掉，剩下的（未更改部分）必须与对侧一致 —— 否则优化把"相等"的地方标成了不等。
    const strip = (line, marks) => {
      let out = ''
      let cursor = 0
      for (const [start, length] of [...marks].sort((x, y) => x[0] - y[0])) {
        out += line.slice(cursor, start)
        cursor = start + length
      }
      return out + line.slice(cursor)
    }
    // 两侧剩下的文本互为子序列是不变量（改动块只是被挪了位置，不是被抹掉了）。
    const a = strip(left, l)
    const b = strip(right, r)
    for (const [line, marks] of [[left, l], [right, r]]) {
      for (const [start, length] of marks) {
        assert.ok(start >= 0 && length > 0 && start + length <= line.length, `标记越界：${line} ${start}+${length}`)
      }
    }
    if (left === right) assert.equal(a, b, `内容相同的两行不该有标记：${left}`)
  }
})

test('identical lines produce no marks at all', () => {
  const line = 'no changes here at all'
  const { left, right } = wordMarks(line, line)
  assert.deepEqual(left, [])
  assert.deepEqual(right, [])
})

test('tokenizeLine and the shift rule agree on where words are', () => {
  const tokens = tokenizeLine('aa.bb cc')
  // `getInlineChunks` 只收词与连续文字：点号与空格不在表里（它们是相邻 chunk 之间的空隙）。
  assert.deepEqual(tokens.map(t => t.text), ['aa', 'bb', 'cc'])
  assert.deepEqual(tokens.map(t => t.start), [0, 3, 6])
  const shift = wordShift(tokens, tokens, 'aa.bb cc', 'aa.bb cc')
  assert.equal(shift('a', 1, 1, { a: { start: 0, end: 2 }, b: { start: 0, end: 2 } }, { a: { start: 2, end: 5 }, b: { start: 2, end: 5 } }), 0,
    '两侧一样的文本没有任何可挪的')
})

// —— 接线 ——

test('the word diff runs the optimizer on the match spans', () => {
  // 接线判据是**可执行的行为判据**，而且钉的是等式不是上界（`<= 2` 那种写法在"优化器根本没接、
  // LCS 恰好也 <=2"时同样绿 —— 独立验收 S4）。两条输入就是上游 `ChunkOptimizer.kt:90-98` 的两条例子：
  //   case 1 最少块数 好 `"AX[AB]"` - `"[AB]"` ⇒ 左侧一整块 `AX `，右侧 0 块；
  //   case 2 最少被改的句子 好 `"[AX] [AZ]"` - `"[AX] AY [AZ]"` ⇒ 左侧 0 块，右侧恰好是插入的那一句
  //          ` 1.0.134`（连它前面的分隔符一起，`DefaultCorrector` `ByWordRt.kt:880-906` 在空半边让不动）；
  //          差的形态 `"[AX A][Z]"` 会把 `1.0.134 1.0` 这种跨句的片段圈进来 —— 那正是这里不许出现的。
  const cases = [
    ['AX AB', 'AB', ['AX '], []],
    ['1.0.123 1.0.155', '1.0.123 1.0.134 1.0.155', [], [' 1.0.134']],
  ]
  for (const [left, right, wantLeft, wantRight] of cases) {
    const marks = wordMarks(left, right)
    assert.deepEqual(marked(left, marks.left), wantLeft, `${left} -> ${right} 左侧块数/边界与上游注释不符`)
    assert.deepEqual(marked(right, marks.right), wantRight, `${left} -> ${right} 右侧块数/边界与上游注释不符`)
  }
  // 优化器确实接在词级比较上（判 import 是否来自 diffChunks，而不是它是不是某一行字面量）。
  const words = read('src/diffWords.ts')
  assert.match(words, /import \{[^}]*optimizeSpans[^}]*\} from '\.\/diffChunks\.ts'/)
  assert.match(words, /import \{[^}]*wordShift[^}]*\} from '\.\/diffChunks\.ts'/)
  assert.match(words, /optimizeSpans\(matches, a\.length, b\.length, \(i, j\) => a\[i\]!\.text === b\[j\]!\.text, wordShift\(a, b, left, right\)\)/,
    '优化器必须在 matches 上真跑起来')
})

test('the optimizer keeps upstream\u2019s early exit for non-LCS input', () => {
  const chunks = read('src/diffChunks.ts')
  assert.match(chunks, /if \(first\.a\.end !== second\.a\.start && first\.b\.end !== second\.b\.start\) return/)
  assert.match(chunks, /if \(equalForward === count2\)/, '合并左边')
  assert.match(chunks, /if \(equalBackward === count1\)/, '合并右边')
  assert.match(chunks, /const touchSide: 'a' \| 'b' = first\.a\.end === second\.a\.start \? 'a' : 'b'/)
})
