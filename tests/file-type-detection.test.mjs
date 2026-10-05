// 文件类型内容探测（`src/fileTypeDetection.ts`）：shebang、强特征内容、内容覆盖扩展名。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { detectByContent, detectByShebang, detectFileType, detectedSummary, resolveEditorLanguage } from '../src/fileTypeDetection.ts'

test('shebang：env python3 / node / bash 各归各档，`#!/usr/bin/env` 也认', () => {
  assert.deepEqual(detectByShebang('#!/usr/bin/env python3'), { type: 'Python', language: 'other' })
  assert.deepEqual(detectByShebang('#!/bin/bash -e'), { type: 'Shell', language: 'other' })
  assert.equal(detectByShebang('#!/usr/bin/env node').type, 'JavaScript')
  assert.deepEqual(detectByShebang('#!/usr/bin/env ts-node'), { type: 'TypeScript', language: 'typescript' })
  assert.deepEqual(detectByShebang('#!/opt/tools/perl5'), { type: 'Script', language: 'other' }, '认不出的解释器按通用脚本')
  assert.equal(detectByShebang('echo hi'), null)
})

test('内容强特征：XML 序言 / DOCTYPE / 完整 JSON / #include', () => {
  assert.equal(detectByContent('<?xml version="1.0"?><a/>').type, 'XML')
  assert.equal(detectByContent('<!DOCTYPE html><html></html>').type, 'HTML')
  assert.equal(detectByContent('{"a": [1, 2]}').type, 'JSON')
  assert.equal(detectByContent('{"a": '), null, '残缺 JSON 不硬认')
  assert.equal(detectByContent('#include <string>\nint main(){}').type, 'C/C++')
  assert.equal(detectByContent('<?php echo 1;'), null, 'PHP 不在强特征表里，不猜')
})

test('内容弱特征：Java 类型声明 / TS import / markdown 标题', () => {
  assert.equal(detectByContent('public final class A {}').type, 'Java')
  assert.equal(detectByContent('import x from "y"\nexport const a = 1').type, 'TypeScript')
  assert.equal(detectByContent('# 标题\n\n[链接](https://x)').type, 'Markdown')
})

test('合成：shebang 优先于扩展名；强内容覆盖扩展名；关联语言可用时按扩展名', () => {
  const script = detectFileType('tool.txt', '#!/usr/bin/env python3\nprint(1)\n')
  assert.equal(script.kind, 'shebang')
  assert.equal(script.type, 'Python')
  const html = detectFileType('page.txt', '<!DOCTYPE html><html></html>')
  assert.equal(html.kind, 'content')
  assert.equal(html.type, 'HTML')
  const java = detectFileType('App.java', 'public class App {}')
  assert.equal(java.kind, 'extension')
  assert.equal(java.language, 'java')
  const unknown = detectFileType('data.bin', 'binary-ish')
  assert.equal(unknown.kind, 'none')
  assert.equal(detectedSummary(unknown), '未识别文件类型，按纯文本打开。')
})

test('设置里的关联覆盖内置表；低置信度内容在没扩展名时才用', () => {
  const custom = detectFileType('x.kt', '', { kt: 'typescript' })
  assert.equal(custom.kind, 'extension')
  assert.equal(custom.language, 'typescript')
  const low = detectFileType('notes', 'public class A {}')
  assert.equal(low.kind, 'content')
  assert.equal(low.confidence, 'low')
  assert.ok(detectedSummary(low).includes('低置信度'))
})

test('编辑器语言：关联优先，其次内容探测，只回三种有词法层的语言', () => {
  // 设置里的关联是用户显式指定的，永远优先。
  assert.equal(resolveEditorLanguage('x.kt', 'public class A {}', { kt: 'typescript' }), 'typescript')
  // 无扩展名 + 高置信度内容：真的接上编辑器（这是之前缺的那一步）。
  assert.equal(resolveEditorLanguage('run', '#!/usr/bin/env ts-node\nconsole.log(1)\n'), 'typescript')
  assert.equal(resolveEditorLanguage('lib', '#include <string>\n#include <vector>\n'), 'cpp')
  // 无扩展名 + 低置信度 Java 也认（IDEA 的 DetectedByContentFileType 口径）。
  assert.equal(resolveEditorLanguage('Main', 'public final class Main {}'), 'java')
  // 其余语言交给 CodeEditor 现有的路径规则，别用内容探测覆盖它更细的判断。
  assert.equal(resolveEditorLanguage('page.html', '<!DOCTYPE html><html></html>'), undefined)
  assert.equal(resolveEditorLanguage('data.json', '{"a": 1}'), undefined)
  assert.equal(resolveEditorLanguage('script.sh', '#!/bin/bash\necho hi'), undefined)
  assert.equal(resolveEditorLanguage('data.bin', 'binary-ish'), undefined)
  // 有扩展名时内置表赢（不要因为文件头像 Java 就把 .ts 当 Java）。
  assert.equal(resolveEditorLanguage('App.ts', 'public class A {}'), 'typescript')
})

test('接线：App 把 tab 内容一起交给语言判定（内容探测不是死代码）', () => {
  const app = readFileSync('src/App.vue', 'utf8')
  assert.ok(app.includes('resolveEditorLanguage(path, content, projectSettings.value.fileAssociations)'), 'App 的 associationOf 没有走探测')
  assert.ok(app.includes(':language="associationOf(tab.path, tab.content)"'), '编辑器没有把缓冲区内容传进语言判定')
})
