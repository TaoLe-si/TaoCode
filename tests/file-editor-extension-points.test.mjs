// 判据 · **文件编辑器与标签的扩展点**（`src/fileEditorExtensionPoints.ts`，上游
// `EditorEmptyStateComponentProvider` / `EditorFileSwapper` / `EditorCompositeProvider` 一族）。
//
// 钉四件事：
//   ① 三条 EP 的 id 与上游各处的 `ExtensionPointName`（文件头逐行出处）逐字一致，且已在宿主里声明；
//   ② 贡献者按 id 注册/注销生效；
//   ③ 消费面真的读 EP：`editorEmptyStateFor` 取第一个可用且造得出组件的、`fileToSwapTo` 取第一个
//      非空返回的、`editorCompositeProviderFor` 取第一个认领的；
//   ④ bundled 兜底空状态以 `order="last"` 挂，第三方空状态压过它、它仍兜底。
import test from 'node:test'
import assert from 'node:assert/strict'

import { EXTENSIONS } from '../src/extensionPoints.ts'
import {
  BUILTIN_EMPTY_STATE_ID,
  BUILTIN_EMPTY_STATE_TOKEN,
  EDITOR_COMPOSITE_PROVIDER_EP,
  EDITOR_EMPTY_STATE_COMPONENT_PROVIDER_EP,
  EDITOR_FILE_SWAPPER_EP,
  builtinEditorEmptyStateProvider,
  editorCompositeProviderFor,
  editorEmptyStateFor,
  editorEmptyStateProviders,
  fileToSwapTo,
  registerBundledEditorEmptyState,
  registerEditorCompositeProvider,
  registerEditorEmptyStateComponentProvider,
  registerEditorFileSwapper,
} from '../src/fileEditorExtensionPoints.ts'

const emptySurroundings = { hasTabs: false, tabCount: 0, columnCount: 1, activeColumn: 0 }
const withTabs = { hasTabs: true, tabCount: 2, columnCount: 1, activeColumn: 0 }
const composite = { activeColumn: 0, tabPaths: ['src/A.java'] }

test('三条 EP 已声明，id 与上游 qualifiedName 逐字一致', () => {
  assert.equal(EDITOR_EMPTY_STATE_COMPONENT_PROVIDER_EP, 'com.intellij.editorEmptyStateComponentProvider')
  assert.equal(EDITOR_FILE_SWAPPER_EP, 'com.intellij.editorFileSwapper')
  assert.equal(EDITOR_COMPOSITE_PROVIDER_EP, 'com.intellij.editorCompositeProvider')
  for (const id of [EDITOR_EMPTY_STATE_COMPONENT_PROVIDER_EP, EDITOR_FILE_SWAPPER_EP, EDITOR_COMPOSITE_PROVIDER_EP]) {
    assert.equal(EXTENSIONS.hasExtensionPoint(id), true, `${id} 未声明`)
  }
})

test('第三方空状态提供方按 id 注册后被 editorEmptyStateFor 拿到', () => {
  const handle = registerEditorEmptyStateComponentProvider({
    id: 'demo.empty',
    isAvailable: s => s.columnCount > 1,
    isFullContent: () => true,
    createComponent: () => ({ tokenClass: 'demo-empty', text: 'demo', fullContent: true }),
    claimsFocus: () => true,
  })
  try {
    assert.ok(editorEmptyStateProviders().some(p => p.id === 'demo.empty'))
    const picked = editorEmptyStateFor({ ...emptySurroundings, columnCount: 2 })
    assert.equal(picked.provider.id, 'demo.empty')
    assert.equal(picked.view.fullContent, true, 'isFullContent 由提供方补上')
    assert.equal(picked.view.claimsFocus, true)
    assert.equal(editorEmptyStateFor(emptySurroundings), null, '单栏时这一档不可用')
  } finally { handle.dispose() }
  assert.equal(editorEmptyStateProviders().some(p => p.id === 'demo.empty'), false)
})

test('文件切换器取第一个非空返回；容器提供方取第一个认领的', () => {
  const noop = registerEditorFileSwapper({ id: 'demo.swap.null', getFileToSwapTo: c => c.tabPaths.length ? null : null })
  const real = registerEditorFileSwapper({
    id: 'demo.swap.real',
    getFileToSwapTo: c => c.tabPaths.length ? { path: 'src/A.class', line: 3 } : null,
  })
  const compositeProvider = registerEditorCompositeProvider({
    id: 'demo.composite', accepts: c => c.tabPaths.length > 0, containerId: 'demo-container',
  })
  try {
    const picked = fileToSwapTo(composite)
    assert.equal(picked.swapper.id, 'demo.swap.real')
    assert.deepEqual(picked.target, { path: 'src/A.class', line: 3 })
    assert.equal(fileToSwapTo({ activeColumn: 0, tabPaths: [] }), null, '没有非空返回时为 null')
    assert.equal(editorCompositeProviderFor(composite)?.containerId, 'demo-container')
    assert.equal(editorCompositeProviderFor({ activeColumn: 0, tabPaths: [] }), null)
  } finally {
    noop.dispose(); real.dispose(); compositeProvider.dispose()
  }
})

test('bundled 兜底空状态以 order=last 挂，第三方压过它、它仍兜底', () => {
  const dispose = registerBundledEditorEmptyState('打开一个文件开始编辑。')
  const third = registerEditorEmptyStateComponentProvider({
    id: 'demo.high', createComponent: () => ({ tokenClass: 'demo-high', fullContent: false }),
  })
  try {
    const picked = editorEmptyStateFor(emptySurroundings)
    assert.equal(picked.provider.id, 'demo.high', '第三方排在兜底前面')
    assert.equal(builtinEditorEmptyStateProvider('x').getKind(), 'LIGHT')
  } finally {
    third.dispose()
    // 第三方撤走后兜底仍在
    const fallback = editorEmptyStateFor(emptySurroundings)
    assert.equal(fallback.provider.id, BUILTIN_EMPTY_STATE_ID)
    assert.equal(fallback.view.text, '打开一个文件开始编辑。')
    assert.equal(fallback.view.tokenClass, BUILTIN_EMPTY_STATE_TOKEN)

    // 有标签时兜底不可用
    assert.equal(editorEmptyStateFor(withTabs), null)
  }
  dispose()
  assert.equal(editorEmptyStateFor(emptySurroundings), null, '兜底也撤走后为空')
})

test('内建兜底构建器（白盒）', () => {
  const provider = builtinEditorEmptyStateProvider('hi')
  assert.equal(provider.isAvailable({ hasTabs: false, tabCount: 0, columnCount: 1, activeColumn: 0 }), true)
  assert.equal(provider.isAvailable({ hasTabs: true, tabCount: 1, columnCount: 1, activeColumn: 0 }), false)
  assert.equal(provider.isFullContent({ hasTabs: false, tabCount: 0, columnCount: 1, activeColumn: 0 }), false)
})
