// exec/junit：TestNG 集成（`src/testng.ts`）的判据。
//
// 上游依据：`plugins/testng/src/com/theoryinpractice/testng/` 的
// `TestNGCommonClassNames.java:10-30`（`@Test` 与八个生命周期注解）、
// `util/TestNGUtil.java:78/89/92/94-107`（框架名/Maven 坐标/主类/注解 FQN）、
// `configuration/TestNGConfigurationType.java:28/39-41`（类型 id 与 tag）、
// `model/TestType.java:21-27`（七种运行目标）、
// `configuration/TestNGRunnableState.java:51-53`（`-d`/`-usedefaultlisteners`/`-listener`）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const {
  TESTNG_FRAMEWORK_NAME, TESTNG_TYPE_ID, TESTNG_TAG, TESTNG_TEST_ANNOTATION, TESTNG_MAIN_CLASS,
  TESTNG_MAVEN_COORDINATE, TESTNG_LIFE_CYCLE_ANNOTATIONS, TESTNG_SUPPORT_ANNOTATIONS,
  TESTNG_TEST_TYPES, TESTNG_TEST_TYPE_LABELS, TESTNG_CONFIG_ANNOTATIONS,
  isTestngSource, isJunitSource, frameworkOfSource, discoverTestngTests, parseGroups,
  testngCommand, testngRerunCommand, testngSuiteLabel,
} = await import('../src/testng.ts')
const { discover } = await import('../src/testRunner.ts')

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

test('常量与上游逐字一致', () => {
  assert.equal(TESTNG_FRAMEWORK_NAME, 'TestNG', 'TestNGUtil.java:78')
  assert.equal(TESTNG_TYPE_ID, 'TestNG', 'TestNGConfigurationType.java:28')
  assert.equal(TESTNG_TAG, 'testNg', ':39-41')
  assert.equal(TESTNG_TEST_ANNOTATION, 'org.testng.annotations.Test', 'TestNGUtil.java:94')
  assert.equal(TESTNG_MAIN_CLASS, 'org.testng.TestNG', ':92')
  assert.equal(TESTNG_MAVEN_COORDINATE, 'org.testng:testng', ':89')
  assert.equal(TESTNG_LIFE_CYCLE_ANNOTATIONS.length, 8, 'TestNGCommonClassNames.java:12-28 八个')
  assert.equal(TESTNG_CONFIG_ANNOTATIONS.length, 11, '生命周期八个 + DataProvider/Factory/ObjectFactory 三个')
  assert.deepEqual([...TESTNG_TEST_TYPES], ['PACKAGE', 'CLASS', 'METHOD', 'GROUP', 'SUITE', 'PATTERN', 'SOURCE'], 'TestType.java:21-27')
  assert.deepEqual(Object.keys(TESTNG_TEST_TYPE_LABELS).sort(), [...TESTNG_TEST_TYPES].sort())
})

test('框架判定：TestNG 优先（有全限定名可判），否则 JUnit', () => {
  assert.equal(frameworkOfSource('import org.testng.annotations.Test;'), 'TestNG')
  assert.equal(frameworkOfSource('import org.junit.Test;'), 'JUnit')
  assert.equal(frameworkOfSource('import org.junit.jupiter.api.Test;'), 'JUnit')
  assert.equal(frameworkOfSource('class Plain {}'), null)
  assert.equal(isTestngSource('@org.testng.annotations.BeforeClass'), true)
  assert.equal(isJunitSource('extends junit.framework.TestCase'), true)
  assert.equal(isTestngSource('@Test'), false, '只有短名分不开 ⇒ 不判 TestNG')
})

test('发现 TestNG 用例：不要求 public void，认属性里的 groups 与 dataProvider', () => {
  const source = `package com.example;
import org.testng.annotations.Test;

public class MathTest {
  @Test
  public void adds() {}

  @Test(groups = {"fast", "smoke"})
  void subs() {}

  @Test(dataProvider = "numbers")
  private int multiplies(int a) { return a; }

  @Test(groups = {"slow"})
  @Deprecated
  public static final void legacy() {}
}`
  const found = discoverTestngTests(source)
  assert.deepEqual(found.map(entry => entry.name), ['adds', 'subs', 'multiplies', 'legacy'])
  assert.deepEqual(found[0].groups, [])
  assert.deepEqual(found[1].groups, ['fast', 'smoke'])
  assert.equal(found[2].parameterized, true, '带 dataProvider 的是参数化用例')
  assert.deepEqual(found[3].groups, ['slow'], '属性与后续注解的顺序不影响')
  assert.ok(found.every(entry => entry.line > 0))
})

test('parseGroups：花括号多值、单值、单引号都认；没有就空数组', () => {
  assert.deepEqual(parseGroups('groups = {"a", "b"}'), ['a', 'b'])
  assert.deepEqual(parseGroups("groups = {'a'}"), ['a'])
  assert.deepEqual(parseGroups('groups = "solo"'), ['solo'])
  assert.deepEqual(parseGroups('dataProvider = "x"'), [])
})

test('discover() 按注解分派：TestNG 文件走 TestNG 发现器，JUnit 文件走 JUnit', () => {
  const testng = discover('src/MathTest.java', 'import org.testng.annotations.Test;\nclass T { @Test void a() {} }')
  assert.deepEqual(testng.map(entry => `${entry.id}:${entry.suite}`), ['testng:a:TestNG'])
  const junit = discover('src/MathTest.java', 'import org.junit.jupiter.api.Test;\nclass T {\n  @Test\n  void a() {}\n}')
  assert.deepEqual(junit.map(entry => `${entry.id}:${entry.suite}`), ['junit:a:JUnit'])
})

test('运行命令：Maven 走 -Dtest，直跑主类走 -testclass/-methods', () => {
  assert.equal(testngCommand('mvn test', 'com.foo.Bar'), 'mvn test -Dtest=com.foo.Bar')
  assert.equal(testngCommand('mvn test', 'com.foo.Bar#adds'), 'mvn test -Dtest=com.foo.Bar#adds')
  assert.equal(testngCommand('mvn test', 'com.foo.Bar', { mainClass: true, classpath: 'out' }),
    'java -cp "out" org.testng.TestNG -testclass com.foo.Bar')
  assert.equal(testngCommand('mvn test', 'com.foo.Bar#adds', { mainClass: true, classpath: 'out' }),
    'java -cp "out" org.testng.TestNG -testclass com.foo.Bar -methods com.foo.Bar.adds')
  assert.equal(testngRerunCommand('mvn test', ['com.foo.Bar#a', 'com.foo.Bar#b']), 'mvn test -Dtest=com.foo.Bar#a,com.foo.Bar#b')
  assert.equal(testngRerunCommand('mvn test', []), 'mvn test')
  assert.equal(testngSuiteLabel(), 'TestNG')
})

test('接线：testRunner.discover 与面板都按 TestNG 分派', () => {
  const runner = read('src/testRunner.ts')
  assert.match(runner, /from '\.\/testng\.ts'/)
  assert.match(runner, /isTestngSource\(text\)/)
  assert.match(runner, /discoverTestngTests\(text\)/)
  const panel = read('src/components/TestRunnerPanel.vue')
  assert.match(panel, /frameworkOfSource\(text\) === TESTNG_FRAMEWORK_NAME \? 'testng' : 'junit'/)
  assert.match(panel, /framework === 'junit' \|\| framework === 'testng'/)
})