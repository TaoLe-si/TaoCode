// 「安全删除」的引用检查（上游 `SafeDeleteProcessor` 的检查半程）。
// 规则在 `src/safeDelete.ts`，接线在 `src/treeActions.ts` 的 `beginDelete` → `warnBeforeDelete`。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { declarationTarget, safeDeleteNotice, safeDeleteReport } from '../src/safeDelete.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

const location = (path, line, character) => ({ path, line, character })

test('引用账：同一位置去重，文件按路径去重', () => {
  const report = safeDeleteReport([
    location('a.java', 3, 4), location('a.java', 3, 4), location('a.java', 9, 1), location('b.java', 0, 0),
  ])
  assert.deepEqual(report, { usages: 3, files: 2 })
  assert.deepEqual(safeDeleteReport([]), { usages: 0, files: 0 })
})

test('没有引用时不打扰用户（空文案）', () => {
  assert.equal(safeDeleteNotice('A.java', { usages: 0, files: 0 }), '')
})

test('有引用时点出数量、文件数与后果', () => {
  const message = safeDeleteNotice('A.java', { usages: 3, files: 2 })
  assert.match(message, /「A\.java」/)
  assert.match(message, /3 处引用/)
  assert.match(message, /2 个文件/)
  assert.match(message, /失效/)
  assert.match(message, /查找用法/)
})

test('检查目标：优先与文件同名的类型，退到第一个类型，纯文本返回 null', () => {
  const symbols = [
    { name: 'helper', kind: 12, startLine: 0, startChar: 0 },
    { name: 'Other', kind: 5, startLine: 5, startChar: 0 },
    { name: 'A', kind: 5, startLine: 2, startChar: 6 },
  ]
  assert.deepEqual(declarationTarget('src/A.java', symbols), { startLine: 2, startChar: 6 })
  assert.deepEqual(declarationTarget('src/Unknown.java', symbols), { startLine: 5, startChar: 0 })
  assert.equal(declarationTarget('notes.txt', [{ name: 'x', kind: 12, startLine: 0, startChar: 0 }]), null)
  assert.equal(declarationTarget('src/A.java', []), null)
})

test('接线：beginDelete 之后发起引用检查，且不阻断删除（deleteTarget 已先设好）', () => {
  const source = read('src/treeActions.ts')
  // `beginDelete(chosen?)`：右键那条路不传 chosen（从 treeMenu 取），键盘那条路（若将来接
  // SafeDelete 的 Alt+Delete）把行直接传进来；两条路都要先设 deleteTarget 再异步查引用。
  assert.match(source, /function beginDelete\(chosen\?: Entry\)[\s\S]{0,200}deleteTarget\.value = entry; void warnBeforeDelete\(entry\)/,
    'beginDelete 要先设 deleteTarget（对话框照常打开），再异步查引用')
  assert.match(source, /const result = await request<LspReferencesResult>\('lsp\.request',\s*\{ kind: 'references'/, '引用检查走 lsp.request 的 references')
  assert.match(source, /safeDeleteNotice\(baseName\(entry\.path\), safeDeleteReport\(result\.refs\)\)/, '有引用才提示')
  assert.match(source, /catch \{ \/\* 语言服务不可用：不打扰删除流程 \*\/ \}/, '查询失败不能打断删除')
})
