// 运行/构建输出里的问题定位 —— 从 App.vue 搬出的一域（20 行，5 个依赖）。
//
// 判据：IDEA 的 BuildView / RunContentDescriptor 把控制台输出折成"带问题的行"，
// 点它跳到源位置；TaoCode 的对应物是这一组：
//   · `parseRunIssue` 按项目根解析 `路径:行:列: 说明`（规则在 src/buildOutput.ts，`RunIssue` 也从那里来）；
//   · `runLines` 再按 `Console` 设置折叠连续重复行（`foldConsoleLines` —— IDEA 的
//     ConsoleConfigurable 两项：要折叠的行 / 例外）；
//     折叠之前先过 **ANSI 解码**（`src/consoleAnsi.ts`）：上游的 Java 运行输出走
//     `ColoredProcessHandler`（`java/execution/openapi/src/com/intellij/execution/configurations/JavaCommandLineStateUtil.java:17-21`），
//     带色码的输出在控制台里是**有色的**，本仓宿主只回传原始字节，所以这里把转义序列剥成
//     可见文本、把样式带在 `chunks` 上给面板上色（问题/链接识别一律用剥完的文本）。
//   · `jumpToIssue` / `nextRunIssue` = 控制台侧的"跳到问题".
// 它们共享同一份派生结果（`runLines`），所以合成一域；真正的运行控制在 src/runActions.ts。
import { computed, watch } from 'vue'
import { runState, type GeneralSettingsState } from './bridge.ts'
import { createConsoleAnsiDecoder } from './consoleAnsi.ts'
import { foldConsoleLines } from './consoleFold.ts'
import { findRunHyperlinks, type RunHyperlink } from './runHyperlinks.ts'
import { parseAnyIssue, type RunIssue } from './buildOutput.ts'
import { applyConsoleFilters } from './consoleFilterProviders.ts'
import { applyConsoleFoldings } from './executionExtensionPoints.ts'

export interface RunIssuesDeps {
  /** 控制台已累积的输出（宿主是 reactive 数组，`join('')` 后按行切）。 */
  runOutput: readonly string[]
  workspace: { readonly value: { root: string } | null }
  generalSettings: { readonly value: GeneralSettingsState }
  /** 跳到问题所在位置。 */
  revealLocation: (target: { path: string; line: number }) => unknown
  notify: (message: string, error?: boolean) => void
}

export function createRunIssues(deps: RunIssuesDeps) {
  const { runOutput, workspace, generalSettings, revealLocation, notify } = deps
function parseRunIssue(text: string): RunIssue | null {
  return parseAnyIssue(text, workspace.value?.root ?? '')
}
// 运行面板的行 = 原始输出按行切分，再按 Console 设置（折叠行/例外）折叠连续重复行。
// 每行同时收集**全部** `file:line` 链接（`findRunHyperlinks`，上游 MultipleFilesHyperlinkInfo
// 的等价物）与首个可跳转问题（编译器诊断的 `file(line,col)` 形态仍由 parseAnyIssue 认）。
const runLines = computed(() => foldConsoleLines(
  // 插件贡献的控制台折叠（上游 `com.intellij.console.folding` / `ConsoleFolding`）先按
  // `shouldFoldLine` 把该折的行折进上一行（`applyConsoleFoldings`），再走设置里那两个列表的
  // 连续重复行折叠。没有插件折叠贡献时 `applyConsoleFoldings` 原样返回 ⇒ 行为与之前逐字相同。
  applyConsoleFoldings((() => {
    // 一台状态机按行喂（上游 `AnsiEscapeDecoder` 的 per-stream emulator 同一件事：颜色跨行延续，
    // 直到 `ESC[0m` 或流结束）。每次重算都新建一台 —— 与「从输出开头重放一遍」等价。
    const ansi = createConsoleAnsiDecoder()
    return runOutput.join('').split('\n').map(raw => {
      const { text, chunks } = ansi.line(raw)
      const links = findRunHyperlinks(text, workspace.value?.root ?? '')
      const first: RunHyperlink | undefined = links[0]
      // 插件贡献的控制台过滤器（上游 `com.intellij.consoleFilterProvider`）——**追加**在内置识别之后：
      // 没有插件时这里是空数组，行为与之前逐字相同（判据 tests/console-filter-providers.test.mjs）。
      const pluginHit = applyConsoleFilters(text, workspace.value?.root ?? '')[0]
      return {
        text,
        issue: parseRunIssue(text) ?? (first ? { path: first.path, line: first.line, column: first.column } : null)
          ?? (pluginHit ? { path: pluginHit.path, line: pluginHit.line, column: pluginHit.column ?? 1 } : null),
        links,
        // 没有任何样式的行**不带这个字段** ⇒ 面板渲染路径与本轮之前逐字相同（判据钉住）。
        ...(chunks.length > 0 ? { chunks } : {}),
      }
    })
  })(), workspace.value?.root ?? null),
  generalSettings.value.foldConsoleLines,
  generalSettings.value.foldExceptions,
  2000))
const runIssueList = computed(() => runLines.value.filter(line => line.issue).map(line => line.issue!))
const runIssueCount = computed(() => runIssueList.value.length)
let runIssueCursor = 0
watch(() => runState.running, value => { if (value) runIssueCursor = 0 })
function jumpToIssue(issue: RunIssue) { void revealLocation({ path: issue.path, line: Math.max(0, issue.line - 1) }) }
function nextRunIssue() {
  const issues = runIssueList.value
  if (!issues.length) { notify('输出里没有可跳转的问题。', true); return }
  jumpToIssue(issues[runIssueCursor % issues.length])
  runIssueCursor++
}
  return { parseRunIssue, runLines, runIssueList, runIssueCount, jumpToIssue, nextRunIssue }
}
