// 行内补全的**悬浮操作条**判据（上游 `…/inline/completion/tooltip/` 一族，2026-10-06 逐文件核过）：
//   · 触发只有右键：`InlineCompletionTooltipProvokerMouseListener.kt:40`（`MouseEvent.BUTTON3`），
//     且必须有正在显示的建议（`:43-46`）、事件没被消费过（`:37`）；
//   · 内容只有「接受快捷键 + to complete + provider 自己那一份」：`InlineCompletionTooltipComponent.kt:15-27`；
//     本仓没有可核实的 provider 名 ⇒ 那一格不渲染（见 `src/inlineCompletionTooltip.ts` 文件头）；
//   · 文案 = `IdeBundle.properties:3234` 的 `to complete`（直译「以补全」）。
// 键位行来自**本仓真实的绑定表**（`src/inlineCompletionExtension.ts` 的 `inlineCompletionBindings`），
// 不是抄上游那四个候选（Tab/→/Enter/Shift→ 里只有 Tab 在本仓真的能接受建议）。

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  INLINE_TOOLTIP_ACCEPT_DESCRIPTION, INLINE_TOOLTIP_GAP_PX,
  buildInlineTooltipElement, inlineCompletionTooltipText, inlineTooltipEntries, inlineTooltipTop,
  isInlineTooltipProvoker,
} from '../src/inlineCompletionTooltip.ts'
import { inlineCompletionBindings } from '../src/inlineCompletionExtension.ts'

test('触发判据：只有右键、只有有建议时、只有没被消费的事件', () => {
  assert.equal(isInlineTooltipProvoker(2, true), true, 'BUTTON3 + 有建议')
  assert.equal(isInlineTooltipProvoker(0, true), false, '左键不是上游的 provoker（:40）')
  assert.equal(isInlineTooltipProvoker(1, true), false, '中键同理')
  assert.equal(isInlineTooltipProvoker(2, false), false, '没有正在显示的建议 ⇒ 不弹（:43-46）')
  assert.equal(isInlineTooltipProvoker(2, true, true), false, '已被消费 ⇒ 让给别人（:37）')
})

test('浮层行来自本仓真实绑定表：只有整段接受那一条', () => {
  const rows = inlineTooltipEntries(inlineCompletionBindings)
  assert.deepEqual(rows, [{ keys: 'Tab', text: INLINE_TOOLTIP_ACCEPT_DESCRIPTION }],
    '上游这一格列的是插入快捷键（InlineCompletionTooltipActions.kt:34-47），收起与部分接受都不在其中')
  // 绑定表的 role 标记必须一一对上，否则上面那条就成了自说自话。
  assert.deepEqual(inlineCompletionBindings.map(binding => binding.role),
    ['accept', 'dismiss', 'accept-word', 'accept-line'])
  assert.equal(new Set(inlineCompletionBindings.map(binding => binding.role)).size, 4, 'role 不能重复')
})

test('无障碍文本与上游文案：Tab 以补全', () => {
  assert.equal(INLINE_TOOLTIP_ACCEPT_DESCRIPTION, '以补全', '直译 IdeBundle.properties:3234 的 to complete')
  assert.equal(inlineCompletionTooltipText([{ keys: 'Tab', text: '以补全' }]), 'Tab 以补全')
  assert.equal(inlineCompletionTooltipText([]), '')
})

test('落点：默认锚点上方再减一个自身高度（InlineCompletionTooltip.kt:68-73），放不下才落下面', () => {
  const anchor = { top: 200, bottom: 216, left: 40 }
  assert.equal(inlineTooltipTop(anchor, 24), 200 - INLINE_TOOLTIP_GAP_PX - 24, '上方 = top - 8 - 高度')
  assert.equal(inlineTooltipTop({ top: 10, bottom: 26, left: 40 }, 24), 26 + INLINE_TOOLTIP_GAP_PX,
    '上方放不下 ⇒ 落回锚点下面')
  assert.equal(inlineTooltipTop({ top: 10, bottom: 26, left: 40 }, 24, 0, 40), 40 - 24,
    '下面也放不下（给了视口底）⇒ 钳在视口里，不跑出屏幕')
  assert.equal(INLINE_TOOLTIP_GAP_PX, 8, '间距 = 上游的 JBUIScale.scale(8)')
})

test('DOM 形状：一行浮层 = 键名 + 说明，样式只走 tokens（不写死颜色）', () => {
  const created = []
  const makeElement = tag => {
    const element = {
      tag, className: '', textContent: '', attributes: {}, children: [], style: { cssText: '' },
      setAttribute(name, value) { this.attributes[name] = value },
      appendChild(child) { this.children.push(child); return child },
    }
    created.push(element)
    return element
  }
  const doc = { createElement: makeElement }
  const panel = buildInlineTooltipElement(doc, [{ keys: 'Tab', text: INLINE_TOOLTIP_ACCEPT_DESCRIPTION }])
  assert.equal(panel.tag, 'div')
  assert.equal(panel.className, 'tc-inline-tooltip')
  assert.equal(panel.attributes.role, 'tooltip')
  assert.equal(panel.attributes['aria-label'], 'Tab 以补全')
  assert.deepEqual(panel.children.map(child => child.className), ['tc-inline-tooltip-keys', 'tc-inline-tooltip-text'])
  assert.deepEqual(panel.children.map(child => child.textContent), ['Tab', '以补全'])
  const css = [panel.style.cssText, ...panel.children.map(child => child.style.cssText)].join(';')
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(css), `样式里有裸十六进制：${css}`)
  assert.match(css, /var\(--popup-border\)/, '描边走浮层令牌')
  assert.match(css, /var\(--completion-background\)/, '底色与补全弹层同档')
  assert.ok(!/transition|animation/.test(css), '不自加动效')
  assert.equal(created.length, 3, '一个容器 + 两段文本')
})

test('接线：右键挂点与三处收起都在编辑器扩展里（宿主不需要改）', () => {
  const extension = readFileSync(new URL('../src/inlineCompletionExtension.ts', import.meta.url), 'utf8')
  assert.match(extension, /from '\.\/inlineCompletionTooltip\.ts'/)
  assert.match(extension, /addEventListener\('contextmenu'/)
  assert.match(extension, /isInlineTooltipProvoker\(event\.button/)
  assert.match(extension, /toggleInlineCompletionTooltip\(view, span\.getBoundingClientRect\(\)/)
  assert.equal((extension.match(/hideInlineCompletionTooltip\(editor\)/g) ?? []).length, 3,
    '接受 / Esc 收起 / 部分接受 三处都要收掉浮层')
})
