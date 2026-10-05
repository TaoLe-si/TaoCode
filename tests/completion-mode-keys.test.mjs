// lp/completion 的判据：**三条补全键位真的落到编辑器上**。
//
// 上游三条（`platform/platform-resources/src/keymaps/$default.xml`）：
//   · `CodeCompletion` = Ctrl+Space —— `:732-734`
//   · `SmartTypeCompletion` = Ctrl+Shift+Space —— `:909-911`
//   · `ClassNameCompletion` = Ctrl+Alt+Space —— `:843-845`
// 动作类分别是 `codeInsight/completion/actions/CodeCompletionAction.java:12-17`（BASIC）、
// `SmartCodeCompletionAction.java:11-17`（SMART）、`ClassNameCompletionAction.java:11-17`
// （BASIC + 第二次调用，`CompletionParameters.java:113-115` 的 `isExtendedCompletion()`）。
// 「同一个键再按一次把 `invocationCount` 加一、弹层关掉就是新一轮」出自
// `CodeCompletionHandlerBase.java:210-213`。
//
// 这一族以前只有 **一条** 键位接了（`completionUi.ts` 的 `isBasicCompletionKey` +
// `handleBasicCompletionKey` 只认裸 Ctrl+Space），`completionModes.ts` 那套模式模型
// （`completionModeForEvent` / `beginCompletion` / `endCompletion`）**零调用方**
// ⇒ Smart 与类名两档"模型齐了、按不出来"，`keepsInMode(..., invocationCount >= 2)` 的放宽也永不生效。
// 现在三条都由 `handleCompletionModeKey` 接，模式与计数写进 `completionModes.ts` 那份按编辑器存的状态。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { beginCompletion, completionModeForEvent, currentCompletion, endCompletion } from '../src/completionModes.ts'

const key = (over = {}) => ({ key: ' ', code: 'Space', ctrlKey: true, altKey: false, metaKey: false, shiftKey: false, ...over })

test('三条键位各归一档，且互不冒充', () => {
  assert.equal(completionModeForEvent(key()), 'basic', 'Ctrl+Space = CodeCompletion')
  assert.equal(completionModeForEvent(key({ shiftKey: true })), 'smart', 'Ctrl+Shift+Space = SmartTypeCompletion')
  assert.equal(completionModeForEvent(key({ altKey: true })), 'className', 'Ctrl+Alt+Space = ClassNameCompletion')
  assert.equal(completionModeForEvent(key({ shiftKey: true, altKey: true })), null, '两条一起按不是上游的任何一条')
  assert.equal(completionModeForEvent(key({ ctrlKey: false, metaKey: true })), null, 'Mac 的 Cmd+Space 不是补全')
  assert.equal(completionModeForEvent({ ...key(), keyCode: 229 }), null, '输入法合成中的 229 不算')
  assert.equal(completionModeForEvent({ ...key(), key: 'Process' }), null, '合成码 Process 不算')
  assert.equal(completionModeForEvent({ ...key(), isComposing: true }), null, '合成中不算')
  assert.equal(completionModeForEvent({ ...key(), defaultPrevented: true }), null, '已被别人消费的不接')
  assert.equal(completionModeForEvent(key({ code: 'KeyA', key: 'a' })), null, '非空格不算')
})

test('同一个模式再按才递增调用次数；换模式就是新的一轮', () => {
  const view = {}
  assert.deepEqual(currentCompletion(view), { mode: 'basic', invocationCount: 1 }, '没按过就是 BASIC 第 1 次')
  assert.deepEqual(beginCompletion(view, 'smart'), { mode: 'smart', invocationCount: 1 })
  assert.deepEqual(beginCompletion(view, 'smart'), { mode: 'smart', invocationCount: 2 }, '上游 :210-213 的 repeated')
  assert.deepEqual(beginCompletion(view, 'basic'), { mode: 'basic', invocationCount: 1 }, '换键 ⇒ 重新起算')
  endCompletion(view)
  assert.deepEqual(currentCompletion(view), { mode: 'basic', invocationCount: 1 }, '弹层关掉 = 状态作废')
})

test('放宽档真的接在查询上：第 2 次调用不再过滤（keepsInMode 的 invocationCount 参数）', async () => {
  const { keepsInMode } = await import('../src/completionModes.ts')
  assert.equal(keepsInMode('className', { kind: 'method', label: 'doIt' }, 1), false, '类名档第 1 次只留类型类')
  assert.equal(keepsInMode('className', { kind: 'method', label: 'doIt' }, 2), true, '再按一次放宽回全部')
})

test('接线：三条键位由 handleCompletionModeKey 一次接齐，模式状态随弹层结束', () => {
  const ui = readFileSync(new URL('../src/completionUi.ts', import.meta.url), 'utf8')
  assert.match(ui, /import \{ beginCompletion, completionModeForEvent, endCompletion, type CompletionMode \} from '\.\/completionModes\.ts'/)
  assert.match(ui, /export function startCompletionAs\(view: EditorView, mode: CompletionMode\)/,
    '键位与菜单共用同一个入口（菜单那一侧见接线请求 W2）')
  assert.match(ui, /return startCompletionAs\(view, 'basic'\)/, 'startBasicCompletion 只是 BASIC 的那一层皮')
  assert.match(ui, /return mode \? startCompletionAs\(view, mode\) : false/)
  assert.match(ui, /keydown: handleCompletionModeKey/, 'basicCompletionKeys 挂的是三条键位那个入口')
  assert.match(ui, /beginCompletion\(view, mode\)/)
  assert.match(ui, /closeCompletion\(view\)/, '弹层开着再按要重查：startCompletion 在开着时是 no-op')
  assert.match(ui, /reopeningViews\.add\(view\)/, '关-开之间那一次更新不能被当成"这一轮结束"')
  assert.match(ui, /endCompletionIfRoundOver\(this\.view\)/, 'ViewPlugin 每次更新都收尾')
  // 旧的那份"只认裸 Ctrl+Space"的入口不许回来：它回来了就等于 Smart / 类名两档又没人接。
  assert.doesNotMatch(ui, /export function isBasicCompletionKey/)
  assert.doesNotMatch(ui, /export function handleBasicCompletionKey/)
  const query = readFileSync(new URL('../src/lspCompletion.ts', import.meta.url), 'utf8')
  assert.match(query, /currentCompletion\(editor\)/, '查询那一侧读的是同一份模式状态')
})
