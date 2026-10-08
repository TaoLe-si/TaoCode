// 「构建项目 / 重新构建」的项目类型分派（IDEA `ProjectTaskManager` + 各 `ProjectTaskRunner`）
// 与「IDEA 打开默认就有」的自动配置（JDK / 编译输出目录 / Gradle JVM）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  CLASSPATH_SEPARATOR,
  GRADLE_BUILD_TASKS,
  GRADLE_FORCE_REBUILD_FLAG,
  MAVEN_COMPILE_GOAL,
  buildPlan,
  compileFilesPlan,
  defaultJavaOutputPath,
  gradleBuildCommand,
  javacArgFile,
  javacArgFilePath,
  javacCommand,
  mavenBuildCommand,
  projectKindLabel,
  projectKindOf,
  runtimeOutputPaths,
} from '../src/projectBuild.ts'
import { javaDefaults, matchLibraryGlob } from '../src/buildHost.ts'
import { GRADLE_RUN_DEFAULTS, GRADLE_USE_PROJECT_JDK, gradleEnvironment } from '../src/gradle.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

const layout = overrides => ({ gradle: false, maven: false, cmake: false, java: false, ...overrides })
const detection = { isGradle: true, buildFiles: ['build.gradle'], settingsFiles: [], hasWrapper: true, distributionUrl: '', distributionVersion: '8.7', wrapperScripts: ['gradlew.bat'] }

function request_(overrides = {}) {
  return {
    layout: layout({ gradle: true }),
    rebuild: false,
    detection,
    gradle: { ...GRADLE_RUN_DEFAULTS },
    gradleDelegated: true,
    jdkHome: 'C:\\jdk-21',
    outputPath: '',
    classpath: [],
    sources: [],
    projectName: 'demo',
    fallback: '',
    ...overrides,
  }
}

test('谁认领构建：外部系统优先，最后才是 CMake（IDEA 的 ProjectTaskRunner 优先级）', () => {
  assert.equal(projectKindOf(layout({ gradle: true, maven: true, java: true, cmake: true })), 'gradle')
  assert.equal(projectKindOf(layout({ maven: true, java: true, cmake: true })), 'maven')
  assert.equal(projectKindOf(layout({ java: true, cmake: true })), 'javac')
  assert.equal(projectKindOf(layout({ cmake: true })), 'cmake')
  assert.equal(projectKindOf(layout({})), '')
  assert.equal(projectKindLabel('javac'), 'Java 编译')
})

test('Gradle 项目：跑 classes testClasses（TasksExecutionSettingsBuilder:151-160）', () => {
  const command = gradleBuildCommand(request_())
  assert.match(command, /gradlew\.bat/)
  assert.ok(command.includes(GRADLE_BUILD_TASKS), `命令里要有 ${GRADLE_BUILD_TASKS}：${command}`)
  assert.ok(command.includes('--console=plain'), '解析输出必须带 --console=plain')
  assert.ok(!command.includes(GRADLE_FORCE_REBUILD_FLAG), 'Build 不该强制重跑')
})

test('Gradle 的 Rebuild 不是 clean，而是让编译任务不 up-to-date（:52-58,143-145）', () => {
  const command = gradleBuildCommand(request_({ rebuild: true }))
  assert.ok(command.includes(GRADLE_FORCE_REBUILD_FLAG), '重建要让任务重跑')
  assert.ok(!command.includes(' clean'), 'IDEA 的 Gradle 重建不发 clean')
})

test('Maven 项目：compile；重建先 clean（MavenProjectTaskRunner.kt:176-193,215-220）', () => {
  assert.equal(mavenBuildCommand(request_({ layout: layout({ maven: true }) })), `mvn ${MAVEN_COMPILE_GOAL}`)
  assert.equal(mavenBuildCommand(request_({ rebuild: true })), `mvn clean ${MAVEN_COMPILE_GOAL}`)
})

test('Java 项目没有源文件时明确说"没得编"，而不是跑一条空命令', () => {
  const plan = buildPlan(request_({ layout: layout({ java: true }), sources: [] }))
  assert.equal(plan.command, '')
  assert.match(plan.reason, /没有 \.java 源文件/)
})

test('Java 项目的 javac 命令：输出目录、类路径、@argfile', () => {
  const plan = buildPlan(request_({
    layout: layout({ java: true }),
    sources: ['src/Main.java', 'src/util/Helper.java'],
    classpath: ['lib/a.jar'],
  }))
  assert.equal(plan.kind, 'javac')
  assert.ok(plan.command.startsWith('"C:\\jdk-21\\bin\\javac.exe"'), `要用项目 JDK 的 javac：${plan.command}`)
  assert.ok(plan.command.includes('-d "out/production/demo"'), '默认输出目录照 JPS：out/production/<模块名>')
  assert.ok(plan.command.includes(`-cp "out/production/demo${CLASSPATH_SEPARATOR}lib/a.jar"`), '类路径要先含输出目录')
  assert.ok(plan.command.endsWith(`@${javacArgFilePath()}`), '源文件走 @argfile（命令行放不下）')
  assert.equal(plan.argFile, '"src/Main.java"\r\n"src/util/Helper.java"')
  assert.match(plan.reason, /2 个 Java 源文件/)
})

test('没探测到 JDK 时退回 PATH 上的 javac（而不是编不了）', () => {
  const plan = buildPlan(request_({ layout: layout({ java: true }), sources: ['src/Main.java'], jdkHome: '' }))
  assert.ok(plan.command.startsWith('"javac"'), plan.command)
  assert.match(plan.reason, /JDK 没探测到/)
})

test('javac 命令与 argfile 的独立拼装', () => {
  const command = javacCommand({ jdkHome: '', outputPath: 'build/classes', classpath: [], projectName: 'demo' }, 'args.txt')
  assert.ok(command.includes('-d "build/classes"'), '配了输出目录就用配置的')
  assert.ok(command.includes('-encoding UTF-8') && command.includes('-g'), '编码与调试信息要显式给')
  assert.equal(javacArgFile(['a.java']), '"a.java"')
})

test('IDEA 的默认编译输出：out/production/<模块名>', () => {
  assert.equal(defaultJavaOutputPath('demo'), 'out/production/demo')
  assert.equal(defaultJavaOutputPath('D:/work/demo/'), 'out/production/demo')
  assert.equal(defaultJavaOutputPath(''), 'out/production/unnamed')
})

test('运行期产物目录跟着构建工具走（Gradle/Maven 项目不是 out/production）', () => {
  const gradle = runtimeOutputPaths({ layout: layout({ gradle: true }), projectName: 'demo' })
  assert.ok(gradle.includes('build/classes/java/main'), `Gradle 的类输出目录必须在：${gradle.join(',')}`)
  assert.ok(gradle.includes('build/resources/main'), '资源目录也要在（运行期读得到资源）')
  assert.deepEqual(runtimeOutputPaths({ layout: layout({ gradle: true }), gradleDelegated: false, projectName: 'demo' }),
    ['out/production/demo'], '关掉「构建并运行使用 Gradle」就是 javac 分支，回到 JPS 的约定')
  assert.deepEqual(runtimeOutputPaths({ layout: layout({ maven: true }), projectName: 'demo' }),
    ['target/classes', 'target/test-classes'])
  assert.deepEqual(runtimeOutputPaths({ layout: layout({ java: true }), projectName: 'demo' }), ['out/production/demo'])
})

test('CMake 与"什么都不认识"都退回项目里配置的命令', () => {
  const cmake = buildPlan(request_({ layout: layout({ cmake: true }), fallback: 'cmake --build build --config Release' }))
  assert.equal(cmake.command, 'cmake --build build --config Release')
  assert.equal(cmake.kind, 'cmake')
  const none = buildPlan(request_({ layout: layout({}), fallback: '' }))
  assert.equal(none.command, '')
  assert.match(none.reason, /没有识别出构建工具/)
})

test('类路径 glob 用 IDEA 的 PathMatcher 语义（** 跨目录、* 不跨）', () => {
  assert.equal(matchLibraryGlob('lib/**/*.jar', 'lib/a.jar'), true)
  assert.equal(matchLibraryGlob('lib/**/*.jar', 'lib/deep/a.jar'), true)
  assert.equal(matchLibraryGlob('lib/**/*.jar', 'src/a.jar'), false)
  assert.equal(matchLibraryGlob('lib/*.jar', 'lib/a.jar'), true)
  assert.equal(matchLibraryGlob('lib/*.jar', 'lib/deep/a.jar'), false)
  assert.equal(matchLibraryGlob('vendor/specific.jar', 'vendor/specific.jar'), true)
  assert.equal(matchLibraryGlob('lib\\**\\*.jar', 'lib/a.jar'), true)
})

test('打开项目时的自动配置只填空值（用户填过的一律不动）', () => {
  const blank = { jdkHome: '', jdkName: 'JavaSE-17', sourcePaths: [], outputPath: '', referencedLibraries: ['lib/**/*.jar'] }
  const patch = javaDefaults(blank, { home: 'C:\\jdk-21', version: '21.0.11', name: '21' }, 'demo')
  assert.equal(patch.jdkHome, 'C:\\jdk-21')
  // jdkName 必须是 JDT LS runtimes 认的 `JavaSE-<x>` 形式；探测给的显示名（`21`）
  // 原样写回会被设置校验整个拒绝 —— javaDefaults 负责从 version 归一（JDK 8 → JavaSE-1.8）。
  // jdkName 存 IDEA 的 SDK 显示名（suggestJdkName 产出），runtimes 的 JavaSE-x 由原生归一。
  assert.equal(patch.jdkName, '21')
  assert.equal(javaDefaults(blank, { home: 'C:\\jdk8', version: '1.8.0_392', name: '1.8' }, 'demo').jdkName, '1.8')
  assert.equal(patch.outputPath, 'out/production/demo')
  assert.deepEqual(patch.sourcePaths, ['src'])

  const filled = { ...blank, jdkHome: 'D:\\mine', outputPath: 'build/classes', sourcePaths: ['s'] }
  assert.equal(javaDefaults(filled, { home: 'C:\\jdk-21', version: '21.0.11', name: '21' }, 'demo'), null)
  // 一个 JDK 都没探测到、其它也齐了 -> 没有可填的
  assert.equal(javaDefaults({ ...blank, outputPath: 'out', sourcePaths: ['src'] }, null, 'demo'), null)
})

test('Gradle JVM：默认用项目 JDK（ExternalSystemJdkUtil.USE_PROJECT_JDK），折成 JAVA_HOME', () => {
  assert.equal(GRADLE_RUN_DEFAULTS.gradleJvm, GRADLE_USE_PROJECT_JDK)
  assert.deepEqual(gradleEnvironment(GRADLE_RUN_DEFAULTS, 'C:\\jdk-21'), ['JAVA_HOME=C:\\jdk-21'])
  assert.deepEqual(gradleEnvironment({ ...GRADLE_RUN_DEFAULTS, gradleJvm: 'D:\\jdk-17' }, 'C:\\jdk-21'), ['JAVA_HOME=D:\\jdk-17'])
  assert.deepEqual(gradleEnvironment(GRADLE_RUN_DEFAULTS, ''), [], '项目也没配 JDK 就什么都不设')
})

test('接线：构建走分派、Gradle 同步带 env、设置页有 Gradle JVM', () => {
  const actions = read('src/runActions.ts')
  assert.match(actions, /buildPlan/)
  assert.match(actions, /collectBuildInputs/)
  assert.match(actions, /javaDefaults/)
  assert.ok(!/cmake --build build'/.test(actions), '写死 cmake 的旧逻辑必须消失')
  assert.match(read('src/gradleHost.ts'), /gradleEnvironment/)
  assert.match(read('src/components/GradleSettingsPage.vue'), /GRADLE_USE_PROJECT_JDK/)
  // 「构建并运行使用」下拉（）
  assert.match(read('src/components/GradleSettingsPage.vue'), /delegatedBuild/)
  assert.match(read('src/gradle.ts'), /DEFAULT_DELEGATE = true|GRADLE_DELEGATE_DEFAULT = true/)
  // 原生的 JDK 探测通道
  assert.match(read('native/main.cpp'), /"app\.jdks"/)
  assert.match(read('native/jdk.cpp'), /JavaHomeFinderBasic/)
})

test('Gradle 项目选「由 IDE 构建」时不跑 Gradle，走 javac（GradleProjectTaskRunner.canRun → false）', () => {
  const delegated = buildPlan(request_({ layout: layout({ gradle: true }), gradleDelegated: true }))
  assert.equal(delegated.kind, 'gradle')
  assert.match(delegated.command, /gradlew\.bat/)

  const own = buildPlan(request_({
    layout: layout({ gradle: true, java: true }), gradleDelegated: false, sources: ['src/Main.java'],
  }))
  assert.equal(own.kind, 'javac', '「构建并运行使用：IDE」= 本仓的 JPS 等价物（javac）')
  assert.ok(own.command.includes('javac'), own.command)
  assert.match(own.reason, /由 IDE 构建/, '理由要说清"为什么明明有 build.gradle 却跑 javac"')
})

test('projectKindOf：委托参数只影响 Gradle 那一档', () => {
  assert.equal(projectKindOf(layout({ gradle: true, java: true }), true), 'gradle')
  assert.equal(projectKindOf(layout({ gradle: true, java: true }), false), 'javac')
  assert.equal(projectKindOf(layout({ gradle: true, cmake: true }), false), 'cmake')
  assert.equal(projectKindOf(layout({ gradle: true }), false), '', '不委托、又没有 Java 源 → 交给项目配置的命令')
  assert.equal(projectKindOf(layout({ maven: true }), false), 'maven', '委托参数不影响 Maven（本仓还没做 Maven 的委托设置）')
})

// 「编译当前文件」（上游 `CompileAction.java:56-59` 的 `compile(files)` 那一支；
// `getCompilableFiles`（`:178-208`）只收源码内容里的可编译类型 = 本仓的 .java）。
test('compileFilesPlan：javac 项目只编选中的 .java（逐文件）', () => {
  const plan = compileFilesPlan(request_({
    layout: layout({ java: true }), gradleDelegated: false, sources: ['src/Main.java', 'src/Other.java'],
  }), ['src/Main.java', String.raw`src\Util.java`, 'README.md'])
  assert.equal(plan.kind, 'javac')
  assert.ok(plan.command.includes('javac'), plan.command)
  // argfile 只含两个 .java（README.md 被过滤），且反斜杠路径归一成 `/`。
  assert.equal(plan.argFile, '"src/Main.java"\r\n"src/Util.java"')
  assert.match(plan.reason, /2 个 Java 源文件/)
})

test('compileFilesPlan：没有可编译文件时不产出命令（不臆造）', () => {
  const plan = compileFilesPlan(request_({ layout: layout({ java: true }), gradleDelegated: false, sources: ['src/Main.java'] }), ['notes.txt'])
  assert.equal(plan.command, '')
  assert.match(plan.reason, /没有可编译的 Java 源文件/)
})

test('compileFilesPlan：Gradle/Maven 没有「只编文件」的粒度 ⇒ 退回整模块构建并说明', () => {
  const gradle = compileFilesPlan(request_({ layout: layout({ gradle: true, java: true }) }), ['src/Main.java'])
  assert.equal(gradle.kind, 'gradle')
  assert.match(gradle.reason, /没有“只编选中文件”的粒度/)
  assert.match(gradle.command, new RegExp(GRADLE_BUILD_TASKS))
  const maven = compileFilesPlan(request_({ layout: layout({ maven: true }) }), ['src/Main.java'])
  assert.equal(maven.kind, 'maven')
  assert.match(maven.reason, /退回整模块构建/)
})

test('接线：构建菜单有「编译当前文件」，startBuild 收第二个参数', () => {
  const menu = read('src/menus/buildMenu.ts')
  assert.match(menu, /id: 'build\.file'/)
  assert.match(menu, /ctx\.startBuild\(false, true\)/, '那一行要传 filesOnly')
  const actions = read('src/runActions.ts')
  assert.match(actions, /async function startBuild\(rebuild: boolean, filesOnly = false\)/)
  assert.match(actions, /compileFilesPlan\(request, \[activeFile\]\)/)
})
