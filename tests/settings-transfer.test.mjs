// 设置的导出 / 导入 / 恢复默认（IDEA 文件菜单 `ExportImportGroup` + `PowerSaveGroup`）。
//
// 两条线都测：
//   ① 纯逻辑（文件名 / 文案 / 段落标签）—— 这些直接决定用户看到什么；
//   ② 接线（文件菜单里真的有那几行、桥接里有那几条方法、原生的读-确认-写顺序）。
// 归档本身的往返与"坏包在写盘前被拒"由原生 `settings_transfer_test` 覆盖。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  SETTINGS_ARCHIVE_EXTENSION,
  SETTINGS_ARCHIVE_FILTERS,
  archivePathProblem,
  ensureArchiveExtension,
  exportResultMessage,
  importConfirmMessage,
  importResultMessage,
  restoreConfirmMessage,
  restoreResultMessage,
  sectionLabel,
  settingsArchiveName,
  validateTransferSummary,
} from '../src/settingsTransfer.ts'
import { createFileMenuRows } from '../src/menus/fileMenu.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

test('归档文件名带日期，扩展名是 zip', () => {
  assert.equal(settingsArchiveName(new Date(2026, 8, 27)), 'taocode-settings-20260927.zip')
  // 个位数的月/日要补零（否则 2026-1-5 会变成 taocode-settings-202615.zip）
  assert.equal(settingsArchiveName(new Date(2026, 0, 5)), 'taocode-settings-20260105.zip')
  assert.ok(settingsArchiveName().endsWith(SETTINGS_ARCHIVE_EXTENSION))
})

test('过滤器串用 native 的 `名称|通配符` 格式，且认得出 zip', () => {
  const parts = SETTINGS_ARCHIVE_FILTERS.split('|')
  assert.equal(parts.length % 2, 0, '必须是「名称|通配符」成对出现（native parse_file_filters 的要求）')
  assert.ok(parts[1].includes('*.zip'), '第一组必须能选到 *.zip')
  assert.ok(SETTINGS_ARCHIVE_FILTERS.includes('所有文件'), '要有"所有文件"兜底')
})

test('段落标签把 JSON 键名换成人话', () => {
  assert.equal(sectionLabel('settings'), '编辑器设置')
  // native `empty_document()` 的键就是 `general`（旧写法 `preferences.general` 也认）
  assert.equal(sectionLabel('general'), '系统设置')
  assert.equal(sectionLabel('preferences.general'), '系统设置')
  assert.equal(sectionLabel('perProject'), '每个项目的设置')
  assert.equal(sectionLabel('whatever'), 'whatever', '不认识的段原样返回，不编一个假名字')
})

test('导入/导出的路径校验：只认 zip，扩展名可补', () => {
  assert.equal(archivePathProblem(''), '请选择设置归档。')
  assert.equal(archivePathProblem('   '), '请选择设置归档。')
  assert.equal(archivePathProblem('D:/x/taocode-settings-20260927.zip'), null)
  assert.equal(archivePathProblem('D:/x/PACK.ZIP'), null, '扩展名大小写不敏感')
  assert.match(archivePathProblem('D:/x/settings.7z'), /应当是 \.zip/)
  assert.equal(ensureArchiveExtension('D:/x/taocode-settings'), 'D:/x/taocode-settings.zip')
  assert.equal(ensureArchiveExtension('D:/x/taocode-settings.zip'), 'D:/x/taocode-settings.zip')
  assert.equal(ensureArchiveExtension('D:/x/TAOCODE.ZIP'), 'D:/x/TAOCODE.ZIP', '已有扩展名不重复追加')
})

test('归档摘要形状校验：坏摘要停在确认框之前', () => {
  const ok = { path: 'D:/a.zip', components: ['settings', 'general'], projects: 2, exportedAt: '2026-09-27T10:00:00' }
  assert.equal(validateTransferSummary(ok), null)
  assert.match(validateTransferSummary(null), /格式不对/)
  assert.match(validateTransferSummary([]), /格式不对/)
  assert.match(validateTransferSummary({ ...ok, path: '' }), /归档路径/)
  assert.match(validateTransferSummary({ ...ok, components: [] }), /没有任何可导入的设置段/)
  assert.match(validateTransferSummary({ ...ok, components: ['settings', ''] }), /设置段名不合法/)
  assert.match(validateTransferSummary({ ...ok, projects: -1 }), /项目数不合法/)
  assert.match(validateTransferSummary({ ...ok, projects: 1.5 }), /项目数不合法/)
  assert.match(validateTransferSummary({ ...ok, exportedAt: 5 }), /导出时间不合法/)
})

test('校验真的接在导入链路上：路径 → 摘要 → 才确认 → 才写盘', () => {
  const source = read('src/settingsTransfer.ts')
  const pathCheck = source.indexOf('archivePathProblem(path)')
  const readArchive = source.indexOf("'app.readSettingsArchive'")
  const summaryCheck = source.indexOf('validateTransferSummary(summary)')
  const confirm = source.indexOf('if (!confirm(importConfirmMessage(summary))) return')
  const write = source.indexOf("request('app.importSettings'")
  assert.ok(pathCheck >= 0 && summaryCheck >= 0, '两处校验都要在')
  assert.ok(pathCheck < readArchive, '路径校验在发请求之前')
  assert.ok(readArchive < summaryCheck && summaryCheck < confirm, '摘要校验在读到摘要之后、确认之前')
  assert.ok(confirm < write, '写盘仍要在确认之后')
  assert.match(source, /ensureArchiveExtension\(path\)/, '导出要补扩展名')
})

test('导出提示说清"写了多大、写到哪、含什么"', () => {
  const message = exportResultMessage({ path: 'D:/x/taocode-settings-20260927.zip', bytes: 4096, components: ['settings', 'preferences.general'] })
  assert.ok(message.includes('D:/x/taocode-settings-20260927.zip'), '要带路径')
  assert.ok(message.includes('4 KB'), '要带大小')
  assert.ok(message.includes('编辑器设置') && message.includes('系统设置'), '要说清含哪几段')
  // 没有 components 时也不能变成 "已导出设置：。"
  assert.ok(!exportResultMessage({ path: 'x' }).includes('：。'))
})

test('导入确认文案必须点明"覆盖什么 / 不动什么 / 不可撤销"', () => {
  const message = importConfirmMessage({ path: 'D:/a.zip', components: ['settings', 'preferences.general', 'perProject'], projects: 3, exportedAt: '2026-09-27T10:00:00' })
  assert.ok(message.includes('D:/a.zip'), '要带路径')
  assert.ok(message.includes('2026-09-27T10:00:00'), '要带导出时间（用户能分辨新旧包）')
  assert.ok(message.includes('3 个项目的设置'), '要说清涉及几个项目')
  assert.ok(message.includes('最近项目列表'), '要明确"最近项目不动"（与源码一致）')
  assert.ok(message.includes('不可撤销'), '要说清不可撤销')
  // 没有项目段时不提项目
  assert.ok(!importConfirmMessage({ path: 'x', components: ['settings'], projects: 0, exportedAt: '' }).includes('个项目的设置'))
})

test('导入与恢复默认的完成文案', () => {
  assert.ok(importResultMessage({ components: ['settings'], projects: 0 }).includes('编辑器设置'))
  assert.ok(importResultMessage({ components: ['perSettings'], projects: 2 }).includes('2 个项目'))
  assert.ok(restoreConfirmMessage().includes('不可撤销'))
  assert.ok(restoreConfirmMessage().includes('最近项目列表'), '恢复默认同样不碰最近项目')
  assert.equal(restoreResultMessage(), '已恢复默认设置。')
})

test('文件菜单里 ExportImportGroup 三项齐全且顺序照源码', () => {
  const rows = createFileMenuRows(fakeFileMenuContext())
  const group = rows.find(row => row.id === 'file.exportImport')
  assert.ok(group, '要有「导入/导出设置」这一组')
  assert.deepEqual(group.children.map(child => child.id), [
    'file.importSettings', 'file.exportSettings', 'file.exportImportRule', 'file.restoreDefaultSettings',
  ], '顺序照 PlatformActions.xml:419-424：导入 · 导出 · 分隔 · 恢复默认')
  const restore = group.children.find(child => child.rule !== true && child.id === 'file.restoreDefaultSettings')
  assert.ok(restore, '恢复默认必须在分隔之后')
})

test('ExportImportGroup 的行受"桌面端"与"忙"两个条件约束', () => {
  const rows = createFileMenuRows(fakeFileMenuContext({ isDesktop: false }))
  const group = rows.find(row => row.id === 'file.exportImport')
  for (const child of group.children.filter(item => item.rule !== true))
    assert.equal(child.enabled(), false, `${child.id} 在浏览器预览里应当是禁用的`)
  const busy = createFileMenuRows(fakeFileMenuContext({ working: { value: true } }))
  for (const child of busy.find(row => row.id === 'file.exportImport').children.filter(item => item.rule !== true))
    assert.equal(child.enabled(), false, `${child.id} 在忙的时候应当禁用`)
  const ready = createFileMenuRows(fakeFileMenuContext())
  for (const child of ready.find(row => row.id === 'file.exportImport').children.filter(item => item.rule !== true))
    assert.equal(child.enabled(), true, `${child.id} 在桌面端空闲时应当可用`)
})

test('PowerSaveGroup 的文案随开关翻转（IDEA 的 Toggleable）', () => {
  const on = createFileMenuRows(fakeFileMenuContext({ powerSaveMode: { value: true } })).find(row => row.id === 'file.togglePowerSave')
  assert.equal(on.title, '退出省电模式')
  // 从**同一个数组**里取（两次 createFileMenuRows 会产生两批不同的行对象，indexOf 找不到）
  const rows = createFileMenuRows(fakeFileMenuContext())
  const off = rows.find(row => row.id === 'file.togglePowerSave')
  assert.equal(off.title, '进入省电模式')
  // 分隔行紧跟在它前面（PlatformActions.xml:437 的 `<separator/>`）
  assert.equal(rows[rows.indexOf(off) - 1].id, 'file.powerSaveRule')
})

test('桥接里有那六条方法，原生里有那五条路由', () => {
  const bridge = read('src/bridge.ts')
  for (const method of ['app.exportSettings', 'app.readSettingsArchive', 'app.importSettings', 'app.resetSettings', 'dialog.pickFile', 'dialog.saveFile'])
    assert.ok(bridge.includes(`'${method}'`), `Method union 里要有 ${method}`)
  const main = read('native/main.cpp')
  for (const route of ['app.exportSettings', 'app.readSettingsArchive', 'app.importSettings', 'app.resetSettings', 'dialog.pickFile', 'dialog.saveFile'])
    assert.ok(main.includes(`case "${route}"_h:`), `原生里要有 ${route} 的路由`)
})

test('导入的顺序是「先读摘要 → 用户确认 → 才写盘」', () => {
  const source = read('src/settingsTransfer.ts')
  const summary = source.indexOf("'app.readSettingsArchive'")
  const confirm = source.indexOf('if (!confirm(importConfirmMessage(summary))) return')
  const write = source.indexOf("request('app.importSettings'")
  assert.ok(summary >= 0 && confirm >= 0 && write >= 0, '三处都要在')
  assert.ok(summary < confirm && confirm < write, '读摘要必须在确认之前、写盘必须在确认之后（坏包不能先落到配置里）')
  assert.doesNotMatch(source, /'app\.resetSettings', \{[^}]*path/, '恢复默认不能带路径参数（它复位的是本机设置）')
})

/** 文件菜单的 ctx 假件：只给新加的那几行会用到的字段，其余用足够宽松的默认值。 */
function fakeFileMenuContext(overrides = {}) {
  const noop = () => undefined
  return {
    workspace: { value: { root: 'D:/x' } }, working: { value: false }, dirty: { value: false },
    active: { value: null }, activePath: { value: '' }, allTabs: { value: [] },
    groups: { 0: { tabs: [] } }, focusedPane: { value: 0 }, closedTabsPerPane: [{}, {}],
    recentProjects: { value: [] }, isDesktop: true,
    hasEditor: () => false, beginProject: noop, openWorkspace: noop, openManageRecents: noop,
    closeWorkspace: noop, saveAll: noop, createScratch: noop, closeTab: noop, reopenClosedTab: noop,
    closeAllTabsIn: noop, closeOtherTabsIn: noop, openEncoding: noop, toggleReadOnly: noop,
    convertLineSeparators: noop, openBinary: noop, openPlugins: noop, openSettings: noop,
    openProjectStructure: noop, quitApp: noop, forceReloadFromDisk: noop, notify: noop,
    importSettings: noop, exportSettings: noop, restoreDefaultSettings: noop, togglePowerSave: noop,
    powerSaveMode: { value: false },
    ...overrides,
  }
}
