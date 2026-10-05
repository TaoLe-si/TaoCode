// exec/filters：**测试输出上的过滤器管道**（上游 `platform/execution-impl` 的
// `com.intellij.execution.filters.Filter` / `CompositeFilter` 一族 + Gradle 的
// `GradleReRunBuildFilter` / `ReRunTaskFilter`）。
//
// 上游依据：
//   · `platform/testRunner/src/com/intellij/execution/testframework/Filter.java:99-108`
//     `DEFECTIVE_LEAF`（缺陷叶子）—— 判词里 `Filter` 族在本仓的可见形态；
//   · `plugins/gradle/src/org/jetbrains/plugins/gradle/execution/filters/GradleReRunBuildFilter.java`
//     `:13-20` 认的那四种 Gradle 提示行、`:32-52` 只在行尾是
//     `option to get the stack trace.` / `option to get more log output.` / `to get full insights.`
//     且含 `Run with --` 时才产出链接、`:43-47` 逐个词建链接
//     （`--stacktrace` / `--info` / `--debug` / `--scan`，同一个词在行里出现两次也各建一个）、`:48-50`
//     一个都没匹配上就返回 null（不产出空结果）；
//   · `plugins/gradle/.../filters/ReRunTaskFilter.java:20-45` —— 点链接之后把选项
//     **并进运行配置的脚本参数**：先按空格切开已有参数、**去掉** `--stacktrace` / `--info` /
//     `--debug`（`:31-33`），再追加点中的那个选项，最后重启运行。
//
// 本仓的等价物：`filterTestOutputLine`（一行 → 若干个可点片段：Gradle 选项链接 +
// `file:line` 位置链接，后者复用 `src/runHyperlinks.ts` 的 `MultipleFilesHyperlinkInfo` 等价物）、
// `rerunCommandWithOptions`（`ReRunTaskFilter` 的参数改写口径）。
// 消费点：`src/components/TestRunnerPanel.vue` 的失败详情区（点选项就带上该选项重跑），
// 判据 `tests/test-output-filters.test.mjs`。
import { findRunHyperlinks, type RunHyperlink } from './runHyperlinks.ts'
import { classifyJavaException } from './exceptionFilter.ts'

/** 上游 `GradleReRunBuildFilter.java:43-47` 逐个建的四个链接词。 */
export const GRADLE_RERUN_OPTIONS: readonly { text: string; option: string }[] = [
  { text: 'Run with --stacktrace', option: '--stacktrace' },
  { text: 'Run with --info', option: '--info' },
  { text: 'Run with --debug option', option: '--debug' },
  { text: '--debug option', option: '--debug' },
  { text: 'Run with --scan', option: '--scan' },
]

/** 上游 `:37-42` 的行尾判据。 */
const GRADLE_HINT_TAIL = /(?:option to get the stack trace\.|option to get more log output\.|to get full insights\.)$/

export interface RerunLink { text: string; option: string; start: number; end: number }

/**
 * Gradle 的「带选项重跑」提示行 → 链接。行尾不对或没有 `Run with --` 就返回空数组
 * （上游 `:41` / `:48-50` 的两处短路）。
 */
export function gradleRerunLinks(line: string): RerunLink[] {
  const trimmed = line.trim()
  if (!trimmed.includes('Run with --') || !GRADLE_HINT_TAIL.test(trimmed)) return []
  const links: RerunLink[] = []
  for (const candidate of GRADLE_RERUN_OPTIONS) {
    const index = line.indexOf(candidate.text)
    if (index < 0) continue
    // 同一个词在行里出现两次也要各建一个（上游的 `addLinkIfMatch` 每次 `indexOf` 都建）。
    let from = 0
    for (;;) {
      const at = line.indexOf(candidate.text, from)
      if (at < 0) break
      links.push({ text: candidate.text, option: candidate.option, start: at, end: at + candidate.text.length })
      from = at + candidate.text.length
    }
  }
  return links.sort((a, b) => a.start - b.start)
}

/**
 * 点链接后的参数改写（`ReRunTaskFilter.java:20-45`）：按空格切开已有参数、去掉
 * `--stacktrace` / `--info` / `--debug`，追加点中的选项，再拼回去。
 */
export function rerunCommandWithOptions(command: string, options: readonly string[]): string {
  const parts = command.trim().split(/\s+/).filter(Boolean)
  const rest = parts.filter(part => !['--stacktrace', '--info', '--debug'].includes(part))
  return [...rest, ...options].join(' ')
}

/**
 * 链接按 `kind` 分成两支：`rerun` 一定带 `option`（点它就是带上那个选项重跑），
 * `file` 不带。用可辨识联合而不是可选字段 —— 判别式联合让模板里
 * `link.kind === 'rerun'` 之后 `link.option` 一定是 `string`。
 */
export type TestOutputLink =
  | (RunHyperlink & { kind: 'rerun'; option: string })
  | (RunHyperlink & { kind: 'file'; option?: never })

export type TestOutputSegment =
  | { kind: 'text'; text: string }
  | { kind: 'exception'; text: string; simpleName: string }
  | { kind: 'link'; text: string; link: TestOutputLink }

/**
 * 一行测试输出 → 渲染片段（`Filter.applyFilter` 的等价物：返回带区间信息的项列表）。
 * 三件事：异常头给一个分类记号（`src/exceptionFilter.ts` 那一族）、Gradle 选项链接、
 * `file:line` 位置链接（`MultipleFilesHyperlinkInfo` 一族）。
 */
export function filterTestOutputLine(line: string, root = '', limit = 8): TestOutputSegment[] {
  const segments: TestOutputSegment[] = []
  const rerun = gradleRerunLinks(line)
  const files = findRunHyperlinks(line, root, limit)
  // 两类链接按区间合流：同一段里谁先出现谁先渲染，重叠的后来者丢掉。
  const marks: { start: number; end: number; link: TestOutputLink }[] = [
    ...rerun.map(item => ({ start: item.start, end: item.end, link: { kind: 'rerun' as const, option: item.option, text: item.text, path: '', line: 0, column: 0, start: item.start, end: item.end } })),
    ...files.map(link => ({ start: link.start, end: link.end, link: { ...link, kind: 'file' as const } })),
  ].sort((a, b) => a.start - b.start)
  let cursor = 0
  for (const mark of marks) {
    if (mark.start < cursor) continue
    if (mark.start > cursor) segments.push(textSegment(line.slice(cursor, mark.start)))
    segments.push({ kind: 'link', text: line.slice(mark.start, mark.end), link: mark.link })
    cursor = mark.end
  }
  if (cursor < line.length) segments.push(textSegment(line.slice(cursor)))
  return segments.length ? segments : [textSegment(line)]
}

function textSegment(text: string): TestOutputSegment {
  const exception = classifyJavaException(text)
  return exception
    ? { kind: 'exception', text, simpleName: exception.simpleName }
    : { kind: 'text', text }
}

/** 整段失败详情 → 片段表（`CompositeFilter` 的等价物：一串过滤器按顺序跑完）。 */
export function filterTestOutput(lines: readonly string[], root = ''): TestOutputSegment[] {
  return lines.flatMap(line => filterTestOutputLine(line, root))
}
