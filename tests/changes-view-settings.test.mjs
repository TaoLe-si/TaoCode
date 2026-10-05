// 提交面板那两个开关的跨会话存档（`src/changesViewSettings.ts`）。
// 上游：`platform/vcs-impl/shared/src/com/intellij/platform/vcs/impl/shared/changes/ChangesViewSettings.kt`
// 的接口（`:17-25`）、`@State(name="ChangesViewManager", storages=[WORKSPACE_FILE])`（`:27`）、
// 两个缺省（`:43` `groupingKeys = setOf(REPOSITORY_GROUPING)`、`:46` `showIgnored by property(false)`）、
// 集合语义（`:32` `toMutableSet()`）、属性名 `@Attribute("show_ignored")`（`:45`）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DIRECTORY_GROUPING_KEY, REPOSITORY_GROUPING_KEY, changesViewSettingsKey, defaultChangesViewSettings,
  groupByOfKeys, keysOfGroupBy, parseChangesViewSettings, serializeChangesViewSettings,
} from '../src/changesViewSettings.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(root, path), 'utf8')

test('存档键跟工程走（上游落在 WORKSPACE_FILE，按工作区根区分）', () => {
  assert.equal(changesViewSettingsKey('D:/proj'), 'taocode.vcs.changesView.D%3A%2Fproj')
  assert.notEqual(changesViewSettingsKey('D:/a'), changesViewSettingsKey('D:/b'))
})

test('缺省：分组为空集（不分组）+ 不显示忽略文件', () => {
  const stored = defaultChangesViewSettings()
  assert.deepEqual([...stored.groupingKeys], [])
  assert.equal(stored.showIgnored, false)
  // 上游缺省是 setOf(REPOSITORY_GROUPING)（:43）；本仓单根单仓库，分出来永远一组 ⇒ 等价缺省是空集。
  assert.equal(REPOSITORY_GROUPING_KEY, 'ChangesView.GroupBy.Repository')
  assert.equal(groupByOfKeys([REPOSITORY_GROUPING_KEY]), 'none')
})

test('分组键 ↔ 本仓那一档互转（集合取第一条已知键，未知键忽略）', () => {
  assert.equal(groupByOfKeys([DIRECTORY_GROUPING_KEY]), 'directory')
  assert.equal(groupByOfKeys([REPOSITORY_GROUPING_KEY, DIRECTORY_GROUPING_KEY]), 'directory')
  assert.equal(groupByOfKeys(['Some.Future.Grouping']), 'none')
  assert.deepEqual(keysOfGroupBy('directory'), [DIRECTORY_GROUPING_KEY])
  assert.deepEqual(keysOfGroupBy('none'), [])
})

test('序列化只写非缺省项；全是缺省时写空串', () => {
  assert.equal(serializeChangesViewSettings(defaultChangesViewSettings()), '')
  assert.equal(serializeChangesViewSettings({ groupingKeys: [], showIgnored: true }), '{"show_ignored":true}')
  assert.equal(serializeChangesViewSettings({ groupingKeys: [DIRECTORY_GROUPING_KEY], showIgnored: false }),
    '{"groupingKeys":["ChangesView.GroupBy.Directory"]}')
})

test('读回：两个拼写都收（show_ignored 属性名 / showIgnored 字段名）', () => {
  assert.equal(parseChangesViewSettings('{"show_ignored":true}').showIgnored, true)
  assert.equal(parseChangesViewSettings('{"showIgnored":true}').showIgnored, true)
  assert.equal(parseChangesViewSettings('{"show_ignored":"yes"}').showIgnored, false)
  const keys = parseChangesViewSettings('{"groupingKeys":["ChangesView.GroupBy.Directory"]}').groupingKeys
  assert.deepEqual([...keys], [DIRECTORY_GROUPING_KEY])
})

test('坏存档 / 垃圾键退回缺省，永不抛', () => {
  for (const raw of ['', null, undefined, 'not json', '[]', 'null', '{"groupingKeys":"oops"}']) {
    assert.deepEqual(parseChangesViewSettings(raw), defaultChangesViewSettings(), `raw=${raw}`)
  }
  assert.deepEqual([...parseChangesViewSettings('{"groupingKeys":[1,null,""]}').groupingKeys], [])
})

test('往返：写进去再读回来，两个字段都回来', () => {
  const stored = serializeChangesViewSettings({ groupingKeys: keysOfGroupBy('directory'), showIgnored: true })
  const back = parseChangesViewSettings(stored)
  assert.equal(groupByOfKeys(back.groupingKeys), 'directory')
  assert.equal(back.showIgnored, true)
})

test('接线：面板按工作区根读回存档，改动写回', () => {
  const panel = read('src/components/SourceControl.vue')
  assert.match(panel, /import \{[^}]*changesViewSettingsKey[^}]*\} from '\.\.\/changesViewSettings'/)
  assert.match(panel, /watch\(viewSettingsKey,[\s\S]*?\{ immediate: true \}\)/)
  assert.match(panel, /localStorage\.setItem\(viewSettingsKey\.value, raw\)/)
})
