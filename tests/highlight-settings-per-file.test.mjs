// dm/problems-view 的判据（二）：逐文件高亮级别（上游 `HighlightingSettingsPerFile` 的
// None/Syntax/Inspections 三档 + `HighlightingLevelManager` 的默认档）。
// 落点：`src/highlightSettingsPerFile.ts` 的判定 + `src/problems.ts` 聚合前的门控。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  HIGHLIGHTING_LEVELS, clearHighlightLevels, highlightLevelEntries, highlightLevelForPath,
  keepsDiagnosticAtLevel, setHighlightLevelForPath,
} from '../src/highlightSettingsPerFile.ts'

const root = new URL('..', import.meta.url)
const read = path => readFileSync(new URL(path, root), 'utf8')

test('三档清单与默认档：没有覆盖就是 inspections', () => {
  assert.deepEqual(HIGHLIGHTING_LEVELS.map(option => option.id), ['none', 'syntax', 'inspections'])
  assert.equal(highlightLevelForPath('src/a.ts'), 'inspections')
})

test('设置/读取/恢复：设成默认档等于删除覆盖（Revert 语义）', () => {
  clearHighlightLevels()
  setHighlightLevelForPath('src\\a.ts', 'none')
  assert.equal(highlightLevelForPath('src/a.ts'), 'none', '反斜杠路径按 / 归一化')
  assert.deepEqual(highlightLevelEntries(), [{ path: 'src/a.ts', level: 'none' }])
  setHighlightLevelForPath('src/a.ts', 'syntax')
  assert.equal(highlightLevelForPath('src/a.ts'), 'syntax')
  setHighlightLevelForPath('src/a.ts', 'inspections')
  assert.equal(highlightLevelForPath('src/a.ts'), 'inspections')
  assert.deepEqual(highlightLevelEntries(), [])
  clearHighlightLevels()
})

test('门控：none 全丢、syntax 只留错误、inspections 全留', () => {
  assert.equal(keepsDiagnosticAtLevel('none', 1), false)
  assert.equal(keepsDiagnosticAtLevel('none', 4), false)
  assert.equal(keepsDiagnosticAtLevel('syntax', 1), true)
  assert.equal(keepsDiagnosticAtLevel('syntax', 2), false)
  assert.equal(keepsDiagnosticAtLevel('syntax', 3), false)
  assert.equal(keepsDiagnosticAtLevel('syntax', 4), false)
  assert.equal(keepsDiagnosticAtLevel('inspections', 1), true)
  assert.equal(keepsDiagnosticAtLevel('inspections', 4), true)
  clearHighlightLevels()
})

test('消费链：problems.ts 的聚合按级别门控（两处来源都过）', () => {
  const source = read('src/problems.ts')
  assert.match(source, /highlightLevelForPath/)
  assert.match(source, /keepsDiagnosticAtLevel/)
  assert.match(source, /level === 'none'/)
  // 两处循环（lspDiagnostics 与 localDiagnostics）都调了门控。
  assert.equal([...source.matchAll(/keepsDiagnosticAtLevel\(level, item\.severity\)/g)].length, 2)
})
