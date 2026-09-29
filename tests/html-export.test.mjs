// 导出到 HTML（IDEA `FileExportGroup` › `ExportToHTML`）—— 纯逻辑 + 接线。
//
// 归档/写盘本身由原生 `export_file_test` 覆盖（扩展名白名单、绝对路径、父目录必须存在、上限）；
// 这里测的是"生成出来的 HTML 对不对"与"菜单/桥接/编辑器句柄是否真的接上"。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  EXPORT_HTML_FILTERS,
  EXPORT_SCOPES,
  escapeHtml,
  exportFailureMessage,
  exportResultMessage,
  fileUrl,
  htmlDocument,
  htmlExportFileName,
  htmlExportRelativePath,
  indexDocument,
  parentDirectories,
  scopeLabel,
} from '../src/htmlExport.ts'
import { mergeRuns } from '../src/htmlExportDom.ts'
import { createFileMenuRows } from '../src/menus/fileMenu.ts'
import { defaultExportToHtmlSettings, defaultProjectSettings } from '../src/settingsModel.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

test('范围值就是 PrintSettings 的那三个常量（1/2/4）', () => {
  assert.equal(EXPORT_SCOPES.none, 0)
  assert.equal(EXPORT_SCOPES.file, 1)
  assert.equal(EXPORT_SCOPES.selectedText, 2)
  assert.equal(EXPORT_SCOPES.directory, 4)
  assert.equal(scopeLabel(1), '当前文件')
  assert.equal(scopeLabel(2), '选中文本')
  assert.equal(scopeLabel(4), '当前目录')
  assert.equal(scopeLabel(0), '未选择')
})

test('输出文件名 = 原名 + .html（ExportToHTMLManager.java:335）', () => {
  assert.equal(htmlExportFileName('src/main.cpp'), 'main.cpp.html')
  assert.equal(htmlExportFileName('a\\b\\index.html'), 'index.html.html')
  assert.equal(htmlExportFileName('README'), 'README.html')
  // 目录范围：目录结构照搬，每层都加 .html
  assert.equal(htmlExportRelativePath('src/app/main.cpp', 'src'), 'app/main.cpp.html')
  assert.equal(htmlExportRelativePath('main.cpp', ''), 'main.cpp.html')
  assert.equal(htmlExportRelativePath('main.cpp', 'src'), 'main.cpp.html', '不在该目录下时退回文件名')
})

test('HTML 转义只动四个字符', () => {
  assert.equal(escapeHtml('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;')
  assert.equal(escapeHtml('普通文本'), '普通文本')
})

test('文档包含 doctype / utf-8 / 内联颜色 / 行号开关', () => {
  const lines = [
    [{ text: 'int main() {', color: 'rgb(200, 100, 0)', fontStyle: 'normal', fontWeight: '400' }],
    [],
    [{ text: '  return 0;', color: '', fontStyle: '', fontWeight: '' }],
  ]
  const withNumbers = htmlDocument({ title: 'main.cpp', lineNumbers: true, background: '#fff', foreground: '#000', fontFamily: 'monospace', fontSize: 13 }, lines)
  assert.ok(withNumbers.startsWith('<!DOCTYPE html>'), '要有 doctype')
  assert.ok(withNumbers.includes('charset="utf-8"'), '要声明 UTF-8')
  assert.ok(withNumbers.includes('color:rgb(200, 100, 0)'), '颜色要内联进去（导出物要能单独拷走）')
  assert.ok(withNumbers.includes('background: #fff'), '背景来自编辑器主题色')
  assert.equal((withNumbers.match(/class="ln"/g) ?? []).length, 3, '三行都要有行号')
  assert.ok(withNumbers.includes('&nbsp;'), '空行也要占一行')
  assert.ok(withNumbers.includes('int main() {'), '源码要原样出现')

  const withoutNumbers = htmlDocument({ title: 'x', lineNumbers: false, background: '#000', foreground: '#fff', fontFamily: 'monospace', fontSize: 13 }, lines)
  assert.ok(!withoutNumbers.includes('class="ln"'), '关掉行号就不该有行号列')
})

test('title 与内容都会被转义（不能因为文件名里有 <> 就产出坏 HTML）', () => {
  const html = htmlDocument({ title: '<script>', lineNumbers: false, background: '#fff', foreground: '#000', fontFamily: 'monospace', fontSize: 13 },
    [[{ text: '</script>', color: '', fontStyle: '', fontWeight: '' }]])
  assert.ok(!html.includes('<script>'), '标题里的尖括号要转义')
  assert.ok(!html.includes('</script>'), '内容里的尖括号要转义')
})

test('目录索引列出文件与子目录（子目录指向它自己的 index.html）', () => {
  const html = indexDocument('demo · src', [
    { name: 'app', href: 'app/index.html', directory: true },
    { name: 'main.cpp.html', href: 'main.cpp.html', directory: false },
  ])
  assert.ok(html.includes('href="app/index.html"'), '子目录要指向它的 index.html')
  assert.ok(html.includes('href="main.cpp.html"'))
  assert.ok(html.includes('&#128193;'), '目录有图标前缀')
})

test('父目录链（每一级都生成 index.html 时要按它分组）', () => {
  assert.deepEqual(parentDirectories('a/b/c'), ['a/b', 'a', ''])
  assert.deepEqual(parentDirectories('a'), [''])
  assert.deepEqual(parentDirectories(''), [''])
})

test('file:// 链接在 Windows 盘符下要多一条斜杠，否则浏览器打不开', () => {
  assert.equal(fileUrl('C:\\export\\index.html'), 'file:///C:/export/index.html')
  assert.equal(fileUrl('/tmp/index.html'), 'file:///tmp/index.html')
})

test('结果提示说清"带高亮几个、纯文本几个"（差异要如实说）', () => {
  const message = exportResultMessage({ scope: 4, directory: 'D:\\export', files: 5, highlighted: 2, plain: 3, indexFiles: 2, entry: 'D:\\export\\index.html' })
  assert.ok(message.includes('2 个带语法高亮'), '要说清带高亮的数量')
  assert.ok(message.includes('3 个是纯文本'), '没打开的文件的降级要说清')
  assert.ok(message.includes('2 个 index.html'))
  // 单文件导出不提这些
  const single = exportResultMessage({ scope: 1, directory: 'D:\\export', files: 1, highlighted: 1, plain: 0, indexFiles: 0, entry: 'D:\\export\\main.cpp.html' })
  assert.ok(!single.includes('纯文本') && !single.includes('index.html'))
  assert.ok(exportFailureMessage(new Error('写不进去'), 'D:\\x').includes('D:\\x'))
})

test('相邻同样式的文本段会合并（不然每个字符一个 span）', () => {
  const runs = mergeRuns([
    { text: 'a', color: 'red', fontStyle: 'normal', fontWeight: '400' },
    { text: 'b', color: 'red', fontStyle: 'normal', fontWeight: '400' },
    { text: 'c', color: 'blue', fontStyle: 'normal', fontWeight: '400' },
    { text: 'd', color: 'blue', fontStyle: 'normal', fontWeight: '400' },
  ])
  assert.deepEqual(runs.map(run => [run.text, run.color]), [['ab', 'red'], ['cd', 'blue']])
  assert.deepEqual(mergeRuns([{ text: '', color: '', fontStyle: '', fontWeight: '' }]), [], '空段丢掉')
})

test('导出设置是项目级，且默认值与 IDEA 的字段默认值一致', () => {
  assert.deepEqual(defaultExportToHtmlSettings, { scope: 0, includeSubdirectories: false, printLineNumbers: false, openInBrowser: false, outputDirectory: '' })
  assert.deepEqual(defaultProjectSettings.exportToHtml, defaultExportToHtmlSettings)
  // 原生侧：项目默认值 + 校验都在
  const schema = read('native/settings_schema.cpp')
  assert.ok(schema.includes('{"exportToHtml", {{"scope", 0}'), '原生项目默认值里要有 exportToHtml')
  assert.ok(schema.includes('void validate_export_to_html'), '要有校验函数')
  assert.ok(schema.includes('0 / 1 / 2 / 4'), '范围值只允许那四个')
})

test('文件菜单：导出组里挂着 ExportToHTML', () => {
  const rows = createFileMenuRows(fileMenuContext())
  const group = rows.find(row => row.id === 'file.exportGroup')
  assert.ok(group, '要有「导出」这一组（PlatformActions.xml:430-436 的 FileExportGroup）')
  assert.deepEqual(group.children.map(child => child.id), ['file.exportToHtml'])
  assert.equal(group.children[0].enabled(), true)
  assert.equal(createFileMenuRows(fileMenuContext({ isDesktop: false })).find(row => row.id === 'file.exportGroup').children[0].enabled(), false)
  // `Print` 没有宿主能力，不能造一行假的
  assert.ok(!rows.some(row => row.id === 'file.print'), 'Print 未实现就不该有菜单行')
})

test('编辑器句柄真的提供了导出需要的两样东西', () => {
  const tab = read('src/editorTab.ts')
  assert.match(tab, /exportStyledLines\(\): StyledLine\[\]/, '句柄要有 exportStyledLines')
  assert.match(tab, /selectionText\(\): string/, '句柄要有 selectionText')
  const editor = read('src/components/CodeEditor.vue')
  assert.match(editor, /exportStyledLines: \(\) => \(view \? readStyledLines\(view\) : \[\]\)/)
  assert.match(editor, /selectionText: \(\) => \{/)
  // DOM 读取放独立模块（编辑器组件已经贴着机检上限）
  assert.ok(read('src/htmlExportDom.ts').includes('export function readStyledLines'), 'readStyledLines 在 htmlExportDom.ts')
})

test('桥接与原生都有写导出文件这条方法，且预览里明确拒绝', () => {
  assert.ok(read('src/bridge.ts').includes("'app.writeExportFiles'"), 'Method union 里要有它')
  assert.ok(read('native/main.cpp').includes('case "app.writeExportFiles"_h:'), '原生里要有路由')
  const bridge = read('src/bridge.ts')
  assert.match(bridge, /app\.writeExportFiles'\) throw new BridgeError\('DESKTOP_REQUIRED'/, '浏览器预览要拒绝')
})

test('过滤器串成对（native parse_file_filters 的要求）', () => {
  const parts = EXPORT_HTML_FILTERS.split('|')
  assert.equal(parts.length % 2, 0)
  assert.ok(parts[1].includes('*.html'))
})

/** 文件菜单的 ctx 假件：这些行在**构造时**就会读若干 `.value`（如省电模式的文案），所以要给全。 */
function fileMenuContext(overrides = {}) {
  const noop = () => undefined
  return {
    workspace: { value: { root: 'D:/x' } }, working: { value: false }, dirty: { value: false },
    active: { value: null }, activePath: { value: '' }, allTabs: { value: [] },
    groups: { 0: { tabs: [] } }, focusedPane: { value: 0 }, closedTabsPerPane: [{}, {}],
    recentProjects: { value: [] }, isDesktop: true, powerSaveMode: { value: false },
    hasEditor: () => false, beginProject: noop, openWorkspace: noop, openManageRecents: noop,
    closeWorkspace: noop, saveAll: noop, createScratch: noop, closeTab: noop, reopenClosedTab: noop,
    closeAllTabsIn: noop, closeOtherTabsIn: noop, openEncoding: noop, toggleReadOnly: noop,
    convertLineSeparators: noop, openBinary: noop, openPlugins: noop, openSettings: noop,
    openProjectStructure: noop, quitApp: noop, forceReloadFromDisk: noop, notify: noop,
    importSettings: noop, exportSettings: noop, restoreDefaultSettings: noop, togglePowerSave: noop,
    exportToHtml: noop,
    ...overrides,
  }
}
