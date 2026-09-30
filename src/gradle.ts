// Gradle 支持（检测 / 同步命令 / 输出解析）—— IDEA Gradle 插件里"自动配置"那一段的对应物。
//
// 逐条对照的源码（`D:\Backup\Downloads\intellij-community-master\intellij-community-master`）：
//   · 常量 `plugins/gradle/settings/src/util/GradleConstants.java`
//       `:11` `SYSTEM_ID = new ProjectSystemId("GRADLE")`
//       `:15-21` 脚本名：`EXTENSION="gradle"`、`DEFAULT_SCRIPT_NAME="build.gradle"`、
//                `KOTLIN_DSL_SCRIPT_NAME="build.gradle.kts"`、`KOTLIN_DSL_SCRIPT_EXTENSION="gradle.kts"`、
//                `SETTINGS_FILE_NAME="settings.gradle"`、`KOTLIN_DSL_SETTINGS_FILE_NAME="settings.gradle.kts"`
//       `:28-38` `BUILD_FILE_EXTENSIONS = {gradle, gradle.kts, gradle.dcl, gradle.xdcl}` 与
//                `KNOWN_GRADLE_SETTINGS_FILES` / `KNOWN_GRADLE_SCRIPTS`
//       `:42-49` `GRADLE_USER_HOME_ENV_KEY="GRADLE_USER_HOME"`、`:43` `"gradle.user.home"`、
//                `:49` `SYSTEM_DIRECTORY_PATH_KEY = GRADLE_USER_HOME_ENV_KEY`
//       `:66-68` `GRADLE_WRAPPER_PROPERTIES_FILE_NAME="gradle-wrapper.properties"`、`GRADLE_DIR_NAME="gradle"`、
//                `GRADLE_CACHE_DIR_NAME=".gradle"`
//   · 项目定位 `plugins/gradle/src/org/jetbrains/plugins/gradle/service/settings/GradleConfigLocator.java:26-50`
//       `adjust()`：**目录 → build.gradle → build.gradle.kts → 任一 *.gradle / *.gradle.kts**；
//       类注释原文："We store not gradle config file but its parent dir path instead. That is implied by
//       gradle design (`GradleConnector.forProjectDirectory(File)`)" ⇒ TaoCode 的对应物就是**工作区根目录**。
//   · 自动重载设置 `platform/external-system-impl/src/com/intellij/openapi/externalSystem/service/settings/ExternalSystemGroupConfigurable.kt`
//       `:22-26` id = **`build.tools`**（per-project，`BackedByPersistentState`，:28-29 的 backing component 是
//                 `ExternalSystemProjectTrackerSettings`）；
//       `:31-55` UI = 一个「自动重新加载项目」复选框 + `全部(ALL) / 选择性(SELECTIVE)` 单选，
//                 单选在复选框关闭时 disable；`onApply` 写 `autoReloadType = enabled ? value : NONE`，
//                 并把 `value` 记进 `PREVIOUS_KEY`（`:58` = `settings.build.tools.auto.reload`）。
//       `platform/external-system-api/.../autoimport/ExternalSystemProjectTrackerSettings.kt:12-28`
//                 三档语义：ALL = 任何构建脚本改动；SELECTIVE = VCS 更新 + **IDE 之外**的构建脚本改动；
//                 NONE = 全关（只有显式 scheduleProjectRefresh 才重载）。
//   · 项目级存储 `plugins/gradle/settings/src/settings/GradleSettings.java`
//       `:30-31` `@State(name = "GradleSettings", storages = @Storage("gradle.xml"))` ⇒ **项目级**；
//       `:118-131` `isOfflineMode` / `setOfflineWork`；`:113-115` `getServiceDirectoryPath()` 转去
//                 `GradleLocalSettings.getGradleUserHome()`（`:54-66`，存在 workspace.xml 这一侧）；
//       `GradleProjectSettings.java:44/118-124` `myDistributionType`（用哪个 Gradle）+ `gradleHome`。
//   · 注册 `plugins/gradle/plugin-resources/intellij.gradle.xml:177-179`：
//       `<projectConfigurable groupId="build.tools" groupWeight="110" id="reference.settingsdialog.project.gradle">`
//
// 本模块是**纯逻辑**（零 import ⇒ `node --test` 可直接 import）：检测规则、同步命令、输出解析。
// 真正的状态与命令投递在 src/gradleHost.ts。

/** `ProjectSystemId("GRADLE")`。 */
export const GRADLE_SYSTEM_ID = 'GRADLE'

/** `GradleConstants.BUILD_FILE_EXTENSIONS`（含 declarative 两种）。 */
export const GRADLE_BUILD_FILE_SUFFIXES = ['.gradle', '.gradle.kts', '.gradle.dcl', '.gradle.xdcl'] as const

/** `GradleConstants.KNOWN_GRADLE_SETTINGS_FILES` —— 只用名字判定（后缀判不出 `settings.gradle`）。 */
export const GRADLE_SETTINGS_FILES = ['settings.gradle', 'settings.gradle.kts', 'settings.gradle.dcl', 'settings.gradle.xdcl'] as const

/**
 * `GradleConstants.DEFAULT_SCRIPT_NAME` / `KOTLIN_DSL_SCRIPT_NAME` / declarative 两种
 * （定位顺序也照源码 `GradleConfigLocator.adjust`）。
 */
export const GRADLE_BUILD_FILES = ['build.gradle', 'build.gradle.kts', 'build.gradle.dcl', 'build.gradle.xdcl'] as const

/**
 * `GradleConstants.KNOWN_GRADLE_FILES`（八个精确名字）。
 *
 * 按后缀扫"其余 Gradle 脚本"时必须排除它们：`settings.gradle.dcl` 同样以 `.gradle.dcl` 命中后缀，
 * 但它是 **settings 文件**（`GradleConstants.java:36-42` 用精确名字区分两类），不该再进 buildFiles。
 */
export const GRADLE_KNOWN_FILES = [
  ...GRADLE_BUILD_FILES,
  ...GRADLE_SETTINGS_FILES,
] as readonly string[]

/** `GRADLE_DIR_NAME` + wrapper 目录 + 属性文件名 / 启动脚本名。 */
export const GRADLE_WRAPPER_PROPERTIES = 'gradle/wrapper/gradle-wrapper.properties'
export const GRADLE_WRAPPER_SCRIPTS = ['gradlew.bat', 'gradlew'] as const
/** `GRADLE_CACHE_DIR_NAME`。 */
export const GRADLE_CACHE_DIR = '.gradle'

export interface GradleDetection {
  /** 有 build.gradle / build.gradle.kts / 任一 *.gradle(.kts) ⇒ 是 Gradle 项目（IDEA 的识别口径）。 */
  isGradle: boolean
  /** 命中的构建脚本（相对路径，按 `GradleConfigLocator.adjust` 的顺序：build.gradle 优先）。 */
  buildFiles: string[]
  settingsFiles: string[]
  hasWrapper: boolean
  /** wrapper 里的 `distributionUrl`（原样），以及从它解出的版本号。 */
  distributionUrl: string
  distributionVersion: string
  /** 判断用的根目录是否存在 `gradlew(.bat)`（没有 wrapper 时退回本机 Gradle）。 */
  wrapperScripts: string[]
}

/** 从 `distributionUrl` 里解出版本号：`.../gradle-8.7-bin.zip` → `8.7`。 */
export function gradleVersionFromUrl(url: string): string {
  const match = /gradle-([0-9][^-]*)-(?:bin|all)\.zip/.exec(url)
  return match ? match[1]! : ''
}

/** 读 `gradle-wrapper.properties` 的 `distributionUrl=...`（properties 的 `k=v`，忽略注释）。 */
export function distributionUrlFrom(properties: string | null): string {
  if (!properties) return ''
  for (const line of properties.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    if (trimmed.slice(0, eq).trim() !== 'distributionUrl') continue
    // `\:` 是 properties 里的转义冒号（Gradle 生成的 wrapper 文件里就是 `https\://services.gradle.org/...`）
    return trimmed.slice(eq + 1).trim().replace(/\\:/g, ':')
  }
  return ''
}

/**
 * 构建脚本所在的**目录**（工作区相对路径；根目录下的脚本算 `''`）。
 *
 * 上游同样以"目录"为单位链接工程：`GradleConfigLocator.java:16-21` 的类注释原文
 * "We store not gradle config file but its parent dir path instead. That is implied by
 * gradle design (`GradleConnector.forProjectDirectory(File)`)"。
 */
export function gradleProjectDirectory(path: string): string {
  const clean = path.replace(/^\.?\//, '')
  const slash = clean.lastIndexOf('/')
  return slash < 0 ? '' : clean.slice(0, slash)
}

/**
 * 「链接 Gradle 项目」（`Gradle.ImportExternalProject`，`GradleBundle.properties:141-142`
 * "Link Gradle Project" / "Link Gradle project described by this file"）该不该出现 ——
 * 逐条照 `ImportProjectFromScriptAction.kt:18-24` 的 `isVisible`：
 *   · 文件名 ∈ `GradleConstants.KNOWN_GRADLE_FILES`（八个精确名字，不是后缀）；
 *   · 且它所在的目录**还没有**链接设置。
 * 动作本身（`linkAndSyncGradleProject(project, file.parent.path)`）在 gradleHost.linkProject。
 */
export function canLinkGradleProject(path: string, linkedDirs: readonly string[]): boolean {
  const name = path.slice(path.lastIndexOf('/') + 1)
  if (!GRADLE_KNOWN_FILES.includes(name)) return false
  return !linkedDirs.includes(gradleProjectDirectory(path))
}

/**
 * 检测（IDEA 打开项目时 `GradleConfigLocator.adjust` + wrapper 探测的等价物）。
 * `files` 是工作区根的条目（相对路径）；`wrapperProperties` 是 wrapper 文件的内容（没有就传 null）。
 */
export function detectGradle(files: readonly string[], wrapperProperties: string | null = null): GradleDetection {
  const names = files.map(path => path.replace(/^\.?\//, ''))
  const buildFiles = GRADLE_BUILD_FILES.filter(name => names.includes(name))
  const others = names
    .filter(name => !name.includes('/') && !GRADLE_KNOWN_FILES.includes(name))
    .filter(name => GRADLE_BUILD_FILE_SUFFIXES.some(suffix => name.endsWith(suffix)))
    .sort()
  const settingsFiles = GRADLE_SETTINGS_FILES.filter(name => names.includes(name))
  const wrapperScripts = GRADLE_WRAPPER_SCRIPTS.filter(name => names.includes(name))
  const hasWrapper = names.includes(GRADLE_WRAPPER_PROPERTIES) || wrapperScripts.length > 0
  const distributionUrl = distributionUrlFrom(wrapperProperties)
  return {
    // 只要出现构建脚本就算 Gradle 项目（settings 文件单独出现也算 —— IDEA 的 KNOWN_GRADLE_SETTINGS_FILES 同样被识别）
    isGradle: buildFiles.length + others.length + settingsFiles.length > 0,
    buildFiles: [...buildFiles, ...others],
    settingsFiles: [...settingsFiles],
    hasWrapper,
    distributionUrl,
    distributionVersion: gradleVersionFromUrl(distributionUrl),
    wrapperScripts: [...wrapperScripts],
  }
}

/**
 * Gradle 运行设置（对应 `GradleConfigurable` 里影响"用哪个 Gradle / 怎么跑"的那几项）。
 * 与 `BuildToolsGradleSettings` 是同一形状 —— 后者是它在项目设置里的落盘形式（含自动重载两项），
 * 这里用别名而不是再写一份，免得两边字段漂移。
 */
export type GradleRunSettings = BuildToolsGradleSettings

/**
 * 「Gradle JVM」的默认值 —— `ExternalSystemJdkUtil.USE_PROJECT_JDK`（`ExternalSystemJdkUtil.java:52`），
 * 也就是 `GradleProjectSettings.java:60` 构造时赋的那个值：**用项目的 JDK**。
 * IDEA 打开 Gradle 项目时 Gradle JVM 就已经是这个值，不是空 —— 这就是「打开默认就有」的一项。
 */
export const GRADLE_USE_PROJECT_JDK = '#USE_PROJECT_JDK'

/**
 * 「构建并运行使用」的默认档 —— `GradleProjectSettings.java:40` `DEFAULT_DELEGATE = true`
 * （`:67` 构造时赋这个值，`:164` 读取时也用 `notNull(…, DEFAULT_DELEGATE)` 兜底）。
 * 也就是：**默认把构建与运行都交给 Gradle**。
 */
export const GRADLE_DELEGATE_DEFAULT = true

/**
 * 「运行」是否也交给 Gradle —— `GradleProjectSettings.java:194-196`：
 * `isDelegatedRunEnabled = isDelegatedBuildEnabled && AdvancedSettings.getBoolean("gradle.run.using.gradle")`。
 * 那个内部开关的默认值见 `plugins/gradle/plugin-resources/intellij.gradle.xml:313`
 * （`<advancedSetting id="gradle.run.using.gradle" default="true" …/>`）。
 * 本仓没有注册表，所以它是常量 —— 但**判断函数照抄源码的两段式**，因为"构建委托了、运行不委托"
 * 这种组合在 IDEA 里是合法的。
 */
export const GRADLE_RUN_USING_GRADLE_DEFAULT = true

export function isDelegatedBuildEnabled(settings: GradleRunSettings): boolean {
  return settings.delegatedBuild ?? GRADLE_DELEGATE_DEFAULT
}

export function isDelegatedRunEnabled(settings: GradleRunSettings, runUsingGradle = GRADLE_RUN_USING_GRADLE_DEFAULT): boolean {
  return isDelegatedBuildEnabled(settings) && runUsingGradle
}

/** 默认：走 wrapper、不指定路径、用默认的 Gradle 用户主目录、Gradle JVM = 项目 JDK、**委托构建**、不离线。 */
export const GRADLE_RUN_DEFAULTS: GradleRunSettings = {
  useGradleFrom: 'wrapper', gradlePath: '', gradleUserHome: '',
  gradleJvm: GRADLE_USE_PROJECT_JDK, delegatedBuild: GRADLE_DELEGATE_DEFAULT, offline: false,
  linkedProjects: [],
}

/**
 * 「Gradle JVM」→ 环境变量（`Runner::Spec.environment`，`native/gradle.cpp` 会转给子进程）。
 *
 * IDEA 把 `GradleProjectSettings.getGradleJvm()` 折成启动 Gradle 时用的 JVM；
 * CLI 版的等价物就是 `JAVA_HOME`（Gradle 用 `JAVA_HOME` 找跑构建的那个 JVM）。
 * 选「项目 JDK」时取项目的 `jdkHome`；项目也没配就什么都不设（Gradle 用自己的默认）。
 */
export function gradleEnvironment(settings: GradleRunSettings, projectJdkHome: string): string[] {
  const chosen = (settings.gradleJvm ?? '').trim()
  const home = chosen === GRADLE_USE_PROJECT_JDK || !chosen ? (projectJdkHome ?? '').trim() : chosen
  return home ? [`JAVA_HOME=${home}`] : []
}

/**
 * 同步要用哪条命令（IDEA 走 Gradle Tooling API；TaoCode 的等价通道是 CLI）。
 *
 * `--console=plain` 是**解析的前提**：默认的 rich console 会带控制字符与进度条，输出不可靠。
 */
export function gradleCommand(detection: GradleDetection, settings: GradleRunSettings, task: string): string {
  const args: string[] = ['--console=plain']
  if (settings.offline) args.push('--offline')
  if (settings.gradleUserHome.trim()) args.push('-g', `"${settings.gradleUserHome.trim()}"`)
  const tail = `${args.join(' ')} ${task}`
  if (settings.useGradleFrom === 'wrapper' && detection.wrapperScripts.includes('gradlew.bat')) return `gradlew.bat ${tail}`
  if (settings.useGradleFrom === 'wrapper' && detection.wrapperScripts.includes('gradlew')) return `./gradlew ${tail}`
  if (settings.useGradleFrom === 'path' && settings.gradlePath.trim()) return `"${settings.gradlePath.trim()}" ${tail}`
  // `local` 与「wrapper 不存在」都退到 PATH / GRADLE_HOME 上的 gradle（IDEA 此时也会报"找不到 wrapper"）
  return `gradle ${tail}`
}

export interface GradleProjectNode {
  /** `:` 开头的路径（根项目是 `:`）。 */
  path: string
  name: string
  depth: number
}

/**
 * 解析 `gradle projects`（`--console=plain`）的输出。
 *
 * 真实输出形如：
 * ```
 * ------------------------------------------------------------
 * Root project 'demo'
 * ------------------------------------------------------------
 *
 * Root project 'demo'
 * \--- Project ':app'
 *      \--- Project ':app:core'
 * ```
 * 树形前缀 `\---` / `+---` / `|` 与缩进一起决定层级 —— 与 Gradle 自己的 `PathRenderer` 一致。
 */
export function parseGradleProjects(output: string): GradleProjectNode[] {
  const projects: GradleProjectNode[] = []
  const seen = new Set<string>()
  for (const line of output.split(/\r?\n/)) {
    if (/^Root project '/.test(line.trim())) {
      const name = /^Root project '([^']+)'/.exec(line.trim())
      if (name && !seen.has(':')) { seen.add(':'); projects.push({ path: ':', name: name[1]!, depth: 0 }) }
      continue
    }
    const match = /^([\s|+\\-]*)(?:\\---|\+---)?\s*Project '([^']+)'/.exec(line)
    if (!match) continue
    const prefix = match[1] ?? ''
    const path = match[2]!
    if (seen.has(path)) continue
    seen.add(path)
    // 每个 `|` 或 4 个空格算一层（Gradle 的树形前缀就是这两样）
    const depth = 1 + (prefix.match(/\||    /g)?.length ?? 0)
    projects.push({ path, name: path.startsWith(':') ? path.slice(1) : path, depth })
  }
  return projects
}

export interface GradleTaskNode {
  /** 任务名（子项目任务形如 `:app:build`）。 */
  name: string
  description: string
  /** 分组标题（`Build tasks` / `Application tasks` / `Other tasks`…）。 */
  group: string
}

/**
 * 解析 `gradle tasks --all` 的输出。
 *
 * 分组是「标题行 + 下一行整行 `-----`」，任务行是 `name - description`；
 * 末尾的 `To see all tasks and more detail…` 之类的提示没有 `-` 分隔，会被天然忽略。
 */
export function parseGradleTasks(output: string): GradleTaskNode[] {
  const tasks: GradleTaskNode[] = []
  const lines = output.split(/\r?\n/)
  let group = 'Other tasks'
  for (let index = 0; index < lines.length; ++index) {
    const line = lines[index]!
    const next = lines[index + 1] ?? ''
    // 分组标题：下一行是纯 `-----`（长度不限，至少 3 个）
    if (line.trim() && /^-{3,}\s*$/.test(next.trim()) && /^[A-Z][A-Za-z ]*$/.test(line.trim())) {
      group = line.trim()
      ++index
      continue
    }
    const match = /^([A-Za-z][\w:.-]*)\s+-\s+(.+)$/.exec(line.trim())
    if (!match) continue
    const name = match[1]!
    // `help -` 这类空描述、以及 `gradle tasks` 自己输出的表格线都不算任务
    if (GRADLE_PSEUDO_TASKS.has(name)) continue
    tasks.push({ name, description: match[2]!.trim(), group })
  }
  return tasks
}

/** Gradle 自己列出来的"非真正任务"（帮助/规则表里的保留名）。 */
const GRADLE_PSEUDO_TASKS = new Set(['help', 'tasks', 'projects', 'properties', 'dependencyInsight', 'dependencies', 'buildEnvironment'])

/**
 * `* What went wrong:` 那一段的正文（逐行、去掉缩进），到下一个 `*` 小节或 `BUILD …` 为止。
 * 段里第一行是"表面原因"，后面 `>` 开头的是**因果链**（Gradle 按层级缩进打印）。
 */
function whatWentWrongLines(output: string): string[] {
  const lines = output.split(/\r?\n/)
  const start = lines.findIndex(line => line.trim() === '* What went wrong:')
  if (start < 0) return []
  const body: string[] = []
  for (let index = start + 1; index < lines.length; index++) {
    const line = lines[index]!
    if (/^\*\s/.test(line) || /^BUILD\s/.test(line)) break
    if (line.trim()) body.push(line.trim())
  }
  return body
}

/**
 * 从同步输出里判断是否成功（Gradle 失败时会有 `FAILURE:` 与 `BUILD FAILED`）。
 *
 * 只取 `FAILURE:` 那一行等于没取：Gradle 永远写 `FAILURE: Build failed with an exception.`，
 * **真正的原因在后面的 `* What went wrong:` 段**。2026-09-29 的实测就吃在这个上面 ——
 * AE2 VM 那次同步其实跑完了（daemon 日志里 `BUILD FAILED in 1m 15s`，`FAILURE: … * What went
 * wrong: … > Failed to load the manifest from Github`），面板却像卡死一样一直"在解析"，
 * 因为留给用户的只有一句没信息量的话。这里给"表面原因 — 根因"（因果链的最里层）。
 */
export function gradleFailure(output: string): string {
  const body = whatWentWrongLines(output)
  if (body.length) {
    const headline = body.find(line => !line.startsWith('>')) ?? ''
    const causes = body.filter(line => line.startsWith('>'))
    const root = causes.length ? causes[causes.length - 1]!.replace(/^>\s*/, '') : ''
    const detail = [headline, root].filter(Boolean).join(' — ')
    if (detail) return detail
  }
  const failure = /^FAILURE: (.+)$/m.exec(output)
  if (failure) return failure[1]!.trim()
  if (/BUILD FAILED/i.test(output)) return 'Gradle 同步失败（BUILD FAILED）。'
  return ''
}

/**
 * 输出尾部 `lines` 行（同步进行中用："到底跑到哪一步了"）。
 * 空行丢掉，ANSI 转义序列去掉（`--console=plain` 已经基本没有，但 Gradle 的进度行仍可能带 `\r`）。
 */
export function gradleOutputTail(output: string, lines = 12): string[] {
  const clean = output
    .replace(/\u001B\[[0-9;]*[A-Za-z]/g, '')
    .split(/[\r\n]+/)
    .map(line => line.trimEnd())
    .filter(line => line.trim() !== '')
  return clean.slice(-Math.max(1, lines))
}

/** 同步结果（宿主保存，UI 读）。 */
export interface GradleSyncResult {
  projects: GradleProjectNode[]
  tasks: GradleTaskNode[]
  /** 同步用的命令（给用户看得见"到底跑了什么"）。 */
  command: string
  error: string
  /** 毫秒时间戳（0 = 还没同步过）。 */
  at: number
}

export const EMPTY_GRADLE_SYNC: GradleSyncResult = { projects: [], tasks: [], command: '', error: '', at: 0 }

/** 任务按分组归拢（Gradle 工具窗口的任务树就是"分组 → 任务"两层的）。 */
// ---------------------------------------------------------------------------
// 依赖树（IDEA 外部系统视图里的 `Dependencies` 节点）
// ---------------------------------------------------------------------------
// 对照源码：
//   · 节点名是**字面量** `"Dependencies"`（不是本地化文案）——
//     `platform/external-system-impl/.../view/ExternalSystemViewDefaultContributor.java:241-243`（`MyDependenciesNode.getName()`）。
//   · 它下面一层是**作用域**节点（`DependencyScopeExternalSystemNode:245-253`：`getName()` 返回
//     `DependenciesGraphNode.getScope()`），节点图标是库文件夹（`:256-268` 把 description 设成 tooltip）。
//   · 再下面才是依赖（`DependencyExternalSystemNode:311-330`：显示名取 `DependencyNode.getDisplayName()`，
//     文本节点与引用节点的区别是**引用节点带 `" (*)"` 后缀**（`:330-336`），图标在库/工程之间二选一）。
//   · 依赖节点自己的右键菜单 id 是 `ExternalSystemView.DependencyMenu`（`:341-343`），
//     而这个组在 `ExternalSystemActions.xml:114` 里**是空的** ⇒ 依赖节点默认没有任何内置动作。
//
// TaoCode 拿不到 Tooling API 的模型，等价物是 `gradle dependencies --console=plain` 的输出
// —— Gradle 自己就会打印 `(*)`（子树已在上文列出）与 `-> <版本>`（版本冲突解析结果），
// 所以"引用节点"这层语义不用自己造。IDEA 的依赖树是**展开时才加载**的，这里也是（见 gradleHost.loadDependencies）。

/** 「依赖」区块的名字 —— 源码里就是英文常量（`ExternalSystemViewDefaultContributor.java:241-243`）。 */
export const GRADLE_DEPENDENCIES_NODE_NAME = 'Dependencies'

/** 加载依赖用的 Gradle 任务（`gradle dependencies`）。 */
export const GRADLE_DEPENDENCIES_TASK = 'dependencies'

export interface GradleDependency {
  /** 坐标（`group:name:version`），已去掉 Gradle 的标记后缀。 */
  name: string
  /** 树深度，0 = 作用域的直接依赖（对应 IDEA 的节点层级）。 */
  depth: number
  /** Gradle 打的 `(*)`：这棵子树已经在上文列过，不再重复展开。 */
  duplicate: boolean
  /** Gradle 打的 `(c)`：这一条是**约束**而不是实际依赖。 */
  constraint: boolean
  /** Gradle 打的 `(n)`：无法解析。 */
  unresolved: boolean
  /** `-> x.y` 的解析结果（版本冲突时 Gradle 会这么写）；没有就是空串。 */
  resolved: string
}

export interface GradleDependencyScope {
  /** 配置名（`compileClasspath` / `runtimeClasspath` / …）= IDEA 的 `DependenciesGraphNode.getScope()`。 */
  configuration: string
  /** `-` 后面的说明（IDE 拿它当 tooltip，见 `:256-268`）。 */
  description: string
  /** 该作用域整行带 `(n)` ⇒ 无法解析。 */
  unresolved: boolean
  /** Gradle 直接写了 `No dependencies`（与"解析出来 0 条"是两件事）。 */
  empty: boolean
  /**
   * 所属工程 —— **Gradle 自己的写法**：根工程那节是 `Root project 'demo'`（给的是**名字**），
   * 子工程是 `Project ':app'`（给的是**路径**）。两者原样保留，UI 直接显示。
   */
  project: string
  dependencies: GradleDependency[]
}

/** `+--- ` / `\--- ` 每层 5 个字符宽（4 个占位 + 1 个空格），层级 = 前缀长度/5 - 1。 */
const DEPENDENCY_LINE = /^([\s|]*(?:\\---|\+---)\s)(.*)$/

/**
 * 解析 `gradle dependencies --console=plain` 的输出。
 *
 * 真实输出形如（每一节的表头是 `Root project 'x'` 或 `Project ':app'`）：
 * ```
 * ------------------------------------------------------------
 * Root project 'demo'
 * ------------------------------------------------------------
 *
 * compileClasspath - Compile classpath for source set 'main'.
 * +--- org.jetbrains.kotlin:kotlin-stdlib:1.9.0
 * |    \--- org.jetbrains:annotations:13.0
 * \--- org.example:lib:1.0 -> 1.2
 *      \--- org.example:core:0.5 (*)
 *
 * runtimeClasspath (n)
 * No dependencies
 * ```
 */
export function parseGradleDependencies(output: string): GradleDependencyScope[] {
  const scopes: GradleDependencyScope[] = []
  const lines = output.split(/\r?\n/)
  let project = ''
  let current: GradleDependencyScope | null = null
  for (let index = 0; index < lines.length; ++index) {
    const line = lines[index]!
    const trimmed = line.trim()
    if (!trimmed || /^[-=]{3,}$/.test(trimmed) || /^>\s*Task /.test(trimmed)) continue
    // Gradle 的表头是 `Root project 'x'`（小写 p）与 `Project ':app'` —— 两种都要认。
    const section = /^(?:Root )?[Pp]roject '([^']+)'$/.exec(trimmed)
    if (section) { project = section[1]!; current = null; continue }
    const dependency = DEPENDENCY_LINE.exec(line)
    if (dependency && current) {
      const text = dependency[2]!.trimEnd()
      const flags = /\s+\((n|c|\*)\)$/.exec(text)
      const flag = flags ? flags[1]! : ''
      let name = flags ? text.slice(0, flags.index) : text
      let resolved = ''
      const arrow = / -> (.+)$/.exec(name)
      if (arrow) { resolved = arrow[1]!.trim(); name = name.slice(0, arrow.index) }
      current.dependencies.push({
        name: name.trim(),
        depth: Math.max(0, Math.round(dependency[1]!.length / 5) - 1),
        duplicate: flag === '*',
        constraint: flag === 'c',
        unresolved: flag === 'n',
        resolved,
      })
      continue
    }
    // 「No dependencies」属于**上一个**作用域
    if (/^No dependencies$/i.test(trimmed) && current) { current.empty = true; continue }
    // 作用域行：`<配置名>` / `<配置名> - <说明>` / `<配置名> (n)`（末者是"无法解析"，Gradle 不给说明）。
    // 只有下一行是 `No dependencies` 或树行时才算 —— 否则 `> Task …`、`BUILD SUCCESSFUL` 这类裸行也会被吞进来。
    const next = (lines[index + 1] ?? '').trim()
    const scope = /^(\S+)(?:\s+-\s+(.*?))?(?:\s+\((n)\))?$/.exec(trimmed)
    if (!scope) continue
    if (!/^No dependencies$/i.test(next) && !DEPENDENCY_LINE.test(lines[index + 1] ?? '')) continue
    current = {
      configuration: scope[1]!,
      description: (scope[2] ?? '').trim(),
      unresolved: scope[3] === 'n',
      empty: false,
      project,
      dependencies: [],
    }
    scopes.push(current)
  }
  return scopes
}

/** 依赖按所属工程归拢（多工程时 Gradle 分节打印，UI 按工程分组渲染）。 */
export function dependenciesByProject(scopes: readonly GradleDependencyScope[]): { project: string; scopes: GradleDependencyScope[] }[] {
  const groups = new Map<string, GradleDependencyScope[]>()
  for (const scope of scopes) {
    const list = groups.get(scope.project)
    if (list) list.push(scope)
    else groups.set(scope.project, [scope])
  }
  return [...groups.entries()].map(([project, list]) => ({ project, scopes: list }))
}

export function tasksByGroup(tasks: readonly GradleTaskNode[]): { group: string; tasks: GradleTaskNode[] }[] {
  const groups = new Map<string, GradleTaskNode[]>()
  for (const task of tasks) {
    const list = groups.get(task.group)
    if (list) list.push(task)
    else groups.set(task.group, [task])
  }
  return [...groups.entries()].map(([group, list]) => ({ group, tasks: list }))
}

/** 跑一个 Gradle 任务时的命令行（任务树双击 = IDEA 的 `GradleRunConfiguration`，这里走 run 通道）。 */
export function gradleTaskCommand(detection: GradleDetection, settings: GradleRunSettings, task: string): string {
  return gradleCommand(detection, settings, task)
}

// ---------------------------------------------------------------------------
// 外部系统的自动重载（`ExternalSystemGroupConfigurable`，id = `build.tools`）
// ---------------------------------------------------------------------------

/**
 * `ExternalSystemProjectTrackerSettings.AutoReloadType`（ExternalSystemProjectTrackerSettings.kt:12-28）。
 * 枚举名大写 —— 存盘形状与 IDEA 的枚举名一致（native 侧 `validate_build_tools` 校验同一组字符串）。
 */
export type AutoReloadType = 'ALL' | 'SELECTIVE' | 'NONE'

/** 新项目的默认值：IDEA 的默认是 ALL（任何构建脚本改动都重载）。 */
// AutoImportProjectTrackerSettings.kt:16-26：无 DefaultAutoReloadTypeProvider 实现 ⇒ 默认 SELECTIVE。
export const AUTO_RELOAD_DEFAULT: AutoReloadType = 'SELECTIVE'

/** `ExternalSystemGroupConfigurable.PREVIOUS_KEY`（:58）：选关闭时记住上一次的选择。 */
export const AUTO_RELOAD_PREVIOUS_KEY = 'settings.build.tools.auto.reload'

export function autoReloadLabel(type: AutoReloadType): string {
  switch (type) {
    case 'NONE': return '关闭自动重新加载'
    case 'ALL': return '任何更改'
    case 'SELECTIVE': return '外部更改'
  }
}

/** 「自动重新加载项目」这一组的标题（`settings.build.tools.auto.reload.radio.button.group.title`）。 */
export const AUTO_RELOAD_GROUP_TITLE = '自动重新加载项目'

/** 「全部」单选的文案（`...radio.button.all.label`）。 */
export const AUTO_RELOAD_ALL_LABEL = '任何更改'

/** 「选择性」单选的文案（`...radio.button.selective.label`）。 */
export const AUTO_RELOAD_SELECTIVE_LABEL = '外部更改'

/** 「外部更改」的说明文案（`...radio.button.selective.comment`）。 */
export const AUTO_RELOAD_SELECTIVE_COMMENT = '在 VCS 更新之后、以及构建脚本在 IDE 之外被改动时重新加载；IDE 内的编辑不触发。'

/** 一次改动带来的三个事实（`shouldAutoReload` 的输入）。 */
export interface ReloadTrigger {
  /** 改的是构建脚本（`BUILD_FILE_EXTENSIONS` / `KNOWN_GRADLE_FILES` 命中）。 */
  changedBuildFile: boolean
  /** 改动不是在本 IDE 里做的（外部编辑器 / 命令行）。 */
  changedOutsideIde: boolean
  /** 来自一次 VCS 更新（拉取 / 切换分支）。 */
  afterVcsUpdate: boolean
}

/**
 * 该不该重新加载项目（`AutoReloadType` 的三档真实语义，见 `ExternalSystemProjectTrackerSettings.kt:12-28`）：
 *  · `ALL`       —— 任何对构建脚本的改动都重载；
 *  · `SELECTIVE` —— VCS 更新，或**IDE 之外**改动了构建脚本；
 *  · `NONE`      —— 全部关闭（只有显式请求才重载）。
 */
export function shouldAutoReload(type: AutoReloadType, trigger: Partial<ReloadTrigger> = {}): boolean {
  const { changedBuildFile = false, changedOutsideIde = false, afterVcsUpdate = false } = trigger
  if (type === 'NONE') return false
  if (type === 'ALL') return changedBuildFile
  return (changedBuildFile && changedOutsideIde) || afterVcsUpdate
}

/** 一个路径是不是 Gradle 的构建/设置脚本（沿用上面的两张表，两侧共用同一口径）。 */
/**
 * `ExternalSystem.OpenConfig` 要打开的"外部系统配置文件"。
 *
 * 源码链路：`OpenExternalConfigAction.perform:49-59` → `ExternalSystemNodeAction.getExternalConfig:76-92`
 * —— 拿链接工程的**目录**，依次问各 `ExternalSystemConfigLocator`；Gradle 的实现是
 * `GradleConfigLocator.adjust()`（`GradleConfigLocator.java:26-50`），顺序就是
 * `build.gradle` → `build.gradle.kts` → 任一 `*.gradle` / `*.gradle.kts`。
 * 本仓的 `detectGradle` 用的正是这条顺序，所以这里取检测结果里的第一个。
 */
export function gradleConfigFile(detection: GradleDetection | null): string {
  if (!detection) return ''
  return detection.buildFiles[0] ?? detection.settingsFiles[0] ?? ''
}

export function isGradleBuildScript(path: string): boolean {
  const name = path.replace(/^\.?\//, '')
  if (name.includes('/')) {
    const tail = name.slice(name.lastIndexOf('/') + 1)
    return GRADLE_BUILD_FILE_SUFFIXES.some(suffix => tail.endsWith(suffix))
  }
  return GRADLE_KNOWN_FILES.includes(name) || GRADLE_BUILD_FILE_SUFFIXES.some(suffix => name.endsWith(suffix))
}

/** 「构建、执行、部署 › 构建工具」这一组下 Gradle 页的键（沿用 IDEA 的 configurable id）。 */
export const GRADLE_CONFIGURABLE_ID = 'reference.settingsdialog.project.gradle'
export const BUILD_TOOLS_GROUP_ID = 'build.tools'

// ---------------------------------------------------------------------------
// Gradle 项目设置（项目级，对应 `GradleSettings` + `GradleProjectSettings`）
// ---------------------------------------------------------------------------

/**
 * 「用 Gradle 从」的三档：`GradleProjectSettings.DistributionType` 的
 * `DEFAULT_WRAPPED`/`WRAPPED` → `wrapper`，`LOCAL_DISTRIBUTION` → `path`，
 * 没有 wrapper 时退回本机的 `gradle`（`local`）。
 */
export type GradleDistribution = 'wrapper' | 'local' | 'path'

export interface BuildToolsGradleSettings {
  /** `java.import.gradle.enabled`：关掉 = 语言服务不跑 Gradle 导入，用磁盘上的产物当类路径/源根。 */
  enabled?: boolean
  useGradleFrom: GradleDistribution
  /** `useGradleFrom === 'path'` 时的 gradle 可执行文件（`GradleProjectSettings.gradleHome`）。 */
  gradlePath: string
  /** 「Gradle 用户主目录」：非空时加 `-g <path>`（`GradleSettings.getServiceDirectoryPath()`，:113-115）。 */
  gradleUserHome: string
  /**
   * 「Gradle JVM」（`GradleProjectSettings.getGradleJvm()`）：`#USE_PROJECT_JDK` 或一个 JDK 主目录。
   * 折成跑 Gradle 时的 `JAVA_HOME`，见 `gradleEnvironment`。
   */
  gradleJvm: string
  /**
   * 「构建并运行使用」：true = 交给 Gradle（`GradleProjectSettings.getDelegatedBuild()`，
   * 存盘键就是 `delegatedBuild`，见 `:172-178` 的 `@OptionTag("delegatedBuild")`）；
   * false = 由 IDE 自己编译（IDEA 走 JPS，本仓走 javac，见 `src/projectBuild.ts`）。
   */
  delegatedBuild: boolean
  /** 「离线模式」：`GradleSettings.MyState.isOfflineMode`（:118-131），加 `--offline`。 */
  offline: boolean
  /**
   * 已链接的 Gradle 工程目录（工作区相对路径，`''` = 工作区根）。
   * 对应 `GradleSettings` 的 `linkedProjectsSettings`（存盘在 `.idea/gradle.xml`，
   * `GradleSettings.java:30-31`）—— IDEA 的 Gradle 工具窗口是否可用就取决于这个列表
   * （`AbstractExternalSystemToolWindowFactory.java:32-34` `shouldBeAvailable`）。
   */
  linkedProjects: string[]
}

/** 构建工具组的项目级状态（native `project_defaults()` 里的 `buildTools` 同一形状）。 */
export interface BuildToolsSettings {
  autoReloadType: AutoReloadType
  /** 选「关闭」时记住的那一档（`PREVIOUS_KEY`）。 */
  previousAutoReloadType: AutoReloadType
  gradle: BuildToolsGradleSettings
}

export const DEFAULT_BUILD_TOOLS: BuildToolsSettings = {
  autoReloadType: AUTO_RELOAD_DEFAULT,
  previousAutoReloadType: AUTO_RELOAD_DEFAULT,
  gradle: { ...GRADLE_RUN_DEFAULTS },
}
