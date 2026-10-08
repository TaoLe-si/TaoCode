// 判据 · **文件编辑器提供者宿主**（`src/fileEditorProviders.ts`，上游
// `com.intellij.openapi.fileEditor.FileEditorProvider` + EP `com.intellij.fileEditorProvider`）——
// "打开一个文件用哪个编辑器"这一格能被第三方按 id 挂。
//
// 每条测试自己注册、自己注销（同一个进程里共享全局 EP 宿主，不收摊会污染后面的断言）。
import test from 'node:test'
import assert from 'node:assert/strict'

import { FILE_EDITOR_PROVIDER_EP, FILE_EDITOR_PROVIDER_SUPPRESSOR_EP } from '../src/extensionPoints.ts'
import {
  editorProviderFor, editorProvidersFor, editorProviderSuppressed, fileEditorProviderCatalog,
  fileEditorProviders, fileEditorProviderSuppressors, registerFileEditorProvider, registerFileEditorProviderSuppressor,
} from '../src/fileEditorProviders.ts'

test('两条 EP id 与上游逐字一致', () => {
  assert.equal(FILE_EDITOR_PROVIDER_EP, 'com.intellij.fileEditorProvider')
  assert.equal(FILE_EDITOR_PROVIDER_SUPPRESSOR_EP, 'com.intellij.fileEditorProviderSuppressor')
})

test('注册 → 取第一个接受的 provider（上游 getProvider 同口径）', () => {
  const handles = []
  try {
    handles.push(registerFileEditorProvider({
      id: 't.p1', getEditorTypeId: () => 'T1',
      accept: input => input.path.endsWith('.a'), createEditor: () => 'ed1',
    }))
    handles.push(registerFileEditorProvider({
      id: 't.p2', getEditorTypeId: () => 'T2',
      accept: input => input.path.endsWith('.b'), createEditor: () => 'ed2',
    }))
    assert.equal(editorProviderFor({ path: 'x.a', root: '/r' }).id, 't.p1')
    assert.equal(editorProviderFor({ path: 'x.b', root: '/r' }).id, 't.p2')
    assert.equal(editorProviderFor({ path: 'x.c', root: '/r' }), undefined, '没人认领 ⇒ 用默认编辑器')
    assert.equal(editorProviderFor({ path: 'x.a', root: '/r' }).createEditor({ path: 'x.a', root: '/r' }), 'ed1')
    // 多支认领时 `editorProvidersFor` 按注册顺序给全表。
    handles.push(registerFileEditorProvider({ id: 't.p3', getEditorTypeId: () => 'T3', accept: () => true, createEditor: () => 'ed3' }))
    assert.deepEqual(editorProvidersFor({ path: 'x.a', root: '/r' }).map(p => p.id), ['t.p1', 't.p3'])
  } finally {
    for (const handle of handles) handle.dispose()
  }
  assert.deepEqual(editorProvidersFor({ path: 'x.a', root: '/r' }).map(p => p.id), [], '收摊后没人认领')
})

test('policy 缺省 NONE；目录写明编辑器类型与摆位', () => {
  const handle = registerFileEditorProvider({
    id: 't.policy', getEditorTypeId: () => 'TPolicy', accept: () => false, createEditor: () => null,
    getPolicy: () => 'PLACE_BEFORE_DEFAULT_EDITOR',
  })
  const catalog = fileEditorProviderCatalog()
  const entry = catalog.find(item => item.id === 't.policy')
  assert.equal(entry.editorTypeId, 'TPolicy')
  assert.equal(entry.policy, 'PLACE_BEFORE_DEFAULT_EDITOR')
  assert.ok(catalog.every(item => item.policy.length > 0), '没有 provider 缺 policy 字段')
  handle.dispose()
})

test('抑制器挡住全部 provider（上游先问 suppressor）', () => {
  const provider = registerFileEditorProvider({ id: 't.supp', getEditorTypeId: () => 'TS', accept: () => true, createEditor: () => null })
  const suppressor = registerFileEditorProviderSuppressor({ id: 't.sup', suppress: input => input.path.endsWith('.locked') })
  try {
    assert.equal(editorProviderSuppressed({ path: 'a.locked', root: '/r' }), true)
    assert.deepEqual(editorProvidersFor({ path: 'a.locked', root: '/r' }), [])
    assert.equal(editorProviderFor({ path: 'a.locked', root: '/r' }), undefined)
    assert.equal(editorProviderSuppressed({ path: 'a.txt', root: '/r' }), false)
    assert.ok(fileEditorProviderSuppressors().some(item => item.id === 't.sup'))
  } finally {
    suppressor.dispose()
    provider.dispose()
  }
  assert.equal(editorProviderSuppressed({ path: 'a.locked', root: '/r' }), false, '注销后不再挡')
})

test('坏贡献（accept 抛错）被跳过，不拖垮整条链', () => {
  const boom = registerFileEditorProvider({ id: 't.boom', getEditorTypeId: () => 'TB', accept: () => { throw new Error('boom') }, createEditor: () => null })
  const good = registerFileEditorProvider({ id: 't.good', getEditorTypeId: () => 'TG', accept: input => input.path === 'ok', createEditor: () => 'ok' })
  try {
    assert.equal(editorProviderFor({ path: 'ok', root: '/r' }).id, 't.good')
    assert.ok(fileEditorProviders().some(p => p.id === 't.boom'), '坏贡献仍在表里（只是不被选中）')
  } finally {
    boom.dispose()
    good.dispose()
  }
})
