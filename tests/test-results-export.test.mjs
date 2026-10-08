// exec/testframework：测试结果**导出到文件**（`src/testResultsExport.ts`）的判据。
//
// 上游依据：`platform/testRunner/src/com/intellij/execution/testframework/export/`
// 的 `ExportTestResultsConfiguration.java`（四格状态与两档扩展名）、
// `ExportTestResultsAction.java:104-135`（默认文件名 `Test Results - {0}`）、
// `ExportTestResultsForm.java:299-315`（换扩展名）、`:378-397`（四条校验）、
// `:283-288`（打开文案随扩展名变）、`ExecutionBundle.properties:330/338/339/340/341/342`。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const {
  EXPORT_FORMAT_EXTENSION, EXPORT_FILENAME_PATTERN, EXPORT_DIALOG_TITLE,
  OPEN_IN_EDITOR_TEXT, OPEN_IN_BROWSER_TEXT,
  EXPORT_OUTPUT_PATH_EMPTY, EXPORT_FILENAME_EMPTY,
  defaultTestResultsExportSettings, loadTestResultsExportSettings, saveTestResultsExportSettings,
  suggestExportNameSeed, defaultTestResultsFileName, applyFormatExtension,
  shouldOpenInBrowser, openExportedLabel, validateExportSettings, exportTargetPath,
  testResultsHtmlReport, TEST_RESULTS_EXPORT_KEY,
} = await import('../src/testResultsExport.ts')
const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

/** 直接造树节点（本模块只读 `kind/name/path/outcome/durationMs/id/children` 几个字段）。 */
function leaf(id, name, outcome, durationMs = 0) {
  return { id, name, kind: 'test', depth: 1, path: `MathTest.${name}`, parent: 'MathTest', children: [],
           outcome, counts: { passed: 0, failed: 0, skipped: 0, total: 1 }, durationMs,
           location: null, running: false, startTimeMillis: null, endTimeMillis: null }
}
function sampleTree() {
  const adds = leaf('sm:MathTest/adds', 'adds', 'passed', 12)
  const divides = leaf('sm:MathTest/divides', 'divides', 'failed')
  const skips = leaf('sm:MathTest/skips', 'skips', 'skipped')
  return [{ id: 'suite:MathTest', name: 'MathTest', kind: 'suite', depth: 0, path: 'MathTest', parent: null,
            children: [adds, divides, skips], outcome: 'failed',
            counts: { passed: 1, failed: 1, skipped: 1, total: 3 }, durationMs: 12, location: null,
            running: false, startTimeMillis: null, endTimeMillis: null }]
}

test('状态四格与上游 ExportTestResultsConfiguration.State 对齐', () => {
  const settings = defaultTestResultsExportSettings()
  assert.deepEqual(Object.keys(settings).sort(), ['format', 'openResultsInEditor', 'outputFolder'])
  assert.equal(settings.format, 'html', '上游 ExportFormat 默认 BundledTemplate("html")（:33）')
  assert.equal(settings.openResultsInEditor, false)
  assert.equal(settings.outputFolder, '')
  assert.deepEqual(EXPORT_FORMAT_EXTENSION, { xml: 'xml', html: 'html' }, '两档默认扩展名（:22-24）')
  assert.equal(EXPORT_FILENAME_PATTERN, 'Test Results - {0}', 'ExecutionBundle.properties:330')
  assert.equal(EXPORT_DIALOG_TITLE, 'Export Test Results', ':340')
  assert.equal(OPEN_IN_EDITOR_TEXT, 'Open exported file in editor', ':338')
  assert.equal(OPEN_IN_BROWSER_TEXT, 'Open exported file in browser', ':339')
  assert.equal(EXPORT_OUTPUT_PATH_EMPTY, '输出路径不能为空', ':341')
  assert.equal(EXPORT_FILENAME_EMPTY, '输出文件名不能为空', ':342')
})

test('状态读写：坏值逐格退回默认，格式只认两档', () => {
  assert.equal(TEST_RESULTS_EXPORT_KEY, 'taocode.testResultsExport')
  const loaded = loadTestResultsExportSettings('{"outputFolder":"D:/out","openResultsInEditor":true,"format":"xml"}')
  assert.deepEqual(loaded, { outputFolder: 'D:/out', openResultsInEditor: true, format: 'xml' })
  assert.deepEqual(loadTestResultsExportSettings('not json'), defaultTestResultsExportSettings())
  assert.deepEqual(loadTestResultsExportSettings(null), defaultTestResultsExportSettings())
  const bad = loadTestResultsExportSettings('{"outputFolder":7,"format":"xsl"}')
  assert.equal(bad.outputFolder, '', '非字符串退回默认')
  assert.equal(bad.format, 'html', '认不出的格式退回默认（上游 setExportFormat 的 try/catch）')
  const store = new Map()
  saveTestResultsExportSettings({ getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }, loaded)
  assert.equal(JSON.parse(store.get(TEST_RESULTS_EXPORT_KEY)).format, 'xml')
})

test('默认文件名 = Test Results - {0}，非法字符压成空格', () => {
  assert.equal(defaultTestResultsFileName('MathTest'), 'Test Results - MathTest')
  assert.equal(suggestExportNameSeed('a/b:c*d?'), 'a b c d')
  assert.equal(suggestExportNameSeed(''), 'Test Results', '空名退回一个能当文件名的串')
})

test('换扩展名只在最后一个点之后（ExportTestResultsForm.java:299-315）', () => {
  assert.equal(applyFormatExtension('Test Results - MathTest.xml', 'html'), 'Test Results - MathTest.html')
  assert.equal(applyFormatExtension('Test Results - MathTest', 'html'), 'Test Results - MathTest.html', '没有点就补一个')
  assert.equal(applyFormatExtension('a.b.c.xml', 'xml'), 'a.b.c.xml', '只动最后一个点')
})

test('打开文案随扩展名变（shouldOpenInBrowser / updateOpenInLabel）', () => {
  assert.equal(shouldOpenInBrowser('report.html'), true)
  assert.equal(shouldOpenInBrowser('report.HTM'), true, '大小写不敏感')
  assert.equal(shouldOpenInBrowser('report.xml'), false)
  assert.equal(openExportedLabel('r.html'), OPEN_IN_BROWSER_TEXT)
  assert.equal(openExportedLabel('r.xml'), OPEN_IN_EDITOR_TEXT)
})

test('校验：文件名与目录都不能空（ExportTestResultsForm.java:390-395）', () => {
  assert.equal(validateExportSettings({ format: 'html', fileName: '', folder: 'D:/out' }), EXPORT_FILENAME_EMPTY)
  assert.equal(validateExportSettings({ format: 'html', fileName: 'a.html', folder: ' ' }), EXPORT_OUTPUT_PATH_EMPTY)
  assert.equal(validateExportSettings({ format: 'html', fileName: 'a.html', folder: 'D:/out' }), null)
  assert.equal(exportTargetPath('D:/out/', 'a.html'), 'D:\\out\\a.html', '尾部分隔符不产生双斜杠')
})

test('HTML 报告：自包含、逐条叶子、失败带预期/实际与 footer', () => {
  const html = testResultsHtmlReport(sampleTree(), {
    runName: 'MathTest', productName: 'TaoCode', timestamp: '2026-10-06T00:00:00Z',
    details: new Map([['sm:MathTest/divides', { expected: '4', actual: '5', text: 'AssertionError' }]]),
  })
  assert.match(html, /^<!DOCTYPE html>/)
  assert.match(html, /1 passed, 1 failed, 1 skipped/)
  assert.match(html, /MathTest\.adds/)
  assert.match(html, /expected: <code>4<\/code>/)
  assert.match(html, /actual: <code>5<\/code>/)
  assert.match(html, /AssertionError/)
  assert.match(html, /Generated by TaoCode on 2026-10-06T00:00:00Z/, 'ExecutionBundle.properties:343')
  assert.match(html, /<style>/, '样式内联，不依赖外部资源')
})

test('HTML 报告转义用户代码里的标签（不注入）', () => {
  const bad = leaf('sm:x', '<img src=x>', 'failed')
  bad.path = '<img src=x>'
  const html = testResultsHtmlReport([bad], { runName: '<script>' })
  assert.ok(!html.includes('<img src=x>'), '测试名里的标签要被转义')
  assert.ok(!html.includes('<script>'), '标题里的标签要被转义')
  assert.match(html, /&lt;img src=x&gt;/)
})

test('接线：面板的导出走目录选择 + HTML 写盘通道，XML 档仍进剪贴板', () => {
  const panel = read('src/components/TestRunnerPanel.vue')
  assert.match(panel, /testResultsExport/, '面板要 import 本模块')
  assert.match(panel, /dialog\.pickDirectory/, 'HTML 档要开目录选择（上游是输出目录）')
  assert.match(panel, /app\.writeExportFiles/, '写盘走既有通道')
  assert.match(panel, /copyToClipboard\(xml\)/, 'XML 档仍是剪贴板出口（.xml 不在写盘白名单）')
  assert.match(panel, /TestResultsExportDialog/, '对话框要挂进模板')
})