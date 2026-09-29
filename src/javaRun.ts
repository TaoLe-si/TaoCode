// Java 程序的**运行/调试入口** —— IDEA 的 `ApplicationConfiguration` 在这一侧的对应物。
//
// 为什么单独一个模块：本仓原先的"运行当前上下文"（`runContextConfiguration`）只会找
// `${output}/${stem}.exe` —— 对 Java 项目完全不对：Java 的产物是 `.class`/`.jar`，
// 启动方式是 `java -cp … <主类全名>`。
//
// 逐条对照的源码：
//   · 主类怎么挑：`java/execution/impl/src/com/intellij/execution/application/
//       AbstractApplicationConfigurationProducer.java:50-66`
//       `ApplicationConfigurationType.getMainClass(element)` → `PsiMethodUtil.findMainInClass(aClass)`，
//       `:74` `configuration.setMainClassName(aClass.getQualifiedName())`（**全限定名**）。
//   · 什么算主类：`java/java-psi-api/src/com/intellij/psi/util/JvmMainMethodSearcher.java:31-37`
//       `MAIN_CLASS`：非局部/匿名、非注解、（顶层 **或** `static`）。
//   · 什么算 main 方法：`JvmMainMethodSearcher.java:197-227`
//         `:201` 返回类型必须是 `void`；
//         `:224-227` 传统分支 = `static` + `public` + 唯一的参数是 `String[]`
//                     （`isJavaLangStringArray`，所以 `String...` 与 `String args[]` 都要认）；
//         `:203-219` Java 21+ 的实例 main（`instanceMainMethodsEnabled`）—— 它依赖 language level，
//                     本仓的 javac 调用不带 `--release`，所以**只实现传统分支**，实例 main 的情况
//                     会如实报"没找到 main 方法"而不是猜一个。
//   · 命令行：`ApplicationConfiguration` + `JavaCommandLineState` 把 classpath 设成
//       **模块输出目录 + 依赖**，主类是全限定名。本仓的等价物见 `javaRunCommand`。
//
// 纯函数（零 import），所以 `node --test` 可以直接 import。
import { CLASSPATH_SEPARATOR } from './projectBuild.ts'

export interface JavaType {
  name: string
  /** 这个类型里有 `public static void main(String[])`（`JvmMainMethodSearcher:197-227` 的传统分支）。 */
  hasMain: boolean
}

export interface JavaSource {
  /** `package` 声明（没有就是空串 = 默认包）。 */
  packageName: string
  /** 顶层类型，按出现顺序。 */
  types: JavaType[]
}

/**
 * 把注释与字符串字面量抹成空格（**保持长度**，这样偏移量仍能对上原文）。
 * 必须做这一步：`{`/`}` 出现在字符串或注释里会把"顶层"的括号配对算错。
 */
export function stripLiterals(text: string): string {
  let out = ''
  let state: 'code' | 'line' | 'block' | 'string' | 'char' = 'code'
  for (let index = 0; index < text.length; ++index) {
    const character = text[index]!
    const next = text[index + 1]
    if (state === 'code') {
      if (character === '/' && next === '/') { state = 'line'; out += '  '; ++index; continue }
      if (character === '/' && next === '*') { state = 'block'; out += '  '; ++index; continue }
      if (character === '"') { state = 'string'; out += ' '; continue }
      if (character === "'") { state = 'char'; out += ' '; continue }
      out += character
      continue
    }
    if (state === 'line') { state = character === '\n' ? 'code' : 'line'; out += character === '\n' ? '\n' : ' '; continue }
    if (state === 'block') {
      if (character === '*' && next === '/') { state = 'code'; out += '  '; ++index; continue }
      out += character === '\n' ? '\n' : ' '
      continue
    }
    // string / char：转义字符整体吃掉，换行终止（Java 里本来就不允许裸换行，这里只是防御）
    if (character === '\\') { out += '  '; ++index; continue }
    if (character === '"' && state === 'string') state = 'code'
    if (character === "'" && state === 'char') state = 'code'
    out += character === '\n' ? '\n' : ' '
  }
  return out
}

/** `{` 配对的那个 `}` 的下标（-1 = 没配上）。 */
function matchBrace(text: string, openIndex: number): number {
  let depth = 0
  for (let index = openIndex; index < text.length; ++index) {
    if (text[index] === '{') ++depth
    else if (text[index] === '}') { --depth; if (depth === 0) return index }
  }
  return -1
}

const TYPE_HEADER = /\b(class|interface|enum|record)\s+([A-Za-z_$][\w$]*)\s*(?:<[^{;]*>)?\s*(?:extends[^{;]*)?\s*(?:implements[^{;]*)?$/
/**
 * `public static void main(String[] args)` —— 参数三种写法都认：
 * `String[] args` / `String args[]` / `String... args`（JLS 里三者同类型）。
 * 修饰符顺序也照 JLS 放开（`static public` 合法）。
 */
const MAIN_METHOD = new RegExp(
  String.raw`(?:^|[;{}\s])(?:(?:public|static|final|synchronized|strictfp)\s+){2,}void\s+main\s*\(\s*(?:final\s+)?String\s*(?:\[\s*\]\s*[A-Za-z_$][\w$]*|[A-Za-z_$][\w$]*\s*\[\s*\]|\.\.\.\s*[A-Za-z_$][\w$]*)\s*\)`,
  'm',
)

/** 解析一个 `.java` 源文件：package + 顶层类型 + 各自有没有 main。 */
export function parseJavaSource(text: string): JavaSource {
  const clean = stripLiterals(text)
  const packageName = /^\s*package\s+([\w.$]+)\s*;/m.exec(clean)?.[1] ?? ''
  const types: JavaType[] = []
  let depth = 0
  let cursor = 0
  for (let index = 0; index < clean.length; ++index) {
    const character = clean[index]
    if (character === '{') {
      if (depth === 0) {
        const header = clean.slice(cursor, index)
        const match = TYPE_HEADER.exec(header)
        if (match) {
          const close = matchBrace(clean, index)
          const body = close < 0 ? clean.slice(index) : clean.slice(index + 1, close)
          types.push({ name: match[2]!, hasMain: MAIN_METHOD.test(body) })
        }
      }
      ++depth
      continue
    }
    if (character === '}') {
      --depth
      if (depth === 0) cursor = index + 1
    }
  }
  return { packageName, types }
}

/**
 * 运行这个文件时用哪个主类（**全限定名**，照 `:74` 的 `getQualifiedName()`）。
 *
 * 优先"有 main 的顶层类型"；一个都没有时退回**第一个**顶层类型 ——
 * IDEA 在类上按运行也是这样（配置里记下这个类，让 JVM 去报 `no main method`），
 * 本仓保留同样的行为，免得"文件里就一个类"这种最常见的情况反而没有入口。
 * 文件名永远是最后的兜底（`Foo.java` 里找不出任何类型时用 `Foo`，默认包）。
 */
export function mainClassFor(text: string, fileName: string): string {
  const source = parseJavaSource(text)
  const qualified = (name: string) => (source.packageName ? `${source.packageName}.${name}` : name)
  const withMain = source.types.find(type => type.hasMain)
  if (withMain) return qualified(withMain.name)
  const first = source.types[0]
  if (first) return qualified(first.name)
  const stem = (fileName.split(/[\\/]/).pop() ?? '').replace(/\.java$/i, '')
  return stem ? qualified(stem) : ''
}

/** 这个文件里有没有可执行的 main（决定"运行"按钮能不能用）。 */
export function hasMainMethod(text: string): boolean {
  return parseJavaSource(text).types.some(type => type.hasMain)
}

/**
 * `<jdk>/bin/java.exe`；没配 JDK 就退回 PATH 上的 `java`。
 *
 * 分隔符**跟着调用方给的路径走**：JDK 是从 `app.jdks` 探测来的（Windows 上是 `D:\Java21`），
 * 但用户手输的可能是 `D:/Java21`。拼出一半反斜杠一半正斜杠的路径虽然 Windows 也认，
 * 看着却像 bug —— 而且写进日志/配置后会被原样带出去。
 */
export function javaExecutable(jdkHome: string): string {
  const home = (jdkHome ?? '').trim().replace(/[\\/]+$/, '')
  if (!home) return 'java'
  return home.includes('\\') ? `${home}\\bin\\java.exe` : `${home}/bin/java.exe`
}

/**
 * classpath：**构建工具的产物目录**在最前，然后是依赖（与编译那次用同一份）。
 *
 * 产物目录由 `runtimeOutputPaths` 给出 —— javac 是 `out/production/<名字>`，Gradle 是
 * `build/classes/java/main` 等，Maven 是 `target/classes`。用错一个就会"构建成功但找不到主类"。
 */
export function javaClasspath(outputPaths: readonly string[], classpath: readonly string[]): string {
  return [...outputPaths, ...classpath].filter(Boolean).join(CLASSPATH_SEPARATOR)
}

/** DAP 需要的参数表（`program` 是 java 可执行文件，`args` 是它后面那串）。 */
export function javaRunArgs(mainClass: string, outputPaths: readonly string[], classpath: readonly string[]): string[] {
  return ['-cp', javaClasspath(outputPaths, classpath), mainClass]
}

/**
 * 完整的启动命令行（跑在 shell 里时用它）。
 *
 * classpath 里有空格时**整个参数**要加引号 —— 路径来自工作区，中文与空格都常见。
 */
export function javaRunCommand(input: {
  mainClass: string
  outputPaths: readonly string[]
  classpath: readonly string[]
  jdkHome: string
  /** 额外的 VM 选项（IDEA 的 "VM options"），例如 `-Xmx512m`。 */
  vmOptions?: readonly string[]
}): string {
  if (!input.mainClass) return ''
  const options = (input.vmOptions ?? []).filter(Boolean).join(' ')
  const head = `"${javaExecutable(input.jdkHome)}"`
  const vm = options ? ` ${options}` : ''
  return `${head}${vm} -cp "${javaClasspath(input.outputPaths, input.classpath)}" ${input.mainClass}`
}
