// 引入形参对象（Introduce Parameter Object）的文本层判据。
// 上游依据（完整坐标在 `src/refactorIntroduceParameterObject.ts` 文件头）：
//   · `LangActions.xml:372` IntroduceParameterObject
//   · `AbstractIntroduceParameterObjectDialog.java:66-105` 的三行面板次序
//   · `RefactoringBundle.properties:395/:396/:398/:399/:482`
//   · zh 文案取 `localization-zh.jar` 的 `messages/RefactoringBundle.properties` 同名键
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parameterObjectEdits, splitWrappedParams, objectNameFor, wrapArguments, validateParameterObject,
  supportsDelegate, parameterObjectCommandName, PARAMETER_OBJECT_TITLE, PARAMETER_OBJECT_PANELS,
  PARAMETER_OBJECT_LANGUAGES, KEEP_AS_DELEGATE_LABEL, REFERENCES_TO_MODIFY_LABEL, indexOfWord,
} from '../src/refactorIntroduceParameterObject.ts'
import { parseSignature } from '../src/refactorSignature.ts'

const TS = `export function greet(name: string, loud = false, times: number = 1): string {
  const greeting = name + '!'
  return loud ? greeting.toUpperCase() : greeting
}
const a = greet("hi", true, 2)
`
const JAVA = `public class Holder {
  public String greet(String name, boolean loud) {
    return loud ? name.toUpperCase() : name;
  }
}
`
const KT = `interface I {
}
fun go(a: Int, b: Int): Int {
  return a + b
}
`
const PY = `def f(a, b=2):
    return a + b
`

const tsParsed = () => parseSignature(TS, TS.indexOf('const greeting'), 'typescript')

/** 把 LSP 行/列编辑倒序套回文本。 */
function apply(text, edits) {
  const lines = text.split('\n')
  const offset = (line, character) => lines.slice(0, line).reduce((sum, item) => sum + item.length + 1, 0) + character
  let out = text
  for (const edit of [...edits].sort((a, b) => b.startLine - a.startLine || b.startChar - a.startChar)) {
    out = out.slice(0, offset(edit.startLine, edit.startChar)) + edit.text + out.slice(offset(edit.endLine, edit.endChar))
  }
  return out
}

function runTs(overrides = {}) {
  const parsed = tsParsed()
  return parameterObjectEdits({
    path: 'a.ts', text: TS, parsed, className: 'GreetingParams',
    paramNames: ['name', 'loud'], keepAsDelegate: false,
    files: [{ path: 'a.ts', text: TS }, { path: 'b.ts', text: `import { greet } from './a'\nconst b = greet("hi", true, 2)\n` }],
    ...overrides,
  })
}

test('TS 端到端：生成 interface、参数表换成对象形参、方法体引用改前缀、调用点打包', () => {
  const out = runTs()
  assert.deepEqual(out.errors, [])
  assert.deepEqual(out.wrapped, ['name', 'loud'])
  assert.deepEqual(out.kept, ['times'])
  assert.equal(out.classDeclaration, 'interface GreetingParams {\n  name: string\n  loud: boolean\n}')
  assert.equal(out.callSites, 2, '本文件一处 + 另一文件一处')
  const byPath = Object.fromEntries(out.edits.map(file => [file.path, file.textEdits]))
  const nextTs = apply(TS, byPath['a.ts'])
  assert.match(nextTs, /^interface GreetingParams \{\n  name: string\n  loud: boolean\n\}\nexport function greet/, '类声明插在源声明那一行之前')
  assert.match(nextTs, /greet\(times: number = 1, greetingParams: GreetingParams\): string/, '留下的形参在前、对象形参在后')
  assert.match(nextTs, /const greeting = greetingParams\.name \+ '!'/, '体内引用换了前缀')
  assert.match(nextTs, /return greetingParams\.loud \?/, '默认值没写类型的形参按默认值猜出 boolean')
  assert.match(nextTs, /const a = greet\(\{name: "hi", loud: true\}, 2\)/, '调用点打包，没抽走的实参留在后面')
  assert.match(apply(`import { greet } from './a'\nconst b = greet("hi", true, 2)\n`, byPath['b.ts']),
    /greet\(\{name: "hi", loud: true\}, 2\)/, '跨文件调用点同样打包')
})

test('Java：类声明带构造器，调用点用 new，勾了委托才另发旧签名转发', () => {
  const parsed = parseSignature(JAVA, JAVA.indexOf('return loud'), 'java')
  const base = { path: 'Holder.java', text: JAVA, parsed, className: 'GreetParams', paramNames: ['name', 'loud'], files: [{ path: 'Holder.java', text: JAVA }] }
  const plain = parameterObjectEdits({ ...base, keepAsDelegate: false })
  assert.deepEqual(plain.errors, [])
  assert.equal(plain.classDeclaration,
    'class GreetParams {\n  String name;\n  boolean loud;\n\n  GreetParams(String name, boolean loud) {\n    this.name = name;\n    this.loud = loud;\n  }\n}')
  const next = apply(JAVA, plain.edits[0].textEdits)
  assert.match(next, /public String greet\(GreetParams greetParams\) \{/, 'Java 的参数表是「类型 名字」')
  assert.match(next, /return greetParams\.loud \? greetParams\.name\.toUpperCase\(\) : greetParams\.name;/, '体内三处引用都改前缀')
  assert.doesNotMatch(next, /greetParams\.greetParams/, '不会重复套前缀')
  const delegated = parameterObjectEdits({ ...base, keepAsDelegate: true })
  const withDelegate = apply(JAVA, delegated.edits[0].textEdits)
  assert.match(withDelegate, /public String greet\(String name, boolean loud\) \{\n\s*return greet\(new GreetParams\(name, loud\)\);\n\s*\}/,
    '委托声明是旧签名 + 转调新签名（上游 keep.method.as.delegate）')
  assert.equal(supportsDelegate('java'), true)
})

test('Kotlin/Python 各自的形参类与实参形态', () => {
  const kt = parseSignature(KT, KT.indexOf('return a + b'), 'kotlin')
  const ktOut = parameterObjectEdits({
    path: 'go.kt', text: KT, parsed: kt, className: 'Args', paramNames: ['a', 'b'], keepAsDelegate: false, files: [{ path: 'go.kt', text: KT }],
  })
  assert.deepEqual(ktOut.errors, [])
  assert.equal(ktOut.classDeclaration, 'data class Args(\n  val a: Int,\n  val b: Int\n)')
  assert.match(apply(KT, ktOut.edits[0].textEdits), /fun go\(args: Args\): Int \{/, 'Kotlin 返回类型在参数表之后')

  const py = parseSignature(PY, PY.indexOf('return a + b'), 'python')
  const pyOut = parameterObjectEdits({
    path: 'f.py', text: PY, parsed: py, className: 'Args', paramNames: ['a', 'b'], keepAsDelegate: false, files: [{ path: 'f.py', text: PY }],
  })
  assert.deepEqual(pyOut.errors, [])
  assert.match(pyOut.classDeclaration, /class Args:\n    def __init__\(self, a = None, b = 2\):/, 'Python 用 __init__ 而不是 dataclass（免 import）')
  const nextPy = apply(PY, pyOut.edits[0].textEdits)
  assert.match(nextPy, /def f\(args\):/, 'Python 形参没有类型标注')
  assert.match(nextPy, /return args\.a \+ args\.b/, '体内引用改前缀')
})

test('反向判据：勾选为空、只有一个形参还全抽、类名非法或与形参/方法重名，都不出编辑', () => {
  const parsed = tsParsed()
  const none = runTs({ paramNames: [] })
  assert.deepEqual(none.edits, [])
  assert.match(none.errors.join(''), /没有勾选/)
  const one = parameterObjectEdits({ path: 'p.ts', text: 'function f(a) {\n  return a\n}\n', parsed: parseSignature('function f(a) {\n  return a\n}\n', 18, 'typescript'), className: 'P', paramNames: ['a'], keepAsDelegate: false, files: [] })
  assert.match(one.errors.join(''), /至少要留一个形参/)
  assert.match(runTs({ className: 'a b' }).errors.join(''), /空白字符/)
  assert.match(runTs({ className: 'loud' }).errors.join(''), /与形参重名/)
  assert.match(runTs({ className: 'greet' }).errors.join(''), /与方法名重名/)
  assert.match(runTs({ paramNames: ['nope'] }).errors.join(''), /不在「greet」的参数表里：nope/)
  assert.equal(validateParameterObject(parsed, 'GreetingParams', 2), '')
})

test('没有生成规则的语言档直接报错（不生成看不懂的代码）', () => {
  for (const language of ['go', 'c', 'cpp', 'javascript']) {
    assert.equal(PARAMETER_OBJECT_LANGUAGES.includes(language), false, `${language} 不在支持表里`)
  }
  const goText = 'func add(x int, y int) int {\n  return x + y\n}\n'
  const parsed = parseSignature(goText, goText.indexOf('return x'), 'go')
  assert.equal(parsed.language, 'go')
  const out = parameterObjectEdits({ path: 'a.go', text: goText, parsed, className: 'Args', paramNames: ['x', 'y'], keepAsDelegate: false, files: [] })
  assert.deepEqual(out.edits, [], 'Go 档不出编辑')
  assert.match(out.errors.join(''), /没有形参类声明的生成规则/)
})

test('「使方法保持为委托」只在有重载的档上给；其它档给了就是错，不是死复选框', () => {
  assert.deepEqual(['java', 'kotlin'].filter(supportsDelegate), ['java', 'kotlin'])
  assert.equal(supportsDelegate('typescript'), false)
  assert.equal(supportsDelegate('python'), false)
  const out = runTs({ keepAsDelegate: true })
  assert.deepEqual(out.edits, [])
  assert.match(out.errors.join(''), /需要方法重载/)
})

test('注释里的同名调用点不改（那是「搜索注释/字符串」那一档，不属于本重构）', () => {
  const text = `export function greet(name: string, loud = false): string {
  // greet("nope", true)
  return loud ? name : name
}
`
  const parsed = parseSignature(text, text.indexOf('return loud'), 'typescript')
  const nonCode = [{ from: text.indexOf('//'), to: text.indexOf('true)') + 5 }]
  const out = parameterObjectEdits({
    path: 'a.ts', text, parsed, className: 'P', paramNames: ['name', 'loud'], keepAsDelegate: false,
    files: [{ path: 'a.ts', text, nonCode }],
  })
  assert.equal(out.callSites, 0, '注释里那一处没被当调用点')
  assert.equal(out.edits.length, 1)
})

test('方法体里已是成员访问的位置不重复套前缀', () => {
  const text = 'function f(name, times) {\n  return wrap(name) + other.name + times\n}\n'
  const parsed = parseSignature(text, text.indexOf('return wrap'), 'typescript')
  const out = parameterObjectEdits({ path: 'a.ts', text, parsed, className: 'P', paramNames: ['name'], keepAsDelegate: false, files: [] })
  assert.deepEqual(out.errors, [], '还有一个形参留在参数表里')
  const next = apply(text, out.edits[0].textEdits)
  assert.match(next, /wrap\(p\.name\)/, '裸引用改前缀')
  assert.match(next, /other\.name/, '已经是成员访问的不动')
  assert.match(next, /\+ times\n\}/, '没抽走的形参在体内保持原样')
  assert.equal(indexOfWord('a.name', 'name', 0, 6), 2)
})

test('对象形参名字与留下的形参撞车时加后缀（否则参数表里会出现两个同名形参）', () => {
  const parsed = tsParsed()
  assert.deepEqual(objectNameFor([], 'GreetingParams'), 'greetingParams')
  assert.equal(objectNameFor([{ name: 'greetingParams', type: '', defaultValue: '', variadic: false, originalIndex: 0 }], 'GreetingParams'),
    'greetingParamsObject')
  const swapped = splitWrappedParams(parsed, ['loud', 'name'])
  assert.deepEqual(swapped.wrapped.map(param => param.name), ['loud', 'name'], '勾选次序决定字段次序，不是参数表次序')
})

test('文案与面板次序逐条钉上游', () => {
  assert.equal(PARAMETER_OBJECT_TITLE, '引入形参对象')
  assert.deepEqual(PARAMETER_OBJECT_PANELS, ['要提取形参的方法', '形参类', '要提取的形参'])
  assert.equal(KEEP_AS_DELEGATE_LABEL, '使方法保持为委托')
  assert.equal(REFERENCES_TO_MODIFY_LABEL, '要修改的引用')
  assert.equal(parameterObjectCommandName('GreetingParams', 'greet'), '为 greet() 引入了形参类 GreetingParams')
  assert.equal(wrapArguments(tsParsed(), 'P', [{ name: 'a', type: '', defaultValue: '', variadic: false, originalIndex: 0 }], [0], ['1']), '{a: 1}')
})
