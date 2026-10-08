// 判据 · **快速文档的扩展点**（`src/documentationExtensionPoints.ts`，上游
// `DocumentationActionProvider` / `DocumentationCssProvider` / `DocToolWindowManager` /
// `DocRenderItemUpdateProvider` 一族）。
//
// 钉四件事：
//   ① 四条 EP 的 id 与上游各自的 `ExtensionPointName`（文件头逐行出处）逐字一致，且已在宿主里声明；
//   ② 贡献者按 id 注册/注销生效，动作提供方按语言过滤；
//   ③ 消费面真的读 EP：`documentationActions` 收全表、`docActionEnabled` 尊重谓词、
//      `documentationCss` 拼接、`docRenderItems` 拼接；
//   ④ bundled 两条贡献（三条动作 + 一段 CSS）真的能被消费点拿到，外链为空时「在浏览器中打开」不可用。
import test from 'node:test'
import assert from 'node:assert/strict'

import { EXTENSIONS } from '../src/extensionPoints.ts'
import {
  BUILTIN_DOC_CSS_ID,
  BUILTIN_DOC_HISTORY_BACK_ID,
  BUILTIN_DOC_HISTORY_FORWARD_ID,
  BUILTIN_OPEN_IN_BROWSER_ID,
  DOC_RENDER_ITEM_UPDATE_PROVIDER_EP,
  DOC_TOOL_WINDOW_MANAGER_EP,
  DOCUMENTATION_ACTION_PROVIDER_EP,
  DOCUMENTATION_CSS_PROVIDER_EP,
  DOCUMENTATION_TOOL_WINDOW_ID,
  builtinDocumentationCssProvider,
  docActionEnabled,
  docRenderItems,
  docToolWindowManagers,
  documentationActionProviders,
  documentationActions,
  documentationCss,
  registerBundledDocumentationContributions,
  registerDocRenderItemUpdateProvider,
  registerDocToolWindowManager,
  registerDocumentationActionProvider,
  registerDocumentationCssProvider,
} from '../src/documentationExtensionPoints.ts'

const ctx = (over = {}) => ({ path: 'src/A.java', renderedText: '<p>x</p>', externalUrl: null, inlineEditor: false, ...over })

test('四条 EP 已声明，id 与上游 qualifiedName 逐字一致', () => {
  assert.equal(DOCUMENTATION_ACTION_PROVIDER_EP, 'com.intellij.documentationActionProvider')
  assert.equal(DOCUMENTATION_CSS_PROVIDER_EP, 'com.intellij.documentationCssProvider')
  assert.equal(DOC_TOOL_WINDOW_MANAGER_EP, 'com.intellij.lang.documentationToolWindowManager')
  assert.equal(DOC_RENDER_ITEM_UPDATE_PROVIDER_EP, 'com.intellij.codeInsight.documentation.render.itemUpdateProvider')
  for (const id of [DOCUMENTATION_ACTION_PROVIDER_EP, DOCUMENTATION_CSS_PROVIDER_EP, DOC_TOOL_WINDOW_MANAGER_EP, DOC_RENDER_ITEM_UPDATE_PROVIDER_EP]) {
    assert.equal(EXTENSIONS.hasExtensionPoint(id), true, `${id} 未声明`)
  }
})

test('第三方动作提供方按 id 注册后被 documentationActions 拿到；按语言过滤', () => {
  const java = registerDocumentationActionProvider({
    id: 'demo.docActions.java', languages: ['java'],
    additionalActions: () => [{ id: 'demo.act', title: '演示动作', run: () => {} }],
  })
  const ts = registerDocumentationActionProvider({
    id: 'demo.docActions.ts', languages: ['typescript'],
    additionalActions: () => [{ id: 'demo.tsAct', title: 'TS 动作', run: () => {} }],
  })
  try {
    assert.ok(documentationActionProviders('java').some(p => p.id === 'demo.docActions.java'))
    assert.equal(documentationActionProviders('java').some(p => p.id === 'demo.docActions.ts'), false)
    assert.ok(documentationActions(ctx(), 'java').some(a => a.id === 'demo.act'))
    assert.equal(documentationActions(ctx(), 'java').some(a => a.id === 'demo.tsAct'), false)
  } finally {
    java.dispose(); ts.dispose()
  }
  assert.equal(documentationActionProviders('java').some(p => p.id === 'demo.docActions.java'), false)
})

test('动作可用性谓词被 docActionEnabled 尊重', () => {
  const enabled = { id: 'e', title: 't', enabled: c => !!c.externalUrl, run: () => {} }
  assert.equal(docActionEnabled(enabled, ctx({ externalUrl: 'https://x' })), true)
  assert.equal(docActionEnabled(enabled, ctx()), false)
  assert.equal(docActionEnabled({ id: 'n', title: 't', run: () => {} }, ctx()), true, '无谓词即恒可用')
})

test('CSS 提供方与 render 条目被消费面拼接', () => {
  const css = registerDocumentationCssProvider({ id: 'demo.css', generateCss: () => '.x{}' })
  const items = registerDocRenderItemUpdateProvider({
    id: 'demo.items', getItems: () => [{ start: 0, end: 3, text: 'abc', tokenClass: 'doc-link' }],
  })
  try {
    assert.equal(documentationCss(() => 12, false).includes('.x{}'), true)
    assert.deepEqual(docRenderItems(ctx()).map(i => i.text), ['abc'])
  } finally {
    css.dispose(); items.dispose()
  }
  assert.equal(documentationCss(() => 12, false).includes('.x{}'), false)
  assert.equal(docRenderItems(ctx()).length, 0)
})

test('文档工具窗管理器按语言取；工具窗 id 与上游逐字一致', () => {
  const manager = registerDocToolWindowManager({
    id: 'demo.docWindow', language: 'java', toolWindowId: DOCUMENTATION_TOOL_WINDOW_ID,
  })
  try {
    assert.equal(DOCUMENTATION_TOOL_WINDOW_ID, 'documentation.v2')
    assert.deepEqual(docToolWindowManagers('java').map(m => m.id), ['demo.docWindow'])
    assert.equal(docToolWindowManagers('typescript').length, 0)
  } finally { manager.dispose() }
})

test('bundled 三条动作 + 一段 CSS 挂上后消费点真的拿到', () => {
  const opened = []
  const history = []
  const dispose = registerBundledDocumentationContributions(
    url => opened.push(url),
    direction => history.push(direction),
    direction => direction === 'back',
  )
  try {
    const actions = documentationActions(ctx({ externalUrl: 'https://example.test/doc' }), 'java')
    const open = actions.find(a => a.id === BUILTIN_OPEN_IN_BROWSER_ID)
    assert.ok(open)
    open.run(ctx({ externalUrl: 'https://example.test/doc' }))
    assert.deepEqual(opened, ['https://example.test/doc'])

    const back = actions.find(a => a.id === BUILTIN_DOC_HISTORY_BACK_ID)
    back.run(ctx())
    assert.deepEqual(history, ['back'])

    // 外链为空时「在浏览器中打开」不可用
    const bare = documentationActions(ctx(), 'java')
    assert.equal(docActionEnabled(bare.find(a => a.id === BUILTIN_OPEN_IN_BROWSER_ID), ctx()), false)
    // 前进可用性由 canGo 决定（此处只 back 可用）
    assert.equal(docActionEnabled(bare.find(a => a.id === BUILTIN_DOC_HISTORY_FORWARD_ID), ctx()), false)

    const css = documentationCss(token => token === 'doc.base' ? 13 : 1, true)
    assert.ok(css.includes('13px'))
    assert.ok(css.includes('doc-body--inline'))
    assert.ok(documentationCss(token => 13, true).length > 0)
  } finally { dispose() }
  assert.equal(documentationActions(ctx({ externalUrl: 'u' }), 'java').length, 0)
})

test('内建 CSS 提供方按 inline 两态产出（白盒）', () => {
  const provider = builtinDocumentationCssProvider()
  assert.equal(provider.id, BUILTIN_DOC_CSS_ID)
  assert.ok(provider.generateCss(() => 12, false).includes('doc-body--window'))
  assert.ok(provider.generateCss(() => 12, true).includes('doc-body--inline'))
})
