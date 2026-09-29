// 打开项目时**从上下文发现可运行目标** —— IDEA `RunConfigurationProducer` 那一层。
//
// 为什么需要（桃 2026-09-27 报的原话：「打开已有项目不会自动配置好运行配置，我点击运行提示我需要运行配置」）：
// IDEA 的运行按钮在**没有选中配置**时不会把人挡回去，它走 `RunConfigurationProducer` 从上下文**生成**一个配置
// （Java 的实现在 `java/execution/impl/.../AbstractApplicationConfigurationProducer.java:50-66`：
// 从当前文件的类/`main` 方法取主类，`:74` 只把**主类全限定名**记进配置）。本仓原先只做了"当前文件"那一半
// （`runContextConfiguration`），打开项目后选择器里空空如也，所以这里的补的是**项目级发现**：
// 扫一遍工作区，把能跑的东西列成候选，让 ▶ 一开始就有东西可跑。
//
// **候选不落盘**：IDEA 的 Producer 生成的也是临时配置（要按"存储为项目文件"才写 `.idea/runConfigurations`）。
// 本仓同样只把它们挂在选择器上，用户的 `ProjectSettings.runConfigs` 一个字都不动。
//
// 纯逻辑（零宿主依赖，输入是文件清单 + 少数文件内容），`node --test` 可直接测。
import { hasMainMethod, javaRunCommand, javaRunArgs, javaExecutable, mainClassFor } from './javaRun.ts'
import { GRADLE_BUILD_FILES } from './gradle.ts'

export type RunTargetKind = 'java' | 'cmake' | 'node' | 'python' | 'gradle' | 'maven'

export interface RunTarget {
  /** 显示名（IDEA 的选择器里就是配置名，例如 `Main`）。 */
  name: string
  kind: RunTargetKind
  /** 要跑的命令行（走 `run.start` 的 `shell` 通道）。 */
  command: string
  /** 结构化字段：调试（DAP）要用它们，不能靠再切一次命令行（路径里的空格会被切坏）。 */
  program?: string
  args?: string[]
  /** 为什么它会是候选（界面上如实显示来源）。 */
  reason: string
  /** 源码里发现它的那个文件（工作区相对路径）。 */
  source: string
}

export interface RunTargetInputs {
  /** 工作区全部文件（`workspace.files`）。 */
  files: readonly string[]
  /** 少数文件的内容（按路径索引）：`.java`、`package.json`、`*.py`。宿主只读这些，别全读。 */
  contents: Readonly<Record<string, string>>
  /**
   * Java 侧只用得到这三样 —— classpath 与「构建」用的是同一份，而且**产物目录跟着构建工具走**
   * （javac → `out/production/<名字>`、Gradle → `build/classes/java/main` 等、Maven → `target/classes`；
   * 由 `runtimeOutputPaths` 折算，见 src/projectBuild.ts）。
   */
  java: { jdkHome: string; outputPaths: readonly string[]; classpath: readonly string[] }
}

/** 一次最多读多少文件的内容（避免打开大项目时同步读上千个文件）。 */
export const MAX_CONTENT_FILES = 40

/**
 * 需要读内容的文件（宿主据此去 `file.read`）：
 * `.java`（找 main）、`package.json`（scripts）、`.py`（`if __name__`）、构建脚本（判断有没有 application 插件）。
 * 按路径排序后截断到 `MAX_CONTENT_FILES`。
 */
export function filesNeedingContent(files: readonly string[]): string[] {
  const interesting = files.filter(path => {
    const lower = path.toLowerCase()
    if (lower.endsWith('.java')) return true
    if (lower === 'package.json' || lower.endsWith('/package.json')) return true
    if (lower.endsWith('.py')) return true
    if (GRADLE_BUILD_FILES.some(name => lower.endsWith(name))) return true
    if (lower.endsWith('pom.xml')) return true
    return false
  })
  return interesting.sort().slice(0, MAX_CONTENT_FILES)
}

/** 从 `package.json` 的 `scripts` 里取条目（`{ name: command }`）。 */
export function packageScripts(content: string): Array<{ name: string; command: string }> {
  try {
    const parsed = JSON.parse(content) as { scripts?: Record<string, unknown> }
    if (!parsed || typeof parsed.scripts !== 'object' || parsed.scripts === null) return []
    return Object.entries(parsed.scripts)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0)
      .map(([name, command]) => ({ name, command }))
  } catch {
    return []
  }
}

/** Python 的 `main` 入口判定：`if __name__ == "__main__"`（引号与空格都放开）。 */
export function hasPythonMain(content: string): boolean {
  return /^if\s+__name__\s*==\s*['"]__main__['"]\s*:/m.test(content)
}

/** Gradle 的 `application` 插件（`run` 任务存在的前提）与 Spring Boot 的 `bootRun`。 */
export function gradleApplicationTask(content: string): string {
  // Spring Boot 的任务就是 `bootRun`（插件 id 是 `org.springframework.boot`，老写法用 `spring-boot`）。
  if (/org\.springframework\.boot|['"]spring-boot['"]|\bbootRun\b/.test(content)) return 'bootRun'
  if (/\bid\s*\(?\s*['"]application['"]/.test(content) || /apply\s+plugin\s*:\s*['"]application['"]/.test(content))
    return 'run'
  return ''
}

/** `<dir>/<stem>.exe` 这类构建产物是否已经在文件清单里（CMake 的默认输出名）。 */
export function cmakeArtifacts(files: readonly string[]): string[] {
  return files
    .filter(path => /\.exe$/i.test(path) && !path.includes('/CMakeFiles/'))
    .filter(path => path.startsWith('build/') || path.startsWith('out/'))
    .sort()
}

/**
 * 扫出可运行目标。
 *
 * 只报**有确证**的：源文件里真有 `main` / `scripts` 里真有脚本 / 构建脚本里真有 application 插件 /
 * 文件清单里真有 `.exe`。宁可少报，也不要给一个点下去就报错的候选。
 */
export function discoverRunTargets(inputs: RunTargetInputs): RunTarget[] {
  const targets: RunTarget[] = []
  const outputs = inputs.java.outputPaths
  const classpath = inputs.java.classpath

  // ① Java：源文件里有 main 方法（`JvmMainMethodSearcher` 的判定交给 src/javaRun.ts）
  for (const [path, content] of Object.entries(inputs.contents)) {
    if (!path.toLowerCase().endsWith('.java')) continue
    const mainClass = mainClassFor(content, path)
    if (!mainClass) continue
    // `mainClassFor` 在没有 main 时会退回"第一个类型"，所以这里再确认一次（宁可少报）。
    if (!hasMainMethod(content)) continue
    const simple = mainClass.split('.').pop() ?? mainClass
    targets.push({
      name: `${simple}（${path.split('/').pop()}）`, kind: 'java',
      command: javaRunCommand({ mainClass, outputPaths: outputs, classpath, jdkHome: inputs.java.jdkHome }),
      program: javaExecutable(inputs.java.jdkHome),
      args: javaRunArgs(mainClass, outputs, classpath),
      reason: `源码里有 main 方法：${mainClass}`, source: path,
    })
  }

  // ② Node：package.json 的 scripts
  for (const [path, content] of Object.entries(inputs.contents)) {
    if (!path.toLowerCase().endsWith('package.json')) continue
    for (const script of packageScripts(content))
      targets.push({
        name: `npm run ${script.name}`, kind: 'node',
        command: `npm run ${script.name}`, reason: 'package.json 里的 scripts 条目', source: path,
      })
  }

  // ③ Python：有 `if __name__ == "__main__"`
  for (const [path, content] of Object.entries(inputs.contents)) {
    if (!path.toLowerCase().endsWith('.py') || !hasPythonMain(content)) continue
    targets.push({
      name: `Python：${path.split('/').pop()}`, kind: 'python',
      command: `python "${path}"`, program: 'python', args: [path],
      reason: '脚本里有 `if __name__ == "__main__"`', source: path,
    })
  }

  // ④ Gradle：application / bootRun 任务
  for (const [path, content] of Object.entries(inputs.contents)) {
    if (!GRADLE_BUILD_FILES.some(name => path.toLowerCase().endsWith(name))) continue
    const task = gradleApplicationTask(content)
    if (!task) continue
    targets.push({
      name: `Gradle：${task}`, kind: 'gradle',
      command: `gradlew.bat --console=plain ${task}`, reason: `构建脚本里声明了 ${task} 任务`, source: path,
    })
  }

  // ⑤ CMake：构建产物已经在工作区里
  for (const artifact of cmakeArtifacts(inputs.files))
    targets.push({
      name: artifact.split('/').pop() ?? artifact, kind: 'cmake',
      command: `"${artifact}"`, program: artifact, reason: '工作区里已有构建产物', source: artifact,
    })

  return targets
}
