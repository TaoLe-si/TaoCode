// 结构化搜索**面板装配模型**（`src/structuralSearchPanelModel.ts`）——上游
// `platform/structuralsearch/source/com/intellij/structuralsearch/plugin/ui/SearchCommand.java`
// （编译 → 校验 → 发查询）与 `plugin/util/DuplicateFilteringResultSink.java:18-46`
// （命中去重）两条线在文本层的合并等价物。
//
// 判据守的是"面板会不会把一条会变形/会假阴的请求发出去"，不守组件的 DOM 形状。
import test from 'node:test'
import assert from 'node:assert/strict'
import { ref } from 'vue'
import { compileStructuralReplacement } from '../src/structuralSearch.ts'
import { createStructuralSearchModel } from '../src/structuralSearchPanelModel.ts'
import { defineReplacementVariable } from '../src/structuralSearchReplace.ts'

const model = (template, extra = {}) => {
  const enabled = ref(extra.enabled ?? true)
  const query = ref(template)
  const replacement = ref(extra.replacement ?? '')
  const caseSensitive = ref(extra.caseSensitive ?? true)
  const definitions = ref(extra.definitions ?? [])
  return createStructuralSearchModel({ enabled, template: query, replacement, caseSensitive, definitions })
}

test('模式关着时模型一个字都不改（既有搜索/替换通道不受接线影响）', () => {
  const m = model('$x$ == null', { enabled: false, replacement: '$x$ != null' })
  assert.equal(m.compiled.value, null)
  assert.equal(m.error.value, '')
  assert.equal(m.activeQuery.value, '$x$ == null')
  assert.equal(m.activeReplacement.value, '$x$ != null')
})

test('编译失败/子模板失败/定义表失败都挡在发请求之前', () => {
  assert.match(model('$x${3,1}').error.value, /大于上界/)
  assert.match(model('$x$[contains($y${2,1})]').error.value, /包含条件/)
  assert.match(model('log($x$)', {
    replacement: '$x$',
    definitions: [defineReplacementVariable('zz', 'v')],
  }).error.value, /在模板里不存在/)
  // 定义文本里的 `$` 由折叠那一层挡（宿主替换通道没有字面 `$` 的写法）。
  assert.match(model('log($x$)', {
    replacement: '$x$',
    definitions: [defineReplacementVariable('x', 'a$b')],
  }).error.value, /捕获标记/)
  assert.equal(model('log($x$)', { replacement: '$x$', definitions: [defineReplacementVariable('x', 'ok')] }).error.value, '')
})

test('替换串的折叠：没有定义时与既有实现逐字一致，有定义时折成文本', () => {
  const m = model('log($x$)', { replacement: 'warn($x$)' })
  assert.equal(m.activeReplacement.value, compileStructuralReplacement('warn($x$)', ['x']))
  assert.equal(m.activeReplacement.value, 'warn($1)')
  const defined = model('log($x$)', { replacement: 'warn($x$)', definitions: [defineReplacementVariable('x', 'logger')] })
  assert.equal(defined.activeReplacement.value, 'warn(logger)')
})

test('refine 先按 `路径:行:列` 去重（DuplicateFilteringResultSink 的第一条赢）', () => {
  const m = model('log($x$)')
  const rows = [
    { path: 'a.ts', line: 1, column: 0, text: 'log(a)' },
    { path: 'a.ts', line: 1, column: 0, text: 'log(a)' },
    { path: 'a.ts', line: 2, column: 3, text: 'log(b)' },
  ]
  assert.deepEqual(m.refine(rows).map(row => row.line), [1, 2])
  // 没挂跨度修饰符时不产生状态行（不该出现"0 处剔除"这种噪音）。
  assert.equal(m.note.value, '')
})

test('匹配范围（整模板档的 within）真的在筛宿主返回的候选行', () => {
  const m = model('$x$ == null')
  m.scope.value = { within: 'if ($c$) { $y$ == null }', invert: false }
  const rows = [
    { path: 'a.ts', line: 1, column: 0, text: 'if (ok) { a == null }' },
    { path: 'a.ts', line: 2, column: 0, text: 'b == null;' },
    { path: 'a.ts', line: 3, column: 0, text: '一句都没有' },
  ]
  const kept = m.refine(rows)
  assert.deepEqual(kept.map(row => row.line), [1])
  assert.match(m.note.value, /1 处不满足修饰符\/匹配范围，已剔除/)
  assert.match(m.note.value, /1 处本仓复核不上/)
  m.scope.value = null
  // 撤掉匹配范围后本层不再复核：第 3 行那种"宿主本来就不该报"的候选由宿主负责，这里不替它判定。
  assert.deepEqual(m.refine(rows).map(row => row.line), [1, 2, 3])
  assert.equal(m.note.value, '')
})

test('变量的 contains 也走同一条复核通道', () => {
  const m = model('log($x$[contains(get)])')
  const kept = m.refine([
    { path: 'a.ts', line: 1, column: 0, text: 'log(getUser)' },
    { path: 'a.ts', line: 2, column: 0, text: 'log(setUser)' },
  ])
  assert.deepEqual(kept.map(row => row.line), [1])
  assert.match(m.note.value, /1 处不满足/)
})

test('复核用的大小写位跟面板一致（关着区分大小写时不许假剔除）', () => {
  const rows = [{ path: 'a.ts', line: 1, column: 0, text: 'LOG(getUser)' }]
  // 没挂跨度修饰符时 refine 只做去重：那一行是不是命中由宿主判定，本层不再判一遍。
  const plain = model('log($x$)', { caseSensitive: true })
  assert.deepEqual(plain.refine(rows).map(row => row.line), [1])
  // 挂了跨度修饰符就必须用同一套标志复核，否则"宿主按 i 命中、本仓按区分大小写复核"会假剔除。
  const strict = model('log($x$[contains(get)])', { caseSensitive: true })
  assert.deepEqual(strict.refine(rows), [], '区分大小写时这一行本来就不该有命中')
  assert.match(strict.note.value, /1 处本仓复核不上/)
  const loose = model('log($x$[contains(get)])', { caseSensitive: false })
  assert.deepEqual(loose.refine(rows).map(row => row.line), [1])
  assert.equal(loose.note.value, '')
})

test('valuesOf 给的是这一次命中里每个变量匹配到的文本（MatchResult 的变量值面）', () => {
  const m = model('$x$ + $y$')
  assert.deepEqual(m.valuesOf('a + b'), { x: 'a', y: 'b' })
  assert.equal(m.valuesOf('没有加号'), null)
  const off = model('$x$ + $y$', { enabled: false })
  assert.equal(off.valuesOf('a + b'), null)
})
