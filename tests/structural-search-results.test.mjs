// 结构化搜索的**匹配结果模型**（`src/structuralSearchResults.ts`）——判词 `ss/matcher` 的
// 「匹配结果模型（`MatchResult`/`MatchResultSink`/`DuplicateFilteringResultSink`）」那条待办的落点。
//
// 上游依据：
//   · `platform/structuralsearch/source/com/intellij/structuralsearch/MatchResult.java:11-32`
//     （`getMatchImage()` / `getStart()` / `getEnd()` / `getName()` / `isTarget()`）；
//   · `platform/structuralsearch/source/com/intellij/structuralsearch/plugin/util/DuplicateFilteringResultSink.java:18-46`
//     （`newMatch` 里同一个 `getMatchRef()` 第二次上报就丢，`matchingFinished()` 清空）。
// 本仓没有语法树，"每个变量匹配到了什么"用**同一份编译产物**在命中行上重跑一次取捕获值
// （见文件头部），所以这里的判据全部是"值与宿主真正替换的那一段一致"，不是形状。
import test from 'node:test'
import assert from 'node:assert/strict'
import { compileStructuralPattern } from '../src/structuralSearch.ts'
import {
  createDuplicateFilter, dedupeMatches, structuralMatch, variableValueLines, variableValues,
} from '../src/structuralSearchResults.ts'

test('variableValues 给的是这一次命中里每个变量的捕获值', () => {
  const pattern = compileStructuralPattern('$x$ + $y$')
  assert.deepEqual(variableValues(pattern.regex, pattern.variables, 'a + b'), { x: 'a', y: 'b' })
  // 同名变量第二次出现是反向引用：`$x$ + $x$` 只匹配同一个标识符相加。
  const twice = compileStructuralPattern('$x$ + $x$')
  assert.deepEqual(variableValues(twice.regex, twice.variables, 'a + a'), { x: 'a' })
  assert.equal(variableValues(twice.regex, twice.variables, 'a + b'), null)
  assert.equal(variableValues(pattern.regex, pattern.variables, '没有加号'), null, '配不上就 null，不猜值')
  assert.equal(variableValues('(unclosed', ['x'], 'x'), null, '正则本身不合法也 null')
  // 大小写位由调用方给（宿主用哪套标志扫，这里就得用哪套取）。传的是**编译产物**，不是模板原文。
  const logged = compileStructuralPattern('log($x$)')
  assert.equal(variableValues(logged.regex, logged.variables, 'LOG(a)', ''), null)
  assert.deepEqual(variableValues(logged.regex, logged.variables, 'LOG(a)', 'i'), { x: 'a' })
})

test('variableValueLines 只列真的参与匹配的变量，顺序与替换串里的 $N 一致', () => {
  assert.deepEqual(variableValueLines({ x: 'a', y: null, z: 'b' }), ['$x$ → a', '$z$ → b'])
  assert.deepEqual(variableValueLines({}), [])
})

test('structuralMatch 把宿主给的行信息与变量值合成一条命中（MatchResult 的可移植子集）', () => {
  const pattern = compileStructuralPattern('$x$ == null')
  const hit = structuralMatch('src/a.ts', 12, 4, 'if (a == null) {', pattern.regex, pattern.variables)
  assert.deepEqual({ path: hit.path, line: hit.line, column: hit.column }, { path: 'src/a.ts', line: 12, column: 4 })
  assert.equal(hit.image, 'if (a == null) {')
  assert.deepEqual(hit.variables, { x: 'a' })
  // 配不上的那一行（宿主按 std::regex 命中、JS 复核不上的极端情况）变量表是空的，不是编出来的。
  const missed = structuralMatch('src/a.ts', 13, 0, '什么都没有', pattern.regex, pattern.variables)
  assert.deepEqual(missed.variables, {})
})

test('去重是"一次搜索范围内、第一条赢"，reset 对应 matchingFinished', () => {
  const filter = createDuplicateFilter()
  // 这一条是**回归护栏**：`accept` 早先写成 `duplicates.add(key)`，而 `Set.add` 返回集合本身（永远真值），
  // filter 于是把所有重复都放行 —— 去重整条失效。改回先 has 再 add 之后必须真的拒绝第二条。
  assert.equal(filter.accept({ path: 'a.ts', line: 1, column: 0 }), true)
  assert.equal(filter.accept({ path: 'a.ts', line: 1, column: 0 }), false)
  assert.equal(filter.accept({ path: 'a.ts', line: 1, column: 2 }), true, '列不同就是另一处命中')
  assert.equal(filter.accept({ path: 'b.ts', line: 1, column: 0 }), true)
  assert.equal(filter.seen(), 3)
  filter.reset()
  assert.equal(filter.seen(), 0)
  assert.equal(filter.accept({ path: 'a.ts', line: 1, column: 0 }), true, '新一次搜索从空集开始')
})

test('dedupeMatches 保序去重（流式分块与最终全量会把同一处送两次）', () => {
  const rows = [
    { path: 'a.ts', line: 1, column: 0, text: 'x' },
    { path: 'a.ts', line: 2, column: 0, text: 'y' },
    { path: 'a.ts', line: 1, column: 0, text: 'x' },
    { path: 'b.ts', line: 1, column: 0, text: 'z' },
  ]
  assert.deepEqual(dedupeMatches(rows).map(row => `${row.path}:${row.line}`), ['a.ts:1', 'a.ts:2', 'b.ts:1'])
  assert.deepEqual(dedupeMatches([]), [])
})
