// EP 判据：`com.intellij.navbar` 的宿主（`src/navBarModel.ts`）。
//
// 上游依据：EP 声明 `platform/platform-impl/resources/intellij.platform.ide.impl.xml:433`
// `<extensionPoint qualifiedName="com.intellij.navbar" interface="com.intellij.ide.navigationToolbar.NavBarModelExtension" dynamic="true"/>`。
// 三件事：① bundled 默认扩展仍在且兜底；② 第三方按 EP id 挂的扩展被真实装配点 `createNavBarModel()` 合并；
// ③ EP id 逐字等于上游。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_NAV_BAR_EXTENSION, NAV_BAR_EXTENSION_EP, createNavBarModel, navBarExtensionsFromExtensions,
  registerNavBarExtension, unregisterNavBarExtension,
} from '../src/navBarModel.ts'

test('EP id 逐字等于上游 qualifiedName', () => {
  assert.equal(NAV_BAR_EXTENSION_EP, 'com.intellij.navbar')
})

test('bundled 默认扩展仍在 EP 上', () => {
  assert.ok(navBarExtensionsFromExtensions().includes(DEFAULT_NAV_BAR_EXTENSION), '默认扩展挂在 EP 上')
})

test('第三方按 EP id 注册后被真实装配点合并（自定义先于默认）', () => {
  const handle = registerNavBarExtension('acme', {
    getPresentableText: element => (element.kind === 'file' ? `ACME:${element.name}` : null),
  })
  try {
    const model = createNavBarModel({ rootName: 'demo', extensions: [] })
    assert.equal(model.presentableText({ kind: 'file', path: 'a/b.ts', name: 'b.ts' }), 'ACME:b.ts',
      '第三方扩展生效')
    // 默认扩展仍兜底：目录段没有第三方命中 ⇒ 用元素自带名字。
    assert.equal(model.presentableText({ kind: 'dir', path: 'a', name: 'a' }), 'a', '默认兜底仍在')
  } finally {
    handle.dispose()
  }
  assert.equal(createNavBarModel({ rootName: 'demo', extensions: [] })
    .presentableText({ kind: 'file', path: 'a/b.ts', name: 'b.ts' }), 'b.ts', '注销后第三方扩展不再生效')
})

test('unregister 返回真值语义', () => {
  assert.equal(unregisterNavBarExtension('does-not-exist'), false)
})
