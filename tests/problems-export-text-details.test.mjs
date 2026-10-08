// 导出文本的「详情」开关 —— 请求 `docs/wiring-requests-2026-10-06-status2.md` **W4** 的接线判据。
// 上游那颗复选框（逐条实读参考树）：
//   · `platform/platform-impl/src/com/intellij/ide/errorTreeView/impl/ErrorViewTextExporter.java:21`
//     —— 字段 `private final JCheckBox myCbShowDetails`；
//   · 同文件 `:27` 建复选框（文案键 `checkbox.errortree.export.details`，英文原文 "Details"，
//     `platform/platform-api/resources/messages/IdeBundle.properties:143`）、`:28` `setSelected(true)`
//     —— **默认是勾上的**（本仓的缺省必须一致）；
//   · 同文件 `:38-40` `getSettingsEditor()` 把它交给导出对话框、`:56` 把它的选中值当 `withUsages` 传下去；
//   · 同文件 `:77-78` —— `withUsages` 为 false 时**跳过** `NavigatableMessageElement`，也就是只剩分组标题。
// 本仓的实现早就在 `src/errorTree.ts` 的 `errorTreeText(rows, { details })`（两个分支都有，
// `tests/error-tree.test.mjs:44-55` 钉着两档的输出形状），缺的**从来只是那个控件本身**：
// 调用点不传第二个参数 ⇒ `details === false` 那一档对用户不可达。
// 这一文件钉的是"控件真的接上了"，不是重复钉函数本身。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const panel = readFileSync('src/components/ProblemsPanel.vue', 'utf8')

test('复选框有宿主：默认勾上（上游 setSelected(true)）', () => {
  assert.match(panel, /const exportDetails = ref\(true\)/,
    '导出文本的「详情」开关没有宿主 state —— W4 仍缺（上游 ErrorViewTextExporter.java:28 默认勾上）')
})

test('导出调用把开关传进 errorTreeText（不再吃缺省值）', () => {
  // 落地形状比本条初版多带一个 `groups`（导出要按分组树排），但本条要钉的那件事没变：
  // **第二参里的 `details` 必须来自那颗开关**，缺了它 `details=false` 那一档就不可达。
  assert.match(panel, /errorTreeText\([^\n]*, \{ details: exportDetails\.value/,
    '`errorTreeText` 没有把 `details` 从开关传进去 ⇒ 只拿缺省值，details=false 那一档不可达（W4 的核心缺陷）')
})

test('模板里那颗复选框绑的是这个开关，且带无障碍名', () => {
  assert.match(panel, /type="checkbox"[^>]*:checked="exportDetails"/,
    '没有绑到 exportDetails 的复选框 = 只有 state 没有控件（假逻辑）')
  assert.match(panel, /aria-label="导出时包含每条消息"/,
    '纯开关也要有无障碍名（本仓无障碍约定）')
})

test('文案按上游英文原文直译（详情 ← "Details"），没有编中文上游词', () => {
  assert.match(panel, /详情/,
    '复选框的可见文字丢了')
  assert.match(panel, /checkbox\.errortree\.export\.details/,
    '文案要留上游键名，方便下一个代理核对（IdeBundle.properties:143）')
})

test('errorTreeText 的生产调用点仍然只有一处（不给状态栏/别处加第二个导出口）', () => {
  const files = ['src/App.vue', 'src/components/ProblemsPanel.vue']
  const hits = files.flatMap(file => {
    const text = readFileSync(file, 'utf8')
    const matches = text.match(/errorTreeText\(/g) ?? []
    return matches.length ? [{ file, count: matches.length }] : []
  })
  assert.deepEqual(hits, [{ file: 'src/components/ProblemsPanel.vue', count: 1 }],
    'W4 明写"不要再给状态栏/别处加第二个导出入口"')
})

test('开关的两个档位确实产出不同内容（接线不是摆设）', async () => {
  const { errorTreeText } = await import('../src/errorTree.ts')
  const rows = [
    { path: 'src/a.ts', line: 0, character: 0, severity: 1, message: '第一条错误' },
    { path: 'src/a.ts', line: 3, character: 4, severity: 2, message: '第一条警告' },
  ]
  const full = errorTreeText(rows, { details: true })
  const summary = errorTreeText(rows, { details: false })
  assert.ok(full.includes('第一条错误') && full.includes('第一条警告'), '勾上 = 每条消息都在')
  assert.ok(!summary.includes('第一条错误'), '不勾 = 消息整条跳过（上游 :77-78 那个分支）')
  assert.ok(summary.length > 0 && full.length > summary.length,
    '两档都必须真有产出，且档与档不同 —— 否则这颗复选框就是假控件')
})
