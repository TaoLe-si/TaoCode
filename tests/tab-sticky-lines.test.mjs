// 粘性作用域行接上**语言 provider**（`lp/sticky-lines`）。
//
// 之前 `src/stickyLines.ts` 自带一张通用白名单，`src/stickyLineProviders.ts` 的「语言 → SymbolKind」
// 表只在面包屑那一侧用（`src/breadcrumbs.ts`），于是编辑器顶边对 Java/TypeScript/Python 一视同仁。
// 上游的口径是每种语言自己的 `StickyLinesProvider`（`platform/lang-impl/.../codeInsight/stickyLines/`），
// 本仓的等价物就是那张表：这里判它**真的被接线进了渲染路径**。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ref } from 'vue'

import { createStickyLines, isScopeSymbol, stickyScopes } from '../src/stickyLines.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')
const app = read('src/App.vue')
const view = read('src/stickyLines.ts')

const symbol = (name, kind, startLine, endLine) => ({ name, kind, detail: '', startLine, startChar: 0, endLine, endChar: 0 })

// StickyLinesProvider 的三张语言表（src/stickyLineProviders.ts:33-42）。
test('按语言挑作用域：Java 不认 struct / namespace，TypeScript 认 module，C++ 认 struct', () => {
  const struct = symbol('Point', 23, 0, 10)
  const namespace = symbol('app', 3, 0, 10)
  const module = symbol('index', 2, 0, 10)
  const fn = symbol('run', 12, 2, 4)
  assert.equal(isScopeSymbol(struct, 'cpp'), true)
  assert.equal(isScopeSymbol(struct, 'java'), false, 'Java 的表里没有 Struct')
  assert.equal(isScopeSymbol(namespace, 'java'), false)
  assert.equal(isScopeSymbol(namespace, 'cpp'), true)
  assert.equal(isScopeSymbol(module, 'typescript'), true)
  assert.equal(isScopeSymbol(module, 'cpp'), false, 'C++ 的表里没有 Module')
  assert.equal(isScopeSymbol(module, 'python'), false, '通用兜底不含整文件层（stickyLineProviders.ts:29-30）')
  assert.equal(isScopeSymbol(fn, 'java'), false, 'Java 的表里没有 Function（只有 Method/Constructor）')
  assert.equal(isScopeSymbol(fn, 'typescript'), true)
  // 未定语言走通用兜底：struct 算、module 不算。
  assert.equal(isScopeSymbol(struct, undefined), true)
  assert.equal(isScopeSymbol(module, undefined), false)
  // 合法性判据（行号/名字）不变。
  assert.equal(isScopeSymbol(symbol('', 5, 0, 1), 'java'), false)
  assert.equal(isScopeSymbol(symbol('x', 5, 3, 2), 'java'), false)
})

test('stickyScopes 按语言过滤：Java 里那个 struct 不占粘性行', () => {
  const outline = [symbol('Holder', 5, 0, 20), symbol('Point', 23, 4, 8), symbol('inner', 6, 5, 7)]
  assert.deepEqual(stickyScopes(outline, 6, 'java').map(entry => entry.name), ['Holder', 'inner'])
  assert.deepEqual(stickyScopes(outline, 6, 'cpp').map(entry => entry.name), ['Holder', 'Point', 'inner'])
  assert.deepEqual(stickyScopes(outline, 6).map(entry => entry.name), ['Holder', 'Point', 'inner'], '未知语言 = 通用兜底')
})

test('createStickyLines 把语言接到底层规则上', () => {
  const outline = ref([symbol('Holder', 5, 0, 20), symbol('Point', 23, 4, 8)])
  const settings = ref({ showStickyLines: true, stickyLinesLimit: 5 })
  const line = () => 6
  const asJava = createStickyLines({ editorSettings: settings, outline, currentLine: line, language: () => 'java' })
  const asCpp = createStickyLines({ editorSettings: settings, outline, currentLine: line, language: () => 'cpp' })
  assert.deepEqual(asJava.stickyLines.value.map(entry => entry.name), ['Holder'])
  assert.deepEqual(asCpp.stickyLines.value.map(entry => entry.name), ['Holder', 'Point'])
  // 没传 language 的旧调用方（语言未定）走通用兜底。
  const noLanguage = createStickyLines({ editorSettings: settings, outline, currentLine: line })
  assert.deepEqual(noLanguage.stickyLines.value.map(entry => entry.name), ['Holder', 'Point'])
})

test('那张重复的通用白名单已经删掉（kind 的唯一真源是语言 provider 表）', () => {
  assert.doesNotMatch(view, /const SCOPE_KINDS/, 'stickyLines.ts 里不该再留第二份 kind 表（会与 provider 表漂移）')
  assert.match(view, /stickySymbolAccepted, filterStickySymbols.*from '\.\/stickyLineProviders\.ts'/, '没有接上语言 provider')
})

// —— 接线：App.vue 的 createStickyLines 得真的把当前编辑器的语言喂进去 ——
test('App.vue 把当前编辑器的语言喂给 createStickyLines', () => {
  assert.match(app, /createStickyLines\(\{[^}]*language: \(\) => \(active\.value \? associationOf\(active\.value\.path, active\.value\.content\) : undefined\)/,
    'createStickyLines 没拿到语言：顶边渲染仍然只过通用表')
  // 反证：去掉 language 必须被这条抓到。
  const without = "createStickyLines({ editorSettings, outline, currentLine: () => active.value?.line })"
  assert.ok(!/language:/.test(without), '反例本该不合格')
})
