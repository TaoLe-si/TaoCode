// 「构建项目 / 重新构建」的**输入收集**与**自动配置** —— `src/projectBuild.ts` 只算命令，
// 这里负责把 IDEA 在打开项目时就准备好的那几样东西凑齐：
//   · 项目类型（Gradle / Maven / 纯 Java / CMake）；
//   · Java 源文件清单与类路径（`referencedLibraries` 的 glob）；
//   · **JDK**：`JavaProjectSettings.jdkHome` 为空时用机器上探测到的那个（`app.jdks`），
//     并把探测结果写回项目设置 —— 这正是「IDEA 打开默认都是有的」那件事
//     （IDEA 的 `ProjectJdkTable` 在项目打开时就有 SDK 列表，不需要用户先填）。
import type { Ref } from 'vue'
import { request, type Entry, type JavaProjectSettings, type ProjectSettings, type Workspace } from './bridge.ts'
import type { GradleDetection } from './gradle.ts'
import { DEFAULT_BUILD_TOOLS, isDelegatedBuildEnabled } from './gradle.ts'
import { defaultJavaOutputPath, javaOutputPath, type BuildRequest, type ProjectLayout } from './projectBuild.ts'

export interface JdkInfo { home: string; version: string; name: string }
export interface JdkList { jdks: JdkInfo[] }

/**
 * 机器上的 JDK 列表（`app.jdks` → `native/jdk.cpp` 的 `find_all()`）。
 * 一次会话只探一次：探测要扫几个安装目录，构建时每次都扫没必要。
 */
let jdkCache: JdkInfo[] | null = null
export async function availableJdks(): Promise<JdkInfo[]> {
  if (jdkCache) return jdkCache
  try {
    jdkCache = (await request<JdkList>('app.jdks')).jdks ?? []
  } catch {
    // 浏览器预览 / 老宿主没有这条通道：当作"没探测到"，不要让构建因此报错。
    jdkCache = []
  }
  return jdkCache
}
/** 测试与"重新探测"用（升级 JDK 后不想重启进程时）。 */
export function resetJdkCache(): void { jdkCache = null }

/** 构建时要跳过的目录（IDEA 的 excluded 之外，这些是构建产物或依赖缓存）。 */
const IGNORED_SEGMENTS = ['.git', '.gradle', '.idea', 'node_modules', 'build', 'out', 'dist', 'target', 'bin', 'obj']

function isIgnored(path: string): boolean {
  return path.split('/').some(segment => IGNORED_SEGMENTS.includes(segment))
}

/**
 * `lib/**\/*.jar` 这类 glob → 正则。
 * IDEA 的 `referencedLibraries` 走 `PathMatcher` 语义：`**` 跨目录、`*` 不跨、`?` 一个字符。
 */
export function matchLibraryGlob(pattern: string, path: string): boolean {
  const normalized = pattern.replace(/\\/g, '/').replace(/^\.?\//, '')
  let source = ''
  for (let index = 0; index < normalized.length; ++index) {
    const character = normalized[index]!
    if (character === '*') {
      if (normalized[index + 1] === '*') {
        // `**/` 连斜杠一起吞（这样 `lib/**/*.jar` 也能匹配 `lib/a.jar`）
        if (normalized[index + 2] === '/') { source += '(?:.*/)?'; index += 2 }
        else { source += '.*'; index += 1 }
        continue
      }
      source += '[^/]*'
      continue
    }
    if (character === '?') { source += '[^/]'; continue }
    source += /[.*+?^${}()|[\]\\]/.test(character) ? `\\${character}` : character
  }
  return new RegExp(`^${source}$`, 'i').test(path)
}

export interface BuildInputs {
  layout: ProjectLayout
  /** `.java` 的相对路径（已排除构建产物目录，按路径排序）。 */
  sources: string[]
  /** 命中的 jar（相对路径）。 */
  classpath: string[]
  /** 探测到的 JDK（用户没配时用它）。 */
  detectedJdk: JdkInfo | null
}

/** 收集一次构建需要的全部输入（不跑任何命令）。 */
export async function collectBuildInputs(deps: {
  workspace: Ref<Workspace | null>
  projectSettings: Ref<ProjectSettings>
  gradleDetection: { readonly value: GradleDetection | null }
}): Promise<BuildInputs> {
  const workspace = deps.workspace.value
  const empty: BuildInputs = { layout: { gradle: false, maven: false, cmake: false, java: false }, sources: [], classpath: [], detectedJdk: null }
  if (!workspace) return empty

  const entries = await request<Entry[]>('workspace.list', { path: '' })
  const names = entries.map(entry => entry.path.replace(/^\.?\//, ''))

  let files: string[] = []
  try { files = (await request<{ files: string[] }>('workspace.files')).files } catch { files = [] }
  const usable = files.map(path => path.replace(/^\.?\//, '')).filter(path => !isIgnored(path))
  const sources = usable.filter(path => path.toLowerCase().endsWith('.java')).sort()

  const libraries = deps.projectSettings.value.java?.referencedLibraries ?? []
  const classpath = usable.filter(path => /\.jar$/i.test(path) && libraries.some(pattern => matchLibraryGlob(pattern, path))).sort()

  const jdks = await availableJdks()
  const configured = deps.projectSettings.value.java?.jdkHome?.trim() ?? ''
  const detectedJdk = configured
    ? jdks.find(entry => entry.home.toLowerCase() === configured.toLowerCase()) ?? { home: configured, version: '', name: '' }
    : jdks[0] ?? null

  return {
    layout: {
      gradle: Boolean(deps.gradleDetection.value?.isGradle),
      maven: names.includes('pom.xml'),
      cmake: names.includes('CMakeLists.txt'),
      java: sources.length > 0,
    },
    sources,
    classpath,
    detectedJdk,
  }
}

/** 把收集到的输入整形成 `buildPlan` 要的形状。 */
export function buildRequestOf(
  inputs: BuildInputs,
  deps: { workspace: Ref<Workspace | null>; projectSettings: Ref<ProjectSettings>; gradleDetection: { readonly value: GradleDetection | null }; fallbackCommand: () => string },
  rebuild: boolean,
): BuildRequest {
  const java = deps.projectSettings.value.java
  return {
    layout: inputs.layout,
    rebuild,
    detection: deps.gradleDetection.value,
    gradle: (deps.projectSettings.value.buildTools ?? DEFAULT_BUILD_TOOLS).gradle,
    // 「构建并运行使用」（`GradleProjectSettings.getDelegatedBuild()`，默认 true）。
    gradleDelegated: isDelegatedBuildEnabled((deps.projectSettings.value.buildTools ?? DEFAULT_BUILD_TOOLS).gradle),
    jdkHome: java.jdkHome?.trim() || inputs.detectedJdk?.home || '',
    outputPath: java.outputPath?.trim() || defaultJavaOutputPath(deps.workspace.value?.name ?? ''),
    classpath: inputs.classpath,
    sources: inputs.sources,
    projectName: deps.workspace.value?.name ?? '',
    fallback: deps.fallbackCommand(),
  }
}

/**
 * 「IDEA 打开默认就有」的落点：`jdkHome` 为空时填上探测到的 JDK，
 * `outputPath` 为空时填上 JPS 的默认输出目录。
 *
 * **只填空值**（用户填过的一律不动），这正是 IDEA 的行为：新建/打开项目给一个默认 SDK，
 * 用户改过之后就以用户的为准。
 *
 * @returns 需要写回的项目设置；没有可填的返回 `null`。
 */
export function javaDefaults(
  java: JavaProjectSettings,
  detected: JdkInfo | null,
  projectName: string,
): Partial<JavaProjectSettings> | null {
  const patch: Partial<JavaProjectSettings> = {}
  if (!java.jdkHome?.trim() && detected?.home) {
    patch.jdkHome = detected.home
    // jdkName 存 IDEA 的 SDK 显示名（JdkUtil.suggestJdkName：`17` / `1.8` / `21-ea`），
    // app.jdks 的 name 就是它；jdt.ls runtimes 要的 `JavaSE-<x>` 由原生
    // java_lsp_settings 的 normalize_runtime_name 在边界归一。
    if (detected.name) patch.jdkName = detected.name
  }
  if (!java.outputPath?.trim()) patch.outputPath = defaultJavaOutputPath(projectName)
  // 一个"源码根"都没有时，IDEA 的 Java 项目默认就是 `src`（没有 pom/gradle 时的约定）。
  if (!java.sourcePaths?.length) patch.sourcePaths = ['src']
  return Object.keys(patch).length ? patch : null
}
