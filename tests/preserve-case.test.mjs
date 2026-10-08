// 保留大小写（上游 `PreserveCaseUtil`）—— 算法移植 + 查找栏接线。
//
// 算法用例逐条取自上游 `java/java-tests/testSrc/com/intellij/find/impl/PreserveCaseUtilTest.java`
// （`testReplaceWithCaseRespect` / `testApplyCase` 两个方法里的每一行断言）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { applyCase, preserveCaseReplacement, replaceWithCaseRespect, WORD_BASED_PRESERVE_CASE } from '../src/preserveCase.ts'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

test('replaceWithCaseRespect 与上游逐条一致', () => {
  // 上游签名是 (toReplace, foundString)：第一个参数是替换文本，第二个是命中文本。
  assert.equal(replaceWithCaseRespect('foo', 'Bar'), 'Foo')
  assert.equal(replaceWithCaseRespect('foo', 'bar'), 'foo')
  assert.equal(replaceWithCaseRespect('foo', 'BAR'), 'FOO')
  assert.equal(replaceWithCaseRespect('Foo', 'Bar'), 'Foo')
  assert.equal(replaceWithCaseRespect('Foo', 'bar'), 'foo')
  assert.equal(replaceWithCaseRespect('Foo', 'BAR'), 'FOO')
  assert.equal(replaceWithCaseRespect('FOO', 'Bar'), 'Foo')
  assert.equal(replaceWithCaseRespect('FOO', 'bar'), 'foo')
  assert.equal(replaceWithCaseRespect('FOO', 'BAR'), 'FOO')
  assert.equal(replaceWithCaseRespect('fooBar', 'Bar'), 'FooBar')
  assert.equal(replaceWithCaseRespect('fooBar', 'bar'), 'fooBar')
  assert.equal(replaceWithCaseRespect('DEF1', 'abc1'), 'def1')
  assert.equal(replaceWithCaseRespect('DEF1', 'Abc1'), 'Def1')
  assert.equal(replaceWithCaseRespect('DEF1', 'ABC1'), 'DEF1')
  assert.equal(replaceWithCaseRespect('abc', 'a1'), 'abc')
  assert.equal(replaceWithCaseRespect('abc', 'A1'), 'ABC')
  assert.equal(replaceWithCaseRespect('Report', 'display preferences'), 'report')
  assert.equal(replaceWithCaseRespect('Report', 'DISPLAY PREFERENCES'), 'REPORT')
  assert.equal(replaceWithCaseRespect('Report', 'display Preferences'), 'report')
  assert.equal(replaceWithCaseRespect('Report', 'Display preferences'), 'Report')
  assert.equal(replaceWithCaseRespect('MyTest', 'USERCODE'), 'MYTEST')
  assert.equal(replaceWithCaseRespect('MyTest', 'UserCode'), 'MyTest')
  assert.equal(replaceWithCaseRespect('MyTest', 'userCode'), 'myTest')
})

test('applyCase 与上游逐条一致（含 replaceWithCaseRespect 不支持的多词形态）', () => {
  assert.equal(applyCase('Bar', 'foo'), 'Foo')
  assert.equal(applyCase('bar', 'foo'), 'foo')
  assert.equal(applyCase('BAR', 'foo'), 'FOO')
  assert.equal(applyCase('Bar', 'Foo'), 'Foo')
  assert.equal(applyCase('bar', 'Foo'), 'foo')
  assert.equal(applyCase('BAR', 'Foo'), 'FOO')
  assert.equal(applyCase('Bar', 'FOO'), 'Foo')
  assert.equal(applyCase('bar', 'FOO'), 'foo')
  assert.equal(applyCase('BAR', 'FOO'), 'FOO')
  assert.equal(applyCase('Bar', 'fooBar'), 'FooBar')
  assert.equal(applyCase('bar', 'fooBar'), 'fooBar')
  assert.equal(applyCase('abc1', 'DEF1'), 'def1')
  assert.equal(applyCase('Abc1', 'DEF1'), 'Def1')
  assert.equal(applyCase('ABC1', 'DEF1'), 'DEF1')
  assert.equal(applyCase('a1', 'abc'), 'abc')
  assert.equal(applyCase('A1', 'abc'), 'ABC')
  assert.equal(applyCase('display preferences', 'Report'), 'report')
  assert.equal(applyCase('DISPLAY PREFERENCES', 'Report'), 'REPORT')
  assert.equal(applyCase('display Preferences', 'Report'), 'report')
  assert.equal(applyCase('Display preferences', 'Report'), 'Report')
  assert.equal(applyCase('USERCODE', 'MyTest'), 'MYTEST')
  assert.equal(applyCase('UserCode', 'MyTest'), 'MyTest')
  assert.equal(applyCase('userCode', 'MyTest'), 'myTest')
  // 下面这些是 replaceWithCaseRespect() 表达不了的逐词形态。
  assert.equal(applyCase('report', 'display preferences'), 'display preferences')
  assert.equal(applyCase('REPORT', 'display preferences'), 'DISPLAY PREFERENCES')
  assert.equal(applyCase('Report', 'display preferences'), 'Display Preferences')
  assert.equal(applyCase('Project_Lead_Id', 'PROGRAM_LEAD_ID'), 'Program_Lead_Id')
  assert.equal(applyCase('niceWeather', 'SUN_SHINE'), 'sun_shine')
  assert.equal(applyCase('niceweather', 'SUN_SHINE'), 'sun_shine')
  assert.equal(applyCase('111', 'do nothing'), 'do nothing')
  assert.equal(applyCase('111', 'Do Nothing'), 'Do Nothing')
  assert.equal(applyCase('111', 'DO NOTHING'), 'DO NOTHING')
  assert.equal(applyCase('111', '222'), '222')
  assert.equal(applyCase('Test_String', 'string_test'), 'String_Test')
  assert.equal(applyCase('Case', '_case'), '_Case')
  assert.equal(applyCase('control.search', 'control.SearchControl'), 'control.searchControl')
  assert.equal(applyCase('control.Search', 'control.SearchControl'), 'control.SearchControl')
})

test('空输入按上游原样返回，不抛错', () => {
  assert.equal(replaceWithCaseRespect('', 'Bar'), '')
  assert.equal(replaceWithCaseRespect('foo', ''), 'foo')
  assert.equal(applyCase('', 'foo'), 'foo')
  assert.equal(applyCase('Bar', ''), '')
})

// —— 上游默认档：注册表项决定挑哪一支算法，值在树里读得到 ——

test('默认档 = 逐词 applyCase（ide.find.word.based.preserve.case=true，registry.properties:1414）', () => {
  assert.equal(WORD_BASED_PRESERVE_CASE, true, '上游注册表项的默认值就是 true（默认档 = 逐词）')
  // 不传档 ⇒ 默认那一支；这三条都是 replaceWithCaseRespect 表达不了的逐词形态。
  assert.equal(preserveCaseReplacement('Project_Lead_Id', 'PROGRAM_LEAD_ID'), 'Program_Lead_Id')
  assert.equal(preserveCaseReplacement('REPORT', 'display preferences'), 'DISPLAY PREFERENCES')
  assert.equal(preserveCaseReplacement('report', 'Display Preferences'), 'display preferences')
  // 关掉那一档才是整段形态，而且上游两支的**参数顺序是反的**（replaceWithCaseRespect(replacement, found)）。
  assert.equal(preserveCaseReplacement('FOO', 'bar', false), 'BAR')
  assert.equal(preserveCaseReplacement('bar', 'foo', false), 'foo')
  assert.equal(preserveCaseReplacement('BAR', 'foo', false), 'FOO')
})

test('查找栏接线：控制器在替换时套用，栏上有开关', () => {
  const controller = read('src/editorFindController.ts')
  assert.match(controller, /import \{ preserveCaseReplacement \} from '\.\/preserveCase\.ts'/, '控制器要引保留大小写模块')
  assert.match(controller, /preserveCase: state\.preserveCase/)
  // 替换文本先按这一处命中做正则展开（`$1`/`${name}`…），再套大小写形态 —— 顺序不能反：
  // `PreserveCaseUtil` 吃的是**展开后的替换文本**（上游 `FindManagerBase.getStringToReplace:288-299`）。
  assert.match(controller, /let text = state\.replace/, '替换文本从 state.replace 出发')
  assert.match(controller, /preserveCaseReplacement\(found, text\)/, '替换文本要过一遍大小写形态（正则展开之后，走模块的默认档）')
  assert.doesNotMatch(controller, /replaceWithCaseRespect/, '控制器不再自己挑档 —— 挑档是 preserveCase.ts 的事')
  assert.match(controller, /togglePreserveCase:/, '控制器要暴露切换动作')

  const bar = read('src/components/EditorFindBar.vue')
  assert.match(bar, /preserveCase: boolean/, '栏要接收开关状态')
  assert.match(bar, /togglePreserveCase: \[\]/)
  assert.match(bar, /保留大小写/, '文案取中文包的那一档')

  const editor = read('src/components/CodeEditor.vue')
  assert.match(editor, /:preserve-case="findBar\.state\.preserveCase"/)
  assert.match(editor, /@toggle-preserve-case="findBar\.togglePreserveCase"/)
})
