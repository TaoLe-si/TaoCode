// 控制台过滤器的插件贡献面（上游 `com.intellij.consoleFilterProvider`）+ 与运行面板的接线。
//
// 上游：`platform/lang-api/resources/intellij.platform.lang.xml:142` 声明该 EP；
// 本仓落点 `src/consoleFilterProviders.ts`，消费链 `src/runIssues.ts`（控制台行 → 可跳转问题）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { reactive, ref } from 'vue'

import { CONSOLE_FILTER_PROVIDER_EP, applyConsoleFilters, consoleFilterProviders, registerConsoleFilterProvider } from '../src/consoleFilterProviders.ts'
import { EXTENSIONS } from '../src/extensionPoints.ts'
import { createRunIssues } from '../src/runIssues.ts'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

function makeRunIssues(output) {
  const runOutput = reactive(output)
  const workspace = ref({ root: 'C:/proj' })
  const generalSettings = ref({ foldConsoleLines: [], foldExceptions: [] })
  const notified = []
  const issues = createRunIssues({
    runOutput,
    workspace,
    generalSettings,
    revealLocation: () => undefined,
    notify: message => notified.push(message),
  })
  return { issues, runOutput, notified }
}

test('EP 已声明且默认没有插件 provider', () => {
  assert.equal(CONSOLE_FILTER_PROVIDER_EP, 'com.intellij.consoleFilterProvider')
  assert.ok(EXTENSIONS.hasExtensionPoint(CONSOLE_FILTER_PROVIDER_EP))
  assert.deepEqual(consoleFilterProviders(), [])
})

test('插件 provider 的 filter 命中即收；一个坏 filter 不打断其余', () => {
  const dispose = registerConsoleFilterProvider({
    getDefaultFilters: () => [
      { applyFilter: () => { throw new Error('bad filter') } },
      { applyFilter: text => (text.includes('BOOM') ? { path: 'a.ts', line: 7, column: 2 } : null) },
    ],
  }, 'test.console.filter')
  try {
    const hits = applyConsoleFilters('x BOOM y', 'C:/proj')
    assert.deepEqual(hits, [{ path: 'a.ts', line: 7, column: 2 }])
    assert.deepEqual(applyConsoleFilters('nothing', 'C:/proj'), [])
  } finally { dispose() }
  assert.deepEqual(consoleFilterProviders(), [])
})

test('插件过滤器接进运行面板：无内置识别时由插件命中成为可跳转问题', () => {
  const { issues, runOutput } = makeRunIssues(['plain line\n'])
  assert.equal(issues.runLines.value[0].issue, null, '没有插件时行为不变')
  const dispose = registerConsoleFilterProvider({
    getDefaultFilters: () => [{ applyFilter: text => (text.includes('MAGIC') ? { path: 'magic.ts', line: 5 } : null) }],
  }, 'test.console.filter.magic')
  try {
    runOutput.push('has MAGIC here\n')
    const lines = issues.runLines.value
    assert.deepEqual(lines[1].issue, { path: 'magic.ts', line: 5, column: 1 }, '插件命中成为问题')
    assert.equal(issues.runIssueCount.value, 1)
  } finally { dispose() }
})

test('runIssues 在真实链路上调用 applyConsoleFilters', () => {
  const src = read('src/runIssues.ts')
  assert.match(src, /applyConsoleFilters\(text, workspace\.value\?\.root \?\? ''\)/)
  assert.match(src, /import \{ applyConsoleFilters \} from '\.\/consoleFilterProviders\.ts'/)
})
