import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ACCESSIBLE_NAME_PREFIX, FILE_NAME_MAX_LENGTH, FILE_NAME_SUFFIX_LENGTH,
  absolutePath, baseName, fileStatusKind, filenameWidgetLabel, filenameWidgetTooltip,
  filenameWidgetVisible, insideContentRoot, isAbsolutePath, isFilenameWidgetCloseGesture,
  isSameFile, recentFilesPopupRows, shortenTextWithEllipsis, uniqueFileName,
} from '../src/filenameWidget.ts'

// FilenameToolbarWidgetAction.kt:86 shortenTextWithEllipsis(filename, 60, 30).
test('short text is returned unchanged, long text keeps the head and the tail', () => {
  assert.equal(shortenTextWithEllipsis('main.cpp', FILE_NAME_MAX_LENGTH, FILE_NAME_SUFFIX_LENGTH), 'main.cpp')
  const long = `${'a'.repeat(40)}${'b'.repeat(40)}`
  const short = shortenTextWithEllipsis(long, FILE_NAME_MAX_LENGTH, FILE_NAME_SUFFIX_LENGTH)
  // prefixLength = 60 - 30 - 3 = 27, so the middle 53 characters are replaced by "...".
  assert.equal(short, `${'a'.repeat(27)}...${'b'.repeat(30)}`)
  assert.equal(short.length, FILE_NAME_MAX_LENGTH)
})

test('a text of exactly the maximum length is not touched', () => {
  const text = 'x'.repeat(FILE_NAME_MAX_LENGTH)
  assert.equal(shortenTextWithEllipsis(text, FILE_NAME_MAX_LENGTH, FILE_NAME_SUFFIX_LENGTH), text)
})

// FilenameToolbarWidgetAction.kt:53-60 — hidden while the tabs are on screen unless fullPaths is on.
test('the widget is visible when the tab strip is gone or the window header shows full paths', () => {
  assert.equal(filenameWidgetVisible(false, false), false)
  assert.equal(filenameWidgetVisible(true, false), true)
  assert.equal(filenameWidgetVisible(false, true), true)
  assert.equal(filenameWidgetVisible(true, true), true)
})

test('the name is the last component for both separators', () => {
  assert.equal(baseName('src/components/App.vue'), 'App.vue')
  assert.equal(baseName('src\\components\\App.vue'), 'App.vue')
  assert.equal(baseName('App.vue'), 'App.vue')
})

// EditorTabPresentationUtil.kt:72-75 -> UniqueVFilePathBuilder: name first, path suffix when ambiguous.
test('a unique name stays a bare name and ignores the file itself among the peers', () => {
  assert.equal(uniqueFileName('D:/work/src/main.cpp', ['D:/work/src/main.cpp']), 'main.cpp')
  assert.equal(uniqueFileName('D:/work/src/main.cpp', ['D:/work/src/other.cpp']), 'main.cpp')
  assert.equal(uniqueFileName('D:/work/src/main.cpp'), 'main.cpp')
})

test('a duplicated name grows the shortest unique path suffix, one segment at a time', () => {
  const peers = ['D:/work/src/main.cpp', 'D:/work/lib/main.cpp']
  assert.equal(uniqueFileName('D:/work/src/main.cpp', peers), 'src/main.cpp')
  assert.equal(uniqueFileName('D:/work/lib/main.cpp', peers), 'lib/main.cpp')
})

test('the suffix keeps growing until it is unique among the same-named peers', () => {
  const peers = ['D:/work/src/net/main.cpp', 'D:/work/src/ui/main.cpp', 'D:/work/lib/net/main.cpp']
  assert.equal(uniqueFileName('D:/work/src/net/main.cpp', peers), 'src/net/main.cpp')
  assert.equal(uniqueFileName('D:/work/src/ui/main.cpp', peers), 'ui/main.cpp')
})

test('a file whose whole path is not unique falls back to the full path', () => {
  const peers = ['D:/work/main.cpp', 'work/main.cpp']
  assert.equal(uniqueFileName('D:/work/main.cpp', peers), 'D:/work/main.cpp')
})

// PlatformFrameTitleBuilder.kt:69-96 — the tooltip is the frame title of the file.
test('the tooltip is the full path when fullPaths is on, the name for project files otherwise', () => {
  assert.equal(filenameWidgetTooltip('D:/work/src/main.cpp', 'main.cpp', true), 'D:/work/src/main.cpp')
  assert.equal(filenameWidgetTooltip('D:/work/src/main.cpp', 'main.cpp', false), 'main.cpp')
  // Outside the content root IDEA decorates the name with the path too (:84-87).
  assert.equal(filenameWidgetTooltip('D:/external/main.cpp', 'main.cpp', false, false), 'D:/external/main.cpp')
})

// FilenameToolbarWidgetAction.kt:139 — "[path]" is appended only when it differs from the name.
test('the label carries the path in brackets only when full paths are shown and differ from the name', () => {
  assert.equal(filenameWidgetLabel('main.cpp', 'D:/work/src/main.cpp', false), 'main.cpp')
  assert.equal(filenameWidgetLabel('main.cpp', 'D:/work/src/main.cpp', true), 'main.cpp [D:/work/src/main.cpp]')
  assert.equal(filenameWidgetLabel('main.cpp', 'main.cpp', true), 'main.cpp')
})

test('the label shortens the name before appending the path', () => {
  const long = 'n'.repeat(80)
  assert.equal(filenameWidgetLabel(long, `/work/${long}`, true), `${shortenTextWithEllipsis(long, 60, 30)} [/work/${long}]`)
})

// FilenameToolbarWidgetAction.kt:94-102 — no popup for a single file, otherwise the history minus its head.
test('the recent-files popup needs more than one file and drops the current one', () => {
  assert.equal(recentFilesPopupRows([]), null)
  assert.equal(recentFilesPopupRows(['/work/a.txt']), null)
  assert.deepEqual(recentFilesPopupRows(['/work/a.txt', '/work/b.txt', '/work/sub/c.txt']), [
    { path: '/work/b.txt', name: 'b.txt' },
    { path: '/work/sub/c.txt', name: 'c.txt' },
  ])
})

// UIUtil.java:1843-1846 isCloseClick(e, MouseEvent.MOUSE_RELEASED).
test('the middle button and Shift+left close the file, a plain left click does not', () => {
  assert.equal(isFilenameWidgetCloseGesture(1, false), true)
  assert.equal(isFilenameWidgetCloseGesture(1, true), true)
  assert.equal(isFilenameWidgetCloseGesture(0, true), true)
  assert.equal(isFilenameWidgetCloseGesture(0, false), false)
  assert.equal(isFilenameWidgetCloseGesture(2, true), false)
})

// FileStatus.ADDED / MODIFIED / DELETED / UNKNOWN drive the name colour (:63-78).
test('the git status letters map onto the three FileStatus colours plus the default', () => {
  assert.equal(fileStatusKind({ indexStatus: 'A', workStatus: ' ' }), 'added')
  assert.equal(fileStatusKind({ indexStatus: '?', workStatus: '?', untracked: true }), 'added')
  assert.equal(fileStatusKind({ indexStatus: 'D', workStatus: ' ' }), 'deleted')
  assert.equal(fileStatusKind({ indexStatus: ' ', workStatus: 'D' }), 'deleted')
  assert.equal(fileStatusKind({ indexStatus: ' ', workStatus: 'M' }), 'modified')
  assert.equal(fileStatusKind({ indexStatus: 'R', workStatus: ' ' }), 'modified')
  assert.equal(fileStatusKind(undefined), 'none')
  assert.equal(fileStatusKind({ indexStatus: ' ', workStatus: ' ' }), 'none')
})

test('the accessible name prefix is the one IDEA ships', () => {
  assert.equal(ACCESSIBLE_NAME_PREFIX, '文件')
})

test('a project-relative editor path is joined with the root, an absolute one is kept', () => {
  assert.equal(isAbsolutePath('src/App.vue'), false)
  assert.equal(isAbsolutePath('C:/work/src/App.vue'), true)
  assert.equal(isAbsolutePath('C:\\work\\src\\App.vue'), true)
  assert.equal(isAbsolutePath('\\\\share\\src\\App.vue'), true)
  assert.equal(absolutePath('D:/work/', 'src/App.vue'), 'D:/work/src/App.vue')
  assert.equal(absolutePath('D:/work', 'C:/elsewhere/App.vue'), 'C:/elsewhere/App.vue')
})

test('a relative path is always inside the project, an absolute one only under the root', () => {
  assert.equal(insideContentRoot('D:/work', 'src/App.vue'), true)
  assert.equal(insideContentRoot('D:/work', 'D:/work/src/App.vue'), true)
  assert.equal(insideContentRoot('D:/work', 'D:/work'), true)
  assert.equal(insideContentRoot('D:/work', 'D:/other/App.vue'), false)
  // "D:/workplace" must not count as living inside "D:/work".
  assert.equal(insideContentRoot('D:/work', 'D:/workplace/App.vue'), false)
  assert.equal(insideContentRoot('D:/work', 'D:\\work\\src\\App.vue'), true)
})

test('paths compare case-insensitively across separators', () => {
  assert.equal(isSameFile('src/App.vue', 'src\\App.vue'), true)
  assert.equal(isSameFile('src/App.vue', 'SRC/app.vue'), true)
  assert.equal(isSameFile('src/App.vue', 'src/Other.vue'), false)
})
