// dm/quickfix 的判据（三）：本地意图开关（上游 `IntentionManager` 的启用/停用面）。
// 落点：`src/intentionSettings.ts` 的清单与开关 + 两个消费点（Alt+Enter 与问题面板行菜单）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  LOCAL_INTENTIONS, intentionEntries, intentionSettings, isIntentionEnabled, resetIntentionSettings,
  setAllIntentionsEnabled, setIntentionEnabled,
} from '../src/intentionSettings.ts'
import { suppressOptionsFor } from '../src/suppressIntention.ts'
import { suppressionActionsFor } from '../src/localIntentions.ts'

const root = new URL('..', import.meta.url)
const read = path => readFileSync(new URL(path, root), 'utf8')

test('清单覆盖规则表的所有 id：每个语言档产出的抑制形态都有开关', () => {
  const languages = ['java', 'typescript', 'javascript', 'python', 'cpp', 'go', '']
  const produced = new Set()
  for (const language of languages) for (const option of suppressOptionsFor({ line: 0, source: 'eslint', code: 'no-console' }, language)) produced.add(option.id)
  const catalog = new Set(LOCAL_INTENTIONS.map(entry => entry.id))
  assert.deepEqual([...produced].filter(id => !catalog.has(id)), [], '规则表里有清单没有的 id')
  assert.ok(catalog.size >= produced.size)
})

test('总开关与单条开关；恢复默认', () => {
  resetIntentionSettings()
  assert.equal(isIntentionEnabled('ts-ignore'), true)
  setIntentionEnabled('ts-ignore', false)
  assert.equal(isIntentionEnabled('ts-ignore'), false)
  assert.equal(isIntentionEnabled('noqa'), true)
  setAllIntentionsEnabled(false)
  assert.equal(isIntentionEnabled('noqa'), false, '总开关关掉后单条也停用')
  assert.deepEqual(intentionEntries().find(entry => entry.id === 'noqa').enabled, false)
  resetIntentionSettings()
  assert.deepEqual(intentionSettings.value, { enabled: true, disabled: [] })
})

test('停用的意图不进 Alt+Enter 条目（suppressionActionsFor 的 enabled 过滤）', () => {
  const input = {
    path: '/x.ts', text: 'console.log(1)\n',
    diagnostics: [{ line: 0, character: 0, severity: 2, message: 'x (no-console)', source: 'eslint' }],
    enabled: (id) => id !== 'ts-ignore',
  }
  const actions = suppressionActionsFor(input)
  assert.deepEqual(actions.map(action => action.title), ['抑制本条（// eslint-disable-next-line no-console）'])
  assert.equal(suppressionActionsFor({ ...input, enabled: () => false }).length, 0, '全部停用 ⇒ 不出本地条目')
  assert.equal(suppressionActionsFor({ ...input, enabled: undefined }).length, 2, '不传 = 全启用（老口径）')
})

test('消费链：Alt+Enter 与面板行菜单都读同一份开关', () => {
  const semantic = read('src/semanticActions.ts')
  assert.match(semantic, /isIntentionEnabled/)
  assert.match(semantic, /enabled: isIntentionEnabled/)
  const panel = read('src/components/ProblemsPanel.vue')
  assert.match(panel, /intentionEntries/)
  assert.match(panel, /setIntentionEnabled/)
  assert.match(panel, /setAllIntentionsEnabled/)
})
