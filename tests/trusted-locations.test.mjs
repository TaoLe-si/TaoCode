// 「受信任位置」设置页的纯规则（`src/trustedProjects.ts` 的清单增删改与呈现）：
// 对应上游 `TrustedHostsConfigurable`（id `trusted.hosts`，注册 groupId="appearance"，
// `intellij.platform.ide.impl.xml:783-786`）的清单语义 —— 新增去重、删除幂等、
// 「不信任（不再询问）」的行要能改回信任（上游按差集发 onProjectTrusted/onProjectUntrusted）。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  addTrustedLocation,
  parseTrustedLocationInput,
  removeTrustedLocation,
  setTrustedLocationState,
  trustedLocationRows,
} from '../src/trustedProjects.ts'

test('清单行：归一化路径并标出信任状态，同路径只留一行', () => {
  const rows = trustedLocationRows([
    { path: 'D:\\Work\\Proj\\', trusted: true },
    { path: 'd:/work/proj', trusted: false },   // 归一后与上一行同路径：后写的覆盖先写的
    { path: 'C:/other', trusted: true },
  ])
  assert.deepEqual(rows.map(row => row.path), ['d:/work/proj', 'c:/other'])
  assert.equal(rows[0].trusted, false)
  assert.equal(rows[0].label, '不信任（不再询问）')
  assert.equal(rows[1].label, '已信任')
  assert.deepEqual(trustedLocationRows(undefined), [], '没有清单时是空表，不抛')
})

test('输入校验：空白不算路径', () => {
  assert.deepEqual(parseTrustedLocationInput(''), { error: '请输入要信任的文件夹路径。' })
  assert.deepEqual(parseTrustedLocationInput('   '), { error: '请输入要信任的文件夹路径。' })
  assert.deepEqual(parseTrustedLocationInput(' D:/Work '), { path: 'd:/work' })
  assert.deepEqual(parseTrustedLocationInput('C:\\'), { path: 'c:/' }, '盘符根补回斜杠，仍是祖先')
})

test('添加：归一后去重，空/重复都给可见错误', () => {
  const first = addTrustedLocation([], 'D:/Work')
  assert.deepEqual(first.entries, [{ path: 'd:/work', trusted: true }])
  const duplicate = addTrustedLocation(first.entries, 'd:\\WORK\\')
  assert.equal(duplicate.error, '「d:/work」已在清单里。')
  assert.ok('error' in addTrustedLocation([], '  '))
  const appended = addTrustedLocation(first.entries, 'E:/libs')
  assert.deepEqual(appended.entries.map(entry => entry.path), ['d:/work', 'e:/libs'])
})

test('删除幂等，改状态按归一化路径就地替换', () => {
  const entries = [{ path: 'd:/work', trusted: true }, { path: 'e:/libs', trusted: false }]
  assert.deepEqual(removeTrustedLocation(entries, 'D:\\Work\\').map(entry => entry.path), ['e:/libs'])
  assert.deepEqual(removeTrustedLocation(entries, 'f:/nope'), entries, '不在清单里原样返回')
  const flipped = setTrustedLocationState(entries, 'E:\\libs', true)
  assert.deepEqual(flipped, [{ path: 'd:/work', trusted: true }, { path: 'e:/libs', trusted: true }])
  assert.deepEqual(entries, [{ path: 'd:/work', trusted: true }, { path: 'e:/libs', trusted: false }], '不改原数组')
  assert.deepEqual(setTrustedLocationState(entries, 'f:/nope', true), entries, '不存在的路径不改动')
})

test('清单与祖先判定连通：加进去的位置当场生效，移除后回到 unknown', () => {
  const stateOf = entries => {
    const rows = trustedLocationRows(entries)
    return rows.length ? rows[0].trusted : 'unknown'
  }
  const added = addTrustedLocation([], 'D:/work')
  assert.equal(stateOf(added.entries), true)
  const untrusted = setTrustedLocationState(added.entries, 'd:/work', false)
  assert.equal(stateOf(untrusted), false)
  assert.deepEqual(removeTrustedLocation(untrusted, 'd:/work'), [])
})
