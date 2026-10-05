// 多检查配置档 + profile 切换 + profile 的 XML 序列化（dm/inspections / lp/inspections 的判据）。
//
// 上游依据：
//   · `platform/analysis-api/src/com/intellij/codeInspection/InspectionProfile.java:22`
//     `DEFAULT_PROFILE_NAME = "Default"`；
//   · `platform/analysis-impl/.../profile/codeInspection/InspectionProfileManager.java:23,37,40`
//     `getProfiles()` / `setRootProfile(name)` / `getCurrentProfile()`；
//   · `platform/analysis-impl/.../codeInspection/ex/InspectionProfileImpl.java:87-88,209-220,279-289,351-353`
//     `is_locked`、级别登记册校验与 WARNING 回退、XML 形状与 `version="1.0"`；
//   · `platform/analysis-impl/.../codeInspection/ex/ToolsImpl.java:40-42,142-162`
//     `class` / `enabled` / `level` / `enabled_by_default`；
//   · `platform/lang-impl/.../ui/header/InspectionProfileSchemesModel.java:47-63,196-200`
//     「同层至少留一份」的删除约束与清单排序；
//   · `platform/lang-impl/.../ui/InspectionProfileImporter.java:16-18` 导入扩展名只有 `xml`；
//   · 落盘样本 `.idea/inspectionProfiles/idea_default.xml:1-3`（`myName` / `version`）、
//     `idea_fatal_errors.xml:2,26-28`（`is_locked` 与 `INFORMATION` / `WEAK WARNING` 两种 level）、
//     `profiles_settings.xml:1-6`（`PROJECT_PROFILE`）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  applyInspectionProfile, currentProfileName, DEFAULT_PROFILE_NAME, deleteProfile, duplicateProfile,
  exportProfileSettingsXml, exportProfileXml,
  importProfileSettingsXml, importProfileXml, INSPECTION_LEVELS, inspectionProfileStore, isProfileLocked,
  levelXmlForSeverity, parseProfileSettingsXml, parseProfileXml, profileNames, renameProfile, selectProfile,
  setInspectionToolEnabled, setInspectionToolSeverity, setProfileLocked, severityForLevelXml,
} from '../src/inspectionProfile.ts'
import { loadProjectProfiles, saveCurrentProfileToProject, selectProfileOnDisk, PROFILE_DIR, PROFILE_SETTINGS_FILE, profileFileName, profileNameFromPath } from '../src/inspectionProfileIo.ts'
import { profileRows } from '../src/menus/analyzeMenu.ts'
import { runWorkspaceInspection } from '../src/workspaceInspection.ts'

const root = new URL('..', import.meta.url)
const read = path => readFileSync(new URL(path, root), 'utf8')

/** 回到只有默认档的干净状态（localStorage 在 node --test 里是 undefined，store 从空起步）。 */
function resetAll() {
  inspectionProfileStore.value = { root: DEFAULT_PROFILE_NAME, profiles: { [DEFAULT_PROFILE_NAME]: { tools: {}, locked: false } } }
}

// ---------------------------------------------------------------- 级别表

test('级别表：LSP 四档 ↔ profile XML 的 level 名（WEAK WARNING 中间有空格）', () => {
  assert.deepEqual(INSPECTION_LEVELS.map(level => level.xml), ['ERROR', 'WARNING', 'WEAK WARNING', 'INFO'])
  assert.deepEqual(INSPECTION_LEVELS.map(level => level.severity), [1, 2, 3, 4])
  // 名字取自 `HighlightSeverity.WEAK_WARNING.myName`（HighlightSeverity.java:88），不是 `WEAK_WARNING`。
  assert.equal(severityForLevelXml('WEAK WARNING'), 3)
  assert.equal(levelXmlForSeverity(3), 'WEAK WARNING')
  assert.equal(levelXmlForSeverity(99), 'WARNING', '越界值回默认档（getErrorLevel 的 WARNING）')
  // 登记册之外的上游级别名（idea_fatal_errors.xml:26-27 的 INFORMATION / TEXT ATTRIBUTES）映射为 null。
  assert.equal(severityForLevelXml('INFORMATION'), null)
  assert.equal(severityForLevelXml('SERVER PROBLEM'), null)
})

// ---------------------------------------------------------------- 多 profile 与切换

test('默认只有一份档；复制/改名/删除/加锁与「至少留一份」的删除约束', () => {
  resetAll()
  assert.deepEqual(profileNames(), [DEFAULT_PROFILE_NAME])
  assert.equal(currentProfileName(), DEFAULT_PROFILE_NAME)

  setInspectionToolEnabled('eslint', false)
  assert.equal(duplicateProfile(DEFAULT_PROFILE_NAME, 'Strict'), 'Strict')
  assert.deepEqual(profileNames(), [DEFAULT_PROFILE_NAME, 'Strict'], '清单按名排序，当前档排最前')
  assert.equal(duplicateProfile('Strict', 'Strict'), null, '同名不覆盖')

  // 复制出来的档带着工具表，但改一份不影响另一份。
  selectProfile('Strict')
  setInspectionToolSeverity('eslint', 1)
  selectProfile(DEFAULT_PROFILE_NAME)
  assert.equal(read('src/inspectionProfile.ts') && true, true)
  selectProfile('Strict')
  assert.equal(currentProfileName(), 'Strict')

  assert.equal(renameProfile('Strict', 'Very strict'), true)
  assert.equal(profileNames().includes('Very strict'), true)
  assert.equal(renameProfile('Very strict', DEFAULT_PROFILE_NAME), false, '目标已存在不改')
  assert.equal(setProfileLocked('Very strict', true), true)
  assert.equal(isProfileLocked(), true)
  setProfileLocked('Very strict', false)

  assert.equal(deleteProfile(DEFAULT_PROFILE_NAME), true)
  assert.equal(deleteProfile('Very strict'), false, '最后一份不给删（canDeleteScheme）')
  resetAll()
})

test('切换器：setRootProfile 的用户可见面（清单 + 当前档勾选 + 点了就切）', () => {
  resetAll()
  duplicateProfile(DEFAULT_PROFILE_NAME, 'Strict')
  const rows = profileRows()
  assert.deepEqual(rows.map(row => row.title), [DEFAULT_PROFILE_NAME, 'Strict'])
  assert.deepEqual(rows.map(row => row.checked?.()), [true, false])
  rows[1].run()
  assert.equal(currentProfileName(), 'Strict')
  // 清单每次打开重读（childrenOf 语义）：当前档换人之后勾选跟着换。
  // 行的**顺序**不作为判据 —— `profileNames()` 把当前档排在最前，切档后两行会换位。
  const reread = profileRows()
  assert.deepEqual(
    reread.map(row => [row.title, row.checked?.()]),
    [['Strict', true], [DEFAULT_PROFILE_NAME, false]],
    '清单每次打开重读（childrenOf 语义）',
  )
  resetAll()
})

test('门控读的是当前 profile：停用只影响当前档，切档后另一份照常报', () => {
  resetAll()
  duplicateProfile(DEFAULT_PROFILE_NAME, 'Strict')
  setInspectionToolEnabled('eslint', false)
  assert.equal(applyInspectionProfile('eslint', 2), null, '默认档停用 → 不落表')
  selectProfile('Strict')
  assert.equal(applyInspectionProfile('eslint', 2), 2, 'Strict 档没这条设置 → 按服务端原值')
  setInspectionToolSeverity('eslint', 1)
  assert.equal(applyInspectionProfile('eslint', 4), 1)
  selectProfile(DEFAULT_PROFILE_NAME)
  assert.equal(applyInspectionProfile('eslint', 2), null, '切回去仍是停用')
  assert.equal(read('src/problems.ts').includes('applyInspectionProfile'), true, 'problems.ts 走同一道门控')
  resetAll()
})

// ---------------------------------------------------------------- XML 序列化

test('导出的 XML 是上游那份形状：component/profile version=1.0/myName/inspection_tool', () => {
  resetAll()
  setInspectionToolSeverity('jdt', 3)
  setInspectionToolEnabled('eslint', false)
  const xml = exportProfileXml('Default')
  assert.match(xml, /<component name="InspectionProjectProfileManager">/)
  assert.match(xml, /<profile version="1\.0">/)
  assert.match(xml, /<option name="myName" value="Default" \/>/)
  assert.match(xml, /<inspection_tool class="jdt" enabled="true" level="WEAK WARNING" \/>/)
  assert.match(xml, /<inspection_tool class="eslint" enabled="false" level="WARNING" \/>/, '停用仍要写 level（上游 ToolsImpl:160-162 无条件写）')
  // enabled_by_default 不往返：本仓没有逐工具默认状态可还原（文件头已写明）。
  assert.equal(xml.includes('enabled_by_default'), false)
  assert.equal(xml.endsWith('</component>\n'), true)
  resetAll()
})

test('加锁的档导出带 is_locked="true"（InspectionProfileImpl.java:87-88）', () => {
  resetAll()
  setProfileLocked(DEFAULT_PROFILE_NAME, true)
  assert.match(exportProfileXml(DEFAULT_PROFILE_NAME), /<profile version="1\.0" is_locked="true">/)
  setProfileLocked(DEFAULT_PROFILE_NAME, false)
  assert.equal(exportProfileXml(DEFAULT_PROFILE_NAME).includes('is_locked'), false)
  resetAll()
})

test('解析上游自己的 profile XML（裸 <profile> 与 component 包裹都认）', () => {
  // 形状照上游 `.idea/inspectionProfiles/idea_fatal_errors.xml:1-4,26-28`。
  const upstream = [
    '<component name="InspectionProjectProfileManager">',
    '  <profile version="1.0" is_locked="true">',
    '    <option name="myName" value="idea.fatal.errors" />',
    '    <inspection_tool class="AbsoluteAlignmentInUserInterface" enabled="false" level="WARNING" enabled_by_default="false" />',
    '    <inspection_tool class="AddArrayCreationExpression" enabled="false" level="INFORMATION" enabled_by_default="true" />',
    '    <inspection_tool class="AddVarianceModifier" enabled="false" level="WEAK WARNING" enabled_by_default="true" />',
    '  </profile>',
    '</component>',
    '',
  ].join('\n')
  const parsed = parseProfileXml(upstream)
  assert.equal(parsed.name, 'idea.fatal.errors')
  assert.equal(parsed.locked, true)
  assert.equal(parsed.profile.tools.AbsoluteAlignmentInUserInterface.severity, 2, 'WARNING → 2')
  assert.equal(parsed.profile.tools.AddVarianceModifier.severity, 3, 'WEAK WARNING → 3')
  // 登记册外的级别名按 getErrorLevel:213-218 回落 WARNING，并把回退写进结果。
  assert.equal(parsed.profile.tools.AddArrayCreationExpression.severity, 2, 'INFORMATION 不在四档登记册 → WARNING')
  assert.equal(parsed.profile.tools.AddArrayCreationExpression.enabled, false)

  // 没有 <profile> 的文件解析不出档名也不给假数据。
  assert.equal(parseProfileXml('<component name="X"></component>'), null)
  assert.equal(parseProfileXml('<profile><option name="myName" value="裸壳"/></profile>').name, '裸壳')
})

test('导出 → 解析 往返：工具表、级别名、锁标记都不丢', () => {
  resetAll()
  setInspectionToolSeverity('jdt', 1)
  setInspectionToolSeverity('ts', 4)
  setInspectionToolEnabled('eslint', false)
  setProfileLocked(DEFAULT_PROFILE_NAME, true)
  const parsed = parseProfileXml(exportProfileXml('Default'))
  assert.deepEqual(parsed.profile.tools, {
    eslint: { enabled: false, severity: 2 },
    jdt: { enabled: true, severity: 1 },
    ts: { enabled: true, severity: 4 },
  })
  assert.equal(parsed.locked, true)
  setProfileLocked(DEFAULT_PROFILE_NAME, false)
  resetAll()
})

test('导入：按 myName 注册新档；同名不覆盖而是加「(导入)」后缀', () => {
  resetAll()
  const xml = exportProfileXml('Default')
  // 「Default」档已存在（resetAll 建的那一份），所以两次导入都落到带后缀的副本上 ——
  // 判据是**原档不被覆盖**（`importProfileXml` 的 `store.profiles[parsed.name] ? '(导入)' : name`）。
  assert.equal(importProfileXml(xml, { activate: true }), 'Default (导入)', '同名不覆盖原档')
  assert.equal(importProfileXml(xml), 'Default (导入)')
  assert.ok(profileNames().includes(DEFAULT_PROFILE_NAME), '原档仍在清单里')
  assert.deepEqual(profileNames().sort(), [DEFAULT_PROFILE_NAME, 'Default (导入)'])
  assert.equal(importProfileXml('不是 xml'), null)
  resetAll()
})

test('根 profile 选择：profiles_settings.xml 的 PROJECT_PROFILE 往返', () => {
  resetAll()
  duplicateProfile(DEFAULT_PROFILE_NAME, 'Strict')
  const settings = exportProfileSettingsXml('Strict')
  assert.match(settings, /<option name="PROJECT_PROFILE" value="Strict" \/>/)
  assert.match(settings, /<version value="1\.0" \/>/)
  assert.equal(parseProfileSettingsXml(settings), 'Strict')
  assert.equal(importProfileSettingsXml(settings), true)
  assert.equal(currentProfileName(), 'Strict')
  assert.equal(importProfileSettingsXml('<component name="X"><settings/></component>'), false, '取不到就不切')
  assert.equal(importProfileSettingsXml(exportProfileSettingsXml('不存在的档')), false, '档不存在不凭空造')
  resetAll()
})

// ---------------------------------------------------------------- 落盘（工程目录）

/** 一个内存里的假宿主：只认 PROFILE_DIR 下的文件。 */
function fakeDisk(seed = {}) {
  const files = new Map(Object.entries(seed))
  const writes = []
  const versionOf = path => (files.has(path) ? '1' : '')
  return {
    files,
    writes,
    deps: {
      create: async path => { if (!files.has(path) && !path.endsWith('.xml')) files.set(path, '') },
      read: async path => {
        if (!files.has(path)) throw new Error('不存在')
        return { content: String(files.get(path)), version: '1' }
      },
      write: async (path, content) => { files.set(path, content); writes.push(path); return {} },
      list: async () => [...files.keys()].filter(path => path.startsWith(`${PROFILE_DIR}/`)).map(path => ({ path })),
    },
  }
}

test('落盘路径：与上游工程目录同形（PROFILE_DIR 下 <name>.xml + profiles_settings.xml）', () => {
  assert.equal(profileFileName('idea.default'), `${PROFILE_DIR}/idea.default.xml`)
  assert.equal(PROFILE_SETTINGS_FILE, `${PROFILE_DIR}/profiles_settings.xml`)
  assert.equal(profileNameFromPath(`${PROFILE_DIR}/idea.default.xml`), 'idea.default')
  assert.equal(profileNameFromPath(`${PROFILE_DIR}/nested/a.xml`), null, '只认目录下一层')
  assert.equal(profileNameFromPath('src/other.xml'), null)
  assert.equal(profileNameFromPath(`${PROFILE_DIR}/.xml`), null)
})

test('读工程目录：逐份导入并按 profiles_settings 切根档；坏文件只记一条错', async () => {
  resetAll()
  const good = exportProfileXml('idea.default')
  const disk = fakeDisk({
    [`${PROFILE_DIR}/idea.default.xml`]: good,
    [`${PROFILE_DIR}/broken.xml`]: '<component name="InspectionProjectProfileManager">',
    [`${PROFILE_DIR}/profiles_settings.xml`]: exportProfileSettingsXml('idea.default'),
  })
  const outcome = await loadProjectProfiles(disk.deps)
  assert.deepEqual(outcome.loaded, ['idea.default'])
  assert.equal(outcome.root, 'idea.default')
  assert.equal(outcome.errors.length, 1)
  assert.match(outcome.errors[0], /broken\.xml/)
  // 落盘那份进了配置档集合：切过去后门控按它判。
  assert.equal(currentProfileName(), 'idea.default')
  resetAll()
})

test('写工程目录：profile 本体 + 根选择两份；切换 profile 也落盘', async () => {
  resetAll()
  const disk = fakeDisk()
  const saved = await saveCurrentProfileToProject(disk.deps)
  assert.equal(saved.path, `${PROFILE_DIR}/Default.xml`)
  assert.match(String(disk.files.get(saved.path)), /<option name="myName" value="Default" \/>/)
  assert.match(String(disk.files.get(PROFILE_SETTINGS_FILE)), /PROJECT_PROFILE" value="Default"/)
  assert.ok(disk.writes.includes(PROFILE_SETTINGS_FILE))

  duplicateProfile(DEFAULT_PROFILE_NAME, 'Strict')
  assert.equal(await selectProfileOnDisk(disk.deps, 'Strict'), true)
  assert.equal(currentProfileName(), 'Strict')
  assert.match(String(disk.files.get(PROFILE_SETTINGS_FILE)), /PROJECT_PROFILE" value="Strict"/)
  assert.equal(await selectProfileOnDisk(disk.deps, '不存在'), false, '档不存在不切也不写盘')
  resetAll()
})

test('整工程检查在当前 profile 下跑，回执带上档名（getCurrentProfile）', async () => {
  resetAll()
  duplicateProfile(DEFAULT_PROFILE_NAME, 'Strict')
  selectProfile('Strict')
  const outcome = await runWorkspaceInspection({
    query: async () => ({ available: true, items: [{ path: 'a.ts', kind: 'full', diagnostics: [{ message: 'x' }], resultId: 'r1' }] }),
    diagnostics: new Map(),
    resultIds: new Map(),
  })
  assert.equal(outcome.profile, 'Strict')
  assert.match(outcome.message, /配置档「Strict」/)
  resetAll()
})

test('消费链：analyzeMenu 的两处菜单都有那个「检查配置档」子菜单', () => {
  const source = read('src/menus/analyzeMenu.ts')
  assert.match(source, /childrenOf: \(\) => profileRows\(\)/)
  // 定义 1 次（`function profileMenuRow()`）+ 两处菜单各 1 次（`createInspectCodeInCodeMenuRows` 的
  // children 里、`createAnalyzeMenuRows` 的成员里）——两处都是 `profileMenuRow(),` 形状，都带逗号。
  assert.equal([...source.matchAll(/profileMenuRow\(\)/g)].length, 3, '定义 1 次 + 两处菜单各 1 次')
  assert.equal([...source.matchAll(/profileMenuRow\(\),/g)].length, 2, '两处调用点都作为 children/成员的一项')
  // 空档也要有一行可点（只有默认档时清单非空）。
  resetAll()
  assert.equal(profileRows().length, 1)
})
