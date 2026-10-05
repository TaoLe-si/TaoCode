// `.analysisignore`（`src/analysisIgnoreFile.ts`）：格式解析（**不是 gitignore**）、逐段匹配、
// 按 baseDir 的子树作用域、逐层向上判定。
// 依据逐条见 `src/analysisIgnoreFile.ts` 的模块注释（`AnalysisIgnorePattern.kt` /
// `findAnalysisIgnoreExclusions.kt` / `AnalysisIgnoreService.kt` 的行号写在那里）。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  analysisIgnoreFilesIn, analysisIgnoreHits, analysisIgnoreRecord, analysisIgnoreUnsupportedReason,
  compileAnalysisIgnorePattern, describeAnalysisIgnoreRules, isAnalysisIgnoreFile, isAnalysisIgnoredByRecords,
  parseAnalysisIgnoreFile,
} from '../src/analysisIgnoreFile.ts'

test('解析：丢掉空行与 # 注释，尾 / 是目录规则，含 / 的锚定；只去行尾空格', () => {
  const { patterns } = parseAnalysisIgnoreFile('# 注释\n\nbuild/\n  src/gen/**  \nsrc\n')
  assert.deepEqual(patterns.map(p => [p.source, p.directoryOnly, p.anchored]), [
    ['build/', true, false],
    // 行首空白**不去**（上游只 trimEnd 空格），它就落进第一段里，匹配不到正常名字。
    ['  src/gen/**', false, true],
    ['src', false, false],
  ])
  assert.ok(!isAnalysisIgnoredByRecords([analysisIgnoreRecord('.analysisignore', '  src/gen/**\n')], 'src/gen/x.ts'))
  assert.ok(isAnalysisIgnoredByRecords([analysisIgnoreRecord('.analysisignore', '  src/gen/**\n')], '  src/gen/x.ts'))
})

test('不支持的写法按上游逐条拒收：`!`、`[`、`\\`、连星、没占满一段的 **', () => {
  // AnalysisIgnorePattern.unsupportedReason:140-160
  assert.equal(analysisIgnoreUnsupportedReason('!src/gen/keep.ts'), 'negation')
  assert.equal(analysisIgnoreUnsupportedReason('gen[0-9]'), 'characterClass')
  assert.equal(analysisIgnoreUnsupportedReason('\\#literal'), 'escape')
  assert.equal(analysisIgnoreUnsupportedReason('a***'), 'asteriskRun')
  assert.equal(analysisIgnoreUnsupportedReason('a**b'), 'partialDoubleAsterisk')
  assert.equal(analysisIgnoreUnsupportedReason('**/gen/**'), null)
  assert.equal(analysisIgnoreUnsupportedReason('/src/gen'), null)
})

test('被拒的行不进规则，但如实报出来（validate:118-122 只存受支持的）', () => {
  const { patterns, rejected } = parseAnalysisIgnoreFile('!keep.ts\nbuild/\n')
  assert.deepEqual(patterns.map(p => p.source), ['build/'])
  assert.deepEqual(rejected, [{ source: '!keep.ts', reason: 'negation' }])
  // 全是分隔符的一行（`/`）没有 body，属于不受支持。
  assert.deepEqual(parseAnalysisIgnoreFile('/').rejected, [{ source: '/', reason: 'separatorsOnly' }])
})

test('`**/foo` 后面没有别的 / 时退化成不锚定（parse:178-181）', () => {
  assert.equal(compileAnalysisIgnorePattern('**/gen').anchored, false)
  assert.equal(compileAnalysisIgnorePattern('**/gen/**').anchored, true, '后面还有 /，仍是锚定规则')
  assert.equal(compileAnalysisIgnorePattern('/gen/x').anchored, true)
  assert.equal(compileAnalysisIgnorePattern('/gen/x').source, '/gen/x')
})

test('不锚定的规则匹配任意层级的同名名字，锚定的只对相对路径', () => {
  const record = analysisIgnoreRecord('.analysisignore', 'gen\nsrc/target/**\n')
  assert.ok(isAnalysisIgnoredByRecords([record], 'a/gen/x.ts'), '任意层级的同名目录都算')
  assert.ok(isAnalysisIgnoredByRecords([record], 'src/target/deep/x.ts'), '锚定 + ** 跨层')
  assert.ok(!isAnalysisIgnoredByRecords([record], 'src/other/x.ts'))
  assert.ok(!isAnalysisIgnoredByRecords([record], 'generator/x.ts'), '前缀相同但不是同一个名字')
})

test('目录规则只匹配目录；含 / 的规则按相对路径逐段对（matches:44-50）', () => {
  const directory = analysisIgnoreRecord('.analysisignore', 'build/\n')
  assert.ok(isAnalysisIgnoredByRecords([directory], 'build/x.ts'), '目录规则经祖先层命中其下文件')
  assert.ok(isAnalysisIgnoredByRecords([directory], 'build', true), '目录规则命中目录本身')
  assert.ok(!isAnalysisIgnoredByRecords([directory], 'build'), '同一个名字当文件看时不算命中')
  const file = analysisIgnoreRecord('.analysisignore', 'dist/index.js\n')
  assert.ok(isAnalysisIgnoredByRecords([file], 'dist/index.js'), '含 / 的规则锚定，逐段对上整条相对路径')
  assert.ok(!isAnalysisIgnoredByRecords([file], 'dist/index.js.map'))
  assert.ok(!isAnalysisIgnoredByRecords([file], 'other/dist/index.js'), '锚定规则从 baseDir 起算，不匹配更深的前缀')
})

test('规则只管自己所在的子树（baseDir），baseDir 自身不算（isExcluded:104）', () => {
  const nested = analysisIgnoreRecord('sub/.analysisignore', 'tmp\n')
  assert.ok(isAnalysisIgnoredByRecords([nested], 'sub/tmp/x.ts'))
  assert.ok(!isAnalysisIgnoredByRecords([nested], 'tmp/x.ts'), '根下的同名目录不受 sub 的规则管')
  assert.ok(!isAnalysisIgnoredByRecords([nested], 'sub'), 'baseDir 自己永远不被排除')
})

test('从文件清单里挑出全部 .analysisignore（不是"就近取一个"）', () => {
  assert.ok(isAnalysisIgnoreFile('a/.analysisignore'))
  assert.ok(isAnalysisIgnoreFile('.analysisignore'))
  assert.ok(!isAnalysisIgnoreFile('a/analysisignore.txt'))
  assert.deepEqual(analysisIgnoreFilesIn(['src/a.ts', 'sub/.analysisignore', '.analysisignore', 'x/analysisignore']), ['sub/.analysisignore', '.analysisignore'])
})

test('多层命中按最深（文件自身）排在前（findAnalysisIgnoreExclusions:56）', () => {
  const record = analysisIgnoreRecord('.analysisignore', 'x.ts\ngen\nsrc\n')
  const hits = analysisIgnoreHits([record], 'src/gen/deep/x.ts')
  // 文件自身那层（depth 0）最先，然后是祖先目录；一条记录同一层只记第一条命中的规则。
  assert.deepEqual(hits.map(hit => [hit.path, hit.depth, hit.pattern.source]), [
    ['src/gen/deep/x.ts', 0, 'x.ts'],
    ['src/gen', 2, 'gen'],
    ['src', 3, 'src'],
  ])
  // 锚定规则要对上**整条**相对路径：文件自身那层对不上 `src/gen` 时不命中，
  // 命中的是祖先目录 `src/gen` 那一层。
  const anchored = analysisIgnoreRecord('.analysisignore', 'src/gen\n')
  assert.deepEqual(analysisIgnoreHits([anchored], 'src/gen/deep/x.ts').map(hit => [hit.path, hit.depth]), [['src/gen', 2]])
})

test('摘要：无规则、纯计数、带目录与不受支持', () => {
  assert.equal(describeAnalysisIgnoreRules([]), '无忽略规则')
  const { patterns, rejected } = parseAnalysisIgnoreFile('a\nb/\n!c\n')
  assert.equal(describeAnalysisIgnoreRules(patterns, rejected), '2 条规则（1 条目录，1 条不受支持）')
})
