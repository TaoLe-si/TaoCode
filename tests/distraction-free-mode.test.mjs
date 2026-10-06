// `src/distractionFreeMode.ts`：IDEA 的专注模式（ToggleDistractionFreeMode）。
//
// 重点测**双向语义**（`ToggleDistractionFreeModeAction.applyAndSave:93-124`）：
//   · 进入：用户当前值 → BEFORE；设置 ← 专注值（AFTER 里没有时用默认值 = 隐藏）
//   · 退出：**专注模式下的值** → AFTER（用户可能在里头调过，那是他的选择）；设置 ← 从 BEFORE 恢复
// 把它简化成"记一份、恢复一份"就会丢掉"用户在专注模式里改过的值下次仍生效"这半条行为。

import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const { DISTRACTION_FREE_KEYS, DISTRACTION_FREE_VALUES, describeDistractionFree,
  distractionFreeSettings, rememberAdjustments, restoredSettings, snapshotSettings } =
  await import('../src/distractionFreeMode.ts')

/** 一份"用户自己的设置"：全开（默认），用来验证进入专注模式会把它全关掉。 */
const userSettings = Object.fromEntries(DISTRACTION_FREE_KEYS.map(key => [key, true]))

test('映射的 8 项与 IDEA 的 applyAndSave 一一对应（TaoCode 真正有的 UI 元素）', () => {
  // 上游 15 项（`ToggleDistractionFreeModeAction.java:101-119`）里本仓有设置键、且有消费方的那 8 项。
  // 订正（2026-10-06 · edinput3）：这一条原先只钉 6 项，理由是模块头写「gutter 图标 / 工具窗口条
  // 本仓没有对应设置」—— 那句话是错的（两项键、界面、消费方都在，见下面那条「每个键都要有消费方」），
  // 所以按上游 `:111` ARE_GUTTER_ICONS_SHOWN 与 `:118` HIDE_TOOL_STRIPES 补齐，断言由 6 项变 8 项（更严）。
  assert.deepEqual([...DISTRACTION_FREE_KEYS],
    ['showStatusBar', 'lineNumbers', 'showWhitespaces', 'showIndentGuides', 'showBreadcrumbs', 'rightMargin',
      'showGutterIcons', 'showToolWindowBars'])
  // 专注模式的值全是"隐藏"。
  for (const key of DISTRACTION_FREE_KEYS) assert.equal(DISTRACTION_FREE_VALUES[key], false, key)
})

test('每个映射的键都有真实消费方（不许把没有链路的上游项塞进专注模式）', () => {
  // 上游 `applyAndSave` 的 15 项里有 7 项本仓没有对应 UI（主工具栏、新主工具栏、折叠大纲×2、
  // 方法分隔线、标签位置×2）⇒ 它们**不该**出现在键表里；反过来进来的每一项都必须有人读。
  const consumers = {
    showStatusBar: '../src/App.vue',
    lineNumbers: '../src/components/CodeEditor.vue',
    showWhitespaces: '../src/components/CodeEditor.vue',
    showIndentGuides: '../src/components/CodeEditor.vue',
    showBreadcrumbs: '../src/App.vue',
    rightMargin: '../src/components/CodeEditor.vue',
    // 这两条是本批补进来的：上游 `applyAndSave:111`/`:118`，消费方分别是装订线图标宿主与外观动作里
    // 那条 `data-tool-stripes` 的 watch。
    showGutterIcons: '../src/gutterIconHost.ts',
    showToolWindowBars: '../src/appearanceActions.ts',
  }
  for (const key of DISTRACTION_FREE_KEYS) {
    assert.ok(consumers[key], `${key} 没有登记消费方 ⇒ 专注模式会写一个没人读的键`)
    assert.ok(readFileSync(new URL(consumers[key], import.meta.url), 'utf8').includes(key),
      `${key} 登记的消费方 ${consumers[key]} 里读不到这个键`)
  }
})

test('快照抄的是用户当前值', () => {
  assert.deepEqual(snapshotSettings(userSettings), {
    showStatusBar: true, lineNumbers: true, showWhitespaces: true,
    showIndentGuides: true, showBreadcrumbs: true, rightMargin: true,
    showGutterIcons: true, showToolWindowBars: true,
  })
})

test('第一次进专注模式：全部隐藏', () => {
  const values = distractionFreeSettings({})
  for (const key of DISTRACTION_FREE_KEYS) assert.equal(values[key], false, key)
})

test('用户在专注模式里调过的值，下次进专注模式要沿用（AFTER）', () => {
  // 用户在专注模式里把行号打开了 —— 那是他的选择，不是"专注模式该有的默认值"。
  const values = distractionFreeSettings({ lineNumbers: true })
  assert.equal(values.lineNumbers, true, '沿用 AFTER 里的用户选择')
  assert.equal(values.showStatusBar, false, '没调过的仍然用默认')
})

test('退出时只记住"和默认不同"的调整', () => {
  const remembered = rememberAdjustments({ lineNumbers: true, showStatusBar: false })
  assert.deepEqual(remembered, { lineNumbers: true }, 'showStatusBar 等于默认值，不必记')
  assert.deepEqual(rememberAdjustments({}), {})
})

test('退出时恢复进之前的值；快照丢了就用当前值兜底（不写 undefined 进设置）', () => {
  const before = { showStatusBar: true, lineNumbers: false, showWhitespaces: true }
  const restored = restoredSettings(before, userSettings)
  assert.equal(restored.showStatusBar, true, '从快照恢复')
  assert.equal(restored.lineNumbers, false, '快照里明确是 false 也要恢复成 false（不能当"没值"）')
  assert.equal(restored.rightMargin, true, '快照里没有的键用当前值兜底')
  assert.deepEqual(restoredSettings(undefined, userSettings), {
    showStatusBar: true, lineNumbers: true, showWhitespaces: true,
    showIndentGuides: true, showBreadcrumbs: true, rightMargin: true,
    showGutterIcons: true, showToolWindowBars: true,
  })
})

test('完整往返：进入 → 用户调整 → 退出，三步都不丢信息', () => {
  // 1) 用户的原始设置（行号关着、状态栏开着 —— 故意与默认值不同）
  const original = { ...userSettings, lineNumbers: false }
  const before = snapshotSettings(original)

  // 2) 进入专注模式：全隐藏
  const entered = distractionFreeSettings({})
  for (const key of DISTRACTION_FREE_KEYS) assert.equal(entered[key], false, key)

  // 3) 用户在专注模式里打开了行号
  const after = rememberAdjustments({ ...entered, lineNumbers: true })
  assert.deepEqual(after, { lineNumbers: true })

  // 4) 退出：恢复原始值（行号回到 false —— 用户原本就是关的）
  const restored = restoredSettings(before, original)
  assert.equal(restored.lineNumbers, false, '恢复的是"进之前的值"，不是"专注模式下改的"')
  assert.equal(restored.showStatusBar, true)

  // 5) 再进一次：行号沿用"上次在专注模式里的选择"（true）
  assert.equal(distractionFreeSettings(after).lineNumbers, true)
})

test('菜单标题随状态变', () => {
  assert.equal(describeDistractionFree(true), '退出专注模式')
  assert.equal(describeDistractionFree(false), '进入专注模式')
})
