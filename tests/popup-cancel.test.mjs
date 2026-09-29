// 弹层「取消键」两段式的判据（IDEA `AbstractPopup.dispatchKeyEvent`）。
//
// 上游 `platform/platform-impl/src/com/intellij/ui/popup/AbstractPopup.java:2995-3012`：
//   `isCloseRequest(e) && myCancelKeyEnabled && !mySpeedSearch.isHoldingFilter()` 时才处理 ——
//   速度搜索**有字**先 `reset()`（弹层留着），**没字**才 `cancel(e)`。
// `isCloseRequest`（`:3022-3027`）取 keymap 的 `IdeActions.ACTION_EDITOR_ESCAPE`。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { popupCancelKeyAction } from '../src/popupCancel.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

test('过滤器有字时先清它，弹层不关（上游 :3003-3009 的第一支）', () => {
  assert.equal(popupCancelKeyAction('ab'), 'reset-filter')
})

test('过滤器空着才关（上游第二支 cancel(e)）', () => {
  assert.equal(popupCancelKeyAction(''), 'close')
  // 上游判的是"框里有内容"；纯空白不算 —— 与速度搜索自己的空串语义一致。
  assert.equal(popupCancelKeyAction('   '), 'close')
})

test('接线：两个带速度搜索的弹层都按两段式处理 Esc', () => {
  for (const file of ['src/components/SelectInPopup.vue', 'src/components/BranchPopup.vue']) {
    const vue = read(file)
    assert.match(vue, /popupCancelKeyAction\(/, `${file} 没走这条规则`)
    assert.match(vue, /=== 'reset-filter'/, `${file} 少了"先清过滤器"那一支`)
    assert.match(vue, /import \{ popupCancelKeyAction \} from '\.\.\/popupCancel'/, `${file} 没引入规则模块`)
    // 清过滤器要顺手把选中位复位（上游 reset() 之后列表回到全量）。
    assert.match(vue, /\.value = ''/, `${file} 没真的清掉过滤器`)
  }
})

test('回归：不能只留"直接关"那一支（那正是这次修的缺陷）', () => {
  for (const file of ['src/components/SelectInPopup.vue', 'src/components/BranchPopup.vue']) {
    const line = read(file).split('\n').find(text => text.includes("event.key === 'Escape'")) ?? ''
    assert.doesNotMatch(line, /emit\('close'\)\s*\}/, `${file} 的 Esc 又变回"一句话关掉"`)
  }
})
