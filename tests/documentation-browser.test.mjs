// 判据 · lp/documentation 的**文档浏览器**（`DocumentationBrowser` / `DocumentationToolWindowUI`
// 的可复用/钉住两档）。钉四件事：
//   ① `open`/`nextPage` 的换页语义（reset 清历史、否则压历史）；
//   ② `keep` 只影响"自动更新"这一档：`reusable` 转 false、标题去掉 `* `、历史照旧可翻；
//   ③ `shouldAutoUpdate` 的闸（钉住后不刷）；
//   ④ `reload` 不动历史、`currentExternalUrl` 随页走、`close` 清历史。
import test from 'node:test'
import assert from 'node:assert/strict'

import { createDocumentationBrowser } from '../src/documentationBrowser.ts'

const page = (id, title, value, externalUrl) => ({ id, title, value, externalUrl })

test('open：第一页不压历史；换页压历史（可后退）', () => {
  const browser = createDocumentationBrowser()
  browser.open(page('a', 'A', 'doc-a'))
  assert.equal(browser.canBackward(), false, '第一页没有上一页')
  browser.open(page('b', 'B', 'doc-b'))
  assert.equal(browser.canBackward(), true)
  assert.equal(browser.current().page.id, 'b')
  assert.equal(browser.backward(), true)
  assert.equal(browser.current().page.id, 'a')
})

test('open(reset = true) 清空历史（上游 resetBrowser）', () => {
  const browser = createDocumentationBrowser()
  browser.open(page('a', 'A', 'a'))
  browser.open(page('b', 'B', 'b'))
  assert.equal(browser.canBackward(), true)
  browser.open(page('c', 'C', 'c'), true)
  assert.equal(browser.canBackward(), false, 'reset 之后历史清空')
  assert.equal(browser.current().page.id, 'c')
})

test('可复用页标题带 `* `；keep 之后去掉并关掉自动更新', () => {
  const browser = createDocumentationBrowser()
  browser.open(page('a', 'Foo.bar()', 'doc'))
  assert.equal(browser.current().displayTitle, '* Foo.bar()', '可复用页带星号前缀')
  assert.equal(browser.isReusable(), true)
  assert.equal(browser.shouldAutoUpdate(), true)
  assert.equal(browser.keep(), true)
  assert.equal(browser.current().displayTitle, 'Foo.bar()', '钉住后去掉星号')
  assert.equal(browser.isReusable(), false)
  assert.equal(browser.shouldAutoUpdate(), false, '钉住后光标移动不再刷新')
  assert.equal(browser.keep(), false, '已经钉住了，再钉一次没有变化')
})

test('keep 不动历史：钉住之后仍可前后翻', () => {
  const browser = createDocumentationBrowser()
  browser.open(page('a', 'A', 'a'))
  browser.open(page('b', 'B', 'b'))
  browser.keep()
  assert.equal(browser.canBackward(), true)
  browser.backward()
  assert.equal(browser.current().page.id, 'a')
})

test('reload：换内容不动历史，返回内容是否变化', () => {
  const browser = createDocumentationBrowser()
  browser.open(page('a', 'A', 'a1'))
  browser.open(page('b', 'B', 'b'))
  assert.equal(browser.reload('b2'), true)
  assert.equal(browser.current().page.value, 'b2')
  assert.equal(browser.canBackward(), true, 'reload 不压也不清历史')
  assert.equal(browser.reload('b2'), false, '内容没变')
})

test('currentExternalUrl 随页走；没有页/没有链接都是 null', () => {
  const browser = createDocumentationBrowser()
  assert.equal(browser.currentExternalUrl(), null)
  browser.open(page('a', 'A', 'a', 'https://docs/x'))
  assert.equal(browser.currentExternalUrl(), 'https://docs/x')
  browser.open(page('b', 'B', 'b'))
  assert.equal(browser.currentExternalUrl(), null, '这一页没有外部链接')
  browser.reload('b', 'https://docs/y')
  assert.equal(browser.currentExternalUrl(), 'https://docs/y')
})

test('close 清页与历史', () => {
  const browser = createDocumentationBrowser()
  browser.open(page('a', 'A', 'a'))
  browser.open(page('b', 'B', 'b'))
  browser.close()
  assert.equal(browser.current(), null)
  assert.equal(browser.canBackward(), false)
  assert.equal(browser.canForward(), false)
  assert.equal(browser.shouldAutoUpdate(), false)
})

test('forward 与 backward 对称', () => {
  const browser = createDocumentationBrowser()
  browser.open(page('a', 'A', 'a'))
  browser.open(page('b', 'B', 'b'))
  browser.backward()
  assert.equal(browser.canForward(), true)
  assert.equal(browser.forward(), true)
  assert.equal(browser.current().page.id, 'b')
})
