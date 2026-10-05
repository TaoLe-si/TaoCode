// 成员上移 / 下移（Pull Up / Push Down）的文本层判据。
// 上游依据（文件头有完整坐标）：
//   · `platform/platform-impl/resources/idea/LangActions.xml:391-392` MembersPullUp / MemberPushDown
//   · `platform/refactoring/resources/messages/RefactoringBundle.properties:129/:133/:56/:261/:262/:264/:266`
//   · `java/java-impl-refactorings/src/com/intellij/refactoring/memberPushDown/PushDownDialog.java:31-36`
//     （勾选表 + 「Keep abstract」那一列）
// zh 文案取自 `plugins/localization-zh/lib/localization-zh.jar` 的 `messages/RefactoringBundle.properties`。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  findMemberMoveClasses, classMembers, memberMoveEdits, memberMoveNotice, reindentMember,
  MEMBER_MOVE_TITLES, KEEP_ABSTRACT_COLUMN, memberMovePanelTitle, supportsMemberMove, pickMembers,
} from '../src/refactorMemberMove.ts'

const CHILD = `public class Child extends Base {
  // 计数字段
  private int count = 0;
  /** 累加。
   * 第二行
   */
  public void bump(int by) {
    count += by;
    log("a;b");
  }
  public static String label() {
    return "x";
  }
}
`

const BASE = `public abstract class Base {
  public void run() {
    ready();
  }
}
`

/** 把 LSP 的行/列编辑套回文本（倒序套用，前面的编辑不挪后面的坐标）。 */
function apply(text, edits) {
  const lines = text.split('\n')
  const offset = (line, character) => lines.slice(0, line).reduce((sum, item) => sum + item.length + 1, 0) + character
  let out = text
  for (const edit of [...edits].sort((a, b) => b.startLine - a.startLine || b.startChar - a.startChar)) {
    const from = offset(edit.startLine, edit.startChar)
    const to = offset(edit.endLine, edit.endChar)
    out = out.slice(0, from) + edit.text + out.slice(to)
  }
  return out
}

const childClass = () => findMemberMoveClasses(CHILD, 'java')[0]
const baseClass = () => findMemberMoveClasses(BASE, 'java')[0]

test('勾选表：类体顶层的成员被逐条列出，注释跟着成员走，方法体里的分号不截断声明', () => {
  const members = classMembers(CHILD, childClass())
  assert.deepEqual(members.map(member => `${member.kind}:${member.name}`), ['field:count', 'method:bump', 'method:label'])
  assert.equal(members.find(member => member.name === 'label').static, true, 'static 位')
  assert.equal(members.find(member => member.name === 'bump').static, false)
  // bump 的段范围含上面那三行注释（上游搬成员时 JavaDoc 跟着走，RefactoringBundle.properties:263）。
  const bump = members.find(member => member.name === 'bump')
  assert.ok(CHILD.slice(bump.from, bump.to).startsWith('  /** 累加'), '注释并进成员段')
  assert.ok(CHILD.slice(bump.from, bump.to).trimEnd().endsWith('}'), '段尾是整个方法体，不是第一行的 (')
  // `log("a;b")` 里那个分号不会把方法截断。
  assert.equal(bump.to, bump.from + CHILD.slice(bump.from, bump.to).length)
  assert.doesNotMatch(CHILD.slice(bump.from, bump.to), /label/, '不会一路吃到下一个成员')
})

test('类声明：认得出 extends 的父类名与 abstract 位；接口不算父类', () => {
  assert.equal(childClass().name, 'Child')
  assert.equal(childClass().baseName, 'Base')
  assert.equal(childClass().abstract, false)
  assert.equal(baseClass().abstract, true, 'abstract class 的位要打出来（「保持抽象」要校验它）')
  const iface = findMemberMoveClasses('interface I {\n  void run();\n}\n', 'java')[0]
  assert.equal(iface.isInterface, true)
  assert.equal(iface.baseName, null, 'interface 没写 extends 就没有上移目标')
  assert.deepEqual(classMembers('interface I {\n  void run();\n}\n', iface).map(member => member.name), ['run'])
})

test('上移：子类删这一段、父类插这一段，两个文件各一条 LspFileEdits', () => {
  const result = memberMoveEdits({
    direction: 'up', language: 'java',
    source: { path: 'Child.java', text: CHILD, className: 'Child' },
    target: { path: 'Base.java', text: BASE, className: 'Base' },
    memberNames: ['bump'],
  })
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.moved, ['bump'])
  assert.equal(result.edits.length, 2)
  assert.deepEqual(result.edits.map(file => file.path), ['Child.java', 'Base.java'])
  const nextChild = apply(CHILD, result.edits.find(file => file.path === 'Child.java').textEdits)
  assert.ok(!nextChild.includes('bump'), '子类里那一段没了')
  assert.ok(nextChild.includes('private int count = 0;'), '没被勾选的成员不动')
  const nextBase = apply(BASE, result.edits.find(file => file.path === 'Base.java').textEdits)
  assert.ok(nextBase.includes('public void bump(int by) {'), '父类拿到整段')
  assert.ok(nextBase.trimEnd().endsWith('}'), '插在类体右花括号之前，不是文件末尾')
  assert.match(nextBase, /ready\(\);\n  \}\n  \/\*\* 累加/, '插在既有成员之后、类体右花括号之前')
})

test('反向判据：没有父类的类、找不到的类、没勾选，都不出编辑（只给中文原因）', () => {
  const orphan = memberMoveEdits({
    direction: 'up', language: 'java',
    source: { path: 'Base.java', text: BASE, className: 'Base' },
    target: { path: 'Base.java', text: BASE, className: 'Base' },
    memberNames: ['run'],
  })
  assert.deepEqual(orphan.edits, [], '没有 extends ⇒ 不上移')
  assert.match(orphan.errors.join(''), /没有父类/)
  const nothing = memberMoveEdits({
    direction: 'up', language: 'java',
    source: { path: 'Child.java', text: CHILD, className: 'Child' },
    target: { path: 'Base.java', text: BASE, className: 'Base' },
    memberNames: [],
  })
  assert.deepEqual(nothing.errors, ['没有勾选要搬动的成员。'])
  const missing = memberMoveEdits({
    direction: 'up', language: 'java',
    source: { path: 'Child.java', text: CHILD, className: 'Child' },
    target: { path: 'Other.java', text: 'class Different {\n  int a = 1;\n}\n', className: 'Other' },
    memberNames: ['bump'],
  })
  assert.match(missing.errors.join(''), /找不到类「Other」的声明/)
  assert.deepEqual(missing.edits, [], '目标类找不到时一条编辑都不出')
})

test('目标类已有同名成员 ⇒ 跳过，不出重复声明（上游同样拒绝产生同名成员）', () => {
  const baseWithBump = BASE.replace('ready();', 'bump(1);').replace('  public void run()', '  public void bump(int by) {\n    other();\n  }\n  public void run()')
  const result = memberMoveEdits({
    direction: 'up', language: 'java',
    source: { path: 'Child.java', text: CHILD, className: 'Child' },
    target: { path: 'Base.java', text: baseWithBump, className: 'Base' },
    memberNames: ['bump', 'label'],
  })
  assert.deepEqual(result.skipped, ['bump'])
  assert.deepEqual(result.moved, ['label'])
  const nextBase = apply(baseWithBump, result.edits.find(file => file.path === 'Base.java').textEdits)
  assert.equal((nextBase.match(/void bump/g) ?? []).length, 1, '没有把 bump 复制一份')
  assert.match(memberMoveNotice('up', 'Child', 'Base', result), /「bump」在目标类里已存在，没有搬/)
})

test('「保持抽象」那一列：源类换成 abstract 声明；目标类不是抽象类就报错', () => {
  const kept = memberMoveEdits({
    direction: 'up', language: 'java',
    source: { path: 'Child.java', text: CHILD, className: 'Child' },
    target: { path: 'Base.java', text: BASE, className: 'Base' },
    memberNames: ['bump'], keepAbstract: { bump: true },
  })
  assert.deepEqual(kept.errors, [])
  const nextChild = apply(CHILD, kept.edits.find(file => file.path === 'Child.java').textEdits)
  assert.match(nextChild, /public abstract void bump\(int by\);/, '换成抽象声明（PushDownDialog.java:31-36 的那一列）')
  assert.doesNotMatch(nextChild, /count \+= by/, '实现体留在父类')
  const rejected = memberMoveEdits({
    direction: 'up', language: 'java',
    source: { path: 'Child.java', text: CHILD, className: 'Child' },
    target: { path: 'Plain.java', text: 'class Plain {\n  int a = 1;\n}\n', className: 'Plain' },
    memberNames: ['bump'], keepAbstract: { bump: true },
  })
  assert.match(rejected.errors.join(''), /不是抽象类/)
  assert.deepEqual(rejected.edits, [], '报错时一条编辑都不出')
})

test('下推：父类删、子类插，方向只换源/目标；文案说清「会删掉源类里的声明」', () => {
  const result = memberMoveEdits({
    direction: 'down', language: 'java',
    source: { path: 'Base.java', text: BASE, className: 'Base' },
    target: { path: 'Child.java', text: CHILD, className: 'Child' },
    memberNames: ['run'],
  })
  assert.deepEqual(result.moved, ['run'])
  const nextBase = apply(BASE, result.edits.find(file => file.path === 'Base.java').textEdits)
  assert.doesNotMatch(nextBase, /void run/, '源（父类）里真的删掉了')
  const nextChild = apply(CHILD, result.edits.find(file => file.path === 'Child.java').textEdits)
  assert.match(nextChild, /public void run\(\) \{/, '子类拿到那一段')
  assert.match(memberMoveNotice('down', 'Base', 'Child', result), /向下推送/)
})

test('缩进按目标类的成员缩进重排（源 2 格 → 目标 4 格，整段一起挪）', () => {
  const wide = 'public abstract class Base {\n    public void run() {\n        ready();\n    }\n}\n'
  const result = memberMoveEdits({
    direction: 'up', language: 'java',
    source: { path: 'Child.java', text: CHILD, className: 'Child' },
    target: { path: 'Base.java', text: wide, className: 'Base' },
    memberNames: ['bump'],
  })
  const nextBase = apply(wide, result.edits.find(file => file.path === 'Base.java').textEdits)
  assert.match(nextBase, /\n {4}public void bump\(int by\) \{/, '首行按目标缩进')
  assert.match(nextBase, /\n {6}count \+= by;/, '体内再加一级')
  assert.equal(reindentMember('  a() {\n    b();\n  }', '  ', '    '), '    a() {\n      b();\n    }')
})

test('无分号风格（Kotlin）的最后一个成员也认得；不支持的语言档直接返回空表', () => {
  const kt = 'class Child : Base() {\n    fun bump(by: Int) {\n        count += by\n    }\n    val count = 0\n}\n'
  const cls = findMemberMoveClasses(kt, 'kotlin')[0]
  assert.equal(cls.baseName, 'Base')
  assert.deepEqual(classMembers(kt, cls).map(member => member.name), ['bump', 'count'])
  assert.equal(supportsMemberMove('python'), false)
  assert.deepEqual(findMemberMoveClasses('class A:\n    def f(self):\n        pass\n', 'python'), [], 'Python 是缩进块，本仓不冒充')
  assert.deepEqual(findMemberMoveClasses('type A struct{}\n', 'go'), [], 'Go 没有继承，本仓不做上移')
})

test('勾选位与「保持抽象」位是成员表的两个布尔列（本仓 MemberInfo 的等价物）', () => {
  const members = classMembers(CHILD, childClass())
  assert.deepEqual(members.map(member => [member.selected, member.keepAbstract]), [[false, false], [false, false], [false, false]])
  const picked = pickMembers(members, ['bump', 'nope'])
  assert.deepEqual(picked.chosen.map(member => member.name), ['bump'])
  assert.deepEqual(picked.missing, ['nope'], '勾了却找不到的名字要报出来，不静默丢')
})

test('文案逐条钉上游（zh 值来自 localization-zh.jar 的同名键）', () => {
  assert.deepEqual(MEMBER_MOVE_TITLES, { up: '向上拉取成员', down: '向下推送成员' })
  assert.equal(KEEP_ABSTRACT_COLUMN, '保持抽象')
  assert.equal(memberMovePanelTitle('up', 'Child'), '将Child的成员向上拉取至:')
  assert.equal(memberMovePanelTitle('down', 'Base'), '从Base向下推送成员')
})
