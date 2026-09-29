// **布局档案**（IDEA `ToolWindowLayoutProfileProvider` + `ProjectFrameToolWindowLayoutService`）
// 与"布局是项目级的"这两件事的判据。
//
// 上游两条规则（`platform/platform-impl/src/com/intellij/toolWindow/ToolWindowLayoutProfileProvider.kt`）：
//   · `SEED_ONLY`：**只有**项目还没存过布局时，才把档案（= 出厂默认 + 覆盖）种进去；
//   · `FORCE_ONCE` + `migrationVersion`：存档版本比档案小就强推一次，之后写上新版本不再推。
// 本仓多一条**一次性迁移**：改版前布局是机器级的三键（`taocode.toolAnchors`/`toolOrder`/
// `hiddenStripeButtons`），第一次打开项目时把它迁进那个项目的布局并置标记，此后新项目按档案播种。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { nextTick, ref } from 'vue'
import {
  DEFAULT_PROJECT_FRAME_PROFILE, PROJECT_FRAME_PROFILES, layoutMigrationKey, projectFrameProfile, resolveProjectLayout,
} from '../src/toolLayoutProfiles.ts'
import { createToolWindowStripes } from '../src/toolWindowStripes.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

const stored = (windows = {}) => ({ windows })
const input = (extra = {}) => ({ stored: null, appliedVersion: 0, legacy: { layout: null, alreadyMigrated: true }, ...extra })

test('项目存过布局就不再动它（SEED_ONLY 的本义：上游 applyProjectFrameLayoutPolicy 里 SEED_ONLY 直接 return）', () => {
  const mine = stored({ files: { anchor: 'right' } })
  const result = resolveProjectLayout(input({ stored: mine }))
  assert.equal(result.reason, 'stored')
  assert.equal(result.persist, false, '不许覆盖用户的布局')
  assert.equal(result.writeAppliedVersion, null, 'SEED_ONLY 不写迁移版本')
  assert.equal(result.layout.windows.files?.anchor, 'right')
})

test('项目没存过布局 ⇒ 按档案播种并落盘', () => {
  const result = resolveProjectLayout(input({ stored: null }))
  assert.equal(result.reason, 'seeded-profile')
  assert.equal(result.persist, true)
})

test('FORCE_ONCE：已应用版本比档案旧才强推一次，推完记下版本（上游 MigrationHelper）', () => {
  const profile = { id: 'framework', applyMode: 'forceOnce', migrationVersion: 2,
    windows: { files: { anchor: 'right' }, notifications: { hidden: true } } }
  const forced = resolveProjectLayout(input({ stored: stored(), appliedVersion: 1, profile }))
  assert.equal(forced.reason, 'forced-profile')
  assert.equal(forced.layout.windows.files?.anchor, 'right', '档案的覆盖要生效')
  assert.equal(forced.layout.windows.notifications?.showStripeButton, false, 'hidden 覆盖也要生效')
  assert.equal(forced.writeAppliedVersion, 2, '推完要把版本写进迁移标记，下次不再推')
  const current = resolveProjectLayout(input({ stored: stored({ files: { anchor: 'left' } }), appliedVersion: 2, profile }))
  assert.equal(current.reason, 'stored', '版本已经跟上了，就不再动用户的东西')
  const seeded = resolveProjectLayout(input({ stored: null, appliedVersion: 2, profile }))
  assert.equal(seeded.reason, 'seeded-profile', '没存过就是播种（不论 applyMode）')
  assert.equal(seeded.writeAppliedVersion, 2, '没存过的项目播种时也把版本记上（否则每次打开都重推）')
})

test('旧版机器级布局只迁一次，之后的新项目按档案播种', () => {
  const legacy = { windows: { outline: { anchor: 'right', order: 0 } } }
  const first = resolveProjectLayout(input({ legacy: { layout: legacy, alreadyMigrated: false } }))
  assert.equal(first.reason, 'legacy-migration')
  assert.equal(first.layout.windows.outline?.anchor, 'right', '用户现有的布局不能被丢掉')
  assert.equal(first.migrated, true, '要置迁移标记')
  const second = resolveProjectLayout(input({ legacy: { layout: legacy, alreadyMigrated: true } }))
  assert.equal(second.reason, 'seeded-profile', '迁过一次之后，新项目按档案来')
  assert.equal(second.layout.windows.outline, undefined)
})

test('档案表与版本读取', () => {
  assert.equal(projectFrameProfile('default')?.id, 'default')
  assert.equal(projectFrameProfile('nope'), undefined)
  assert.deepEqual(PROJECT_FRAME_PROFILES.map(profile => profile.id), ['default'])
  assert.equal(DEFAULT_PROJECT_FRAME_PROFILE.applyMode, 'seedOnly', '上游 bean 的默认 applyMode 就是它')
  assert.equal(layoutMigrationKey('framework'), 'taocode.toolLayoutMigration:framework', '应用级、按档案记版本')
})

// --- 接线：布局真的按项目存、换项目真的换一套 ------------------------------------------------

function withStorage() {
  const values = new Map()
  const previous = globalThis.localStorage
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  }
  return { values, restore: () => { globalThis.localStorage = previous } }
}
const host = workspace => createToolWindowStripes({
  isDesktop: true, workspace, lspReady: ref(true), gradleAvailable: ref(true), explorer: ref(false), activeView: ref('files'),
})

test('布局按项目分开存：改一个项目的布局不影响另一个', async () => {
  const storage = withStorage()
  try {
    const workspace = ref({ root: 'A' })
    const stripes = host(workspace)
    stripes.setToolAnchor('files', 'right')
    const savedA = JSON.parse(storage.values.get('taocode.toolLayout:A'))
    assert.equal(savedA.windows.files?.anchor, 'right', '落在 A 的键上')
    assert.equal(storage.values.has('taocode.toolLayout:B'), false, '不许顺手给 B 写一份')

    workspace.value = { root: 'B' }
    await nextTick()
    assert.equal(stripes.toolAnchors.files, 'left', '换项目 ⇒ 换一套布局（B 还没存过 ⇒ 出厂默认）')
    assert.equal(stripes.toolAnchors.outline, 'left')

    workspace.value = { root: 'A' }
    await nextTick()
    assert.equal(stripes.toolAnchors.files, 'right', '换回 A 要恢复 A 的布局')
  } finally { storage.restore() }
})

test('旧版机器级布局在第一次打开项目时被迁进来（并且只迁一次）', () => {
  const storage = withStorage()
  try {
    // 改版前的三个键
    storage.values.set('taocode.toolAnchors', JSON.stringify({ outline: 'right', files: 'right' }))
    storage.values.set('taocode.toolOrder', JSON.stringify({ right: ['outline', 'files'] }))
    storage.values.set('taocode.hiddenStripeButtons', JSON.stringify(['bookmarks']))
    const stripes = host(ref({ root: 'A' }))
    assert.equal(stripes.toolAnchors.outline, 'right', '旧布局要被采纳，不能悄悄丢掉')
    assert.equal(stripes.toolAnchors.files, 'right')
    assert.ok(stripes.hiddenStripeButtons.has('bookmarks'), '隐藏集也一起迁')
    assert.equal(storage.values.get('taocode.toolLayoutMigrated'), '1', '要置迁移标记')
    assert.ok(storage.values.get('taocode.toolLayout:A'), '迁进来的那一份要落盘')

    const later = host(ref({ root: 'B' }))
    assert.equal(later.toolAnchors.outline, 'left', '迁过一次之后，新项目回到出厂默认（不再复制旧布局）')
  } finally { storage.restore() }
})

test('接线：布局只写项目级键，旧键只读不写', () => {
  const source = read('src/toolWindowStripes.ts')
  assert.match(source, /const projectLayoutKey = \(root: string\) => `taocode\.toolLayout:\$\{root\}`/)
  assert.match(source, /resolveProjectLayout\(\{/, '播种要走档案那套规则')
  assert.match(source, /watch\(\(\) => deps\.workspace\.value\?\.root \?\? null, root => applyProjectLayout\(root\)\)/,
    '换项目要换布局')
  // 旧键只出现在 readLegacyLayout 里（迁移读一次），任何 setItem 都不许再写它们。
  const writes = [...source.matchAll(/localStorage\.setItem\((LEGACY_[A-Z_]+)/g)].map(match => match[1])
  assert.deepEqual(writes, [], `旧键不许再被写：${writes.join(', ')}`)
  assert.match(source, /localStorage\.setItem\(LAYOUT_MIGRATED_KEY, '1'\)/, '迁移标记要写一次')
})
