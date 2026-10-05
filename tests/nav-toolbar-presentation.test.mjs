// 导航栏扩展的呈现面（`src/navToolbarPresentation.ts`）：`NavBarModelExtension` 上
// `src/navBarModel.ts` 没覆盖的那一半（图标 / 弹层文字 / 右键组 / 子元素归一 /
// 点击是否展开 / IGNORE_IN_NAVBAR），加 `NavBarLeftSideExtension` 的左侧根表。
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  IGNORE_IN_NAVBAR, navBarIcon, navBarIgnored, navBarLeftSideRoots, navBarNavigatesOnClick,
  navBarNormalizeChildren, navBarPopupMenuGroup, navBarPopupText, navBarShouldExpandOnClick,
} from '../src/navToolbarPresentation.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const file = { kind: 'file', path: 'src/a.ts', name: 'a.ts' }
const dir = { kind: 'dir', path: 'src', name: 'src' }
const workspaceRoot = { kind: 'root', path: '', name: 'demo' }

test('getIcon：首个非 null 命中，全都没有就是「这一段没有图标」', () => {
  const extensions = [
    { getIcon: element => (element.kind === 'dir' ? null : 'FileCode2') },
    { getIcon: element => (element.kind === 'dir' ? 'FolderTree' : 'File') },
  ]
  assert.equal(navBarIcon(extensions, file), 'FileCode2', '第一个扩展就命中，后面的不看')
  assert.equal(navBarIcon(extensions, dir), 'FolderTree')
  assert.equal(navBarIcon([{ getIcon: () => null }], file), null)
  assert.equal(navBarIcon([], file), null, '上游 getIcon 的 default 就是 return null（:36）')
})

test('弹层文字：没有弹层重载时退回普通标签（上游 :38-40 的 default 实现）', () => {
  assert.equal(navBarPopupText([{ getPopupPresentableText: () => null }], file, 'a.ts'), 'a.ts')
  assert.equal(navBarPopupText([{ getPopupPresentableText: () => 'a.ts（src）' }], file, 'a.ts'), 'a.ts（src）')
})

test('右键菜单组：首个非 null 命中，没有就是 null（:59 的 default）', () => {
  assert.equal(navBarPopupMenuGroup([{ getPopupMenuGroup: () => 'CutCopyPasteContextMenu' }], file), 'CutCopyPasteContextMenu')
  assert.equal(navBarPopupMenuGroup([], file), null)
})

test('normalizeChildren：默认 true；首个 false 即接管（:79-81）', () => {
  assert.equal(navBarNormalizeChildren([]), true, '没有任何扩展 ⇒ 走默认 true')
  assert.equal(navBarNormalizeChildren([{ normalizeChildren: () => true }]), true)
  assert.equal(navBarNormalizeChildren([{ normalizeChildren: () => true }, { normalizeChildren: () => false }]), false)
  assert.equal(navBarNormalizeChildren([{ normalizeChildren: () => false }, { normalizeChildren: () => true }]), false, '首个 false 即生效')
})

test('shouldExpandOnClick 是三态：null = 扩展没意见，不能被折叠成 false（:84-86）', () => {
  assert.equal(navBarShouldExpandOnClick([], file), null, '没有扩展 ⇒ 调用方自己定')
  assert.equal(navBarShouldExpandOnClick([{ shouldExpandOnClick: () => null }], file), null)
  assert.equal(navBarShouldExpandOnClick([{ shouldExpandOnClick: () => null }, { shouldExpandOnClick: () => true }], file), true,
    '跳过 null 取下一个扩展的意见')
  assert.equal(navBarShouldExpandOnClick([{ shouldExpandOnClick: () => false }], file), false)
})

test('navigateOnClick：扩展有意见取反，没意见时目录不导航（DefaultNavBarItem.kt:188-198）', () => {
  assert.equal(navBarNavigatesOnClick([], dir), false, 'PsiDirectory ⇒ 弹 children 下拉')
  assert.equal(navBarNavigatesOnClick([], workspaceRoot), false, '项目根也是目录')
  assert.equal(navBarNavigatesOnClick([], file), true, '文件 ⇒ 直接导航')
  assert.equal(navBarNavigatesOnClick([{ shouldExpandOnClick: () => true }], dir), false, '扩展说展开 ⇒ 不导航')
  assert.equal(navBarNavigatesOnClick([{ shouldExpandOnClick: () => false }], file), true, '扩展说不展开 ⇒ 导航')
  assert.equal(navBarNavigatesOnClick([{ shouldExpandOnClick: () => null }], file), true, '三态的 null 落回类型判定')
})

test('IGNORE_IN_NAVBAR：Key 的值存在即剔除（:34 的 Key<Boolean>）', () => {
  assert.equal(navBarIgnored(file, {}), false)
  assert.equal(navBarIgnored(file, { [`${IGNORE_IN_NAVBAR}:src/a.ts`]: true }), true)
  assert.equal(navBarIgnored(file, { [`${IGNORE_IN_NAVBAR}:src/a.ts`]: false }), false, '显式 false 不算剔除')
  assert.equal(navBarIgnored(file, { [`${IGNORE_IN_NAVBAR}:other`]: true }), false, '按 key 隔离，不串号')
})

test('左侧根表：注入顺序在前、工作区根兜底在后、路径去重', () => {
  const libs = { kind: 'dir', path: 'lib', name: 'lib' }
  const tools = { kind: 'dir', path: 'tools', name: 'tools' }
  const merged = navBarLeftSideRoots([{ roots: () => [libs, tools] }, { roots: () => [libs] }], workspaceRoot)
  assert.deepEqual(merged.map(entry => entry.path), ['', 'lib', 'tools'], '工作区根在第一位且只出现一次')

  // 扩展贡献了工作区根本身时不重复列。
  assert.deepEqual(navBarLeftSideRoots([{ roots: () => [workspaceRoot] }], workspaceRoot).map(entry => entry.path), [''])
  assert.deepEqual(navBarLeftSideRoots([], workspaceRoot).map(entry => entry.path), [''], '本仓单根工作区：默认只有根')
})

// 门禁：取证坐标写在文件头，源码里必须真的引到 NavBarModelExtension 那一族。
// 参考树不在本机时跳过（与 tests/source-citations.test.mjs 同样的处理）。
test('取证：模块头引用的上游路径存在，且 NavBarLeftSideExtension 的 EP 声明真在 xml:378', () => {
  const ref = 'D:/Backup/Downloads/intellij-community-master/intellij-community-master'
  if (!existsSync(ref)) return
  const source = readFileSync(join(root, 'src/navToolbarPresentation.ts'), 'utf8')
  assert.match(source, /platform-impl\/src\/com\/intellij\/ide\/navigationToolbar\/NavBarModelExtension\.java/)
  assert.match(source, /intellij\.platform\.ide\.impl\.xml:378/)
  // EP 声明确实在那儿，而且**全树没有实现**——这是「左侧根切换面板无法核实」的依据。
  const xml = readFileSync(join(ref, 'platform/platform-impl/resources/intellij.platform.ide.impl.xml'), 'utf8')
  const lines = xml.split('\n')
  assert.match(lines[377] ?? '', /qualifiedName="com\.intellij\.navbarLeftSide"/)
  const implementations = lines.filter(line => /<extensionPoint\s+point="com\.intellij\.navbarLeftSide"/.test(line))
  assert.deepEqual(implementations, [], '本 checkout 里没有注册实现 ⇒ 画什么无法核实')
})
