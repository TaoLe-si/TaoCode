// 导航栏模型（`src/navBarModel.ts`）：元素链、扩展优先级（自定义先于默认）、
// 根切换扩展与目录 children，以及面包屑段路径的接线。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createNavBarModel, defaultNavBarExtension, navBarCrumbs } from '../src/navBarModel.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('面包屑链：根 + 逐级目录 + 文件，根是空路径', () => {
  const crumbs = navBarCrumbs('src/components/Foo.vue', 'demo')
  assert.deepEqual(crumbs.map(crumb => [crumb.kind, crumb.path, crumb.name]), [
    ['root', '', 'demo'],
    ['dir', 'src', 'src'],
    ['dir', 'src/components', 'components'],
    ['file', 'src/components/Foo.vue', 'Foo.vue'],
  ])
  assert.equal(navBarCrumbs('main.ts', 'demo').length, 2, '根 + 文件')
  assert.equal(navBarCrumbs('', 'demo').length, 1, '空路径只有根')
})

test('扩展优先级：label/parent 都是首个非空命中，默认扩展兜底', () => {
  const model = createNavBarModel({
    rootName: 'demo',
    extensions: [
      { getPresentableText: element => (element.kind === 'file' ? `自定义：${element.name}` : null) },
      { getPresentableText: element => (element.kind === 'dir' ? `目录：${element.name}` : null) },
    ],
  })
  const file = { kind: 'file', path: 'a/b.ts', name: 'b.ts' }
  assert.equal(model.presentableText(file), '自定义：b.ts')
  assert.equal(model.presentableText({ kind: 'dir', path: 'a', name: 'a' }), '目录：a')
  assert.equal(model.presentableText({ kind: 'root', path: '', name: 'demo' }), 'demo', '没有扩展命中时用元素自带名字')
})

test('parent 扩展改写链：自定义父级优先于默认的上一级目录', () => {
  const model = createNavBarModel({
    rootName: 'demo',
    extensions: [
      { getParent: element => (element.path === 'a/b.ts' ? { kind: 'dir', path: 'virtual', name: '虚拟层' } : null) },
    ],
  })
  const chain = model.chain({ kind: 'file', path: 'a/b.ts', name: 'b.ts' })
  assert.deepEqual(chain.map(element => element.path), ['', 'virtual', 'a/b.ts'])
  // 默认扩展：文件 → 上级目录 → 根。
  const plain = createNavBarModel({ rootName: 'demo', extensions: [] })
  assert.deepEqual(plain.chain({ kind: 'file', path: 'a/b.ts', name: 'b.ts' }).map(element => element.path), ['', 'a', 'a/b.ts'])
})

test('adjustElement：默认原样返回；自定义扩展可按倒序改写选中元素', () => {
  const file = { kind: 'file', path: 'a/b.ts', name: 'b.ts' }
  const plain = createNavBarModel({ rootName: 'demo', extensions: [] })
  assert.deepEqual(plain.adjust(file), file)
  const model = createNavBarModel({
    rootName: 'demo',
    extensions: [{ adjustElement: element => ({ ...element, name: '调过' }) }],
  })
  assert.equal(model.adjust(file).name, '调过')
})

test('additionalRoots：首个非空命中生效，根元素不重复；默认只有工作区根', () => {
  const plain = createNavBarModel({ rootName: 'demo', extensions: [] })
  assert.deepEqual(plain.roots(), [{ kind: 'root', path: '', name: 'demo' }])
  const model = createNavBarModel({
    rootName: 'demo',
    extensions: [
      { additionalRoots: () => [] },
      { additionalRoots: () => [{ kind: 'root', path: 'D:/other', name: '另一个根' }, { kind: 'root', path: '', name: '重复根' }] },
    ],
  })
  assert.deepEqual(model.roots().map(element => element.path), ['', 'D:/other'], '重复的空路径根被去掉')
})

test('children：默认扩展用目录清单，自定义 processChildren 优先', () => {
  const model = createNavBarModel({
    rootName: 'demo',
    extensions: [{ processChildren: element => (element.path === 'a' ? [{ kind: 'dir', path: 'a/sub', name: 'sub' }] : null) }],
    listDir: path => (path === 'b'
      ? [{ kind: 'file', path: 'b/x.ts', name: 'x.ts' }, { kind: 'file', path: 'b/y.ts', name: 'y.ts' }]
      : []),
  })
  assert.deepEqual(model.childrenOf({ kind: 'dir', path: 'a', name: 'a' }), [{ kind: 'dir', path: 'a/sub', name: 'sub' }])
  assert.deepEqual(model.childrenOf({ kind: 'dir', path: 'b', name: 'b' }).map(element => element.path), ['b/x.ts', 'b/y.ts'])
  assert.equal(model.childrenOf({ kind: 'file', path: 'b/x.ts', name: 'x.ts' }).length, 2, '文件取所在目录的清单')
})

test('默认扩展单独可用（AbstractNavBarExtension 的空实现口径）', () => {
  const extension = defaultNavBarExtension()
  assert.equal(extension.getParent({ kind: 'root', path: '', name: 'demo' }), null)
  assert.deepEqual(extension.additionalRoots(), [])
  const element = { kind: 'file', path: 'a/b.ts', name: 'b.ts' }
  assert.deepEqual(extension.adjustElement(element), element)
})

test('接线：面包屑点击走模型链，不再自己切路径', () => {
  const sideViews = readFileSync(join(root, 'src/editorSideViews.ts'), 'utf8')
  assert.match(sideViews, /navBarCrumbs\(active\.value\.path/, 'openBreadcrumb 没有用导航栏模型')
  assert.ok(!/path\.split\('\/'\)\.slice\(0, segmentIndex \+ 1\)/.test(sideViews), '旧的下标切路径不能还在')
})
