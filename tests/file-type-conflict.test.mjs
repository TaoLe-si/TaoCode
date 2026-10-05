// `ic/file-types` / `pf/file-types` 的关联冲突判定与声明式注册（`src/fileTypeRegistry.ts`）。
//
// 上游依据（逐条对齐）：
//   · `ConflictingFileTypeMappingTracker.resolveConflict`
//     （`platform/platform-impl/src/com/intellij/openapi/fileTypes/impl/ConflictingFileTypeMappingTracker.java:73-120`）
//     的五条判定与顺序：:78-83 bundled/core 换位、:93-98 非 bundled 覆盖、:99-103 NativeFileType
//     总被覆盖、:107-114 JetBrains 厂商对第三方、:117-119 平局保留旧方且需审批；
//   · `ResolveConflictResult`（:67-71）带 resolved / notification / explanation / approved；
//   · `FileTypeBean` 的 `@Attribute`（`…/impl/FileTypeBean.java:72/:84/:93/:101/:108/:116/:123/:132/:144`）
//     与类注释里的两种用法（:26-43：带 implementationClass = 新类型；只给 name + 关联 = 给别的类型加关联）。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FileTypeManager, NATIVE_FILE_TYPE_ID, mockFileType, nativeFileType, parseFileTypeBean, presentableMatcher,
  resolveFileTypeConflict, STANDARD_FILE_TYPES, templateLanguageFileType, userBinaryFileType, userFileType,
} from '../src/fileTypeRegistry.ts'

// 本文件是 `.mjs`，Node 的类型擦除不作用于 `.mjs`（只作用于 `.ts`），所以具名导入里
// 不能写 `type FileTypeDescriptor`（那会让整个文件解析失败）。改用 JSDoc typedef 取同一份类型。
/** @typedef {import('../src/fileTypeRegistry.ts').FileTypeDescriptor} FileTypeDescriptor */

const owned = (id, extra = {}) =>
  ({ id, name: id, language: 'other', matchers: [{ kind: 'extension', extension: id.toLowerCase() }], ...extra })
const ext = extension => ({ kind: 'extension', extension })

test('非 bundled 的新类型覆盖 bundled 的旧类型（:93-98，approved = 旧方是否 bundled）', () => {
  const matcher = ext('java')
  const core = { ...owned('JAVA'), bundled: true, core: true, vendor: 'JetBrains' }
  const thirdParty = owned('MyJava')
  const result = resolveFileTypeConflict(matcher, core, thirdParty)
  assert.equal(result.resolved, 'MyJava')
  assert.equal(result.overridden, 'JAVA')
  assert.equal(result.approved, true)
  assert.equal(result.message, '文件模式 *.java 已改判给「MyJava」。')
  assert.equal(presentableMatcher(matcher), '*.java')
  assert.equal(presentableMatcher({ kind: 'exact', fileName: 'Makefile' }), 'Makefile')
})

test('覆盖 NativeFileType 总获批准（:99-103，old == NativeFileType.INSTANCE）', () => {
  const native = nativeFileType()
  const claim = { ...owned('Img'), bundled: true, core: true, vendor: 'JetBrains' }
  const result = resolveFileTypeConflict(ext('png'), native, claim)
  assert.equal(result.resolved, 'Img')
  assert.equal(result.overridden, NATIVE_FILE_TYPE_ID)
  assert.equal(result.approved, true)
})

test('两边都是 bundled：JetBrains 厂商的一方让给更具体的第三方（:107-114）', () => {
  const jb = { ...owned('Image'), bundled: true, core: true, vendor: 'JetBrains' }
  const adobe = { ...owned('Psd'), bundled: true, core: true, vendor: 'Adobe' }
  // 旧的 JetBrains 类型 vs 新的 Adobe 类型 → Adobe 赢（上游注释里的 Image / Photoshop 那个例子）。
  assert.equal(resolveFileTypeConflict(ext('psd'), jb, adobe).resolved, 'Psd')
  // 反过来：新的 JetBrains 类型对旧的第三方 → 第三方赢（`adobe` 是变量名，它的 id 是 `Psd`）。
  assert.equal(resolveFileTypeConflict(ext('psd'), adobe, jb).resolved, 'Psd')
})

test('两个 bundled/core 且同厂商 → 平局保留旧方，approved = false（:117-119）', () => {
  const a = { ...owned('A'), bundled: true, core: true, vendor: 'JetBrains' }
  const b = { ...owned('B'), bundled: true, core: true, vendor: 'JetBrains' }
  const result = resolveFileTypeConflict(ext('a'), a, b)
  assert.equal(result.resolved, 'A')
  assert.equal(result.overridden, 'B')
  assert.equal(result.approved, false, '平局要用户点头（上游 ApproveRemovedMappingsActivity 的位置）')
})

test('associate 遇冲突：落败者拿不到关联，胜者照旧，冲突进 getConflicts() 与变更事件', () => {
  const manager = new FileTypeManager([{ ...owned('A'), matchers: [ext('x')] }])
  const conflicts = manager.associate('A', ext('x'))
  assert.equal(conflicts, null, '同 id 重认领自己的关联不算冲突')
  manager.register(owned('B'))
  const seen = []
  manager.addFileTypeListener({ fileTypesChanged: event => seen.push(event.conflicts ?? []) })
  const conflict = manager.associate('B', ext('x'), true)
  assert.equal(conflict.resolved, 'B')
  assert.equal(manager.getFileTypeByExtension('x').id, 'B', '胜者拿到关联')
  assert.equal(manager.getConflicts().length, 1)
  assert.deepEqual(seen, [[conflict]])

  // 反向：再来一个第三方要抢 .x，同样非 bundled → 新的这个赢，上一个让位。
  manager.register(owned('C'))
  const second = manager.associate('C', ext('x'))
  assert.equal(second.resolved, 'C')
  assert.equal(manager.getFileTypeByExtension('x').id, 'C')
})

test('register 一次带多条匹配器时，冲突挂在 after 事件的 conflicts 上', () => {
  const manager = new FileTypeManager([{ ...owned('A'), matchers: [ext('a')] }])
  const seen = []
  manager.addFileTypeListener({ fileTypesChanged: event => seen.push(event.conflicts ?? []) })
  manager.register(owned('B', { matchers: [ext('a'), ext('b')] }))
  assert.equal(seen.length, 1)
  assert.equal(seen[0].length, 1, '只有 .a 撞上了')
  assert.equal(seen[0][0].resolved, 'B')
  assert.equal(manager.getFileTypeByExtension('a').id, 'B')
  assert.equal(manager.getFileTypeByExtension('b').id, 'B')
})

test('registerBean：两种用法合流（FileTypeBean 的 :26-43）', () => {
  const manager = new FileTypeManager([{ ...owned('XML'), matchers: [ext('xml')] }])
  // 只给 name + 关联 = 给**别的**类型加关联（:36-41：目标类型必须已由别的标签注册）。
  manager.registerBean({ name: 'XML', extensions: 'myxml' })
  assert.equal(manager.getFileTypeByExtension('myxml').id, 'XML')
  assert.equal(manager.getFileTypeByExtension('xml').id, 'XML', '原有关联保留')
  // 目标不在表里 + 没给 implementationClass → 按用户类型（UserFileType 那一档）建新的。
  manager.registerBean({ name: 'Conf', extensions: 'conf' })
  assert.equal(manager.getFileTypeByExtension('conf').id, 'Conf')
  assert.equal(manager.getType('Conf').bundled, false)
  // 带了 hashBangs 的声明 → 标成模板语言（上游 hashBangs 属性只对内容有意义，:46-48/:144）。
  manager.registerBean({ name: 'Run', extensions: 'run', hashBangs: 'python3;bash' })
  assert.equal(manager.getType('Run').template, true)
})

test('parseFileTypeBean：分号属性 → 匹配器，hashBangs 另出，缺 name 抛错', () => {
  const parsed = parseFileTypeBean({
    name: 'Python', language: 'python', extensions: 'py;pyw', fileNames: 'SConstruct',
    patterns: '*.d.ts', fileNamesCaseInsensitive: 'BUILD.GRADLE', hashBangs: 'python',
    implementationClass: 'com.jetbrains.python.PythonFileType', fieldName: 'INSTANCE',
  })
  assert.deepEqual(parsed.descriptor.matchers, [
    { kind: 'extension', extension: 'py' }, { kind: 'extension', extension: 'pyw' },
    { kind: 'exact', fileName: 'SConstruct' },
    { kind: 'wildcard', pattern: '*.d.ts' },
    { kind: 'exact', fileName: 'BUILD.GRADLE', ignoreCase: true },
  ])
  assert.deepEqual(parsed.hashBangs, ['python'])
  assert.equal(parsed.descriptor.language, 'python')
  assert.throws(() => parseFileTypeBean({ extensions: 'x' }), /name/)
  assert.throws(() => parseFileTypeBean({ name: '  ' }), /name/)
})

test('五个具名类型工厂（上游那五个类在本仓的等价物）', () => {
  const native = nativeFileType()
  assert.deepEqual([native.id, native.name, native.binary, native.matchers.length, native.core],
    ['NATIVE', 'Native', true, 0, true])
  const mock = mockFileType()
  assert.equal(mock.name, 'Mock', 'MockLanguageFileType.getName() 返回 Mock（:17-19）')
  assert.equal(mock.matchers[0].extension, "mockExtensionThatProbablyWon'tEverExist", '默认扩展名（:28-30）')
  assert.equal(userBinaryFileType('Bin', 'Bin').binary, true, 'UserBinaryFileType.isBinary() 恒 true（:17-19）')
  assert.equal(userFileType('Mine', 'Mine', 'other', [ext('mine')]).bundled, false, '用户类型不是 bundled')
  assert.equal(templateLanguageFileType('T', 'T', 'other').template, true, 'TemplateLanguageFileType 是标记接口（:4）')
})

test('标准表把 Native 收进去了，且全表标成 bundled+core（冲突规则的参照系）', () => {
  assert.ok(STANDARD_FILE_TYPES.some(type => type.id === NATIVE_FILE_TYPE_ID))
  for (const type of STANDARD_FILE_TYPES) {
    assert.equal(type.bundled, true, `${type.id} 没标 bundled`)
    assert.equal(type.core, true, `${type.id} 没标 core`)
  }
})
