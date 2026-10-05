// 根/SDK 呈现模型（`src/rootAppearance.ts`）的判据 —— 对照上游
// `openapi/roots/ui/FileAppearanceServiceImpl`、`util/{HttpUrl,JarSubfile,ValidFile}CellAppearance`、
// `SdkAppearanceServiceImpl`、`configuration/SidePanelCountLabel`。
import test from 'node:test'
import assert from 'node:assert/strict'

const {
  formatFileSize, splitJarSubfile, fileAppearance, jarSubfileAppearance, httpUrlAppearance,
  invalidUrlAppearance, pathCellAppearance, sdkAppearance, sidePanelCountLabel, sidePanelSeparator,
  rootRowAppearance, orderRootRows,
} = await import('../src/rootAppearance.ts')

test('文件大小格式化：B/KB/MB/GB 与坏值', () => {
  assert.equal(formatFileSize(0), '0 B')
  assert.equal(formatFileSize(999), '999 B')
  assert.equal(formatFileSize(1024), '1 KB')
  assert.equal(formatFileSize(1536), '1.5 KB')
  assert.equal(formatFileSize(5 * 1024 * 1024), '5 MB')
  assert.equal(formatFileSize(-1), '')
  assert.equal(formatFileSize(Number.NaN), '')
})

test('FileAppearanceServiceImpl 的分派顺序：jar 子文件 → http → 不存在 → 目录/二进制/普通文件', () => {
  const jar = pathCellAppearance('jar://C:/lib/a.jar!/com/x/Y.class')
  assert.equal(jar.kind, 'jarSubfile')
  assert.equal(jar.comment, 'com/x/Y.class')
  assert.equal(jar.tooltip, '归档 C:/lib/a.jar 中的 com/x/Y.class')
  const url = pathCellAppearance('https://example.com/docs')
  assert.equal(url.kind, 'httpUrl')
  assert.equal(url.comment, 'example.com')
  const missing = pathCellAppearance('src/gone.ts', { exists: false })
  assert.equal(missing.kind, 'invalid')
  assert.equal(missing.error, true)
  assert.match(missing.tooltip, /磁盘上不存在/)
  const excluded = pathCellAppearance('out/x.ts', { exists: false, excluded: true })
  assert.match(excluded.tooltip, /已被排除/)
  const dir = pathCellAppearance('src', { exists: true, directory: true })
  assert.equal(dir.icon, 'directory')
  const binary = pathCellAppearance('a.class', { exists: true, binary: true })
  assert.equal(binary.comment, '二进制文件')
  const file = pathCellAppearance('a.ts', { exists: true, size: 2048 })
  assert.equal(file.icon, 'validFile')
  assert.equal(file.comment, '2 KB')
  // 没查过的路径不报错（exists 未给 = 未知）。
  assert.equal(fileAppearance('unknown.ts').error, false)
})

test('jar 子文件与 http URL 的特判：不像的返回 null（调用方继续往下判）', () => {
  assert.deepEqual(splitJarSubfile('a.jar!/b.txt'), { archive: 'a.jar', inner: 'b.txt' })
  assert.deepEqual(splitJarSubfile('jar://C:/x/y.jar!/p/q'), { archive: 'C:/x/y.jar', inner: 'p/q' })
  assert.equal(splitJarSubfile('src/a.ts'), null)
  assert.equal(splitJarSubfile('!/x'), null)
  assert.equal(jarSubfileAppearance('src/a.ts'), null)
  assert.equal(httpUrlAppearance('ftp://x'), null)
  assert.equal(httpUrlAppearance('http://h/p').icon, 'httpUrl')
  const bad = invalidUrlAppearance('C:/x')
  assert.equal(bad.error, true)
  assert.match(bad.tooltip, /路径不存在或无法解析/)
})

test('SdkAppearanceServiceImpl：未配路径 = SDK 默认（检测），配了给路径与语言级别', () => {
  const detected = sdkAppearance('', 'JavaSE-17')
  assert.equal(detected.label, 'SDK 默认')
  assert.equal(detected.detected, true)
  assert.match(detected.comment, /语言服务/)
  const configured = sdkAppearance(' D:/jdk-21 ', 'JavaSE-1.8')
  assert.equal(configured.label, '项目 SDK')
  assert.equal(configured.detected, false)
  assert.match(configured.comment, /D:\/jdk-21/)
  assert.match(configured.comment, /语言级别 8/)
  assert.match(configured.tooltip, /项目 SDK：D:\/jdk-21/)
})

test('SidePanelCountLabel：计数 + 上限溢出；分隔条按可见性', () => {
  assert.deepEqual(sidePanelCountLabel(3), { text: '3', overflow: false, tooltip: '3 项' })
  assert.deepEqual(sidePanelCountLabel(-5), { text: '0', overflow: false, tooltip: '0 项' })
  const over = sidePanelCountLabel(12, 10)
  assert.equal(over.text, '12 / 10')
  assert.equal(over.overflow, true)
  assert.match(over.tooltip, /超出上限 10/)
  assert.deepEqual(sidePanelSeparator('  项目  '), { title: '项目', visible: true })
  assert.deepEqual(sidePanelSeparator('', false), { title: '', visible: false })
})

test('rootRowAppearance：文件计数 / 不存在（错误）/ 踩进排除目录（告警）', () => {
  const ok = rootRowAppearance({ path: 'src/main/java', kind: 'sources', fileCount: 7, missing: false })
  assert.equal(ok.count, '7')
  assert.equal(ok.tone, 'normal')
  assert.match(ok.tooltip, /7 个文件/)
  const missing = rootRowAppearance({ path: 'src/gone', kind: 'sources', fileCount: 0, missing: true })
  assert.equal(missing.tone, 'error')
  assert.match(missing.tooltip, /磁盘上不存在/)
  const excluded = rootRowAppearance({ path: 'build/gen', kind: 'generated', fileCount: 4, missing: false, excludedBy: 'build' })
  assert.equal(excluded.tone, 'warning')
  assert.match(excluded.tooltip, /排除的目录「build」/)
})

test('orderRootRows：告警态在前、同键按路径的稳定排序', () => {
  const rows = [
    { path: 'b/missing', kind: 'sources', fileCount: 0, missing: true },
    { path: 'c/excluded', kind: 'sources', fileCount: 2, missing: false, excludedBy: 'c' },
    { path: 'a/ok', kind: 'sources', fileCount: 5, missing: false },
    { path: 'a/also', kind: 'tests', fileCount: 1, missing: false },
  ]
  assert.deepEqual(orderRootRows(rows).map(row => row.path), ['a/also', 'a/ok', 'c/excluded', 'b/missing'])
})