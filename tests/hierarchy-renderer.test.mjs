// `lp/hierarchy` + `ls/hierarchy` 的呈现判据：层级节点的分段文本、按 kind 的图标、位置文本、
// 行尾状态文案（`HierarchyNodeRenderer` / `LspHierarchyNodeDescriptor` 的本仓等价物）。
//
// 上游依据（逐条，与 `src/hierarchyRenderer.ts` 文件头同源）：
//   · `platform/lang-impl/src/com/intellij/ide/hierarchy/HierarchyNodeRenderer.java:32-43`
//     —— 一行 = 复合文本（分段带样式）+ `setIcon(...)`。
//   · `platform/lsp-impl/src/impl/features/hierarchy/LspHierarchyNodeDescriptor.kt:25-31`
//     —— `addText(item.name)`，仅当 detail 非空白才追加 `" : $detail"`，第二段用次要色样式。
//   · `platform/lang-impl/src/com/intellij/ide/hierarchy/HierarchyNodeDescriptor.java:131-138`
//     —— 失效前缀加在最前，已有就不重复。
//   · `LspHierarchyNodeDescriptor.kt:45-48` —— 图标按 symbol kind（编号即 LSP SymbolKind）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  HIERARCHY_INVALID_PREFIX,
  HIERARCHY_KIND_ICONS,
  hierarchyKindIcon,
  hierarchyPositionText,
  hierarchyRowModel,
  hierarchyTextSegments,
  hierarchyTrailingText,
} from '../src/hierarchyRenderer.ts'

test('名字段永远在、永远是主文本档；detail 空白不追加、非空带 " : " 前缀且是次要色档', () => {
  const only = hierarchyTextSegments({ name: 'Foo' })
  assert.deepEqual(only, [{ text: 'Foo', tone: 'base' }], '没有 detail 时只剩一个主文本段')

  const withDetail = hierarchyTextSegments({ name: 'bar', detail: 'com.example' })
  assert.deepEqual(withDetail, [
    { text: 'bar', tone: 'base' },
    { text: ' : com.example', tone: 'muted' },
  ], 'detail 段前缀 " : "、tone = muted（上游 getUsageCountPrefixAttributes 的次要色）')

  assert.deepEqual(hierarchyTextSegments({ name: 'bar', detail: '   ' }), [{ text: 'bar', tone: 'base' }],
    'detail 全空白 ⇒ trim 后为空 ⇒ 不追加（上游"仅当 detail 非空白"）')
  assert.deepEqual(hierarchyTextSegments({ name: 'bar', detail: null }), [{ text: 'bar', tone: 'base' }])
  assert.deepEqual(hierarchyTextSegments({}), [{ text: '', tone: 'base' }], '缺名字也要给一个空主文本段，不抛')
})

test('失效前缀加在最前且是 muted 档，已经以它开头就不重复加', () => {
  const marked = hierarchyTextSegments({ name: 'Gone' }, true)
  assert.equal(marked[0].text, `${HIERARCHY_INVALID_PREFIX} `)
  assert.equal(marked[0].tone, 'muted')
  assert.equal(marked[1].text, 'Gone')
  assert.equal(marked[1].tone, 'base')

  const already = hierarchyTextSegments({ name: `${HIERARCHY_INVALID_PREFIX} Gone` }, true)
  assert.equal(already.length, 1, '名字已带前缀 ⇒ 不再重复加（上游 :136）')
  assert.equal(already[0].text, `${HIERARCHY_INVALID_PREFIX} Gone`)

  assert.equal(hierarchyTextSegments({ name: 'Ok' }, false).length, 1, '未标失效就不加前缀')
})

test('按 kind 取图标：已知 SymbolKind 有组件、未识别与缺 kind 一律 null（不占图标位）', () => {
  for (const kind of [5, 6, 8, 9, 10, 11, 12, 13, 14, 23, 26]) {
    assert.ok(hierarchyKindIcon(kind), `kind ${kind} 应有图标（表里已登记）`)
  }
  assert.equal(hierarchyKindIcon(1), null, 'File(1) 不在表里 ⇒ null')
  assert.equal(hierarchyKindIcon(2), null, 'Module(2) 不在表里 ⇒ null')
  assert.equal(hierarchyKindIcon(99), null, '未知编号 ⇒ null')
  assert.equal(hierarchyKindIcon(undefined), null, '缺 kind ⇒ null')
  // 表与解析器必须同源：表里每个键都能被解析出来，解析器没有额外兜底。
  for (const kind of Object.keys(HIERARCHY_KIND_ICONS)) {
    assert.equal(hierarchyKindIcon(Number(kind)), (HIERARCHY_KIND_ICONS)[Number(kind)])
  }
})

test('位置文本 1 基（行:列），缺列按 0 处理成 ":1"，缺行返回空串', () => {
  assert.equal(hierarchyPositionText({ line: 0, character: 0 }), '1:1', '上游 0 基 ⇒ 呈现 1 基')
  assert.equal(hierarchyPositionText({ line: 41, character: 7 }), '42:8')
  assert.equal(hierarchyPositionText({ line: 3 }), '4:1', '没有 character ⇒ 列退 0，呈现 ":1"')
  assert.equal(hierarchyPositionText({}), '', '没有行号（库类型没解析出位置）⇒ 空串，模板 v-if 掉')
  assert.equal(hierarchyPositionText({ line: Number.NaN }), '', '非有限行号同样不画')
})

test('行尾状态文案的优先级：查询中 > 递归 > 错误 > 没有下级 > 空', () => {
  assert.equal(hierarchyTrailingText({ loading: true, recursive: true, error: 'x' }), '查询中…')
  assert.equal(hierarchyTrailingText({ recursive: true, error: 'x' }), '递归关系')
  assert.equal(hierarchyTrailingText({ error: '超时了' }), '超时了', '错误原样回显')
  assert.equal(hierarchyTrailingText({ expanded: true, childCount: 0 }), '没有下级')
  assert.equal(hierarchyTrailingText({ expanded: true, childCount: 2 }), '', '展开且确有下级 ⇒ 无尾注')
  assert.equal(hierarchyTrailingText({ expanded: false, childCount: 0 }), '', '未展开不判"没有下级"')
  assert.equal(hierarchyTrailingText({}), '')
})

test('整行模型把上面几件事组装到一起，展开按钮文案随 expanded 翻转并 trim', () => {
  const collapsed = hierarchyRowModel({ item: { name: 'doIt', kind: 6, line: 9, character: 4, detail: 'A' } })
  assert.deepEqual(collapsed.segments, [
    { text: 'doIt', tone: 'base' },
    { text: ' : A', tone: 'muted' },
  ])
  assert.ok(collapsed.icon, 'Method(6) 有图标')
  assert.equal(collapsed.position, '10:5')
  assert.equal(collapsed.trailing, '')
  assert.equal(collapsed.toggleLabel, '展开 doIt')

  const expanded = hierarchyRowModel(
    { item: { name: '', kind: 99 }, expanded: true, children: [] },
  )
  assert.equal(expanded.toggleLabel, '收起', '名字为空 ⇒ "收起 " 被 trim 成 "收起"，不留悬空空格')
  assert.equal(expanded.icon, null)
  assert.equal(expanded.trailing, '没有下级')
  assert.equal(expanded.position, '')

  const invalid = hierarchyRowModel({ item: { name: 'Gone', kind: 5 } }, true)
  assert.equal(invalid.segments[0].text, `${HIERARCHY_INVALID_PREFIX} `)
})

test('接线：层级视图的每一行都带本模块算出的 row（渲染端只做 {{ segment.text }}）', () => {
  const view = readFileSync('src/hierarchyView.ts', 'utf8')
  assert.ok(view.includes("import { hierarchyRowModel } from './hierarchyRenderer.ts'"), '视图没有引入呈现模块')
  assert.ok(view.includes('row: hierarchyRowModel(entry.node)'), 'hierRows 没有为每行组装呈现模型')
})
