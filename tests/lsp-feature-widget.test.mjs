// `ls/features` + `ls/session` 的状态面判据（`src/lsFeaturesWidget.ts`）。
//
// 上游依据（逐条）：
//   · `platform/lsp-impl/src/impl/lsWidget/LspWidgetItemsProvider.kt:15-26` —— 汇总条目 +
//     `serverStateChanged` 驱动刷新；
//   · `platform/lsp/src/api/lsWidget/LspClientWidgetItem.kt:41-71` —— tooltip / isError /
//     runningState / widgetActionLocation / widgetActionText；
//   · 同文件 `:115-127` —— 停止/重启动作的那张表；`:129-133` —— 异常停机才给「看错误输出」；
//   · `platform/lang-api/.../LanguageServiceWidgetItem.kt:49`、`:88-91` —— 两个枚举；
//   · `platform/lang-api/resources/messages/LangBundle.properties:604-612` 与
//     `platform/lsp/resources/messages/LspBundle.properties:26-27` —— 文案（中文包取值）。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ITEM_INITIALIZING, ITEM_TERMINATED, LANGUAGE_SERVICES_TITLE, NO_SERVICES,
  RESTART_ACTION, STOP_ACTION,
  featureStillUsable, knownLspLanguages, lspClientWidgetItem, lspRunningState,
  lspStateTransitionAllowed, lspStopOrRestart, lspWidgetActionText, lspWidgetItems,
  lspWidgetLine, lspWidgetSection, lspWidgetTooltip, localFallbackKinds,
  shouldRestartLspLanguage,
} from '../src/lsFeaturesWidget.ts'
import { LSP_FEATURES } from '../src/lspFeatureMatrix.ts'

/** @param {string} language @param {string} state */
function facts(language, state) {
  return {
    language,
    presentableName: language === 'java' ? 'Java' : 'TypeScript',
    state,
    roots: [],
    supportsFile: path => path.endsWith(language === 'java' ? '.java' : '.ts'),
    error: null,
  }
}

const content = { isInContent: path => !path.startsWith('..') }

test('runningState 四分支（LanguageServiceItemRunningState，其余全落 notRunning）', () => {
  assert.equal(lspRunningState('running'), 'running')
  assert.equal(lspRunningState('initializing'), 'initializing')
  assert.equal(lspRunningState('shutdownUnexpectedly'), 'notRunning')
  assert.equal(lspRunningState('unconfigured'), 'notRunning', '上游那一格是「没有客户端对象」')
  assert.equal(lspRunningState(undefined), 'notRunning')
})

test('动作文案逐字照上游中文包；Running 那一支没有后缀（LspClientWidgetItem.kt:65-71）', () => {
  assert.equal(lspWidgetActionText('running', 'Java'), 'Java')
  assert.equal(lspWidgetActionText('initializing', 'Java'), 'Java | 正在初始化…')
  assert.equal(lspWidgetActionText('shutdownUnexpectedly', 'Java'), 'Java | 已终止')
  assert.equal(ITEM_INITIALIZING, '{0} | 正在初始化…')
  assert.equal(ITEM_TERMINATED, '{0} | 已终止')
})

test('归位三道闸：认领文件 + root 覆盖 + 在工程内容里（LspClientWidgetItem.kt:55-63）', () => {
  const java = facts('java', 'running')
  assert.equal(lspWidgetSection(java, content, 'src/Main.java'), 'forCurrentFile')
  assert.equal(lspWidgetSection(java, content, 'src/Main.ts'), 'other', 'descriptor 不支持这个扩展名')
  assert.equal(lspWidgetSection(java, content, null), 'other', '没有当前文件')
  assert.equal(lspWidgetSection(java, content, '../outside/Main.java'), 'other', '不在工程内容里')

  const scoped = { ...java, roots: ['src/main'] }
  assert.equal(lspWidgetSection(scoped, content, 'src/main/java/A.java'), 'forCurrentFile')
  assert.equal(lspWidgetSection(scoped, content, 'src/test/java/A.java'), 'other', 'root 没覆盖')
})

test('停止/重启那张表（LspClientWidgetItem.kt:115-127）', () => {
  assert.equal(lspStopOrRestart('forCurrentFile', 'running'), 'restart', '为当前文件点的 ⇒ 一律重启')
  assert.equal(lspStopOrRestart('forCurrentFile', 'unconfigured'), 'restart')
  assert.equal(lspStopOrRestart('other', 'running'), 'stop')
  assert.equal(lspStopOrRestart('other', 'initializing'), 'stop')
  assert.equal(lspStopOrRestart('other', 'shutdownUnexpectedly'), 'restart')
  assert.equal(lspStopOrRestart('other', 'unconfigured'), null, '没有服务器可停')
  assert.equal(RESTART_ACTION, '重启服务器')
  assert.equal(STOP_ACTION, '根据需要停止并自动运行服务器')
})

test('条目：异常停机才打错误标记、才给「看错误输出」（:46、:129-133）', () => {
  const dead = lspClientWidgetItem({ ...facts('java', 'shutdownUnexpectedly'), error: { message: '进程已退出' } })
  assert.equal(dead.isError, true)
  assert.equal(dead.showErrorOutput, true)
  assert.equal(dead.error, '进程已退出')
  assert.equal(dead.actionText, 'Java | 已终止')

  const live = lspClientWidgetItem(facts('java', 'running'))
  assert.equal(live.isError, false)
  assert.equal(live.showErrorOutput, false)
  assert.equal(live.tooltip, 'Java', 'statusBarTooltip = presentableName + versionPostfix（后者恒空）')
})

test('汇总：一行摘要；一台都没有时给「无服务」（LangBundle.properties:609）', () => {
  const items = lspWidgetItems([
    { language: 'java', facts: facts('java', 'running') },
    { language: 'typescript', facts: facts('typescript', 'initializing') },
  ])
  assert.equal(lspWidgetLine(items), 'Java; TypeScript | 正在初始化…')
  assert.equal(lspWidgetLine([]), NO_SERVICES)
  assert.equal(lspWidgetTooltip(items), 'Java\nTypeScript')
  assert.equal(LANGUAGE_SERVICES_TITLE, '语言服务')
})

test('能力降级表合流：localFallbackKinds 是 LSP_FEATURES 里 local 档的 kind 子集', () => {
  const fallbacks = localFallbackKinds()
  assert.ok(fallbacks.length > 0, '本仓总有本地回退项')
  const legal = new Set(LSP_FEATURES.filter(row => row.fallback === 'local').map(row => row.kind))
  for (const kind of fallbacks) assert.ok(legal.has(kind), `${kind} 不在降级表的 local 档里`)
  assert.equal(featureStillUsable('foldingRange'), true)
  assert.equal(featureStillUsable('definition'), false)
})

test('停机是终态，重启要走新一轮（转出 LspClientImpl.kt:83-84 与 lspCompletionStartup 那条链）', () => {
  assert.equal(shouldRestartLspLanguage('shutdownUnexpectedly'), true)
  assert.equal(shouldRestartLspLanguage('running'), false)
  assert.equal(shouldRestartLspLanguage('unconfigured'), false)
  assert.equal(lspStateTransitionAllowed('shutdownUnexpectedly', 'running'), false)
  assert.equal(knownLspLanguages().length >= 0, true)
})
