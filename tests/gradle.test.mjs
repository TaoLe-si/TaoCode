// Gradle 前端纯逻辑的单测（src/gradle.ts）。
//
// 对照的 IDEA 源码：plugins/gradle/settings/src/util/GradleConstants.java（常量口径）、
// .../service/settings/GradleConfigLocator.java（项目 = 目录）、
// platform/external-system-impl/.../ExternalSystemGroupConfigurable.kt（build.tools 自动重载）。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  AUTO_RELOAD_ALL_LABEL,
  AUTO_RELOAD_PREVIOUS_KEY,
  AUTO_RELOAD_SELECTIVE_LABEL,
  BUILD_TOOLS_GROUP_ID,
  DEFAULT_BUILD_TOOLS,
  GRADLE_BUILD_FILES,
  GRADLE_CONFIGURABLE_ID,
  GRADLE_KNOWN_FILES,
  GRADLE_RUN_DEFAULTS,
  GRADLE_DELEGATE_DEFAULT,
  GRADLE_USE_PROJECT_JDK,
  isDelegatedBuildEnabled,
  isDelegatedRunEnabled,
  GRADLE_SETTINGS_FILES,
  GRADLE_SYSTEM_ID,
  GRADLE_WRAPPER_PROPERTIES,
  autoReloadLabel,
  canLinkGradleProject,
  detectGradle,
  distributionUrlFrom,
  gradleCommand,
  gradleFailure,
  gradleOutputTail,
  gradleProjectDirectory,
  gradleVersionFromUrl,
  GRADLE_DEPENDENCIES_NODE_NAME,
  GRADLE_DEPENDENCIES_TASK,
  dependenciesByProject,
  gradleConfigFile,
  isGradleBuildScript,
  parseGradleDependencies,
  parseGradleProjects,
  parseGradleTasks,
  shouldAutoReload,
  tasksByGroup,
} from '../src/gradle.ts'

test('常量与 GradleConstants 一一对应', () => {
  assert.equal(GRADLE_SYSTEM_ID, 'GRADLE')
  assert.deepEqual([...GRADLE_BUILD_FILES], ['build.gradle', 'build.gradle.kts', 'build.gradle.dcl', 'build.gradle.xdcl'])
  assert.deepEqual([...GRADLE_SETTINGS_FILES],
    ['settings.gradle', 'settings.gradle.kts', 'settings.gradle.dcl', 'settings.gradle.xdcl'])
  // KNOWN_GRADLE_FILES = 八个精确名字
  assert.equal(GRADLE_KNOWN_FILES.length, 8)
  assert.equal(GRADLE_WRAPPER_PROPERTIES, 'gradle/wrapper/gradle-wrapper.properties')
  assert.equal(GRADLE_CONFIGURABLE_ID, 'reference.settingsdialog.project.gradle')
  assert.equal(BUILD_TOOLS_GROUP_ID, 'build.tools')
  assert.equal(AUTO_RELOAD_PREVIOUS_KEY, 'settings.build.tools.auto.reload')
})

test('从 distributionUrl 解出版本号', () => {
  assert.equal(gradleVersionFromUrl('https://services.gradle.org/distributions/gradle-8.7-bin.zip'), '8.7')
  assert.equal(gradleVersionFromUrl('https://services.gradle.org/distributions/gradle-7.6.4-all.zip'), '7.6.4')
  assert.equal(gradleVersionFromUrl('https://example.com/gradle.zip'), '')
  assert.equal(gradleVersionFromUrl(''), '')
})

test('读 gradle-wrapper.properties 的 distributionUrl（含 \\: 转义与注释）', () => {
  const properties = [
    '#Mon Jan 01 00:00:00 UTC 2024',
    'distributionBase=GRADLE_USER_HOME',
    'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.7-bin.zip',
    'zipStoreBase=GRADLE_USER_HOME',
  ].join('\n')
  assert.equal(distributionUrlFrom(properties), 'https://services.gradle.org/distributions/gradle-8.7-bin.zip')
  assert.equal(distributionUrlFrom('!comment\ndistributionUrl = https\\://x/gradle-9.0-bin.zip '),
    'https://x/gradle-9.0-bin.zip')
  assert.equal(distributionUrlFrom('distributionBase=GRADLE_USER_HOME'), '')
  assert.equal(distributionUrlFrom(null), '')
})

test('空目录不是 Gradle 项目', () => {
  const info = detectGradle([])
  assert.equal(info.isGradle, false)
  assert.deepEqual(info.buildFiles, [])
  assert.deepEqual(info.settingsFiles, [])
  assert.equal(info.hasWrapper, false)
  assert.equal(info.distributionUrl, '')
})

test('build.gradle 与 settings.gradle.kts 都被识别，settings 不进 buildFiles', () => {
  const info = detectGradle(['build.gradle', 'settings.gradle.kts'])
  assert.equal(info.isGradle, true)
  assert.deepEqual(info.buildFiles, ['build.gradle'])
  assert.deepEqual(info.settingsFiles, ['settings.gradle.kts'])
})

test('只有 settings 文件也算 Gradle 项目', () => {
  const info = detectGradle(['settings.gradle.dcl'])
  assert.equal(info.isGradle, true)
  assert.deepEqual(info.settingsFiles, ['settings.gradle.dcl'])
  assert.deepEqual(info.buildFiles, [], 'settings.gradle.dcl 不应同时出现在 buildFiles（KNOWN_GRADLE_FILES 精确区分）')
})

test('其余 *.gradle.kts / *.gradle.dcl 进 buildFiles，且不带出 known 名字与子目录', () => {
  const info = detectGradle([
    'build.gradle.kts',
    'module.gradle.kts',
    'extra.gradle.dcl',
    'settings.gradle.xdcl',
    'sub/project.gradle.kts',
    'gradle.dcl',
  ])
  assert.deepEqual(info.buildFiles, ['build.gradle.kts', 'extra.gradle.dcl', 'module.gradle.kts'])
  assert.deepEqual(info.settingsFiles, ['settings.gradle.xdcl'])
})

test('wrapper 的三种存在形式都算 hasWrapper', () => {
  assert.equal(detectGradle(['build.gradle', 'gradle/wrapper/gradle-wrapper.properties']).hasWrapper, true)
  assert.equal(detectGradle(['build.gradle', 'gradlew.bat']).hasWrapper, true)
  assert.equal(detectGradle(['build.gradle', 'gradlew']).hasWrapper, true)
  assert.equal(detectGradle(['build.gradle']).hasWrapper, false)
  assert.deepEqual(detectGradle(['build.gradle', 'gradlew.bat']).wrapperScripts, ['gradlew.bat'])
})

test('detection 的 distribution 字段串起来（wrapper 内容 → URL → 版本）', () => {
  const info = detectGradle(['build.gradle', GRADLE_WRAPPER_PROPERTIES],
    'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.7-bin.zip')
  assert.equal(info.distributionUrl, 'https://services.gradle.org/distributions/gradle-8.7-bin.zip')
  assert.equal(info.distributionVersion, '8.7')
})

const wrapperProject = detectGradle(['build.gradle', 'gradlew.bat'])
const noWrapperProject = detectGradle(['build.gradle'])
const base = { useGradleFrom: 'wrapper', gradlePath: '', gradleUserHome: '', offline: false }

test('同步命令：wrapper 优先，console 固定 plain', () => {
  assert.equal(gradleCommand(wrapperProject, base, 'projects'), 'gradlew.bat --console=plain projects')
  assert.equal(gradleCommand(wrapperProject, { ...base, offline: true }, 'tasks --all'),
    'gradlew.bat --console=plain --offline tasks --all')
  assert.equal(gradleCommand(wrapperProject, { ...base, gradleUserHome: 'D:/grs' }, 'projects'),
    'gradlew.bat --console=plain -g "D:/grs" projects')
})

test('同步命令：包装脚本缺失 / 指定路径 / 本机 Gradle 三种退路', () => {
  assert.equal(gradleCommand(noWrapperProject, base, 'projects'), 'gradle --console=plain projects')
  assert.equal(gradleCommand(wrapperProject, { ...base, useGradleFrom: 'local', offline: true }, 'projects'),
    'gradle --console=plain --offline projects')
  assert.equal(gradleCommand(noWrapperProject, { ...base, useGradleFrom: 'path', gradlePath: 'C:/gradle/bin/gradle' }, 'projects'),
    '"C:/gradle/bin/gradle" --console=plain projects')
  // path 但路径为空 → 退回本机
  assert.equal(gradleCommand(noWrapperProject, { ...base, useGradleFrom: 'path', gradlePath: '  ' }, 'projects'),
    'gradle --console=plain projects')
})

test('解析 gradle projects 的树形输出', () => {
  const output = [
    '',
    '------------------------------------------------------------',
    "Root project 'demo'",
    '------------------------------------------------------------',
    '',
    "Root project 'demo'",
    "\\--- Project ':app'",
    "     \\--- Project ':app:core'",
    "\\--- Project ':lib'",
    '',
    'To see a list of the tasks of a project, run gradle <project-path>:tasks',
  ].join('\n')
  const projects = parseGradleProjects(output)
  assert.deepEqual(projects.map(item => [item.path, item.depth]), [
    [':', 0],
    [':app', 1],
    [':app:core', 2],
    [':lib', 1],
  ])
  assert.equal(projects[1].name, 'app')
})

test('projects 解析去重（Root project 在标题与本表中各出现一次）', () => {
  const projects = parseGradleProjects("Root project 'demo'\n\nRoot project 'demo'\n")
  assert.equal(projects.length, 1)
})

test('解析 gradle tasks --all 的分组与任务', () => {
  const output = [
    '',
    'Build tasks',
    '-----------',
    'assemble - Assembles the outputs of this project.',
    'build - Assembles and tests this project.',
    'buildDependents - Assembles and tests this project and all projects that depend on it.',
    '',
    'Application tasks',
    '-----------------',
    'run - Runs this project as a JVM application.',
    '',
    'To see all tasks and more detail, run gradle tasks --all',
  ].join('\n')
  const tasks = parseGradleTasks(output)
  assert.deepEqual(tasks.map(task => task.group), ['Build tasks', 'Build tasks', 'Build tasks', 'Application tasks'])
  assert.equal(tasks[0].name, 'assemble')
  assert.equal(tasks[3].description, 'Runs this project as a JVM application.')
})

test('tasks 解析跳过 Gradle 自己的保留名（help/tasks/projects…）', () => {
  const output = ['Help tasks', '----------', 'help - Displays a help message.', 'tasks - Displays the tasks runnable.', 'projects - Displays the sub-projects.'].join('\n')
  assert.deepEqual(parseGradleTasks(output), [])
})

test('tasksByGroup 归拢成"分组 → 任务"两层', () => {
  const tasks = parseGradleTasks(['Build tasks', '-----------', 'build - b', '', 'Other tasks', '------------', 'clean - c'].join('\n'))
  const groups = tasksByGroup(tasks)
  assert.deepEqual(groups.map(group => group.group), ['Build tasks', 'Other tasks'])
  assert.deepEqual(groups[0].tasks.map(task => task.name), ['build'])
})

test('gradleFailure 从输出里取失败原因', () => {
  assert.equal(gradleFailure("FAILURE: Build failed with an exception.\n"), 'Build failed with an exception.')
  assert.equal(gradleFailure('BUILD FAILED in 1s'), 'Gradle 同步失败（BUILD FAILED）。')
  assert.equal(gradleFailure('BUILD SUCCESSFUL in 3s'), '')
})

// 2026-09-29 实测（AE2 VM / gtnhconvention 2.0.27，daemon 日志原文）。旧实现只取
// `FAILURE:` 那一行 ⇒ 面板上是"Build failed with an exception."，等于没告诉用户为什么；
// 用户因此判断成"一直在解析、解析不出来"。真正的原因在 `* What went wrong:` 段与其因果链里。
test('gradleFailure 取的是 What went wrong 段与最里层根因，不是 FAILURE 头一行', () => {
  const real = [
    'FAILURE: Build failed with an exception.',
    '',
    '* Where:',
    "Build file 'E:\\Applied Energistics 2 Acceleration\\AE2VMAddon-1.7.10-gtnh\\build.gradle.kts' line: 1",
    '',
    '* What went wrong:',
    "An exception occurred applying plugin request [id: 'com.gtnewhorizons.gtnhconvention']",
    "> Failed to apply plugin 'com.gtnewhorizons.gtnhconvention'.",
    '   > A problem occurred evaluating script.',
    '      > Failed to load the manifest from Github',
    '',
    '* Try:',
    '> Run with --stacktrace option to get the stack trace.',
    '',
    'BUILD FAILED in 1m 15s',
    '2 actionable tasks: 2 executed',
  ].join('\r\n')
  const message = gradleFailure(real)
  assert.ok(message.includes('Failed to load the manifest from Github'), `根因丢了：${message}`)
  assert.ok(message.includes('An exception occurred applying plugin request'), `表面原因丢了：${message}`)
  // `* Try:` 那一节不是原因，不能被卷进来（否则每次都要读两行废话）。
  assert.ok(!message.includes('--stacktrace'), `把 * Try: 的建议当成了原因：${message}`)
  assert.ok(!message.includes('BUILD FAILED in'), `把结尾统计当成了原因：${message}`)
  // 反证：只用旧口径（第一行）的写法过不了这条。
  assert.notEqual(message, 'Build failed with an exception.')
})

test('gradleFailure 在没有 What went wrong 段时也照样有结论（旧 Gradle / 纯异常）', () => {
  assert.equal(gradleFailure('FAILURE: Boom.\n\n* What went wrong:\n'), 'Boom.')
  assert.equal(gradleFailure('* What went wrong:\nOnly a section, no FAILURE line\n\n* Try:\n'), 'Only a section, no FAILURE line')
})

// 同步进行中要看得见"跑到哪了"：Gradle 的进度行用 `\r` 覆盖写，ANSI 也要能剥。
test('gradleOutputTail 取尾部若干行，按 \r 也切、去掉 ANSI 与空行', () => {
  const output = 'line1\n\x1B[2K> Configure project :app\n\r\rprogress 50%\rprogress 100%\nlast\n\n'
  assert.deepEqual(gradleOutputTail(output, 2), ['progress 100%', 'last'])
  assert.deepEqual(gradleOutputTail(output, 99).length, 5, '空行不该占位')
  assert.deepEqual(gradleOutputTail('', 5), [], '没有输出就是空数组')
  assert.deepEqual(gradleOutputTail('a\nb\nc', 0), ['c'], 'lines 非法时至少留一行')
})

test('shouldAutoReload 是三档真实语义（ALL / SELECTIVE / NONE）', () => {
  // 非构建脚本的改动不触发任何自动重载
  assert.equal(shouldAutoReload('ALL', { changedOutsideIde: true }), false)
  assert.equal(shouldAutoReload('NONE', { changedBuildFile: true, changedOutsideIde: true, afterVcsUpdate: true }), false)
  // ALL：任何构建脚本改动都重载（IDE 内外都算）
  assert.equal(shouldAutoReload('ALL', { changedBuildFile: true }), true)
  assert.equal(shouldAutoReload('ALL', { changedBuildFile: true, changedOutsideIde: true }), true)
  // SELECTIVE：IDE 内的编辑不触发，VCS 更新必然触发
  assert.equal(shouldAutoReload('SELECTIVE', { changedBuildFile: true, changedOutsideIde: true }), true)
  assert.equal(shouldAutoReload('SELECTIVE', { changedBuildFile: true, changedOutsideIde: false }), false)
  assert.equal(shouldAutoReload('SELECTIVE', { afterVcsUpdate: true }), true)
  // 缺省触发条件 = 什么都没变
  assert.equal(shouldAutoReload('ALL'), false)
})

test('isGradleBuildScript 只认 Gradle 的构建/设置脚本', () => {
  assert.equal(isGradleBuildScript('build.gradle'), true)
  assert.equal(isGradleBuildScript('build.gradle.kts'), true)
  assert.equal(isGradleBuildScript('settings.gradle.dcl'), true)
  assert.equal(isGradleBuildScript('/app/module.gradle.kts'), true)
  assert.equal(isGradleBuildScript('src/main.gradle.kts'), true)
  assert.equal(isGradleBuildScript('README.md'), false)
  assert.equal(isGradleBuildScript('pom.xml'), false, 'Maven 未移植，不假装认它')
  assert.equal(isGradleBuildScript('gradle.dcl'), false)
})

test('自动重载的三档文案与两档单选文案', () => {
  assert.equal(autoReloadLabel('NONE'), '关闭自动重新加载')
  assert.equal(autoReloadLabel('ALL'), '任何更改')
  assert.equal(autoReloadLabel('SELECTIVE'), '外部更改')
  assert.equal(AUTO_RELOAD_ALL_LABEL, '任何更改')
  assert.equal(AUTO_RELOAD_SELECTIVE_LABEL, '外部更改')
})

test('构建工具的默认值（AutoImportProjectTrackerSettings 默认 SELECTIVE / wrapper / Gradle JVM = 项目 JDK）', () => {
  // AutoImportProjectTrackerSettings.kt:16-26：无 DefaultAutoReloadTypeProvider 实现 ⇒ SELECTIVE。
  assert.deepEqual(DEFAULT_BUILD_TOOLS, {
    autoReloadType: 'SELECTIVE',
    previousAutoReloadType: 'SELECTIVE',
    gradle: { useGradleFrom: 'wrapper', gradlePath: '', gradleUserHome: '', gradleJvm: '#USE_PROJECT_JDK', delegatedBuild: true, offline: false, linkedProjects: [] },
  })
  assert.deepEqual(GRADLE_RUN_DEFAULTS, DEFAULT_BUILD_TOOLS.gradle)
  // `#USE_PROJECT_JDK` = `ExternalSystemJdkUtil.USE_PROJECT_JDK`（`ExternalSystemJdkUtil.java:52`），
  // 也正是 `GradleProjectSettings.java:60` 构造时给 Gradle JVM 的初值。
  assert.equal(GRADLE_RUN_DEFAULTS.gradleJvm, GRADLE_USE_PROJECT_JDK)
  // 「构建并运行使用」默认交给 Gradle（`GradleProjectSettings.java:40` DEFAULT_DELEGATE = true）。
  assert.equal(GRADLE_RUN_DEFAULTS.delegatedBuild, GRADLE_DELEGATE_DEFAULT)
  assert.equal(GRADLE_DELEGATE_DEFAULT, true)
  assert.equal(isDelegatedBuildEnabled(GRADLE_RUN_DEFAULTS), true)
  assert.equal(isDelegatedBuildEnabled({ ...GRADLE_RUN_DEFAULTS, delegatedBuild: false }), false)
  // `isDelegatedRunEnabled` 是两段式（`GradleProjectSettings.java:194-196`）。
  assert.equal(isDelegatedRunEnabled(GRADLE_RUN_DEFAULTS), true)
  assert.equal(isDelegatedRunEnabled({ ...GRADLE_RUN_DEFAULTS, delegatedBuild: false }), false)
  assert.equal(isDelegatedRunEnabled(GRADLE_RUN_DEFAULTS, false), false)
})

// ---------------------------------------------------------------------------
// 接线：Gradle 工具窗口 / 设置页 / 自动重载消费者都必须真的挂上，否则"实现了"只是源码里的字符串
// ---------------------------------------------------------------------------
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_TOOL_ANCHORS, TOOL_MNEMONIC_ORDER, toolTitles, toolWindowMnemonic, toolWindowOrder } from '../src/toolWindowMeta.ts'
import { PAGE_KEYS, PROJECT_SCOPED_PAGES, SETTINGS_NODES, isParentOnly } from '../src/settingsTreeMeta.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')
const app = read('src/App.vue')

test('Gradle 工具窗口按 IDEA 的注册停靠右侧，且不占 Alt+数字', () => {
  // plugins/gradle/plugin-resources/intellij.gradle.xml:228 `<toolWindow id="Gradle" anchor="right" …>`
  assert.equal(toolTitles.gradle, 'Gradle')
  assert.ok(toolWindowOrder.includes('gradle'), '要在工具窗口枚举里（状态栏弹窗/底部条才不会漏掉它）')
  assert.ok(!TOOL_MNEMONIC_ORDER.includes('gradle'), 'IDEA 里没有 ActivateGradleToolWindow 动作，不该给 Alt+数字')
  assert.equal(toolWindowMnemonic('gradle'), undefined)
  // `leftView` 现在直接引用 `src/toolWindowMeta.ts` 的 `ToolWindowId`（原先 App.vue 里还有一份
  // 手写的字面量联合，加了新窗口就会漏改 —— 那是重复定义，已删）。
  assert.match(app, /leftView = ref<ToolWindowId>\('files'\)/, 'leftView 要用统一的 ToolWindowId')
  // 停靠边与顺序的唯一来源是 src/toolWindowMeta.ts 的**注册表**（第三十九批起由
  // TOOL_WINDOW_REGISTRY 派生；原先在 toolWindowStripes 与 toolLayouts 里各有一份且不一致）。
  // 这里断言**派生出来的值**，不是源码里的写法 —— 表怎么组织是模块内部的事。
  assert.equal(DEFAULT_TOOL_ANCHORS.gradle, 'right', 'DEFAULT_TOOL_ANCHORS 必须把 gradle 停在右侧')
})

test('工具窗口内容分派里有 Gradle 分支，且面板会被真的挂上', () => {
  const view = read('src/components/ToolWindowView.vue')
  assert.match(view, /view === 'gradle'/, 'ToolWindowView 必须能渲染 Gradle')
  assert.match(view, /import GradlePanel from '\.\/GradlePanel\.vue'/)
  const panel = read('src/components/GradlePanel.vue')
  assert.match(panel, /@dblclick="runTask\(task\)"/, '双击任务即运行（IDEA 的 GradleRunConfiguration 入口）')
  assert.match(panel, /gradleSync\.running/, '面板要显示同步进行中')
})

test('设置页挂在 build.tools 之下（Gradle 页是子页，不是兄弟）', () => {
  const gradlePage = SETTINGS_NODES.find(node => node.key === 'reference.settingsdialog.project.gradle')
  assert.ok(gradlePage, 'Gradle 设置页要登记在树表里')
  assert.equal(gradlePage.parent, 'build.tools', 'intellij.gradle.xml:177-179 groupId="build.tools"')
  assert.ok(PAGE_KEYS.includes('reference.settingsdialog.project.gradle'))
  assert.ok(PROJECT_SCOPED_PAGES.has('reference.settingsdialog.project.gradle'), 'Gradle 三项都是项目级设置')
  assert.ok(PROJECT_SCOPED_PAGES.has('build.tools'), '自动重载也是项目级（ExternalSystemGroupConfigurable）')
  assert.equal(isParentOnly('build.tools'), false, 'build.tools 自己就是 ExternalSystemGroupConfigurable 那个页面')
  const dialog = read('src/components/SettingsDialog.vue')
  assert.match(dialog, /<BuildToolsSettingsPage /)
  assert.match(dialog, /<GradleSettingsPage /)
})

test('「自动重新加载」的消费者读的是项目级三档，不再是应用级布尔', () => {
  const sync = read('src/diskSync.ts')
  assert.match(sync, /onBuildFilesChanged\(fsChanges\.paths\)/, '文件监听要把这一批变化交给构建工具判定')
  assert.doesNotMatch(sync, /buildToolAutoReload/, '旧的假逻辑（应用级布尔）必须已经删掉')
  const host = read('src/gradleHost.ts')
  assert.match(host, /shouldAutoReload\(type,/, '三档判定要用 gradle.ts 里的纯函数')
  assert.match(host, /afterVcsUpdate/, 'SELECTIVE 的「VCS 更新」那一条也要接上')
  assert.match(read('src/vcsActions.ts'), /noteVcsUpdate\(\)/, 'VCS 动作要发出更新信号')
})

test('IDEA 的「自动配置」：打开项目就检测并自动同步一次', () => {
  const host = read('src/gradleHost.ts')
  assert.match(host, /if \(info\?\.isGradle && deps\.isDesktop\) await sync\(\)/,
    '打开项目后必须自动同步（桃：IDEA 本身会自动配置）')
  // 第一次同步不受 autoReloadType 约束：NONE 的源码注释明确放行 scheduleProjectRefresh 那一类
  // （ExternalSystemProjectTrackerSettings.kt:23-26），这里要把依据写进代码注释里。
  assert.match(host, /scheduleProjectRefresh/, '要写明"第一次同步属于显式请求那一类"的源码依据')
})

test('Gradle 同步在后台任务面板里是一条可取消的行', () => {
  const panel = read('src/progressPanel.ts')
  assert.match(panel, /正在同步 Gradle 项目/, '进度面板要单列 Gradle 同步（它不占运行控制台）')
  assert.match(panel, /cancellable: 'gradle'/)
  assert.match(panel, /gradleSync: \(\) => \{ running: boolean; command: string; startedAt: number; output: string \}/,
    'ctx 要能读到同步状态（含开始时刻与输出，行上才有"已跑多久 / 最新一行"）')
  assert.match(app, /gradleSync: \(\) => gradleSync/, 'App 要把 gradleSync 注入进度面板')
  // CLI 通道没有 Tooling API 的 progress/total ⇒ **不编百分比**（不确定式），行上给的是时间与最新输出。
  assert.match(panel, /percent: null/, 'Gradle 那一行的完成度如实留空')
  assert.match(panel, /elapsedLabel\(gradle\.startedAt, now\.value\)/, '行上要有已用时间')
  // 「点取消要发哪个请求」是**面板那一行自己的事**（IDEA 的 ProcessPopup 里每行也带自己的取消回调），
  // 所以这个 switch 在 progressPanel.ts，而不是让宿主持有一张 kind → 请求的映射表。
  assert.match(panel, /target === 'gradle'\) await request\('gradle\.cancel'\)/, '取消按钮要真的取消同步')
})

// ---------------------------------------------------------------------------
// 依赖树（IDEA 外部系统视图的 `Dependencies` 节点）
// ---------------------------------------------------------------------------
const DEPENDENCIES_OUTPUT = [
  '> Task :dependencies',
  '',
  '------------------------------------------------------------',
  "Root project 'demo'",
  '------------------------------------------------------------',
  '',
  'annotationProcessor - Annotation processors and their dependencies for source set \'main\'.',
  'No dependencies',
  '',
  'compileClasspath - Compile classpath for source set \'main\'.',
  '+--- org.jetbrains.kotlin:kotlin-stdlib:1.9.0',
  '|    +--- org.jetbrains:annotations:13.0',
  '|    \\--- org.jetbrains.kotlin:kotlin-stdlib-common:1.9.0',
  '\\--- org.example:lib:1.0 -> 1.2',
  '     \\--- org.example:core:0.5 (*)',
  '',
  'runtimeClasspath - Runtime classpath of source set \'main\'.',
  '\\--- org.example:lib:1.2 (*)',
  '',
  'testCompileClasspath - Compile classpath for source set \'test\'.',
  '\\--- org.junit.jupiter:junit-jupiter:5.10.0',
  '     \\--- org.junit.jupiter:junit-jupiter-api:5.10.0 (c)',
  '',
  'unresolvable (n)',
  'No dependencies',
  '',
  '> Task :app:dependencies',
  '',
  '------------------------------------------------------------',
  "Project ':app'",
  '------------------------------------------------------------',
  '',
  'compileClasspath - Compile classpath for source set \'main\'.',
  '\\--- com.google.guava:guava:33.0.0-jre',
  '',
  'BUILD SUCCESSFUL in 2s',
].join('\n')

test('依赖：作用域、说明与 `No dependencies` 分开表达', () => {
  const scopes = parseGradleDependencies(DEPENDENCIES_OUTPUT)
  assert.deepEqual(scopes.map(scope => scope.configuration), [
    'annotationProcessor', 'compileClasspath', 'runtimeClasspath', 'testCompileClasspath', 'unresolvable', 'compileClasspath',
  ])
  assert.equal(scopes[0].empty, true, 'Gradle 写了 No dependencies ⇒ empty，而不是"解析出 0 条"')
  assert.equal(scopes[0].description, "Annotation processors and their dependencies for source set 'main'.")
  assert.equal(scopes[0].project, 'demo')
  // Gradle 的表头就是两种写法：根工程 `Root project 'demo'`（名字）、子工程 `Project ':app'`（路径）。
  // 原样保留（与 parseGradleProjects 的 path 一致），不在解析层发明归一化。
  assert.equal(scopes[5].project, ':app', '多工程时按 Project 分节，作用域要归属到正确的工程')
})

test('依赖：树深度按 5 字符一层的 Gradle 约定算', () => {
  const scope = parseGradleDependencies(DEPENDENCIES_OUTPUT).find(item => item.configuration === 'compileClasspath' && item.project === 'demo')
  assert.deepEqual(scope.dependencies.map(dep => [dep.name, dep.depth]), [
    ['org.jetbrains.kotlin:kotlin-stdlib:1.9.0', 0],
    ['org.jetbrains:annotations:13.0', 1],
    ['org.jetbrains.kotlin:kotlin-stdlib-common:1.9.0', 1],
    ['org.example:lib:1.0', 0],
    ['org.example:core:0.5', 1],
  ])
})

test('依赖：Gradle 的 (n)/(c)/(*) 标记与 `-> 版本` 都被认出来', () => {
  const scopes = parseGradleDependencies(DEPENDENCIES_OUTPUT)
  const compile = scopes.find(item => item.configuration === 'compileClasspath' && item.project === 'demo')
  const resolved = compile.dependencies.find(dep => dep.name === 'org.example:lib:1.0')
  assert.equal(resolved.resolved, '1.2', '`-> 1.2` 是版本冲突的解析结果')
  const duplicate = compile.dependencies.find(dep => dep.name === 'org.example:core:0.5')
  assert.equal(duplicate.duplicate, true)
  assert.equal(duplicate.resolved, '')
  const constraint = scopes.find(item => item.configuration === 'testCompileClasspath').dependencies.at(-1)
  assert.equal(constraint.constraint, true)
  assert.equal(constraint.name, 'org.junit.jupiter:junit-jupiter-api:5.10.0')
  const unresolvable = scopes.find(item => item.configuration === 'unresolvable')
  assert.equal(unresolvable.unresolved, true)
  assert.equal(unresolvable.description, '', '`(n)` 不是说明文案，要从 description 里剥掉')
})

test('依赖：`> Task`、表头、`BUILD SUCCESSFUL` 都不算作用域', () => {
  const scopes = parseGradleDependencies(DEPENDENCIES_OUTPUT)
  assert.ok(!scopes.some(scope => scope.configuration.startsWith('>') || scope.configuration === 'BUILD'))
  assert.equal(parseGradleDependencies('').length, 0)
  assert.equal(parseGradleDependencies('BUILD SUCCESSFUL in 2s').length, 0)
  // 没有 `No dependencies` / 树行跟随的裸行不算作用域（否则 `> Task` 之类会混进来）
  assert.equal(parseGradleDependencies("Root project 'demo'\n").length, 0)
})

test('依赖：按工程归拢，节点名字取源码里的字面量常量', () => {
  const groups = dependenciesByProject(parseGradleDependencies(DEPENDENCIES_OUTPUT))
  assert.deepEqual(groups.map(group => [group.project, group.scopes.length]), [['demo', 5], [':app', 1]])
  assert.equal(GRADLE_DEPENDENCIES_NODE_NAME, 'Dependencies', 'ExternalSystemViewDefaultContributor.java:241-243 是字面量')
  assert.equal(GRADLE_DEPENDENCIES_TASK, 'dependencies')
})

test('OpenConfig 打开的是 GradleConfigLocator 解析出的那个脚本', () => {
  // build.gradle 优先（GradleConfigLocator.java:26-50 的顺序就是 detectGradle 的顺序）
  assert.equal(gradleConfigFile(detectGradle(['build.gradle.kts', 'build.gradle'])), 'build.gradle')
  assert.equal(gradleConfigFile(detectGradle(['module.gradle.kts', 'build.gradle.kts'])), 'build.gradle.kts')
  // 没有 build 脚本时退回 settings（否则这个动作就没东西可开）
  assert.equal(gradleConfigFile(detectGradle(['settings.gradle.kts'])), 'settings.gradle.kts')
  assert.equal(gradleConfigFile(detectGradle(['README.md'])), '', '不是 Gradle 项目就没有可开的配置')
  assert.equal(gradleConfigFile(null), '')
})

test('工具条按源码顺序：同步 → 展开/折叠 → 设置组', () => {
  const panel = read('src/components/GradlePanel.vue')
  const toolbar = panel.slice(panel.indexOf('<div class="gradle-toolbar"'), panel.indexOf('</div>', panel.indexOf('gradle-settings')))
  const order = ['emit(\'sync\')', 'expandAll', 'collapseAll', 'settingsMenu']
  const positions = order.map(name => toolbar.indexOf(name))
  assert.ok(positions.every(position => position >= 0), '工具条要有这四组：同步 / 展开 / 折叠 / 设置')
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, '顺序要照 ExternalSystemActions.xml:138-151')
  // ShowSettingsGroup 的两项就是公共设置页与 Gradle 页（:24-27）
  assert.match(panel, /emit\('openSettings', BUILD_TOOLS_GROUP_ID\)/)
  assert.match(panel, /emit\('openSettings', GRADLE_CONFIGURABLE_ID\)/)
})

test('同步进行中面板要证明它在动：秒数在走、输出尾部看得见、节点文案不骗人', () => {
  // 起因（2026-09-29 用户实测）："gradle 始终在解析解析不出来"。daemon 日志证明那次同步真的跑完
  // 了（`BUILD FAILED in 1m 15s`），但面板只有一句"正在跑：<命令>"，用户等不到结果就关了应用
  // （关的那一秒 Gradle 正好结束）。所以"在跑"必须可观察，而不是只有个转圈。
  const panel = read('src/components/GradlePanel.vue')
  assert.match(panel, /已 \{\{ syncSeconds \}\} 秒/, '没有已用时间就分不清"在跑"和"卡住"')
  assert.match(panel, /setInterval\(\(\) => \{ now\.value = Date\.now\(\) \}, 1000\)/, '秒数要有节拍，不能只在事件里跳一次')
  assert.match(panel, /clearInterval\(ticker\)/, '跑完要把计时器停掉（否则面板常年空转一个 interval）')
  assert.match(panel, /gradleOutputTail\(gradleSync\.output/, '输出尾部来自同一条纯函数（可单测），不是模板里现编')
  assert.match(panel, /<pre[^>]*gradle-tail-body[^>]*>\{\{ outputTail\.join\(/, '尾部要按行显示')
  // 空态文案：同步在跑时不能说"还没有同步过；点「同步」"（那是把进行中说成没开始）。
  assert.match(panel, /gradleSync\.running \? '同步中…工程结构要等这一次跑完。'/, '工程节点的空态要跟着运行状态切换')
  assert.match(panel, /gradleSync\.running \? '同步中…任务表要等这一次跑完。'/, 'Tasks 节点同理')
  // 依赖节点：在跑的是**同步**时不能报"正在解析依赖…"（用户截图里就是这么被误导的）。
  assert.match(panel, /\/dependencies\\b\/\.test\(gradleSync\.command\)/, '依赖的等待文案要按"到底在跑哪条命令"来说')
  // 失败原因要多行显示（表面原因 + 根因），单行 flex 会把换行吞掉。
  const css = panel.slice(panel.indexOf('<style'))
  assert.match(css, /\.gradle-note\.is-error[^\n]*\{[^}]*white-space: pre-line/, '错误文案的换行必须保留')
})

test('右键菜单两组：Project（打开配置/同步项目）与 Task（运行/建配置/打开脚本）', () => {
  const panel = read('src/components/GradlePanel.vue')
  const project = panel.slice(panel.indexOf("menu.kind === 'task'"), panel.indexOf('</div>\n  </div>\n</template>'))
  for (const item of ['运行', '创建运行配置', '打开构建脚本', '同步项目']) assert.ok(project.includes(item), `菜单缺少「${item}」`)
  // 依赖节点的菜单在源码里是空组（ExternalSystemActions.xml:114），所以依赖行不给右键
  assert.doesNotMatch(panel, /openMenu\(\$event, 'dependency'\)/)
  assert.match(panel, /@contextmenu\.stop="openMenu\(\$event, 'task', task\.name\)"/)
})

test('依赖树展开时才加载（对应 IDEA 的懒构建）', () => {
  const panel = read('src/components/GradlePanel.vue')
  assert.match(panel, /if \(dependenciesOpen\.value && !props\.dependencies\.length\) emit\('loadDependencies'\)/,
    '展开 Dependencies 才发加载（否则每次同步都要多跑一次 gradle dependencies）')
  assert.match(panel, /GRADLE_DEPENDENCIES_NODE_NAME/, '区块名字取源码里的字面量常量')
  const host = read('src/gradleHost.ts')
  assert.match(host, /if \(dependencies\.value\.length \|\| gradleSync\.running\) return/,
    '已经加载过就不重复跑（要刷新得先同步）')
  assert.match(host, /dependencies\.value = \[\]/, '一次同步会作废依赖树（IDEA 同步后整棵树重建）')
  assert.match(host, /runningKind\.value === 'dependencies'/, '退出时要按"跑的是哪条命令"选解析器')
})

// 「链接 Gradle 项目」= IDEA 的 `Gradle.ImportExternalProject`
// （`ImportProjectFromScriptAction.kt:18-24` 的 isVisible + `actionPerformed` 拿**父目录**去链接）。
test('子目录里的 Gradle 工程可以链接：判据照 ImportProjectFromScriptAction.isVisible', () => {
  assert.equal(gradleProjectDirectory('build.gradle'), '', '根目录的构建脚本算根工程')
  assert.equal(gradleProjectDirectory('./build.gradle'), '', '前缀 ./ 不改变归属')
  assert.equal(gradleProjectDirectory('AE2-refs/AE2-1.16.5-src/build.gradle'), 'AE2-refs/AE2-1.16.5-src')
  assert.equal(gradleProjectDirectory('demo/settings.gradle.kts'), 'demo')
  // 只有 KNOWN_GRADLE_FILES 那八个**精确名字**算（后缀不算：`foo.gradle` 不是构建/设置脚本）。
  assert.equal(canLinkGradleProject('demo/foo.gradle', []), false, '随便一个 .gradle 文件不是工程描述文件')
  assert.equal(canLinkGradleProject('demo/build.gradle', []), true)
  assert.equal(canLinkGradleProject('demo/settings.gradle', []), true)
  assert.equal(canLinkGradleProject('demo/src/main/java/A.java', []), false, '不是 Gradle 文件就没有这一项')
  // 已经链接过的目录不再给（同一条 isVisible 的后半句）。
  assert.equal(canLinkGradleProject('demo/build.gradle', ['demo']), false)
  assert.equal(canLinkGradleProject('demo/build.gradle', ['']), true, '链接过根工程不妨碍再链接子工程')
})

// `AbstractExternalSystemToolWindowFactory.java:32-34`：工具窗口可用 ⇔ **有链接的工程**。
test('Gradle 工具窗口的可用性看链接列表，不看"根目录像不像 Gradle"', () => {
  const host = read('src/gradleHost.ts')
  assert.match(host, /const available = computed\(\(\) => linkedProjects\.value\.length > 0\)/,
    '判据必须是链接列表非空（原来是 detection.isGradle，子目录工程就永远没有工具窗口）')
  // 自动链接只按 IDEA 的那条根目录规则（GradleWarmupConfigurator.kt:118-128 linkRootProject）。
  assert.match(host, /if \(info\?\.isGradle && !linkedProjects\.value\.length\) await persistLinked\(\['']\)/,
    '根目录有构建脚本 ⇒ 自动链接根工程（一次即可，不重复写盘）')
  // 链接/取消都要落盘（IDEA 那边写的是 .idea/gradle.xml 的 linkedProjectsSettings）。
  assert.match(host, /await deps\.saveGradleSettings\(\{ \.\.\.buildTools\.value\.gradle, linkedProjects: dirs \}\)/,
    '链接列表必须走项目级设置通道，否则换项目就丢')
  // 同步的工作目录 = 链接的那个目录，而不是工作区根。
  assert.match(host, /const root = directory \? `\$\{workspace\.root\}\/\$\{directory\}` : workspace\.root/,
    'gradle.sync 的 root 必须跟着链接目录走')
  // 反例：拿 detection 当可用性 —— 没链接时工具窗口就该没有，链接了才该有。
  assert.doesNotMatch(host, /const available = computed\(\(\) => Boolean\(detection\.value\?\.isGradle\)\)/)
})

// 链接过程的进度文案也有上游出处，不是随手写的一句话。
test('链接时给出上游那条进度文案', () => {
  const host = read('src/gradleHost.ts')
  // `gradle.linking.project=Linking Gradle Project`（GradleBundle.properties:363）
  assert.match(host, /deps\.notify\(directory \? `正在链接 Gradle 项目：\$\{directory\}` : '正在链接 Gradle 项目：项目根目录'\)/)
  // 反例：链接完才知道"什么都没发生"的写法（没有任何提示）不该回到代码里。
  assert.equal((host.match(/async function linkProject/g) ?? []).length, 1)
})
