// 结构视图「继承成员 + 来源灰显」纯逻辑的判据（`src/outlineInheritedMembers.ts`）。
// 每条用例的上游出处写在该模块的注释里；这里只守**用户可见**的那几条规则：
//   · 自己的成员在前、继承成员在后，继承成员带来源类名（`JavaInheritedMembersNodeProvider`）；
//   · 构造器不继承、父类 private 不继承（`AddAllMembersProcessor`）；
//   · 同签名只留最派生（`AddAllMembersProcessor.shouldAdd`）；
//   · 继承成员按宿主超类型分组、组权重 20（`SuperTypesGrouper` / `KindSorter`）；
//   · 灰显 = 名字与来源类名两段都去强调（`StructureNodeRenderer` / `NOT_USED_ELEMENT_ATTRIBUTES`）；
//   · 开关默认关（`StructureViewFactoryImpl.ACTIVE_ACTIONS = ""` / `FileStructurePopup.getDefaultValue`）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  FIELDS_FILTER_ID, GROUP_ACCESS_SUBLEVEL, INHERITED_MEMBERS_LABEL, INHERITED_PROVIDER_ID,
  INHERITED_SOURCE_ARROW, INHERITED_TEXT_TOKEN, PUBLIC_ELEMENTS_FILTER_ID, SUPERTYPE_GROUP_WEIGHT,
  SUPERTYPES_GROUPER_ID, SUPERTYPES_GROUPER_LABEL,
  accessRank, dedupeInheritedBySignature, fieldsVisible, groupInheritedBySuperType,
  inheritedMembersDefaultOn, isAccessibleFromSubclass, isInheritableMember, isInheritedConstructor,
  isInheritedMember, isPublicMember, memberIdentity, memberKindWeight, memberPassesFilters,
  memberTextSegments, mergeInheritedMembers, methodOverridesSuper, ownershipForMember,
  publicElementsVisible, signatureKey, withSuperTypeAccess,
} from '../src/outlineInheritedMembers.ts'

const read = relative => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

const member = (name, kind, opts = {}) => ({
  name, kind,
  detail: opts.detail ?? '',
  path: opts.path ?? 'src/Base.java',
  startLine: opts.line ?? 0, startChar: opts.char ?? 0,
  endLine: opts.line ?? 0, endChar: (opts.char ?? 0) + name.length,
})

// 一个子类：自己一个方法；父类 Base（一个方法 + 一个构造器 + 一个 private 字段），
// 接口 Iface（一个方法）。父类型由近到远：Base 在前、Iface 在后。
const own = [member('ownOne', 6, { path: 'src/Sub.java', line: 1, detail: 'void ownOne()' })]
const superTypes = [
  { name: 'Base', detail: 'public class Base', members: [
    member('run', 6, { detail: 'public void run()', path: 'src/Base.java', line: 10 }),
    member('Base', 9, { detail: 'Base()', path: 'src/Base.java', line: 5 }),
    member('secret', 8, { detail: 'private int secret', path: 'src/Base.java', line: 20 }),
  ] },
  { name: 'Iface', detail: 'public interface Iface', members: [
    member('close', 6, { detail: 'void close()', path: 'src/Iface.java', line: 3 }),
  ] },
]

test('own members come first and keep their document order', () => {
  const merged = mergeInheritedMembers({ own, superTypes })
  assert.deepEqual(merged.own.map(m => m.name), ['ownOne'])
  assert.equal(merged.own[0].inherited, false)
  assert.equal(merged.own[0].sourceClass, null)
})

test('inherited members follow own members and carry their defining type', () => {
  const merged = mergeInheritedMembers({ own, superTypes })
  assert.deepEqual(merged.inherited.map(m => m.name), ['run', 'close'])
  assert.deepEqual(merged.inherited.map(m => m.sourceClass), ['Base', 'Iface'])
  assert.deepEqual(merged.inherited.map(m => m.inherited), [true, true])
  assert.deepEqual(merged.all.map(m => m.name), ['ownOne', 'run', 'close'])
})

test('constructors and private members are not inherited', () => {
  const merged = mergeInheritedMembers({ own, superTypes })
  const names = merged.inherited.map(m => m.name)
  assert.ok(!names.includes('Base'), '构造器不继承')
  assert.ok(!names.includes('secret'), '父类 private 不继承')
  assert.equal(isInheritedConstructor(member('X', 9)), true)
  assert.equal(isInheritedConstructor(member('X', 6)), false)
  assert.equal(isAccessibleFromSubclass(member('s', 8, { detail: 'private int s' })), false)
  assert.equal(isAccessibleFromSubclass(member('p', 8, { detail: 'protected int p' })), true)
  assert.equal(isInheritableMember(member('s', 8, { detail: 'private int s' })), false)
})

test('a member already declared in the class is not repeated as inherited', () => {
  const withOwnRun = [member('run', 6, { path: 'src/Base.java', line: 10, detail: 'public void run()' })]
  const merged = mergeInheritedMembers({ own: withOwnRun, superTypes })
  assert.ok(!merged.inherited.map(m => m.name).includes('run'), 'removeAll(ownChildren)')
  assert.deepEqual(merged.all.map(m => m.name), ['run', 'close'])
})

test('one signature wins once: the nearest supertype keeps it', () => {
  const both = [
    { name: 'Base', members: [member('run', 6, { detail: 'public void run()', path: 'src/Base.java', line: 10 })] },
    { name: 'Iface', members: [member('run', 6, { detail: 'void run()', path: 'src/Iface.java', line: 3 })] },
  ]
  const merged = mergeInheritedMembers({ own: [], superTypes: both })
  assert.equal(merged.inherited.length, 1)
  assert.equal(merged.inherited[0].sourceClass, 'Base')
  assert.equal(signatureKey(member('run', 6, { detail: 'void run(int a, String b)' })), 'run(int a, string b)')
  assert.equal(signatureKey(member('run', 6, { detail: 'void run' })), null, '没有参数表就不给签名键')
  assert.equal(signatureKey(member('count', 8, { detail: 'int count' })), null, '字段没有方法签名')
  assert.equal(dedupeInheritedBySignature([
    { ...member('a', 6, { detail: 'void a()' }), inherited: true, sourceClass: 'B' },
    { ...member('a', 6, { detail: 'void a()' }), inherited: true, sourceClass: 'C' },
  ]).length, 1)
})

test('an inherited member is grayed and followed by its defining type', () => {
  const segments = memberTextSegments({ name: 'run', inherited: true, sourceClass: 'Base' })
  assert.deepEqual(segments, [
    { text: 'run', tone: 'muted' },
    { text: `${INHERITED_SOURCE_ARROW}Base`, tone: 'muted' },
  ])
  assert.deepEqual(memberTextSegments({ name: 'ownOne', inherited: false, sourceClass: null }), [
    { text: 'ownOne', tone: 'regular' },
  ])
  // 来源类名拿不到时只画名字（不编一个来源出来）。
  assert.deepEqual(memberTextSegments({ name: 'x', inherited: true, sourceClass: null }), [
    { text: 'x', tone: 'muted' },
  ])
  assert.equal(INHERITED_TEXT_TOKEN, '--muted')
  assert.equal(INHERITED_SOURCE_ARROW, '\u2192')
})

test('inherited members group by their defining type, weight 20 and sublevel 1', () => {
  const merged = mergeInheritedMembers({ own, superTypes })
  const groups = withSuperTypeAccess(groupInheritedBySuperType(merged.inherited), superTypes)
  assert.deepEqual(groups.map(g => g.name), ['Base', 'Iface'])
  assert.deepEqual(groups[0].members.map(m => m.name), ['run'])
  assert.equal(groups[0].kindWeight, SUPERTYPE_GROUP_WEIGHT)
  assert.equal(groups[0].subLevel, 1)
  assert.equal(groups[0].ownership, 'INHERITS')
  assert.equal(groups[0].accessLevel, 4, '超类型的 public 档')
  // 自己的成员不进组（SuperTypesGrouper 只收 isInherited 的）。
  assert.equal(groupInheritedBySuperType(merged.own).length, 0)
})

test('a group sorts before a member of the same visibility', () => {
  assert.equal(GROUP_ACCESS_SUBLEVEL, 1)
  assert.equal(accessRank(4, 1), 9, '组：public + subLevel 1')
  assert.equal(accessRank(4, 0), 8, '成员：public + subLevel 0')
  assert.ok(accessRank(4, 1) > accessRank(4, 0))
  assert.equal(accessRank(1, 0), 2, 'private 成员排在最后')
})

test('kind weights are forwarded from the existing outline mapping', () => {
  assert.equal(memberKindWeight(5), 10, '工具窗口里的类型')
  assert.equal(memberKindWeight(5, true), 53, '弹层里的类型')
  assert.equal(memberKindWeight(6), 35, '方法')
  assert.equal(memberKindWeight(9), 30, '构造器')
  assert.equal(memberKindWeight(8), 50, '字段')
})

test('visibility filters follow the two upstream filter predicates', () => {
  assert.equal(publicElementsVisible(member('a', 6, { detail: 'public void a()' })), true)
  assert.equal(publicElementsVisible(member('a', 6, { detail: 'protected void a()' })), false)
  assert.equal(publicElementsVisible(member('a', 6, { detail: '' }), true), true, '顶层类型算 public')
  assert.equal(isPublicMember('class Top'), false)
  assert.equal(fieldsVisible(member('f', 8)), false)
  assert.equal(fieldsVisible(member('f', 13)), false)
  assert.equal(fieldsVisible(member('m', 6)), true)
  assert.equal(memberPassesFilters(member('f', 8), { hideFields: true }), false)
  assert.equal(memberPassesFilters(member('f', 8), { hideFields: false }), true)
  assert.equal(memberPassesFilters(member('m', 6, { detail: 'private void m()' }), { onlyPublic: true }), false)
})

test('the inherited-members toggle is off by default', () => {
  assert.equal(inheritedMembersDefaultOn(), false)
})

test('a member whose defining type differs from the tree parent is inherited', () => {
  assert.equal(isInheritedMember('Base', 'Sub'), true)
  assert.equal(isInheritedMember('Sub', 'Sub'), false)
  assert.equal(isInheritedMember(null, 'Sub'), true, '判不出宿主类时按继承处理（上游 getTreeParentClass 给 null）')
})

test('override vs implement follows methodOverridesSuper', () => {
  assert.equal(methodOverridesSuper(true, false), true)
  assert.equal(methodOverridesSuper(false, true), false, '父方法非抽象 = 实现')
  assert.equal(methodOverridesSuper(false, false), true)
  assert.equal(ownershipForMember({ inherited: true, overrides: true }), 'INHERITS')
  assert.equal(ownershipForMember({ inherited: false, overrides: true }), 'OVERRIDES')
  assert.equal(ownershipForMember({ inherited: false, overrides: false }), 'IMPLEMENTS')
})

test('member identity is name + kind + location', () => {
  const a = member('run', 6, { path: 'src/Base.java', line: 10 })
  const b = member('run', 6, { path: 'src/Base.java', line: 10 })
  const c = member('run', 6, { path: 'src/Other.java', line: 10 })
  assert.equal(memberIdentity(a), memberIdentity(b))
  assert.notEqual(memberIdentity(a), memberIdentity(c))
})

test('the ids and labels match the upstream bundle and action names', () => {
  assert.equal(INHERITED_PROVIDER_ID, 'SHOW_INHERITED')
  assert.equal(INHERITED_MEMBERS_LABEL, 'Inherited members')
  assert.equal(SUPERTYPES_GROUPER_ID, 'SHOW_INTERFACES')
  assert.equal(SUPERTYPES_GROUPER_LABEL, 'Members by Defining Type')
  assert.equal(PUBLIC_ELEMENTS_FILTER_ID, 'SHOW_NON_PUBLIC')
  assert.equal(FIELDS_FILTER_ID, 'SHOW_FIELDS')
})

test('the module stays free of vue and DOM imports', () => {
  const source = read('../src/outlineInheritedMembers.ts')
  assert.ok(!/from ['"]vue['"]/.test(source))
  assert.ok(!/document\.|window\./.test(source))
})
