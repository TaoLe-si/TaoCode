// Build console diagnostics parsing, IDEA's CompilerOutputParser set: MSVC
// ("file(line,col): error C2065: ..."), GCC/Clang ("file:line:col: error: ...")
// and javac ("file:line: error: ..."). Recognising all three is what makes the
// run console a navigation surface instead of a wall of text.

export interface RunIssue { path: string; line: number; column: number }

const issuePatterns: RegExp[] = [
  // MSVC: path(line[,col]): error|warning|fatal error [C1234:] message
  /^\s*([^\s:*?<>|]+\.[A-Za-z0-9_]+)\((\d+)(?:,\s*(\d+))?\)\s*:\s*(?:fatal\s+)?(?:error|warning|错误|警告)\s*(?:C?\d+)?\s*[:\s]/i,
  // GCC/Clang/Rust: path:line[:col]: error[E0425][: message] / warning: ...
  /^\s*([^\s:*?<>|]+\.[A-Za-z0-9_]+):(\d+):(?:(\d+):)?\s*(?:fatal\s+)?(?:error(?:\[E\d+\])?|warning|错误|警告)\s*[:\s]/i,
]

export function parseRunIssue(text: string): RunIssue | null {
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
