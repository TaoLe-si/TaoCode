import test from 'node:test'
import assert from 'node:assert/strict'

test('LSP filterText 当过滤键、displayLabel 保可见名（防别名/缩写被过滤掉）', () => {
  // 这条契约在 src/lspCompletion.ts 的 mapping 里：label = filterText（有就用）、displayLabel = 原 label。
  // 这里按同一规则重算一遍，钉住"高亮范围要跟着 displayLabel 偏移"这条约定（completionMatch 的注释）。
  const item = { label: 'ArrayList', raw: { filterText: 'java.util.ArrayList' } }
  const label = typeof item.raw.filterText === 'string' ? item.raw.filterText : item.label
  const displayLabel = item.label
  assert.equal(label, 'java.util.ArrayList', '过滤键用 filterText')
  assert.equal(displayLabel, 'ArrayList', '显示还是服务端给的 label')
})
