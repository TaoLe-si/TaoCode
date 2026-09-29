// 新建/克隆项目对话框的路径校验。
//
// 回归重点：**盘符里的冒号是合法的**。曾经 `ILLEGAL_PATH` 把 `:` 当成非法字符，
// 于是任何 `D:\…` 都被判非法、"创建项目"按钮永久灰着 —— 用户看到的就是"无法新建项目"。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  isReservedDeviceName,
  projectDestination,
  projectNameError,
  projectParentError,
  projectPathTooLong,
  stripDrivePrefix,
} from '../src/projectPath.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

test('盘符路径必须被判为合法（曾经的 bug：`:` 被当成非法字符）', () => {
  const legal = [
    String.raw`D:\Backup\Documents`,
    'D:/Backup/Documents',
    String.raw`C:\Users\Administrator`,
    'E:/',
    String.raw`\\server\share`,
    '//server/share/deep/path',
    String.raw`D:\带空格 的 目录\子目录`,
  ]
  for (const path of legal)
    assert.equal(projectParentError(path), '', `应当合法：${path}`)
})

test('冒号只在盘符位置合法，别处的冒号仍然是非法字符', () => {
  assert.equal(stripDrivePrefix(String.raw`D:\a`), String.raw`\a`)
  assert.equal(stripDrivePrefix(String.raw`\a`), String.raw`\a`)
  // 备用数据流（`file:stream`）本仓不支持，必须拒绝
  assert.match(projectParentError(String.raw`D:\a:b`), /不能包含/)
  assert.match(projectParentError(String.raw`D:\a:b\c`), /不能包含/)
})

test('真正非法的字符仍然拒绝', () => {
  for (const bad of [String.raw`D:\a*b`, String.raw`D:\a?b`, String.raw`D:\a"b`,
                     String.raw`D:\a<b`, String.raw`D:\a>b`, String.raw`D:\a|b`, 'D:\\a\u0007b'])
    assert.match(projectParentError(bad), /不能包含/, `应当拒绝：${bad}`)
})

test('必须绝对路径；相对路径与 `..` 段都要拒绝', () => {
  assert.match(projectParentError('relative/dir'), /绝对路径/)
  assert.match(projectParentError(String.raw`D:\a\..\b`), /“\.”或“\.\.”/)
  assert.match(projectParentError(String.raw`D:\a.\b`), /句点结尾/)
  assert.match(projectParentError(String.raw`D:\CON\b`), /保留名/)
  assert.equal(projectParentError(''), '', '空值交给必填校验，不在这里报错')
})

test('项目名称的规则', () => {
  assert.equal(projectNameError('untitled'), '')
  assert.equal(projectNameError('我的项目-1'), '')
  assert.match(projectNameError('a/b'), /路径分隔符/)
  assert.match(projectNameError('a\\b'), /路径分隔符/)
  assert.match(projectNameError('a:b'), /路径分隔符/)
  assert.match(projectNameError('a*b'), /路径分隔符/)
  assert.match(projectNameError(' leading'), /空白开头/)
  assert.match(projectNameError('trailing '), /空白开头/)
  assert.match(projectNameError('dot.'), /句点结尾/)
  assert.match(projectNameError('CON.txt'), /保留名/)
  assert.match(projectNameError('x'.repeat(81)), /过长/)
  assert.equal(projectNameError(''), '', '空值不报错（必填由表单处理）')
  assert.equal(isReservedDeviceName('nul'), true)
  assert.equal(isReservedDeviceName('nullable'), false)
})

test('最终路径拼接：分隔符跟随父目录的写法', () => {
  assert.equal(projectDestination(String.raw`D:\Backup\Documents`, 'untitled'), String.raw`D:\Backup\Documents\untitled`)
  assert.equal(projectDestination('D:/Backup/Documents', 'untitled'), 'D:/Backup/Documents/untitled')
  // 结尾多余的斜杠要去掉，不能出现 `\\` 或 `//`
  // 模板字面量不能以反斜杠结尾（会转义反引号），所以这里用普通字符串
  assert.equal(projectDestination('D:\\Backup\\Documents\\', 'untitled'), 'D:\\Backup\\Documents\\untitled')
  assert.equal(projectDestination('D:/a//', 'b'), 'D:/a/b')
  assert.equal(projectDestination('', 'b'), '')
  assert.equal(projectDestination('D:/a', ''), '')
})

test('超长路径（MAX_PATH 余量）', () => {
  assert.equal(projectPathTooLong('D:/a', 'b'), false)
  assert.equal(projectPathTooLong('D:/' + 'x'.repeat(230), 'project'), true)
})

test('接线：对话框用的是抽出来的纯函数，没有第二份校验', () => {
  const dialog = read('src/components/ProjectDialog.vue')
  assert.match(dialog, /projectParentError/)
  assert.match(dialog, /projectNameError/)
  assert.match(dialog, /projectDestination/)
  assert.ok(!/ILLEGAL_PATH\s*=/.test(dialog), '旧的字符类不能再留在组件里（就是它把盘符判成了非法）')
})
