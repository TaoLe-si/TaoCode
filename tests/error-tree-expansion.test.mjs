// 「新到的错误自动展开它所在的组」这条规则的**判据本体**，钉 `src/errorTree.ts` 的两个纯函数：
//   · `errorTreeRowKey`（`src/errorTree.ts:211`）—— 两次推送之间一条问题的身份
//   · `expandGroupsForNewErrors`（`src/errorTree.ts:228`）—— 哪些折叠组键要被放出来
// 二者由 `src/errorTreeExpansion.ts` 的响应式那一层持有并调用（消费链：
// `src/components/ProblemsPanel.vue:213` → `src/errorTreeExpansion.ts:46` → `src/errorTree.ts:228`）。
//
// 本文件的存在本身就是订正：`src/errorTreeExpansion.ts` 模块头原来写「判据在
// `tests/error-tree.test.mjs`」，那句话在 2026-10-06 之前**是假的**（那份文件里零条用例钉这两个
// 函数）—— 详见 `docs/batch-2026-10-06-errtreejudge.md`。
//
// 上游依据（参考树 `intellij-community-master`，坐标逐条自己开，见上面那份报告 §0.3）：
//   · `platform/platform-impl/src/com/intellij/ide/errorTreeView/NewErrorTreeViewPanel.kt:357-360`
//     `if (element.kind == ErrorTreeElementKind.ERROR) { // expand automatically only errors
//         future!!.thenRun { makeVisible(element) } }` ⇒ **只有 ERROR 触发展开**；
//   · 同文件 `:363-365` `makeVisible` = `structureModel.makeVisible(element, myTree) {}`，
//     展开的是这条元素到根的那条路径；
//   · 整条 `updateAddedElement`（`:331-361`）**没有一处调用 collapse**，`:338-349` 对刚加进来的
//     `GroupingElement` 只做「按结构失效」⇒ 本仓对应「只删折叠键、从不新增键」；
//   · 展开态在本仓是持久化的黑名单（`src/components/ProblemsPanel.vue:153`
//     `isCollapsed(key) = collapsedGroups.value.includes(key)`、`:231` 命中才把 `rows` 掏空）
//     ⇒ 键不在集合里就是展开，「全新分组」默认展开。
import test from 'node:test'
import assert from 'node:assert/strict'
import { errorTreeRowKey, expandGroupsForNewErrors } from '../src/errorTree.ts'

/** 一条问题：默认值取「同一文件同一行只改被测那一格」最省事的方向。 */
const row = (over = {}) => ({
  path: 'src/a.ts', line: 9, character: 2, severity: 1, message: '未找到符号', source: 'lsp', code: 'E001',
  ...over,
})

/** 生产里 `previousKeys` 就是这么来的（`src/errorTreeExpansion.ts:41`）。 */
const keysOf = rows => new Set(rows.map(errorTreeRowKey))

/** 按 path 的目录当组键，够用来钉「哪一组被放出来」这件事。 */
const groupByPath = r => r.path.split('/')[0]

// ---------------------------------------------------------------- errorTreeRowKey

test('行键：内容相同 ⇒ 键相同，与它在数组里排第几无关（重排不许产生"新错误"）', () => {
  const a = row({ path: 'src/a.ts', line: 1 })
  const b = row({ path: 'src/b.ts', line: 2 })
  const c = row({ path: 'src/c.ts', line: 3 })
  // 同一批、两种顺序：语言服务复推时顺序变了，身份集合必须一模一样。
  const forward = [a, b, c].map(errorTreeRowKey)
  const shuffled = [c, a, b].map(errorTreeRowKey)
  assert.deepEqual(new Set(shuffled), new Set(forward), '顺序变了 ⇒ 键集合不变')
  assert.equal(errorTreeRowKey(a), errorTreeRowKey({ ...a }), '浅拷贝一份同内容的行 ⇒ 同键')
})

test('行键：同一位置**报不同的错**不许撞车（message 参与身份）', () => {
  assert.notEqual(errorTreeRowKey(row({ message: '未找到符号' })), errorTreeRowKey(row({ message: '缺少分号' })),
    '同一处消息变了要能被认出来（`src/errorTree.ts:208-209`）')
})

test('行键：**不同文件同名同位置**不许撞车（path 参与身份）', () => {
  const same = { line: 9, character: 2, severity: 1, message: '未找到符号', source: 'lsp', code: 'E001' }
  const paths = ['src/a.ts', 'tests/a.ts', 'src/dir/a.ts', 'a.ts']
  const keys = paths.map(path => errorTreeRowKey(row({ ...same, path })))
  assert.equal(new Set(keys).size, paths.length, `path 每一档都要落进键里：${JSON.stringify(keys)}`)
})

test('行键：注释里点名的每一格都参与身份（少一格就是"把挪了一列当成没变"）', () => {
  const base = row()
  const mutations = {
    path: 'src/z.ts',
    line: 10,
    character: 3,
    severity: 2,
    message: '换了个说法',
    source: 'inspection',
    code: 'E002',
  }
  for (const [field, value] of Object.entries(mutations)) {
    assert.notEqual(errorTreeRowKey(base), errorTreeRowKey({ ...base, [field]: value }),
      `${field} 必须参与身份 —— 它变了键却没变，这一格就被吞了`)
  }
  // 相邻两格合起来读不出边界：分隔符（`\u0000`）没参与拼接时，这一条会先红。
  assert.notEqual(errorTreeRowKey(row({ line: 1, character: 23 })), errorTreeRowKey(row({ line: 12, character: 3 })),
    '字段边界不许被挪位抹平（去掉分隔符就会撞车）')
  assert.notEqual(errorTreeRowKey(row({ path: 'a.ts', line: 9, character: 21 })),
    errorTreeRowKey(row({ path: 'a.ts9', line: 2, character: 1 })),
    '上一格多出来的尾巴不许被读进下一格（这两行在"去掉分隔符"的实现里会撞成同一个键）')
})

test('行键：`code` 缺省与空串同键，但**有码**与**没码**必须不同键', () => {
  const withCode = row({ code: 'E001' })
  assert.equal(errorTreeRowKey(withCode), errorTreeRowKey({ ...withCode, code: 'E001' }))
  assert.equal(errorTreeRowKey(row({ code: undefined })), errorTreeRowKey(row({ code: '' })),
    '`row.code ?? \'\'`：LSP 不给 code 与给空串是同一个身份')
  assert.notEqual(errorTreeRowKey(row({ code: undefined })), errorTreeRowKey(row({ code: 'E001' })),
    '本地检查（无 code）与带诊断码的那条不是一回事')
})

test('行键：身份只由注释点名的那几格派生（tags/relatedInformation 在集合之外）', () => {
  // `src/errorTree.ts:206-209` 写的是「位置 + 严重度 + 消息 + 检查器 + 诊断码」，没提 tags。
  // 这一条钉的是**已写明的字段集**：语言服务复推时 tags 有无/顺序抖动，不该被当成新错误。
  const base = row()
  assert.equal(errorTreeRowKey(base), errorTreeRowKey({ ...base, tags: [1] }), 'tags 不参与身份（按现有注释）')
  assert.equal(errorTreeRowKey(base), errorTreeRowKey({ ...base, relatedInformation: [{ message: 'x' }] }),
    '相关位置不参与身份（按现有注释）')
})

// --------------------------------------------------- expandGroupsForNewErrors

test('展开沿用：基线里已有的错误**不放**任何组（打开面板时已在的那批算基线）', () => {
  const first = [row({ line: 1 }), row({ line: 2, path: 'src/b.ts' })]
  const collapsed = ['src', 'tests']
  assert.deepEqual(expandGroupsForNewErrors(collapsed, keysOf(first), first, groupByPath), collapsed,
    '同一批再推一次 ⇒ 一条都不算新到')
  assert.deepEqual(expandGroupsForNewErrors(collapsed, keysOf(first), first.map(copy => ({ ...copy })), groupByPath), collapsed,
    '逐条浅拷贝后重推同样不算新到（身份是内容不是对象引用）')
})

test('展开沿用：只放出**新错误所在那一组**，用户手动折的其它组原样保留', () => {
  const previous = keysOf([row({ path: 'src/a.ts', line: 1 })])
  const next = [
    row({ path: 'src/a.ts', line: 1 }),
    row({ path: 'src/new.ts', line: 7, message: '新冒出来的错误' }),
    row({ path: 'tests/t.ts', line: 3, message: '另一个新错误' }),
  ]
  const collapsed = ['src', 'tests', 'docs']
  const result = expandGroupsForNewErrors(collapsed, previous, next, groupByPath)
  assert.deepEqual(result, ['docs'], 'src 与 tests 里各冒出一个新错误 ⇒ 这两组放开；docs 没有新错误，保持折着')
})

test('展开沿用：结果恒是入参折叠集合的**子集**，从不新增键（上游 updateAddedElement 里没有 collapse）', () => {
  const previous = keysOf([])
  const next = [row({ path: 'brand/new.ts', line: 0 })]
  const collapsed = ['src']
  const result = expandGroupsForNewErrors(collapsed, previous, next, groupByPath)
  for (const key of result) assert.ok(collapsed.includes(key), `多出来的键 ${JSON.stringify(key)} 是从哪来的？`)
  assert.ok(!result.includes('brand'), '全新分组不该被这条规则折起来 —— 键不在黑名单里就是展开')
})

test('全新分组：新错误落进一个**从没折过**的组 ⇒ 该组保持在展开侧（黑名单语义）', () => {
  // 面板读法（`ProblemsPanel.vue:153,231`）：`collapsedGroups.includes(key)` 才折 ⇒
  // 这条规则既不能把全新分组写进黑名单，也不该假装"展开"出一个键。
  const result = expandGroupsForNewErrors(['other'], keysOf([]), [row({ path: 'brand/new.ts' })], groupByPath)
  assert.deepEqual(result, ['other'])
  assert.equal(result.includes('brand'), false, '展开是"不折"，不是往集合里加一个键')
})

test('只自动展开 ERROR：新到的警告 / 提示 / 信息 / GENERIC 一条都不放开', () => {
  // 上游 `NewErrorTreeViewPanel.kt:357-358` 那句 "expand automatically only errors"。
  const collapsed = ['src', 'tests']
  for (const severity of [2, 3, 4, 9]) {
    const result = expandGroupsForNewErrors(collapsed, keysOf([]), [row({ severity, path: 'src/x.ts' })], groupByPath)
    assert.deepEqual(result, collapsed, `severity=${severity} 不该展开任何组`)
  }
  const error = expandGroupsForNewErrors(collapsed, keysOf([]), [row({ severity: 1, path: 'src/x.ts' })], groupByPath)
  assert.deepEqual(error, ['tests'], 'severity=1 才放出 src')
})

test('多条新错误挤同一组 ⇒ 只放出这一个键（幂等，不会把集合搞出重复）', () => {
  const next = [row({ line: 1, message: '甲' }), row({ line: 2, message: '乙' }), row({ line: 3, message: '丙' })]
  const result = expandGroupsForNewErrors(['src', 'docs'], keysOf([]), next, groupByPath)
  assert.deepEqual(result, ['docs'])
  assert.equal(new Set(result).size, result.length, '不许出现重复键')
})

test('同一行在不同分组档下含义不同 ⇒ 只放出**当前档**算出来的那个键', () => {
  const next = [row({ path: 'src/a.ts' })]
  const byDirectory = expandGroupsForNewErrors(['src', 'a.ts'], keysOf([]), next, groupByPath)
  assert.deepEqual(byDirectory, ['a.ts'], '按目录分组：放出 src')
  const byFile = expandGroupsForNewErrors(['src', 'a.ts'], keysOf([]), next, r => r.path.split('/').pop())
  assert.deepEqual(byFile, ['src'], '按文件分组：放出 a.ts')
})

test('不分组那一档（组键是空串）是空操作：不把空串当组键存进去', () => {
  // `src/errorTree.ts:224-226` + `ProblemsPanel.vue:159` 的 `.filter(Boolean)`。
  const collapsed = ['stale-group-key']
  const result = expandGroupsForNewErrors(collapsed, keysOf([]), [row()], () => '')
  assert.equal(result.includes(''), false, '空串绝不能出现在折叠集合里')
  assert.deepEqual(result, collapsed, '这一档下这条规则整体是空操作：旧的键留着，新键一个不加')
})

test('空折叠集合：返回等价的**新数组**，不复用入参引用', () => {
  const empty = []
  const result = expandGroupsForNewErrors(empty, keysOf([]), [row()], groupByPath)
  assert.deepEqual(result, [])
  assert.notEqual(result, empty, '同一引用会让调用方的 watch 认不出变化')
  const untouched = ['src']
  const second = expandGroupsForNewErrors(untouched, keysOf([]), [], groupByPath)
  assert.deepEqual(second, untouched)
  assert.notEqual(second, untouched, '没有新错误时也要交回一份副本，不能把面板的数组直接递出去')
})

test('同一处错误的 message 变了 = 新到 ⇒ 那一组当场放开（内容即身份的直接后果）', () => {
  // 上游比的是树节点对象；本仓每帧重推，只能按内容比（`src/errorTree.ts:206-209`）。
  // 这一条同时是「行键带 message」的行为后果：把它从键里拿掉，这里就会红。
  const previous = keysOf([row({ line: 4, message: '未找到符号' })])
  const next = [row({ line: 4, message: '未找到符号 foo' })]
  assert.deepEqual(expandGroupsForNewErrors(['src', 'docs'], previous, next, groupByPath), ['docs'])
})
