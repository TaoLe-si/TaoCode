// 「比较文件」/「比较对象…」（B7 §C：`CompareFilesAction`）。
//
// 上游 `platform/diff-impl/src/com/intellij/diff/actions/CompareFilesAction.java`：
//   · `update()`（`:49-78`）按选中个数与类型改标题；
//   · `getOtherFile`（`:152-171`）记住上次用过的文件/目录（`two.files.diff.last.used.*`，项目级）；
//   · 菜单位置在 `PlatformActions.xml:562-568` 的 `CompareActions`（PairFileActions 在前、
//     CompareClipboardWithSelection 在后）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  COMPARE_ACTIONS_ORDER, COMPARE_ARCHIVES_TEXT, COMPARE_DIRS_TEXT, COMPARE_FILES_TEXT, COMPARE_TEXT, COMPARE_WITH_TEXT,
  LAST_USED_FILE_KEY, LAST_USED_FOLDER_KEY, SELECT_FILE_TO_COMPARE, compareActionText, compareAvailable, defaultCompareSelection, lastUsedKeyFor,
} from '../src/compareFiles.ts'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

// —— 标题（update，:49-78）——

test('a single file reads "compare with…"', () => {
  assert.equal(compareActionText(['file']), COMPARE_WITH_TEXT)
})

test('two files of the same kind are named after that kind', () => {
  assert.equal(compareActionText(['file', 'file']), COMPARE_FILES_TEXT)
  assert.equal(compareActionText(['directory', 'directory']), COMPARE_DIRS_TEXT)
  assert.equal(compareActionText(['archive', 'archive']), COMPARE_ARCHIVES_TEXT)
})

// 混合类型退回"比较"（上游 `action.compare.text`）。
test('mixed kinds fall back to the plain label', () => {
  assert.equal(compareActionText(['file', 'directory']), COMPARE_TEXT)
  assert.equal(compareActionText(['file', 'archive']), COMPARE_TEXT)
})

test('three of a kind still gets the kind name', () => {
  assert.equal(compareActionText(['file', 'file', 'file']), COMPARE_FILES_TEXT)
  assert.equal(compareActionText(['directory', 'directory', 'directory']), COMPARE_DIRS_TEXT)
})

// —— 可用性（isAvailable，:80-96）——

test('nothing selected or too many is unavailable', () => {
  assert.equal(compareAvailable([]), false)
  assert.equal(compareAvailable(['file', 'file', 'file', 'file']), false)
})

test('one to three are available, but a three-way needs plain files', () => {
  assert.equal(compareAvailable(['file']), true)
  assert.equal(compareAvailable(['file', 'file']), true)
  assert.equal(compareAvailable(['file', 'file', 'file']), true)
  assert.equal(compareAvailable(['file', 'directory', 'file']), false, '三方比较里带目录不可用')
  assert.equal(compareAvailable(['file', 'archive', 'file']), false, '带归档同理')
  // 两方带目录是允许的（上游只在 length == 3 时拦）。
  assert.equal(compareAvailable(['directory', 'file']), true)
})

// —— 上次用过的路径（getOtherFile，:152-182）——

test('the memory key follows the kind', () => {
  assert.equal(lastUsedKeyFor('file'), LAST_USED_FILE_KEY)
  assert.equal(lastUsedKeyFor('directory'), LAST_USED_FOLDER_KEY)
  assert.equal(lastUsedKeyFor('archive'), LAST_USED_FOLDER_KEY)
  assert.equal(LAST_USED_FILE_KEY, 'two.files.diff.last.used.file', '上游常量不许改名')
  assert.equal(LAST_USED_FOLDER_KEY, 'two.files.diff.last.used.folder')
})

test('a remembered path wins, otherwise the current file', () => {
  assert.equal(defaultCompareSelection('E:/other.txt', 'E:/current.txt'), 'E:/other.txt')
  assert.equal(defaultCompareSelection(null, 'E:/current.txt'), 'E:/current.txt', '没记忆就用当前文件')
  assert.equal(defaultCompareSelection('', 'E:/current.txt'), 'E:/current.txt')
})

// —— 文案与顺序 ——

test('the strings come from the shipped Chinese bundle', () => {
  // 键的位置逐条开过 `platform/platform-resources-en/src/messages/ActionsBundle.properties`
  // （上一版写的 `:2496-2499` 落在 `action.ExternalSystem.*` 那一段里，与本族无关）。
  assert.equal(COMPARE_WITH_TEXT, '比较对象…', 'platform/platform-resources-en/src/messages/ActionsBundle.properties:2000 action.compare.with.text')
  assert.equal(COMPARE_FILES_TEXT, '比较文件', ':1999 action.compare.files.text')
  assert.equal(COMPARE_DIRS_TEXT, '比较目录', ':1998 action.CompareDirs.text')
  assert.equal(SELECT_FILE_TO_COMPARE, '选择要比较的文件', 'DiffBundle.properties:202 select.file.to.compare')
})

// 上游那一组的顺序：PairFileActions（比较文件 / 与编辑器比较）在前，剪贴板那条在后。
test('the compare group order matches the upstream menu', () => {
  assert.deepEqual([...COMPARE_ACTIONS_ORDER], ['compare.twoFiles', 'compare.withEditor', 'compare.clipboard'])
})

// —— 接线 ——

test('the editor popup offers "compare with…" before the clipboard one', () => {
  const menu = read('src/menus/codeMenu.ts')
  const withFile = menu.indexOf("id: 'code.compareWith'")
  const clipboard = menu.indexOf("id: 'code.compareClipboard'")
  assert.ok(withFile > 0 && clipboard > 0, '两条都要在')
  assert.ok(withFile < clipboard, '顺序照上游：比较对象… 在 与剪贴板比较 之前')
  assert.match(menu, /title: COMPARE_WITH_TEXT/)
})

test('the host implements it with the picker and the diff channel', () => {
  const actions = read('src/vcsActions.ts')
  assert.match(actions, /async function compareWithFile\(\)/)
  assert.match(actions, /'dialog\.pickFile'/, '要用宿主的选择器')
  assert.match(actions, /SELECT_FILE_TO_COMPARE/, '选择器标题取上游文案')
  assert.match(actions, /defaultCompareSelection\(remembered, tab\.path\)/, '默认定位到上次用过的文件')
  assert.match(actions, /writeLastUsedComparePath\(picked\.path\)/, '选完要记住')
  assert.match(actions, /clipboardDiff\.value = \{/, '复用剪贴板对比那条渲染通道')
  assert.match(read('src/App.vue'), /compareWithFile,/, '宿主没把它接进 ctx')
})
