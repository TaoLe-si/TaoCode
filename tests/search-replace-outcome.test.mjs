// 一次替换**没做完**时的那句交代（`src/searchReplaceOutcome.ts`）。
//
// 判据守的是"不完整不许报成成功"：三个计数各自的出处在本仓宿主那一侧 ——
//   · `skippedFiles` ← `native/search.cpp:37`（`max_scanned_files = 100000`）、`:887`（那条注释写明
//     "reported as skippedFiles instead of a clean 0 replacements"）、`:921`（回参）；
//   · `truncated` ← 同一趟扫描的结果条数上限；
//   · `skippedNonUtf8` ← UTF-8/GBK 都解不出来的文件（`src/bridge.ts:199` 把它与 `skippedFiles` 分列）。
// 上游没有 100k 这条硬限制（它走索引），所以这三句是**本仓形态**的等价物；上游同一档的姿态是
// `FindPopupPanel.java:1573-1574`：后台校验没跑完就用 ValidationInfo（warning）挡在动作上，
// 而不是先报"完成"再补一句。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { incompleteNote, replaceAllConfirmNote } from '../src/searchReplaceOutcome.ts'

test('完整的一轮替换不多说一句', () => {
  assert.equal(incompleteNote({ files: 3, replacements: 12 }), '')
  assert.equal(incompleteNote({ files: 0, replacements: 0, truncated: false, skippedFiles: 0, skippedNonUtf8: 0 }), '')
})

test('被扫描上限挡在门外的勾选文件优先说（native/search.cpp:887 那一档）', () => {
  assert.equal(incompleteNote({ files: 1, replacements: 2, truncated: true, skippedFiles: 7 }),
    '⚠ 替换不完整：有 7 个勾选的文件因扫描上限未被处理。请检查相关文件后重做。',
    '两者是同一条上限的两种表现，取更严重的那一句，不叠两遍')
})

test('一个文件都没被跳过、只是清单被截断时说另一句', () => {
  assert.equal(incompleteNote({ files: 1, replacements: 2, truncated: true }),
    '⚠ 替换不完整：扫描被截断，可能还有未列出的匹配。请检查相关文件后重做。')
})

test('编码解不出是独立原因，可以与上限那句并存', () => {
  assert.equal(incompleteNote({ files: 1, replacements: 2, skippedFiles: 2, skippedNonUtf8: 5 }),
    '⚠ 替换不完整：有 2 个勾选的文件因扫描上限未被处理；5 个文件的编码无法识别，未参与搜索/替换。请检查相关文件后重做。')
})

test('脏回参按 0 与整数处理（计数不许把 "-3 个文件" 这种句子带进界面）', () => {
  assert.equal(incompleteNote({ files: 0, replacements: 0, skippedFiles: -2, skippedNonUtf8: 1.9 }),
    '⚠ 替换不完整：1 个文件的编码无法识别，未参与搜索/替换。请检查相关文件后重做。')
})

test('面板不再自己实现这份判定（搬进模块，锚点跟着改指新文件）', () => {
  const panel = readFileSync(new URL('../src/components/SearchPanel.vue', import.meta.url), 'utf8')
  assert.match(panel, /import \{ incompleteNote, replaceAllConfirmNote \} from '\.\.\/searchReplaceOutcome\.ts'/)
  assert.doesNotMatch(panel, /function incompleteNote\(/, '面板不留第二份判定')
  assert.match(panel, /const warning = incompleteNote\(result\)/)
})

// —— 「替换全部」第一段确认：上游 find.replace.all.confirmation 的四样信息一样不少 ——

test('不限定作用域：处数 + 两个串 + 文件数（FindBundle.properties:108 的那四样）', () => {
  assert.equal(replaceAllConfirmNote({ listed: 3, files: 2, query: 'foo', replacement: 'bar', truncated: false, scope: '' }),
    '将替换工作区内 3 处「foo」→「bar」，涉及 2 个文件。再次点击“全部替换”确认。')
})

test('结果被截断时保留"含未列出的部分"那半句（原生会重扫，未列出的同样会被改写）', () => {
  assert.equal(replaceAllConfirmNote({ listed: 3, files: 2, query: 'foo', replacement: 'bar', truncated: true, scope: '' }),
    '将替换工作区内 3 处「foo」→「bar」，涉及 2 个文件（含未列出的部分）。再次点击“全部替换”确认。')
})

test('限定作用域：说"已列出的"并保留"不改写未列出的文件"那一档', () => {
  assert.equal(replaceAllConfirmNote({ listed: 4, files: 1, query: 'a', replacement: 'b', truncated: true, scope: 'all scope' }),
    '将替换作用域“all scope”内已列出的 4 处「a」→「b」，涉及 1 个文件；范围限定下不会改写未列出的文件。再次点击“全部替换”确认。')
})

test('一处都没列过就不报数（0 是"没搜过"，不是"没有匹配"）', () => {
  assert.equal(replaceAllConfirmNote({ listed: 0, files: 0, query: 'foo', replacement: 'bar', truncated: false, scope: '' }),
    '将替换工作区内全部匹配 「foo」→「bar」。本次还没搜过，处数与文件数以实际扫描为准。再次点击“全部替换”确认。')
  assert.ok(!replaceAllConfirmNote({ listed: 0, files: 9, query: 'q', replacement: 'r', truncated: false, scope: '' }).includes('9'),
    '没搜过时连文件数也不许播')
})

test('脏数字不进句子（负数与小数按 0 / 整数处理）', () => {
  assert.equal(replaceAllConfirmNote({ listed: 2.7, files: -1, query: 'q', replacement: 'r', truncated: false, scope: '' }),
    '将替换工作区内 2 处「q」→「r」，涉及 0 个文件。再次点击“全部替换”确认。')
})

test('面板两处确认都走这一个函数，不再自己拼文案', () => {
  const panel = readFileSync(new URL('../src/components/SearchPanel.vue', import.meta.url), 'utf8')
  assert.equal((panel.match(/note\.value = replaceAllConfirmNote\(\{/g) ?? []).length, 2, '作用域那一支与工作区那一支各一处')
  assert.doesNotMatch(panel, /`将替换/, '面板不留第二份确认文案')
})
