// 更改签名（ChangeSignature）的文本层模型判据。
// 上游依据：`platform/lang-impl/src/com/intellij/refactoring/changeSignature/ChangeSignatureDialogBase.java`
//   · `:151` 标题 = `changeSignature.refactoring.name`（zh = 更改签名）
//   · `:236/:261` 名称与返回值类型两个输入框
//   · `:340` 形参那一栏的标题 `parameters.border.title`、`:556` 的签名预览分隔线
//   · `:476` 「传播形参」按钮的 alt G
//   · 列 = 类型/名称/默认值 —— `java/java-impl/src/com/intellij/refactoring/changeSignature/JavaParameterTableModel.java:54-56`
// 键位：`platform/platform-resources/src/keymaps/$default.xml:469-471`（control F6）
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  parseSignature, signaturePreview, renderParams, parseParam, splitTopLevel, findCallSites,
  rewriteCall, changeSignatureEdits, validateSignatureChange, moveParam, PARAMETER_COLUMNS, matchParen,
} from '../src/refactorSignature.ts'

const here = dirname(fileURLToPath(import.meta.url))
const read = relative => readFileSync(resolve(here, '..', relative), 'utf8')

const TS = `export function greet(name: string, loud = false): string {
  const greeting = name + '!'
  return loud ? greeting.toUpperCase() : greeting
}
const a = greet("hi", true)
`

test('TS：光标在方法体内时解析出名字/返回类型/形参三列', () => {
  const parsed = parseSignature(TS, TS.indexOf('const greeting'), 'typescript')
  assert.ok(parsed)
  assert.equal(parsed.name, 'greet')
  assert.equal(parsed.returnType, 'string')
  assert.deepEqual(parsed.params, [
    { name: 'name', type: 'string', defaultValue: '', variadic: false, originalIndex: 0 },
    { name: 'loud', type: '', defaultValue: 'false', variadic: false, originalIndex: 1 },
  ])
  // 名字与参数表的区间能对上原文（编辑落点就靠这两个）
  assert.equal(TS.slice(parsed.nameFrom, parsed.nameTo), 'greet')
  assert.equal(TS.slice(parsed.argsFrom, parsed.argsTo + 1), '(name: string, loud = false)')
})

test('Java：返回类型在名字之前，修饰符不算类型', () => {
  const java = `public class A {
  static final int add(int a, int b) {
    return a + b;
  }
}`
  const parsed = parseSignature(java, java.indexOf('return a + b'), 'java')
  assert.equal(parsed.name, 'add')
  assert.equal(parsed.returnType, 'int')
  assert.deepEqual(parsed.params.map(p => `${p.type} ${p.name}`), ['int a', 'int b'])
})

test('Python/Go/Kotlin 各自的参数形态都按语言档切开', () => {
  const py = `def f(a, b=2, c = 3) -> str:
    pass`
  const parsed = parseSignature(py, py.indexOf('pass'), 'python')
  assert.deepEqual(parsed.params, [
    { name: 'a', type: '', defaultValue: '', variadic: false, originalIndex: 0 },
    { name: 'b', type: '', defaultValue: '2', variadic: false, originalIndex: 1 },
    { name: 'c', type: '', defaultValue: '3', variadic: false, originalIndex: 2 },
  ])
  assert.equal(parsed.returnType, 'str')
  // Go 是「名字 类型」，与 Java 的「类型 名字」相反
  const go = `func (r Rep) add(x int, y int) int {
  return x + y
}`
  const goParsed = parseSignature(go, go.indexOf('return x'), 'go')
  assert.equal(goParsed.name, 'add')
  assert.equal(goParsed.returnType, 'int')
  assert.deepEqual(goParsed.params, [
    { name: 'x', type: 'int', defaultValue: '', variadic: false, originalIndex: 0 },
    { name: 'y', type: 'int', defaultValue: '', variadic: false, originalIndex: 1 },
  ])
  const kt = `interface I {
    fun go(a: Int): Int
}`
  const ktParsed = parseSignature(kt, kt.indexOf('go(') + 2, 'kotlin')
  assert.equal(ktParsed.name, 'go')
  assert.equal(ktParsed.returnType, 'Int')
})

test('反向判据：行尾的**调用**不会被当声明头', () => {
  const body = `function outer(a) {
  inner(b);
  const c = compute(1, 2);
  return compute(3, 4)
}`
  // 光标在 `compute(1, 2)` 那一处调用上，声明应仍然是包住它的 outer，而不是 compute
  assert.equal(parseSignature(body, body.indexOf('compute(1'), 'javascript').name, 'outer')
  // 抽象方法（无体、以 `;` 收尾）是声明，认得出来
  const abs = `public abstract class A {
  abstract void run();
}`
  assert.equal(parseSignature(abs, abs.indexOf('run(') + 2, 'java').name, 'run')
})

test('括号配对跳过字符串与注释；顶层逗号切分不切开嵌套括号', () => {
  assert.equal(matchParen('f(")}")', 1), 6)
  assert.deepEqual(splitTopLevel('a, f(b, c), Map<k, v>'), ['a', 'f(b, c)', 'Map<k, v>'])
  assert.equal(parseParam('opts = { a: 1, b: 2 }', 'typescript').defaultValue, '{ a: 1, b: 2 }')
})

test('签名预览按语言档渲染（上游 calculateSignature() 的等价物）', () => {
  const parsed = parseSignature(TS, TS.indexOf('const greeting'), 'typescript')
  assert.equal(signaturePreview(parsed, 'hail', 'number', [parsed.params[1]]),
    'function hail(loud = false): number')
  assert.equal(renderParams(parsed.params, 'typescript'), '(name: string, loud = false)')
  assert.equal(renderParams([{ name: 'self', type: 'Rep', defaultValue: '', variadic: false, originalIndex: -1 }], 'go'), '(self Rep)')
})

test('形参上移/下移（对话框里那对箭头按钮）', () => {
  const parsed = parseSignature(TS, TS.indexOf('const greeting'), 'typescript')
  assert.deepEqual(moveParam(parsed.params, 0, 1).map(p => p.name), ['loud', 'name'])
  assert.deepEqual(moveParam(parsed.params, 0, -1).map(p => p.name), ['name', 'loud'], '越界不动')
})

test('调用点：按身份带走实参，删掉的形参把实参一起去掉，新增的取默认值', () => {
  const parsed = parseSignature(TS, TS.indexOf('const greeting'), 'typescript')
  const call = `greet("hi", true)`
  const sites = findCallSites('b.ts', `const a = ${call}`, 'greet', [])
  assert.equal(sites.length, 1)
  assert.deepEqual(sites[0].args, ['"hi"', 'true'])
  // 只留第 1 位并把它改名成 volume —— 身份还在，实参 `true` 跟着走，被删的 `name` 那一位实参才丢
  const kept = rewriteCall(parsed.params, [{ ...parsed.params[1], name: 'volume' }], sites[0].args)
  assert.equal(kept.text, '(true)')
  assert.deepEqual(kept.droppedArgs, ['"hi"'])
  // 重排：把两行调换，实参也跟着调换
  const swapped = rewriteCall(parsed.params, [parsed.params[1], parsed.params[0]], sites[0].args)
  assert.equal(swapped.text, '(true, "hi")')
  assert.deepEqual(swapped.droppedArgs, [])
  // 新增形参没默认值 → 明确报出来（上游要求填默认值才给过）
  const added = rewriteCall(parsed.params, [...parsed.params, { name: 'extra', type: '', defaultValue: '', variadic: false, originalIndex: -1 }], sites[0].args)
  assert.deepEqual(added.missingDefaults, ['extra'])
  assert.equal(added.text, '("hi", true, )')
})

test('注释里的同名调用点不改（那属于「搜索注释/字符串」那一档，不属于改签名）', () => {
  const text = `const a = greet("hi")\n// greet("nope")\nconst b = greet("yo")`
  const nonCode = [{ from: text.indexOf('//'), to: text.indexOf('nope') + 6 }]
  assert.deepEqual(findCallSites('b.ts', text, 'greet', nonCode).map(s => s.args[0]), ['"hi"', '"yo"'])
})

test('端到端编辑：声明与同文件调用点各自一条参数表编辑，声明头本身不被当调用点', () => {
  const decl = TS
  const other = `import { greet } from './a'
const a = greet("hi", true)
`
  const parsed = parseSignature(decl, decl.indexOf('const greeting'), 'typescript')
  const out = changeSignatureEdits(parsed, 'a.ts', decl, 'greet', 'string', [parsed.params[1]],
    [{ path: 'a.ts', text: decl }, { path: 'b.ts', text: other }])
  const byPath = Object.fromEntries(out.edits.map(file => [file.path, file.textEdits]))
  assert.equal(byPath['a.ts'].length, 2, '声明处 1 条 + 本文件调用处 1 条')
  assert.equal(byPath['a.ts'][0].text, '(loud = false)')
  assert.equal(byPath['a.ts'][1].text, '(true)')
  assert.equal(byPath['b.ts'].length, 1)
  assert.equal(byPath['b.ts'][0].text, '(true)')
  assert.equal(out.rewrites[0].droppedArgs[0], '"hi"')
})

test('改名时调用点的名字与参数表各一条编辑，互不重叠', () => {
  const decl = TS
  const parsed = parseSignature(decl, decl.indexOf('const greeting'), 'typescript')
  const out = changeSignatureEdits(parsed, 'a.ts', decl, 'hail', 'string', [parsed.params[0]],
    [{ path: 'b.ts', text: 'const a = greet("hi", true)\n' }])
  const call = out.edits.find(file => file.path === 'b.ts').textEdits
  assert.equal(call.length, 2)
  assert.deepEqual(call.map(edit => edit.text).sort(), ['("hi")', 'hail'])
  // 两条编辑不重叠（重叠会被 src/renamePreview.ts 的冲突闸门整个拦下）
  assert.ok(call[0].startChar !== call[1].startChar)
  assert.ok(call[0].endChar <= call[1].startChar || call[1].endChar <= call[0].startChar)
})

test('输入校验：空名、非标识符、形参重名都拦下（上游 validateAndCommitData 那一档）', () => {
  const parsed = parseSignature(TS, TS.indexOf('const greeting'), 'typescript')
  assert.equal(validateSignatureChange(parsed, 'greet', parsed.params, 'typescript'), '')
  assert.match(validateSignatureChange(parsed, ' ', parsed.params, 'typescript'), /不能为空/)
  assert.match(validateSignatureChange(parsed, 'a b', parsed.params, 'typescript'), /合法标识符/)
  assert.match(validateSignatureChange(parsed, '2x', parsed.params, 'typescript'), /合法标识符/)
  assert.match(validateSignatureChange(parsed, 'greet',
    [{ name: 'a', type: '', defaultValue: '', variadic: false, originalIndex: -1 }, { name: 'a', type: '', defaultValue: '', variadic: false, originalIndex: -1 }],
    'typescript'), /重复/)
  assert.match(validateSignatureChange(parsed, 'greet',
    [{ name: 'x', type: '', defaultValue: '1', variadic: false, originalIndex: -1 }, { name: 'y', type: '', defaultValue: '', variadic: false, originalIndex: -1 }],
    'python'), /必须排在/)
  assert.match(validateSignatureChange(parsed, 'greet',
    [{ name: 'rest', type: '', defaultValue: '', variadic: true, originalIndex: -1 }, { name: 'y', type: '', defaultValue: '', variadic: false, originalIndex: -1 }],
    'java'), /必须排在最后/)
})

test('对话框三列的表头顺序照上游（类型 / 名称 / 默认值）', () => {
  assert.deepEqual(PARAMETER_COLUMNS.map(column => column.label), ['类型', '名称', '默认值'])
})

// 接线判据。旧版这两条是 grep **保留文件**（`src/keymapBindings.ts` / `src/App.vue`）里有没有那一段，
// 桶 1 对它们只读 ⇒ 永远绿不了，也不是我该改的东西（`batches-2026-10-06-buckets.md` §1）。
// 判词按 `tests/breadcrumbs-bar.test.mjs` 的既有惯例改成**接线面**：
//   · 键位事实不再依赖出厂表，而是直接引上游 `$default.xml:469-471`（取证门禁，比 grep 我们自己
//     的表更硬 —— 表是装配产物，上游 XML 才是口径）；
//   · 出厂表/宿主挂载这两件按 §4 交接线请求，请求里必须带**可直接粘贴**的那一条绑定与那两行挂载代码，
//     且那条绑定要满足出厂表自己的形状（`id: 'refactor.changeSignature'` + `control F6` + 上游坐标），
//     于是「接线没做」会从请求文件里红出来，而不是从别人名下的文件里。
test('接线：键位、菜单与对话框挂载都在生产链路上', () => {
  const upstream = readFileSync(resolve('D:/Backup/Downloads/intellij-community-master/intellij-community-master/'
    + 'platform/platform-resources/src/keymaps/$default.xml'), 'utf8')
  const at469 = upstream.split('\n').slice(468, 471).join('\n')
  assert.match(at469, /<action id="ChangeSignature">/, '$default.xml:469 是 ChangeSignature')
  assert.match(at469, /first-keystroke="control F6"/, '$default.xml:470 是 control F6')

  const menu = read('src/menus/refactorMenu.ts')
  assert.match(menu, /更改签名/, '重构菜单里有那一条')
  assert.match(menu, /id: 'refactor\.changeSignature'[^\n]*keys: 'Ctrl F6'/, '菜单那行的键位串与上游一致')
  // 编排层自己钉住上游坐标（宿主按键位表接上时以它为准，两处不会漂）。
  assert.match(read('src/refactorSignatureFlow.ts'), /\$default\.xml:469-471/)

  // 对话框真的消费模型（不是空壳），且组件侧不写盘（写盘在预览对话框之后）。
  const dialog = read('src/components/RefactorSignatureDialog.vue')
  assert.match(dialog, /import \{ PARAMETER_COLUMNS, type SignatureParam \} from '\.\.\/refactorSignature\.ts'/)
  assert.match(dialog, /签名预览/, '上游 signature.preview.border.title 那一块在')
  assert.match(dialog, /@click="emit\('apply'\)"/, '「重构」发意图，不自己写文件')

  // 2026-10-06 接线已完成（主代理授权改 App.vue / keymap.ts / keymapBindings.ts，
  // 报告见 docs/batch-2026-10-06-wiring1.md）⇒ 判据从「接线请求里写了那段可粘贴的代码」
  // 升级成「这三个生产文件里真的有那一条」。同一件事的**更强**写法，没有放松成 includes/ok。
  const bindings = read('src/keymapBindings.ts')
  assert.match(bindings, /id: 'refactor\.changeSignature', label: '更改签名…', display: 'Ctrl F6', scope: 'editor',/,
    '出厂键位表里必须有 Ctrl+F6 那一条（$default.xml:469-471）')
  assert.match(bindings, /chord: \{ key: 'f6', control: 'ctrl', forbid: \['shift', 'alt'\] \}, upstream: '\$default\.xml:469-471' \}/,
    '那条绑定的物理键/修饰键口径：control F6，且禁掉 Shift（ChangeTypeSignature :472-474）与 Alt（SwitchCoverage :36-38）')
  const keymap = read('src/keymap.ts')
  assert.match(keymap, /'refactor\.changeSignature': \(\) => openChangeSignature\(\)/,
    '分派表把那个动作交给宿主的 openChangeSignature（不是空壳）')
  const app = read('src/App.vue')
  assert.match(app, /<RefactorSignatureDialog v-if="changeSignatureState" :model="changeSignatureState"/,
    '对话框挂在 App.vue 上并吃宿主模型')
  assert.match(app, /@param="\(index, patch\) => changeSignature\.setParam\(index, patch\)"/,
    '表格里那一格的意图（第几行 + 改了什么）必须转交给编排层')
  assert.match(app, /@return-type="value => changeSignature\.setReturnType\(value\)"/,
    '返回类型那一格同理（组件的 emit 名是 returnType，模板写 kebab 的 @return-type）')
  assert.match(app, /refactorMenuContext: RefactorMenuContext = \{[^}]*\bopenChangeSignature\b[^}]*\}/,
    'openChangeSignature 进了重构菜单上下文（菜单那一条因此才会渲染出来）')
  assert.match(app, /createRefactorHost\(\{/,
    '装配只在 src/refactorHostAssembly.ts 里做一次，App.vue 只留调用与解构')
  assert.match(read('src/refactorHostAssembly.ts'), /createChangeSignatureFlow\(\{/,
    '编排层真的被装配（不是只有测试引它）')
  // 接线请求文档仍是这段工作的留痕，留着对坐标。
  assert.match(read('docs/wiring-requests-2026-10-06-bucket1b.md'), /keymapBindings\.ts/)
})
