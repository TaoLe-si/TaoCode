// 层级视图导出 / 固定标签页（`src/hierarchyExport.ts`）：缩进文本、剪贴板形式、钉住去重。
// 文本形状的上游依据：`platform/lang-impl/src/com/intellij/ide/hierarchy/ExporterToTextFileHierarchy.java`
// —— 子级缩进 = `indent + "    "`（**:33**，四个空格）、每行只打
// `descriptor.getHighlightedText().getText()`（**:36**）、 invisible 根不打印（**:32** 的
// `node.getParent() != null` 分支与 **:39-41** 的 else）。
// 而 LSP 层级节点的高亮文本 = `name` + 可选的 `" : detail"`，**不含位置**
// （`platform/lsp-impl/src/impl/features/hierarchy/LspHierarchyNodeDescriptor.kt:25`/`:28`）。
// 位置列（`path:line`，1 基）走剪贴板形式那一条 —— 两条用例各守各的意图。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  closePinnedHierarchy, exportHierarchyText, hierarchyClipboardText, hierarchySummary, hierarchyTabKey, pinHierarchy,
} from '../src/hierarchyExport.ts'

const node = (name, path, line, children = [], recursive = false, detail = undefined) => ({
  item: { name, path, line, ...(detail === undefined ? {} : { detail }) }, children, recursive,
})

test('导出文本：四空格缩进 + 名字（可选 : detail）、递归节点带 …，位置不在这一路', () => {
  const tree = [node('run', 'src/A.java', 4, [node('step', 'src/A.java', 9, [], true)])]
  assert.equal(exportHierarchyText(tree, '调用方'), '调用方:\n\nrun\n    … step')
  assert.equal(exportHierarchyText(tree), 'run\n    … step')
  // 第三层 = 八个空格（`ExporterToTextFileHierarchy.java:33` 的逐层累加）。
  const deeper = [node('a', 'p', 0, [node('b', 'p', 1, [node('c', 'p', 2)])])]
  assert.equal(exportHierarchyText(deeper), 'a\n    b\n        c')
  // `LspHierarchyNodeDescriptor.kt:28` 的 `" : detail"` 尾巴（detail 是 `Container` 这类声明串）。
  assert.equal(exportHierarchyText([node('run', 'p', 0, [], false, 'void')]), 'run : void')
  // 没有位置也不该被编进文本里（旧断言写的 `(src/A.java:5)` 不属于上游这一路，位置见剪贴板形式）。
  assert.equal(exportHierarchyText([{ item: { name: 'x', path: 'p' } }]), 'x')
})

test('剪贴板形式：去重保序、每行位置 + 名字', () => {
  const tree = [node('a', 'x.ts', 0, [node('a', 'x.ts', 0), node('b', 'y.ts', 2)])]
  assert.equal(hierarchyClipboardText(tree), 'x.ts:1  a\ny.ts:3  b')
})

test('摘要：根数与节点总数', () => {
  assert.equal(hierarchySummary([node('a', 'p', 0, [node('b', 'p', 1)])]), '1 个根 · 2 个节点')
  assert.equal(hierarchySummary([]), '0 个根 · 0 个节点')
})

test('钉住：同根同方向同位置不重复开；关闭按 id', () => {
  const pinned = pinHierarchy([], { root: 'run', kind: 'call', direction: 'incoming', path: 'src/A.java', line: 4 })
  assert.equal(pinned.length, 1)
  assert.equal(pinned[0].id, hierarchyTabKey('call', 'incoming', 'src/A.java', 4))
  const again = pinHierarchy(pinned, { root: 'run', kind: 'call', direction: 'incoming', path: 'src/A.java', line: 4 })
  assert.equal(again.length, 1)
  assert.notEqual(again, pinned, '返回新数组，不改入参')
  const other = pinHierarchy(pinned, { root: 'run', kind: 'type', direction: 'supertypes', path: 'src/A.java', line: 4 })
  assert.equal(other.length, 2)
  assert.equal(closePinnedHierarchy(other, other[0].id).length, 1)
})
