// 「受信任位置」那张表其实是**两个存储并一张表**（pf/trusted 判词的第 ④ 项）。
// 上游基准：
//   · `platform/platform-impl/src/com/intellij/ide/impl/TrustedHostsConfigurable.kt:61-69`
//     —— `getMergedTrustedPaths()`：先 `TrustedPathsSettings`（用户手管），
//     后 `TrustedPaths.getExplicitlyTrustedPaths()`（确认框里当场答应过的）；
//   · 同文件 `:80-89` `applyMergedTrustedPaths(paths)`：按差集回写两个存储，
//     `paths.filter { it in settingsBefore || it !in explicitBeforeSet }`（`:88`）= 新出现的路径算用户手加的；
//   · 同文件 `:124-155` `trustedLocationConfigurable`（add / remove 的 ToolbarDecorator）
//     与 `:157-166` `getPathFromUser`（`TextFieldWithBrowseButton` + 目录描述件）。
// 本仓落点：`src/trustedProjects.ts` 的会话级那一档 + `trustedLocationRows` 的并集
//   + `applyMergedLocations` 的差集回写；组件 `src/components/TrustedLocationsSettingsPage.vue`。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  addTrustedLocation, applyMergedLocations, isProjectTrusted, rememberSessionTrust, replaceSessionTrust,
  sessionTrustEntries, trustedLocationRows,
} from '../src/trustedProjects.ts'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

// 会话级那份是模块内的存储，每条用例前后都清一遍，别互相串。
test('会话级那一档进出都是拷贝：改返回值不会动到内部存储', () => {
  replaceSessionTrust([])
  rememberSessionTrust('D:/Work/Proj', true)
  const snapshot = sessionTrustEntries()
  assert.deepEqual(snapshot.map(entry => entry.path), ['d:/work/proj'])
  snapshot.push({ path: 'e:/nope', trusted: true })
  snapshot[0].path = 'c:/mutated'
  assert.deepEqual(sessionTrustEntries().map(entry => entry.path), ['d:/work/proj'], '外部改数组/改元素都不该渗进来')
  replaceSessionTrust([])
})

test('并集顺序与来源标记：先设置里的、后确认框里的（TrustedHostsConfigurable.kt:66-69）', () => {
  replaceSessionTrust([{ path: 'c:/other', trusted: true }])
  const rows = trustedLocationRows([{ path: 'd:/work/proj', trusted: true }])
  assert.deepEqual(rows.map(row => `${row.path}/${row.source}`), ['d:/work/proj/settings', 'c:/other/explicit'])
  assert.equal(rows[1].label, '已信任')
  replaceSessionTrust([])
})

test('同一路径两个存储都有 ⇒ 只出一行，且是设置里那一份赢', () => {
  replaceSessionTrust([{ path: 'D:/Work/', trusted: true }])
  const rows = trustedLocationRows([{ path: 'd:/work', trusted: false }])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].source, 'settings')
  assert.equal(rows[0].label, '不信任（不再询问）', '持久清单写的是“不信任”，会话里答应过也不能把它洗白')
  replaceSessionTrust([])
})

test('差集回写：删掉会话那一行不会动持久清单，反之亦然（:80-89）', () => {
  replaceSessionTrust([])
  const persisted = [{ path: 'd:/work', trusted: true }, { path: 'e:/libs', trusted: false }]
  rememberSessionTrust('f:/session', true)
  const explicit = sessionTrustEntries()
  const afterRemoveSessionRow = applyMergedLocations(persisted, explicit, ['d:/work', 'e:/libs'])
  assert.deepEqual(afterRemoveSessionRow.entries.map(entry => entry.path), ['d:/work', 'e:/libs'])
  assert.deepEqual(afterRemoveSessionRow.session, [], '会话那一档只剩被删掉的那条 ⇒ 空')
  const afterRemovePersistedRow = applyMergedLocations(persisted, explicit, ['e:/libs', 'f:/session'])
  assert.deepEqual(afterRemovePersistedRow.entries.map(entry => entry.path), ['e:/libs'])
  assert.deepEqual(afterRemovePersistedRow.session.map(entry => entry.path), ['f:/session'], '删持久行不能把会话行一起删掉')
  replaceSessionTrust([])
})

test('表里新出现的路径算用户手加的，进持久清单（:88 的那个 ||）', () => {
  replaceSessionTrust([])
  const result = applyMergedLocations([{ path: 'd:/work', trusted: true }], [], ['d:/work', 'g:/added'])
  assert.deepEqual(result.entries.map(entry => entry.path), ['d:/work', 'g:/added'])
  assert.equal(result.entries[1].trusted, true, '在设置页里加的就是信任')
  assert.deepEqual(result.session, [])
})

test('并集真的参与判定：只在会话里答应过的路径同样放行', () => {
  replaceSessionTrust([])
  rememberSessionTrust('D:/Session/Only', true)
  const rows = trustedLocationRows([], sessionTrustEntries())
  assert.deepEqual(rows.map(row => row.path), ['d:/session/only'])
  assert.equal(isProjectTrusted('d:/session/only/child', sessionTrustEntries()), true, '会话档喂给判定函数就是放行')
  assert.equal(isProjectTrusted('d:/session/only/child', undefined), false, '没有这一档时仍然是拦住的')
  replaceSessionTrust([])
})

test('接线：设置页画的是并集，移除走差集回写', () => {
  const page = read('src/components/TrustedLocationsSettingsPage.vue')
  assert.match(page, /const rows = computed\(\(\) => trustedLocationRows\(props\.general\.trustedPaths, session\.value\)\)/)
  assert.match(page, /const merged = applyMergedLocations\(props\.general\.trustedPaths, session\.value, kept\)/)
  assert.match(page, /syncSession\(merged\.session\)/)
  assert.match(page, /@click="remove\(row\.path\)"/)
  assert.match(page, /@click="flip\(row\)"/)
  assert.match(page, /row\.source === 'explicit'/)
  assert.ok(!/removeTrustedLocation\(general\.trustedPaths/.test(page), '移除不再只写持久清单（那会把会话行当持久行删）')
})

test('接线：浏览…走目录描述件与选后复核（TrustedHostsConfigurable.kt:157-166）', () => {
  const page = read('src/components/TrustedLocationsSettingsPage.vue')
  assert.match(page, /chooseWithDescriptor\(chooserHost, withTitle\(singleDirDescriptor\(\), '选择要信任的文件夹'\), input\.value\)/)
  assert.match(page, /const chooserHost: FileChooserHost = \{/)
  assert.ok(!/request<string \| null>\('dialog\.pickDirectory', \{ title: '选择要信任的文件夹', initial: '' \}\)/.test(page),
    '不再裸调宿主对话框（绕开描述件就没有选后复核）')
  // 描述件那侧的复核确实存在（不是自夸）：
  const descriptor = read('src/fileChooserDescriptor.ts')
  assert.match(descriptor, /if \(problem\) throw new Error\(problem\)/)
})

test('addTrustedLocation 仍然只管持久清单（会话行不参与去重的写入）', () => {
  replaceSessionTrust([])
  rememberSessionTrust('d:/session', true)
  const added = addTrustedLocation([], 'D:/Session')
  assert.deepEqual(added.entries.map(entry => entry.path), ['d:/session'], '写进去的是持久清单那一份')
  const merged = trustedLocationRows(added.entries, sessionTrustEntries())
  assert.equal(merged.length, 1, '并起来只一行，来源标成设置里的那份')
  assert.equal(merged[0].source, 'settings')
  replaceSessionTrust([])
})
