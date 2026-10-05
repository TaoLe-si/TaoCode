// 检查结果 HTML 报告（`src/inspectionReport.ts`）：IDEA `codeInspection/export` 一族
// （`ExportToHTMLAction` / `ExportToHTMLDialog`）的纯生成部分 —— 计数、按文件分组、转义、文件名。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  escapeHtml, groupReportRows, inspectionReportCounts, inspectionReportFileName,
  inspectionReportHtml, inspectionReportTimestamp, inspectionSeverityClass, inspectionSeverityName,
} from '../src/inspectionReport.ts'

const row = (path, line, severity, message, source = 'jdt') => ({ path, line, character: 0, severity, message, source })

test('HTML 转义：五个字符都转，消息里的标签不会变成真标签', () => {
  assert.equal(escapeHtml('<b>a</b> & "x" \'y\''), '&lt;b&gt;a&lt;/b&gt; &amp; &quot;x&quot; &#39;y&#39;')
  const html = inspectionReportHtml([row('A.java', 0, 1, '<script>alert(1)</script>')], { generatedAt: new Date(2026, 9, 4, 15, 30) })
  assert.ok(!html.includes('<script>alert(1)</script>'), '原始标签不许出现在报告里')
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'))
})

test('计数与分组：错误/警告/信息分档，文件数去重，组内按行号', () => {
  const rows = [
    row('b/B.java', 9, 2, 'w'),
    row('a/A.java', 3, 1, 'e2'),
    row('a/A.java', 1, 4, 'i'),
    row('a/A.java', 0, 1, 'e1'),
  ]
  assert.deepEqual(inspectionReportCounts(rows), { total: 4, errors: 2, warnings: 1, infos: 1, files: 2 })
  const groups = groupReportRows(rows)
  assert.deepEqual(groups.map(group => group.path), ['a/A.java', 'b/B.java'], '文件按路径排序')
  assert.deepEqual(groups[0].rows.map(item => item.line), [0, 1, 3], '组内按行号排序')
})

test('报告正文：1 基位置、严重度名、空集合写「没有问题」', () => {
  const html = inspectionReportHtml([row('src/A.java', 11, 2, '未使用', 'jdt')], { projectName: 'Demo', generatedAt: new Date(2026, 9, 4, 15, 30) })
  assert.ok(html.includes('检查报告 — Demo'))
  assert.ok(html.includes('生成时间 2026-10-04 15:30'))
  assert.ok(html.includes('src/A.java'))
  assert.ok(html.includes('12:1'), '行号列显示 1 基')
  assert.ok(html.includes('警告'))
  const empty = inspectionReportHtml([], { generatedAt: new Date(2026, 9, 4, 15, 30) })
  assert.ok(empty.includes('没有问题。'))
  assert.ok(!empty.includes('<section class="file">'))
})

test('文件名与时间戳：两位补零，扩展名是 native 导出通道允许的 .html', () => {
  const date = new Date(2026, 0, 5, 9, 7)
  assert.equal(inspectionReportFileName(date), 'inspection-report-20260105-0907.html')
  assert.equal(inspectionReportTimestamp(date), '2026-01-05 09:07')
  assert.ok(/\.html$/.test(inspectionReportFileName(date)))
})

test('严重度名/样式与面板同一套（四档齐全，未知值走信息）', () => {
  assert.deepEqual([1, 2, 3, 4, 99].map(inspectionSeverityName), ['错误', '警告', '提示', '信息', '信息'])
  assert.deepEqual([1, 2, 3, 4, 99].map(inspectionSeverityClass), ['error', 'warning', 'weak', 'info', 'info'])
})
