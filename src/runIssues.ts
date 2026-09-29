// 运行/构建输出里的问题定位 —— 从 App.vue 搬出的一域（20 行，5 个依赖）。
//
// 判据：IDEA 的 BuildView / RunContentDescriptor 把控制台输出折成"带问题的行"，
// 点它跳到源位置；TaoCode 的对应物是这一组：
//   · `parseRunIssue` 按项目根解析 `路径:行:列: 说明`（规则在 src/buildOutput.ts，`RunIssue` 也从那里来）；
//   · `runLines` 再按 `Console` 设置折叠连续重复行（`foldConsoleLines` —— IDEA 的
//     ConsoleConfigurable 两项：要折叠的行 / 例外）；
//   · `jumpToIssue` / `nextRunIssue` = 控制台侧的"跳到问题".
// 它们共享同一份派生结果（`runLines`），所以合成一域；真正的运行控制在 src/runActions.ts。
import { computed, watch } from 'vue'
import { runState, type GeneralSettingsState } from './bridge'
import { foldConsoleLines } from './consoleFold'
import { parseAnyIssue, type RunIssue } from './buildOutput'

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
const runLines = computed(() => foldConsoleLines(
  runOutput.join('').split('\n').map(text => ({ text, issue: parseRunIssue(text) })),
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
