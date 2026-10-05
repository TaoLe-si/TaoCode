// Ctrl+Shift+T「转到测试 / 转到被测对象」的规则层（`src/navGotoTest.ts`）。
//
// 上游依据（逐条，已按行核过）：
//   · 键位 `platform/platform-resources/src/keymaps/$default.xml:254-256`；
//     菜单位次 `platform/platform-impl/resources/idea/LangActions.xml:195`（`GoToCodeGroup` 内
//     GotoSuperMethod 之后、GotoRelated 之前）。
//   · 方向判定：`platform/lang-impl/src/com/intellij/testIntegration/GotoTestOrCodeHandler.java:50-60`
//     —— 当前是测试就找被测对象，否则找测试。
//   · 候选名表 + 权重：`platform/lang-impl/src/com/intellij/testIntegration/TestFinderHelper.java:115-127`
//     （权重 = `词数 - from + to`，「测试 → 被测对象」按权重**降序**：
//     `java/java-impl/src/com/intellij/testIntegration/JavaTestFinder.java:62`）。
//   · 邻近度：`TestFinderHelper.java:85-90` 原式；「被测对象 → 测试」按它**升序**
//     （`JavaTestFinder.java:95`）。
//   · 前后缀剥离：`JavaTestFinder.java:105-106` 用的是
//     `java/java-frontback-impl/src/com/intellij/psi/codeStyle/JavaCodeStyleSettings.java:49`/`:56`
//     的出厂默认（空前缀 + `Impl` 后缀）。
//   · 「被测对象 → 测试」的匹配式：`JavaTestFinder.java:110` 的 `"*" + klassName` + IGNORE_CASE。
// 接线（宿主装配）在 `src/lspNavigation.ts` 的 `gotoTest`；「接线」用例集中在
// `tests/nav-goto-related.test.mjs`。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  SUBCLASS_NAME_SUFFIX, baseNameOfPath, extensionOf, findSubjectTargets, findTestTargets, gotoTestActionLabel,
  gotoTestChooserTitle, gotoTestDirection, gotoTestNotFoundMessage, gotoTestTargets, isTestPath, nameWords,
  possibleSubjectNames, sortWeighted, stripSubclassAffixes, targetLineOfSymbol, testNameProximity,
} from '../src/navGotoTest.ts'

const file = path => ({ kind: 'file', path })
const dir = path => ({ kind: 'directory', path })
const ENTRIES = [
  file('src/main/java/Foo.java'), file('src/main/java/FooImpl.java'), file('src/main/java/Widget.java'),
  file('src/test/java/FooTest.java'), file('src/test/java/MyFooTest.java'), dir('src/test/java'),
]

test('拆词：驼峰 + 缩写 + 分隔符（上游 NameUtilCore.splitNameIntoWordList 的等价物）', () => {
  assert.deepEqual(nameWords('FooBarTest'), ['Foo', 'Bar', 'Test'])
  assert.deepEqual(nameWords('HTTPServer'), ['HTTP', 'Server'], '连续大写算一个词，末位小写归下一词')
  assert.deepEqual(nameWords('foo_test.c'), ['foo', 'test', 'c'])
  assert.deepEqual(nameWords(''), [])
})

test('候选名表：所有连续词段 + 权重 = 词数 - from + to（TestFinderHelper.java:115-127）', () => {
  const items = possibleSubjectNames('FooBarTest')
  assert.equal(items.length, 6, '三个词 = 6 个连续词段')
  const byName = new Map(items.map(item => [item.name, item.weight]))
  assert.equal(byName.get('FooBarTest'), 5, '整名 = 权重最高（3-0+2）')
  assert.equal(byName.get('FooBar'), 4, '3-0+1')
  assert.equal(byName.get('BarTest'), 4, '3-1+2')
  assert.equal(byName.get('Foo'), 3, '3-0+0')
  assert.equal(byName.get('Bar'), 3, '3-1+1')
  assert.equal(byName.get('Test'), 3, '3-2+2')
})

test('邻近度公式与两个方向的排序（升序找测试 / 降序找被测对象）', () => {
  assert.equal(testNameProximity('Foo', 'FooTest'), 4)
  assert.equal(testNameProximity('Foo', 'MyFooTest'), 8)
  const items = [{ name: 'a', weight: 1 }, { name: 'b', weight: 3 }, { name: 'c', weight: 3 }]
  assert.deepEqual(sortWeighted(items, false).map(item => item.name), ['a', 'b', 'c'], '升序档里同权重比名字')
  assert.deepEqual(sortWeighted(items, true).map(item => item.name), ['b', 'c', 'a'])
})

test('测试判定：路径标记或名字前后缀，任一命中就算测试', () => {
  assert.equal(isTestPath('src/test/java/Foo.java'), true)
  assert.equal(isTestPath('src/main/java/FooTest.java'), true)
  assert.equal(isTestPath('tests/foo_test.py'), true)
  assert.equal(isTestPath('src/main/java/Foo.java'), false)
  assert.equal(isTestPath('src/main/java/TestHelperUseCase.java'), true, 'Test 前缀这一档')
})

test('前后缀剥离用出厂默认（空前缀 + Impl 后缀），剥空退回原名', () => {
  assert.equal(SUBCLASS_NAME_SUFFIX, 'Impl')
  assert.equal(stripSubclassAffixes('FooImpl'), 'Foo')
  assert.equal(stripSubclassAffixes('Widget'), 'Widget')
  assert.equal(stripSubclassAffixes('Impl'), 'Impl', '剥完是空的 → 退回原名')
})

test('方向判定与两个方向的候选（被测对象 → 测试按邻近度升序；测试 → 被测对象按权重降序）', () => {
  assert.equal(gotoTestDirection('src/main/java/Foo.java'), 'toTest')
  assert.equal(gotoTestDirection('src/test/java/FooTest.java'), 'toSubject')
  assert.deepEqual(findTestTargets(ENTRIES, 'src/main/java/FooImpl.java').map(item => item.path),
    ['src/test/java/FooTest.java', 'src/test/java/MyFooTest.java'], 'Impl 后缀先剥掉再比名字')
  assert.deepEqual(findSubjectTargets(ENTRIES, 'src/test/java/FooTest.java').map(item => item.path),
    ['src/main/java/Foo.java'], '目录与被测方以外的文件都不进表')
  const both = gotoTestTargets(ENTRIES, 'src/test/java/FooTest.java')
  assert.equal(both.direction, 'toSubject')
  assert.equal(both.targets.length, 1)
})

test('标题两档 / 未找到文案 / 动作标题（GotoTestOrCodeHandler.java:111-119 + ActionsBundle.properties:701-707）', () => {
  assert.equal(gotoTestChooserTitle('toTest', 'Foo', 2), '选择“Foo”的测试（找到 2 个）')
  assert.equal(gotoTestChooserTitle('toSubject', 'FooTest', 1), '选择“FooTest”的被测对象（找到 1 个）')
  assert.equal(gotoTestNotFoundMessage('toTest'), '没有找到测试。')
  assert.equal(gotoTestNotFoundMessage('toSubject'), '没有找到被测对象。')
  assert.equal(gotoTestActionLabel('toTest'), '转到测试')
  assert.equal(gotoTestActionLabel('toSubject', true), '被测对象')
})

test('落点：有符号表时对准最外层**类**声明行，没有类就取第一条，完全没有就文件首行', () => {
  assert.equal(targetLineOfSymbol(null), 0)
  assert.equal(targetLineOfSymbol([]), 0)
  assert.equal(targetLineOfSymbol([{ kind: 6, startLine: 3 }]), 3, '没有类型层就拿第一条（文件级目标）')
  assert.equal(targetLineOfSymbol([{ kind: 6, startLine: 3 }, { kind: 5, startLine: 0 }]), 0)
  assert.equal(targetLineOfSymbol([{ kind: 11, startLine: 7 }, { kind: 5, startLine: 2 }]), 7, '表里第一条类型优先（Interface 也算类型层）')
})

test('路径工具：主干名去目录去扩展名，扩展名小写', () => {
  assert.equal(baseNameOfPath('src\\main\\java\\Foo.java'), 'Foo')
  assert.equal(baseNameOfPath('archive'), 'archive')
  assert.equal(baseNameOfPath('a/b/.gitignore'), '.gitignore', '开头的点不算扩展名分隔符')
  assert.equal(extensionOf('src/Foo.JAVA'), 'java')
  assert.equal(extensionOf('Makefile'), '')
})
