// 搜索排除与工程排除目录的贯通（`src/searchExclusions.ts`）——
// 上游 Find in Path 的排除/作用域语义；本仓把这些模式拼进原生 `search.*` 的 exclude 文本框。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { excludedDirsOf, mergeSearchExclude, projectExclusionPatterns } from '../src/searchExclusions.ts'

test('排除目录名折成 glob：带路径分隔符/空名的条目丢弃，重复去重', () => {
  assert.deepEqual(projectExclusionPatterns(['build', 'build', 'node_modules', '', 'a/b', '..', '.']),
    ['**/build/**', '**/node_modules/**'])
  assert.deepEqual(projectExclusionPatterns(undefined), [])
})

test('面板 exclude 文本与工程模式合并：用户规则在前、已出现的模式不重复追加', () => {
  assert.equal(mergeSearchExclude('', ['**/build/**']), '**/build/**')
  assert.equal(mergeSearchExclude('*.min.js', ['**/build/**', '**/dist/**']), '*.min.js,**/build/**,**/dist/**')
  assert.equal(mergeSearchExclude('**/build/**', ['**/build/**']), '**/build/**')
  assert.equal(mergeSearchExclude('', []), '')
})

test('项目设置里取排除目录：形状不对给空表', () => {
  assert.deepEqual(excludedDirsOf({ excludedDirs: ['build', 7] }), ['build'])
  assert.deepEqual(excludedDirsOf({}), [])
  assert.deepEqual(excludedDirsOf(null), [])
})

test('接线：SearchPanel 的搜索参数把工程排除目录并进 exclude', () => {
  const panel = readFileSync(new URL('../src/components/SearchPanel.vue', import.meta.url), 'utf8')
  assert.match(panel, /projectExclusionPatterns\(projectExcludedDirs\.value\)/, 'exclude 参数没有并入工程排除目录')
  assert.match(panel, /request<ProjectSettings>\('project\.settings\.get'\)/, '没有读项目设置的排除目录')
})
