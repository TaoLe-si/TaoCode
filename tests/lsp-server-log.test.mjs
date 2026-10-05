// 语言服务输出日志（`src/lspServerLog.ts`）：环形上限、级别/语言过滤、格式化、尾部与摘要、导出文本。
// 判据对应上游 `LanguageServiceLogger` / `LspClientConsole` 的输出呈现（本仓落在消息窗口的一员）。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  LSP_LOG_LIMIT, appendLspLogEntry, exportLspLogText, filterLspLog, formatLspLogEntry,
  lspLogLanguages, lspLogSummary, lspLogTail,
} from '../src/lspServerLog.ts'

const at = Date.parse('2026-10-04T09:08:07')
const entry = (over = {}) => ({ at, language: 'jdt.ls', kind: 'message', level: 3, text: '编译单元已解析', ...over })

test('环形上限：超过上限丢最旧的', () => {
  let entries = []
  for (let index = 0; index < 12; ++index) entries = appendLspLogEntry(entries, entry({ text: `第 ${index} 行` }), 10)
  assert.equal(entries.length, 10)
  assert.equal(entries[0].text, '第 2 行')
  assert.equal(entries[9].text, '第 11 行')
  assert.ok(LSP_LOG_LIMIT >= 100, '默认上限要足够放一次索引的输出')
})

test('过滤：按语言/级别/类别', () => {
  const entries = [
    entry({ language: 'jdt.ls', level: 1, text: '导入失败' }),
    entry({ language: 'jdt.ls', level: 3, kind: 'progress', text: 'Gradle import 开始' }),
    entry({ language: 'typescript', level: 2, text: 'tsconfig 有警告' }),
  ]
  assert.equal(filterLspLog(entries, { language: 'jdt.ls' }).length, 2)
  assert.deepEqual(filterLspLog(entries, { minLevel: 1 }).map(row => row.text), ['导入失败'])
  assert.deepEqual(filterLspLog(entries, { minLevel: 2 }).map(row => row.text), ['导入失败', 'tsconfig 有警告'])
  assert.deepEqual(filterLspLog(entries, { kind: 'progress' }).map(row => row.text), ['Gradle import 开始'])
})

test('格式化：时间戳 + 语言 + 类别，错误/警告带级别前缀', () => {
  assert.equal(formatLspLogEntry(entry()), '[09:08:07] [jdt.ls] message: 编译单元已解析')
  assert.equal(formatLspLogEntry(entry({ level: 1, text: 'x' })), '[09:08:07] [jdt.ls] 错误 message: x')
  assert.equal(formatLspLogEntry(entry({ level: 2, text: 'x' })), '[09:08:07] [jdt.ls] 警告 message: x')
  assert.equal(formatLspLogEntry(entry({ language: '' })), '[09:08:07] [语言服务] message: 编译单元已解析')
})

test('尾部与摘要：某语言最近 n 行 / 「N 行（错误 M）」', () => {
  const entries = [
    entry({ text: 'a' }), entry({ text: 'b', level: 1 }), entry({ text: 'c', language: 'typescript' }), entry({ text: 'd' }),
  ]
  assert.deepEqual(lspLogTail(entries, 'jdt.ls', 2).map(line => line.split('message: ')[1]), ['b', 'd'])
  assert.equal(lspLogTail(entries, 'typescript', 5).length, 1)
  assert.equal(lspLogSummary(entries, 'jdt.ls'), 'jdt.ls：3 行（错误 1）')
  assert.equal(lspLogSummary(entries, 'typescript'), 'typescript：1 行')
  assert.equal(lspLogSummary(entries, ''), '语言服务：0 行')
})

test('语言清单按首次出现排序；导出文本可按语言过滤', () => {
  const entries = [entry({ language: 'typescript' }), entry({ language: 'jdt.ls' }), entry({ language: 'typescript' })]
  assert.deepEqual(lspLogLanguages(entries), ['typescript', 'jdt.ls'])
  const text = exportLspLogText(entries, { language: 'jdt.ls' })
  assert.equal(text.split('\n').length, 1)
  assert.match(text, /\[jdt\.ls\] message: 编译单元已解析/)
})
