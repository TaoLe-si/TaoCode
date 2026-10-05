// Ctrl+U「转到父方法 / 父类或接口」的规则层（`src/navGotoSuper.ts`）。
//
// 上游依据（逐条）：
//   · 键位 `platform/platform-resources/src/keymaps/$default.xml:251-253`（动作 id 是 `GotoSuperMethod`）；
//     菜单位次 `platform/platform-impl/resources/idea/LangActions.xml:194`（`GoToCodeGroup` 内
//     GotoTypeDeclaration 之后）。
//   · 「当前元素」= `PsiTreeUtil.getNonStrictParentOfType(element, PsiMethod.class, PsiClass.class)`
//     —— `java/java-impl/src/com/intellij/codeInsight/navigation/JavaGotoSuperHandler.java:68`
//     （**非严格**：光标停在方法自己的签名行上也算；两档白名单就是方法/类）。
//   · 弹层标题两档：同文件 `:47`（方法 → `CodeInsightBundle.properties:118` "Choose super method"）
//     与 `:50`（类 → `JavaBundle.properties:317` "Choose super class or interface"）。
//   · 一条直跳、多条开弹层：`:41-53` 的 `PsiTargetNavigator`。
// 接线（宿主装配）在 `src/lspNavigation.ts` 的 `gotoSuper`；判据另一条在
// `tests/nav-goto-related.test.mjs` 的「接线」用例里。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  SUPER_CLASS_KINDS, SUPER_METHOD_KINDS, allSameSignature, enclosingSuperTarget, gotoSuperActionLabel,
  gotoSuperChooserTitle, gotoSuperNotFoundMessage, parameterCount, superMethodsIn, supertypeTargets, symbolBaseName,
} from '../src/navGotoSuper.ts'

const symbol = (name, kind, startLine, endLine, detail = '') => ({ name, kind, startLine, startChar: 0, endLine, endChar: 0, detail })

test('两档白名单：方法/构造器/函数算方法档，Class/Enum/Interface/Struct 算类档', () => {
  assert.deepEqual([...SUPER_METHOD_KINDS].sort((left, right) => left - right), [6, 9, 12])
  assert.deepEqual([...SUPER_CLASS_KINDS].sort((left, right) => left - right), [5, 10, 11, 23])
})

test('enclosingSuperTarget：取包含光标的**最内层**方法或类（非严格，签名行也算）', () => {
  const outline = [symbol('A', 5, 0, 20), symbol('field', 8, 2, 3), symbol('A.m', 6, 5, 10)]
  const inMethod = enclosingSuperTarget(outline, 7)
  assert.equal(inMethod.role, 'method')
  assert.equal(inMethod.element.name, 'A.m')
  assert.equal(inMethod.owner.name, 'A', '方法档要能报出宿主类（父类型是从类问出来的）')
  // 非严格：光标停在方法签名那一行本身
  assert.equal(enclosingSuperTarget(outline, 5).element.name, 'A.m')
  // 字段行：字段不在白名单里 → 落回外层类（上游那两个 class 参数就是白名单）
  const onField = enclosingSuperTarget(outline, 2)
  assert.equal(onField.role, 'class')
  assert.equal(onField.element.name, 'A')
  assert.equal(onField.owner, null)
})

test('enclosingSuperTarget：同行「外层类 + 内层方法」时区间小的胜出；光标不在任何符号里返回 null', () => {
  const sameLine = [symbol('Big', 5, 5, 40), symbol('Small', 5, 5, 8)]
  assert.equal(enclosingSuperTarget(sameLine, 5).element.name, 'Small')
  assert.equal(enclosingSuperTarget(sameLine, 99), null)
  assert.equal(enclosingSuperTarget(sameLine, 1.5), null, '不是整数行就当没有')
})

test('parameterCount：括号内按顶层逗号计数，泛型里的逗号不算；空括号 0；解析不出返回 null', () => {
  assert.equal(parameterCount({ name: 'Foo.bar(String a, int b)' }), 2)
  assert.equal(parameterCount({ name: 'run()' }), 0)
  assert.equal(parameterCount({ name: 'f(Map<String, Integer> m)' }), 1)
  assert.equal(parameterCount({ name: 'run', detail: '(int x, int y)' }), 2, 'name 没括号时试 detail')
  assert.equal(parameterCount({ name: 'run' }), null)
})

test('symbolBaseName：去掉 JDT 那份 `Foo.bar(...)` 的前缀与括号尾巴', () => {
  assert.equal(symbolBaseName('Foo.bar(int a)'), 'bar')
  assert.equal(symbolBaseName('run'), 'run')
  assert.equal(symbolBaseName(''), '')
})

test('superMethodsIn：同名 + 参数个数能对上才算；任一方个数未知时退化成只比名字', () => {
  const parentSymbols = [symbol('Foo.m(int a)', 6, 1, 2), symbol('Foo.m(int a, int b)', 6, 3, 4), symbol('Foo.other()', 6, 5, 6)]
  assert.deepEqual(superMethodsIn(parentSymbols, symbol('Bar.m(int a)', 6, 0, 0)).map(s => s.name), ['Foo.m(int a)'])
  const arityUnknown = superMethodsIn(parentSymbols, symbol('m', 6, 0, 0))
  assert.deepEqual(arityUnknown.map(s => s.name), ['Foo.m(int a)', 'Foo.m(int a, int b)'], '个数未知的父类型：名字对上就列出来，让用户看得见')
  assert.deepEqual(superMethodsIn([symbol('Foo.x()', 13, 1, 2)], symbol('Bar.x()', 6, 0, 0)), [], '非方法 kind 不收')
  assert.deepEqual(superMethodsIn(parentSymbols, symbol('', 6, 0, 0)), [], '没有名字就不猜')
})

test('标题两档 + 找不到时的文案 + 主菜单短形式', () => {
  assert.equal(gotoSuperChooserTitle('method'), '选择父方法')
  assert.equal(gotoSuperChooserTitle('class'), '选择父类或接口')
  assert.equal(gotoSuperActionLabel('method'), '转到父方法')
  assert.equal(gotoSuperActionLabel('class', true), '父类或接口')
  assert.equal(gotoSuperNotFoundMessage('method'), '没有找到父方法。')
  assert.equal(gotoSuperNotFoundMessage('class'), '没有找到父类或接口。')
})

test('allSameSignature（上游 :45 的 PsiUtil.allMethodsHaveSameSignature）：同签名时弹层不再额外标注签名', () => {
  assert.equal(allSameSignature([]), true)
  assert.equal(allSameSignature([{ detail: '(int)' }]), true)
  assert.equal(allSameSignature([{ detail: '(int)' }, { detail: '(int)' }]), true)
  assert.equal(allSameSignature([{ detail: '(int)' }, { detail: '(String)' }]), false)
  assert.equal(allSameSignature([{ name: 'A.m(int a)' }, { name: 'B.m(int a)' }]), true, 'detail 空时退到 name 的括号段')
})

test('supertypeTargets：没有路径的父类型一律丢掉（不画点不动的假行）', () => {
  assert.deepEqual(supertypeTargets([{ path: 'src/Base.java', line: 3, character: 6 }, { path: '' }]),
    [{ path: 'src/Base.java', line: 3, character: 6 }])
  assert.deepEqual(supertypeTargets([{ path: 'src/I.java' }]), [{ path: 'src/I.java', line: 0, character: 0 }])
})
