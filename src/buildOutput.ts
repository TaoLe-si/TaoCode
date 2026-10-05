// Build console diagnostics parsing, IDEA's CompilerOutputParser set: MSVC
// ("file(line,col): error C2065: ..."), GCC/Clang ("file:line:col: error: ...")
// and javac ("file:line: error: ..."). Recognising all three is what makes the
// run console a navigation surface instead of a wall of text.
//
// Kotlin / Groovy 两个编译器输出也在这里（Gradle 工程的主力编译器）：
//   · kotlinc：`e: file:///D:/p/Main.kt:5:9 Unresolved reference: x`（严重级 `e:`/`w:` 前缀 +
//     `file:` URI/路径 + `line:col`，也可写成 `e: Main.kt: (5, 9): ...`）——
//     上游 `KotlincOutputParser.kt:52-63` 的 `extractPath` 与位置模式。
//   · groovyc：`Main.groovy: 5: unexpected token: } @ line 5, column 3.` ——
//     上游 `GroovycOutputParser.java:24-25` 的 `FILE_LINE` + `LOCATION` 两个模式。
//     `@ line N, column M.` 在**同一行**才给列号（上游会读下一行找它；本仓的解析是逐行的，
//     下一行变体退回列 1）。

export interface RunIssue { path: string; line: number; column: number }

/** `file:///D:/a%20b/Main.kt` → `D:/a b/Main.kt`（上游用 `URI(path).toPath()` 做同一件事）。 */
export function fileUriToPath(uri: string): string {
  const rest = uri.replace(/^file:\/\//i, '')
  let path = rest
  // `file:///D:/x` 在剥掉 scheme 后是 `/D:/x`：盘符前的那个 `/` 是 URI 语法，不属于路径。
  if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1)
  // `file://server/share/x` 是 UNC：保留双斜杠形态（上游 `toPath()` 等价）。
  else if (!path.startsWith('/') && !/^[A-Za-z]:/.test(path)) path = '//' + path
  try {
    return decodeURI(path)
  } catch {
    return path
  }
}

// kotlinc 的两种位置写法（`KotlincOutputParser.kt:22-23` 的 WINDOWS_URI/UNIX_URI + `:88-110` 的位置分支）。
const kotlincUriPattern = /^\s*[ewi]:\s+file:\/\/(.+?\.(?:kt|kts|java)):(\d+):(\d+)\s/i
const kotlincParenPattern = /^\s*[ewi]:\s+(.+?\.(?:kt|kts|java)):\s*\((\d+),\s*(\d+)\)/i
// groovyc：`Main.groovy: 5: message @ line 5, column 3.`（列号可缺省）。
const groovycPattern = /^\s*(.+?\.groovy):\s*(\d+):\s*([^@]*?)(?:@ line (\d+), column (\d+)\.)?\s*$/i

function kotlincIssue(text: string): RunIssue | null {
  const uri = kotlincUriPattern.exec(text)
  // group2 是 `file://` 之后的部分（`/D:/a.kt` / `/home/u/a.kt` / `server/share/a.kt`）。
  if (uri) return { path: fileUriToPath(uri[1]!), line: Math.max(1, Number(uri[2])), column: Math.max(1, Number(uri[3])) }
  const paren = kotlincParenPattern.exec(text)
  if (paren) return { path: paren[1]!, line: Math.max(1, Number(paren[2])), column: Math.max(1, Number(paren[3])) }
  return null
}

function groovycIssue(text: string): RunIssue | null {
  const match = groovycPattern.exec(text)
  if (!match) return null
  // 没有 `@ line` 后缀就没有列号：退回 1（上游 GroovycOutputParser 会读下一行找位置）。
  const column = match[5] ? Math.max(1, Number(match[5])) : 1
  return { path: match[1]!, line: Math.max(1, Number(match[2])), column }
}

const issuePatterns: RegExp[] = [
  // MSVC: path(line[,col]): error|warning|fatal error [C1234:] message
  /^\s*([^\s:*?<>|]+\.[A-Za-z0-9_]+)\((\d+)(?:,\s*(\d+))?\)\s*:\s*(?:fatal\s+)?(?:error|warning|错误|警告)\s*(?:C?\d+)?\s*[:\s]/i,
  // GCC/Clang/Rust: path:line[:col]: error[E0425][: message] / warning: ...
  /^\s*([^\s:*?<>|]+\.[A-Za-z0-9_]+):(\d+):(?:(\d+):)?\s*(?:fatal\s+)?(?:error(?:\[E\d+\])?|warning|错误|警告)\s*[:\s]/i,
]

export function parseRunIssue(text: string): RunIssue | null {
  const kotlinc = kotlincIssue(text)
  if (kotlinc) return kotlinc
  const groovyc = groovycIssue(text)
  if (groovyc) return groovyc
  for (const pattern of issuePatterns) {
    const match = pattern.exec(text)
    if (!match) continue
    return {
      // `./x.c:1: ...` is common in GCC output; the IDE speaks root-relative paths
      // without the redundant prefix.
      path: match[1]!.replace(/^\.\//, ''),
      line: Math.max(1, Number(match[2])),
      column: Math.max(1, Number(match[3] ?? '1')),
    }
  }
  return null
}

// Compiler output uses native separators and often an absolute path under the
// workspace root; the IDE speaks '/'-joined, root-relative paths. Matching the
// prefix case-insensitively handles drives reported in either case.
export function normalizeRunPath(raw: string, root: string): string {
  let value = raw.replace(/\\/g, '/').replace(/^\.\//, '')
  if (root) {
    const prefix = root.replace(/\\/g, '/').replace(/\/+$/, '') + '/'
    if (value.toLowerCase().startsWith(prefix.toLowerCase())) value = value.slice(prefix.length)
  }
  return value
}

// CMake errors point at the CMakeLists line: "CMake Error at CMakeLists.txt:12 (msg)".
export function parseCmakeIssue(text: string): RunIssue | null {
  const match = /^\s*CMake (?:Error|Warning) at (.+?):(\d+)/.exec(text)
  if (!match) return null
  return { path: match[1]!, line: Math.max(1, Number(match[2])), column: 1 }
}

export function parseAnyIssue(text: string, root: string): RunIssue | null {
  return parseCmakeIssue(text) ?? (() => {
    const issue = parseRunIssue(text)
    return issue ? { ...issue, path: normalizeRunPath(issue.path, root) } : null
  })()
}
