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
  assert.match(source, /import \{ nodeDecorationFor, severityCounts \} from '\.\.\/projectTreeDecorations'/)
  assert.match(source, /lspDiagnostics/)
  // 合成行（NUL 前缀）不进装饰；诊断计数只对真实文件行取。
  assert.match(source, /if \(row\.synthetic \|\| row\.entry\.path\.startsWith\('\\u0000'\)\) return \{\}/)
  assert.match(source, /row\.entry\.kind === 'file' \? diagnosticCounts\.value\.get\(row\.entry\.path\)/)
  // 组装点收在 `src/projectTreeDecorations.ts` 的 nodeDecorationFor（内建诊断那支与第三方走同一条 EP）。
  assert.match(source, /return nodeDecorationFor\(\{/, '装饰经组装点 nodeDecorationFor 走 EP')
  assert.match(source, /rowClassOf\(row\)/)
  // 类名只有组装点那一份：此前又用 decorationClass(diagnosticKindOfRow(...)) 拼了一遍同样的后缀
  // ⇒ 行上出现两个同名类。这两条钉住重复拼的那份不会再回来。
  assert.doesNotMatch(source, /diagnosticKindOfRow/)
  assert.doesNotMatch(source, /decorationClass\(/)
  // 2026-10-07 ptree-epclose：模板改成读记忆化的 `rowsView`（class/title/name/icon 四个消费点一次算完），
  // 装饰的类名与 tooltip 仍逐行绑在真实文件行上（`viewOf(row)` 回落到 `rowClassOf`/`titleOf`）。
  assert.match(source, /viewOf\(row\)\?\.className/, '装饰类名仍绑到行上')
  assert.match(source, /:title="viewOf\(row\)\?\.title"/)
  assert.match(source, /\.tree-decoration-error \.tree-name/)
  assert.match(source, /\.tree-decoration-warning \.tree-name/)
})
