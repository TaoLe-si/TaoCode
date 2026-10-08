// `src/gradleJvmDiagnostics.ts` 的判据（lane gradlejvmclose，2026-10-06）。
//
// 为什么这条文件必须存在：那份模块是**未跟踪**文件，另一条 lane（gradlehostfix）把它判给"独立的 JDK 诊断 lane"
// 之后它就一直无人认领。消费链在盘上是活的（`src/gradle.ts:172-175` 再导出、`src/gradleHost.ts:492/552/554/694` 调用），
// 但**全仓没有一条断言跑过它的行为**：
//   · `grep -rn "JAVA_HOME is set to an invalid\|JAVA_HOME is not set and no\|invalid-directory\|no-java-found" tests/`
//     在补这条文件之前 = **0 命中**（亲手跑过，见 `docs/batch-2026-10-06-gradlejvmclose.md` §0）。
//   ⇒ 这个模块存在的唯一理由（"包装器在 Gradle 起步之前就死了时面板只剩『Gradle 退出码 7』"）没有任何东西钉着。
//     删掉它的整条分支、把两个哨兵值写错、把再导出摘掉 —— 全仓一片绿。
//
// 上游坐标（本轮自己开 `D:\Backup\Downloads\intellij-community-master\intellij-community-master` 逐行数过，
// 原文与行号见报告 §1；`third_party/intellij-community` 是空树，禁用）：
//   · `platform/external-system-impl/src/com/intellij/openapi/externalSystem/service/execution/ExternalSystemJdkUtil.java`
//     `:49` `JAVA_HOME = "JAVA_HOME"`、`:51` `USE_INTERNAL_JAVA = "#JAVA_INTERNAL"`、
//     `:52` `USE_PROJECT_JDK = "#USE_PROJECT_JDK"`、`:53` `USE_JAVA_HOME = "#JAVA_HOME"`。
//   · `platform/lang-impl/src/com/intellij/openapi/roots/ui/configuration/SdkLookupProvider.kt:22-27` —— `SdkInfo` 四态。
//   · `plugins/gradle/src/org/jetbrains/plugins/gradle/service/execution/LocalGradleExecutionAware.kt`
//     `:139-141` 非 `Resolved` ⇒ `gradle.jvm.is.invalid`、`:143-145` 无 homePath ⇒ 同一条、
//     `:148-150` `checkForJdk` 不过 ⇒ 同一条、`:152-154` `checkForJre` 不过 ⇒ `gradle.jvm.is.jre`；
//     `:193-198` `jdkConfigurationException` 把 `gradle.open.gradle.settings` 拼进抛出的句子。
//   · `plugins/gradle/resources/messages/GradleBundle.properties` `:77` `:78` `:79` `:80` `:85`（`Open Gradle Settings`）` :91-93`。
//   · 包装器两行**逐字**取处：`platform/execution-process-mediator/common/gradlew:126-130`（invalid directory）
//     与 `:136-139`（not set and no 'java'）；Windows 侧 `gradlew.bat:61-64` 与 `:47-50`；
//     判的文件是 `gradlew:124` `$JAVA_HOME/bin/java` / `gradlew.bat:56` `%JAVA_HOME%/bin/java.exe`。
//
// 中文措辞本身**无法核实**：这份上游树里 Gradle 插件没有 zh 包（全仓只有 `AgreementsBundle_zh_CN` / `UpdaterBundle_zh_CN`
// 两个 `_zh_CN.properties`），⇒ 这里钉的是"句子里带着包装器打出的那个路径 / 说清 JAVA_HOME 未设置"，
// 英文原文的 key 与行号在源码注释里，不假装中文有出处。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// 直接 import 那份未跟踪模块本身（不是只走 `src/gradle.ts` 的再导出）：
// 它一旦被移动或改名，这里当场 ERR_MODULE_NOT_FOUND —— 这正是"代码落了、没人接"的第一道门。
import {
  GRADLE_JVM_OPEN_SETTINGS_ACTION,
  GRADLE_USE_JAVA_HOME,
  GRADLE_USE_PROJECT_JDK,
  gradleEnvironment,
  gradleJavaHomeIssue,
  gradleJvmIssueText,
  gradleJvmResolutionOf,
} from '../src/gradleJvmDiagnostics.ts'
// 公共面留在原路径上（`src/gradle.ts` 的再导出）；这条是"消费链断了没有"的判据。
import * as gradle from '../src/gradle.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

/** `gradlew:126-130` 打出来的那三行（POSIX），`$JAVA_HOME` 由 shell 换成实际值。 */
const POSIX_INVALID_DIR = (home) =>
  `ERROR: JAVA_HOME is set to an invalid directory: ${home}\n\n` +
  'Please set the JAVA_HOME variable in your environment to match the\nlocation of your Java installation.\n'
/** `gradlew:136-139` 那一行（PATH 里也没有 java）。 */
const NO_JAVA = 'ERROR: JAVA_HOME is not set and no \'java\' command could be found in your PATH.\n\n' +
  'Please set the JAVA_HOME variable in your environment to match the\nlocation of your Java installation.\n'
/** `gradlew.bat:61-64`（CRLF 结尾，Windows 侧的输出）。 */
const BAT_INVALID_DIR = 'ERROR: JAVA_HOME is set to an invalid directory: D:\\wrong jdk\r\n\r\n' +
  'Please set the JAVA_HOME variable in your environment to match the\r\nlocation of your Java installation.\r\n'
/** `gradlew.bat:47-50`。 */
const BAT_NO_JAVA = 'ERROR: JAVA_HOME is not set and no \'java\' command could be found in your PATH.\r\n\r\n' +
  'Please set the JAVA_HOME variable in your environment to match the\r\nlocation of your Java installation.\r\n'

// ---------------------------------------------------------------------------
// 哨兵值：必须与上游的字符串**逐字**相同（写错一个字符就是"选了 JAVA_HOME 却不认"）
// ---------------------------------------------------------------------------

test('两个哨兵值与 `ExternalSystemJdkUtil.java:52-53` 逐字相同', () => {
  assert.equal(GRADLE_USE_PROJECT_JDK, '#USE_PROJECT_JDK') // `:52`
  assert.equal(GRADLE_USE_JAVA_HOME, '#JAVA_HOME')          // `:53`
  // 默认档确实是 `#USE_PROJECT_JDK`（`GradleProjectSettings` 构造时的值，同文件 `:126` 的兜底）。
  assert.equal(gradle.GRADLE_RUN_DEFAULTS.gradleJvm, GRADLE_USE_PROJECT_JDK)
})

// ---------------------------------------------------------------------------
// 解析：`SdkInfo` 四态里本仓能判的那三档（`Resolving` 不装，见模块头）
// ---------------------------------------------------------------------------

test('gradleJvmResolutionOf 的三档：显式目录 / 项目 JDK 落空 / #JAVA_HOME 不覆盖', () => {
  // 选了项目 JDK 且项目确实配了 ⇒ Resolved 的等价物。
  assert.deepEqual(gradleJvmResolutionOf({ gradleJvm: GRADLE_USE_PROJECT_JDK }, 'C:\\jdk-21'),
    { state: 'resolved', home: 'C:\\jdk-21' })
  // 没填（undefined / 空串）⇒ 与上游 `LocalGradleExecutionAware.kt:126` 的兜底同一档。
  assert.deepEqual(gradleJvmResolutionOf({}, 'C:\\jdk-21'), { state: 'resolved', home: 'C:\\jdk-21' })
  assert.deepEqual(gradleJvmResolutionOf({ gradleJvm: '   ' }, 'C:\\jdk-21'), { state: 'resolved', home: 'C:\\jdk-21' })
  // 选了项目 JDK 但项目没配 ⇒ 本仓**不**判它无效（模块头登记的那一半：清单推不出不存在），只报 unset。
  assert.deepEqual(gradleJvmResolutionOf({ gradleJvm: GRADLE_USE_PROJECT_JDK }, ''), { state: 'unset', home: '' })
  assert.deepEqual(gradleJvmResolutionOf({ gradleJvm: GRADLE_USE_PROJECT_JDK }, '   '), { state: 'unset', home: '' })
  // `#JAVA_HOME` = 沿用宿主继承到的环境块（`native/runner.cpp:28-40`「the parent block is always the starting point」）
  // ⇒ 即便项目配了 JDK 也**不该**把它顶上去；这一条反向钉"选了 JAVA_HOME 却塞了项目 JDK"那种写反。
  assert.deepEqual(gradleJvmResolutionOf({ gradleJvm: GRADLE_USE_JAVA_HOME }, 'C:\\jdk-21'),
    { state: 'inherited', home: '' })
  // 直接写下的目录（设置页那个下拉的第二类）原样交给子进程，前后空格剔掉。
  assert.deepEqual(gradleJvmResolutionOf({ gradleJvm: ' D:\\jdk-17 ' }, 'C:\\jdk-21'), { state: 'resolved', home: 'D:\\jdk-17' })
})

test('gradleEnvironment 只产 `JAVA_HOME=…` 一条覆盖，且形状是 native 侧认的 `KEY=VALUE`', () => {
  // `native/gradle.cpp:50-53` 把带 `=` 的条目交给 `Spec.environment`；
  // `native/runner.hpp:30-32` 写明这些是**叠在继承来的环境之上**。
  const entries = gradleEnvironment({ gradleJvm: GRADLE_USE_PROJECT_JDK }, 'C:\\jdk-21')
  assert.deepEqual(entries, ['JAVA_HOME=C:\\jdk-21'])
  assert.equal(entries.every(entry => entry.includes('=')), true, '没有 `=` 的条目会被 native/gradle.cpp:51 静默丢掉')
  assert.deepEqual(gradleEnvironment({ gradleJvm: GRADLE_USE_JAVA_HOME }, 'C:\\jdk-21'), [], '不覆盖 = 用环境变量 JAVA_HOME')
  assert.deepEqual(gradleEnvironment({ gradleJvm: GRADLE_USE_PROJECT_JDK }, ''), [], '什么都没解析出来时也不覆盖')
  assert.deepEqual(gradleEnvironment({ gradleJvm: 'D:\\jdk-17' }, 'C:\\jdk-21'), ['JAVA_HOME=D:\\jdk-17'])
})

// ---------------------------------------------------------------------------
// 认输出：包装器那两条 + 「认不出就返回 null」（后半条更重要 —— 认错会把普通 Gradle 失败说成 JDK 问题）
// ---------------------------------------------------------------------------

test('gradleJavaHomeIssue 认 POSIX 与 Windows 包装器的两种死法，认不出时返回 null', () => {
  const invalid = gradleJavaHomeIssue(POSIX_INVALID_DIR('/nonexistent/jdk'))
  assert.deepEqual(invalid, { kind: 'invalid-directory', home: '/nonexistent/jdk' })
  const noJava = gradleJavaHomeIssue(NO_JAVA)
  assert.deepEqual(noJava, { kind: 'no-java-found', home: '' })
  // Windows 那两行（`gradlew.bat:61` 与 `:47`）措辞与 POSIX 逐字相同，值带空格与反斜杠。
  assert.deepEqual(gradleJavaHomeIssue(BAT_INVALID_DIR), { kind: 'invalid-directory', home: 'D:\\wrong jdk' })
  assert.deepEqual(gradleJavaHomeIssue(BAT_NO_JAVA), { kind: 'no-java-found', home: '' })
  // 输出前面还有别的内容时也认（包装器把 die 打在 stderr，与 gradle 的横幅混在一起落进同一个缓冲）。
  assert.equal(gradleJavaHomeIssue(`Downloading https://services.gradle.org/...\n${POSIX_INVALID_DIR('C:\\x')}`).kind, 'invalid-directory')

  // **反向**：普通失败不是 JDK 问题。这三条任一被"顺手放宽"（比如改成匹配 `JAVA_HOME` 一词）就当场红。
  assert.equal(gradleJavaHomeIssue('FAILURE: Build failed with an exception.\n\n* What went wrong:\nCould not resolve com.acme:lib:1.0\n'), null)
  assert.equal(gradleJavaHomeIssue('BUILD FAILED in 1m 15s\n'), null)
  assert.equal(gradleJavaHomeIssue('Some log mentioning JAVA_HOME=/opt/jdk without an error.\n'), null,
    '只是提到 JAVA_HOME 变量的正常输出不该被判成 JDK 失败')
})

test('包装器打出的值为空时，不要把下一行的说明抓成路径', () => {
  // `%JAVA_HOME%` 定义为空串时 `gradlew.bat:61` 打出的是"冒号 + 空格 + 换行"。
  // 取值的正则若用 `\s*` 跳过冒号后的空白，会把换行也吞掉 ⇒ 下一行的
  // 「Please set the JAVA_HOME variable…」变成"路径"，通知上就会出现一句胡话。
  const issue = gradleJavaHomeIssue('ERROR: JAVA_HOME is set to an invalid directory: \n\n' +
    'Please set the JAVA_HOME variable in your environment to match the\nlocation of your Java installation.\n')
  assert.equal(issue?.kind, 'invalid-directory')
  assert.equal(issue?.home, '', '只能取到本行的剩余内容，不许跨行')
  const text = gradleJvmIssueText({ kind: 'invalid-directory', home: '/nonexistent/jdk' })
  // 措辞的原文是 `GradleBundle.properties:78`（`Gradle JVM option is incorrect:\nPath:{0}`）+ 包装器已验过的事实；
  // 中文是译法，钉的是"必须把那个路径带给用户看"，不是钉中文出处（zh 包不存在，见报告 §5）。
  assert.ok(text.includes('/nonexistent/jdk'), '无效目录要打出具体路径，不能只剩一句『不正确』')
  assert.equal(text.includes('Please set'), false, '不许把包装器的下一行漏进用户可见的句子')
})

test('两种死法各给一句可操作的话', () => {
  assert.match(gradleJvmIssueText({ kind: 'invalid-directory', home: 'C:\\jdk-nope' }), /Gradle JVM 选项不正确.*C:\\jdk-nope/)
  assert.equal(gradleJvmIssueText({ kind: 'no-java-found', home: '' }),
    '请设置 Gradle JVM 选项：JAVA_HOME 未设置，PATH 里也没有 java。')
  // 「打开 Gradle 设置」是**动作标签**，上游对应 `GradleBundle.properties:85` `Open Gradle Settings`
  // （`LocalGradleExecutionAware.kt:195` 抛错时拼的就是它）；本仓是中文，措辞无法核实（§5），
  // 但它必须非空 —— 空标签在通知上就是一个点不动的按钮。
  assert.equal(GRADLE_JVM_OPEN_SETTINGS_ACTION.trim().length > 0, true)
})

// ---------------------------------------------------------------------------
// 消费链：这三条断了任意一条，本文件就红 —— 断链正是本项目最常见的事故
// ---------------------------------------------------------------------------

test('`src/gradle.ts` 的再导出面齐全（公共面留在原路径）', () => {
  for (const name of ['GRADLE_USE_PROJECT_JDK', 'GRADLE_USE_JAVA_HOME', 'gradleJvmResolutionOf', 'gradleEnvironment',
    'gradleJavaHomeIssue', 'gradleJvmIssueText', 'GRADLE_JVM_OPEN_SETTINGS_ACTION']) {
    assert.notEqual(gradle[name], undefined, `src/gradle.ts 少了 \`${name}\` 的再导出`)
  }
  // `src/gradle.ts:173-175` 那一行是"搬出去但不断公共面"的唯一痕迹。
  assert.match(read('src/gradle.ts'), /from '\.\/gradleJvmDiagnostics\.ts'/)
})

test('`gradleFailure` 真的走这一族：包装器先死时不再只剩「退出码 N」', () => {
  // 这条跑的是**生产出口**（`src/gradle.ts:371-376` → `src/gradleHost.ts:552`），不是模块自己的函数。
  assert.equal(gradle.gradleFailure(POSIX_INVALID_DIR('/opt/broken-jdk')),
    gradleJvmIssueText({ kind: 'invalid-directory', home: '/opt/broken-jdk' }))
  assert.equal(gradle.gradleFailure(NO_JAVA), gradleJvmIssueText({ kind: 'no-java-found', home: '' }))
  // 反向：JDK 分支不许劫持普通失败（`tests/gradle.test.mjs:217-257` 钉的那些形状必须原样有效）。
  assert.equal(gradle.gradleFailure('FAILURE: Build failed with an exception.\n'), 'Build failed with an exception.')
  assert.equal(gradle.gradleFailure('BUILD SUCCESSFUL in 3s'), '')
})

test('`src/gradleHost.ts` 的两个出口都接着：env 覆盖与 JDK 失败换动作', () => {
  const host = read('src/gradleHost.ts')
  // 同步/依赖加载（`:492`）与任务运行（`:694`）两处都走 `gradleEnvironment` —— 少一处就是"设置页选了 JDK，跑任务时用了另一个"。
  assert.equal(host.match(/gradleEnvironment\(buildTools\.value\.gradle, deps\.projectSettings\.value\.java\?\.jdkHome \?\? ''\)/g)?.length, 2,
    '两条执行路径都要按同一规则给子进程叠 JAVA_HOME')
  // 失败分类（`:552`）与换动作（`:554`）成对出现，且用的是模块的那个标签常量而不是硬编码字符串。
  assert.match(host, /const jvmIssue = gradleJavaHomeIssue\(output\)/)
  assert.match(host, /jvmIssue \? \[\{ label: GRADLE_JVM_OPEN_SETTINGS_ACTION, run: \(\) => \{ void deps\.openSettings\(GRADLE_CONFIGURABLE_ID\) \} \}\] : undefined/)
  assert.equal(host.match(/GRADLE_JVM_OPEN_SETTINGS_ACTION/g)?.length, 2, '一次 import、一次使用，别多出第三处硬拼')
})

test('`native/gradle.cpp` 仍然把 `KEY=VALUE` 覆盖叠进 `Spec.environment`', () => {
  const native = read('native/gradle.cpp')
  assert.match(native, /for \(const auto& entry : environment\) \{/)
  assert.match(native, /spec\.environment\.push_back\(taocode::wide\(entry\)\);/)
})
