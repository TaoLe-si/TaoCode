// TEST-01 core: IDEA's test runner is (1) discover tests in a file/scope, (2) run
// them through a framework command, (3) parse the runner's output into per-test
// results, (4) offer "rerun failed only" and stack-trace jump. This module holds
// the pure parts: discovery per framework, result-line parsing, and the failed-set
// bookkeeping the Rerun Failed action reads.

export type TestFramework = 'ctest' | 'npm' | 'junit' | 'pytest'

export interface DiscoveredTest { id: string; name: string; suite: string; line: number }

// --- discovery -------------------------------------------------------------
// ctest: `add_test(NAME name ...)` or `add_test(name ...)` in CMakeLists.
export function discoverCtest(text: string): DiscoveredTest[] {
  const found: DiscoveredTest[] = []
  const re = /add_test\s*\(\s*(?:NAME\s+)?([A-Za-z0-9_.:-]+)/g
  let match: RegExpExecArray | null
  let line = 1
  let cursor = 0
  while ((match = re.exec(text)) !== null) {
    const at = match.index + match[0].indexOf(match[1]!)
    for (let i = cursor; i < at; ++i) if (text[i] === '\n') ++line
    cursor = at
    const name = match[1]!
    found.push({ id: `ctest:${name}`, name, suite: 'ctest', line })
  }
  return found
}

// npm: `test('name', ...)` / `test('name', async () => ...)` in .test.mjs/js.
export function discoverNodeTests(text: string): DiscoveredTest[] {
  const found: DiscoveredTest[] = []
  const re = /(?:^|\n)\s*(?:test|it)\s*\(\s*['"`]([^'"`]+)['"`]/g
  let match: RegExpExecArray | null
  let line = 1
  let cursor = 0
  while ((match = re.exec(text)) !== null) {
    const at = match.index + match[0].indexOf(match[1]!)
    for (let i = cursor; i < at; ++i) if (text[i] === '\n') ++line
    cursor = at
    const name = match[1]!
    found.push({ id: `npm:${name}`, name, suite: 'node:test', line })
  }
  return found
}

// JUnit 5: @Test above `void name()`.
export function discoverJunit(text: string): DiscoveredTest[] {
  const found: DiscoveredTest[] = []
  const re = /@Test[^\n]*\n\s*(?:public|private|protected)?\s*void\s+([A-Za-z0-9_]+)\s*\(/g
  let match: RegExpExecArray | null
  let line = 1
  let cursor = 0
  while ((match = re.exec(text)) !== null) {
    const at = match.index + match[0].lastIndexOf(match[1]!)
    for (let i = cursor; i < at; ++i) if (text[i] === '\n') ++line
    cursor = at
    const name = match[1]!
    found.push({ id: `junit:${name}`, name, suite: 'JUnit', line })
  }
  return found
}

export function discover(path: string, text: string): DiscoveredTest[] {
  if (/CMakeLists\.txt$/i.test(path)) return discoverCtest(text)
  if (/\.(java|kt)$/i.test(path)) return discoverJunit(text)
  if (/\.(test|spec)\.[cm]?[jt]sx?$|\.test\.mjs$/i.test(path) || /(^|\/)tests?\//i.test(path) && /\.[cm]?[jt]s$/i.test(path))
    return discoverNodeTests(text)
  return []
}

// --- result parsing --------------------------------------------------------
export type TestOutcome = 'passed' | 'failed' | 'skipped'

export interface TestResult { id: string; name: string; outcome: TestOutcome; durationMs?: number; message?: string }

// node:test TAP: "✔ name (1.2ms)" / "✖ name (1.2ms)" / "﹣ name" plus the summary
// form "✔ name". Also accepts `not ok N name` / `ok N name`.
export function parseTapLine(text: string): TestResult | null {
  const pretty = /^\s*([✔✓])\s+(.+?)(?:\s+\(([\d.]+)\s*ms\))?\s*$/.exec(text)
  if (pretty) return { id: `npm:${pretty[2]}`, name: pretty[2]!, outcome: 'passed', ...(pretty[3] ? { durationMs: Number(pretty[3]) } : {}) }
  const fail = /^\s*([✖✘x])\s+(.+?)(?:\s+\(([\d.]+)\s*ms\))?\s*$/.exec(text)
  if (fail) return { id: `npm:${fail[2]}`, name: fail[2]!, outcome: 'failed', ...(fail[3] ? { durationMs: Number(fail[3]) } : {}) }
  const skip = /^\s*[﹣-]\s+(.+?)\s*(?:\s+\(([\d.]+)\s*ms\))?\s*#\s*SKIP\b/.exec(text)
  if (skip) return { id: `npm:${skip[1]}`, name: skip[1]!, outcome: 'skipped' }
  const tapOk = /^ok\s+\d+\s+(.+?)(?:\s+#\s*SKIP)?\s*$/i.exec(text)
  if (tapOk) return { id: `npm:${tapOk[1]}`, name: tapOk[1]!, outcome: /SKIP/i.test(text) ? 'skipped' : 'passed' }
  const tapNotOk = /^not\s+ok\s+\d+\s+(.+?)\s*$/i.exec(text)
  if (tapNotOk) return { id: `npm:${tapNotOk[1]}`, name: tapNotOk[1]!, outcome: 'failed' }
  return null
}

// ctest summary: "N% tests passed, 0 tests failed out of M" and per-test
// "Test #12: name ..." / "1/12 Test #12: name ... Passed 0.05 sec".
export function parseCtestLine(text: string): TestResult | null {
  // ctest writes "***Failed" for crashing tests; allow the stars before the verdict.
  const row = /^\s*\d+\/\d+\s+Test\s+#(\d+):\s*(.+?)\s*\.\.\.\s*\*{0,3}\s*(Passed|Failed|Not Run|Exception)/.exec(text)
  if (!row) return null
  const outcome: TestOutcome = row[3] === 'Passed' ? 'passed' : row[3] === 'Not Run' ? 'skipped' : 'failed'
  return { id: `ctest:${row[2]}`, name: row[2]!, outcome }
}

// JUnit: "1) ClassName.method  message" failure headers; gradle "ClassName > method PASSED".
export function parseJunitLine(text: string): TestResult | null {
  const gradle = /^(.+?)\s+>\s+(.+?)\s+(PASSED|FAILED|SKIPPED)\s*$/.exec(text)
  if (gradle) {
    const outcome: TestOutcome = gradle[3] === 'PASSED' ? 'passed' : gradle[3] === 'SKIPPED' ? 'skipped' : 'failed'
    return { id: `junit:${gradle[2]}`, name: gradle[2]!, outcome, message: gradle[1] ?? undefined }
  }
  const failure = /^\s*(\d+)\)\s+(\S+)\.(\S+)\s+(.*)$/.exec(text)
  if (failure) return { id: `junit:${failure[3]}`, name: failure[3]!, outcome: 'failed', message: failure[2] }
  return null
}

export function parseResultLine(text: string): TestResult | null {
  return parseTapLine(text) ?? parseCtestLine(text) ?? parseJunitLine(text)
}

// --- rerun failed ----------------------------------------------------------
// IDEA's "Rerun Failed Tests" button feeds the previous failure set back to the
// framework: ctest -R, node --test-name-pattern, mvn -Dtest, pytest -k.
export function rerunCommand(framework: TestFramework, base: string, failed: readonly string[]): string {
  if (!failed.length) return base
  if (framework === 'ctest') {
    const pattern = failed.map(escapeRegex).join('|')
    return `${base} -R "^(${pattern})$"`
  }
  if (framework === 'npm') {
    const pattern = failed.map(escapeRegex).join('|')
    return `${base} --test-name-pattern="${pattern.replace(/"/g, '\\"')}"`
  }
  if (framework === 'junit') {
    return `${base} -Dtest=${failed.join(',')}`
  }
  return `${base} -k ${failed.map(escapeRegex).join(' or ')}`
}

function escapeRegex(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// The failed-set accumulator: only failures enter it; a later pass clears the
// test out, so the button always reruns exactly what is still red.
export class FailedSet {
  private failed = new Map<string, string>()

  apply(result: TestResult): void {
    if (result.outcome === 'failed') this.failed.set(result.id, result.name)
    else this.failed.delete(result.id)
  }

  applyAll(results: readonly TestResult[]): void { for (const result of results) this.apply(result) }
  names(): string[] { return [...this.failed.values()] }
  get size(): number { return this.failed.size }
  clear(): void { this.failed.clear() }
}

// Extract the first workspace frame from a failure stack so "jump to source"
// lands on the assertion, not on node internals.
export function firstStackFrame(stack: readonly string[]): { path: string; line: number } | null {
  for (const raw of stack) {
    const match = /([^\s()]+\.mjs|[^()\s]+\.tsx?|[^()\s]+\.java|[^()\s]+\.cpp):\s*(\d+)/.exec(raw.replace(/file:\/\/\//, ''))
    if (!match) continue
    return { path: match[1]!.replace(/\\/g, '/'), line: Number(match[2]) }
  }
  return null
}
