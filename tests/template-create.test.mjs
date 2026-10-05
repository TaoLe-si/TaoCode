// 「用文件模板新建文件」的落盘流程（`src/fileTemplateCreate.ts`）。
// 上游依据：`platform/lang-impl/src/com/intellij/ide/actions/CreateFileFromTemplateAction.java:68-119`
// （`:76-79` MkDirs、`:84` extraTemplateProperties、`:85` createFromTemplate、`:93-97` openFile、
// `:105-106` Velocity 解析失败包成 IncorrectOperationException）、
// `platform/lang-impl/src/com/intellij/ide/fileTemplates/FileTemplateUtil.java:288-347`（渲染 + 落盘）、
// `:384`（按模板名取 FileType ⇒ 模板扩展名决定建出来的文件名后缀）。
// 本仓通道：`file.create` + `file.write`（`src/bridge.ts:109`；同用法见 `src/patchApplyHost.ts:97`）。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createFileFromTemplate, fileTemplateConflictMessage, planFileTemplateCreate,
  templateTargetPath, withTemplateExtension,
} from '../src/fileTemplateCreate.ts'

const NOW = new Date('2026-10-06T08:05:00')

test('模板扩展名只在「名字没带扩展名」时补（FileTemplateUtil.java:384 的等价物）', () => {
  assert.equal(withTemplateExtension('Foo', 'java'), 'Foo.java')
  assert.equal(withTemplateExtension('foo.JAVA', 'java'), 'foo.JAVA', '同种扩展名大小写不认第二遍')
  assert.equal(withTemplateExtension('Foo.java', 'java'), 'Foo.java')
  assert.equal(withTemplateExtension('Foo.txt', 'java'), 'Foo.txt', '用户显式写了别的扩展名就尊重输入')
  assert.equal(withTemplateExtension('Dockerfile', ''), 'Dockerfile')
  assert.equal(withTemplateExtension('  Foo  ', 'md'), 'Foo.md')
})

test('目标路径：名字里的斜杠并进目录（上游 MkDirs，CreateFileFromTemplateAction.java:76-79）', () => {
  assert.equal(templateTargetPath('', 'Foo', 'java'), 'Foo.java')
  assert.equal(templateTargetPath('src/main/java/com/demo', 'Foo', 'java'), 'src/main/java/com/demo/Foo.java')
  assert.equal(templateTargetPath('src', 'my/nested/Foo', 'java'), 'src/my/nested/Foo.java')
  assert.equal(templateTargetPath('src\\main', 'Foo', 'java'), 'src/main/Foo.java', '反斜杠归一')
  assert.equal(templateTargetPath('/src/', '/Foo/', ''), 'src/Foo')
  assert.throws(() => templateTargetPath('src', '../evil', 'java'), /路径不合法/)
  assert.throws(() => templateTargetPath('../src', 'Foo', 'java'), /路径不合法/)
  assert.throws(() => templateTargetPath('', 'C:evil', 'java'), /文件名片段不合法/)
  assert.throws(() => templateTargetPath('', '   ', 'java'), /文件名不能为空/)
})

test('展开：变量、#set/#if、#parse 与未赋值变量', () => {
  const plan = planFileTemplateCreate({
    template: {
      name: 'Class', extension: 'java',
      content: 'package ${PACKAGE_NAME};\npublic class ${NAME} {\n// ${FILE_NAME} @ ${FILE_PATH} / ${DIR_PATH}\n#set($FLAG = 1)\n#if($FLAG)\nflag-on\n#end\n${PROJECT_NAME}|${USER}|$DS\n${NOT_SET_VAR}',
    },
    directory: 'src/main/java/com/demo',
    fileName: 'Cool',
    projectName: 'demo',
    user: 'tao',
    now: NOW,
  })
  assert.equal(plan.path, 'src/main/java/com/demo/Cool.java')
  assert.equal(plan.directory, 'src/main/java/com/demo')
  assert.match(plan.content, /^package com\.demo;/)
  assert.match(plan.content, /public class Cool \{/)
  assert.match(plan.content, /Cool\.java @ src\/main\/java\/com\/demo\/Cool\.java \/ src\/main\/java\/com\/demo/)
  assert.match(plan.content, /flag-on/)
  assert.match(plan.content, /demo\|tao\|\$/)
  assert.deepEqual(plan.unset, ['NOT_SET_VAR'])
  assert.deepEqual(plan.skipped, [])
  assert.equal(plan.variables.NAME, 'Cool')
  assert.equal(plan.variables.CLASS_NAME, 'Cool')
})

test('#parse 走 Includes（上游 VelocityWrapper.java:82）：缺失抛 TemplateNotFoundError，成环跳过', () => {
  const entries = { 'header.java': '// header ${NAME}\n', 'loopA': '#parse("loopB")\n', 'loopB': '#parse("loopA")\n' }
  const resolveInclude = name => entries[name]
  const plan = planFileTemplateCreate({
    template: { name: 'X', extension: 'java', content: '#parse("header.java")body ${NAME}' },
    fileName: 'Foo', variables: { NAME: 'Ignored' }, resolveInclude, now: NOW,
  })
  assert.match(plan.content, /\/\/ header Ignored/, 'extraTemplateProperties 覆盖同名预定义变量（上游 CreateFileFromTemplateAction.java:84 的 putAll 顺序）')
  assert.match(plan.content, /body Ignored/)
  assert.throws(() => planFileTemplateCreate({
    template: { name: 'X', extension: 'java', content: '#parse("nope.java")' },
    fileName: 'Foo', resolveInclude,
  }), /nope/)
  const cyclic = planFileTemplateCreate({
    template: { name: 'X', extension: '', content: '#parse("loopA")' },
    fileName: 'a', resolveInclude,
  })
  assert.deepEqual(cyclic.unset, [])
  assert.ok(cyclic.skipped.length, '成环的第二个目标要记下来')
})

test('语法错照上游包成一句可读的错（CreateFileFromTemplateAction.java:105-106）', () => {
  assert.throws(() => planFileTemplateCreate({
    template: { name: 'X', extension: 'java', content: '#if(1) 没有收尾' },
    fileName: 'Foo',
  }), /#if 没有配对的 #end/)
})

test('行尾：crlf/lf 转换（本仓的行尾通道是 file.lineSeparators）', () => {
  const template = { name: 'X', extension: '', content: 'a\nb\n' }
  assert.equal(planFileTemplateCreate({ template, fileName: 'f', lineSeparator: 'crlf' }).content, 'a\r\nb\r\n')
  assert.equal(planFileTemplateCreate({ template, fileName: 'f', lineSeparator: 'lf' }).content, 'a\nb\n')
  const crlfSource = { name: 'X', extension: '', content: 'a\r\nb\r\n' }
  assert.equal(planFileTemplateCreate({ template: crlfSource, fileName: 'f', lineSeparator: 'lf' }).content, 'a\nb\n')
  assert.equal(planFileTemplateCreate({ template, fileName: 'f' }).content, 'a\nb\n', '不给行尾就原样')
})

test('落盘顺序：建目录 → 建文件 → 写正文；冲突有两种来源', async () => {
  const calls = []
  const io = {
    create: async (path, directory) => { calls.push(['create', path, Boolean(directory)]) },
    write: async (path, content) => { calls.push(['write', path, content]) },
  }
  const plan = await createFileFromTemplate({
    template: { name: 'Class', extension: 'java', content: 'class ${NAME} {}' },
    directory: 'src/main/java', fileName: 'Demo', now: NOW,
  }, io)
  assert.deepEqual(calls, [
    ['create', 'src/main/java', true],
    ['create', 'src/main/java/Demo.java', false],
    ['write', 'src/main/java/Demo.java', 'class Demo {}'],
  ])
  assert.equal(plan.path, 'src/main/java/Demo.java')

  // 已存在（清单里就有）⇒ 提前失败，不调 create
  const calls2 = []
  const knownIo = { ...io, create: async (p, d) => { calls2.push(['create', p, Boolean(d)]) }, knownPaths: () => ['src/main/java/Demo.java'] }
  await assert.rejects(() => createFileFromTemplate({
    template: { name: 'Class', extension: 'java', content: 'x' }, directory: 'src/main/java', fileName: 'Demo',
  }, knownIo), /已经存在/)
  assert.deepEqual(calls2, [])

  // 宿主对已存在文件本身会拒（`src/scratchFiles.ts:29` 的同一信号）⇒ 原样冒出去
  await assert.rejects(() => createFileFromTemplate({
    template: { name: 'Class', extension: 'java', content: 'x' }, directory: '', fileName: 'Foo',
  }, { create: async () => { throw new Error('EXISTS') }, write: async () => {} }), /EXISTS/)
  assert.match(fileTemplateConflictMessage('a/b.java'), /a\/b\.java 已经存在/)
})
