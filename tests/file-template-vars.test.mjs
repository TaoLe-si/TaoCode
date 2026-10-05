// 文件模板变量（`src/fileTemplateVars.ts`）：预定义变量展开、包名/类名推导、用户模板校验。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FILE_TEMPLATE_VARIABLES, classNameFor, expandFileTemplate, fileNameStem, mergeFileTemplates,
  packageNameForPath, templateVariablesFor, unknownTemplateVariables, validateUserFileTemplate,
} from '../src/fileTemplateVars.ts'

test('文件名词干与类名：非法标识符不硬蹭', () => {
  assert.equal(fileNameStem('Foo.java'), 'Foo')
  assert.equal(fileNameStem('a/b/MyClass.test.ts'), 'MyClass.test')
  assert.equal(classNameFor('Foo.java'), 'Foo')
  assert.equal(classNameFor('my-class.java'), '', '带连字符不是合法类名')
  assert.equal(classNameFor('2Foo.java'), '')
})

test('包名：源根之后逐段校验，非源根路径也认合法目录链', () => {
  assert.equal(packageNameForPath('src/main/java/com/acme/App.java'), 'com.acme')
  assert.equal(packageNameForPath('src\\main\\java\\com\\acme\\App.java'), 'com.acme', 'Windows 分隔符')
  assert.equal(packageNameForPath('src/main/java/x-y/App.java'), '', '非法段整条推不出')
  assert.equal(packageNameForPath('com/acme/App.java'), 'com.acme', '没有已知源根时按目录链')
  assert.equal(packageNameForPath('App.java'), '')
})

test('变量表：时间与路径可注入，NAME/FILE_NAME/CLASS_NAME 一致', () => {
  const now = new Date(2026, 9, 4, 9, 5)
  const variables = templateVariablesFor({ fileName: 'Widget.java', path: 'src/main/java/com/acme/Widget.java', projectName: 'demo', user: 'tao', now })
  assert.equal(variables.NAME, 'Widget')
  assert.equal(variables.FILE_NAME, 'Widget.java')
  assert.equal(variables.CLASS_NAME, 'Widget')
  assert.equal(variables.PACKAGE_NAME, 'com.acme')
  assert.equal(variables.DIR_PATH, 'src/main/java/com/acme')
  assert.equal(variables.DATE, '2026/10/4')
  assert.equal(variables.TIME, '9:05')
  assert.equal(variables.MINUTE, '5')
  assert.equal(FILE_TEMPLATE_VARIABLES.length, Object.keys(variables).length, '变量表与实算键一一对应')
})

test('展开：两种写法、未知变量默认原样保留、可显式清空', () => {
  const variables = { NAME: 'Widget', PACKAGE_NAME: 'com.acme' }
  assert.equal(expandFileTemplate('package ${PACKAGE_NAME};\nclass ${NAME} {}\n', variables), 'package com.acme;\nclass Widget {}\n')
  assert.equal(expandFileTemplate('class $NAME {}', variables), 'class Widget {}')
  assert.equal(expandFileTemplate('keep $UNKNOWN and ${ALSO}', variables), 'keep $UNKNOWN and ${ALSO}')
  assert.equal(expandFileTemplate('drop $UNKNOWN', variables, { keepUnknown: false }), 'drop ')
})

test('未知变量表：已知键与预定义表之外的才算；`$(` 与 `$1` 不误报', () => {
  assert.deepEqual(unknownTemplateVariables('${NAME} $CUSTOM $1 $(x)'), ['CUSTOM'], '$1 是数字被忽略（\\w 含数字）')
  assert.deepEqual(unknownTemplateVariables('${NAME} $KNOWN', { KNOWN: 'x' }), [])
})

test('用户模板校验与合并', () => {
  const base = { id: 'my', name: '我的类', extension: 'java', content: 'class ${NAME} {}' }
  assert.equal(validateUserFileTemplate(base), null)
  assert.ok(validateUserFileTemplate({ ...base, name: ' ' }))
  assert.ok(validateUserFileTemplate({ ...base, extension: '.java' }))
  assert.ok(validateUserFileTemplate({ ...base, content: '  ' }))
  assert.ok(validateUserFileTemplate({ ...base, id: '有空格 的' }))
  const builtin = [{ name: 'Java 类' }, { name: '我的类' }]
  assert.deepEqual(mergeFileTemplates(builtin, [base]).map(template => template.name), ['我的类', 'Java 类'], '同名用户模板覆盖内置展示项')
})
