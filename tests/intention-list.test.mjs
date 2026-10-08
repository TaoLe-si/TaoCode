// `src/intentionList.ts`（意图列表的三条规则）+ `src/intentionMenuModel.ts`（本仓两种对象怎么喂进去）
// 的判据，外加**接线本身**的判据 —— 这条链在 2026-10-06 之前是"纯模块落了、消费方没接"，
// 所以这里既钉规则，也钉"规则确实挂在真实出口上"（Alt+Enter 弹层与问题面板行菜单）。
//
// 上游坐标（本轮逐字开过，全部对得上；派单里点名的 `IntentionActionAvailabilityTheories`
// 在这份基准树里不存在，`find -iname "*AvailabilityTheories*"` = 0 命中）：
//   · `platform/lang-impl/src/com/intellij/codeInsight/intention/impl/CachedIntentions.java:353-368`
//     `getAllActions()` —— 先 `myErrorFixes`(:354) + `myInspectionFixes`(:355)，后 `myIntentions`
//     (:356-360，已作为修复出现过的不再以意图身份重复出)，再 `myGutters`(:361)、`myNotifications`(:362)，
//     `:363` dumb 模式过滤，`:366-367` 交给按语言的 `IntentionsOrderProvider.getSortedIntentions`。
//   · 同文件 `:371-393` `getGroup()` —— ERROR / REMOTE_ERROR / INSPECTION / NOTIFICATION / GUTTER /
//     EMPTY_ACTION / ADVERTISEMENT / OTHER 八档。
//   · `platform/lang-impl/src/com/intellij/codeInsight/intention/impl/IntentionListStep.java:296-309`
//     `getSeparatorAbove()` —— `:305` 组变了就 `new ListSeparator()`；`:297-299` 条目自己也能带一条；
//     `:302` `if (index <= 0) return null`。全文件 343 行，**没有**「show more」那一行
//     （`grep -rn "show_more"` 在 `codeInsight` 下面 0 命中）。
//   · `IntentionListStep.java:102-104` `isSelectable()` → `IntentionActionWithTextCaching.java:156-162`
//     —— 只有实现 `CustomizableIntentionAction` 的条目能说自己不可选，默认**可选**。
//     形状是「照样列出来，但这一条不能被选中」。
//   · 面板这一路为什么和 Alt+Enter 是同一个弹层：
//     `platform/problemsView/ui/resources/intellij.platform.problemView.ui.xml:100-103` 的
//     `ProblemsView.QuickFixes` 走 `ShowProblemsViewQuickFixesAction.kt:78-92` 的
//     `IntentionListStep(…, IntentionSource.PROBLEMS_VIEW)`；`IntentionSource.java:37-40` 那一格的
//     注释原文「Quick fixes button in the Problems tool window」；抑制本身也是意图
//     （`platform/analysis-api/src/com/intellij/codeInspection/SuppressIntentionAction.java:19`）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  INTENTION_GROUP_ORDER, intentionMenuItems, intentionRowsFor, orderIntentionSections, separatorAbove,
} from '../src/intentionList.ts'
import {
  INTENTION_MENU_GROUP_TITLES, UNSUPPRESSIBLE_PREVIEW, menuIntentionFixInput, menuIntentionOptionInput,
} from '../src/intentionMenuModel.ts'

const root = new URL('..', import.meta.url)
const read = path => readFileSync(new URL(path, root), 'utf8')

/** 一张行表的最小形状（字段与 `IntentionRow` 一致；.mjs 里写不了类型，只能靠约定）。 */
const row = (key, group, selectable = true, reason = '') => ({ key, group, selectable, reason })

// ───────────────────────── 规则本体（档位顺序）─────────────────────────

test('档位表只有本仓有生产者的那两档，且先修复后意图（CachedIntentions.java:354-360）', () => {
  assert.deepEqual([...INTENTION_GROUP_ORDER], ['fix', 'intention'])
  // GUTTER / NOTIFICATION 在本仓没有生产者 ⇒ 不列恒空的档位。
  assert.ok(!INTENTION_GROUP_ORDER.includes('gutter'))
  assert.ok(!INTENTION_GROUP_ORDER.includes('notification'))
})

test('顺序按档位判，不按"哪段代码先写"判：输入倒着给，输出仍是修复在前', () => {
  const sections = orderIntentionSections([
    { group: 'intention', rows: ['suppress-line'] },
    { group: 'fix', rows: ['fix-a'] },
  ])
  assert.deepEqual(sections.map(section => section.group), ['fix', 'intention'])
  assert.deepEqual(sections.flatMap(section => section.rows), ['fix-a', 'suppress-line'])
})

test('空档不占位（上游是几条列表串起来，空的自然没那一段），同档内部保持传入顺序', () => {
  const sections = orderIntentionSections([
    { group: 'intention', rows: [] },
    { group: 'fix', rows: ['third', 'first', 'second'] },
  ])
  assert.equal(sections.length, 1, '空的意图档不该留下一个标题为空的段')
  assert.deepEqual(sections[0].rows, ['third', 'first', 'second'], '档内排序交给各段自己的来源')
  assert.deepEqual(orderIntentionSections([{ group: 'fix', rows: [] }]), [])
})

// ───────────────────────── 规则本体（分隔线）─────────────────────────

test('分隔线 = 组变了就一条（IntentionListStep.java:296-309 的 :305）', () => {
  const rows = [row('f0', 'fix'), row('f1', 'fix'), row('i0', 'intention'), row('i1', 'intention')]
  assert.deepEqual(rows.map((_, index) => separatorAbove(rows, index)), [false, false, true, false])
})

test('第 0 行永远不带线；整表只有一档时一根线都不画', () => {
  const rows = [row('f0', 'fix'), row('f1', 'fix')]
  assert.equal(separatorAbove(rows, 0), false, '上游 :302 `if (index <= 0) return null`')
  assert.ok(!rows.some((_, index) => separatorAbove(rows, index)))
})

// ─────────────────────── 规则本体（不可选那一档）───────────────────────

test('没有可用载荷的条目：照样列出来，但不能被选中，理由随行', () => {
  const rows = intentionRowsFor([{ title: '去掉未用导入', hasEdits: false }], [])
  assert.equal(rows.length, 1, '不可选≠从列表里删掉')
  assert.equal(rows[0].selectable, false)
  assert.notEqual(rows[0].reason, '', '不可选必须带理由，否则用户只看到一条灰行')
})

test('可选性两档都真：修复看有没有可用载荷，抑制条目看插入点算不算得出来', () => {
  const rows = intentionRowsFor(
    [{ title: '有载荷的修复', hasEdits: true }, { title: '没载荷的修复' }],
    [{ id: 'eslint-no-var-used', unavailable: '' }, { id: 'noinspection', unavailable: UNSUPPRESSIBLE_PREVIEW }],
  )
  assert.deepEqual(rows.map(item => item.selectable), [true, false, true, false])
  assert.equal(rows[2].reason, '', '可选的条目不留理由文本')
  assert.equal(rows[3].reason, UNSUPPRESSIBLE_PREVIEW, '不可选的抑制条目把面板那句话原样带出来')
})

test('两半的行都照实列出，不做近似去重（上游比的是对象身份，本仓没有那个信息）', () => {
  assert.deepEqual(intentionRowsFor([{ title: 'A', hasEdits: true }], [{ id: 'A', unavailable: '' }]).map(item => item.key),
    ['fix:A:0', 'intention:A'], '标题与 id 撞了字面量也不许误删一条真实动作')
  assert.deepEqual(intentionRowsFor([{ title: 'A', hasEdits: true }], [{ id: 'fix:A:0', unavailable: '' }]).map(item => item.key),
    ['fix:A:0', 'intention:fix:A:0'], '连最接近"同键"的输入也是两条 ⇒ 原来那段按 key 的去重恒不触发')
  assert.doesNotMatch(read('src/intentionList.ts'), /const taken = new Set/,
    '永不触发的去重分支已按「死代码直接删」处理（订正留痕在 src/intentionList.ts 的 intentionMenuItems 头上）')
})

// ─────────────────────── 带载荷的行表（面板那一路）───────────────────────

test('带载荷的行表与不带载荷的行表是同一套规则：剥掉载荷后必须逐字段相等', () => {
  const fixes = [{ title: '修 A', hasEdits: true }, { title: '修 B' }]
  const suppressions = [{ id: 'no-var-used', unavailable: '' }, { id: 'noinspection', unavailable: '越界' }]
  const items = intentionMenuItems(
    fixes.map(fix => ({ ...fix, payload: { n: fix.title } })),
    suppressions.map(suppression => ({ ...suppression, payload: { n: suppression.id } })),
  )
  const stripped = items.map(item => ({ key: item.key, group: item.group, selectable: item.selectable, reason: item.reason }))
  assert.deepEqual(stripped, intentionRowsFor(fixes, suppressions),
    '两份实现会漂移：载荷版必须就是同一套规则')
  assert.deepEqual(items.map(item => item.payload.n), ['修 A', '修 B', 'no-var-used', 'noinspection'])
})

test('载荷挂在行上：宿主不必按内部键格式回查自己的对象', () => {
  const items = intentionMenuItems([{ title: 'X', hasEdits: true, payload: 'the-action' }], [])
  assert.equal(items[0].payload, 'the-action')
  assert.equal(items[0].key, 'fix:X:0')
})

// ─────────────── 本仓口径：什么叫「这条修复当场点得动」（宿主侧规则）───────────────

const action = (over = {}) => ({ title: 't', index: 0, edits: [], ...over })

test('修复的可选性 = 有编辑载荷 / 可由服务端执行 / 给了 codeAction 的 resolve 入口', () => {
  assert.equal(menuIntentionFixInput({ action: action({ edits: [{ path: 'a.ts', textEdits: [] }] }), preview: null }).hasEdits, true)
  assert.equal(menuIntentionFixInput({ action: action({ command: true }), preview: null }).hasEdits, true)
  assert.equal(menuIntentionFixInput({ action: action({ resolvable: true }), preview: null }).hasEdits, true,
    '可 resolve 的条目点得动（面板的 applyMenuFix 会先 resolve），禁掉就是功能回退')
  assert.equal(menuIntentionFixInput({ action: action(), preview: null }).hasEdits, false,
    '三者皆无 ⇒ 点了不会改任何文件（旧形状还会播报「已应用」这句假成交）')
})

test('抑制条目的 unavailable：插入点算得出来传空串，算不出来传那句理由（面板只留一份文本）', () => {
  const option = {
    option: { id: 'noinspection', title: '抑制本行', insertText: '//noinspection x', placement: 'line-above' },
    preview: UNSUPPRESSIBLE_PREVIEW, unavailable: UNSUPPRESSIBLE_PREVIEW,
  }
  assert.deepEqual(menuIntentionOptionInput(option), { id: 'noinspection', unavailable: UNSUPPRESSIBLE_PREVIEW })
  assert.deepEqual(menuIntentionOptionInput({ ...option, unavailable: '', preview: '//noinspection x' }),
    { id: 'noinspection', unavailable: '' })
})

test('段标题沿用本仓既有的两行字，且两档都有（不新造文案）', () => {
  assert.deepEqual(INTENTION_MENU_GROUP_TITLES, {
    fix: '快速修复（应用前预览）',
    intention: '抑制此检查（写入文件）',
  })
})

// ─────────────────────────── 接线：真实出口在场 ───────────────────────────

test('Alt+Enter 那一路吃档位顺序：openCodeActions 用 orderIntentionSections，旧的倒序拼接不再在场', () => {
  const source = read('src/semanticActions.ts')
  assert.match(source, /import \{ orderIntentionSections \} from '\.\/intentionList\.ts'/)
  assert.match(source, /orderIntentionSections<LspCodeAction>\(\[/)
  assert.match(source, /\{ group: 'fix', rows: \[\.\.\.\(onlyFixes \? serverActions\.filter/)
  assert.match(source, /\{ group: 'intention', rows: \[\.\.\.contributed, \.\.\.suppressions\] \}/,
    '意图档要同时装扩展点贡献的条目与本地抑制条目（suppressions 仍在 intention 档里）')
  assert.doesNotMatch(source, /const localActions = /,
    '抑制条目与 JUnit 修复曾被串成一条 localActions（JUnit 排在抑制**之后**，与上游相反）')
})

test('行菜单那一路：面板装 IntentionListMenu，组件真的用三条规则画行', () => {
  const panel = read('src/components/ProblemsPanel.vue')
  const menu = read('src/components/IntentionListMenu.vue')
  assert.match(panel, /import IntentionListMenu from '\.\/IntentionListMenu\.vue'/)
  assert.match(panel, /<IntentionListMenu :fixes="menuFixes" :options="menuOptions"/)
  assert.match(panel, /@apply-fix="applyMenuFix" @apply-suppression="applySuppression"/)
  assert.match(menu, /import \{ intentionMenuItems, separatorAbove \} from '\.\.\/intentionList\.ts'/)
  assert.match(menu, /intentionMenuItems<MenuPayload>\(/)
  assert.match(menu, /separatorAbove\(menuRows, index\)/)
  // 不可选真的落成 disabled（只有 title 里没有 disabled = 假置灰）。
  assert.match(menu, /:disabled="!row\.selectable"/)
  assert.match(menu, /:title="row\.selectable \? undefined : row\.reason"/)
})

test('组件根是 fragment：那些 button 仍是外壳 .tree-menu 的直接子元素（菜单行样式才命中）', () => {
  const menu = read('src/components/IntentionListMenu.vue')
  const body = menu.slice(menu.indexOf('</script>') + '</script>'.length).trim()
  assert.match(body, /^<template>\n\s*<template v-for=/,
    '包一层 div 会让 `.tree-menu > button` 这一族全局样式整段失效（菜单会变成没样式的裸按钮）')
})

test('面板不再自己画那两段（旧形状：抑制在前、修复在后，且越界条目可点）', () => {
  const panel = read('src/components/ProblemsPanel.vue')
  assert.doesNotMatch(panel, /v-if="menuOptions\.length"[\s\S]*?v-if="menuFixes\.length"/)
  assert.doesNotMatch(panel, /interface MenuFix /, '载荷类型收到 src/intentionMenuModel.ts，两处一份')
})

// ─────────────── 接线不是摆设：把整条链按真实输入跑一遍，看结果差在哪 ───────────────

test('真实组合：JUnit 修复（有载荷）与抑制条目（越界）进来，顺序与置灰都真的变', () => {
  // 面板那一步做的事：两半各自 map 成规则输入，再折成一张带载荷的行表。
  const fixes = [
    { action: action({ title: '交换 assertEquals 的参数', index: 0, edits: [{ path: 'a.java', textEdits: [] }] }), preview: null },
    { action: action({ title: '服务端只列不给的修复', index: 1 }), preview: null },
  ]
  const options = [
    { option: { id: 'eslint-no-var-used', title: '抑制本行', insertText: '// eslint-disable-line', placement: 'line-end' }, preview: '// eslint-disable-line', unavailable: '' },
    { option: { id: 'noinspection-dead', title: '抑制上一行', insertText: '//noinspection', placement: 'line-above' }, preview: UNSUPPRESSIBLE_PREVIEW, unavailable: UNSUPPRESSIBLE_PREVIEW },
  ]
  const rows = intentionMenuItems(
    fixes.map(fix => ({ ...menuIntentionFixInput(fix), payload: { kind: 'fix', fix } })),
    options.map(option => ({ ...menuIntentionOptionInput(option), payload: { kind: 'option', option } })),
  )
  assert.deepEqual(rows.map(r => r.group), ['fix', 'fix', 'intention', 'intention'],
    '修复整段在前（上游 CachedIntentions.java:354-360）')
  assert.deepEqual(rows.map((r, i) => separatorAbove(rows, i)), [false, false, true, false],
    '只有换档那一条带线')
  assert.deepEqual(rows.map(r => r.selectable), [true, false, true, false],
    'resolve 不了的修复与算不出插入点的抑制条目都不能被选中')
  assert.equal(rows[3].reason, UNSUPPRESSIBLE_PREVIEW)
  assert.equal(rows[3].payload.kind, 'option', '载荷跟着行走，点击抛回的还是那一条')
})

test('行菜单那一路的顺序也读同一张档位表（两条路不许分叉）', () => {
  const items = intentionMenuItems([{ title: 'F', hasEdits: true, payload: 1 }], [{ id: 'S', unavailable: '', payload: 2 }])
  assert.deepEqual(items.map(item => item.group), ['fix', 'intention'])
  assert.match(read('src/intentionList.ts'), /function intentionMenuItems[\s\S]*?orderIntentionSections<IntentionMenuItem<T>>\(\[/,
    '载荷版若自己 push 半区而不走 orderIntentionSections，改 INTENTION_GROUP_ORDER 就只翻 Alt+Enter、行菜单不动')
})

test('规则模块有生产消费方（不是只有测试在引）', () => {
  const consumers = [
    'src/semanticActions.ts',                     // Alt+Enter 那一路
    'src/components/IntentionListMenu.vue',       // 行菜单那一路
    'src/intentionMenuModel.ts',                  // 本仓两种对象的映射
  ].filter(file => read(file).includes('intentionList.ts'))
  assert.deepEqual(consumers, ['src/semanticActions.ts', 'src/components/IntentionListMenu.vue', 'src/intentionMenuModel.ts'],
    '三条都得在场：少一条就是规则又变回没人用的纯模块')
})
