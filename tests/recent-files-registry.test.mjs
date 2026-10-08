// rf/core 的**全局最近文件上限设置 + 来源提供者注册表 + 列表边界**判据
//（上游 `platform/recentFiles/` 一族；模块 `src/recentFilesRegistry.ts`）。
//
// 上游坐标是本机参考树 `D:/Backup/Downloads/intellij-community-master/intellij-community-master`
//（可用 `TAOCODE_REF_TREE` 覆盖；树不在时跳过那部分文本核对，纯逻辑断言照跑）。
//
// 钉六件事：
//   ① 三条 advancedSetting 的键名/默认值/注册出处/分组；
//   ② 解析与「历史容量 = 设置值 + 1」的淘汰方向；
//   ③ 四个 EP 的 qualifiedName 与内置提供者清单（含「只有接口没有实现」那一条）；
//   ④ 三个内置实现的可移植规则（diff 排除 / 路径文案 / 打开方式）；
//   ⑤ 三种类别的选择、去重与容量淘汰；
//   ⑥ 跨窗口/跨项目的宿主判据与作用域。
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  ADVANCED_SETTINGS_IDE_GROUP_KEY, DEFAULT_RECENT_FILES_LIMIT, DEFAULT_RECENT_LOCATIONS_LIMIT,
  DEFAULT_RECENT_PROJECTS_LIMIT, HISTORY_CAPACITY_HEADROOM, MAX_PROJECTS_IN_MAIN_MENU,
  RECENT_FILES_EXTENSION_POINT_IDS, RECENT_FILES_LIMIT_OPTION_TAG, RECENT_FILES_LIMIT_SETTING_ID,
  RECENT_FILES_LIMIT_SETTINGS, RECENT_FILES_LIMIT_TITLE_KEY, RECENT_FILES_MODEL_SCOPE,
  RECENT_FILES_PROVIDERS, RECENT_LOCATIONS_LIMIT_SETTING_ID, RECENT_PROJECTS_LIMIT_SETTING_ID,
  RECENT_FILE_KINDS, RECENT_FILE_SOURCES, SWITCHER_ELEMENTS_LIMIT,
  chooseKindToReadFrom, createRecentFilesProviderRegistry, diffFileExcludedFromRecentlyOpened,
  diffRecentFileOpenMode, excluderPredicates, historyCapacity, hostsRecentFilesModel,
  isIncludedInNavigationHistory, modelKindOf, openFilesInterleaved, parseRecentFilesLimit,
  recentFilePathText, recentFilesExtensionPointFor, recentFilesLimitIsDefault,
  recentFilesLimitSetting, recentFilesProvidersByFamily, recentFilesProvidersFromExtensions,
  recordRecentFiles, switcherFilesKind, trimToHistoryCapacity, trimToSwitcherLimit,
} from '../src/recentFilesRegistry.ts'
import { emptyRecentFilesState } from '../src/recentFilesModel.ts'
import { EXTENSIONS } from '../src/extensionPoints.ts'

const here = dirname(fileURLToPath(import.meta.url))
const REF = process.env.TAOCODE_REF_TREE || 'D:/Backup/Downloads/intellij-community-master/intellij-community-master'
const upstreamAvailable = existsSync(REF)

/**
 * 读上游一行/一段。树不在时返回 null —— 断言包在 `check` 里，
 * 纯逻辑部分不依赖它。
 */
function upstream(relative) {
  if (!upstreamAvailable) return null
  try { return readFileSync(join(REF, relative), 'utf8') } catch { return null }
}

/** 有上游树才跑这段核对；否则记为跳过。文本在**注册时**取好，回调里不再读全局。 */
function check(relative, name, body) {
  const text = upstream(relative)
  test(name, { skip: text === null ? '上游参考树不在（TAOCODE_REF_TREE）' : false }, () => {
    assert.ok(text, `读不到上游文件 ${relative}`)
    body(text)
  })
}

// ── ① 最大数设置：键名 / 默认值 / 出处 ────────────────────────────────────────────────

test('三条 advancedSetting 的 id 与默认值与上游注册行一致', () => {
  assert.equal(RECENT_FILES_LIMIT_SETTING_ID, 'ide.max.recent.files')
  assert.equal(RECENT_LOCATIONS_LIMIT_SETTING_ID, 'ide.max.recent.locations')
  assert.equal(RECENT_PROJECTS_LIMIT_SETTING_ID, 'ide.max.recent.projects')

  assert.equal(DEFAULT_RECENT_FILES_LIMIT, 50)
  assert.equal(DEFAULT_RECENT_LOCATIONS_LIMIT, 25)
  assert.equal(DEFAULT_RECENT_PROJECTS_LIMIT, 50)

  // 最近文件那一条的 OptionTag（值真身所在）。
  assert.equal(RECENT_FILES_LIMIT_OPTION_TAG, 'RECENT_FILES_LIMIT')
  assert.equal(RECENT_FILES_LIMIT_TITLE_KEY, 'advanced.setting.ide.max.recent.files')
  assert.equal(ADVANCED_SETTINGS_IDE_GROUP_KEY, 'group.advanced.settings.ide')
})

check('platform/platform-impl/resources/intellij.platform.ide.impl.xml',
  '三条设置注册在 intellij.platform.ide.impl.xml（service/property 与 xml 逐字一致）', xml => {
    assert.match(xml, /advancedSetting id="ide\.max\.recent\.files" default="50" groupKey="group\.advanced\.settings\.ide" service="com\.intellij\.ide\.ui\.UISettings"/)
    assert.match(xml, /advancedSetting id="ide\.max\.recent\.locations" default="25"/)
    assert.match(xml, /advancedSetting id="ide\.max\.recent\.projects" default="50" groupKey="group\.advanced\.settings\.ide"\/>/)
    // 最近文件那条的 property 在下一行。
    assert.match(xml, /property="recentFilesLimit"\/>/)
  })

check('platform/editor-ui-api/src/com/intellij/ide/ui/UISettingsState.kt',
  'UISettingsState 的 OptionTag 与默认值（RECENT_FILES_LIMIT=50 / RECENT_LOCATIONS_LIMIT=25）', state => {
    assert.match(state, /@get:OptionTag\("RECENT_FILES_LIMIT"\)\n\s+var recentFilesLimit: Int by property\(50\)/)
    assert.match(state, /@get:OptionTag\("RECENT_LOCATIONS_LIMIT"\)\n\s+var recentLocationsLimit: Int by property\(25\)/)
  })

check('platform/ide-core/resources/messages/ApplicationBundle.properties',
  '标题与分组文案（Maximum number of recent files / IDE）', bundle => {
    assert.match(bundle, /^advanced\.setting\.ide\.max\.recent\.files=Maximum number of recent files$/m)
    assert.match(bundle, /^group\.advanced\.settings\.ide=IDE$/m)
  })

test('三条设置描述表完整，字段与 xml 的 service/property 对应', () => {
  assert.equal(RECENT_FILES_LIMIT_SETTINGS.length, 3)
  for (const setting of RECENT_FILES_LIMIT_SETTINGS) {
    assert.equal(setting.type, 'int')
    assert.equal(setting.groupKey, ADVANCED_SETTINGS_IDE_GROUP_KEY)
    assert.match(setting.upstream, /intellij\.platform\.ide\.impl\.xml:\d+/)
  }
  const files = recentFilesLimitSetting('ide.max.recent.files')
  assert.equal(files.service, 'com.intellij.ide.ui.UISettings')
  assert.equal(files.property, 'recentFilesLimit')
  // 最近工程那条没有 service（值存在 advancedSettings 自己的 state 里）。
  const projects = recentFilesLimitSetting('ide.max.recent.projects')
  assert.equal(projects.service, '')
  assert.equal(projects.property, '')
  assert.equal(recentFilesLimitSetting('nope'), null)
})

test('「改过没改过」的判据 = 与默认值比较（AdvancedSettingsImpl 同口径）', () => {
  assert.equal(recentFilesLimitIsDefault(50), true)
  assert.equal(recentFilesLimitIsDefault(51), false)
})

// ── ② 解析与历史容量 ─────────────────────────────────────────────────────────────────

test('上限解析：接受任意整数（上游控件无区间），坏输入回退默认', () => {
  assert.equal(parseRecentFilesLimit('50'), 50)
  assert.equal(parseRecentFilesLimit('  7 '), 7)
  assert.equal(parseRecentFilesLimit('-3'), -3)
  assert.equal(parseRecentFilesLimit(12), 12)
  // 上游 RowImpl 只校验「是不是数字」，没有 range ⇒ 本仓同样不加上下限。
  assert.equal(parseRecentFilesLimit('0'), 0)
  // 坏输入（空串 / 小数 / 乱码 / null / 对象）回退默认值。
  assert.equal(parseRecentFilesLimit(''), DEFAULT_RECENT_FILES_LIMIT)
  assert.equal(parseRecentFilesLimit('1.5'), DEFAULT_RECENT_FILES_LIMIT)
  assert.equal(parseRecentFilesLimit('abc'), DEFAULT_RECENT_FILES_LIMIT)
  assert.equal(parseRecentFilesLimit(null), DEFAULT_RECENT_FILES_LIMIT)
  assert.equal(parseRecentFilesLimit({}), DEFAULT_RECENT_FILES_LIMIT)
  assert.equal(parseRecentFilesLimit('9', 3), 9)
})

test('历史容量 = 设置值 + 1，淘汰从最旧那端（EditorHistoryManager.trimToSize 口径）', () => {
  assert.equal(HISTORY_CAPACITY_HEADROOM, 1)
  assert.equal(historyCapacity(50), 51)
  assert.equal(historyCapacity(0), 1)
  // 负数是上游没有守卫的洞（本仓夹到 1，不死循环）。
  assert.equal(historyCapacity(-5), 1)

  // 本仓三张表「最新在前」⇒ 保留表头、丢表尾（= 上游 removeAt(0) 的镜像）。
  // 设置 2 ⇒ 容量 3，三条都在。
  assert.deepEqual(trimToHistoryCapacity(['new', 'mid', 'old'], 2), ['new', 'mid', 'old'])
  // 设置 1 ⇒ 容量 2，最旧的 'old' 被丢。
  assert.deepEqual(trimToHistoryCapacity(['new', 'mid', 'old'], 1), ['new', 'mid'])
  assert.deepEqual(trimToHistoryCapacity(['a'], 50), ['a'])
})

check('platform/platform-impl/src/com/intellij/openapi/fileEditor/impl/EditorHistoryManager.kt',
  '容量读的是 recentFilesLimit + 1，从 index 0（最旧）开始删', history => {
    assert.match(history, /val limit = UISettings\.getInstance\(\)\.recentFilesLimit \+ 1/)
    assert.match(history, /while \(entries\.size > limit\) \{\n\s+entries\.removeAt\(0\)\.destroy\(\)/)
  })

test('弹层行数上限与存储容量是两个不同的上限', () => {
  // 弹层：SWITCHER_ELEMENTS_LIMIT = 30（FileSwitcherApi.kt:101）。
  assert.equal(SWITCHER_ELEMENTS_LIMIT, 30)
  const long = Array.from({ length: 40 }, (_, i) => `f${i}`)
  assert.equal(trimToSwitcherLimit(long).length, 30)
  assert.deepEqual(trimToSwitcherLimit(['a', 'b'], 1), ['a'])
  assert.deepEqual(trimToSwitcherLimit(['a'], 0), [])
  // 存储容量跟设置走（50+1），与 30 无关。
  assert.notEqual(historyCapacity(DEFAULT_RECENT_FILES_LIMIT), SWITCHER_ELEMENTS_LIMIT)
})

check('platform/recentFiles/shared/src/com/intellij/platform/recentFiles/shared/FileSwitcherApi.kt',
  'SWITCHER_ELEMENTS_LIMIT 是 30', api => {
    assert.match(api, /const val SWITCHER_ELEMENTS_LIMIT: Int = 30/)
  })

// ── ③ EP 与提供者清单 ────────────────────────────────────────────────────────────────

test('四个 EP 的 qualifiedName 与上游声明逐字一致', () => {
  assert.deepEqual(RECENT_FILES_EXTENSION_POINT_IDS, {
    excluder: 'com.intellij.recentFiles.excluder',
    presentationContributor: 'com.intellij.recentFiles.presentationContributor',
    navigator: 'com.intellij.recentFiles.navigator',
    advertisementProvider: 'com.intellij.recentFiles.advertisementProvider',
  })
  // 族 → EP 的映射；模块外的族没有 EP。
  assert.equal(recentFilesExtensionPointFor('excluder'), 'com.intellij.recentFiles.excluder')
  assert.equal(recentFilesExtensionPointFor('searchEverywhere'), null)
  assert.equal(recentFilesExtensionPointFor('projects'), null)
})

check('platform/recentFiles/shared/resources/intellij.platform.recentFiles.xml',
  'shared 模块声明了 excluder 与 presentationContributor 两条 EP', shared => {
    assert.match(shared, /qualifiedName="com\.intellij\.recentFiles\.excluder"/)
    assert.match(shared, /qualifiedName="com\.intellij\.recentFiles\.presentationContributor"/)
  })

check('platform/recentFiles/frontend/resources/intellij.platform.recentFiles.frontend.xml',
  'frontend 模块声明了 navigator 与 advertisementProvider 两条 EP，且广告位没有实现', frontend => {
    assert.match(frontend, /qualifiedName="com\.intellij\.recentFiles\.navigator"/)
    assert.match(frontend, /qualifiedName="com\.intellij\.recentFiles\.advertisementProvider"/)
    // 只有 extensionPoint 声明行，没有任何 <recentFiles.advertisementProvider implementation=…>。
    assert.doesNotMatch(frontend, /<recentFiles\.advertisementProvider\s+implementation=/)
  })

test('内置提供者清单：每条都指得到上游行，且四个 EP 族各有档位', () => {
  assert.ok(RECENT_FILES_PROVIDERS.length >= 14)
  for (const provider of RECENT_FILES_PROVIDERS) {
    assert.ok(provider.id, '提供者要有 id')
    assert.match(provider.upstream, /\.(kt|java|xml):\d+/, `${provider.id} 的 upstream 要指到 文件:行号`)
  }
  // 四个 EP 族都非空。
  for (const family of ['excluder', 'presentationContributor', 'navigator', 'advertisementProvider']) {
    assert.ok(recentFilesProvidersByFamily(family).length > 0, `${family} 要有提供者描述`)
  }
  // 广告位那一条：接口在、实现不在（全树零注册）。
  const ad = recentFilesProvidersByFamily('advertisementProvider')
  assert.equal(ad.length, 1)
  assert.equal(ad[0].builtin, false)
})

check('platform/vcs-impl/frontend/resources/intellij.platform.vcs.impl.frontend.xml',
  'vcs-impl 注册了 DiffRecentFilesNavigator 与 DiffRecentFilesExcluder', vcs => {
    assert.match(vcs, /<recentFiles\.navigator implementation="com\.intellij\.platform\.vcs\.impl\.frontend\.diff\.DiffRecentFilesNavigator"\/>/)
    assert.match(vcs, /<recentFiles\.excluder implementation="com\.intellij\.platform\.vcs\.impl\.frontend\.diff\.DiffRecentFilesExcluder"\/>/)
  })

check('platform/recentFiles/backend/resources/intellij.platform.recentFiles.backend.xml',
  'backend 注册了 BackendRecentFilePathContributor', backend => {
    assert.match(backend, /<recentFiles\.presentationContributor implementation="com\.intellij\.platform\.recentFiles\.backend\.BackendRecentFilePathContributor"\/>/)
  })

test('注册表可挂第三方、可覆盖、可按族只取 builtin', () => {
  const registry = createRecentFilesProviderRegistry()
  assert.equal(registry.has('DiffRecentFilesExcluder'), true)
  assert.equal(registry.byId('DiffRecentFilesExcluder').family, 'excluder')
  assert.equal(registry.byId('nope'), null)

  // 第三方按同一 id 挂（覆盖）。
  registry.register({ id: 'DiffRecentFilesExcluder', family: 'excluder', extensionPoint: null, builtin: true, upstream: 'x:1' })
  assert.equal(registry.byId('DiffRecentFilesExcluder').upstream, 'x:1')
  // 新的自定义提供者。
  registry.register({ id: 'MyExcluder', family: 'excluder', extensionPoint: null, builtin: true, upstream: 'y:2' })
  assert.equal(registry.builtinOf('excluder').length, 2)
  // 注销。
  assert.equal(registry.unregister('MyExcluder'), true)
  assert.equal(registry.unregister('MyExcluder'), false)

  // 只取 builtin：广告位那条不算。
  const adOnly = createRecentFilesProviderRegistry()
  assert.equal(adOnly.builtinOf('advertisementProvider').length, 0)
})

// ── ④ 三个内置实现的规则 ─────────────────────────────────────────────────────────────

test('diff 文件排除：三档设置 + 非 diff 从不排除（DiffRecentFilesExcluder 口径）', () => {
  // IncludeInNavigationHistory 的默认值 OnlyIfOpen（DiffSettingsHolder.kt:29）。
  assert.equal(isIncludedInNavigationHistory('Always', false), true)
  assert.equal(isIncludedInNavigationHistory('OnlyIfOpen', true), true)
  assert.equal(isIncludedInNavigationHistory('OnlyIfOpen', false), false)
  assert.equal(isIncludedInNavigationHistory('Never', true), false)
  // 未知档回退 OnlyIfOpen。
  assert.equal(isIncludedInNavigationHistory('???', true), true)
  assert.equal(isIncludedInNavigationHistory('???', false), false)

  // 非 diff 文件从不排除（`:12`）。
  assert.equal(diffFileExcludedFromRecentlyOpened('Never', false, false), false)
  assert.equal(diffFileExcludedFromRecentlyOpened('Never', true, true), true)
  assert.equal(diffFileExcludedFromRecentlyOpened('Always', false, true), false)
  assert.equal(diffFileExcludedFromRecentlyOpened('OnlyIfOpen', false, true), true)
  assert.equal(diffFileExcludedFromRecentlyOpened('OnlyIfOpen', true, true), false)
})

check('platform/diff-impl/src/com/intellij/diff/impl/DiffSettingsHolder.kt',
  'IncludeInNavigationHistory 三档与默认 OnlyIfOpen', holder => {
    assert.match(holder, /enum class IncludeInNavigationHistory \{\n\s+Always,\n\s+OnlyIfOpen,\n\s+Never;/)
    assert.match(holder, /IS_INCLUDED_IN_NAVIGATION_HISTORY: IncludeInNavigationHistory = IncludeInNavigationHistory\.OnlyIfOpen/)
  })

test('排除器折成谓词：pinned 表与 opened 表同一条打开规则，edited 只认自己的方法', () => {
  const specs = [{ id: 'noVendor', excludesRecentlyOpened: (_k, p) => p.includes('/vendor/') }]
  const predicates = excluderPredicates(specs, { mode: 'OnlyIfOpen', fileIsOpen: false })
  assert.equal(predicates.length, 1)
  const pred = predicates[0]
  assert.equal(pred('recentlyOpened', 'src/a.ts'), false)
  assert.equal(pred('recentlyOpened', '/vendor/x.ts'), true)
  assert.equal(pred('recentlyOpenedUnpinned', '/vendor/x.ts'), true)
  // 没给 excludesRecentlyEdited ⇒ 从不从「最近编辑」里排除（上游默认 false）。
  assert.equal(pred('recentlyEdited', '/vendor/x.ts'), false)
  // diff 文件按那一档设置排除。
  assert.equal(pred('recentlyOpened', 'change.diff'), true)
})

check('platform/recentFiles/shared/src/com/intellij/platform/recentFiles/shared/RecentFilesExcluder.kt',
  '排除器两个方法：opened 必填、edited 默认 false', excluder => {
    assert.match(excluder, /fun isExcludedFromRecentlyOpened\(project: Project, file: VirtualFile\): Boolean/)
    assert.match(excluder, /fun isExcludedFromRecentlyEdited\(project: Project, file: VirtualFile\): Boolean = false/)
    assert.match(excluder, /RecentFileKind\.RECENTLY_EDITED -> ext\.isExcludedFromRecentlyEdited/)
  })

test('路径文案：无同名文件不显示；工程内相对、主目录 ~、其余绝对', () => {
  // 没有同名文件 ⇒ null（`:31`）。
  assert.equal(recentFilePathText({ parentPath: '/p/src', projectPath: '/p', userHome: '/home/u', hasSameNamedFiles: false }), null)
  assert.equal(recentFilePathText({ parentPath: null, projectPath: '/p', userHome: '/home/u', hasSameNamedFiles: true }), null)
  // 工程内。
  assert.equal(recentFilePathText({ parentPath: '/p/src/util', projectPath: '/p', userHome: '/home/u', hasSameNamedFiles: true }), 'src/util')
  // 工程根自己 ⇒ 相对结果为空 ⇒ 退回绝对路径（`:38`）。
  assert.equal(recentFilePathText({ parentPath: '/p', projectPath: '/p', userHome: '/home/u', hasSameNamedFiles: true }), '/p')
  // 主目录下。
  assert.equal(recentFilePathText({ parentPath: '/home/u/docs', projectPath: '/p', userHome: '/home/u', hasSameNamedFiles: true }), '~/docs')
  // 都不在 ⇒ 绝对路径（`:44`）。
  assert.equal(recentFilePathText({ parentPath: '/tmp/x', projectPath: '/p', userHome: '/home/u', hasSameNamedFiles: true }), '/tmp/x')
  // 没有工程（上游 project.basePath 为 null）时跳过工程那一档。
  assert.equal(recentFilePathText({ parentPath: '/home/u/docs', projectPath: null, userHome: '/home/u', hasSameNamedFiles: true }), '~/docs')
  // 前缀不是路径段（/project2 不是 /project 的子目录）。
  assert.equal(recentFilePathText({ parentPath: '/project2/a', projectPath: '/project', userHome: null, hasSameNamedFiles: true }), '/project2/a')
  // 反斜杠归一。
  assert.equal(recentFilePathText({ parentPath: 'C:\\p\\src', projectPath: 'C:\\p', userHome: null, hasSameNamedFiles: true }), 'src')
})

check('platform/recentFiles/backend/src/com/intellij/platform/recentFiles/backend/BackendRecentFilePathContributor.kt',
  '路径文案：无同名文件返回 null、工程内相对、主目录 ~、否则绝对', contributor => {
    assert.match(contributor, /if \(parentPath\.nameCount == 0 \|\| !areThereFilesWithSameName\(file, project\)\) return null/)
    assert.match(contributor, /FileUtil\.isAncestor\(projectPath, filePath, true\)/)
    assert.match(contributor, /FileUtil\.isAncestor\(SystemProperties\.getUserHome\(\), filePath, true\)/)
  })

test('打开方式：diff 文件 + 窗口内开 diff 才走新窗口', () => {
  assert.equal(diffRecentFileOpenMode(true, true), 'NEW_WINDOW')
  assert.equal(diffRecentFileOpenMode(true, false), null)
  assert.equal(diffRecentFileOpenMode(false, true), null)
  assert.equal(diffRecentFileOpenMode(false, false), null)
})

check('platform/vcs-impl/frontend/src/com/intellij/platform/vcs/impl/frontend/diff/DiffRecentFilesNavigator.kt',
  'diff 文件 + isDiffInWindow ⇒ NEW_WINDOW，否则 null', navigator => {
    assert.match(navigator, /if \(file\.isDiffVirtualFile\(\) && DiffEditorTabFilesUtil\.isDiffInWindow\)\n\s+FileEditorManagerImpl\.OpenMode\.NEW_WINDOW\n\s+else null/)
  })

// ── ⑤ 类别选择、去重、容量 ───────────────────────────────────────────────────────────

test('三种类别与它们的数据源（recentFilesCollector.kt:44-47）', () => {
  assert.deepEqual(RECENT_FILE_KINDS, ['RECENTLY_EDITED', 'RECENTLY_OPENED', 'RECENTLY_OPENED_UNPINNED'])
  assert.equal(modelKindOf('RECENTLY_EDITED'), 'recentlyEdited')
  assert.equal(modelKindOf('RECENTLY_OPENED'), 'recentlyOpened')
  // 上游枚举名与状态名的对调是历史遗留：UNPINNED 写 pinned 那份表（RecentFilesMutableState.kt:21-27）。
  assert.equal(modelKindOf('RECENTLY_OPENED_UNPINNED'), 'recentlyOpenedUnpinned')
  assert.equal(RECENT_FILE_SOURCES.length, 3)
  assert.match(RECENT_FILE_SOURCES[0].upstream, /recentFilesCollector\.kt:45/)
})

check('platform/recentFiles/shared/src/com/intellij/platform/recentFiles/shared/recentFilesCollector.kt',
  'edited 档取 changedFiles，opened/unpinned 档取 getRecentFiles', collector => {
    assert.match(collector, /RecentFileKind\.RECENTLY_EDITED -> IdeDocumentHistory\.getInstance\(project\)\.changedFiles/)
    assert.match(collector, /RecentFileKind\.RECENTLY_OPENED, RecentFileKind\.RECENTLY_OPENED_UNPINNED -> getRecentFiles\(project\)/)
  })

test('Switcher 用哪一类：标签数决定 unpinned 档，勾选框决定 edited 档', () => {
  // Switcher.kt:170-171。
  assert.equal(switcherFilesKind(false, false, 10), 'RECENTLY_OPENED_UNPINNED')
  assert.equal(switcherFilesKind(false, false, 1), 'RECENTLY_OPENED')
  // Switcher.kt:317-319 / :549-551。
  assert.equal(switcherFilesKind(true, true, 10), 'RECENTLY_EDITED')
  assert.equal(switcherFilesKind(true, false, 10), 'RECENTLY_OPENED')
})

check('platform/recentFiles/frontend/src/com/intellij/platform/recentFiles/frontend/Switcher.kt',
  'unpinnedFilesKind 按 EditorWindow.tabLimit 分流，勾选框分流 edited/opened', switcher => {
    assert.match(switcher, /get\(\) = if \(EditorWindow\.tabLimit > 1\) RecentFileKind\.RECENTLY_OPENED_UNPINNED else RecentFileKind\.RECENTLY_OPENED/)
    assert.match(switcher, /cbShowOnlyEditedFiles\.isSelected -> RecentFileKind\.RECENTLY_EDITED/)
  })

test('unpinned 档的读表回退（FrontendRecentFilesMutableState.chooseStateToReadFrom）', () => {
  // 只有一条且在多个编辑器里开着 ⇒ 读 pinned（:25）。
  assert.equal(chooseKindToReadFrom(1, true), 'RECENTLY_OPENED_UNPINNED')
  // 空表 / 只有一条 ⇒ 退回整份最近打开（:26）。
  assert.equal(chooseKindToReadFrom(0, false), 'RECENTLY_OPENED')
  assert.equal(chooseKindToReadFrom(1, false), 'RECENTLY_OPENED')
  // 多条 ⇒ 读 pinned（:27）。
  assert.equal(chooseKindToReadFrom(2, false), 'RECENTLY_OPENED_UNPINNED')
})

check('platform/recentFiles/frontend/src/com/intellij/platform/recentFiles/frontend/model/FrontendRecentFilesMutableState.kt',
  'unpinned 档的读表回退三条分支', state => {
    assert.match(state, /capturedSwitcherModelState\.isEmpty\(\) \|\| capturedSwitcherModelState\.size == 1 -> recentlyOpenedFilesState/)
    assert.match(state, /else -> recentlyOpenedPinnedFilesState/)
  })

test('打开着的标签插进最近文件表（getRecentFiles 的互插，recentFilesCollector.kt:87-104）', () => {
  // 'b' 也在打开列表里 ⇒ 未在历史里的打开标签插到它前面（index=1）。
  assert.deepEqual(openFilesInterleaved(['a', 'b', 'c'], ['b', 'z']), ['a', 'z', 'b', 'c'])
  // 一个都没命中 ⇒ index 保持 0，插在最前。
  assert.deepEqual(openFilesInterleaved(['a', 'b'], ['z']), ['z', 'a', 'b'])
  // 已在前面的打开标签不重复插。
  assert.deepEqual(openFilesInterleaved(['a', 'b'], ['a']), ['a', 'b'])
  assert.deepEqual(openFilesInterleaved([], ['z']), ['z'])
})

test('记录一笔：先过排除器，再置顶去重，最后按容量截断', () => {
  const state = emptyRecentFilesState()
  // 批内的重复项**不**去重（上游 `addEvent` 是 `batch + (old - batch.toSet())`，
  // 只删旧表里的同值项，批内自己没去过重 —— `RecentFilesMutableState.kt:31-39`）。
  const batch = recordRecentFiles(state, ['a', 'b', 'a'], { limit: 50 })
  assert.deepEqual(batch.recentlyOpened, ['a', 'b', 'a'])
  // 与**旧表**里的同值项去重 + 置顶。
  const next = recordRecentFiles({ ...state, recentlyOpened: ['b', 'c'] }, ['a', 'b'], { limit: 50 })
  assert.deepEqual(next.recentlyOpened, ['a', 'b', 'c'])
  // 其余两张表不动。
  assert.deepEqual(next.recentlyEdited, [])
  assert.deepEqual(next.recentlyOpenedPinned, [])

  // 按容量截断：设置 2 ⇒ 容量 3，新的一笔置顶、最旧的被丢。
  const trimmed = recordRecentFiles(
    { ...state, recentlyOpened: ['a', 'b', 'c'] }, ['d'], { limit: 2 })
  assert.deepEqual(trimmed.recentlyOpened, ['d', 'a', 'b'])

  // 写别的表。
  const edited = recordRecentFiles(state, ['x.ts'], { kind: 'RECENTLY_EDITED' })
  assert.deepEqual(edited.recentlyEdited, ['x.ts'])
  assert.deepEqual(edited.recentlyOpened, [])

  // 排除器拦下的不进表。
  const excluded = recordRecentFiles(state, ['/vendor/a.ts', 'src/b.ts'], {
    excluders: [(_kind, path) => path.includes('/vendor/')],
  })
  assert.deepEqual(excluded.recentlyOpened, ['src/b.ts'])

  // 全部被拦 ⇒ 原状态原样返回（引用不变）。
  const allBlocked = recordRecentFiles(state, ['/vendor/a.ts'], { excluders: [() => true] })
  assert.equal(allBlocked, state)
  assert.deepEqual(recordRecentFiles(state, []), state)

  // putOnTop：命中旧项按旧表顺序前移。
  const promoted = recordRecentFiles({ ...state, recentlyOpened: ['a', 'b', 'c'] }, ['c'], { putOnTop: true })
  assert.deepEqual(promoted.recentlyOpened, ['c', 'a', 'b'])
})

// ── ⑥ 宿主判据与作用域 ───────────────────────────────────────────────────────────────

test('跨窗口/跨项目：谁供模型（RecentFileEventsController.doesProcessHostRecentFilesModel）', () => {
  // 回退版 Switcher ⇒ 不供（:73）。
  assert.equal(hostsRecentFilesModel({ fallbackSwitcher: true, productMode: 'LIGHT', isFrontend: true }), false)
  // 严格 LIGHT ⇒ 自己供（:75）。
  assert.equal(hostsRecentFilesModel({ fallbackSwitcher: false, productMode: 'LIGHT', isFrontend: true }), true)
  // 非前端（单体/后端）⇒ 自己供（:76）。
  assert.equal(hostsRecentFilesModel({ fallbackSwitcher: false, productMode: 'MONOLITH', isFrontend: false }), true)
  // 前端且非 LIGHT（有后端可问）⇒ 不供（:76 的取反）。
  assert.equal(hostsRecentFilesModel({ fallbackSwitcher: false, productMode: 'MONOLITH', isFrontend: true }), false)
  // LIGHT_WITH_RD_CONNECTION 有连接 ⇒ 不是 LIGHT，从后端取。
  assert.equal(hostsRecentFilesModel({ fallbackSwitcher: false, productMode: 'LIGHT_WITH_RD_CONNECTION', isFrontend: true }), false)
})

check('platform/recentFiles/shared/src/com/intellij/platform/recentFiles/shared/RecentFileEventsController.kt',
  '宿主判据：回退版不供、严格 LIGHT 供、非前端供', controller => {
    assert.match(controller, /if \(shouldUseFallbackSwitcher\(\)\) return false/)
    assert.match(controller, /if \(IdeProductMode\.getInstance\(\)\.currentMode == ProductMode\.LIGHT\) return true/)
    assert.match(controller, /return !IdeProductMode\.isFrontend/)
  })

test('模型作用域是工程级，不是应用级', () => {
  assert.equal(RECENT_FILES_MODEL_SCOPE, 'project')
})

check('platform/recentFiles/shared/src/com/intellij/platform/recentFiles/shared/RecentFilesModel.kt',
  'RecentFilesModel 是 PROJECT 级服务', model => {
    assert.match(model, /@Service\(Service\.Level\.PROJECT\)/)
  })

check('platform/platform-impl/src/com/intellij/openapi/fileEditor/impl/EditorHistoryManager.kt',
  '历史表持久化在工程工作区文件里', history => {
    assert.match(history, /Storage\(StoragePathMacros\.PRODUCT_WORKSPACE_FILE\)/)
  })

test('主菜单最多列 6 个最近工程（RecentProjectsManagerBase.MAX_PROJECTS_IN_MAIN_MENU）', () => {
  assert.equal(MAX_PROJECTS_IN_MAIN_MENU, 6)
})

check('platform/platform-impl/src/com/intellij/ide/RecentProjectsManagerBase.kt',
  'MAX_PROJECTS_IN_MAIN_MENU = 6，最近工程裁剪读 ide.max.recent.projects', base => {
    assert.match(base, /const val MAX_PROJECTS_IN_MAIN_MENU: Int = 6/)
    assert.match(base, /val limit = AdvancedSettings\.getInt\("ide\.max\.recent\.projects"\)/)
  })
// ── ⑦ 模块加载时的 EP 接线（内置贡献真的挂进了宿主） ──────────────────────────────────

test('三个内置贡献按 bundled 挂进了各自的 EP，广告位那条没挂（上游就没有实现）', () => {
  assert.deepEqual(
    recentFilesProvidersFromExtensions('excluder').map(p => p.id),
    ['DiffRecentFilesExcluder'])
  assert.deepEqual(
    recentFilesProvidersFromExtensions('presentationContributor').map(p => p.id),
    ['BackendRecentFilePathContributor'])
  assert.deepEqual(
    recentFilesProvidersFromExtensions('navigator').map(p => p.id),
    ['DiffRecentFilesNavigator'])
  // 广告位：EP 已声明（能查，返回空表），但没有内置实现。
  assert.deepEqual(recentFilesProvidersFromExtensions('advertisementProvider'), [])
  // 模块外的族没有 EP ⇒ 取不到（不是抛错）。
  assert.deepEqual(recentFilesProvidersFromExtensions('searchEverywhere'), [])
})

test('第三方按 EP id 挂进来的提供者，消费方看得见（不是死代码）', () => {
  const handle = EXTENSIONS.registerExtension(
    RECENT_FILES_EXTENSION_POINT_IDS.navigator, 'MyNavigator',
    { id: 'MyNavigator', family: 'navigator', extensionPoint: RECENT_FILES_EXTENSION_POINT_IDS.navigator, builtin: true, upstream: 'z:1' })
  assert.deepEqual(
    recentFilesProvidersFromExtensions('navigator').map(p => p.id),
    ['DiffRecentFilesNavigator', 'MyNavigator'])
  assert.equal(handle.dispose(), true)
  assert.deepEqual(recentFilesProvidersFromExtensions('navigator').map(p => p.id), ['DiffRecentFilesNavigator'])
})
