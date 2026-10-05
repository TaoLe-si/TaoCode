// 用法视图的分组与导出（`src/usageViewGrouping.ts`）：目录树、文件分组、导出文本格式。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildUsageTree, exportUsagesText, groupUsagesByFile, usageSummary, usagesClipboardText,
} from '../src/usageViewGrouping.ts'

const loc = (path, line, character) => ({ path, line, character })
const sample = [
  loc('src/a.ts', 5, 2), loc('src/a.ts', 2, 9), loc('src/b.ts', 0, 0),
  loc('src/sub/c.ts', 7, 1), loc('README.md', 1, 0),
]

test('文件分组：按路径排序、行号升序、计数正确', () => {
  const groups = groupUsagesByFile(sample)
  assert.deepEqual(groups.map(group => group.path), ['README.md', 'src/a.ts', 'src/b.ts', 'src/sub/c.ts'])
  assert.deepEqual(groups[1].locations.map(location => location.line), [2, 5])
  assert.equal(groups[1].count, 2)
})

test('目录树：目录在前、目录 count 是子树合计、文件里有位置', () => {
  const root = buildUsageTree(sample, 'proj')
  assert.equal(root.count, 5)
  assert.deepEqual(root.children.map(node => node.name), ['src', 'README.md'])
  const src = root.children[0]
  assert.equal(src.kind, 'directory')
  assert.equal(src.count, 4)
  assert.deepEqual(src.children.map(node => node.name), ['sub', 'a.ts', 'b.ts'])
  assert.equal(src.children[1].kind, 'file')
  assert.deepEqual(src.children[1].locations.map(location => location.line), [2, 5])
})

test('奇怪输入不炸：空路径与空字符位置被跳过', () => {
  const root = buildUsageTree([null, { path: '', line: 1 }, loc('a/b.ts', 0)], 'p')
  assert.equal(root.count, 1)
  assert.deepEqual(groupUsagesByFile([null, { path: '' }]), [])
})

test('导出文本：标题 + path:line（1 基）、按文件分组；剪贴板形式同文件合并', () => {
  const text = exportUsagesText([loc('src/a.ts', 4, 0), loc('src/a.ts', 0, 0), loc('b.ts', 2, 0)], '查找「foo」的用法')
  assert.equal(text, '查找「foo」的用法\n\nb.ts:3\nsrc/a.ts:1\nsrc/a.ts:5')
  assert.equal(usagesClipboardText([loc('src/a.ts', 4, 0), loc('src/a.ts', 0, 0)]), 'src/a.ts: 1, 5')
  assert.equal(exportUsagesText([]), '')
})

test('摘要与 Windows 分隔符归一', () => {
  assert.equal(usageSummary(sample), '5 处引用 / 4 个文件')
  const tree = buildUsageTree([loc('src\\a\\b.ts', 1)], 'p')
  assert.deepEqual(tree.children.map(node => node.name), ['src'])
  assert.equal(tree.count, 1)
})
