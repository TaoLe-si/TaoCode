// 路径宏表与展开算法（`src/pathMacros.ts`）—— 上游 `PathMacros` 一族的判据。
//
// 每条断言都对着上游源码的真实规则：
//   · 展开 `ExpandMacroToPathMap.java:42-90`；层级注册 `PathMacroManager.kt:114-126`；
//   · 非递归 `PathMacroManager.kt:72-75`；工作目录 `ProgramParametersConfigurator.java:201-209`；
//   · 系统宏名 `PathMacrosImpl.kt:64-71`；读档 `:194-205`；宏名字符集 `PathMacrosCollector.kt:25`；
//   · 表的提交/排序/忽略变量 `PathMacroTable.java:116-125,159-172,42`、`PathMacroListEditor.java:75-84`。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  SYSTEM_MACRO_NAMES,
  PATH_MACRO_DEFINITIONS,
  NATIVE_SEPARATOR,
  definedPathMacroNames,
  emptyPathMacroTable,
  expandPathMacros,
  expandWithPathMacros,
  fileHierarchyMacroReplacements,
  globalSystemPathMacros,
  isValidPathMacroName,
  joinIgnoredMacroNames,
  loadPathMacroEntries,
  normalizePathMacroValue,
  parentPath,
  parseIgnoredMacroNames,
  pathMacroDefinition,
  pathMacroNameError,
  pathMacroTable,
  pathMacroTableEntries,
  pathMacroTableModified,
  pathMacroUses,
  resolveModuleWorkingDir,
  toSystemDependentValue,
  toSystemIndependentPath,
  undefinedPathMacros,
} from '../src/pathMacros.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')
const source = read('src/pathMacros.ts')

/** 便捷：只给 expands 通道的表。 */
const expands = entries => ({ plain: [], expands: entries })
/** 便捷：只给 plain 通道的表。 */
const plain = entries => ({ plain: entries, expands: [] })

// ── 内置宏清单（PathMacrosImpl.kt:64-71 / PathMacroUtil.java:19-34）────────────────

test('系统宏名就是 PathMacrosImpl.SYSTEM_MACROS 的 6 个（PathMacrosImpl.kt:64-71）', () => {
  assert.deepEqual([...SYSTEM_MACRO_NAMES], [
    'APPLICATION_HOME_DIR',
    'APPLICATION_PLUGINS_DIR',
    'PROJECT_DIR',
    'MODULE_WORKING_DIR',
    'MODULE_DIR',
    'USER_HOME',
  ])
})

test('每个内置宏名都能指到上游 PathMacroUtil 的常量行', () => {
  const expected = {
    PROJECT_DIR: 'PathMacroUtil.java:19',
    PROJECT_NAME: 'PathMacroUtil.java:20',
    MODULE_DIR: 'PathMacroUtil.java:22',
    MODULE_WORKING_DIR: 'PathMacroUtil.java:26',
    APPLICATION_HOME_DIR: 'PathMacroUtil.java:31',
    APPLICATION_CONFIG_DIR: 'PathMacroUtil.java:32',
    APPLICATION_PLUGINS_DIR: 'PathMacroUtil.java:33',
    USER_HOME: 'PathMacroUtil.java:34',
  }
  for (const [name, upstream] of Object.entries(expected)) {
    assert.equal(pathMacroDefinition(name)?.upstream, upstream, name)
  }
  assert.equal(pathMacroDefinition('MAVEN_REPOSITORY')?.upstream, 'PathMacrosImpl.kt:61')
})

test('APPLICATION_CONFIG_DIR 与 PROJECT_NAME 不在系统宏集合里（可被用户同名宏覆盖）', () => {
  assert.ok(!SYSTEM_MACRO_NAMES.includes('APPLICATION_CONFIG_DIR'))
  assert.ok(!SYSTEM_MACRO_NAMES.includes('PROJECT_NAME'))
  assert.equal(pathMacroDefinition('APPLICATION_CONFIG_DIR')?.system, false)
  assert.equal(pathMacroDefinition('PROJECT_NAME')?.system, false)
  for (const name of SYSTEM_MACRO_NAMES) assert.equal(pathMacroDefinition(name)?.system, true, name)
})

test('内置宏清单与 SYSTEM_MACRO_NAMES 双向一致（没有只在一边的名字）', () => {
  const defined = PATH_MACRO_DEFINITIONS.map(definition => definition.name)
  for (const name of SYSTEM_MACRO_NAMES) assert.ok(defined.includes(name), `${name} 缺定义`)
  for (const definition of PATH_MACRO_DEFINITIONS) {
    if (definition.system) assert.ok(SYSTEM_MACRO_NAMES.includes(definition.name), `${definition.name} 应非系统`)
  }
})

// ── 宏名合法字符集（PathMacrosCollector.kt:25 `\$([\w\-.]+?)\$`）────────────────

test('宏名字符集 = [A-Za-z0-9_.-]，非空（PathMacrosCollector.kt:25）', () => {
  for (const name of ['A', 'PROJECT_DIR', 'mac-ro8', 'macr.o7', 'mac_ro6', 'x1']) {
    assert.equal(isValidPathMacroName(name), true, name)
  }
  for (const name of ['', 'a b', 'a/b', 'a$b', 'a\\b', '路径', 'a:b', 'a(b)']) {
    assert.equal(isValidPathMacroName(name), false, JSON.stringify(name))
  }
})

test('新增/编辑时的名字校验：空、非法字符、系统宏、重名各有各的话（PathMacroTable.java:244-269,131-142）', () => {
  assert.equal(pathMacroNameError('MY_DIR'), '')
  assert.match(pathMacroNameError(''), /不能为空/)
  assert.match(pathMacroNameError('a b'), /只能包含/)
  assert.match(pathMacroNameError('PROJECT_DIR'), /内置变量名/)
  assert.match(pathMacroNameError('MY_DIR', ['MY_DIR']), /已经有名为 MY_DIR/)
  // 编辑既有宏时系统宏名同样拒绝（EditValidator.checkName，:262-269）
  assert.match(pathMacroNameError('USER_HOME', [], SYSTEM_MACRO_NAMES), /内置变量名/)
})

test('扫描出的宏 token 与 MACRO_PATTERN 同字符集（含 `$$$` 与 `$c:\\a\\b\\c$` 不命中）', () => {
  const uses = pathMacroUses('$MACro1$ $mac-ro8$ $$$ $c:\\a\\b\\c$ $Revision 1.23$ file://$root$/a$b.txt')
  assert.deepEqual(uses.map(use => use.name), ['MACro1', 'mac-ro8', 'root'])
  assert.deepEqual(uses.map(use => use.token), ['$MACro1$', '$mac-ro8$', '$root$'])
})

// ── 展开算法（ExpandMacroToPathMap.java:42-90）──────────────────────────────

test('文本里没有 `$` 也没有 `%` 时原样返回（ExpandMacroToPathMap.java:43-45）', () => {
  const table = expands([['USER_HOME', '/home/u']])
  assert.equal(expandPathMacros('/tmp/plain/path', table), '/tmp/plain/path')
  assert.equal(expandPathMacros('', table), '')
})

test('未定义的宏原样保留，不会被吃成空串', () => {
  const table = expands([['USER_HOME', '/home/u']])
  assert.equal(expandPathMacros('$UNKNOWN$/x', table), '$UNKNOWN$/x')
  assert.equal(expandPathMacros('a$b$c', table), 'a$b$c')
  assert.deepEqual(undefinedPathMacros('$UNKNOWN$/x $UNKNOWN$ $USER_HOME$', table), ['UNKNOWN'])
})

test('大小写敏感：`$project_dir$` 不匹配 `PROJECT_DIR`（ExpandMacroToPathMap.java:86）', () => {
  const table = expands([['PROJECT_DIR', '/proj']])
  assert.equal(expandPathMacros('$PROJECT_DIR$/src', table), '/proj/src')
  assert.equal(expandPathMacros('$project_dir$/src', table), '$project_dir$/src')
})

test('宏后紧跟的 1~2 个 `/` 一起吃掉；替换值以 `/` 结尾时不重复补（:60-77）', () => {
  const table = expands([['P', '/proj']])
  assert.equal(expandPathMacros('$P$', table), '/proj')
  assert.equal(expandPathMacros('$P$/src', table), '/proj/src')
  assert.equal(expandPathMacros('$P$//src', table), '/proj/src')
  assert.equal(expandPathMacros('file://$P$/src', table), 'file:///proj/src')
  const trailing = expands([['P', '/proj/']])
  assert.equal(expandPathMacros('$P$/src', trailing), '/proj/src')
})

test('同一个宏在文本里出现多次，全部替换（:61-72 的 while 循环）', () => {
  const table = expands([['P', '/proj']])
  assert.equal(expandPathMacros('$P$/a:$P$/b', table), '/proj/a:/proj/b')
})

test('非递归：替换值里后出现的宏不会再展开（PathMacroManager.kt:72-75 调 substitute）', () => {
  // USER_HOME 在 A 之前处理 ⇒ A 展开出来的 `$USER_HOME$` 文本不会再被处理
  const late = expands([['USER_HOME', '/home/u'], ['A', '$USER_HOME$/x']])
  assert.equal(expandPathMacros('$A$/y', late), '$USER_HOME$/x/y')
  // 反过来 A 在前 ⇒ 先插入文本，随后 USER_HOME 那一步把它展开掉
  const early = expands([['A', '$USER_HOME$/x'], ['USER_HOME', '/home/u']])
  assert.equal(expandPathMacros('$A$/y', early), '/home/u/x/y')
})

test('plain 通道先于 expands 通道（:47-55 的两次 for）', () => {
  const table = { plain: [['$MODULE_DIR$/..', '/tmp/foo']], expands: [['MODULE_DIR', '/tmp/foo/module']] }
  assert.equal(expandPathMacros('$MODULE_DIR$/../other', table), '/tmp/foo/other')
  assert.equal(expandPathMacros('$MODULE_DIR$/src', table), '/tmp/foo/module/src')
})

test('plain 通道是字面替换，`/..` 不会被误当成目录穿越（:50 `StringUtil.replace`）', () => {
  const table = plain([['$MODULE_DIR$/../..', '/tmp']])
  assert.equal(expandPathMacros('$MODULE_DIR$/../..', table), '/tmp')
  assert.equal(expandPathMacros('$MODULE_DIR$/../other', table), '$MODULE_DIR$/../other')
})

// ── 层级注册（PathMacroManager.kt:114-126）──────────────────────────────────

test('模块层级：最深的 `..` 在前、`$MODULE_DIR$` 最后（PathMacroManagerTest.java:94-101）', () => {
  assert.deepEqual(fileHierarchyMacroReplacements('MODULE_DIR', '/tmp/foo/module'), [
    ['$MODULE_DIR$/../..', '/tmp'],
    ['$MODULE_DIR$/..', '/tmp/foo'],
    ['$MODULE_DIR$', '/tmp/foo/module'],
  ])
})

test('项目层级同样一路到根（PathMacroManagerTest.java:105-112）', () => {
  assert.deepEqual(fileHierarchyMacroReplacements('PROJECT_DIR', '/tmp/foo'), [
    ['$PROJECT_DIR$/..', '/tmp'],
    ['$PROJECT_DIR$', '/tmp/foo'],
  ])
  // 取不到项目路径 ⇒ 一条都不注册（PathMacroManager.kt:115 `path?.let`）
  assert.deepEqual(fileHierarchyMacroReplacements('PROJECT_DIR', undefined), [])
})

test('末尾斜杠先去掉再算层级（PathMacroManager.kt:116 `Strings.trimEnd(it, "/")`）', () => {
  assert.deepEqual(fileHierarchyMacroReplacements('MODULE_DIR', '/tmp/foo/module/'), [
    ['$MODULE_DIR$/../..', '/tmp'],
    ['$MODULE_DIR$/..', '/tmp/foo'],
    ['$MODULE_DIR$', '/tmp/foo/module'],
  ])
})

test('父路径取到根就停（PathUtilRt.java:61-93；UNC 根 `//host` 是根）', () => {
  assert.equal(parentPath('/tmp/foo/module'), '/tmp/foo')
  assert.equal(parentPath('/tmp/foo'), '/tmp')
  assert.equal(parentPath('/tmp'), '')
  assert.equal(parentPath('/'), '')
  assert.equal(parentPath('C:/proj'), 'C:')
  assert.equal(parentPath('//wsl$/Linux'), '')
  assert.equal(parentPath('//wsl$/Linux/project'), '//wsl$/Linux')
})

// ── 全局系统宏与完整表（PathMacroUtil.java:97-104 / PathMacroManager.kt:33-41）──

test('全局系统宏四个，取不到的进不了表（PathMacroUtil.java:97-104）', () => {
  assert.deepEqual(globalSystemPathMacros({
    applicationHomeDir: 'C:\\IDE',
    applicationConfigDir: 'C:/cfg',
    applicationPluginsDir: undefined,
    userHome: '/home/u/',
  }), [
    ['APPLICATION_HOME_DIR', 'C:/IDE'],
    ['APPLICATION_CONFIG_DIR', 'C:/cfg'],
    ['USER_HOME', '/home/u/'],
  ])
})

test('完整表：用户宏 → 全局系统宏 → 项目宏 → 模块宏（PathMacroManager.kt:33-41 + 子类 super）', () => {
  const table = pathMacroTable({
    userHome: '/home/u',
    projectDir: '/proj',
    projectName: 'demo',
    moduleDir: '/proj/mod',
  }, [{ name: 'MY_DIR', value: 'D:\\tools\\' }])
  assert.deepEqual(table.expands.map(([name]) => name), ['MY_DIR', 'USER_HOME', 'PROJECT_NAME'])
  assert.deepEqual(table.plain, [
    ['$PROJECT_DIR$', '/proj'],
    ['$MODULE_DIR$/..', '/proj'],
    ['$MODULE_DIR$', '/proj/mod'],
  ])
  assert.ok(definedPathMacroNames(table).includes('MODULE_DIR'))
  assert.ok(definedPathMacroNames(table).includes('MY_DIR'))
})

test('整链展开：项目/模块/用户/自定义宏一起（含 `\\` 归一）', () => {
  const context = { userHome: '/home/u', projectDir: 'C:\\work\\demo', moduleDir: 'C:\\work\\demo\\mod' }
  assert.equal(expandWithPathMacros('$PROJECT_DIR$/src', context), 'C:/work/demo/src')
  assert.equal(expandWithPathMacros('$PROJECT_DIR$/../other', context), 'C:/work/other')
  assert.equal(expandWithPathMacros('$MODULE_DIR$/build', context), 'C:/work/demo/mod/build')
  assert.equal(expandWithPathMacros('$USER_HOME$/.m2', context), '/home/u/.m2')
  assert.equal(expandWithPathMacros('$MY_DIR$/bin', context, [{ name: 'MY_DIR', value: 'D:/tools/' }]), 'D:/tools/bin')
  assert.equal(expandWithPathMacros('$NOPE$/bin', context), '$NOPE$/bin')
})

test('`$MODULE_WORKING_DIR$` 不进展开表，由工作目录解析处理（ProgramParametersConfigurator.java:201-209）', () => {
  const table = pathMacroTable({ projectDir: '/proj', moduleDir: '/proj/mod' })
  assert.equal(expandPathMacros('$MODULE_WORKING_DIR$', table), '$MODULE_WORKING_DIR$')
  // 模块目录优先
  assert.equal(resolveModuleWorkingDir('$MODULE_WORKING_DIR$', '/proj/mod', '/proj'), '/proj/mod')
  // 没有模块时退回项目目录
  assert.equal(resolveModuleWorkingDir('$MODULE_WORKING_DIR$', undefined, '/proj'), '/proj')
  // 两者都没有时原样保留
  assert.equal(resolveModuleWorkingDir('$MODULE_WORKING_DIR$', undefined, undefined), '$MODULE_WORKING_DIR$')
})

test('废弃的 `$MODULE_DIR$` 在运行配置工作目录里先被改写成 `$MODULE_WORKING_DIR$`（:201-202）', () => {
  assert.equal(resolveModuleWorkingDir('$MODULE_DIR$', '/proj/mod', '/proj'), '/proj/mod')
  assert.equal(resolveModuleWorkingDir('/abs/dir', '/proj/mod', '/proj'), '/abs/dir')
})

// ── 用户自定义宏表的形状与规则（PathMacrosImpl.kt:186-233 / PathMacroTable.java）──

test('默认宏表是空的两段（PathMacrosImpl.kt:49,51）', () => {
  assert.deepEqual(emptyPathMacroTable(), { macros: [], ignored: [] })
})

test('设置页的表 = 用户宏 + 未定义宏（值空串），按名字排序（PathMacroTable.java:159-172,42）', () => {
  const entries = pathMacroTableEntries(
    [{ name: 'ZZZ', value: '/z' }, { name: 'AAA', value: '/a' }],
    ['MMM'],
  )
  assert.deepEqual(entries.map(entry => entry.name), ['AAA', 'MMM', 'ZZZ'])
  assert.equal(entries[1].value, '')
  // 未定义名已在用户宏里时不重复补
  assert.equal(pathMacroTableEntries([{ name: 'AAA', value: '/a' }], ['AAA']).length, 1)
})

test('表的比较：值、名字、长度任一不同即 modified（PathMacroTable.java:191-195）', () => {
  const saved = [{ name: 'AAA', value: '/a' }]
  assert.equal(pathMacroTableModified(pathMacroTableEntries(saved), saved), false)
  assert.equal(pathMacroTableModified(pathMacroTableEntries([{ name: 'AAA', value: '/b' }]), saved), true)
  assert.equal(pathMacroTableModified(pathMacroTableEntries(saved, ['NEW']), saved, ['NEW']), false)
  assert.equal(pathMacroTableModified([], saved), true)
})

test('提交时的值归一：分隔符转 `/`、去尾斜杠、空值丢弃（PathMacroTable.java:116-125）', () => {
  assert.equal(normalizePathMacroValue('/a/b/'), '/a/b')
  assert.equal(normalizePathMacroValue('\\a\\b\\'), '/a/b')
  assert.equal(normalizePathMacroValue('   '), null)
  assert.equal(normalizePathMacroValue(''), null)
})

test('读档丢掉系统宏名、去掉值末尾斜杠（PathMacrosImpl.kt:194-205）', () => {
  assert.deepEqual(loadPathMacroEntries([
    { name: 'PROJECT_DIR', value: '/x/' },
    { name: 'MY_DIR', value: 'D:/tools/' },
  ]), [{ name: 'MY_DIR', value: 'D:/tools' }])
  // 用户可覆盖非系统宏（APPLICATION_CONFIG_DIR / PROJECT_NAME）
  assert.deepEqual(loadPathMacroEntries([{ name: 'APPLICATION_CONFIG_DIR', value: '/cfg' }]),
    [{ name: 'APPLICATION_CONFIG_DIR', value: '/cfg' }])
})

test('忽略变量是 `;` 分隔串，逐段 trim（PathMacroListEditor.java:75-84）', () => {
  assert.deepEqual(parseIgnoredMacroNames(' A ; B ;; C '), ['A', 'B', 'C'])
  assert.deepEqual(parseIgnoredMacroNames(''), [])
  assert.equal(joinIgnoredMacroNames(['A', 'B']), 'A;B')
  assert.equal(joinIgnoredMacroNames([]), '')
})

test('显示值与平台分隔符互转（FileUtilRt.java:357-369）', () => {
  assert.equal(toSystemIndependentPath('C:\\a\\b'), 'C:/a/b')
  assert.equal(toSystemDependentValue('C:/a/b', '\\'), 'C:\\a\\b')
  assert.equal(toSystemDependentValue('C:/a/b', '/'), 'C:/a/b')
  assert.ok(NATIVE_SEPARATOR === '\\' || NATIVE_SEPARATOR === '/')
})

// ── 源码锚点（确保规则真在文件里、不被后续重构悄悄改掉）──────────────────────

test('源码里保留了上游算法的关键形态', () => {
  assert.match(source, /MACRO_PATTERN/)
  assert.match(source, /text\.startsWith\(macroName, index \+ 1\) && text\.charAt\(index \+ macroName\.length \+ 1\) === '\$'/)
  assert.match(source, /const slashes = slashCountAt\(result, end\)/)
  assert.match(source, /if \(!text\.includes\('\$'\) && !text\.includes\('%'\)\) return text/)
  assert.match(source, /PathMacrosImpl\.kt:64-71/)
  assert.match(source, /ExpandMacroToPathMap\.java:60-73/)
})

test('本模块是纯逻辑：零 import（可被 node --test 直接加载）', () => {
  assert.ok(!/^\s*import\s/m.test(source), 'pathMacros.ts 不应有 import')
  assert.ok(!/\bconstructor\s*\(/.test(source) || !/constructor\s*\(\s*(private|public|readonly|protected)/.test(source))
})

test('没有参数属性（Node 类型擦除不支持）', () => {
  assert.ok(!/constructor\s*\(\s*(private|public|protected|readonly)\b/.test(source))
})