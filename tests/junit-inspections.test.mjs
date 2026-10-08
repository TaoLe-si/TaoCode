// exec/junit-inspection 本地检查规则（`src/junitInspections.ts`）的判据。
//
// 上游依据：`plugins/junit` 的 `codeInspection` 一族 + java-impl 的
// `MisorderedAssertEqualsArgumentsInspection`。这里逐规则钉住"该报的报、不该报的不报"，
// 并钉住本地检查通道进了问题面板的汇总表（不是只躺在模块里的死代码）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const { junitInspectionProblems, maskNonCode, localDiagnostics, refreshLocalInspections, clearLocalInspections } =
  await import('../src/junitInspections.ts')

const sources = (path, text) => junitInspectionProblems(path, text).map(problem => problem.source)

test('掩码：注释涂空格、字符串内容涂 x，长度与换行不变（按行定位可靠）', () => {
  const source = 'int a = 1; // assertEquals(x, 4)\nString s = "assertEquals(y, 5)";\n/* block\n   assertEquals(z, 6) */'
  const masked = maskNonCode(source)
  assert.equal(masked.length, source.length)
  assert.equal(masked.split('\n').length, source.split('\n').length)
  assert.equal(masked.split('\n')[0], 'int a = 1;                      ')
  assert.equal(sources('A.java', source).length, 0, '注释/字符串里的调用不算数')
})

test('参数顺序：字面量在后报、字面量在前不报，常量引用也按期望位算', () => {
  const wrong = junitInspectionProblems('src/MathTest.java', [
    'class MathTest {',
    '  void adds() {',
    '    int actual = add(1, 2);',
    '    assertEquals(actual, 4);',
    '  }',
    '}',
  ].join('\n'))
  assert.equal(wrong.length, 1)
  assert.equal(wrong[0].source, 'MisorderedAssertEqualsArguments')
  assert.equal(wrong[0].line, 3)
  assert.equal(wrong[0].character, '    assertEquals(actual, 4);'.indexOf('actual'), '列号指向期望参数')
  assert.match(wrong[0].message, /参数顺序可能颠倒/)

  const correct = 'assertEquals(4, actual);\nassertEquals(4, 5);\nassertEquals("adds", 4, actual);\nassertEquals(MAX_SIZE, actual);'
  assert.deepEqual(sources('A.java', correct), [], '字面量已在期望位（或两边都是字面量）不报')
  // 期望位不是字面量、实际位是 → 报（含三参的 message 形式与常量引用）。
  const stillWrong = [
    'assertEquals("adds", actual, 4);',
    'assertEquals(actual, MAX_SIZE);',
    'assertSame(value, "expected");',
    'assertNotEquals(result, 0);',
  ].join('\n')
  assert.deepEqual(sources('A.java', stillWrong),
    ['MisorderedAssertEqualsArguments', 'MisorderedAssertEqualsArguments', 'MisorderedAssertEqualsArguments', 'MisorderedAssertEqualsArguments'])
  // 跨行调用也能抽出参数。
  const multiline = sources('A.java', 'assertEquals(\n  actual,\n  "expected"\n);')
  assert.deepEqual(multiline, ['MisorderedAssertEqualsArguments'])
})

test('JUnit3 风格：JUnit4 类里没有 @Test 的 testXxx 报，带 @Test/@Ignore 或 JUnit3 类不报', () => {
  const junit4 = [
    'import org.junit.Test;',
    'class MathTest {',
    '  public void testLegacy() {}',
    '  @Test',
    '  public void testModern() {}',
    '  @Ignore("covered elsewhere")',
    '  public void testSkipped() {}',
    '}',
  ].join('\n')
  const problems = junitInspectionProblems('MathTest.java', junit4)
  assert.deepEqual(problems.map(problem => [problem.source, problem.line]), [['JUnit3StyleTestMethodInJUnit4Class', 2]])
  // 没有 JUnit4/5 标记的文件不提示（那是纯 JUnit3 工程，不是迁移对象）。
  assert.equal(sources('A.java', 'class A { public void testOld() {} }').length, 0)
  // JUnit3 类（extends TestCase）同样不提示这一条。
  assert.equal(sources('A.java', 'import org.junit.Test;\nclass A extends TestCase { public void testOld() {} }')
    .includes('JUnit3StyleTestMethodInJUnit4Class'), false)
})

test('过时 API：junit.framework 的导入/引用与 extends TestCase 都提示迁移', () => {
  const problems = junitInspectionProblems('OldTest.java', [
    'import junit.framework.Assert;',
    'import junit.framework.TestCase;',
    'public class OldTest extends TestCase {',
    '  void x() { junit.framework.Assert.assertEquals(1, 1); }',
    '}',
  ].join('\n'))
  assert.deepEqual(problems.map(problem => [problem.source, problem.line]), [
    ['UseOfObsoleteAssertInspection', 0],
    ['UseOfObsoleteAssertInspection', 1],
    ['JUnit4ConverterInspection', 2],
    ['UseOfObsoleteAssertInspection', 3],
  ])
})

test('@Ignore/@Disabled 无原因才报；有原因、参数跨行不猜', () => {
  const problems = junitInspectionProblems('A.java', [
    'class A {',
    '  @Ignore',
    '  void a() {}',
    '  @Ignore("flaky on CI")',
    '  void b() {}',
    '  @org.junit.jupiter.api.Disabled',
    '  void c() {}',
    '  @Disabled("slow")',
    '  void d() {}',
    '  @Ignore(',
    '    "reason on next line"',
    '  )',
    '  void e() {}',
    '}',
  ].join('\n'))
  assert.deepEqual(problems.map(problem => [problem.source, problem.line]), [
    ['JUnitIgnoredTestInspection', 1],
    ['JUnitIgnoredTestInspection', 5],
  ])
})

test('@Parameters 的数据提供者必须 static', () => {
  const problems = junitInspectionProblems('P.java', [
    'class P {',
    '  @Parameters',
    '  public Collection<Object[]> data() { return null; }',
    '  @org.junit.runners.Parameterized.Parameters(name = "x")',
    '  public static Collection<Object[]> good() { return null; }',
    '}',
  ].join('\n'))
  assert.deepEqual(problems.map(problem => [problem.source, problem.line]), [['ParameterizedParametersStaticCollection', 2]])
})

test('只看 Java/Kotlin：其它文件返回空；结果按行列排序', () => {
  assert.deepEqual(junitInspectionProblems('a.ts', 'assertEquals(actual, 4)'), [])
  const sorted = junitInspectionProblems('A.java', 'assertEquals(actual, 4);\n@Ignore\nvoid t() {}')
  assert.deepEqual(sorted.map(problem => problem.line), [0, 1])
})

test('本地检查通道：写进按文件存的诊断表，修好即删（问题面板读它）', () => {
  refreshLocalInspections('src/MathTest.java', 'class MathTest { void t() { assertEquals(actual, 4); } }')
  const stored = localDiagnostics.get('src/MathTest.java')
  assert.equal(stored?.length, 1)
  assert.equal(stored[0].source, 'MisorderedAssertEqualsArguments')
  assert.equal(stored[0].severity, 2)
  assert.equal(stored[0].line, 0)
  refreshLocalInspections('src/MathTest.java', 'class MathTest { void t() { assertEquals(4, actual); } }')
  assert.equal(localDiagnostics.has('src/MathTest.java'), false, '没有问题时条目删掉')
  clearLocalInspections('src/MathTest.java')
  // 接线（不是死代码）：问题汇总表读本地通道；编辑与打开、停止语言服务三条入口都接了。
  const problems = readFileSync('src/problems.ts', 'utf8')
  assert.match(problems, /localDiagnostics/)
  const navigation = readFileSync('src/lspNavigation.ts', 'utf8')
  assert.match(navigation, /refreshLocalInspections/)
  assert.match(navigation, /clearLocalInspections/)
})

// `JUnit3SuperTearDownInspection.kt:34-56`（`isJUnit3InScope` / 接收者 super / 方法名 tearDown /
// 不在 finally / hasNonTrivialActivity）与文案 `JUnitBundle.properties:107-108`。
test("JUnit3 的 super.tearDown()：不在 finally 且方法里还有别的调用才报", () => {
  const reported = junitInspectionProblems('ATest.java', [
    'import junit.framework.TestCase;',
    'class ATest extends TestCase {',
    '  protected void tearDown() {',
    '    cleanup();',
    '    super.tearDown();',
    '  }',
    '}',
  ].join('\n')).filter(problem => problem.source === 'JUnit3SuperTearDownInspection')
  assert.equal(reported.length, 1)
  assert.equal(reported[0].line, 4, '报在 super.tearDown() 那一行')
  assert.equal(reported[0].character, '    super.tearDown();'.indexOf('super'))
  // 上游 `JUnitBundle.properties:108` 的描述：`<code>#ref()</code> is not called from 'finally' block`。
  assert.match(reported[0].message, /^super\.tearDown\(\) is not called from 'finally' block/)
})

test('JUnit3 的 super.tearDown()：在 finally 里（含嵌套块）、无别的调用、非 TestCase 一律不报', () => {
  const tail = '  }\n}'
  const inFinally = [
    'import junit.framework.TestCase;',
    'class ATest extends TestCase {',
    '  protected void tearDown() {',
    '    cleanup();',
    '    try { work(); } finally {',
    '      if (ready) {',
    '        super.tearDown();',
    '      }',
    '    }',
    tail,
  ].join('\n')
  assert.equal(sources('A.java', inFinally).includes('JUnit3SuperTearDownInspection'), false,
    'finally 的嵌套块里也算在 finally 里（上游沿父链找）')
  // 除它之外没有别的调用（上游 hasNonTrivialActivity 为假）⇒ 不报。
  const trivial = [
    'import junit.framework.TestCase;',
    'class ATest extends TestCase {',
    '  protected void tearDown() {',
    '    super.tearDown();',
    tail,
  ].join('\n')
  assert.equal(sources('A.java', trivial).includes('JUnit3SuperTearDownInspection'), false)
  // 不是 JUnit3 的类（上游 isJUnit3InScope 的降级点：按 extends TestCase 判）。
  const plain = [
    'class ATest {',
    '  protected void tearDown() {',
    '    cleanup();',
    '    super.tearDown();',
    tail,
  ].join('\n')
  assert.deepEqual(sources('A.java', plain), [])
  // 方法名不是 tearDown（上游判「最近的 enclosing 方法是 tearDown」）。
  const other = [
    'import junit.framework.TestCase;',
    'class ATest extends TestCase {',
    '  protected void after() {',
    '    cleanup();',
    '    super.tearDown();',
    tail,
  ].join('\n')
  assert.equal(sources('A.java', other).includes('JUnit3SuperTearDownInspection'), false)
  // catch 里调用不算 finally ⇒ 报（列号指向那一行的 super）。
  const inCatch = [
    'import junit.framework.TestCase;',
    'class ATest extends TestCase {',
    '  protected void tearDown() {',
    '    try { work(); } catch (Exception e) {',
    '      super.tearDown();',
    '    }',
    tail,
  ].join('\n')
  assert.deepEqual(junitInspectionProblems('A.java', inCatch)
    .filter(problem => problem.source === 'JUnit3SuperTearDownInspection').map(problem => [problem.line, problem.character]),
    [[4, '      super.tearDown();'.indexOf('super')]])
})

test('检查器说明表里有 JUnit3SuperTearDownInspection 这条', async () => {
  const { inspectionDescriptionFor } = await import('../src/inspectionDescription.ts')
  const description = inspectionDescriptionFor('JUnit3SuperTearDownInspection')
  assert.ok(description, '上游有那么一个 generateDoc 入口，本地说明表里不能缺这一条')
  assert.match(description.content, /finally/)
})
