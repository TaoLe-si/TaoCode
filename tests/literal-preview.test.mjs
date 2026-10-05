// 字面量预览（IDEA `com.intellij.codeInsight.preview.ImageOrColorPreviewService`）的判据：
// 命中规则、取色、按所在文件解析图片路径都是 src/literalPreview.ts 的纯函数；
// 挂接点（CodeEditor 的 Shift 悬停控制器）用源码断言钉住。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { colorLiteralAt, imageLiteralAt, imageMimeFor, literalAt, resolveImagePath } from '../src/literalPreview.ts'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

/** 命中 `needle` 里的第一个字符（行内偏移）。 */
const at = (line, needle) => line.indexOf(needle)

test('颜色命中：#RGB / #RRGGBB / #RRGGBBAA，偏移必须落在字面量里', () => {
  const line = 'const accent = #4af; background: #336699; border: #33669980'
  const short = colorLiteralAt(line, at(line, '#4af'))
  assert.deepEqual(short && { css: short.css, label: short.label }, { css: '#44aaff', label: '#44AAFF' })
  const full = colorLiteralAt(line, at(line, '#336699;'))
  assert.equal(full?.css, '#336699')
  // 偏移越过字面量末尾（分号处）不算命中。
  assert.equal(colorLiteralAt(line, at(line, '#4af') + 4), undefined)
  assert.equal(colorLiteralAt(line, at(line, '#33669980') + 9), undefined)
})

test('颜色不命中：标识符里的 #、9 位十六进制、非法长度', () => {
  assert.equal(colorLiteralAt('foo#abc', 4), undefined)
  assert.equal(colorLiteralAt('x = #abcdef0', 5), undefined)
  assert.equal(colorLiteralAt('x = #ab', 5), undefined)
  assert.equal(colorLiteralAt('x = #abcde', 5), undefined)
})

test('图片命中：带引号与裸路径都认，URL 与非图片扩展名不认', () => {
  const quoted = 'const logo = "assets/icons/logo.png"'
  const literal = imageLiteralAt(quoted, at(quoted, 'assets'))
  assert.equal(literal?.path, 'assets/icons/logo.png')
  const bare = 'background-image: url(../img/hero.JPG)'
  assert.equal(imageLiteralAt(bare, at(bare, '../img'))?.path, '../img/hero.JPG')
  const remote = 'src="https://example.com/a.png"'
  assert.equal(imageLiteralAt(remote, at(remote, '//example')), undefined)
  assert.equal(imageLiteralAt('readme.md', 3), undefined)
})

test('统一命中：颜色优先，没颜色才找图片', () => {
  assert.equal(literalAt('c = #fff', 5)?.kind, 'color')
  assert.equal(literalAt('p = "a/b.svg"', 7)?.kind, 'image')
  assert.equal(literalAt('const x = 1', 6), undefined)
})

test('图片路径解析：按所在文件目录、/ 按工作区根、越界与盘符拒绝', () => {
  const literal = path => ({ kind: 'image', from: 0, to: path.length, path, label: path })
  assert.equal(resolveImagePath(literal('assets/logo.png'), 'src/pages/index.html'), 'src/pages/assets/logo.png')
  assert.equal(resolveImagePath(literal('../img/a.png'), 'src/pages/index.html'), 'src/img/a.png')
  assert.equal(resolveImagePath(literal('/assets/a.png'), 'src/pages/index.html'), 'assets/a.png')
  assert.equal(resolveImagePath(literal('../../../../a.png'), 'src/pages/index.html'), null)
  assert.equal(resolveImagePath(literal('C:/Windows/a.png'), 'src/pages/index.html'), null)
  assert.equal(resolveImagePath(literal('\\\\server\\share\\a.png'), 'src/pages/index.html'), null)
  assert.equal(resolveImagePath(literal('assets\\logo.png'), 'index.html'), 'assets/logo.png')
})

test('MIME 表与 native/dialogs.cpp 的只读图片通道同一张', () => {
  assert.equal(imageMimeFor('a/b/logo.PNG'), 'image/png')
  assert.equal(imageMimeFor('x.jpeg'), 'image/jpeg')
  assert.equal(imageMimeFor('x.jpg'), 'image/jpeg')
  assert.equal(imageMimeFor('x.webp'), 'image/webp')
  assert.equal(imageMimeFor('x.bmp'), 'image/bmp')
  assert.equal(imageMimeFor('x.svg'), 'image/svg+xml')
  assert.equal(imageMimeFor('x.gif'), 'image/gif')
  assert.equal(imageMimeFor('x.txt'), undefined)
})

test('挂接：CodeEditor 把控制器装进扩展，Shift 悬停由控制器监听，读图走 file.readBinary', () => {
  const editor = read('src/components/CodeEditor.vue')
  assert.match(editor, /createLiteralPreview\(/, 'CodeEditor 没有建预览控制器')
  assert.match(editor, /literalPreview\.extension/, '预览扩展没有装进编辑器')
  assert.match(editor, /file\.readBinary/, '图片没有走宿主读取通道')
  const extension = read('src/literalPreviewExtension.ts')
  assert.match(extension, /event\.shiftKey/, '预览不是 Shift 触发（上游是 isShiftDown）')
  assert.match(extension, /mousemove: onMove/, '没有鼠标移动监听')
  assert.match(extension, /mouseleave: \(\) => hide\(\)/, '鼠标移开没有收起')
  assert.ok(read('src/style.css').includes('.literal-preview'), '缺少预览弹层样式')
})

test('颜色命中：CSS rgb()/rgba() 与百分比/斜杠写法（本批补的非十六进制字面量）', () => {
  const line = 'color: rgb(255, 0, 0); shade: rgba(0, 0, 255, .5); pct: rgb(50%, 25%, 0%)'
  const red = colorLiteralAt(line, at(line, 'rgb(255'))
  assert.deepEqual(red && { css: red.css, label: red.label }, { css: '#FF0000', label: 'rgb(255, 0, 0)' })
  assert.equal(colorLiteralAt(line, at(line, 'rgba(0, 0, 255'))?.css, '#0000FF80', 'alpha .5 → 0x80')
  assert.equal(colorLiteralAt(line, at(line, 'rgb(50%'))?.css, '#804000', '百分比通道按 255 折算')
  // 现代空格 + `/` 写法也认；`argb(` 不是颜色函数（词边界）。
  assert.equal(colorLiteralAt('x = rgb(10 20 30 / 50%)', at('x = rgb(10 20 30 / 50%)', 'rgb(10'))?.css, '#0A141E80')
  assert.equal(colorLiteralAt('argb(1,2,3)', 3), undefined)
})

test('literalAt 的颜色优先级：rgb() 命中时不再落到图片通道', () => {
  const line = 'src="rgb(1,2,3).png"'
  const hit = literalAt(line, at(line, 'rgb(1'))
  assert.equal(hit?.kind, 'color')
})
