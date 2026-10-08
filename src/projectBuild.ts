// 「构建项目 / 重新构建」怎么折算成一条命令行 —— 对照 IDEA 的 `ProjectTaskManager` 分派。
//
// 为什么要有这个模块（桃 2026-09-27：「主要是真的能构建 java 代码，gradle 等配置，
// IDEA 打开默认都是有的，现在逻辑错误」）：本仓原先的 `startBuild` 是
// `runCommand.value.trim() || 'cmake --build build'` —— **打开一个 Gradle / Java 项目按 Ctrl+F9
// 会去跑 cmake**。IDEA 不是这样：Ctrl+F9 走 `ProjectTaskManager.buildAllModules()`，
// 由各个 `ProjectTaskRunner` 按项目类型认领：
//
//   · `java/compiler/impl/src/com/intellij/compiler/actions/CompileDirtyAction.java:28-30`
//       `doAction` → `ProjectTaskManager.getInstance(project).buildAllModules()`（Build Project，Ctrl+F9）；
//     `.../CompileAction.java:44-60` → `rebuild(module)` / `compile(files)`（Rebuild，Ctrl+Shift+F9）。
//   · Gradle 项目 `plugins/gradle/java/src/execution/build/GradleProjectTaskRunner.kt:186-214`
//       `canRun` 认领 `ModuleBuildTask` / `BuildTask`，任务名由 `TasksExecutionSettingsBuilder` 折算：
//       `TasksExecutionSettingsBuilder.java:151-181` ——
//         `buildTaskSuffix = "classes"`，`sourceSetName = "main"` ⇒ **`classes`**，
//         再加 test source set 的 **`testClasses`**（`:175-176`）；
//         模块里没有 `classes` 但有 `assemble` 时退回 **`assemble`**（`:178-180`）；
//       Rebuild 的语义**不是 clean**：`:52-58` 的 `FORCE_COMPILE_TASKS_INIT_SCRIPT_TEMPLATE`
//         给 `AbstractCompile` 任务挂 `outputs.upToDateWhen { false }`，`:143-145` 在非增量构建时注入它。
//   · Maven 项目 `plugins/maven/.../execution/build/MavenProjectTaskRunner.kt:176-193`
//       `clean = moduleBuildTasks.any { !it.isIncrementalBuild() }`（Rebuild ⇒ 加 `clean`），
//       目标阶段 `getPhase()`（`:215-220`）在只编译文件时是 **`compile`**。
//   · 没有外部系统的 Java 项目 `java/compiler/impl/src/com/intellij/task/impl/JpsProjectTaskRunner.java`
//       交给 JPS 编译器（`javac` 的等价物）—— 本仓直接用 `javac`，这才是"真的能构建 Java 代码"。
//
// 纯逻辑（零 import 之外无副作用），可 `node --test` 直接 import。
import type { GradleDetection, GradleRunSettings } from './gradle.ts'
import { gradleCommand } from './gradle.ts'
import { orderCompileClasspath } from './orderRoots.ts'

/** 构建时认领这个项目的"执行者"（IDEA 里就是哪个 ProjectTaskRunner 接手）。 */
export type ProjectKind = 'gradle' | 'maven' | 'javac' | 'cmake'

export interface ProjectLayout {
  /** 有 Gradle 构建脚本（`detectGradle().isGradle`）。 */
  gradle: boolean
  /** 工作区根有 `pom.xml`。 */
  maven: boolean
  /** 工作区根有 `CMakeLists.txt`。 */
  cmake: boolean
  /** 工作区里有 `.java` 源文件。 */
  java: boolean
}

export const MAVEN_POM_FILE = 'pom.xml'
export const CMAKE_PROJECT_FILE = 'CMakeLists.txt'

/** Gradle 的构建任务（`TasksExecutionSettingsBuilder.java:151-160`）。 */
export const GRADLE_BUILD_TASKS = 'classes testClasses'
/** 模块里没有 `classes` 时的兜底任务（`:178-180`）。 */
export const GRADLE_ASSEMBLE_TASK = 'assemble'
/** Rebuild 用的 CLI 等价物（IDEA 用 init script 让 `AbstractCompile` 不 up-to-date）。 */
export const GRADLE_FORCE_REBUILD_FLAG = '--rerun-tasks'
/** Maven 的编译阶段（`MavenProjectTaskRunner.kt:215-220`）。 */
export const MAVEN_COMPILE_GOAL = 'compile'
export const MAVEN_CLEAN_GOAL = 'clean'

/**
 * 谁来构建。顺序 = IDEA 的 `ProjectTaskRunner` 优先级：外部系统（Gradle/Maven）先认领，
 * 都没有才落到 JPS（本仓的 javac）；CMake 是 TaoCode 自己支持的工程类型，排最后。
 *
 * `delegated = false` 就是 IDEA 的「构建并运行使用：IntelliJ IDEA」——
 * `GradleProjectTaskRunner.canRun`（`:209-214`）会返回 false，构建落到 `JpsProjectTaskRunner`。
 * 本仓那一档就是 javac，所以 Gradle 项目在这个设置下**照样走 javac**。
 */
export function projectKindOf(layout: ProjectLayout, delegated = true): ProjectKind | '' {
  if (layout.gradle && delegated) return 'gradle'
  if (layout.maven) return 'maven'
  if (layout.java) return 'javac'
  if (layout.cmake) return 'cmake'
  return ''
}

export function projectKindLabel(kind: ProjectKind | ''): string {
  switch (kind) {
    case 'gradle': return 'Gradle'
    case 'maven': return 'Maven'
    case 'javac': return 'Java 编译'
    case 'cmake': return 'CMake'
    default: return '未知'
  }
}

export interface BuildRequest {
  layout: ProjectLayout
  /** Rebuild（Ctrl+Shift+F9）而不是 Build（Ctrl+F9）。 */
  rebuild: boolean
  detection: GradleDetection | null
  gradle: GradleRunSettings
  /** 「构建并运行使用」：true = 交给 Gradle，false = 用本仓的 javac（`GradleProjectSettings.getDelegatedBuild()`）。 */
  gradleDelegated: boolean
  /** Java 项目用的 JDK 主目录（空 = 没探测到，走 PATH 上的 javac）。 */
  jdkHome: string
  /** 编译输出目录（相对工作区）；空时用 `defaultJavaOutputPath`。 */
  outputPath: string
  /** 类路径上的 jar（相对或绝对路径）。 */
  classpath: readonly string[]
  /** 待编译的 `.java`（工作区相对路径）。 */
  sources: readonly string[]
  /** 工作区名字（JPS 的模块名，决定默认输出目录）。 */
  projectName: string
  /** 没有识别出项目类型时的兜底命令（用户配置的构建命令）。 */
  fallback: string
}

export interface BuildPlan {
  kind: ProjectKind | ''
  /** 给用户看的标签（构建/重新构建 + 执行者）。 */
  label: string
  /** 要跑的命令行。 */
  command: string
  /**
   * `javac` 的 `@argfile` 内容（只有 `javac` 分支非空）——
   * 源文件多的时候命令行会超 Windows 的长度上限，javac 支持 `@file` 读参数。
   */
  argFile: string
  /** 为什么要走这条路（界面上如实显示，便于排查）。 */
  reason: string
}

/**
 * IDEA 的 JPS 默认编译输出：`out/production/<模块名>`
 * （`CompilerConfiguration` 的项目编译输出 + 模块名；模块名取工作区目录名）。
 */
export function defaultJavaOutputPath(projectName: string): string {
  const name = projectName.trim().replace(/[\\/]+$/, '').split(/[\\/]/).pop() || 'unnamed'
  return `out/production/${name}`
}

/** 相对工作区的输出目录（IDEA 的约定都是相对项目根）。 */
export function javaOutputPath(request: Pick<BuildRequest, 'outputPath' | 'projectName'>): string {
  return request.outputPath.trim() || defaultJavaOutputPath(request.projectName)
}

/** Windows 的类路径分隔符是 `;`（`File.pathSeparator`）。 */
export const CLASSPATH_SEPARATOR = ';'

/**
 * Gradle 构建的**运行时输出目录**（Gradle 的 `sourceSet.output` 默认布局）。
 *
 * `classes testClasses` 两个任务分别写 `main` 与 `test` 两个 source set，运行期两者都要在
 * classpath 上（IDEA 的 `GradleModuleSourceSetOutputPaths` 给的就是这两组，见
 * `plugins/gradle/java/src/execution/build/GradleBaseApplicationEnvironmentProvider.kt:118-126`
 * —— 委托构建时 classpath 由 `sourceSets[name].runtimeClasspath` 决定，而不是 IDEA 猜出来的路径）。
 */
export const GRADLE_RUNTIME_OUTPUTS = ['build/classes/java/main', 'build/resources/main', 'build/classes/java/test', 'build/resources/test'] as const

/** Maven 的运行时输出目录（`target/classes` + 测试）。 */
export const MAVEN_RUNTIME_OUTPUTS = ['target/classes', 'target/test-classes'] as const

/**
 * 运行时 classpath 里**构建工具实际写出的**那些目录 —— 「运行」必须从构建的落点读类。
 *
 * 为什么必须有这个函数（2026-09-27 桃报「Main 依旧无法运行 / 找不到主类 Main」）：
 * 运行期原先一律用 `out/production/<名字>`（JPS 的约定），但那是 **javac 分支**才成立的落点 ——
 * Gradle 的 `classes` 写 `build/classes/java/main`、Maven 的 `compile` 写 `target/classes`。
 * 于是 Gradle/Maven 项目"构建成功、运行却找不到主类"。IDEA 不会这样：它要么把整个启动交给
 * Gradle（`GradleBaseApplicationEnvironmentProvider.createExecutionEnvironment` 生成
 * `<配置名>.main()` 的 `JavaExec` 任务，`:110-118`），要么用模块自己的 classpath
 * （`JavaParametersUtil.configureConfiguration` → `ModuleRootManager` 的 `OrderEnumerator`），
 * **两种情况的产物目录都来自构建工具**，不是别处猜的。
 */
export function runtimeOutputPaths(input: {
  layout: ProjectLayout
  /** 「构建并运行使用」；缺省 = 委托给 Gradle（IDEA 的默认值）。 */
  gradleDelegated?: boolean
  /** 只有 javac 分支用它（用户配的编译输出，空则用 JPS 的默认值）。 */
  outputPath?: string
  projectName?: string
}): string[] {
  const kind = projectKindOf(input.layout, input.gradleDelegated ?? true)
  if (kind === 'gradle') return [...GRADLE_RUNTIME_OUTPUTS]
  if (kind === 'maven') return [...MAVEN_RUNTIME_OUTPUTS]
  return [javaOutputPath({ outputPath: input.outputPath ?? '', projectName: input.projectName ?? '' })]
}

/**
 * `javac` 的命令行 —— JPS 编译一次的等价物。
 *
 * `-g` 生成调试信息（IDEA 的 javac 选项默认带 `-g`），`-encoding UTF-8` 与编辑器一致。
 * 源文件走 `@argfile`（见 `BuildPlan.argFile`）。
 */
export function javacCommand(request: BuildRequest, argFile: string): string {
  const output = javaOutputPath(request)
  // 分隔符跟着调用方给的路径走（探测结果是 `D:\Java21`，手输可能是 `D:/Java21`）——
  // 混着拼会得到 `D:/Java21\bin\javac.exe`，Windows 认但看着像 bug。
  const home = request.jdkHome.trim().replace(/[\\/]+$/, '')
  const executable = home ? (home.includes('\\') ? `${home}\\bin\\javac.exe` : `${home}/bin/javac.exe`) : 'javac'
  // 类路径走 `OrderRootType.CLASSES` 的枚举顺序：模块输出根在前、库根在后，按首次出现去重
  // （上游 `OrderRootComputer.computeRoots` 的 `LinkedHashSet`；规则与缓存见 src/orderRoots.ts）。
  const classpath = orderCompileClasspath({
    moduleName: request.projectName,
    outputPaths: [output],
    libraryRoots: [{ classes: request.classpath }],
  }).join(CLASSPATH_SEPARATOR)
  return `"${executable}" -encoding UTF-8 -g -d "${output}" -cp "${classpath}" @${argFile}`
}

/**
 * `javac` 的 argfile：一行一个源文件。
 * 路径里可能有空格，所以每行都加引号（javac 的 argfile 支持引号）。
 */
export function javacArgFile(sources: readonly string[]): string {
  // javac 的引号内仍处理反斜杠转义（例如 \\test 会吃成制表符）；Windows 同样接受正斜杠。
  return sources.map(source => `"${source.replace(/\\/g, '/').replace(/"/g, '')}"`).join('\r\n')
}

/** argfile 的落点（放在输出目录旁边，不污染源码树）。 */
export function javacArgFilePath(): string {
  return '.taocode-javac-args.txt'
}

/** Gradle 的构建命令（`gradleCommand` 已经处理 wrapper / 离线 / 用户主目录）。 */
export function gradleBuildCommand(request: BuildRequest): string {
  const detection = request.detection
  if (!detection) return ''
  const base = gradleCommand(detection, request.gradle, GRADLE_BUILD_TASKS)
  return request.rebuild ? `${base} ${GRADLE_FORCE_REBUILD_FLAG}` : base
}

export function mavenBuildCommand(request: BuildRequest): string {
  const goals = request.rebuild ? `${MAVEN_CLEAN_GOAL} ${MAVEN_COMPILE_GOAL}` : MAVEN_COMPILE_GOAL
  return `mvn ${goals}`
}

/**
 * 把"构建项目"折算成一条命令。
 *
 * `javac` 分支在没有源文件时返回空命令（没东西可编 —— 报"没有 Java 源文件"比跑一条空命令诚实）。
 */
export function buildPlan(request: BuildRequest): BuildPlan {
  const kind = projectKindOf(request.layout, request.gradleDelegated)
  const label = `${request.rebuild ? '重新构建' : '构建'}（${projectKindLabel(kind)}）`
  switch (kind) {
    case 'gradle': {
      const command = gradleBuildCommand(request)
      return {
        kind, label, command, argFile: '',
        reason: command
          ? `Gradle 项目：跑 ${GRADLE_BUILD_TASKS}${request.rebuild ? ` ${GRADLE_FORCE_REBUILD_FLAG}` : ''}`
          : '没有找到可用的 Gradle（既没有 wrapper，也没有配置 Gradle 路径）。',
      }
    }
    case 'maven':
      return { kind, label, command: mavenBuildCommand(request), argFile: '', reason: `Maven 项目：跑 ${MAVEN_COMPILE_GOAL}${request.rebuild ? `（先 ${MAVEN_CLEAN_GOAL}）` : ''}` }
    case 'javac': {
      if (!request.sources.length) return { kind, label, command: '', argFile: '', reason: '工作区里没有 .java 源文件。' }
      const argFile = javacArgFilePath()
      // 「构建并运行使用：IDE」的 Gradle 项目也走这条 —— 说明里要讲清楚"为什么明明有 build.gradle 却跑 javac"。
      const via = request.layout.gradle && !request.gradleDelegated
        ? '「构建并运行使用」选了由 IDE 构建，所以不跑 Gradle；'
        : ''
      return {
        kind, label, argFile: javacArgFile(request.sources), command: javacCommand(request, argFile),
        reason: `${via}${request.sources.length} 个 Java 源文件编译到 ${javaOutputPath(request)}`
          + (request.jdkHome.trim() ? `（JDK：${request.jdkHome.trim()}）` : '（JDK 没探测到，用 PATH 上的 javac）'),
      }
    }
    case 'cmake':
      return {
        kind, label, command: `${request.fallback.trim() || 'cmake --build build'}`, argFile: '',
        reason: 'CMake 项目：走项目配置的构建命令。',
      }
    default:
      return {
        kind, label, command: request.fallback.trim(), argFile: '',
        reason: request.fallback.trim() ? '没有识别出构建工具，用项目里配置的命令。' : '没有识别出构建工具，也没有配置构建命令。',
      }
  }
}

/**
 * 「编译选中/当前文件」的计划（上游 `CompileAction.java:56-59` 的 `compile(files)` 那一支，
 * 以及 `getCompilableFiles`（`:178-208`）的过滤：只收**源码内容里**的、可编译类型的文件）。
 * 本仓的可编译类型就是 `.java`（`src/buildHost.ts` 的 `sources` 已经是工作区里的 .java 清单）。
 * 只有 javac 分支能真的只编这几个文件（Gradle/Maven 的任务粒度是整个模块，只编文件不是它们的语义）；
 * 因此对 Gradle/Maven/CMake 项目退回整模块构建，并在 reason 里说清为什么。
 */
export function compileFilesPlan(request: BuildRequest, files: readonly string[]): BuildPlan {
  const wanted = files
    .map(path => path.replace(/\\/g, '/').replace(/^\.?\//, ''))
    .filter(path => path.toLowerCase().endsWith('.java'))
  const kind = projectKindOf(request.layout, request.gradleDelegated)
  if (!wanted.length) {
    return { kind, label: '编译文件', command: '', argFile: '', reason: '选中的文件里没有可编译的 Java 源文件。' }
  }
  if (kind === 'javac') {
    const argFile = javacArgFilePath()
    const subset: BuildRequest = { ...request, sources: wanted }
    return {
      kind, label: `编译文件（${wanted.length} 个）`, argFile: javacArgFile(wanted), command: javacCommand(subset, argFile),
      reason: `编译 ${wanted.length} 个 Java 源文件到 ${javaOutputPath(subset)}（javac 逐文件）`,
    }
  }
  // 外部系统（Gradle/Maven）与 CMake 没有"只编这几个文件"的粒度 ⇒ 退回整模块构建（如实说明）。
  const whole = buildPlan(request)
  return { ...whole, reason: `${projectKindLabel(kind)} 没有“只编选中文件”的粒度，退回整模块构建：${whole.reason}` }
}
