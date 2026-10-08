// 提取超类 / 提取接口（`src/refactorExtractSuper.ts`）的判据 ——
// lp/refactoring 里 `ExtractSuperclassAction`/`ExtractInterfaceAction` 那一族的文本层等价物。
//
// 上游依据（与源文件头同一批，行号可复现）：
//   · `platform/platform-impl/resources/idea/LangActions.xml:377-382`（动作 id 与子菜单位次）；
//   · `platform/lang-impl/src/com/intellij/refactoring/extractSuperclass/ExtractSuperBaseDialog.java:59-70`；
//   · `java/java-impl-refactorings/src/com/intellij/refactoring/extractSuperclass/ExtractSuperBaseProcessor.java:117-125`。
import test from 'node:test'
import assert from 'node:assert/strict'
import { applyTextEdits } from '../src/editorText.ts'
import {
  EXTRACT_SUPER_KEYWORD,
  EXTRACT_SUPER_TITLES,
  defaultNewPath,
  extractSuperEdits,
  extractSuperNotice,
  supportsExtractSuper,
} from '../src/refactorExtractSuper.ts'

const JAVA = [
  'package app;',
  '',
  'public class Order {',
  '  private int total;',
  '',
  '  public int getTotal() {',
  '    return total;',
  '  }',
  '',
  '  public void add(int amount) {',
  '    total += amount;',
  '  }',
  '}',
  '',
].join('\n')

function editsFor(overrides = {}) {
  return extractSuperEdits({
    kind: 'superclass', language: 'java', path: 'app/Order.java', text: JAVA,
    className: 'Order', newName: 'BaseOrder', newPath: 'app/BaseOrder.java',
    memberNames: ['getTotal'], packageName: 'app', ...overrides,
  })
}

test('语言档：花括号语言支持，Python/Go 不做（没有类体花括号解析）', () => {
  for (const language of ['java', 'kotlin', 'typescript', 'javascript', 'cpp', 'c']) assert.equal(supportsExtractSuper(language), true)
  for (const language of ['python', 'go', 'rust']) assert.equal(supportsExtractSuper(language), false)
})

test('标题与关键字照上游两个动作（提取超类 class / 提取接口 interface）', () => {
  assert.deepEqual(EXTRACT_SUPER_TITLES, { superclass: '提取超类', interface: '提取接口' })
  assert.deepEqual(EXTRACT_SUPER_KEYWORD, { superclass: 'class', interface: 'interface' })
})

test('提取超类：新文件含抽出成员、源类插 extends、源类体删掉那一段', () => {
  const result = editsFor()
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.extracted, ['getTotal'])
  const source = result.edits.find(file => file.path === 'app/Order.java')
  const created = result.edits.find(file => file.path === 'app/BaseOrder.java')
  assert.ok(source && created, '源文件与新建文件各一条编辑')
  // 源类插上 extends BaseOrder。
  assert.match(applyTextEdits(JAVA, source.textEdits), /public class Order extends BaseOrder \{/)
  // 源类体里 getTotal 那一段被删掉（total 字段与 add 还在）。
  const rewritten = applyTextEdits(JAVA, source.textEdits)
  assert.ok(!/getTotal/.test(rewritten), '抽出的成员要从源类里删掉')
  assert.match(rewritten, /private int total;/)
  assert.match(rewritten, /public void add\(int amount\)/)
  // 新文件：包名 + class + 成员原样（超类不做抽象化）。
  assert.match(result.newFileText, /^package app;\n\nclass BaseOrder \{/)
  assert.match(result.newFileText, /public int getTotal\(\) \{/)
})

test('提取接口：方法体换成 `;`（接口方法没有实现体）', () => {
  const result = editsFor({ kind: 'interface', newName: 'TotalHolder', newPath: 'app/TotalHolder.java', memberNames: ['getTotal', 'add'] })
  assert.deepEqual(result.errors, [])
  assert.match(result.newFileText, /^package app;\n\ninterface TotalHolder \{/)
  assert.match(result.newFileText, /public int getTotal\(\);/)
  assert.match(result.newFileText, /public void add\(int amount\);/)
  assert.ok(!/\{\n\s*return total;/.test(result.newFileText), '接口里不留方法体')
  // 源类插 implements。
  const source = result.edits.find(file => file.path === 'app/Order.java')
  assert.match(applyTextEdits(JAVA, source.textEdits), /public class Order implements TotalHolder \{/)
})

test('已有 extends 时接口排在 extends 子句之后（implements 追加）', () => {
  const text = JAVA.replace('public class Order {', 'public class Order extends Parent {')
  const result = editsFor({ kind: 'interface', text, newName: 'TotalHolder', newPath: 'app/TotalHolder.java' })
  const source = result.edits.find(file => file.path === 'app/Order.java')
  assert.match(applyTextEdits(text, source.textEdits), /public class Order extends Parent implements TotalHolder \{/)
})

test('Kotlin：`: NewName()` 形态（超类带括号、接口不带）', () => {
  const kotlin = 'class Order {\n  fun total(): Int {\n    return 0\n  }\n}\n'
  const superResult = extractSuperEdits({
    kind: 'superclass', language: 'kotlin', path: 'Order.kt', text: kotlin,
    className: 'Order', newName: 'BaseOrder', newPath: 'BaseOrder.kt', memberNames: ['total'],
  })
  assert.deepEqual(superResult.errors, [])
  const edited = applyTextEdits(kotlin, superResult.edits.find(file => file.path === 'Order.kt').textEdits)
  assert.match(edited, /class Order : BaseOrder\(\) \{/)
})

test('校验：空名 / 非法名 / 空路径 / 与源文件同路径 / 没勾成员都报错且不出编辑', () => {
  for (const overrides of [
    { newName: '' }, { newName: '1Bad' }, { newPath: '' }, { newPath: 'app/Order.java' }, { memberNames: [] },
  ]) {
    const result = editsFor(overrides)
    assert.ok(result.errors.length > 0, `${JSON.stringify(overrides)} 应当报错`)
    assert.deepEqual(result.edits, [])
  }
})

test('勾了不存在的成员：进 missing，不静默丢', () => {
  const result = editsFor({ memberNames: ['getTotal', 'nope'] })
  assert.deepEqual(result.extracted, ['getTotal'])
  assert.deepEqual(result.missing, ['nope'])
})

test('认不出类名时报错（不猜一个类去改）', () => {
  const result = editsFor({ className: 'Missing' })
  assert.equal(result.edits.length, 0)
  assert.match(result.errors.join(''), /找不到类「Missing」/)
})

test('defaultNewPath：同目录、新名字 + 源扩展名', () => {
  assert.equal(defaultNewPath('app/Order.java', 'BaseOrder'), 'app/BaseOrder.java')
  assert.equal(defaultNewPath('Order.kt', 'Base'), 'Base.kt')
})

test('完成提示带上新文件路径与没找到的名字', () => {
  const result = editsFor({ memberNames: ['getTotal', 'nope'] })
  const notice = extractSuperNotice('superclass', 'Order', 'BaseOrder', 'app/BaseOrder.java', result)
  assert.match(notice, /已从「Order」抽出 1 个成员到新超类「BaseOrder」（app\/BaseOrder.java）/)
  assert.match(notice, /没找到「nope」/)
})