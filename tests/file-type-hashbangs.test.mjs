// HashBang patterns（设置页 `FileTypeConfigurable` 里那张「HashBang patterns:」小表）的判据。
// 上游三处：`FileTypeAssocTable.addHashBangPattern`（经 `FileTypeManagerImpl.java:644-647` 装载）、
// `HashBangFileTypeDetector.kt:14-16` + `FileUtil.isHashBangLine`（`FileUtil.java:1300-1310`）判定、
// `FileTypeConfigurable.java:758-849` 的改判确认。
import assert from 'node:assert/strict'
import test from 'node:test'

import { FileTypeManager, fileTypeManager } from '../src/fileTypeRegistry.ts'
import { detectFileType, resolveEditorLanguage } from '../src/fileTypeDetection.ts'

test('内置 hashbang 就是上游那三条声明（java / python / bash;sh;zsh），Groovy 没有类型所以不灌', () => {
  assert.deepEqual(fileTypeManager.getHashBangPatterns('JAVA'), ['java'])
  assert.deepEqual(fileTypeManager.getHashBangPatterns('Python'), ['python'])
  assert.deepEqual(fileTypeManager.getHashBangPatterns('Shell Script'), ['bash', 'sh', 'zsh'])
  assert.equal(fileTypeManager.getHashBangPatterns('Groovy').length, 0)
})

test('isHashBangLine 的形状照上游：必须 #! 开头、模式出现在首行内；首行没有换行符时判 false', () => {
  assert.equal(FileTypeManager.matchesHashBang('#!/usr/bin/env python3\nprint(1)\n', 'python'), true)
  assert.equal(FileTypeManager.matchesHashBang('#!/bin/sh -e\n', 'sh'), true)
  assert.equal(FileTypeManager.matchesHashBang('  #!/usr/bin/python\n', 'python'), false, '上游用的是 startsWith("#!")')
  assert.equal(FileTypeManager.matchesHashBang('#!/usr/bin/python', 'python'), false, '上游要求行尾有 \\n（FileUtil.java:1306-1308）')
  assert.equal(FileTypeManager.matchesHashBang('#!python\n', 'python'), true)
  assert.equal(FileTypeManager.matchesHashBang('{"a":1}\n', 'python'), false)
})

test('按内容首段认类型：命中注册表里的 hashbang 就归那个类型', () => {
  assert.equal(fileTypeManager.findFileTypeByHashBang('#!/usr/bin/env python3\nx=1\n')?.id, 'Python')
  assert.equal(fileTypeManager.findFileTypeByHashBang('#!/bin/bash -eu\nexit 0\n')?.id, 'Shell Script')
  assert.equal(fileTypeManager.findFileTypeByHashBang('#!/usr/bin/java -jar\n')?.id, 'JAVA')
  assert.equal(fileTypeManager.findFileTypeByHashBang('#!/usr/bin/perl\n'), null)
})

test('改判前的撞车判定：exact 与 similar 分开，平台自带的模式不可写（checkHashBangConflict，:826-841）', () => {
  const exact = fileTypeManager.checkHashBangConflict('python')
  assert.deepEqual({ exact: exact?.exact, writable: exact?.writable, typeName: exact?.typeName }, { exact: true, writable: false, typeName: 'Python' })
  const similar = fileTypeManager.checkHashBangConflict('python3')
  assert.equal(similar?.exact, false, '新串含旧串 ⇒ similar 那一档（:830 的双向 contains）')
  assert.equal(similar?.pattern, 'python')
  assert.equal(fileTypeManager.checkHashBangConflict('perl'), null)
})

test('用户自己认领的 hashbang 可以改判：不点头时一条都不动，点头时先从原持有方摘掉', () => {
  const manager = new FileTypeManager([])
  manager.register({ id: 'Conf', name: 'Conf', language: 'other', matchers: [] })
  manager.register({ id: 'Ini', name: 'Ini', language: 'other', matchers: [] })
  assert.equal(manager.addHashBangPattern('Conf', 'conf'), null, '先认领一条（无冲突）')
  const conflict = manager.addHashBangPattern('Ini', 'conf')
  assert.equal(conflict?.exact, true)
  assert.equal(conflict?.writable, true, '用户类型不是标准类型 ⇒ 上游那个确认框而不是错误框')
  assert.deepEqual(manager.getHashBangPatterns('Ini'), [], '没点头 ⇒ 不认领')
  assert.deepEqual(manager.getHashBangPatterns('Conf'), ['conf'])
  const reassigned = manager.addHashBangPattern('Ini', 'conf', true)
  assert.equal(reassigned?.exact, true)
  assert.deepEqual(manager.getHashBangPatterns('Ini'), ['conf'])
  assert.deepEqual(manager.getHashBangPatterns('Conf'), [], '上游 :796-797 那两条 removeHashBangPattern 的效果')
  assert.equal(manager.removeHashBangPattern('Ini', 'conf'), true)
  assert.equal(manager.removeHashBangPattern('Ini', 'conf'), false)
})

test('标准 hashbang 不让改判（上游 isStandardFileType ⇒ writeable=false ⇒ 错误框）', () => {
  const manager = new FileTypeManager([])
  manager.register({ id: 'Python', name: 'Python', language: 'other', matchers: [] })
  manager.register({ id: 'Custom', name: 'Custom', language: 'other', matchers: [] })
  manager.seedHashBang('Python', ['python'])
  const conflict = manager.addHashBangPattern('Custom', 'python', true)
  assert.equal(conflict?.writable, false)
  assert.deepEqual(manager.getHashBangPatterns('Custom'), [], '不可写时连 reassign 都不给（:779-785 直接 return）')
  assert.equal(manager.isStandardHashBang('python'), true)
})

test('注销类型时它名下的 hashbang 一起走（不留孤儿模式）', () => {
  const manager = new FileTypeManager([])
  manager.register({ id: 'Tmp', name: 'Tmp', language: 'other', matchers: [] })
  manager.seedHashBang('Tmp', ['tmp'])
  assert.deepEqual(manager.getHashBangPatterns('Tmp'), ['tmp'])
  manager.unregister('Tmp')
  assert.equal(manager.findFileTypeByHashBang('#!/usr/bin/tmp\n'), null)
})

test('消费链：认领一条 hashbang 后 detectFileType 当场按新类型判，删掉就回内置表', () => {
  const manager = fileTypeManager
  const content = '#!/usr/bin/env ruby\nputs 1\n'
  assert.equal(detectFileType('script', content).type, 'Script', '内置解释器表兜底：ruby 没有专属类型')
  manager.register({ id: 'Rubyish', name: 'Ruby-ish', language: 'other', matchers: [] })
  try {
    assert.equal(manager.addHashBangPattern('Rubyish', 'ruby'), null)
    const guess = detectFileType('script', content)
    assert.equal(guess.kind, 'shebang')
    assert.equal(guess.type, 'Ruby-ish', '注册表里的显式声明优先于内置猜表')
    assert.equal(manager.isStandardHashBang('ruby'), false)
  } finally {
    manager.unregister('Rubyish')
  }
  assert.equal(detectFileType('script', content).type, 'Script')
})

test('探测出来的 shell 脚本语言仍走「没有词法层就不接编辑器」那条规则', () => {
  assert.equal(resolveEditorLanguage('run.sh', '#!/bin/bash\necho hi\n'), undefined)
  assert.equal(detectFileType('run.sh', '#!/bin/bash\necho hi\n').type, 'Shell Script')
})
