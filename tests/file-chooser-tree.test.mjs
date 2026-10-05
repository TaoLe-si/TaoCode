// 文件选择器的**树形浏览 / 自然序 / 新建目录**三条判据。
// 上游基准（逐条核过行号）：
//   · `platform/platform-impl/src/com/intellij/openapi/fileChooser/tree/FileTreeModel.java:275-288`
//     —— `sortDirectories` / `sortArchives && descriptor.isChooseJarContents()` / `StringUtil.naturalCompare`；
//   · 同文件 `:298-301` `isLeaf`、`:303-310` `getChildren`（目录懒加载、jar 内容只在 `isChooseJarContents` 时进）；
//   · `platform/platform-impl/src/com/intellij/openapi/fileChooser/ex/FileChooserDialogImpl.java:206`
//     与 `:393-396`、`:465` —— 一棵 `JTree` + 选择/展开监听（**上游没有 `FileViewMode` 这个枚举**，
//     2026-10-06 三条路各搜过：文件名 `FileViewMode` 只在 `recentFiles` 命中、包内 `viewMode` 零命中、
//     XML `id` 零命中 ⇒ 早先写在 `src/fileChooserModel.ts` 头部的那条坐标是编造的，已订正）；
//   · `platform/platform-impl/src/com/intellij/openapi/fileChooser/actions/NewFolderAction.java:112-150`
//     —— `NewFolderValidator.checkInput` 的四档判定；
//   · `platform/platform-impl/src/com/intellij/openapi/fileChooser/universal/NioFileSystemTree.kt:417-428`
//     —— 名字按 `StringUtil.tokenize(newFolderName, "\\/")` 逐段建多级；
//   · 文案：`platform/platform-api/resources/messages/IdeBundle.properties:2650-2653`、
//     `platform/platform-api/resources/messages/UIBundle.properties:151`/`:153`/`:154`。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  DEFAULT_SORT, isChooserLeaf, newFolderPlan, tokenizeFolderName, visibleChooserRows,
} from '../src/fileChooserModel.ts'
import {
  singleDirDescriptor, singleFileDescriptor, withChooseJarContents,
} from '../src/fileChooserDescriptor.ts'
import { fileTypeManager } from '../src/fileTypeRegistry.ts'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const dir = name => ({ name, path: name, kind: 'directory' })
const file = name => ({ name, path: name, kind: 'file' })
const listing = (...entries) => ({ entries })

// ── 自然序（FileTreeModel.java:287）──────────────────────────────────────────────

test('同层名字按自然序排，不是字典序（FileTreeModel.java:287 的 StringUtil.naturalCompare）', () => {
  const children = visibleChooserRows(
    singleFileDescriptor(), '', { '': listing(file('a10.txt'), file('a2.txt'), file('B.java'), file('a1.txt')) }, [], DEFAULT_SORT,
  ).map(row => row.node.name)
  assert.deepEqual(children, ['a1.txt', 'a2.txt', 'a10.txt', 'B.java'], '数字段按数值比、大小写不敏感')
})

test('归档跟目录一起排只在描述件收 jar 内容时生效（:282-285 的那个 &&）', () => {
  const descriptor = withChooseJarContents(singleFileDescriptor(), true)
  descriptor.chooseFiles = true
  const rows = visibleChooserRows(descriptor, '', { '': listing(dir('d'), file('core.jar'), file('z.jar'), file('a.txt')) }, [], DEFAULT_SORT)
  assert.deepEqual(rows.map(row => row.node.name), ['d', 'core.jar', 'z.jar', 'a.txt'], '目录 → 归档 → 普通文件')
  const off = visibleChooserRows(descriptor, '', { '': listing(dir('d'), file('core.jar'), file('a.txt')) }, [], { mode: 'tree', directoriesFirst: true, sortArchives: false })
  assert.deepEqual(off.map(row => row.node.name), ['d', 'a.txt', 'core.jar'], '关掉 sortArchives 后归档不再插到普通文件前面')
})

// ── 叶子与展开（:298-301 / :303-310）─────────────────────────────────────────────

test('叶子判定：目录不是叶子、文件是、归档在收 jar 内容时不是、工作区外画成叶子', () => {
  const node = (name, kind, extra = {}) => ({
    name, path: name, kind, children: [], archive: kind === 'file' && name.endsWith('.jar'), outside: false, ...extra,
  })
  const files = singleFileDescriptor()
  assert.equal(isChooserLeaf(files, node('src', 'directory')), false, '目录永远不是叶子（:299）')
  assert.equal(isChooserLeaf(files, node('a.txt', 'file')), true)
  assert.equal(isChooserLeaf(files, node('core.jar', 'file')), true, '不收 jar 内容时归档是叶子（:300）')
  const jar = withChooseJarContents(singleFileDescriptor(), true)
  assert.equal(isChooserLeaf(jar, node('core.jar', 'file')), false, '收 jar 内容时归档可以展开')
  assert.equal(isChooserLeaf(jar, node('outside', 'directory', { outside: true })), true, '列不出内容的画成叶子，不给空的展开箭头')
})

test('展开的目录就地嵌套，深度按层级；没展开的不列孩子', () => {
  const listings = {
    '': listing(dir('src'), file('README.md')),
    src: listing(dir('main'), file('a.ts')),
    'src/main': listing(file('b.ts')),
  }
  const rows = visibleChooserRows(singleFileDescriptor(), '', listings, ['src', 'src/main'], DEFAULT_SORT)
  assert.deepEqual(rows.map(row => `${row.depth}:${row.node.name}`), [
    '0:src', '1:main', '2:b.ts', '1:a.ts', '0:README.md',
  ])
  assert.equal(rows[0].expanded, true)
  assert.equal(rows[1].expanded, true)
  assert.equal(rows[3].expanded, false, '没展开的目录只画自己')
})

test('只选目录时文件整条不出现，不是画出来灰掉（FileChooserDescriptor.java:301-303）', () => {
  const listings = { '': listing(dir('src'), file('README.md')) }
  const rows = visibleChooserRows(singleDirDescriptor(), '', listings, [], DEFAULT_SORT)
  assert.deepEqual(rows.map(row => row.node.name), ['src'], 'isFileVisible 对非目录先判 chooseFiles')
  const files = visibleChooserRows(singleFileDescriptor(), '', listings, [], DEFAULT_SORT)
  assert.deepEqual(files.map(row => row.node.name), ['src', 'README.md'], '只选文件时目录仍然出现（只是不可选中）')
  assert.equal(files[0].leaf, false, '目录不是叶子（FileTreeModel.java:299）')
})

test('list 模式只画当前这一层，展开状态不影响它', () => {
  const listings = { '': listing(dir('src'), file('README.md')), src: listing(file('a.ts')) }
  const rows = visibleChooserRows(singleFileDescriptor(), '', listings, ['src'], { mode: 'list', directoriesFirst: true })
  assert.deepEqual(rows.map(row => `${row.depth}:${row.node.name}`), ['0:src', '0:README.md'])
})

test('展开了但列不出内容的行标 unlisted，孩子不编（宿主没有那一层的清单）', () => {
  const listings = { '': listing(dir('src')), src: null }
  const rows = visibleChooserRows(singleFileDescriptor(), '', listings, ['src'], DEFAULT_SORT)
  assert.deepEqual(rows.map(row => `${row.node.name}/${row.unlisted}`), ['src/true'])
})

test('工作区外的根列不出内容 ⇒ 一行都不画（不编目录）', () => {
  const rows = visibleChooserRows(singleFileDescriptor(), 'D:/other', { 'D:/other': null }, ['D:/other'], DEFAULT_SORT)
  assert.deepEqual(rows, [])
})

test('根传深层路径时孩子在它之下展开（面包屑进入某层后的那一棵树）', () => {
  const listings = { src: listing(dir('main')), 'src/main': listing(file('b.ts')) }
  const rows = visibleChooserRows(singleFileDescriptor(), 'src', listings, ['src/main'], DEFAULT_SORT)
  assert.deepEqual(rows.map(row => `${row.depth}:${row.node.name}`), ['0:main', '1:b.ts'])
})

// ── 新建目录（NewFolderAction.java:126-149）──────────────────────────────────────

test('折段按 StringTokenizer 的口径：跳空段、段内空白不剥（StringUtil.java:1366-1367）', () => {
  assert.deepEqual(tokenizeFolderName('a/b'), ['a', 'b'])
  assert.deepEqual(tokenizeFolderName('a\\b'), ['a', 'b'])
  assert.deepEqual(tokenizeFolderName('a//b'), ['a', 'b'], '空段跳过')
  assert.deepEqual(tokenizeFolderName('a/'), ['a'], '尾部分隔符不产生空段')
  assert.deepEqual(tokenizeFolderName(' a /b'), [' a ', 'b'], '上游不 trim，这里也照它')
})

test('名字里的分隔符折成多级（NioFileSystemTree.kt:419-423）', () => {
  const plan = newFolderPlan('src', 'main/java', null)
  assert.deepEqual(plan.segments, ['main', 'java'])
  assert.equal(plan.path, 'src/main/java')
  assert.equal(plan.creatable, true)
  assert.equal(newFolderPlan('', 'a', null).path, 'a', '当前目录是工作区根时不 leading slash')
})

test('第一段撞名就拦，后面的段不查重（:130-141 的 firstToken）', () => {
  const hit = listing(dir('a'))
  assert.equal(newFolderPlan('src', 'a', hit).error, '已存在名为「a」的文件夹。')
  assert.match(newFolderPlan('src', 'a', hit).error, /文件夹/)
  assert.equal(newFolderPlan('src', 'b', listing(file('b'))).error, '已存在名为「b」的文件。')
  const nested = newFolderPlan('src', 'new/a', hit)
  assert.equal(nested.creatable, true, '只有第一段查重：new/a 的第一段 new 不在清单里')
})

test('点与点点不能当段名（:142-145 → IdeBundle.properties:2652）', () => {
  assert.equal(newFolderPlan('', '.').error, '不能用「.」作文件夹名。')
  assert.equal(newFolderPlan('src', 'a/../b', null).error, '不能用「..」作文件夹名。')
})

test('空名字不给建（:148 的 !inputString.isEmpty()）', () => {
  const plan = newFolderPlan('src', '   ', null)
  assert.equal(plan.creatable, false)
  assert.equal(plan.error, '请填写新目录名。')
  assert.equal(plan.path, 'src', '没折出段时路径就是当前目录')
})

test('名字在忽略清单里 ⇒ 给警告但仍然放行（:143-146 设了 errorText 却 return true）', () => {
  const before = fileTypeManager.getIgnoredFilesList()
  fileTypeManager.setIgnoredFilesList('*.class')
  try {
    const plan = newFolderPlan('', 'build.class', listing())
    assert.equal(plan.creatable, true, '上游这一档是“警告但放行”')
    assert.equal(plan.error, '')
    assert.equal(plan.warning, '这个名字在忽略清单里，建出来也不会显示。')
  } finally {
    fileTypeManager.setIgnoredFilesList(before)
  }
  assert.equal(newFolderPlan('', 'build', listing()).warning, '', '不在忽略清单里就不该有警告')
})

test('只差大小写的同名不算“可以建”（fileChooserCase 的 caseConflictFor 接进新建目录）', () => {
  const blocked = newFolderPlan('', 'src', listing(dir('SRC')))
  assert.equal(blocked.creatable, false, '不敏感卷上 Files.createDirectories 会静默吃掉这次创建（NioFileSystemTree.kt:421）')
  assert.match(blocked.error, /SRC/)
  assert.match(blocked.error, /大小写/)
  assert.ok(!/已存在名为/.test(blocked.error), '这一档不是普通的“已存在”，得走冲突那句')
  // 接线：规则真的过了 caseConflictFor，不是另写一份 lowerCase 比较。
  const model = read('src/fileChooserModel.ts')
  assert.match(model, /const conflict = caseConflictFor\(asCaseEntries\(listing\.entries\), first\)/)
})

// ── 接线：组件用的是本模块的规则，不是自己另写一套 ───────────────────────────────

test('接线：FileChooserDialog 画的是 visibleChooserRows 的真树', () => {
  const vue = read('src/components/FileChooserDialog.vue')
  assert.match(vue, /import \{[\s\S]*?visibleChooserRows[\s\S]*?\} from '\.\.\/fileChooserModel'/)
  assert.match(vue, /const rows = computed\(\(\) =>\s*visibleChooserRows\(/)
  assert.match(vue, /role="tree"/)
  assert.match(vue, /role="treeitem"/)
  assert.match(vue, /:aria-level="row\.depth \+ 1"/)
  assert.match(vue, /:aria-expanded="row\.leaf \? undefined : row\.expanded"/)
  assert.ok(!/role="listbox"/.test(vue), '不再是“假列表”：树要有树的 role')
})

test('接线：新建目录按钮走 file.create + directory，名字过 newFolderPlan', () => {
  const vue = read('src/components/FileChooserDialog.vue')
  assert.match(vue, /request\('file\.create', \{ path: plan\.path, directory: true \}\)/)
  assert.match(vue, /newFolderPlan\(currentPath\.value, draftName\.value, listings\.value\[currentPath\.value\] \?\? null\)/)
  assert.match(vue, /新建目录/)
  assert.ok(!/「新建目录」没有宿主通道/.test(vue), '早先那条“没有宿主通道”的说法已订正（native/main.cpp:985-989）')
})

test('接线：显示隐藏文件与刷新是两条真动作（ToggleVisibilityAction / RefreshFileChooserAction）', () => {
  const vue = read('src/components/FileChooserDialog.vue')
  assert.match(vue, /withShowHiddenFiles\(props\.descriptor, showHidden\.value\)/)
  assert.match(vue, /显示隐藏文件/)
  assert.match(vue, /刷新/)
  assert.match(vue, /async function refresh\(\) \{[\s\S]*?listings\.value = \{\}/)
})

test('接线：键盘走树（上下移动、左右展开折叠、回车确认）', () => {
  const vue = read('src/components/FileChooserDialog.vue')
  assert.match(vue, /case 'ArrowDown'/)
  assert.match(vue, /case 'ArrowUp'/)
  assert.match(vue, /case 'ArrowRight'/)
  assert.match(vue, /case 'ArrowLeft'/)
  assert.match(vue, /case 'Enter'/)
})
