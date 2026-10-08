// 判据 · **IDE 外壳的三条 EP**（`src/ideShellExtensionPoints.ts`，上游
// `com.intellij.projectViewSelectInTargetProvider` / `com.intellij.gotoFileCustomizer` /
// `com.intellij.gotoActionAliasMatcher` 三条；另外两条「无消费点故未声明」的见该文件末）。
//
// 钉四件事：
//   ① 三条 EP 的 id 与上游逐字一致，且已在宿主里声明；
//   ② 贡献者按 id 注册/注销生效、按语言过滤；
//   ③ **真实消费点**读 EP：`availableSelectInTargets`（`src/selectInTargets.ts`）、
//      `gotoByNameContributions` 的 file 档（`src/gotoByNameContributors.ts`）、
//      `scoreCommand`（`src/commandSearch.ts`）；
//   ④ bundled 三支真的在 EP 里，且不改变既有行为（六个 Select In 目标仍是一份）。
import test from 'node:test'
import assert from 'node:assert/strict'

import { EXTENSIONS } from '../src/extensionPoints.ts'
import {
  BUNDLED_GOTO_FILE_CUSTOMIZER_ID,
  BUILTIN_ACTION_ALIAS_MATCHER_ID,
  GOTO_ACTION_ALIAS_MATCHER_EP,
  GOTO_FILE_CUSTOMIZER_EP,
  LEGACY_PROJECT_VIEW_TARGET_PROVIDER_ID,
  PROJECT_VIEW_SELECT_IN_TARGET_PROVIDER_EP,
  actionAliasMatch,
  aliasMatchScore,
  filterGotoFileItems,
  gotoActionAliasMatchers,
  gotoFileAccepted,
  gotoFileCustomizers,
  projectViewSelectInTargetProviders,
  projectViewSelectInTargets,
  registerGotoActionAliasMatcher,
  registerGotoFileCustomizer,
  registerProjectViewSelectInTargetProvider,
} from '../src/ideShellExtensionPoints.ts'
// 真实消费点一：Select In 弹层取表。
import { availableSelectInTargets, selectInTargetRows, bundledSelectInTargets } from '../src/selectInTargets.ts'
// 真实消费点二：「转到文件」那一档的条目过滤。
import { gotoByNameContributions, registerGotoByNameContributor } from '../src/gotoByNameContributors.ts'
// 真实消费点三：「转到动作」的打分（别名那一档）。
import { rankCommands, scoreCommand } from '../src/commandSearch.ts'

const selectContext = (over = {}) => ({
  hasActiveFile: true, hasPath: true, inTree: true, isDesktop: true, hasBreadcrumbs: true,
  hasChange: false, hasWorkspace: true, ...over,
})

test('三条 EP 的 id 与上游逐字一致，且都已在宿主里声明', () => {
  assert.equal(PROJECT_VIEW_SELECT_IN_TARGET_PROVIDER_EP, 'com.intellij.projectViewSelectInTargetProvider')
  assert.equal(GOTO_FILE_CUSTOMIZER_EP, 'com.intellij.gotoFileCustomizer')
  assert.equal(GOTO_ACTION_ALIAS_MATCHER_EP, 'com.intellij.gotoActionAliasMatcher')
  for (const id of [PROJECT_VIEW_SELECT_IN_TARGET_PROVIDER_EP, GOTO_FILE_CUSTOMIZER_EP, GOTO_ACTION_ALIAS_MATCHER_EP]) {
    assert.equal(EXTENSIONS.hasExtensionPoint(id), true, `${id} 应当已声明`)
  }
  // 未声明的那两条「无消费点」EP 不该被声明（如实：宁缺勿假）
  assert.equal(EXTENSIONS.hasExtensionPoint('com.intellij.moduleRendererFactory'), false)
  assert.equal(EXTENSIONS.hasExtensionPoint('com.intellij.directoryProjectGenerator'), false)
  assert.equal(EXTENSIONS.hasExtensionPoint('com.intellij.projectTemplateFileProcessor'), false)
})

test('bundled 三支都在 EP 里，且既有行为不变', () => {
  const providerIds = projectViewSelectInTargetProviders().map(contribution => contribution.id)
  assert.equal(providerIds.includes(LEGACY_PROJECT_VIEW_TARGET_PROVIDER_ID), true)
  assert.equal(gotoFileCustomizers('java').map(c => c.id).includes(BUNDLED_GOTO_FILE_CUSTOMIZER_ID), true)
  assert.equal(gotoActionAliasMatchers().map(m => m.id).includes(BUILTIN_ACTION_ALIAS_MATCHER_ID), true)
  // 六个内建目标仍是六个（来源给的是同一批，消费点按 id 去重）
  const rows = selectInTargetRows(selectContext())
  assert.equal(rows.length, bundledSelectInTargets().length)
  assert.deepEqual(availableSelectInTargets(selectContext()).map(target => target.id),
    ['project', 'structure', 'navbar', 'commit', 'explorer', 'settings'])
})

test('真实消费点一：第三方来源的目标出现在 Select In 表里（分屏时 legacy 来源给空表）', () => {
  const provider = registerProjectViewSelectInTargetProvider({
    id: 'test.selectin.provider',
    getSelectInTargets: input => (input.workspaceRoot ? [{
      id: 'third-party-target', label: '第三方目标', weight: 50,
      canSelect: () => true, selectIn: () => {},
    }] : []),
  })
  try {
    const rows = selectInTargetRows(selectContext())
    assert.equal(rows.some(row => row.id === 'third-party-target'), true, '第三方目标要出现在弹层行里')
    // 分屏时 legacy 来源给空表（上游 `ProjectViewSelectInTargetProvider.kt:40-41`）；
    // 注意问的是**来源自己**，不是合并口（合并口会把别的来源也给出来）。
    const legacy = projectViewSelectInTargetProviders().find(c => c.id === LEGACY_PROJECT_VIEW_TARGET_PROVIDER_ID)
    assert.equal(legacy.getSelectInTargets({ workspaceRoot: 'w', splitView: true }).length, 0)
    assert.equal(legacy.getSelectInTargets({ workspaceRoot: 'w', splitView: false }).length > 0, true)
  } finally {
    provider.dispose()
  }
  assert.equal(selectInTargetRows(selectContext()).some(row => row.id === 'third-party-target'), false)
})

test('真实消费点二：转到文件的 isAccepted 过滤掉条目', () => {
  const contributor = {
    id: 'test.goto.file', model: 'file',
    getItemsByName: () => [
      { name: 'Keep.java', kind: 1, path: 'src/Keep.java', line: 0, character: 0 },
      { name: 'Drop.java', kind: 1, path: 'src/Drop.java', line: 0, character: 0 },
    ],
  }
  const handle = registerGotoByNameContributor(contributor)
  const customizer = registerGotoFileCustomizer({
    id: 'test.goto.file.customizer', languages: ['java'],
    isAccepted: item => !item.name.startsWith('Drop'),
  })
  try {
    const kept = gotoByNameContributions('file', '', '', 'application')
    assert.equal(kept.some(item => item.name === 'Keep.java'), true)
    assert.equal(kept.some(item => item.name === 'Drop.java'), false, '自定义器挡掉的条目不该出现')
    assert.equal(
      gotoFileAccepted({ path: '', language: '', items: [] }, { path: 'a', name: 'Drop.java', directory: false }, 'application'),
      false)
    assert.deepEqual(
      filterGotoFileItems({ path: '', language: '', items: [{ path: 'a', name: 'Keep.java', directory: false }] }, 'application')
        .map(item => item.name),
      ['Keep.java'])
  } finally {
    customizer.dispose()
    handle.dispose()
  }
})

test('真实消费点三：别名匹配器给「转到动作」加分', () => {
  const withoutAlias = scoreCommand('mv', { title: 'Rename', id: 'Rename' })
  assert.equal(withoutAlias, 0, '名字/关键字都不命中 ⇒ 0（本模块原来的口径）')
  const matcher = registerGotoActionAliasMatcher({
    id: 'test.alias', matchAction: (action, pattern) => (pattern === 'mv' && action.id === 'Rename' ? 'SYNONYM' : 'NONE'),
  })
  try {
    assert.equal(aliasMatchScore('SYNONYM'), 3)
    assert.equal(aliasMatchScore('NONE'), 0)
    assert.equal(actionAliasMatch({ id: 'Rename', text: '重命名' }, 'mv'), 'SYNONYM')
    assert.equal(actionAliasMatch({ id: 'Rename', text: '重命名' }, 'zz'), 'NONE')
    const ranked = rankCommands([
      { title: 'Rename', id: 'Rename' },
      { title: 'Refactor This', id: 'RefactorThis' },
    ], 'mv')
    assert.deepEqual(ranked.map(item => item.id), ['Rename'], '别名命中把 Rename 捞进表')
    assert.equal(scoreCommand('mv', { title: 'Rename', id: 'Rename' }), 3)
  } finally {
    matcher.dispose()
  }
  assert.deepEqual(rankCommands([{ title: 'Rename', id: 'Rename' }], 'mv'), [])
})

test('aliasMatchScore 六档单调（NAME 最高、NONE 为 0）', () => {
  assert.equal(aliasMatchScore('NAME') > aliasMatchScore('SYNONYM'), true)
  assert.equal(aliasMatchScore('SYNONYM') >= aliasMatchScore('DESCRIPTION'), true)
  assert.equal(aliasMatchScore('GROUP') >= 1, true)
  assert.equal(aliasMatchScore('NONE'), 0)
})
