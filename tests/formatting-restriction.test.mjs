// 格式化准入（`src/formattingRestriction.ts`）—— 上游 `ExcludedFileFormattingRestriction`
// 与 `UntrustedFileFormattingServiceSuppressor` 的文本等价物，以及它在重排入口的接线。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  formatExcludedPatterns, formattingRestrictionFor, isFileExcludedFromFormatting, setFormatExcludedPatterns,
} from '../src/formattingRestriction.ts'

test('「不格式化」清单：注释与空行丢掉，glob 命中即不允许（上游 ExcludedFiles/ExcludedFileFormattingRestriction）', () => {
  assert.equal(setFormatExcludedPatterns('# 注释\n**/*.min.js\n\nbuild/**'), 2)
  assert.deepEqual(formatExcludedPatterns.value, ['**/*.min.js', 'build/**'])
  assert.equal(isFileExcludedFromFormatting('src/a.min.js'), true)
  assert.equal(isFileExcludedFromFormatting('build/gen/a.ts'), true)
  assert.equal(isFileExcludedFromFormatting('src/a.ts'), false)
  assert.equal(isFileExcludedFromFormatting('src\\a.min.js'), true, '反斜杠归一')
  setFormatExcludedPatterns('')
})

test('准入判定：不信任的项目先挡（UntrustedFileFormattingServiceSuppressor），再看不格式化清单', () => {
  setFormatExcludedPatterns('**/*.md')
  assert.match(formattingRestrictionFor('README.md'), /不格式化/)
  assert.match(formattingRestrictionFor('src/a.ts', { trusted: false }), /安全模式/)
  assert.equal(formattingRestrictionFor('src/a.ts'), null)
  assert.match(formattingRestrictionFor('README.md', { trusted: true }), /不格式化/, '信任只解除信任拦截，不解除清单')
  setFormatExcludedPatterns('')
})

test('接线：重排入口（src/semanticActions.ts）在发请求前过一遍准入与进度行', () => {
  const source = readFileSync(new URL('../src/semanticActions.ts', import.meta.url), 'utf8')
  assert.match(source, /formattingRestrictionFor\(path\)/, 'runFormatting 调准入判定')
  assert.match(source, /trustBlockReason\('格式化'/, '不信任项目走同一条信任链')
  assert.match(source, /backgroundTaskManager\.begin\(FORMAT_FORMATTING_TASK_ID/, '登记 FormattingProgressTask 那一行')
  assert.match(source, /backgroundTaskManager\.end\(FORMAT_FORMATTING_TASK_ID\)/, '跑完/出错都收掉那一行')
})
