// 重构菜单 + 导航菜单的「在文件中导航」子菜单 —— 逐条钉住上游 XML 的结构。
//
// 权威来源（**不是** PlatformActions.xml —— `RefactoringMenu` 不在那里）：
//   · `platform/platform-impl/resources/idea/LangActions.xml:355-395`
//     `<group id="RefactoringMenu" popup="true">`，`:394` 挂到 MainMenu（CodeMenu 之后）。
//     解析后的清单：`tests/main/testData/actionSystem/groupStructure/actionGroupStructure.txt:2797-2822`。
//   · `platform/platform-impl/resources/idea/PlatformActions.xml:620-629`
//     `<group id="NavigateInFileGroup" popup="true">`。
// 标题取自 `platform/platform-resources-en/src/messages/ActionsBundle.properties`
// （`:885` `group.IntroduceActionsGroup.text=E_xtract/Introduce`、
//   `:1992` `group.NavigateInFileGroup.text=Navigate in File`）。
//
// 断言只落在**产出行的那段代码**上（`code()` 会剥掉注释与函数签名）—— 文件头那份
// 逐条对照的注释里故意写着所有上游条目名（含没落点的），拿全文去 match 会自相矛盾。
//
// 这条测试盯三件事：
//   1. `popup="true"` 的组必须是**一行带 children**，不能拍平进父菜单；
//   2. 成员的相对次序照上游 XML；
//   3. 没有后端的上游条目**不许出现**（不放假控件），也不许把别的菜单的条目搬过来。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRefactorMenuRows } from '../src/menus/refactorMenu.ts'

const read = relative => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')

/** 只取「真的产出行」的代码：从 `return [` 到文件末尾的 `]`，并剥掉 `//` 注释。 */
function code(relative, factory) {
  const source = read(relative)
  const body = source.slice(source.indexOf(`export function ${factory}`))
  return body.replace(/^\s*\/\/.*$/gm, '')
}

/**
 * 行的出现次序。行 id 有两个来源：字面量 `id: '…'`，以及 `semantic('…')` /
 * `editable('…')` —— 后两者把首参直接当 id（`App.vue:1440-1445`），
 * 所以 `semantic('rename', …)` 那一行的 id 就是 `'rename'`。
 */
function rowIds(source) {
  const ids = []
  for (const match of source.matchAll(/id: '([^']+)'|\b(?:semantic|editable)\('([^']+)'/g)) {
    ids.push(match[1] ?? match[2])
  }
  return ids
}

/** 某个 popup 父行 `children: [` 之后的成员 id（不含父行自己）。 */
function childIds(source, parentId) {
  const at = source.indexOf(`id: '${parentId}'`)
  assert.notEqual(at, -1, `找不到父行 ${parentId}`)
  return rowIds(source.slice(source.indexOf('children: [', at)))
}

const refactor = code('src/menus/refactorMenu.ts', 'createRefactorMenuRows')
const navigate = code('src/menus/navigateMenu.ts', 'createNavigateMenuRows')

/**
 * 这七条的落点已就绪、宿主也已接上（2026-10-06 接线，报告见
 * `docs/batch-2026-10-06-wiring1.md`；`refactor.extractInterface`/`refactor.extractSuperclass`
 * 是本批补的 `src/refactorExtractSuper.ts`）。下面用「最小上下文」跑一遍，守的是
 * `src/menus/refactorMenu.ts` 的 `hosted(ctx.openX)` **契约本身**：宿主没给处理函数就不许出现
 * —— 那是「不放假控件」这条铁律在组件侧的形态，不因为宿主接上了就失效。
 * 「宿主到底接没接」由文件末尾那条测试正面机检，两边合起来才是完整判据。
 */
const PENDING_HOST_ROWS = ['refactor.changeSignature', 'refactor.safeDelete', 'refactor.pullMembers',
  'refactor.pushMembers', 'refactor.introduceParameterObject',
  'refactor.extractInterface', 'refactor.extractSuperclass']

/** `App.vue` 现在真的传了哪些 ctx 成员，这里就给一个最小的同形上下文（值 import 必须带 `.ts`）。 */
function hostContext(extra = {}) {
  return {
    active: { value: { path: 'a.ts' } }, lspReady: { value: true }, isDesktop: true,
    caretPayload: () => ({}), openCodeActions: () => {}, extractVariable: () => {}, extractConstant: () => {},
    extractMethod: () => {}, inlineVariable: () => {}, moveActiveFile: () => {}, copyActiveFile: () => {},
    semantic: (kind, title, keys, keywords) => ({ id: kind, title, keys, keywords, run: () => {} }),
    ...extra,
  }
}

/** 把（可能带 children 的）行拍平，并保留 run 函数（源文本正则拿不到「点下去到底调了谁」）。 */
function idsOfRows(rows) {
  const out = []
  for (const row of rows) {
    out.push(row)
    if (row.children) out.push(...row.children)
  }
  return out
}

const idsOf = rows => idsOfRows(rows).map(row => row.id)

// LangActions.xml:360-383 —— `<group id="IntroduceActionsGroup" popup="true">`。
test('提取/引入是真子菜单，不是拍平的几行', () => {
  assert.match(refactor, /id: 'refactor\.introduce', title: '提取\/引入', keywords: '[^']*', children: \[/,
    'IntroduceActionsGroup 是一行带 children 的子菜单')
  const body = refactor.slice(refactor.indexOf("id: 'refactor.introduce'"), refactor.indexOf("id: 'refactor.inline'"))
  // 成员都在 children 里，次序照 :361 → :364 → :372 → :373 → :380 → :381。
  assert.deepEqual(childIds(body, 'refactor.introduce'),
    ['refactor.extractVariable', 'refactor.ExtractConstant', 'refactor.introduceParameterObject', 'refactor.ExtractMethod',
     'refactor.extractInterface', 'refactor.extractSuperclass'])
  // 顶层 rows 里不再出现这些（拍平时代的残留）。
  const top = rowIds(refactor.slice(0, refactor.indexOf("id: 'refactor.introduce'")))
  assert.deepEqual(top, ['refactor.this', 'rename', 'refactor.changeSignature', 'refactor.rule1'])
})

// LangActions.xml:356-392 的成员次序：重构… → 重命名 → 更改签名 → ─ → 提取/引入 → 内联 → ─ → 移动 → 复制 → 安全删除 → ─ → 上移/下移成员。
// `rename` 是 `semantic('rename', …)` 的 id（`semantic` 的 id 取首参，`App.vue:1443-1445`）。
test('重构菜单的成员次序照 LangActions.xml:356-392', () => {
  assert.deepEqual(rowIds(refactor), [
    'refactor.this',          // :356 Refactorings.QuickListPopupAction
    'rename',                 // :357 RenameElement
    'refactor.changeSignature', // :358 ChangeSignature
    'refactor.rule1',         // :359 <separator/>
    'refactor.introduce',     // :360-383 IntroduceActionsGroup（子菜单）
    'refactor.extractVariable',
    'refactor.ExtractConstant',
    'refactor.introduceParameterObject',
    'refactor.ExtractMethod',
    'refactor.extractInterface',
    'refactor.extractSuperclass',
    'refactor.inline',        // :384 Inline
    'refactor.rule2',         // :385 <separator/>
    'refactor.moveFile',      // :386 Move
    'refactor.copyFile',      // :387 CopyElement
    'refactor.safeDelete',    // :388 SafeDelete
    'refactor.rule3',         // :389 <separator/>
    'refactor.pullMembers',   // :391 MembersPullUp
    'refactor.pushMembers',   // :392 MemberPushDown
  ])
})

// ReformatCode 属于 CodeFormatGroup（LangActions.xml:314-322，代码菜单），
// 不在 RefactoringMenu 里；它在代码菜单已有落点（codeMenu.ts:108）。
test('重构菜单不再挂「重新格式化代码」—— 它属于代码菜单，且原先与那一行重号', () => {
  assert.doesNotMatch(refactor, /重新格式化代码/, 'ReformatCode 不属于 RefactoringMenu')
  assert.doesNotMatch(refactor, /semantic\('format'/, "semantic('format') 会造出 id 'format'，与 codeMenu.ts:108 重号")
  const codeMenu = code('src/menus/codeMenu.ts', 'createCodeMenuRows')
  assert.match(codeMenu, /semantic\('format', '重新格式化'/, '代码菜单那一行仍在（唯一落点）')
})

// 没有后端的上游条目一律不渲染。
// 本批（2026-10-06）把 ChangeSignature / MembersPullUp / MemberPushDown / SafeDelete /
// IntroduceParameterObject 的**落点**做出来了（`src/refactorSignature.ts`+`refactorSignatureFlow.ts`、
// `src/refactorMemberMove.ts`、`src/refactorIntroduceParameterObject.ts`、`src/safeDelete.ts` 的三选一模型），
// 但它们的宿主装配点在**保留文件**（`src/App.vue` 的 `refactorMenuContext`、`src/keymap.ts`、
// `src/keymapBindings.ts`）—— 桶 1 只读，所以 `refactorMenu.ts` 把这五条改成**按能力渲染**：
// 宿主没给那个处理函数，那一行根本不存在。判据因此从「这些名字不许出现在源文本里」
// 升级为下面三条仍然精确的判据（一条都不放松成 includes/ok 了事）：
//   1) 仍然没有落点的上游条目，其**菜单行 id** 不许出现（按 id 末尾比对 ——
//      上游 `IntroduceParameter`(LangActions.xml:368) 与 `IntroduceParameterObject`(:372)
//      是两个动作，旧的 `refactor.includes('IntroduceParameter')` 会被后者的大小写撞车）；
//   2) 落点已就绪但宿主链路未接的那五条，**执行** `createRefactorMenuRows` 后也不许出现（假控件闸门）；
//   3) 每一行都必须带 run / semantic / children / rule 之一（原判据，原样保留）。
test('无后端的重构条目不渲染（不放假控件）', () => {
  const rendered = idsOf(createRefactorMenuRows(hostContext()))
  // `ExtractInterface`/`ExtractSuperclass` 已在本批补上落点（`src/refactorExtractSuper.ts`），
  // 从「没有后端」那一列移走 —— 它们现在归 `PENDING_HOST_ROWS`（宿主没接就不渲染）。
  for (const absent of ['InvertBoolean', 'IntroduceField', 'IntroduceParameter', 'ExtractClass',
    'ExtractInclude', 'ExtractModule', 'memberInvertBoolean']) {
    assert.ok(!rendered.some(id => id.toLowerCase().endsWith(absent.toLowerCase())),
      `${absent} 没有后端，不该出现菜单行`)
  }
  // 2) 落点在、宿主链路还没接上的那五条：不渲染（本仓铁律）。
  for (const pending of PENDING_HOST_ROWS)
    assert.ok(!rendered.includes(pending), `${pending} 的宿主处理函数还没进 App.vue，不该渲染`)
  // 3) 每一行都必须带 run / children / rule 之一 —— 空行就是假控件。
  //    判据从「按源文本逐行扫」改成「按产出来的行扫」：按能力渲染那几条是跨行对象字面量，
  //    逐行扫会把 `run:` 落在下一行的合法行误判成缺处理函数。
  const wired = hostContext({
    openChangeSignature: () => {}, openSafeDelete: () => {}, openPullUp: () => {},
    openPushDown: () => {}, openIntroduceParameterObject: () => {},
    openExtractSuperclass: () => {}, openExtractInterface: () => {},
  })
  for (const context of [hostContext(), wired]) {
    for (const row of idsOfRows(createRefactorMenuRows(context))) {
      assert.ok(typeof row.run === 'function' || row.children || row.rule, `菜单行缺处理函数：${row.id}`)
    }
  }
  // 源文本里写的每条 `refactor.*` 都必须能被产出（防「写了一段永远渲染不出来的死行」）。
  const produced = new Set(idsOfRows(createRefactorMenuRows(wired)).map(row => row.id))
  for (const id of rowIds(refactor).filter(id => /^refactor\./.test(id)))
    assert.ok(produced.has(id), `${id} 在源文本里，但全接上时也产不出这一行`)
})

// 新落点的七条必须**真的**把点击转交给宿主处理函数，并且是「接上了才出现」。
// （旧判据里 `read('src/App.vue').includes(member)` 那一半不能留：App.vue 是保留文件，
// 桶 1 只读，写它 = 越权；接线面改为按 `batches` §4 交请求。这里断言的是**接线面**本身。）
test('更改签名 / 安全删除 / 成员上移下移 / 提取超类接口的菜单行接到真实实现', () => {
  for (const member of ['openChangeSignature', 'openSafeDelete', 'openPullUp', 'openPushDown',
    'openIntroduceParameterObject', 'openExtractSuperclass', 'openExtractInterface'])
    assert.ok(refactor.includes(`ctx.${member}`), `菜单上下文要暴露 ${member}`)
  const called = []
  const handlers = Object.fromEntries(['openChangeSignature', 'openSafeDelete', 'openPullUp', 'openPushDown',
    'openIntroduceParameterObject', 'openExtractSuperclass', 'openExtractInterface'].map(member => [member, () => called.push(member)]))
  const rows = idsOfRows(createRefactorMenuRows(hostContext(handlers)))
  // 接上了就必须出现，且次序照 LangActions.xml:358/:372/:380/:381/:388/:391/:392。
  assert.deepEqual(rows.map(row => row.id).filter(id => PENDING_HOST_ROWS.includes(id)), [
    'refactor.changeSignature',            // :358
    'refactor.introduceParameterObject',   // :372
    'refactor.extractInterface',           // :380
    'refactor.extractSuperclass',          // :381
    'refactor.safeDelete',                 // :388
    'refactor.pullMembers',                // :391
    'refactor.pushMembers',                // :392
  ])
  for (const [id, member] of [
    ['refactor.changeSignature', 'openChangeSignature'],
    ['refactor.safeDelete', 'openSafeDelete'],
    ['refactor.pullMembers', 'openPullUp'],
    ['refactor.pushMembers', 'openPushDown'],
    ['refactor.introduceParameterObject', 'openIntroduceParameterObject'],
    ['refactor.extractInterface', 'openExtractInterface'],
    ['refactor.extractSuperclass', 'openExtractSuperclass'],
  ]) {
    const row = rows.find(item => item.id === id)
    assert.equal(typeof row.run, 'function', `${id} 没有 run 就是假控件`)
    row.run()
    assert.deepEqual(called.splice(0), [member], `${id} 的 run 必须只调 ctx.${member}`)
  }
  // 落点模块真的存在、并导出承诺的入口（不是空文件）。
  for (const [file, entry] of [
    ['src/refactorSignature.ts', 'changeSignatureEdits'],
    ['src/refactorSignatureFlow.ts', 'createChangeSignatureFlow'],
    ['src/safeDelete.ts', 'safeDeletePrompt'],
    ['src/refactorMemberMove.ts', 'memberMoveEdits'],
    ['src/refactorIntroduceParameterObject.ts', 'parameterObjectEdits'],
    ['src/refactorExtractSuper.ts', 'extractSuperEdits'],
  ]) assert.match(read(file), new RegExp(`export function ${entry}\\(`), `${file} 缺出口 ${entry}`)
  // 对话框真的消费模型（挂载点在保留文件 App.vue，见接线请求）。
  assert.match(read('src/components/RefactorSignatureDialog.vue'), /from '\.\.\/refactorSignature\.ts'/)
  assert.match(read('src/components/RefactorSignatureDialog.vue'), /PARAMETER_COLUMNS/)
})

// PlatformActions.xml:620-629 —— `<group id="NavigateInFileGroup" popup="true">`。
test('「在文件中导航」是真子菜单，MethodDown/MethodUp 在 children 里', () => {
  assert.match(navigate, /id: 'navigate\.inFile', title: '在文件中导航', keywords: '[^']*', children: \[/,
    'NavigateInFileGroup 是一行带 children 的子菜单')
  const start = navigate.indexOf("id: 'navigate.inFile'")
  const body = navigate.slice(start, navigate.indexOf("id: 'navigate.line'"))
  assert.deepEqual(childIds(body, 'navigate.inFile'), ['navigate.methodDown', 'navigate.methodUp'], '次序照上游 MethodDown(:621) → MethodUp(:622)')
  // 顶层不再有这两行。
  const top = rowIds(navigate.slice(0, start))
  assert.ok(!top.includes('navigate.methodDown') && !top.includes('navigate.methodUp'), '顶层不该再有 methodDown/methodUp')
})

// 模板参数导航 / GotoCustomRegion 仍 [ ]（需 LSP 签名与折叠区能力），不放假。
test('「在文件中导航」里不出现未移植的上游成员，也不出现自造键位', () => {
  const start = navigate.indexOf("id: 'navigate.inFile'")
  const body = navigate.slice(start, navigate.indexOf("id: 'navigate.line'"))
  for (const absent of ['TemplateParameters', 'GotoCustomRegion'])
    assert.ok(!body.includes(absent), `${absent} 尚无落点，不该出现`)
  for (const row of rowIds(body)) {
    const line = body.slice(body.indexOf(`id: '${row}'`)).split('\n')[0]
    assert.doesNotMatch(line, /keys:/, `$MethodDown/$MethodUp 在 $default.xml 里没有默认键位（${row} 不该写 keys）`)
  }
})

// 上面那条守的是「宿主没接就不出现」；这一条守另一半：2026-10-06 接线之后，
// 这五条**必须**真的在生产链路上（处理函数进了 refactorMenuContext、对话框挂上了、
// 键位表与分派表成对出现），而装配逻辑不在 App.vue 里（它有一行一行的行数上限）。
// 判据全是精确匹配（正则字面量），没有一条是 includes/ok 了事。
test('重构菜单这五条已接到宿主：上下文、对话框挂载与键位表成对落位', () => {
  const app = read('src/App.vue')
  for (const member of ['openChangeSignature', 'openSafeDelete', 'openPullUp', 'openPushDown', 'openIntroduceParameterObject'])
    assert.match(app, new RegExp(`refactorMenuContext: RefactorMenuContext = \\{[^}]*\\b${member}\\b`),
      `${member} 没有进 refactorMenuContext ⇒ 菜单里那一条永远不会渲染`)
  assert.match(app, /<RefactorSignatureDialog v-if="changeSignatureState" :model="changeSignatureState"/,
    '更改签名对话框没挂上')
  assert.match(app, /<RefactorMemberChooserDialog v-if="chooserState" :model="chooserState"/,
    '成员上移/下移与引入形参对象共用的勾选表没挂上')
  assert.match(app, /<RefactorSafeDeleteDialog v-if="safeDeleteState" :prompt="safeDeleteState\.prompt"/,
    '安全删除的三选一没挂上')
  assert.match(app, /from '\.\/refactorHostAssembly'/, '装配面没被 App.vue 引用')
  assert.match(app, /const refactorHost = createRefactorHost\(\{/, 'App.vue 里只应该有一次装配调用')
  // 键位表与分派表成对（两张表缺一边就是「菜单写着键位但按了没反应」）。
  const bindings = read('src/keymapBindings.ts')
  const keymap = read('src/keymap.ts')
  assert.match(bindings, /id: 'refactor\.changeSignature', label: '更改签名…', display: 'Ctrl F6', scope: 'editor',/)
  assert.match(bindings, /chord: \{ key: 'f6', control: 'ctrl', forbid: \['shift', 'alt'\] \}, upstream: '\$default\.xml:469-471' \}/)
  assert.match(bindings, /id: 'refactor\.safeDelete', label: '安全删除…', display: 'Alt Delete', scope: 'editor',/)
  // 订正留痕（主代理，2026-10-06）：原来钉的是 `{ key: 'delete', control: 'alt' }`，而 `KeyChord.control`
  // 的取值域只有 `'ctrl' | 'mod'` ⇒ 那一条既过不了类型（TS2322）、也永远不会被匹配逻辑认出来。
  // 上游 `SafeDelete` 是 **alt DELETE**（`$default.xml:1000`，不带 Ctrl），`control` 现已改成可缺省字段。
  assert.match(bindings, /chord: \{ key: 'Delete', alt: true, forbid: \['ctrl', 'shift'\] \}, upstream: '\$default\.xml:999-1001' \}/)
  assert.match(keymap, /'refactor\.changeSignature': \(\) => openChangeSignature\(\)/)
  assert.match(keymap, /'refactor\.safeDelete': \(\) => void openSafeDelete\(\)/)
  // 成员上移/下移在 $default.xml 里**没有**默认键位 ⇒ 键位表里也不许出现这两条（不冒充）。
  assert.doesNotMatch(bindings, /pullMembers|pushMembers|MembersPullUp|MemberPushDown/, '上游没给键位的两条不该进键位表')
  // 装配层真的把四个模块都调起来了（模型不是只有测试在用）。
  const host = read('src/refactorHostAssembly.ts')
  for (const entry of ['createChangeSignatureFlow\\(', 'memberMoveEdits\\(', 'parameterObjectEdits\\(', 'safeDeletePrompt\\('])
    assert.match(host, new RegExp(entry), `装配层没有调用 ${entry}`)
})
