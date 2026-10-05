// 文件选择器的新增语义（`pf/file-chooser` 族级判词）：
//   · `src/fileChooserModel.ts` —— FileElement 树、视图模式排序、文件名输入、覆盖确认；
//   · `src/fileChooserCase.ts` —— 大小写敏感性判定与同名冲突。
//
// 上游依据逐条钉在实现里，这里只钉**行为**：
//   · `platform/ide-core/src/com/intellij/openapi/fileChooser/FileElement.java:45-61`（getPath 沿 parent 拼）、
//     `:81-83`（isHidden）、`:85-87`/`:106-112`（isArchive）；
//   · `…/fileChooser/FileChooserDescriptor.java:296-320`（isFileVisible）、`:326-337`（isFileSelectable）
//     —— 可见性与可选性是**两件事**：不可见的不出现，不可选的照样出现只是灰的；
//   · `platform/util/src/com/intellij/openapi/util/io/FileSystemUtil.java:243-245`（isCaseToggleable）、
//     `:232-236`（toggleCase）、`:249-259`（findCaseToggleableChild）、`:201-203`（找不到 ⇒ SENSITIVE）、
//     `:207-215`（换大小写还是它 ⇒ INSENSITIVE）、`:222-223`（确实是另一个文件 ⇒ SENSITIVE）。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_SORT, checkOverwrite, chooserChildren, favoriteShortcuts, isNodeSelectable, nodeSelectableReason,
  recentShortcuts, resolveTypedName,
} from '../src/fileChooserModel.ts'
import {
  caseConflictFor, findCaseToggleableChild, isCaseToggleable, readDirectoryCaseSensitivity, toggleCase,
} from '../src/fileChooserCase.ts'
import { singleDirDescriptor, singleFileDescriptor, withExtensionFilter } from '../src/fileChooserDescriptor.ts'

const file = (name, kind = 'file') => ({ name, path: name, kind })
const dir = name => file(name, 'directory')

// ── 树模型：可见 vs 可选（FileChooserDescriptor:296-320 / :326-337）─────────────────

test('不可见的不出现；可见但不可选的照样出现（只是灰的）', () => {
  const descriptor = singleFileDescriptor()
  const listing = { entries: [dir('src'), file('a.java'), file('b.txt'), file('.hidden')] }
  const children = chooserChildren(descriptor, '', listing, DEFAULT_SORT)
  // `.hidden` 走 isFileVisible（以点开头）—— 不出现。
  assert.deepEqual(children.map(node => node.name), ['src', 'a.java', 'b.txt'])
  // 「只选文件」的对话框里目录仍出现，但不可选（上游画灰，不是隐藏）。
  const src = children.find(node => node.name === 'src')
  assert.equal(isNodeSelectable(descriptor, src), false)
  assert.match(nodeSelectableReason(descriptor, src), /只能进入不能选中/)
  assert.equal(isNodeSelectable(descriptor, children.find(node => node.name === 'a.java')), true)
})

test('扩展名过滤只挡文件，不挡目录（否则没法走进装着目标文件的子目录）', () => {
  const descriptor = withExtensionFilter(singleFileDescriptor(), 'Java 源', ['java'])
  const children = chooserChildren(descriptor, '', { entries: [dir('src'), file('a.txt')] }, DEFAULT_SORT)
  assert.deepEqual(children.map(node => node.name), ['src'], '.txt 被过滤掉，目录留着能进去')
  assert.equal(isNodeSelectable(descriptor, children[0]), false, '目录在这个描述件下仍不可选')
})

test('目录在前、各自字母序；list 模式整表混排（FileViewMode TREE/LIST）', () => {
  const descriptor = singleFileOrDirLike()
  const listing = { entries: [file('b.java'), dir('z'), file('a.java'), dir('a')] }
  const tree = chooserChildren(descriptor, '', listing, { mode: 'tree', directoriesFirst: true })
  assert.deepEqual(tree.map(node => node.name), ['a', 'z', 'a.java', 'b.java'])
  const list = chooserChildren(descriptor, '', listing, { mode: 'list', directoriesFirst: false })
  assert.deepEqual(list.map(node => node.name), ['a', 'a.java', 'b.java', 'z'], '混排时整表按名字排')
})

test('归档标记与 outside 标记（FileElement:85-87 与本仓只能列工作区内的限制）', () => {
  const descriptor = singleFileDescriptor()
  const children = chooserChildren(descriptor, 'libs', { entries: [file('core.jar'), dir('sub')] }, DEFAULT_SORT)
  const jar = children.find(node => node.name === 'core.jar')
  const sub = children.find(node => node.name === 'sub')
  assert.equal(jar.archive, true, '.jar 是归档')
  assert.equal(sub.archive, false)
  assert.ok(children.every(node => !node.outside), '工作区内的节点不是 outside')
  assert.deepEqual(children.map(node => node.path).sort(), ['libs/core.jar', 'libs/sub'], 'path 沿 parent 拼（FileElement:45-61）')
  assert.deepEqual(chooserChildren(descriptor, 'libs', null, DEFAULT_SORT), [], '列不到内容时给空，不编目录')
})

test('outside 节点不可选，且理由写明是工作区之外', () => {
  const descriptor = singleDirDescriptor()
  const outside = { name: 'D:\\tools', path: 'D:/tools', kind: 'directory', children: [], archive: false, outside: true }
  assert.equal(isNodeSelectable(descriptor, outside), false)
  assert.match(nodeSelectableReason(descriptor, outside), /工作区之外/)
})

// ── 文件名输入（FileChooserDialog 底部的 filename 字段）──────────────────────────

test('文件名输入：剥引号、认相对目录、按描述件复核', () => {
  const descriptor = withExtensionFilter(singleFileDescriptor(), 'Java 源', ['java'])
  const ok = resolveTypedName(descriptor, 'src', '  "Main.java"  ')
  assert.equal(ok.name, 'Main.java', '两侧引号与空白剥掉')
  assert.equal(ok.directory, '')
  assert.equal(ok.path, 'src/Main.java')
  assert.equal(ok.selectable, true)

  const nested = resolveTypedName(descriptor, 'src', 'sub\\Deep.java')
  assert.equal(nested.directory, 'sub', '反斜杠也算目录分隔符')
  assert.equal(nested.path, 'src/sub/Deep.java')

  const bad = resolveTypedName(descriptor, 'src', 'notes.txt')
  assert.equal(bad.selectable, false)
  assert.match(bad.problem, /Java 源/)

  assert.equal(resolveTypedName(descriptor, 'src', '   ').problem, '没有输入文件名。')
  const dirOnly = resolveTypedName(singleDirDescriptor(), 'src', 'sub')
  assert.equal(dirOnly.selectable, false, '只选目录的描述件不接受文件名')
})

// ── 覆盖确认（选中之后、写盘之前）────────────────────────────────────────────

test('目标不存在就不问；已存在就要问一次', () => {
  assert.equal(checkOverwrite({ entries: [file('a.txt')] }, 'out/new.txt').needsConfirmation, false)
  const hit = checkOverwrite({ entries: [file('a.txt')] }, 'out/a.txt')
  assert.equal(hit.exists, true)
  assert.equal(hit.needsConfirmation, true)
  assert.match(hit.question, /已存在，要替换/)
  assert.equal(checkOverwrite(null, 'out/a.txt').needsConfirmation, false, '列不到目录时不猜，如实不拦')
})

// ── 大小写敏感性（FileSystemUtil:201-215 / :222-223 / :243-259）────────────────

test('isCaseToggleable / toggleCase（FileSystemUtil:243-245、:232-236）', () => {
  assert.equal(isCaseToggleable('Child.txt'), true)
  assert.equal(isCaseToggleable('122.45'), false, '纯数字与符号不可切换大小写')
  assert.equal(toggleCase('child'), 'CHILD', '先试大写')
  assert.equal(toggleCase('CHILD'), 'child', '大写等于原名就改小写')
  assert.deepEqual(findCaseToggleableChild([file('123.456'), file('a.txt')])?.name, 'a.txt')
  assert.equal(findCaseToggleableChild([file('123.456')]), null)
})

test('目录敏感性：两条只差大小写 ⇒ sensitive；探针查不到 ⇒ sensitive；查得到 ⇒ insensitive', () => {
  assert.equal(readDirectoryCaseSensitivity([file('a.txt'), file('A.txt')]), 'sensitive',
    '两条不同大小写并存 ⇒ 真的是两个文件（FileSystemUtil:222-223）')
  assert.equal(readDirectoryCaseSensitivity([file('123.456')]), 'unknown', '没有可切换名字 ⇒ 判不了，不猜')
  // 单看清单判不出来：不敏感卷上宿主只给出磁盘真实那一种拼写，两种情形长得一样。
  assert.equal(readDirectoryCaseSensitivity([file('readme.md')]), 'unknown', '没有探针就如实说判不了')
  // 有了探针（上游 :201 那一段「换大小写去 stat 一下」）才判得出来。
  assert.equal(readDirectoryCaseSensitivity([file('readme.md')], name => name === 'README.MD'), 'insensitive')
  assert.equal(readDirectoryCaseSensitivity([file('readme.md')], () => false), 'sensitive')
})

test('同名冲突：判得清就报清，判不清就如实说判不了（不假装安全）', () => {
  // 判不出敏感性：仍要提醒（覆盖前请自行核对），但不编一个结论。
  const unknown = caseConflictFor([file('readme.md'), file('a.txt')], 'README.md')
  assert.equal(unknown?.sensitivity, 'unknown')
  assert.match(unknown.message, /判不出/)
  // 完全同名的普通「已存在」不归这一问。
  assert.equal(caseConflictFor([file('README.md')], 'README.md'), null)
  // 目录里没有同名项 ⇒ 不是冲突
  assert.equal(caseConflictFor([file('a.txt')], 'README.md'), null)
  // 判不出来（目录里没有可切换名字）⇒ 不报，不猜
  assert.equal(caseConflictFor([file('123.456')], 'README.md'), null)
  // 不可切换的名字直接跳过
  assert.equal(caseConflictFor([file('a.txt')], '123.45'), null)
  // 不敏感卷：同一个文件，保存会覆盖
  const insensitive = caseConflictFor([file('readme.md'), file('a.txt')], 'README.md', name => name === 'README.MD')
  assert.equal(insensitive?.sensitivity, 'insensitive')
  assert.match(insensitive.message, /不区分大小写/)
  // 真实冲突：敏感卷上同时存在 readme.md 与 README.md
  const sensitive = caseConflictFor([file('readme.md'), file('README.md')], 'ReadMe.md')
  assert.equal(sensitive?.sensitivity, 'sensitive')
})

// ── 左侧的最近 / 收藏两行 ─────────────────────────────────────────────────────

test('最近文件去重并截断；收藏只收目录', () => {
  const recent = recentShortcuts(['src/Main.java', 'src/Main.java', 'README.md', 'a/b/c.txt'], 2)
  assert.deepEqual(recent.map(row => row.path), ['src/Main.java', 'README.md'], '去重 + 截断')
  assert.deepEqual(favoriteShortcuts(['C:\\work\\app', 'D:\\tools\\']), [
    { label: 'app', path: 'C:/work/app', kind: 'directory' },
    { label: 'tools', path: 'D:/tools', kind: 'directory' },
  ], '分隔符归一 + 尾分隔符去掉')
})

function singleFileOrDirLike() {
  return { ...singleFileDescriptor(), chooseFolders: true }
}
