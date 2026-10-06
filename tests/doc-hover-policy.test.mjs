// 文档面两档开关的判据（`src/docHoverPolicy.ts`）—— 上游那两个 `ToggleAction` 的默认档、
// 设置键名、闸的生效点与「读屏那一半没实现」的差异都钉在这里。
//
// 上游坐标：
//   · `platform/lang-impl/src/com/intellij/codeInsight/documentation/ToggleShowDocsOnHoverAction.java:22/32`
//     读写 `EditorSettingsExternalizable.isShowQuickDocOnMouseOverElement()`；默认档在
//     `platform/ide-core-impl/src/com/intellij/openapi/editor/ex/EditorSettingsExternalizable.java:76` ＝ **开**；
//     闸的生效点 `EditorMouseHoverPopupManager.java:452` 与 `HoverPopupContext.kt:106`；
//     同处还有 `&& !isSupportScreenReaders()`（`EditorSettingsExternalizable.java:838-840`）—— 本仓没有读屏设置面，
//     这一半**如实未实现**（`docHoverDifferenceForScreenReader()` 返回 true 表示「已知差异」，不是「已做」）。
//   · `platform/lang-impl/src/com/intellij/lang/documentation/ide/actions/ToggleAutoUpdateAction.kt:13/17/21`
//     读写 `DocumentationToolWindowManager.autoUpdate`；默认档在
//     `DocumentationToolWindowManager.kt:55`（`by propComponentProperty("documentation.auto.update", true)`）＝ **开**；
//     生效点 `:121`/`:191`/`:219`（判据函数 `shouldRefreshDocPage` 在这里）。

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DOC_AUTO_UPDATE_QUIESCENCE_MS, DOC_HOVER_LABELS, DOC_HOVER_SETTING_KEYS, DEFAULT_DOC_HOVER_POLICY,
  docHoverDifferenceForScreenReader, docHoverPolicy, docHoverPolicyFromSettings, docHoverPolicyPatch,
  shouldAutoUpdateDoc, shouldRefreshDocPage, shouldShowDocOnHover, toggleDocHoverPolicy,
} from '../src/docHoverPolicy.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = (path) => readFileSync(join(root, path), 'utf8')

test('默认档两条都「开」，逐字抄上游而不是挑一个顺手的', () => {
  assert.deepEqual(DEFAULT_DOC_HOVER_POLICY, { showOnMouseMove: true, autoUpdate: true })
  assert.equal(docHoverPolicy.showOnMouseMove, true)
  assert.equal(docHoverPolicy.autoUpdate, true)
})

test('设置里登记的两把键（写回补丁的形状就是这两把）', () => {
  assert.deepEqual(DOC_HOVER_SETTING_KEYS, { showOnMouseMove: 'showQuickDocOnMouseHover', autoUpdate: 'autoUpdateDocumentation' })
  assert.deepEqual(docHoverPolicyPatch(), { showQuickDocOnMouseHover: true, autoUpdateDocumentation: true })
})

test('文案取上游中文包，不自编', () => {
  assert.equal(DOC_HOVER_LABELS.showOnMouseMove, '在鼠标移动时显示')
  assert.equal(DOC_HOVER_LABELS.autoUpdate, '选区更改时自动刷新文档')
})

test('从设置折回运行时值：缺键按上游默认档（开），显式 false 才关，坏值不崩', () => {
  assert.deepEqual(docHoverPolicyFromSettings(undefined), { showOnMouseMove: true, autoUpdate: true })
  assert.deepEqual(docHoverPolicyFromSettings({}), { showOnMouseMove: true, autoUpdate: true })
  assert.deepEqual(docHoverPolicyFromSettings({ showQuickDocOnMouseHover: false }), { showOnMouseMove: false, autoUpdate: true })
  assert.deepEqual(docHoverPolicyFromSettings({ autoUpdateDocumentation: false }), { showOnMouseMove: true, autoUpdate: false })
  assert.deepEqual(docHoverPolicyFromSettings({ showQuickDocOnMouseHover: 'yes' }), { showOnMouseMove: true, autoUpdate: true }, '非布尔值不认成关闭')
  assert.equal(docHoverPolicy.autoUpdate, true, '最后一次调用已经把单例写成 autoUpdate=true')
  docHoverPolicyFromSettings({ showQuickDocOnMouseHover: false, autoUpdateDocumentation: false })
  assert.equal(shouldShowDocOnHover(), false, '闸读的就是那份单例')
  assert.equal(shouldAutoUpdateDoc(), false)
  docHoverPolicyFromSettings({})
})

test('齿轮改一档：翻的是那份单例，返回的是可以交给 saveSettingsPatch 的补丁', () => {
  const before = { ...docHoverPolicy }
  const patch = toggleDocHoverPolicy('showOnMouseMove')
  assert.equal(docHoverPolicy.showOnMouseMove, !before.showOnMouseMove)
  assert.equal(patch[DOC_HOVER_SETTING_KEYS.showOnMouseMove], docHoverPolicy.showOnMouseMove)
  assert.equal(Object.keys(patch).length, 2, '补丁一次给齐两档，省得分两次写把另一档打回默认')
  toggleDocHoverPolicy('showOnMouseMove')
  assert.deepEqual({ ...docHoverPolicy }, before, '翻回去应当与原来完全一致')
})

test('自动更新判据：关了不刷、位置没动不刷、挪了才刷', () => {
  const off = { showOnMouseMove: true, autoUpdate: false }
  assert.equal(shouldRefreshDocPage({ line: 1, character: 2 }, { line: 9, character: 9 }, off), false, 'autoUpdate 关掉就整条不刷（DocumentationToolWindowManager.kt:121/191/219）')
  assert.equal(shouldRefreshDocPage(null, { line: 1, character: 2 }), true, '还没显示过第一页时无条件取一次')
  assert.equal(shouldRefreshDocPage({ line: 1, character: 2 }, { line: 1, character: 2 }), false, '光标没挪不重发')
  assert.equal(shouldRefreshDocPage({ line: 1, character: 2 }, { line: 2, character: 0 }), true)
  assert.equal(shouldRefreshDocPage({ line: 1, character: 2 }, { line: 1, character: 3 }), true)
})

test('去抖那一档是 300ms 且有出处（LOW_PRIORITY_QUIESCENCE_DELAY，不是诊断那档 250ms）', () => {
  assert.equal(DOC_AUTO_UPDATE_QUIESCENCE_MS, 300)
  assert.match(source('src/docHoverPolicy.ts'), /LspHighlightingCache\.kt:264-269/, '去抖的上游出处没有登记')
  assert.match(source('src/docHoverPolicy.ts'), /EditorSettingsExternalizable\.java:76/, '默认档的上游出处没有登记')
  assert.match(source('src/docHoverPolicy.ts'), /DocumentationToolWindowManager\.kt:55/, 'auto.update 默认档的出处没有登记')
})

test('读屏那一半的差异是**已知未实现**，不是当成已实现', () => {
  assert.equal(docHoverDifferenceForScreenReader(), true, '返回 true 表示「这一条差异存在」')
  assert.match(source('src/docHoverPolicy.ts'), /EditorSettingsExternalizable\.java:838-840/)
})

test('接线：两档都有真消费方，没有消费链路的开关不渲染（假控件禁令）', () => {
  const host = source('src/quickDocHost.ts')
  const popup = source('src/components/QuickDocPopup.vue')
  assert.match(host, /shouldRefreshDocPage\(/, '「自动更新」这一档没有消费方')
  assert.match(host, /DOC_AUTO_UPDATE_QUIESCENCE_MS/, '自动更新的去抖档没有被用上')
  assert.match(popup, /DOC_HOVER_LABELS\.autoUpdate/, '弹层齿轮没有「自动更新」那个开关')
  // showOnMouseMove 的生效点在保留文件 CodeEditor.vue 的 hover 通道：它没接上之前
  // `canToggleHover` 缺省为假 ⇒ 那颗按钮**不渲染**，不是一枚勾了没反应的假开关。
  assert.match(popup, /v-if="canToggleHover"/, '没有落点的 hover 开关被无条件渲染了（假控件）')
  assert.match(popup, /emit\('policy-change'/, '齿轮改了没有把补丁交给宿主持久化')
  assert.match(source('src/docHoverContent.ts'), /shouldShowDocOnHover\(\)/, 'hover 那档闸没有被取用面消费')
})

// 判据（本轮新增）：档位问在**去抖之后**，不是只问在排程之前。上游三处读属性的位置都在
// 真正动手那一刻（`DocumentationToolWindowManager.kt:121` 的 `if (!autoUpdate)`、`:191`、`:219`）。
// 少了这一句：弹层开着、光标一动就排下 300ms 的一拍，用户在这 300ms 里把齿轮关掉，
// 那一拍照样会换掉这一页 —— 「我关了，它还是自己翻了」。
test('自动更新：去抖到期时再问一次档位，关掉之后已经排下去的那一拍不再刷新一页', () => {
  const host = source('src/quickDocHost.ts')
  const start = host.indexOf('autoTimer = window.setTimeout(')
  assert.ok(start >= 0, '自动更新那一拍没有走去抖')
  const end = host.indexOf('}, DOC_AUTO_UPDATE_QUIESCENCE_MS)', start)
  assert.ok(end > start, '去抖的时长用的是那个有出处的常量')
  const body = host.slice(start, end)
  assert.match(body, /if \(!shouldAutoUpdateDoc\(\)\)/, '到期时没有再问一次「自动更新」档')
  assert.ok(body.indexOf('shouldAutoUpdateDoc') < body.indexOf('void showAt('), '档位必须问在取文档之前')
  assert.match(source('src/docHoverPolicy.ts'), /export function shouldAutoUpdateDoc\(/, '谓词本身还在（消费方别改成读字段）')
})
