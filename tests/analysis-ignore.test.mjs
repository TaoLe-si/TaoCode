import test from 'node:test'
import assert from 'node:assert/strict'
import {
  clearAnalysisIgnore, formatIgnorePatterns, globToRegExp, ignoredFiles, ignorePatterns, isAnalysisIgnored,
  matchesAnalysisIgnore, parseIgnorePatterns, saveIgnorePatterns, toggleIgnoredFile,
} from '../src/analysisIgnore.ts'

test('规则文本解析：丢空行与 # 注释', () => {
  assert.deepEqual(parseIgnorePatterns('\n# 注释\n  **/gen/** \n\n*.min.js\n'), ['**/gen/**', '*.min.js'])
  assert.equal(formatIgnorePatterns(['a', 'b']), 'a\nb')
})

test('glob 编译：* 段内、? 单字符、**/ 跨目录', () => {
  assert.ok(globToRegExp('*.min.js').test('src/a.min.js'))
  assert.ok(!globToRegExp('*.min.js').test('src/a.min.ts'))
  assert.ok(globToRegExp('src/?b.ts').test('src/ab.ts'))
  assert.ok(!globToRegExp('src/?b.ts').test('src/aab.ts'))
  assert.ok(globToRegExp('**/generated/**').test('src/generated/x.ts'))
  assert.ok(globToRegExp('**/generated/**').test('generated/x.ts'))
  assert.ok(!globToRegExp('**/generated/**').test('src/generator/x.ts'))
})

test('匹配：显式文件与 glob 规则任一命中即忽略', () => {
  assert.ok(matchesAnalysisIgnore('src/a.ts', ['src/a.ts'], []))
  assert.ok(matchesAnalysisIgnore('src/gen/x.ts', [], ['**/gen/**']))
  assert.ok(!matchesAnalysisIgnore('src/b.ts', ['src/a.ts'], ['**/gen/**']))
  // Windows 分隔符按 / 归一化后再匹配。
  assert.ok(matchesAnalysisIgnore('src\\gen\\x.ts', [], ['src/gen/**']))
})

test('保存规则后 isAnalysisIgnored 生效，恢复全部后清空', () => {
  clearAnalysisIgnore()
  assert.equal(saveIgnorePatterns('# 注释\n**/gen/**'), 1)
  assert.deepEqual(ignorePatterns.value, ['**/gen/**'])
  assert.ok(isAnalysisIgnored('src/gen/x.ts'))
  assert.ok(!isAnalysisIgnored('src/main.ts'))
  clearAnalysisIgnore()
  assert.ok(!isAnalysisIgnored('src/gen/x.ts'))
})

test('逐文件忽略可切换、可恢复', () => {
  clearAnalysisIgnore()
  assert.equal(toggleIgnoredFile('src/a.ts'), true)
  assert.deepEqual(ignoredFiles.value, ['src/a.ts'])
  assert.ok(isAnalysisIgnored('src/a.ts'))
  assert.equal(toggleIgnoredFile('src\\a.ts'), false)
  assert.deepEqual(ignoredFiles.value, [])
  assert.ok(!isAnalysisIgnored('src/a.ts'))
  clearAnalysisIgnore()
})
