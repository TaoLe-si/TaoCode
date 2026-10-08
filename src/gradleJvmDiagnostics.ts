// Gradle JVM 的解析与「JAVA_HOME 用不了」时的用户可见诊断（`src/gradle.ts` 里搬出来的这一族，
// gradle.ts 用 `export { … } from './gradleJvmDiagnostics.ts'` 把公共面留在原路径上）。
//
// **归属（2026-10-06 lane gradlejvmclose 认领）**：文件是未跟踪状态落盘的，`gradlehostfix` 把它判给
// 「独立的 JDK 诊断 lane」而那条 lane 并不存在 ⇒ 由本 lane 收口。消费链：`src/gradle.ts:172-175`（再导出 +
// `gradleFailure` 用它分类）、`src/gradleHost.ts:492/694`（叠 `JAVA_HOME`）、`:552-554`（失败时换「打开 Gradle 设置」动作）。
// 判据：`tests/gradle-jvm-diagnostics.test.mjs`（补这条之前全仓**没有一条断言**跑过本模块的行为，见其文件头）。
//
// 为什么要有这一份：本仓「SDK/jdkHome 解析失败」过去**没有任何用户可见的下游** ——
// 包装器在 Gradle 起步之前就死了时，面板只剩「Gradle 退出码 7」（`gradleHost.execute` 里
// `gradleFailure(output)` 认不出 `FAILURE:` / `* What went wrong:` 就是空串）。
//
// 逐条对照的源码（相对 `D:\Backup\Downloads\intellij-community-master\intellij-community-master`，本轮亲手打开数过）：
//   · 哨兵值 `platform/external-system-impl/src/com/intellij/openapi/externalSystem/service/execution/ExternalSystemJdkUtil.java:49-53`
//     （`:49` `JAVA_HOME = "JAVA_HOME"`、`:51` `USE_INTERNAL_JAVA = "#JAVA_INTERNAL"`、
//     `:52` `USE_PROJECT_JDK = "#USE_PROJECT_JDK"`、`:53` `USE_JAVA_HOME = "#JAVA_HOME"`）。
//   · 解析结果的四态 `platform/lang-impl/src/com/intellij/openapi/roots/ui/configuration/SdkLookupProvider.kt:22-27`
//     （`SdkInfo.Undefined` / `Unresolved` / `Resolving(name, versionString, homePath)` / `Resolved(...)`）。
//   · 解析完之后的检查与抛错 `plugins/gradle/src/org/jetbrains/plugins/gradle/service/execution/LocalGradleExecutionAware.kt:132-157`：
//     `:139-141` 不是 `Resolved` ⇒ `gradle.jvm.is.invalid`；`:143-145` 没有 homePath ⇒ 同一条；
//     `:148-150` `JdkUtil.checkForJdk` 不过 ⇒ 同一条；`:152-154` `checkForJre` 不过 ⇒ `gradle.jvm.is.jre`。
//     抛出去的句子由同文件 `:193-198` 的 `jdkConfigurationException` 拼上「Open Gradle Settings」那条链接。
//   · 「一个 SDK 都找不到」那一档的专门文案：`plugins/gradle/resources/messages/GradleBundle.properties:91-93`
//     （`Unable to run Gradle` / `Unable to find SDK for Gradle execution` / `Set Project SDK`），本体
//     `plugins/gradle/src/org/jetbrains/plugins/gradle/execution/target/NoJdkForToolingProxyBuildIssue.kt:13-35`
//     （`:15` 取标题、`:32-34` 把动作拼进描述、`:22-26` 那个 quick fix 打开工程设置页）。
//   · 其余文案：`GradleBundle.properties:77`（`gradle.jvm.undefined=Please set the Gradle JVM option`）、
//     `:78`（`gradle.jvm.incorrect=Gradle JVM option is incorrect:\nPath:{0}`）、
//     `:79`（`gradle.jvm.is.jre=Please use JDK instead of JRE for Gradle importer.`）、
//     `:80`（`gradle.jvm.is.invalid=Invalid Gradle JDK configuration found.`）、
//     `:85`（`gradle.open.gradle.settings=Open Gradle Settings`）。
//   · **本仓唯一能实证「JAVA_HOME 用不了」的来源**是包装器自己打的那两行：
//     `platform/execution-process-mediator/common/gradlew:126-130`
//     （`ERROR: JAVA_HOME is set to an invalid directory: $JAVA_HOME` + `Please set the JAVA_HOME variable …`）
//     与同文件 `:136-139`（`ERROR: JAVA_HOME is not set and no 'java' command could be found in your PATH.`）；
//     Windows 侧同两条在 `platform/execution-process-mediator/common/gradlew.bat:61-64` 与 `:47-50`。
//     包装器判的就是 `$JAVA_HOME/bin/java`（`gradlew:124`、`gradlew.bat:56`）在不在 —— 所以下面那句
//     「路径里没有可用的 JDK」不是猜的，是它已经验过的事。
//
// **本仓判不了的那一半（登记，不当已闭）**：「设置里写下的 home 目录此刻还在不在磁盘上」。
// 上游那三行检查（`checkForJdk` / `checkForJre` / homePath 空）问的是**任意绝对路径**；本仓只有
// `app.jdks`（`native/jdk.cpp` 的 `find_all()`）那份**扫描根之内**的清单，扫描没覆盖到的目录它一律不答，
// 所以「不在清单里」推不出「不存在」⇒ 这里绝不因为清单里没有就说配置无效，
// 只在包装器真的报出上面那两行时给结论。要补这一半得开 `file.stat`（`docs/wiring-requests-2026-10-06-roots3.md` 的 A2）。

/** `ExternalSystemJdkUtil.USE_PROJECT_JDK`（`ExternalSystemJdkUtil.java:52`，`GradleProjectSettings` 构造时的默认档）。 */
export const GRADLE_USE_PROJECT_JDK = '#USE_PROJECT_JDK'

/**
 * `ExternalSystemJdkUtil.USE_JAVA_HOME`（`ExternalSystemJdkUtil.java:53`）：**用环境变量 `JAVA_HOME`**。
 *
 * 本仓的等价物不需要额外通道：宿主起子进程时**先继承父进程整个环境块**再盖上覆盖项
 * （`native/runner.cpp:28-40` 的 `environment_block` 注释原文「the parent block is always the starting point」），
 * 所以「不覆盖 `JAVA_HOME`」就是「用环境变量 `JAVA_HOME`」。
 * 上游那条 `UndefinedJavaHomeException`（宿主没设 `JAVA_HOME` 时报错）本仓**无法核实**：前端没有读环境变量的
 * 通道（`native/main.cpp` 的 Method 清单里没有 env 读取，只有 `:1458` `app.jdks`）。准确说：宿主的 JDK
 * finder 内部会读 `JAVA_HOME`/`JDK_HOME` 当扫描根（`native/jdk.cpp:255-256`），但**那个值不往外给**，
 * ⇒ 前端既不能确认它设过、也不能确认它没设，只能让 Gradle 自己按继承来的值走（登记见报告 §5）。
 */
export const GRADLE_USE_JAVA_HOME = '#JAVA_HOME'

/** `SdkInfo` 四态里本仓**能判**的那三档（`Resolving` 这一态本仓没有异步 SDK 查找器，不装）。 */
export type GradleJvmState =
  /** 解析出一个具体目录，交给子进程当 `JAVA_HOME`。 */
  | 'resolved'
  /** `#JAVA_HOME`：不覆盖，沿用宿主继承到的环境块（上游 `USE_JAVA_HOME` 的语义）。 */
  | 'inherited'
  /** 什么都没解析出来（选了「项目 JDK」但项目没配 `jdkHome`）⇒ 这一次同样不覆盖。 */
  | 'unset'

export interface GradleJvmResolution {
  state: GradleJvmState
  /** 要叠给子进程的 `JAVA_HOME` 值；`inherited` / `unset` 时是空串（= 不覆盖）。 */
  home: string
}

/**
 * 「Gradle JVM」的取值 → 目录（入参按 `GradleRunSettings` 的结构形状收，免得这一份反向依赖 gradle.ts）。
 *
 * 上游 `gradleJvm` 存的是 **SDK 名字引用**，由 `GradleJvmLookupProvider` 去 SDK 表里解；本仓存的是
 * `#USE_PROJECT_JDK` / 一个直接写下的目录 ——「解不出来」只有「项目 JDK 那一档落空」这一种。
 * `#JAVA_HOME` 这一档本模块认（⇒ `inherited`，什么都不覆盖），但**设置页的下拉当前不提供它**：
 * `src/components/GradleSettingsPage.vue:68-71` 只有「项目 JDK（默认）」+ `app.jdks` 扫到的目录 + 一条「已配置」回显。
 * 所以 `inherited` 只能从已落盘/手工写下的值进来；给下拉补这一档的请求登记在
 * `docs/batch-2026-10-06-gradlejvmclose.md` §6（不在这里假装它可选）。
 */
export function gradleJvmResolutionOf(settings: { gradleJvm?: string }, projectJdkHome: string): GradleJvmResolution {
  const chosen = (settings.gradleJvm ?? '').trim()
  if (chosen === GRADLE_USE_JAVA_HOME) return { state: 'inherited', home: '' }
  const home = chosen === GRADLE_USE_PROJECT_JDK || !chosen ? (projectJdkHome ?? '').trim() : chosen
  if (home) return { state: 'resolved', home }
  return { state: 'unset', home: '' }
}

/**
 * 「Gradle JVM」→ 子进程的环境变量覆盖项（`native/gradle.cpp:50-52` 把它交给 `Spec.environment`，
 * `native/runner.hpp:30-32` 写明这些 `KEY=VALUE` 是**叠在继承来的环境之上**）。
 * 空数组 = 不覆盖 = 沿用宿主的 `JAVA_HOME`（就是 `#JAVA_HOME` 那一档）。
 */
export function gradleEnvironment(settings: { gradleJvm?: string }, projectJdkHome: string): string[] {
  const { home } = gradleJvmResolutionOf(settings, projectJdkHome)
  return home ? [`JAVA_HOME=${home}`] : []
}

/** 包装器报的两种「JAVA_HOME 用不了」（`gradlew:126-139` / `gradlew.bat:47-64`）；认不出返回 null。 */
export interface GradleJavaHomeIssue {
  kind: 'invalid-directory' | 'no-java-found'
  /** `invalid-directory` 时是包装器打出来的那个值；另一种是空串。 */
  home: string
}

export function gradleJavaHomeIssue(output: string): GradleJavaHomeIssue | null {
  // 冒号后**只跳水平空白**：这里用 `\s*` 会连换行一起吞，包装器值为空时（`gradlew.bat:61` 的
  // `%JAVA_HOME%` 展开成空串）就把下一行的「Please set the JAVA_HOME variable …」抓成路径。
  const invalid = /ERROR: JAVA_HOME is set to an invalid directory:[ \t]*(.*)/i.exec(output)
  if (invalid) return { kind: 'invalid-directory', home: invalid[1]!.trim() }
  if (/ERROR: JAVA_HOME is not set and no 'java' command could be found in your PATH/i.test(output)) {
    return { kind: 'no-java-found', home: '' }
  }
  return null
}

/**
 * 把包装器那两行折成一句可操作的话。
 * 措辞的原文：`GradleBundle.properties:78`（`Gradle JVM option is incorrect:\nPath:{0}`）与
 * `:77`（`Please set the Gradle JVM option`）；后半句「没有可用的 JDK（java 可执行文件找不到）」是
 * 包装器已经验过的事（`gradlew:124-127`、`gradlew.bat:56-61` 判的就是那个文件在不在）。
 */
export function gradleJvmIssueText(issue: GradleJavaHomeIssue): string {
  return issue.kind === 'invalid-directory'
    ? `Gradle JVM 选项不正确：路径 ${issue.home} 里没有可用的 JDK（java 可执行文件找不到）。`
    : '请设置 Gradle JVM 选项：JAVA_HOME 未设置，PATH 里也没有 java。'
}

/** 「打开 Gradle 设置」这条动作的标签（`GradleBundle.properties:85` `Open Gradle Settings`，上游抛错时拼的就是它）。 */
export const GRADLE_JVM_OPEN_SETTINGS_ACTION = '打开 Gradle 设置'
