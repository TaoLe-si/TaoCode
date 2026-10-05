// 语言运行时类型表（上游 `LanguageRuntimeType` 扩展点 + 本仓能兑现的四个具体类型）。
//
// 上游出处：
//   platform/execution/src/com/intellij/execution/target/LanguageRuntimeType.kt:32-73
//       每种语言贡献：displayName / configurableDescription / launchDescription /
//       isApplicableTo（该运行配置能不能用这个运行时）/ createConfigurable（**每种类型一套设置 UI**）
//       / findLanguageRuntime / createIntrospector（目标上探测）/ volumeDescriptors。
//       类注释 :14-31 明说运行时数据「要么由平台在目标上探测，要么用户在 UI 里手填」——
//       本仓不做探测（宿主没有「在目标上执行脚本」这层），只走手填这条路。
//   每个类型一份持久化状态（`LanguageRuntimeConfiguration`，LanguageRuntimeConfiguration.kt:22-27）：
//       Java  → homePath + javaVersionString（platform/execution/src/com/intellij/execution/target/java/JavaLanguageRuntimeConfiguration.kt:13-14）
//       Gradle/Maven → homePath（Introspector 只在 homePath 为空时才介入，MavenRuntimeType.kt:44-47）
//
// 本仓实现的四个类型（id 与 displayName 逐字照抄上游，不另造）：
//   Java    JavaLanguageRuntimeType.kt:27-31；TYPE_ID = "JavaLanguageRuntime"（同文件 :124）
//   Python  PythonLanguageRuntimeType.kt:21-22，displayName "Python"（字段是解释器路径，
//           PythonLanguageRuntimeType.kt:33-34 的 introspector 也印证了这一点）
//   Gradle  GradleRuntimeType.kt:15-18；TYPE_ID = "GradleRuntime"（同文件 :46）
//   Maven   MavenRuntimeType.kt:17-21；TYPE_ID = "MavenRuntime"（同文件 :55）
//
// 「可执行文件怎么拼」是本仓自己的等价物（上游交给目标端解析，见 src/targetPlatform.ts 的说明）：
//   Java    → <home>/bin/java.exe        | <home>/bin/java
//   Gradle  → <home>/bin/gradle.bat      | <home>/bin/gradle
//   Maven   → <home>/bin/mvn.cmd         | <home>/bin/mvn
//   Python  → 用户填的就是解释器**路径**本身（不是 home），不拼 bin。
// 不做：`VolumeDescriptor` 那一族（JavaLanguageRuntimeType.kt:116 的 classpath/agents 卷、
//   GradleRuntimeType.kt:49 与 MavenRuntimeType.kt:59 的 projectFolder 卷）—— 卷是「把本地目录
//   传到目标时的落点与挂载选项，本仓没有文件传输通道（远程目标缺宿主能力，见 exec/wsl 判 `[-]`），
//   建了就是没有消费链路的假字段。
//
// 纯数据 + 纯函数，判据 tests/target-environments.test.mjs。

import { joinTargetPath, WINDOWS_PLATFORM, type TargetPlatform } from './targetPlatform.ts'

export interface LanguageRuntimeTypeDef {
  /** 上游 TYPE_ID，逐字照抄。 */
  id: string
  /** 上游 displayName（`JavaLanguageRuntimeType.kt:31` 等处是硬编码英文）。 */
  displayName: string
  /** 设置页里这一组字段的标题（上游 configurableDescription 的中文文案）。 */
  configureLabel: string
  /** 目标行的说明文案（上游 launchDescription 的中文文案）。 */
  launchLabel: string
  /** 主路径字段的中文标签。 */
  homeLabel: string
  /** 主路径字段的提示（上游的 `.comment(...)`，没有就空串）。 */
  homeHint: string
  /** 版本字段的中文标签；为 null 表示这一档没有版本字段（上游只有 Java 有）。 */
  versionLabel: string | null
  /** 主路径是不是「可执行文件本身」而不是它的 home（Python 的解释器路径）。 */
  homeIsExecutable: boolean
  /** 按平台拼出的可执行文件（相对主路径的段）；`homeIsExecutable` 时不拼。 */
  executableSegments: { windows: string[]; unix: string[] }
  /** 归这个运行时管的**裸程序名**（小写，不含路径与扩展名）——「Run on target」换不换程序就比这个。
   *  上游的等价判据是「配置类型自己 findLanguageRuntime 去查自己的运行时数据」
   *  （JavaLanguageRuntimeType.kt:54-56），查得到就用自己的运行时；本仓改成比对程序名。 */
  programNames: readonly string[]
}

export const JAVA_RUNTIME_ID = 'JavaLanguageRuntime'
export const PYTHON_RUNTIME_ID = 'PythonLanguageRuntime'
export const GRADLE_RUNTIME_ID = 'GradleRuntime'
export const MAVEN_RUNTIME_ID = 'MavenRuntime'

/** 上游 `JavaLanguageRuntimeType.kt:65-66` 探测时执行的就是 `java`（`java -XshowSettings:properties -version`）。 */
export const LANGUAGE_RUNTIME_TYPES: readonly LanguageRuntimeTypeDef[] = [
  {
    id: JAVA_RUNTIME_ID,
    displayName: 'Java',
    configureLabel: 'Java 配置',
    launchLabel: '运行 Java 应用程序',
    homeLabel: 'JDK 主路径:',
    homeHint: '目标上 JDK 的路径',
    versionLabel: 'JDK 版本:',
    homeIsExecutable: false,
    executableSegments: { windows: ['bin', 'java.exe'], unix: ['bin', 'java'] },
    programNames: ['java', 'javaw'],
  },
  {
    id: PYTHON_RUNTIME_ID,
    displayName: 'Python',
    configureLabel: 'Python 配置',
    launchLabel: '运行 Python 应用程序',
    homeLabel: 'Python 解释器:',
    homeHint: '',
    versionLabel: null,
    homeIsExecutable: true,
    executableSegments: { windows: [], unix: [] },
    programNames: ['python', 'python3', 'py'],
  },
  {
    id: GRADLE_RUNTIME_ID,
    displayName: 'Gradle',
    configureLabel: 'Gradle 配置',
    launchLabel: '运行 Gradle 任务',
    homeLabel: 'Gradle 主路径:',
    homeHint: '',
    versionLabel: null,
    homeIsExecutable: false,
    executableSegments: { windows: ['bin', 'gradle.bat'], unix: ['bin', 'gradle'] },
    programNames: ['gradle'],
  },
  {
    id: MAVEN_RUNTIME_ID,
    displayName: 'Maven',
    configureLabel: 'Maven 配置',
    launchLabel: '运行 Maven 目标',
    homeLabel: 'Maven 主路径:',
    homeHint: '',
    versionLabel: null,
    homeIsExecutable: false,
    executableSegments: { windows: ['bin', 'mvn.cmd'], unix: ['bin', 'mvn'] },
    programNames: ['mvn'],
  },
]

export function languageRuntimeType(typeId: string): LanguageRuntimeTypeDef | undefined {
  return LANGUAGE_RUNTIME_TYPES.find(entry => entry.id === typeId)
}

/** 一个目标环境上挂的运行时条目（`TargetEnvironmentConfiguration.runtimes` 的一格）。 */
export interface LanguageRuntimeEntry {
  typeId: string
  /** 上游各类型的主路径字段（Java 的 homePath / Python 的解释器路径…）。 */
  homePath: string
  /** 上游 Java 有 javaVersionString，其余类型没有这个字段 ⇒ 省略。 */
  version?: string
}

export function emptyRuntimeEntry(typeId: string): LanguageRuntimeEntry {
  return { typeId, homePath: '' }
}

/**
 * 运行时的可执行文件（`homeIsExecutable` 的直接用主路径，否则按平台拼 bin 段）。
 * 主路径为空 ⇒ 空串：调用方据此判定「这个运行时没配好」，不要拼出 `<home>/bin/java` 这种
 * 半截路径 —— 上游 `JavaLanguageRuntimeConfiguration.validateConfiguration()`（:36-42）在
 * homePath 为空时直接抛异常，正是这个意思。
 */
export function runtimeExecutable(entry: LanguageRuntimeEntry, platform: TargetPlatform): string {
  const type = languageRuntimeType(entry.typeId)
  const home = entry.homePath.trim()
  if (!type || !home) return ''
  if (type.homeIsExecutable) return home
  const segments = platform.id === 'windows' ? type.executableSegments.windows : type.executableSegments.unix
  return joinTargetPath(platform, home, ...segments)
}

/** 路径的裸文件名（小写、去掉 `.exe`/`.cmd`/`.bat`）——`programNames` 比的就是它。 */
export function programNameOf(path: string): string {
  const file = path.trim().split(/[\\/]/).pop() ?? ''
  return file.toLowerCase().replace(/\.(exe|cmd|bat)$/, '')
}

/** 命令行的头一个词（`java -cp out Main` → `java`；带引号的整体路径也认）。 */
export function commandProgram(command: string): string {
  const head = command.trim().split(/\s+/)[0] ?? ''
  return head.replace(/^"(.*)"$/, '$1')
}

/** 这个运行时管不管这个程序（`program` 优先；否则看 `command` 的头一个词）。 */
export function runtimeOwnsProgram(type: LanguageRuntimeTypeDef, program?: string, command?: string): boolean {
  const names = type.programNames
  if ((program ?? '').trim()) return names.includes(programNameOf(program!))
  const head = commandProgram(command ?? '')
  return head ? names.includes(programNameOf(head)) : false
}


/** 这一档在树/列表右侧的灰字摘要（上游 `TargetEnvironmentNode.configuredLanguages`，MasterDetails:330-334）。 */
export function runtimeSummary(entries: readonly LanguageRuntimeEntry[]): string {
  return [...new Set(entries.map(entry => languageRuntimeType(entry.typeId)?.displayName ?? entry.typeId))].sort()
    .join(', ')
}

/** 目标平台取自主路径时该用哪一档（`TargetPlatform` 显式传平台的等价物，见 src/targetPlatform.ts）。 */
export function platformForRuntimes(entries: readonly LanguageRuntimeEntry[], fallback: TargetPlatform): TargetPlatform {
  const home = entries.find(entry => entry.homePath.trim())?.homePath ?? ''
  return home ? (home.includes('\\') ? WINDOWS_PLATFORM : fallback) : fallback
}
