// 项目视图的节点装饰（`pv/project-view` 族，上游 `ProjectViewNodeDecorator` 的
// "Highlight files with errors"）：纯规则 + FileTree 的接线。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { decorationClass, decorationOf, decorationTitle, severityCounts } from '../src/projectTreeDecorations.ts'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')

test('严重度计数：只有 LSP 的错误(1)/警告(2)算装饰', () => {
  assert.deepEqual(severityCounts([{ severity: 1 }, { severity: 1 }, { severity: 2 }, { severity: 3 }, { severity: 4 }]),
    { errors: 2, warnings: 1 })
  assert.deepEqual(severityCounts([]), { errors: 0, warnings: 0 })
})

test('装饰档：错误压过警告，无诊断不装饰', () => {
  assert.equal(decorationOf(1, 3), 'error')
  assert.equal(decorationOf(0, 2), 'warning')
  assert.equal(decorationOf(0, 0), 'none')
  assert.equal(decorationClass(decorationOf(2, 0)), 'tree-decoration-error')
  assert.equal(decorationClass(decorationOf(0, 1)), 'tree-decoration-warning')
  assert.equal(decorationClass(decorationOf(0, 0)), '')
})

test('title 后缀只在真有诊断时出现', () => {
  assert.equal(decorationTitle(0, 0), '')
  assert.equal(decorationTitle(1, 0), ' · 1 个错误')
  assert.equal(decorationTitle(0, 2), ' · 2 个警告')
  assert.equal(decorationTitle(3, 1), ' · 3 个错误 · 1 个警告')
})

test('FileTree 把装饰接在真实文件行上，目录/合成行不参与', () => {
  const source = read('../src/components/FileTree.vue')
  assert.match(source, /from '\.\.\/projectTreeDecorations'/)
  assert.match(source, /lspDiagnostics/)
  assert.match(source, /row\.entry\.kind !== 'file' \|\| row\.entry\.path\.startsWith\('\\u0000'\)/)
  assert.match(source, /rowClassOf\(row\)/)
  assert.match(source, /:title="titleOf\(row\)"/)
  assert.match(source, /\.tree-decoration-error \.tree-name/)
  assert.match(source, /\.tree-decoration-warning \.tree-name/)
})
