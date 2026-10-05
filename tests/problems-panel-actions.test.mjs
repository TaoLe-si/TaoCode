// dm/quickfix 的判据（四）：接线 —— 问题面板行菜单与 fix-all 的源码锚点。
// 组件本身不可在 node --test 里渲染，所以这里钉住"行为挂在真实链路上"的锚点：
//   · 抑制条目：suppressOptionsFor → suppressionEditFor → file.write → noteLocalSuppression → lsp.change；
//   · 快速修复：行菜单取 codeAction → 预览 → file.write → lsp.change；
//   · fix-all：semanticActions 先试文件级 `source.fixAll` 再落逐条循环。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const root = new URL('..', import.meta.url)
const read = path => readFileSync(new URL(path, root), 'utf8')

test('行菜单：逐行「操作」入口 + 抑制/修复/级别/文件四段', () => {
  const panel = read('src/components/ProblemsPanel.vue')
  assert.match(panel, /@click\.stop="openRowMenu\(p, \$event\)"/)
  assert.match(panel, /抑制此检查（写入文件）/)
  assert.match(panel, /快速修复（应用前预览）/)
  assert.match(panel, /高亮级别/)
})

test('抑制动作接进真实写入链路（读文件 → 应用编辑 → CAS 写入 → 通知语言服务 → 本地隐去）', () => {
  const panel = read('src/components/ProblemsPanel.vue')
  assert.match(panel, /suppressOptionsFor\(problem, suppressionLanguageFor\(row\.path\)\)/)
  assert.match(panel, /alreadySuppressed\(doc\.content, row\.line, option\)/)
  assert.match(panel, /suppressionEditFor\(doc\.content\.split\('\\n'\), menu\.row\.line, entry\.option\)/)
  assert.match(panel, /applyTextEdits\(doc\.content, \[edit\]\)/)
  assert.match(panel, /request<SaveResult>\('file\.write'/)
  assert.match(panel, /expectedVersion: doc\.version/)
  assert.match(panel, /noteLocalSuppression\(menu\.row\)/)
  assert.match(panel, /request\('lsp\.change', \{ path: menu\.row\.path, text: next \}\)/)
})

test('抑制菜单跳过已抑制的行（上游 isAvailable 口径）', () => {
  const panel = read('src/components/ProblemsPanel.vue')
  assert.match(panel, /\.filter\(option => !alreadySuppressed/)
})

test('fix-all：先试文件级 source.fixAll，再落逐条无歧义修复', () => {
  const semantic = read('src/semanticActions.ts')
  assert.match(semantic, /applyFileLevelCleanup/)
  assert.match(semantic, /item\.kind\?\.startsWith\('source\.fixAll'\)/)
  assert.match(semantic, /await applyFileLevelCleanup\(tab\.path\)/)
  // 逐条循环仍在（服务器没有文件级 cleanup 时的既有路径）。
  assert.match(semantic, /for \(let pass = 0; pass < 25; \+\+pass\)/)
})

test('面板工具栏仍有 fix-all 入口（emit('+"'fixAll'"+') → App.vue 的 fixAllInFile）', () => {
  const panel = read('src/components/ProblemsPanel.vue')
  assert.match(panel, /@click="emit\('fixAll'\)"/)
  assert.match(read('src/App.vue'), /@fix-all="fixAllInFile"/)
})
