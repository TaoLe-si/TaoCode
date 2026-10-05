// 设置文件内容 CRC（`src/externalSystemSettingsCrc.ts`）：CRC-32 口径、`SettingsFilesStatus` 的
// updated/created/deleted、待比较集合（清单 ∪ 上次表）、`adjustCrc` 的「忽略即收下」那一半。
// 上游：`platform/external-system-impl/.../autoimport/AutoImportProjectSettingsFilesTracker.kt`
// 的 `calculateSettingsFilesCRC`（:56-66）、`SettingsFilesStatus`（:264-285）、
// `SettingsFilesAsyncSupplier.supply`（:378-382）、`adjustCrc`（:112-146）；
// CRC 本体 `util/CrcUtils.kt:34-38`（java.util.zip.CRC32）。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  acceptIgnoredSettingsFiles, calculateSettingsFilesCrc, settingsFileCrc, settingsFileEvents,
  settingsFilesCrcPaths, settingsFilesStatus,
} from '../src/externalSystemSettingsCrc.ts'

// java.util.zip.CRC32 的标准向量（多项式 0xEDB88320、初值全 1、末尾取反）。
test('CRC-32 与 java.util.zip.CRC32 同值（空串 = 0，与上游「跳过 crc==0」同一口径）', () => {
  assert.equal(settingsFileCrc(''), 0)
  assert.equal(settingsFileCrc('123456789'), 0xcbf43926)
  assert.equal(settingsFileCrc('a'), 0xe8b7be43)
  assert.notEqual(settingsFileCrc('build.gradle'), settingsFileCrc('build.gradle '))
})

test('读不到的与空文件不进 CRC 表（findFileByPath null / crc==0 两条，:60 与 :63）', async () => {
  const contents = { 'a/build.gradle': 'plugins { id "java" }', 'a/empty.gradle': '' }
  const crc = await calculateSettingsFilesCrc(['a/build.gradle', 'a/empty.gradle', 'a/gone.gradle'],
    async path => path in contents ? contents[path] : null)
  assert.deepEqual([...crc.keys()], ['a/build.gradle'])
  assert.equal(crc.get('a/build.gradle'), settingsFileCrc('plugins { id "java" }'))
})

test('SettingsFilesStatus：同路径 CRC 变了才 updated；新路径 created；消失 deleted', () => {
  const oldCrc = new Map([['a/build.gradle', 1], ['a/settings.gradle', 2]])
  const newCrc = new Map([['a/build.gradle', 1], ['a/settings.gradle', 3], ['b/build.gradle', 4]])
  const status = settingsFilesStatus(oldCrc, newCrc)
  assert.deepEqual(status.updated, ['a/settings.gradle'])
  assert.deepEqual(status.created, ['b/build.gradle'])
  assert.deepEqual(status.deleted, [])
  assert.equal(status.hasChanges, true)
  assert.equal(settingsFilesStatus(newCrc, newCrc).hasChanges, false)
  assert.deepEqual(settingsFilesStatus(newCrc, oldCrc).deleted, ['b/build.gradle'])
})

test('事件表按 updated → created → deleted 排（adjustCrc 的三段循环，:118-135）', () => {
  const oldCrc = new Map([['a/one', 1], ['a/two', 2]])
  const newCrc = new Map([['a/one', 9], ['a/three', 3]])
  assert.deepEqual(settingsFileEvents(settingsFilesStatus(oldCrc, newCrc)), [
    { path: 'a/one', event: 'UPDATE' },
    { path: 'a/three', event: 'CREATE' },
    { path: 'a/two', event: 'DELETE' },
  ])
})

test('待比较集合 = 当前清单 ∪ 上次表里的键（被删的设置文件也要能认出来）', () => {
  assert.deepEqual(settingsFilesCrcPaths(['a/build.gradle'], new Map([['a/gone.gradle', 1]])),
    ['a/build.gradle', 'a/gone.gradle'])
  assert.deepEqual(settingsFilesCrcPaths(['a/build.gradle', 'a/build.gradle'], new Map()), ['a/build.gradle'])
})

test('被忽略的事件把新 CRC 收下来、删除的摘掉键（adjustCrc，:112-146）', () => {
  const oldCrc = new Map([['a/one', 1], ['a/two', 2]])
  const newCrc = new Map([['a/one', 9], ['a/three', 3]])
  const next = acceptIgnoredSettingsFiles(oldCrc, newCrc, settingsFilesStatus(oldCrc, newCrc))
  assert.deepEqual([...next.entries()].sort(), [['a/one', 9], ['a/three', 3]])
})

test('忽略规则按事件逐条判：只有被判忽略的那几条进新表（isIgnoredSettingsFileEvent 逐事件调用）', async () => {
  const oldCrc = new Map([['a/one', 1]])
  const newCrc = new Map([['a/one', 9]])
  const status = settingsFilesStatus(oldCrc, newCrc)
  // 判据：这轮只有一个事件、它被忽略 ⇒ 旧表被收下 ⇒ 下一轮同内容不再算改动。
  const next = acceptIgnoredSettingsFiles(oldCrc, newCrc, status)
  assert.equal(settingsFilesStatus(next, newCrc).hasChanges, false)
})
