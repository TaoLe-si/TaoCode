// Java 异常行过滤器（上游 `java/execution/openapi/src/com/intellij/execution/filters/` 的
// `ExceptionFilter` / `AdvancedExceptionFilter` / `ExceptionInfo` 一族的**纯文本子集**）。
//
// 上游在控制台里做三件事：把 `java.lang.NullPointerException: ...` 这样的行认出来，
// 按异常类分类成具体的 `ExceptionInfo`（`NullPointerExceptionInfo` / `ArrayIndexOutOfBoundsExceptionInfo` /
// `ClassCastExceptionInfo` / `ArithmeticExceptionInfo` / `ArrayStoreExceptionInfo` /
// `NegativeArraySizeExceptionInfo` / `AssertionErrorInfo` / `JetBrainsNotNullInstrumentationExceptionInfo`），
// 并在同一行给出辅助信息（JEP 358 的帮助消息、`Exception in thread` 的线程名、`Caused by:` 链）。
// 本仓没有 PSI，拿不到 `ExceptionLineRefiner` 对发生表达式的 PSI 校验（那是 Java 专属），
// 这里做的是**可移植的那半**：分类 + 提示 + 栈帧复制/折叠，并接进运行控制台
// （`src/runIssues.ts` 识别，`src/components/RunConsole.vue` 渲染、复制、展开）。
//
// 纯函数、零依赖，判据 tests/run-filters.test.mjs。

/** 上游 ExceptionInfo 子类对应的分类。`other` = 认得出是异常/错误但不在专门分类里。 */
export type JavaExceptionKind =
  | 'null-pointer' | 'array-index' | 'array-copy-index' | 'negative-array-size'
  | 'arithmetic' | 'class-cast' | 'array-store' | 'assertion' | 'not-null' | 'other'

export interface JavaExceptionInfo {
  /** 全限定类名（上游 `ExceptionInfo.getClassName()` 记的东西）。 */
  className: string
  simpleName: string
  kind: JavaExceptionKind
  /** `: ` 之后的 message（没有就是空串）。 */
  message: string
  /** 按 message 给出的可读提示（JEP 358 的帮助消息、越界下标等）；拿不到就是空串。 */
  hint: string
  /** `Exception in thread "main"` 里的线程名；不是线程头就是空串。 */
  thread: string
  /** 行首是 `Caused by:`（cause 链的一环）。 */
  causedBy: boolean
}

/** 行尾出现的异常类名判据：上游也以 `Exception`/`Error`/`Throwable` 结尾为准。 */
const CLASS_NAME = /^((?:[A-Za-z_$][\w$]*\.)*[A-Za-z_$][\w$]*(?:Exception|Error|Throwable))$/

/**
 * 识别一行异常头。上游 `ExceptionFilter` 同时认 `Exception in thread "main" java.lang.X: msg`
 * 与 cause 链里的 `Caused by: java.lang.X: msg`；两者都可能带 `: message`，message 也可能为空。
 */
export function classifyJavaException(text: string): JavaExceptionInfo | null {
  const header = /^(\s*)Exception in thread\s+"([^"]*)"\s+([\s\S]+)$/.exec(text)
  const caused = /^(\s*)Caused by:\s+([\s\S]+)$/.exec(text)
  const bare = /^(\s*)([\s\S]+)$/.exec(text)
  if (!bare) return null
  let body = ''
  let thread = ''
  let causedBy = false
  if (header) { body = header[3]!; thread = header[2]! }
  else if (caused) { body = caused[2]!; causedBy = true }
  else body = bare[2]!
  const match = /^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)(?::\s?([\s\S]*))?$/.exec(body.trim())
  if (!match) return null
  const className = match[1]!
  if (!CLASS_NAME.test(className)) return null
  const message = (match[2] ?? '').trim()
  const simpleName = className.split('.').pop() ?? className
  const kind = kindOf(simpleName, message)
  return { className, simpleName, kind, message, hint: hintFor(kind, message), thread, causedBy }
}

function kindOf(simpleName: string, message: string): JavaExceptionKind {
  switch (simpleName) {
    case 'NullPointerException': return 'null-pointer'
    case 'ArrayIndexOutOfBoundsException':
      // `System.arraycopy` 的越界在 HotSpot 上是同一个类、message 以 `arraycopy:` 开头；
      // 上游为它单列了 `ArrayCopyIndexOutOfBoundsExceptionInfo`。
      return /^arraycopy:/.test(message) ? 'array-copy-index' : 'array-index'
    case 'NegativeArraySizeException': return 'negative-array-size'
    case 'ArithmeticException': return 'arithmetic'
    case 'ClassCastException': return 'class-cast'
    case 'ArrayStoreException': return 'array-store'
    case 'AssertionError': return 'assertion'
    case 'IllegalArgumentException':
      // JetBrains 的 @NotNull 插桩（Kotlin 参数检查）抛的还是 IAE，message 有固定形状；
      // 上游 `JetBrainsNotNullInstrumentationExceptionInfo` 单独认它。
      if (/Argument for @NotNull parameter/.test(message) || /Parameter specified as non-null is null/.test(message)) return 'not-null'
      return 'other'
    default: return 'other'
  }
}

/** 分类的可读名（控制台徽标用；与控制台其余文案一样用中文）。 */
export function describeExceptionKind(kind: JavaExceptionKind): string {
  switch (kind) {
    case 'null-pointer': return '空指针'
    case 'array-index': return '数组越界'
    case 'array-copy-index': return '数组复制越界'
    case 'negative-array-size': return '负数组长度'
    case 'arithmetic': return '算术错误'
    case 'class-cast': return '类型转换'
    case 'array-store': return '数组存储'
    case 'assertion': return '断言失败'
    case 'not-null': return '空值参数'
    default: return '异常'
  }
}

/** JEP 358 / 各类 message 的辅助提示（上游每个 ExceptionInfo 子类的 `getHint` 等价物）；
 *  由 `:60` 的 `classifyJavaException` 挂在结果上，控制台那一行直接读 `info.hint`。 */
function hintFor(kind: JavaExceptionKind, message: string): string {
  if (!message) return ''
  switch (kind) {
    case 'null-pointer': {
      // JEP 358 Helpful NullPointerExceptions：`Cannot invoke "a.b.C.d()" because ...`。
      const invoke = /^Cannot invoke "([^"]+)"/.exec(message)
      if (invoke) return `在 ${invoke[1]} 上出现空引用`
      const field = /^Cannot (?:read|assign) field "([^"]+)"/.exec(message)
      if (field) return `字段 ${field[1]} 上出现空引用`
      if (/^Cannot store to /.test(message)) return '往 null 的数组里存值'
      if (/^Cannot load from /.test(message)) return '从 null 的数组里取值'
      if (/^Cannot read the array length/.test(message)) return '对 null 取数组长度'
      if (/^Cannot enter synchronized block/.test(message)) return '对 null 加锁'
      if (/^Cannot throw exception/.test(message)) return '抛出空异常对象'
      return ''
    }
    case 'array-index': {
      const index = /^Index (-?\d+) out of bounds for length (\d+)/.exec(message)
      return index ? `下标 ${index[1]} 超出长度 ${index[2]}` : ''
    }
    case 'array-copy-index':
      return message
    case 'negative-array-size': {
      const size = /^-\d+$/.exec(message)
      return size ? `数组长度为负：${message}` : ''
    }
    case 'arithmetic':
      return /\/ by zero/.test(message) ? '除零' : ''
    case 'class-cast': {
      // `class A cannot be cast to class B (A and B are in module ...)`。
      const cast = /^class (.+?) cannot be cast to class (.+?)(?:\s|\()/.exec(message)
      return cast ? `无法把 ${simpleType(cast[1]!)} 转成 ${simpleType(cast[2]!)}` : ''
    }
    case 'array-store':
      return message
    case 'assertion': {
      const assertion = /^Expected (.+)$/.exec(message)
      return assertion ? `断言期望 ${assertion[1]}` : ''
    }
    case 'not-null': {
      const parameter = /Argument for @NotNull parameter '([^']+)'/.exec(message)
      if (parameter) return `参数 ${parameter[1]} 不能为空`
      const kotlin = /Parameter specified as non-null is null: (.+)$/.exec(message)
      return kotlin ? `参数为空：${kotlin[1]}` : '参数不能为空'
    }
    default:
      return ''
  }
}

function simpleType(name: string): string {
  const trimmed = name.trim()
  const generic = trimmed.indexOf('<')
  const plain = generic >= 0 ? trimmed.slice(0, generic) : trimmed
  return plain.split('.').pop() || plain
}

/** 复制到剪贴板的文本（上游「复制栈帧」复制的是原始行，此处保持原样）。 */
export function stackFrameCopyText(text: string): string {
  return text.trim()
}

export interface StackFrameParts {
  /** `at com.x.Y.z` 里的方法全名；解析不出来就是空串。 */
  method: string
  file: string
  line: number
}

/** 解析一行 `at com.x.Y.z(File.java:12)`（上游 `JavaStackFrame` 的纯文本等价物）。 */
export function parseStackFrame(text: string): StackFrameParts | null {
  const match = /^\s*at\s+([\w$.<>]+)\(([^:()]+)(?::(\d+))?\)\s*$/.exec(text)
  if (!match) return null
  return { method: match[1]!, file: match[2]!, line: match[3] ? Number(match[3]) : 0 }
}

const FRAME_LINE = /^\s*at\s+[\w$.<>]+\(.*\)\s*$/

export interface StackFoldableLine { text: string }

/**
 * Java 栈帧折叠（上游控制台对 `at ...` 连排的折叠行为）。
 * 连续的栈帧超过 `keep + 1` 行时，只保留前 `keep` 行与最后一行，中间的行丢弃并在
 * 保留的最后一行上标注 `foldedFrames`（渲染成「… 其余 N 行栈帧」）。`expanded` 为 true 时原样返回。
 */
export function foldJavaStackFrames<T extends StackFoldableLine>(
  lines: readonly T[], expanded: boolean, keep = 2,
): Array<T & { foldedFrames?: number }> {
  if (expanded) return lines.map(line => ({ ...line }))
  const out: Array<T & { foldedFrames?: number }> = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]!
    if (!FRAME_LINE.test(line.text)) { out.push({ ...line }); index++; continue }
    let end = index
    while (end < lines.length && FRAME_LINE.test(lines[end]!.text)) end++
    const run = lines.slice(index, end)
    if (run.length <= keep + 1) { for (const entry of run) out.push({ ...entry }); index = end; continue }
    for (let i = 0; i < keep; i++) out.push({ ...run[i]! })
    const last = run[run.length - 1]!
    out.push({ ...last, foldedFrames: run.length - keep - 1 })
    index = end
  }
  return out
}
