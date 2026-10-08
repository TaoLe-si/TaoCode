// 「更新方式」的工程级设置存储（`src/gitUpdateSettings.ts`）。
// 上游：`plugins/git4idea/shared/src/git4idea/config/GitVcsSettings.java`（`@State` 在 :40，
// SETTINGS_KEY 在 :43）、它的 State `GitVcsOptions.kt`（updateMethod :28-30、saveChangesPolicy :24-26）、
// 设置页那一组 `plugins/git4idea/backend/src/config/GitVcsPanel.kt:285-299`、
// 「不再显示」= `StandardOption.UPDATE`（`VcsConfiguration.java:89`，`OptionsAndConfirmations.java:77-81`，
// 落盘口径 `ProjectLevelVcsManagerSerialization.java:41`）。
// 文案 zh 行号取自 `localization-zh.jar:messages/GitBundle.properties`（本仓 build/zh-extract 解出的副本）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CLEAN_WORKING_TREE_ROW_LABEL, GIT_SETTINGS_STATE_NAME, SAVE_CHANGES_POLICY_OPTION_TAG,
  SHOW_UPDATE_OPTIONS_OPTION_TAG, UPDATE_METHOD_OPTION_TAG, UPDATE_METHOD_ROW_LABEL,
  UPDATE_SETTINGS_GROUP_TITLE, defaultGitUpdateSettings, gitUpdateSettingsKey, normalizeSaveChangesPolicy,
  normalizeUpdateMethod, parseGitUpdateSettings, readGitUpdateSettings, saveChangesPolicyRadioRows,
  serializeGitUpdateSettings, shouldShowUpdateOptions, updateMethodTitle, updateSettingsGroupModel,
  updateSettingsRadioRows, writeGitUpdateSettings,
} from '../src/gitUpdateSettings.ts'
import { UPDATE_OPTIONS_RADIO_ORDER, updateMethodTier } from '../src/vcsUpdateOptions.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(root, path), 'utf8')

test('作用域 = workspace 级：存档键按工作区根分，状态名是上游的 Git.Settings', () => {
  assert.equal(GIT_SETTINGS_STATE_NAME, 'Git.Settings', 'GitVcsSettings.java:43')
  assert.equal(gitUpdateSettingsKey('D:/proj'), 'taocode.vcs.gitUpdate.D%3A%2Fproj')
  assert.notEqual(gitUpdateSettingsKey('D:/a'), gitUpdateSettingsKey('D:/b'), '每个工程各存一份')
})

test('存档键名 = 上游 @OptionTag（UPDATE_TYPE / SAVE_CHANGES_POLICY）+ StandardOption.UPDATE 的 id', () => {
  assert.equal(UPDATE_METHOD_OPTION_TAG, 'UPDATE_TYPE', 'GitVcsOptions.kt:28')
  assert.equal(SAVE_CHANGES_POLICY_OPTION_TAG, 'SAVE_CHANGES_POLICY', 'GitVcsOptions.kt:25')
  assert.equal(SHOW_UPDATE_OPTIONS_OPTION_TAG, 'Update', 'VcsConfiguration.java:89 + Serialization:42-46')
})

test('缺省：更新方式 MERGE、清理策略 SHELVE、「不再显示」为假即还弹（缺省真）', () => {
  assert.deepEqual(defaultGitUpdateSettings(), {
    updateMethod: 'MERGE',       // GitVcsOptions.kt:30 by enum(UpdateMethod.MERGE)
    saveChangesPolicy: 'SHELVE', // GitVcsOptions.kt:26 by enum(GitSaveChangesPolicy.SHELVE)
    showUpdateOptions: true,     // OptionsAndConfirmations.java:80 没存过值时 return true
  })
})

test('序列化只写非缺省项（BaseState 跳过缺省 + if (!value)）；全缺省写空串', () => {
  assert.equal(serializeGitUpdateSettings(defaultGitUpdateSettings()), '')
  assert.equal(serializeGitUpdateSettings({ updateMethod: 'REBASE', saveChangesPolicy: 'SHELVE', showUpdateOptions: true }),
    '{"UPDATE_TYPE":"REBASE"}')
  assert.equal(serializeGitUpdateSettings({ updateMethod: 'MERGE', saveChangesPolicy: 'STASH', showUpdateOptions: true }),
    '{"SAVE_CHANGES_POLICY":"STASH"}')
  // 只有为假才落盘（上游那行 if (!value)）。
  assert.equal(serializeGitUpdateSettings({ updateMethod: 'MERGE', saveChangesPolicy: 'SHELVE', showUpdateOptions: false }),
    '{"Update":false}')
})

test('读回：三个键都收，且兼容驼峰拼写', () => {
  assert.equal(parseGitUpdateSettings('{"UPDATE_TYPE":"REBASE"}').updateMethod, 'REBASE')
  assert.equal(parseGitUpdateSettings('{"updateMethod":"REBASE"}').updateMethod, 'REBASE')
  assert.equal(parseGitUpdateSettings('{"SAVE_CHANGES_POLICY":"STASH"}').saveChangesPolicy, 'STASH')
  assert.equal(parseGitUpdateSettings('{"saveChangesPolicy":"STASH"}').saveChangesPolicy, 'STASH')
  assert.equal(parseGitUpdateSettings('{"Update":false}').showUpdateOptions, false)
  assert.equal(parseGitUpdateSettings('{"showUpdateOptions":false}').showUpdateOptions, false)
})

test('BRANCH_DEFAULT 是合法存档值（GitPushOperation.java:499-507 会读它）', () => {
  assert.equal(parseGitUpdateSettings('{"UPDATE_TYPE":"BRANCH_DEFAULT"}').updateMethod, 'BRANCH_DEFAULT')
  assert.equal(normalizeUpdateMethod('BRANCH_DEFAULT'), 'BRANCH_DEFAULT')
})

test('坏存档 / 认不出的值逐字段退回缺省，永不抛', () => {
  for (const raw of ['', null, undefined, 'not json', '[]', 'null', '{}', '{"UPDATE_TYPE":123}']) {
    assert.deepEqual(parseGitUpdateSettings(raw), defaultGitUpdateSettings(), `raw=${raw}`)
  }
  assert.equal(parseGitUpdateSettings('{"UPDATE_TYPE":"NOPE"}').updateMethod, 'MERGE')
  assert.equal(parseGitUpdateSettings('{"SAVE_CHANGES_POLICY":"NOPE"}').saveChangesPolicy, 'SHELVE')
  assert.equal(parseGitUpdateSettings('{"Update":"yes"}').showUpdateOptions, true, '非布尔假一律算还弹')
  assert.equal(normalizeUpdateMethod(null), 'MERGE')
  assert.equal(normalizeSaveChangesPolicy(undefined), 'SHELVE')
})

test('往返：写进去再读回来，三项都回来', () => {
  const stored = serializeGitUpdateSettings({ updateMethod: 'REBASE', saveChangesPolicy: 'STASH', showUpdateOptions: false })
  assert.deepEqual(parseGitUpdateSettings(stored),
    { updateMethod: 'REBASE', saveChangesPolicy: 'STASH', showUpdateOptions: false })
})

test('读写存储：缺存储 / getItem 抛 / setItem 抛都静默降级，不抛', () => {
  const memory = new Map()
  const store = { getItem: k => (memory.has(k) ? memory.get(k) : null), setItem: (k, v) => memory.set(k, v) }
  assert.deepEqual(readGitUpdateSettings(store, 'D:/p'), defaultGitUpdateSettings())
  assert.equal(writeGitUpdateSettings(store, 'D:/p', { updateMethod: 'REBASE', saveChangesPolicy: 'SHELVE', showUpdateOptions: true }), true)
  assert.equal(readGitUpdateSettings(store, 'D:/p').updateMethod, 'REBASE')
  assert.equal(readGitUpdateSettings(store, 'D:/other').updateMethod, 'MERGE', '另一个工程读不到')
  const throwing = { getItem: () => { throw new Error('x') }, setItem: () => { throw new Error('x') } }
  assert.deepEqual(readGitUpdateSettings(throwing, 'D:/p'), defaultGitUpdateSettings())
  assert.equal(writeGitUpdateSettings(throwing, 'D:/p', defaultGitUpdateSettings()), false)
  assert.deepEqual(readGitUpdateSettings(null, 'D:/p'), defaultGitUpdateSettings())
  assert.equal(writeGitUpdateSettings(null, 'D:/p', defaultGitUpdateSettings()), false)
})

test('「不再显示」喂给模型层：开关为真或按住 Shift 才弹（AbstractCommonUpdateAction.kt:37）', () => {
  const on = defaultGitUpdateSettings()
  assert.equal(shouldShowUpdateOptions(on), true)
  assert.equal(shouldShowUpdateOptions(on, true), true)
  const off = { ...on, showUpdateOptions: false }
  assert.equal(shouldShowUpdateOptions(off), false)
  assert.equal(shouldShowUpdateOptions(off, true), true, '按住 Shift 无条件弹')
})

test('设置页「更新方式」行：两个单选、标签是短名（不是对话框那句 presentation）', () => {
  const rows = updateSettingsRadioRows('MERGE')
  assert.deepEqual(rows.map(row => row.id), ['MERGE', 'REBASE'], 'GitVcsPanel.kt:288-289 / getUpdateMethods() :45')
  assert.deepEqual(rows.map(row => row.checked), [true, false])
  assert.equal(rows[0].title, updateMethodTier('MERGE').name, 'GitVcsPanel.kt:289 用 methodName')
  assert.equal(rows[0].title, 'Merge')
  assert.notEqual(rows[0].title, updateMethodTier('MERGE').presentation, '对话框用 presentation，两处不同')
  assert.deepEqual(updateSettingsRadioRows('REBASE').map(row => row.checked), [false, true])
  // zh 短名行号：合并 :1478、变基 :1480（settings.git.update.method.*）。
  assert.deepEqual(rows.map(row => row.zhLine), [1478, 1480])
})

test('设置页「清理工作树」行：枚举声明序 STASH 在前（GitSaveChangesPolicy.java:10,16）', () => {
  const rows = saveChangesPolicyRadioRows('SHELVE')
  assert.deepEqual(rows.map(row => row.id), ['STASH', 'SHELVE'])
  assert.deepEqual(rows.map(row => row.checked), [false, true])
  assert.deepEqual(rows.map(row => row.title), ['Stash', 'Shelve'])
  assert.deepEqual(rows.map(row => row.zhLine), [917, 916])
})

test('设置页「更新」组两行的行标签与标题，照 GitVcsPanel.kt:285-299', () => {
  const group = updateSettingsGroupModel(defaultGitUpdateSettings())
  assert.equal(group.title, UPDATE_SETTINGS_GROUP_TITLE)
  assert.equal(group.title, '更新')
  assert.equal(group.methodRow.label, '更新方法:')
  assert.equal(group.cleanWorkingTreeRow.label, '使用以下方法清理工作树:')
  assert.deepEqual(group.methodRow.rows.map(row => row.id), ['MERGE', 'REBASE'])
  assert.deepEqual(group.cleanWorkingTreeRow.rows.map(row => row.id), ['STASH', 'SHELVE'])
})

test('跨模块一致：设置页单选顺序与对话框单选顺序同源（都 = getUpdateMethods()）', () => {
  assert.deepEqual(updateSettingsRadioRows('MERGE').map(row => row.id), [...UPDATE_OPTIONS_RADIO_ORDER])
})

test('语义名兜底取自模型层那一档，不另抄表', () => {
  assert.equal(updateMethodTitle('REBASE'), updateMethodTier('REBASE').name)
  assert.throws(() => updateMethodTitle('NOPE'), /未知的更新方式/)
})

test('模块是纯逻辑：不 import Vue、不碰 DOM（零组件依赖）', () => {
  const source = read('src/gitUpdateSettings.ts')
  assert.doesNotMatch(source, /from ['"]vue['"]/)
  assert.doesNotMatch(source, /\bdocument\.|\bwindow\./)
  assert.doesNotMatch(source, /\blocalStorage\s*[.[]/, '存储经窄接口注入，模块自己不直接摸 localStorage')
})