// 错误树的纯规则（`src/errorTree.ts`）：kind 映射 / 固定顺序分桶 / 文本导出（ErrorViewTextExporter）。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ERROR_TREE_KIND_LABEL,
  ERROR_TREE_KIND_ORDER,
  bucketHeader,
  buildErrorTree,
  errorReportFileName,
  errorTreeKind,
  errorTreeLine,
  errorTreeText,
} from '../src/errorTree.ts'

const row = (severity, path, line, message = '消息') => ({ path, line, character: 2, severity, message, source: 'lsp' })

test('严重度 → ErrorTreeElementKind：1 错误 / 2 警告 / 3 提示 / 4 信息 / 其它归 GENERIC', () => {
  assert.equal(errorTreeKind(1), 'error')
  assert.equal(errorTreeKind(2), 'warning')
  assert.equal(errorTreeKind(3), 'note')
  assert.equal(errorTreeKind(4), 'info')
  assert.equal(errorTreeKind(9), 'generic')
  assert.deepEqual(ERROR_TREE_KIND_ORDER, ['info', 'error', 'warning', 'note', 'generic'], '上游 ourMessagesOrder')
})

test('分桶：固定顺序（INFO 在 ERROR 前）、空桶不出现、输入顺序不影响输出', () => {
  const buckets = buildErrorTree([
    row(2, 'b.ts', 4), row(1, 'a.ts', 0), row(4, 'd.ts', 1), row(2, 'c.ts', 2),
  ])
  assert.deepEqual(buckets.map(bucket => bucket.kind), ['info', 'error', 'warning'], '与插入顺序无关')
  assert.deepEqual(buckets.find(bucket => bucket.kind === 'warning').rows.map(r => r.path), ['b.ts', 'c.ts'], '组内保持原顺序')
  assert.equal(buckets.some(bucket => bucket.kind === 'note'), false, '空桶不出现')
  assert.deepEqual(buildErrorTree([]), [])
})

test('组头与消息行：行列转 1 基，消息为空时只留位置', () => {
  assert.equal(bucketHeader({ kind: 'error', label: ERROR_TREE_KIND_LABEL.error, rows: [row(1, 'a.ts', 0), row(1, 'b.ts', 1)] }), '错误 (2)')
  assert.equal(errorTreeLine(row(1, 'src/a.ts', 9, '未找到符号')), 'src/a.ts:10:3 未找到符号')
  assert.equal(errorTreeLine(row(1, 'src/a.ts', 9, '')), 'src/a.ts:10:3')
})

test('文本导出：Show details 勾选时分组 + 缩进 4 空格逐条，不勾时只剩组头', () => {
  const rows = [row(1, 'src/a.ts', 0, '第一个错误'), row(1, 'src/b.ts', 2, '第二个错误'), row(2, 'src/c.ts', 5, '一个警告')]
  const detailed = errorTreeText(rows)
  assert.equal(detailed, [
    '错误 (2)',
    '    src/a.ts:1:3 第一个错误',
    '    src/b.ts:3:3 第二个错误',
    '警告 (1)',
    '    src/c.ts:6:3 一个警告',
    '',
  ].join('\n'))
  const summary = errorTreeText(rows, { details: false })
  assert.equal(summary, '错误 (2)\n警告 (1)\n')
  assert.equal(errorTreeText([]), '', '没有问题时不产生文件内容')
})

test('导出文件名：error-report-<时间戳>.txt', () => {
  assert.equal(errorReportFileName(new Date(2026, 9, 4, 15, 30)), 'error-report-20261004-1530.txt')
  assert.equal(errorReportFileName(new Date(2026, 0, 9, 8, 5)), 'error-report-20260109-0805.txt')
})
