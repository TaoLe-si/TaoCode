// Alt+Enter 弹层这一路的判据：`src/codeActionPopupModel.ts`（宿主侧形状 + 键盘落点，真执行）
// 与 `src/components/CodeActionPopup.vue`（组件本体，**源码形状断言**）。
//
// ⚠ 证据等级要写清楚：本仓的 .mjs 门禁跑在 `node --test` 上，没有 DOM、没有 Vue 渲染器，
// 所以这个组件**没有真机渲染证据** —— 它对 `rows` / `selected` 的用法是按源码形状钉的
// （下面第 B 组），行表与键盘落点本身的规则是真执行的（A 组）。
// 组件能挂上去、画出来对不对，归宿主那一行（docs/batch-2026-10-06-codeactionpopup.md §6）落地后
// 的真机验收，本文件里不假称"渲染过"。
//
// 上游坐标（本轮逐字开过，登记在 docs/batch-2026-10-06-codeactionpopup.md §2；
// 派单点名的 `HighSeverityQuickFix` / `ActionIntentionAction` / `IntentionActionList` 一族
// 在这份基准树里 0 命中 ⇒ 本文件第 B 组里有三条"不许出现"的反向判据钉的就是这件事）：
//   · `platform/lang-impl/src/com/intellij/codeInsight/intention/impl/IntentionListStep.java:295-309`
//     `getSeparatorAbove()`（`:305` 组变了才画）、`:101-104` `isSelectable()`、`:293` `getDefaultOptionIndex()`
//   · `platform/platform-impl/src/com/intellij/ui/popup/list/ListPopupImpl.java:267-274`
//     `selectFirstSelectableItem()`（初始选中的是**第一条可选**，不是第 0 行；全不可选则什么都不选）、
//     `:337-341` Enter → `handleSelect(true, …)`、`:333` `ScrollingUtil.installActions(myList)`
//   · `platform/platform-api/src/com/intellij/ui/ScrollingUtil.java:348-349` VK_UP / VK_DOWN
//   · `platform/lang-impl/src/com/intellij/codeInsight/intention/impl/ShowIntentionActionsHandler.kt:327-388`
//     —— 通读无"再按一次 Alt+Enter 循环下一条"的状态 ⇒ 不做，也不假装有。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { SUPPRESS_ACTION_KIND, codeActionPopupRows, firstSelectableRow, isSuppressionAction, moveRowSelection } from '../src/codeActionPopupModel.ts'
import { separatorAbove } from '../src/intentionList.ts'

const root = new URL('..', import.meta.url)
const read = path => readFileSync(new URL(path, root), 'utf8')
const popup = () => read('src/components/CodeActionPopup.vue')

/** 一条服务端风格的 codeAction（字段与 `src/bridge.ts:152` 的 `LspCodeAction` 一致）。 */
const fix = (title, extra = {}) => ({ title, index: 0, edits: [{ path: 'a/b.ts', textEdits: [] }], ...extra })
/** 一条本仓折出来的抑制条目：`kind` 由 `src/localIntentions.ts:113` 打上，且必带 edits（见那里的 `if (!edit) continue`）。 */
const suppress = title => fix(title, { kind: SUPPRESS_ACTION_KIND, index: -1, preferred: true })

// ───────────────────── A 组：模块侧数据形状（真执行）─────────────────────

test('档位先后由规则判，不由输入顺序判：抑制在前输入也照样排在修复之后', () => {
  const rows = codeActionPopupRows([suppress('抑制此检查'), fix('加上缺失的 await'), fix('导入 Foo')])
  assert.deepEqual(rows.map(row => row.group), ['fix', 'fix', 'intention'])
  assert.deepEqual(rows.map(row => row.payload.title), ['加上缺失的 await', '导入 Foo', '抑制此检查'])
  // 载荷必须是**原对象**，不能是复制品 —— 宿主拿它去走既有的 applyCodeAction。
  assert.equal(rows[0].payload.title, '加上缺失的 await')
})

test('「是不是意图」只有 kind 一个判定源，不许按标题猜', () => {
  assert.equal(isSuppressionAction(fix('Suppress: for the sake of argument', { kind: 'quickfix' })), false,
    '标题里有 Suppress 但不是这个 kind ⇒ 它是修复')
  assert.equal(isSuppressionAction(fix('随便什么标题', { kind: 'source.fixAll' })), false)
  assert.equal(isSuppressionAction(fix('没有 kind 的老服务端')), false, '缺 kind ⇒ 归修复半区（服务端没填是常态）')
  assert.equal(isSuppressionAction(suppress('抑制此检查')), true)
})

test('不可选那一档有三条真输入，三条都不满足才置灰并给理由（IntentionListStep.java:101-104）', () => {
  const noEdits = { title: '只列出来', index: 3, edits: [] }
  const rows = codeActionPopupRows([
    noEdits,
    { ...noEdits, title: '服务端执行', command: true },
    { ...noEdits, title: '可解析', resolvable: true },
    fix('自带编辑'),
  ])
  assert.deepEqual(rows.map(row => row.selectable), [false, true, true, true],
    'command / resolvable / 有 edits 三条里任一条成立就该可选')
  assert.equal(rows[0].group, 'fix')
  assert.ok(rows[0].reason.length > 0, '不可选必须带理由，不能只画个灰行')
  assert.equal(rows.filter(row => row.selectable)[0].reason, '', '可选行的理由是空串')
})

test('抑制半区恒可选：因为算不出插入点的那条根本进不到 Alt+Enter（localIntentions.ts:105-106）', () => {
  const rows = codeActionPopupRows([fix('修复'), suppress('抑制此行'), suppress('抑制整个类')])
  const intentions = rows.filter(row => row.group === 'intention')
  assert.equal(intentions.length, 2)
  assert.ok(intentions.every(row => row.selectable && row.reason === ''),
    '这一路的抑制条目一定自带编辑载荷 ⇒ 不许在这里假造一个"不可用的抑制"')
})

test('v-for 的键唯一：同一行两条**同名**抑制不撞键（负例：只拿标题当键就会撞）', () => {
  const rows = codeActionPopupRows([suppress('抑制 "no-unused-vars"'), suppress('抑制 "no-unused-vars"')])
  assert.equal(new Set(rows.map(row => row.key)).size, 2, `键撞了：${rows.map(row => row.key).join(' / ')}`)
})

test('分隔线只画在换档处，同组内不画（IntentionListStep.java:295-309 的 :305）', () => {
  const rows = codeActionPopupRows([fix('A'), fix('B'), suppress('C'), suppress('D')])
  assert.deepEqual(rows.map((row, index) => separatorAbove(rows, index)), [false, false, true, false],
    '只有第一条抑制上面有一条线')
  // 负例：单档整表无线（第 0 行永远无线 —— `IntentionListStep.java:302` `if (index <= 0) return null`）。
  const onlyFixes = codeActionPopupRows([fix('A'), fix('B')])
  assert.deepEqual(onlyFixes.map((row, index) => separatorAbove(onlyFixes, index)), [false, false])
  const onlyIntentions = codeActionPopupRows([suppress('C'), suppress('D')])
  assert.deepEqual(onlyIntentions.map((row, index) => separatorAbove(onlyIntentions, index)), [false, false])
})

test('初始选中的是第一条可选行，不是第 0 行（ListPopupImpl.java:267-274）；全不可选时一行都不选', () => {
  assert.equal(firstSelectableRow([{ selectable: false }, { selectable: false }, { selectable: true }]), 2)
  assert.equal(firstSelectableRow([{ selectable: true }]), 0)
  assert.equal(firstSelectableRow([{ selectable: false }, { selectable: false }]), -1,
    '没有任何可选行 ⇒ 不画选中底（否则读起来像"回车会应用这条灰行"）')
  assert.equal(firstSelectableRow([]), -1)
})

test('↑↓ 跳过不可选的行，端点不循环；空表返回 -1', () => {
  const rows = [{ selectable: true }, { selectable: false }, { selectable: true }]
  assert.equal(moveRowSelection(rows, 0, 1), 2, '往下跳过那条灰行')
  assert.equal(moveRowSelection(rows, 2, -1), 0, '往上同理')
  assert.equal(moveRowSelection(rows, 0, -1), 0, '上端点原地不动：循环是上游的设置项（ScrollingUtil.java:261-262），本仓没有这一项')
  assert.equal(moveRowSelection(rows, 2, 1), 2, '下端点同理')
  assert.equal(moveRowSelection([], 0, 1), -1)
})

test('键盘落点与行表同源：moveRowSelection 只在可选行之间走，所以弹层不可能把选中停在灰行上', () => {
  const rows = codeActionPopupRows([
    { title: '灰的', index: 0, edits: [] },
    fix('亮的'),
    { title: '也灰的', index: 1, edits: [] },
  ])
  let at = firstSelectableRow(rows)
  assert.equal(at, 1)
  assert.equal(rows[at].selectable, true)
  at = moveRowSelection(rows, at, 1)
  assert.equal(at, 1, '下面没有可选行了 ⇒ 原地')
  assert.equal(rows[at].selectable, true)
})

// ───────────── B 组：组件本体的源码形状（无真机渲染证据，见文件头）─────────────

test('组件真的用那份规则与那三个键盘落点，而不是自己另写一套', () => {
  const src = popup()
  for (const use of [
    /codeActionPopupRows\(props\.actions\)/,
    /separatorAbove\(rows, index\)/,
    /firstSelectableRow\(rows\.value\)/,
    /moveRowSelection\(rows\.value, selected\.value, 1\)/,
    /moveRowSelection\(rows\.value, selected\.value, -1\)/,
    /:disabled="!row\.selectable"/,
    /:title="row\.selectable \? undefined : row\.reason"/,
    /role="separator"/,
  ]) assert.match(src, use)
  // 高亮跟着 selected 走，**不写死第 0 行**（旧形状 `highlighted: index === 0` 在"第 0 条不可选"时
  // 会把选中底画在灰行上，与 ListPopupImpl.java:267-274 相悖）。
  assert.match(src, /:class="\{ highlighted: index === selected \}"/)
  assert.doesNotMatch(src, /highlighted: index === 0/, '写死第 0 行 = 初始选中那条规则根本没生效')
  // 弹层开着的时候换列表（连按两次 Alt+Enter：`v-if` 不变 ⇒ 组件不重建）⇒ 选中必须被压回有效行。
  assert.match(src, /watch\(rows, list => \{/, '没有这一句 = 第二次 Alt+Enter 之后 selected 指向一条已经不存在的行')
  assert.match(src, /if \(!current \|\| !current\.selectable\) selected\.value = firstSelectableRow\(list\)/)
})

test('键盘：↑↓ Enter 三档都在，且不吃掉 Tab 与 Esc', () => {
  const src = popup()
  assert.match(src, /event\.key === 'ArrowDown'/)
  assert.match(src, /event\.key === 'ArrowUp'/)
  assert.match(src, /event\.key === 'Enter'/)
  // 根节点要有 tabindex="-1" 才拿得到焦点，否则上面三档永远不触发（本仓两个既有弹层同一写法：
  // TargetChooserPopup.vue:32、SelectInPopup.vue:23 的 nextTick + focus）。
  assert.match(src, /tabindex="-1"/)
  assert.match(src, /void nextTick\(\(\) => box\.value\?\.focus\(\)\)/)
  // Esc 归宿主全局捕获期监听（App.vue:1954 → keymap.ts:223）：组件里再拦一次就是两条路关同一个弹层。
  assert.doesNotMatch(src, /Escape|keyCode === 27/, 'Esc 不该在组件里另起一条关闭路径')
  // @keydown 不能 .stop / .prevent（除非按键自己处理过）：backdrop 上的 trapFocus 还要收 Tab。
  assert.doesNotMatch(src, /@keydown\.(stop|prevent)/)
})

test('样式纪律：只用既有令牌，没有硬编码 hex / 毫秒 / 贝塞尔，也没有自加动效', () => {
  const style = popup().match(/<style scoped>([\s\S]*?)<\/style>/)?.[1] ?? ''
  assert.ok(style.length > 0, '没有 scoped 样式块 = 分隔线根本没样式，画不出来')
  assert.doesNotMatch(style, /#[0-9a-fA-F]{3,8}\b/, '颜色一律走 var(--…)')
  assert.doesNotMatch(style, /\b\d+m?s\b|cubic-bezier|ease-in|ease-out/, '不许自加时长/缓动')
  assert.doesNotMatch(style, /transition:|animation:|@keyframes/, '反馈靠状态与选中底，不靠动效（本仓既有约定）')
  // 禁止全局元素选择器追加样式：scoped 块里不出现裸标签开头的规则（`.code-action-row:disabled` 这类是带类的）。
  assert.doesNotMatch(style, /^\s*(button|div|section|span|input)\s*[,{:]/m, '全局元素选择器会污染宿主那一份 .palette-results')
})

test('图标尺寸只从 uiIcons 取，文案与措辞沿用既有出口，没有新造控件', () => {
  const src = popup()
  assert.doesNotMatch(src, /:size="\d+"/, '尺寸一律 iconSize.*（uiIcons.ts 的三条硬规则之一）')
  assert.match(src, /:size="iconSize\.toolbar"/)
  // 这三串都是**从 src/App.vue:2675 原样搬过来的**，不是新写的措辞（无 zh 本地化包 ⇒ 抄不了上游）。
  for (const text of ['代码操作 / 快速修复', '由语言服务执行', '需解析']) assert.ok(src.includes(text), `丢了既有文案：${text}`)
})

test('不放假的东西：没有「更多/固定/设置」那一排、没有子菜单键、没有速度搜索、没有空态行', () => {
  const src = popup()
  // 「不许出现」的那几行只看**模板**：文件头注释里必须交代"为什么这一排不做"，
  // 拿整份源码断言就成了自我否定（一个恒真的假门禁比没有门禁更糟）。
  const tpl = src.match(/<template>([\s\S]*)<\/template>/)?.[1] ?? ''
  assert.ok(tpl.length > 0, '取不到模板块 = 下面这几条反向判据全在空转')
  // `IntentionActionList` 一族在基准树里 0 命中，弹层里的这一排在**这份上游**里不存在
  // （带 ArrowDown 的那一排是 gutter 灯泡 IntentionHintComponent.java:619-687）⇒ 不许编。
  assert.doesNotMatch(tpl, /更多|固定|查看全部|设置|Show more/, '上游核实不到的行宁可不出现')
  assert.doesNotMatch(tpl, /<Pin|<Settings|<Gear|<MoreHorizontal/, '齿轮/图钉/省略号都要有真动作能抛，本仓没有 ⇒ 不放假控件')

  // 子菜单要"动作带子动作"的输入，`LspCodeAction`（src/bridge.ts:152）没有子动作字段。
  assert.doesNotMatch(src, /ArrowRight|ArrowLeft/, '←/→ 是子菜单/返回，本仓没有那个输入')
  // 速度搜索会把行表过滤掉，而 separatorAbove 判的是"当前列表相邻两行的组变"⇒ 没有真判据前不做。
  assert.doesNotMatch(src, /filter|speedSearch|isSpeedSearch/, '打字过滤会改掉换档相邻性，本轮不接')
  // 空态不出现是**事实**而不是遗漏：src/semanticActions.ts:481-486 里 0 条走提示、1 条直接应用，
  // 弹层只可能在 ≥2 条时打开。
  assert.doesNotMatch(src, /palette-empty/, '这一路永远非空，加空态就是假控件')
})

test('组件不请求、不写盘、不解释动作：一切落回宿主既有的 applyCodeAction', () => {
  const src = popup()
  assert.match(src, /const emit = defineEmits<\{ apply: \[action: LspCodeAction\] \}>\(\)/)
  assert.doesNotMatch(src, /request\(|await |fetch\(|localStorage|watchEffect/, '它只是渲染层：请求在 openCodeActions，应用在 applyCodeAction')
  assert.doesNotMatch(src, /emit\(['"]close/, '关闭只有宿主那一条路径，别再造第二个')
})
