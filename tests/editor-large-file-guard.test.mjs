// 大文件保护的判据（上游 `LargeFileEditorProvider` / `LargeFileEditorImpl` /
// `LargeFileNotificationProvider` 一族）。
//
// ① 判定口径：**按 UTF-8 字节**（src/largeFileBytes.ts 的 largeFilePolicyForText），
//    CodeEditor 打开文件时用的就是它（不再用字符数）；
// ② 只读保护：大文件打开即只读（上游 `EditorModel.java:1017` 用 `createViewer`），
//    提示条上的「解除只读」是唯一放行口；
// ③ 提示条：文案带格式化大小，三个动作「解除只读 / 隐藏 / 不再显示」，
//    「不再显示」写 localStorage（上游 `PropertiesComponent` 的 DISABLE_KEY 等价物）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  dismissLargeFileNotice, isLargeFileNoticeDismissed, LARGE_FILE_DISABLE_KEY, largeFileNoticeText,
} from '../src/largeFileNotice.ts'
import { LARGE_FILE_LIMIT } from '../src/largeFileMode.ts'

const fakeStorage = () => {
  const map = new Map()
  return { getItem: key => (map.has(key) ? map.get(key) : null), setItem: (key, value) => void map.set(key, value), dump: () => map }
}

test('文案：带格式化后的大小 + 只读 + 降级清单', () => {
  const text = largeFileNoticeText(6 * 1024 * 1024)
  assert.match(text, /6\.0 MiB/)
  assert.match(text, /只读/)
  assert.match(text, /语法高亮/)
  assert.match(text, /查找替换/)
})

test('「不再显示」：写 key 后 isDismissed 为真；坏存储不抛', () => {
  const storage = fakeStorage()
  assert.equal(isLargeFileNoticeDismissed(storage), false)
  dismissLargeFileNotice(storage)
  assert.equal(storage.dump().get(LARGE_FILE_DISABLE_KEY), 'true')
  assert.equal(isLargeFileNoticeDismissed(storage), true)
  const throwing = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') } }
  assert.equal(isLargeFileNoticeDismissed(throwing), false)
  assert.doesNotThrow(() => dismissLargeFileNotice(throwing))
  assert.equal(isLargeFileNoticeDismissed(null), false)
})

test('接线：判定按字节、只读保护、提示条三个动作都在', () => {
  const editor = readFileSync(new URL('../src/components/CodeEditor.vue', import.meta.url), 'utf8')
  assert.match(editor, /import \{ largeFilePolicyForText, utf8ByteLength \} from '\.\.\/largeFileBytes'/)
  assert.match(editor, /const large = largeFilePolicyForText\(props\.content\)/, '按字节判定（不是 content.length）')
  assert.doesNotMatch(editor, /largeFilePolicy\(props\.content\.length\)/, '旧的字符数判定已撤掉')
  assert.match(editor, /diskReadOnly \|\| largeProtected \? EditorState\.readOnly\.of\(true\) : \[\]/, '大文件打开即只读')
  assert.match(editor, /function allowLargeEditing\(\) \{ largeProtected = false; applyReadOnly\(\) \}/, '解除只读是唯一放行口')
  assert.match(editor, /setReadOnly: \(value: boolean\) => \{ diskReadOnly = value; applyReadOnly\(\) \}/, '父级的只读状态与保护层合成')
  assert.match(editor, /largeFileNoticeText\(largeBytes\)/, '提示文案带大小')
  assert.match(editor, /dismissLargeFileNotice\(\)/, '不再显示写持久化')
  assert.match(editor, /!largeNoticeHidden && !largeNoticeDismissed/, '隐藏/不再显示两级门')
  // 大文件仍然关语法高亮（syntaxHighlighting 不进扩展表）与 LSP（lspExtensions 返回空）。
  assert.match(editor, /\.\.\.\(heavy \? \[\] : \[syntaxHighlighting\(syntaxColors\)\]\)/)
  assert.match(editor, /if \(!props\.lspEnabled \|\| heavy\) return \[\]/, 'lspExtensions 对大文件返回空')
  assert.ok(LARGE_FILE_LIMIT === 5 * 1024 * 1024)
})
