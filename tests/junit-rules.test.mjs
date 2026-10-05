// exec/junit-inspection：第二批 JUnit 规则的判据。
// 上游对照：plugins/junit/src/com/intellij/execution/junit/codeInspection/
//   JUnitMixedFrameworkInspection.kt:59-101,128-161,166-179,183-227、
//   JUnitMalformedDeclarationInspection.kt:507,548,615,698、
//   MultipleExceptionsDeclaredOnTestMethodInspection.java:40-51,74-89、
//   naming/TestClassNamingConvention.java:31-37、naming/JUnit3MethodNamingConvention.java:22-32、
//   naming/JUnit4MethodNamingConvention.java:23-33，
//   文案：plugins/junit/resources/messages/JUnitBundle.properties:110-111,139-141,163-164,227-228、
//   java/java-analysis-impl/resources/messages/InspectionGadgetsBundle.properties:791,1116-1118,2041-2042。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
    NAMING_CONVENTIONS, annotationFamily, frameworksInScope as frameworksInScopeOf, importsByShortName, isTestAnnotated,
    junitRuleProblems, mixedFrameworkMessage, multipleExceptionsMessage, namingMessage, parseMethods,
    preferredFramework,
} from '../src/junitRules.ts'

const mask = text => {
  // 与 src/junitInspections.ts 的 maskNonCode 同一职责（这里只测规则逻辑，用原文即可）。
  return text
}

test('方法模型：注解、修饰符、返回类型、参数与 throws 都取到（词法可判的那几样）', () => {
  const code = [
    'package p;',
    'import org.junit.jupiter.api.Test;',
    'class Foo {',
    '  @Test',
    '  public static void adds(int a) throws IOException, SQLException {',
    '  }',
    '}',
  ].join('\n')
  const methods = parseMethods(mask(code))
  assert.equal(methods.length, 1)
  const method = methods[0]
  assert.equal(method.name, 'adds')
  assert.deepEqual(method.modifiers, ['public', 'static'])
  assert.equal(method.returnType, 'void')
  assert.equal(method.parameters, 'int a')
  assert.deepEqual(method.throws, ['IOException', 'SQLException'])
  assert.deepEqual(method.annotations, ['Test'])
})

test('裸 `@Test` 的归属由 import 的 FQN 判（jupiter ⇒ 5，org.junit ⇒ 4）', () => {
  const five = importsByShortName('import org.junit.jupiter.api.Test;')
  assert.equal(annotationFamily('Test', five), '5')
  const four = importsByShortName('import org.junit.Test;')
  assert.equal(annotationFamily('Test', four), '4')
  assert.equal(annotationFamily('TestCase', { TestCase: 'junit.framework.TestCase' }), '3')
})

test('首选框架的算法照上游 :166-179（超类 TestCase ⇒ 3；否则按注解数量，打平归 5）', () => {
  const junit3 = 'public class A extends junit.framework.TestCase { public void testThing() {} }'
  assert.equal(preferredFramework(junit3, parseMethods(junit3)), '3')
  const mostly4 = ['import org.junit.Test;', 'import org.junit.jupiter.api.Disabled;', 'class C {',
    '  @Test', '  public void a() {}', '  @Test', '  public void b() {}', '  @Disabled', '  public void c() {}', '}'].join('\n')
  assert.equal(preferredFramework(mostly4, parseMethods(mostly4)), '4')
  const tie = ['import org.junit.Test;', 'import org.junit.jupiter.api.Disabled;', 'class C {',
    '  @Test', '  public void a() {}', '  @Disabled', '  public void c() {}', '}'].join('\n')
  assert.equal(preferredFramework(tie, parseMethods(tie)), '5')          // 上游 :176-177 的顺序
  const mostly5 = ['import org.junit.jupiter.api.Test;', 'class C {', '  @Test', '  void a() {}', '}'].join('\n')
  assert.equal(preferredFramework(mostly5, parseMethods(mostly5)), '5')
})

test('scope 判据只看 import/全限定名（上游是「依赖库在不在 classpath」），裸 @Test 不算两代混用', () => {
  const only4 = 'import org.junit.Test;\nclass One {\n  @Test\n  public void a() {}\n}'
  const scope = frameworksInScopeOf(only4)
  assert.deepEqual([scope.junit3, scope.junit4, scope.junit5], [false, true, false])
  assert.equal(junitRuleProblems('One.java', only4).filter(p => p.source === 'JUnitMixedFramework').length, 0)
})

test('混用两代 API 才报（上游 shouldInspect :59-65），且文案逐字取自 bundle :111', () => {
  const code = [
    'import org.junit.Test;',
    'import org.junit.jupiter.api.RepeatedTest;',
    'class Mixed {',
    '  @Test',
    '  public void oldStyle() {}',
    '  @RepeatedTest(2)',
    '  public void newStyle() {}',
    '}',
  ].join('\n')
  const problems = junitRuleProblems('Mixed.java', code)
  const mixed = problems.filter(problem => problem.source === 'JUnitMixedFramework')
  assert.equal(mixed.length, 1, '只有少数那一代的注解才该被点名')
  // 上游 :166-179 数量打平时归 5，被点名的就是少数那一代（这里 @Test 是 4 的那一个），
  // 文案的 {1} 是**首选框架**（三个分支都传 preferedTestFramework）。
  assert.match(mixed[0].message, /Method oldStyle\(\) annotated with '@Test' inside class extending JUnit 5 TestCase/)
  assert.equal(mixedFrameworkMessage('newStyle', 'RepeatedTest', '4'),
    "Method newStyle() annotated with '@RepeatedTest' inside class extending JUnit 4 TestCase")
  // 只有一代 API 的文件不报。
  const single = 'import org.junit.Test;\nclass One { @Test public void a() {} }'
  assert.equal(junitRuleProblems('One.java', single).filter(p => p.source === 'JUnitMixedFramework').length, 0)
})

test('类上有 @RunWith 就整类跳过（上游 :80）', () => {
  const code = ['import org.junit.Test;', 'import org.junit.runner.RunWith;',
    'import org.junit.jupiter.api.RepeatedTest;', '@RunWith(SpringRunner.class)',
    'class R { @Test public void a() {} @RepeatedTest(2) public void b() {} }'].join('\n')
  assert.equal(junitRuleProblems('R.java', code).filter(p => p.source === 'JUnitMixedFramework').length, 0)
})

test('JUnit5 的 @Test 要 public / non-static / 无参 / void（上游 :615，文案 bundle :141）', () => {
  const code = 'import org.junit.jupiter.api.Test;\nclass M {\n  @Test\n  private static int adds(int a) {}\n}'
  const problems = junitRuleProblems('M.java', code)
  const malformed = problems.filter(problem => problem.source === 'JUnitMalformedDeclaration')
  assert.equal(malformed.length, 1)
  assert.match(malformed[0].message, /Method adds should be public, non-static, have no parameters and of type void/)
})

test('@RepeatedTest 次数 ≤ 0（上游 :698 / bundle :163）', () => {
  const code = 'import org.junit.jupiter.api.RepeatedTest;\nclass R {\n  @RepeatedTest(0)\n  void again() {}\n}'
  assert.match(junitRuleProblems('R.java', code).map(p => p.message).join('\n'),
    /The number of repetitions must be greater than zero/)
})

test('内部类里的测试没有 @Nested ⇒ 不会被执行（上游 :507/:548 / bundle :164）', () => {
  const code = ['import org.junit.jupiter.api.Test;', 'class Outer {',
    '  class Inner {', '    @Test', '    void inner() {}', '  }', '}'].join('\n')
  assert.match(junitRuleProblems('Outer.java', code).map(p => p.message).join('\n'),
    /Tests in nested class will not be executed/)
})

test('throws 列两个以上才是冗余声明（上游 :82-84），文案与修复标题取自 bundle :228 与 CommonQuickFixBundle :18', () => {
  const code = 'import org.junit.Test;\nclass T {\n  @Test\n  public void boom() throws IOException, SQLException {}\n}'
  const problems = junitRuleProblems('T.java', code)
  const found = problems.filter(problem => problem.source === 'MultipleExceptionsDeclaredOnTestMethod')
  assert.equal(found.length, 1)
  assert.match(found[0].message, /Method boom throws list could be replaced with 'throws Exception'/)
  assert.equal(multipleExceptionsMessage('boom'), "Method boom throws list could be replaced with 'throws Exception'")
  const single = 'import org.junit.Test;\nclass T {\n  @Test\n  public void boom() throws IOException {}\n}'
  assert.equal(junitRuleProblems('T.java', single).filter(p => p.source === 'MultipleExceptionsDeclaredOnTestMethod').length, 0)
})

test('命名规范：默认正则/长度/短名逐字取自上游三条', () => {
  assert.deepEqual(NAMING_CONVENTIONS.map(c => c.shortName),
    ['JUnitTestClassNamingConvention', 'JUnit3MethodNamingConvention', 'JUnit4MethodNamingConvention'])
  const testClass = NAMING_CONVENTIONS[0]
  assert.equal(testClass.pattern, '[A-Z][A-Za-z\\d]*Test(s|Case)?|Test[A-Z][A-Za-z\\d]*|IT(.*)|(.*)IT(Case)?')
  assert.equal(testClass.minLength, 5)
  assert.equal(testClass.maxLength, 255)
  assert.equal(NAMING_CONVENTIONS[1].pattern, 'test[A-Za-z_\\d]*')
  assert.equal(NAMING_CONVENTIONS[1].minLength, 8)
  assert.equal(NAMING_CONVENTIONS[2].pattern, '[a-z][A-Za-z_\\d]*')
  assert.equal(NAMING_CONVENTIONS[2].maxLength, 64)
})

test('命名文案三种形状（InspectionGadgetsBundle:1116-1118，元素名 :791/:2041/:2042）', () => {
  const convention = NAMING_CONVENTIONS[2]
  assert.equal(namingMessage(convention, 'a'), "JUnit 4+ test method name a is too short (1 < 4)")
  assert.equal(namingMessage(convention, 'Adds_Thing'), "JUnit 4+ test method name Adds_Thing doesn't match regex '[a-z][A-Za-z_\\d]*'")
  assert.equal(namingMessage(convention, 'addsThing'), null)
})

test('命名规范可配置：改了正则就用改后的；长度判据仍按上游的 min/max（NamingConventionBean 的三个字段）', () => {
  const code = 'import org.junit.Test;\nclass FooTests {\n  @Test\n  public void AddsNum() {}\n}'
  assert.equal(junitRuleProblems('FooTests.java', code).filter(p => p.source === 'JUnit4MethodNamingConvention').length, 1)
  const relaxed = junitRuleProblems('FooTests.java', code, { JUnit4MethodNamingConvention: '[A-Za-z_]+[A-Za-z]*' })
  assert.equal(relaxed.filter(p => p.source === 'JUnit4MethodNamingConvention').length, 0)
  // 长度不够不会因为放宽正则而放过（上游的 too short 判据排在正则之前）。
  const tooShort = junitRuleProblems('FooTests.java', 'import org.junit.Test;\nclass FooTests {\n  @Test\n  public void ab() {}\n}', { JUnit4MethodNamingConvention: '[a-z]+' })
  assert.match(tooShort.filter(p => p.source === 'JUnit4MethodNamingConvention').map(p => p.message).join('\n'), /too short \(2 < 4\)/)
})

test('测试类才查类名规范；不是测试类不报（上游 isApplicable :46-55）', () => {
  const helper = 'class HelperThing {\n  public int add(int a) { return a; }\n}'
  assert.equal(junitRuleProblems('HelperThing.java', helper).filter(p => p.source === 'JUnitTestClassNamingConvention').length, 0)
  const badly = 'import org.junit.Test;\nclass MathStuff {\n  @Test\n  public void addsNumbers() {}\n}'
  assert.equal(junitRuleProblems('MathStuff.java', badly).filter(p => p.source === 'JUnitTestClassNamingConvention').length, 1)
})

test('非 Java/Kotlin 文件一律不查', () => {
  assert.deepEqual(junitRuleProblems('notes.txt', 'public void boom() throws A, B {}'), [])
})

test('接线：本地检查通道并上了这批规则', () => {
  const source = readFileSync(new URL('../src/junitInspections.ts', import.meta.url), 'utf8')
  assert.match(source, /from '\.\/junitRules\.ts'/, '本地检查没有引用第二批规则')
  assert.match(source, /junitRuleProblems\(/, '本地检查没有调用第二批规则')
})

test('isTestAnnotated 认 @Test/@ParameterizedTest/@TestFactory/@RepeatedTest 与 JUnit3 的 testXxx', () => {
  assert.equal(isTestAnnotated({ name: 'testThing', annotations: [] }), true)
  assert.equal(isTestAnnotated({ name: 'adds', annotations: ['Test'] }), true)
  assert.equal(isTestAnnotated({ name: 'setUp', annotations: ['BeforeEach'] }), false)
})
