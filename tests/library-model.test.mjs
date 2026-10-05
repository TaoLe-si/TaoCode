// 库实体与库表的判据（`src/libraryModel.ts`，lp/roots ② 与 pm/roots ② 的本体）。
//
// 上游依据（与源文件头同源，行号可复现）：
//   · `platform/projectModel-api/src/com/intellij/openapi/roots/libraries/Library.java:39-48`
//     名字可空 / `getPresentableName()` / `getUrls(rootType)`；
//   · `platform/projectModel-impl/src/com/intellij/workspaceModel/ide/impl/legacyBridge/library/LibraryBridgeImpl.kt:235-247`
//     未命名库显示第一个 CLASSES url 的文件名；disposed / 无根各有文案；
//   · `.../library/LibraryStateSnapshot.kt:72-109` 根**按 OrderRootType 分组**存放；
//   · `platform/lang-impl/src/com/intellij/openapi/roots/libraries/LibraryRootType.java:7-23`
//     根类型 = (OrderRootType, jarDirectory) 二元组；
//   · `platform/lang-impl/src/com/intellij/ide/projectView/impl/nodes/ExternalLibrariesNode.java:101-104`
//     未命名库被摊平（渲染层的取舍，见 src/externalLibraries.ts）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { libraryFromJars, libraryHasSameContent, libraryPresentableName, libraryRootSets, libraryRootType, libraryRootTypeKey,
         libraryUrls, libraryUrlsByType, libraryUrlsOfType, LibraryModifiableModel, LibraryTable,
         sameLibraryRootType, sourcesJarOf } from '../src/libraryModel.ts'

const named = (name, roots) => ({ name, roots })
const root = (path, type = 'classes', jarDirectory = false) => ({ path, type: libraryRootType(type, jarDirectory) })

test('库根类型是 (根类型, jarDirectory) 二元组（LibraryRootType.java:7-23）', () => {
  assert.deepEqual(libraryRootType('sources'), { type: 'sources', jarDirectory: false })
  assert.equal(sameLibraryRootType(libraryRootType('classes'), libraryRootType('classes')), true)
  assert.equal(sameLibraryRootType(libraryRootType('classes', true), libraryRootType('classes', false)), false,
    'jarDirectory 不同就不是同一个根类型')
  assert.equal(libraryRootTypeKey(libraryRootType('classes', true)), 'classes(jar directory)')
  assert.equal(libraryRootTypeKey(libraryRootType('classes')), 'classes')
})

test('getUrls(rootType) 只取该类型并保持存放顺序（Library.java:48）', () => {
  const library = named('guava', [root('lib/guava.jar'), root('lib/guava-sources.jar', 'sources'), root('lib/other.jar')])
  assert.deepEqual(libraryUrls(library, 'classes'), ['lib/guava.jar', 'lib/other.jar'])
  assert.deepEqual(libraryUrls(library, 'javadoc'), [])
  assert.deepEqual(libraryUrlsOfType(library, libraryRootType('classes', true)), [],
    '普通根不等于 jarDirectory 根')
  const byType = libraryUrlsByType(library)
  assert.deepEqual([byType.classes, byType.sources, byType.javadoc, byType.annotations],
    [['lib/guava.jar', 'lib/other.jar'], ['lib/guava-sources.jar'], [], []])
})

test('presentableName 的四级取值（LibraryBridgeImpl.kt:235-247）', () => {
  assert.equal(libraryPresentableName(named('guava', [])), 'guava', '有名字就用名字')
  assert.equal(libraryPresentableName({ name: null, roots: [], disposed: true }), '已释放的库')
  assert.equal(libraryPresentableName({ name: null, roots: [root('lib/guava-33.jar'), root('a/b.jar')] }), 'guava-33.jar',
    '未命名库取**第一个** CLASSES 根的文件名')
  assert.equal(libraryPresentableName({ name: null, roots: [root('lib/x-sources.jar', 'sources')] }), '空库',
    '没有 CLASSES 根 = 空库（源码根不算名字）')
})

test('hasSameContent：同一对象直接真，否则逐条比 name / 根路径 / 根类型（LibraryBridgeImpl.kt:148-158）', () => {
  const left = named('a', [root('x.jar'), root('y.jar', 'sources')])
  assert.equal(libraryHasSameContent(left, left), true)
  assert.equal(libraryHasSameContent(left, named('a', [root('x.jar'), root('y.jar', 'sources')])), true)
  assert.equal(libraryHasSameContent(left, named('b', left.roots)), false, '名字不同')
  assert.equal(libraryHasSameContent(left, named('a', [root('x.jar', 'classes', true), root('y.jar', 'sources')])), false,
    'jarDirectory 标记不同算不同内容')
  assert.equal(libraryHasSameContent(left, named('a', [root('y.jar', 'sources'), root('x.jar')])), false,
    '根的存放顺序也是内容的一部分（上游按列表逐项比）')
  assert.equal(libraryHasSameContent(left, named('a', [root('x.jar')])), false, '条数不同')
})

test('ModifiableModel：addRoot 去重、空白路径不收、removeRoot 只删第一处（Library.java:83-99）', () => {
  const model = new LibraryModifiableModel(named('a', [root('dup.jar')]))
  model.addRoot('dup.jar', 'classes')
  assert.deepEqual(model.getUrls('classes'), ['dup.jar'], '同 (path, type) 只留第一次')
  model.addRoot('dup.jar', 'sources')
  assert.deepEqual(model.getUrls('sources'), ['dup.jar'], '同路径不同类型是两条根')
  model.addRoot('   ', 'classes')
  assert.equal(model.getUrls('classes').length, 1, '空白路径不收')
  model.addRoot(' dup.jar ', 'classes')
  assert.equal(model.getUrls('classes').length, 1, 'trim 后重复同样不收')
  assert.equal(model.removeRoot('dup.jar', 'classes'), true)
  assert.equal(model.removeRoot('dup.jar', 'classes'), false)
  assert.deepEqual(model.getUrls('classes'), [])
})

test('ModifiableModel：addJarDirectory 带标记（Library.java:85-93）', () => {
  const model = new LibraryModifiableModel(named('a', []))
  model.addJarDirectory('lib', true, 'classes')
  assert.deepEqual(libraryUrlsOfType(model.commit(), libraryRootType('classes', true)), ['lib'])
  assert.deepEqual(model.getUrls('classes'), ['lib'])
})

test('ModifiableModel：moveRootUp/Down 只在同类型内交换，越界原样不动（Library.java:95-97）', () => {
  const model = new LibraryModifiableModel(named('a', [root('1.jar'), root('s.jar', 'sources'), root('2.jar'), root('3.jar')]))
  assert.equal(model.moveRootUp('1.jar', 'classes'), false, '已经在首位')
  assert.equal(model.moveRootDown('3.jar', 'classes'), false, '已经在末位')
  assert.equal(model.moveRootUp('3.jar', 'classes'), true)
  assert.deepEqual(model.getUrls('classes'), ['1.jar', '3.jar', '2.jar'])
  assert.equal(model.moveRootDown('1.jar', 'classes'), true)
  assert.deepEqual(model.getUrls('classes'), ['3.jar', '1.jar', '2.jar'])
  assert.deepEqual(model.getUrls('sources'), ['s.jar'], '别的类型不受影响')
})

test('ModifiableModel：isChanged 与拿到模型时比、commit 之后恒假（Library.java:101-105）', () => {
  const original = named('a', [root('1.jar')])
  const model = new LibraryModifiableModel(original)
  assert.equal(model.isChanged(), false)
  model.setName('b')
  assert.equal(model.isChanged(), true)
  model.setName('a')
  assert.equal(model.isChanged(), false, '改回原值就不算改动')
  model.addRoot('2.jar', 'classes')
  assert.equal(model.isChanged(), true)
  const committed = model.commit()
  assert.equal(model.isChanged(), false, 'commit 之后恒假')
  assert.deepEqual(committed.roots.map(item => item.path), ['1.jar', '2.jar'])
  assert.equal(original.roots.length, 1, 'commit 不动原对象')
})

test('库表：按名寻址、同名替换、三件监听回调（Library.java:58 + ProjectJdkTable 同形）', () => {
  const table = new LibraryTable()
  const events = []
  table.addListener(event => events.push([event.type, event.library.name]))
  assert.equal(table.findLibrary('nope'), null)
  assert.throws(() => table.addLibrary(named(null, [root('a.jar')])), /未命名库/, '未命名库不进表（渲染层摊平）')
  table.addLibrary(named('guava', [root('g.jar')]))
  table.addLibrary(named('guava', [root('g2.jar')]))
  assert.equal(table.getAllLibraries().length, 1, '同名是替换不是并存')
  assert.deepEqual(libraryUrls(table.findLibrary('guava'), 'classes'), ['g2.jar'])
  const model = table.createModifiableModel('guava')
  model.setName('guava33')
  model.addRoot('g2-sources.jar', 'sources')
  assert.equal(table.commitLibrary(model) !== null, true)
  assert.equal(table.findLibrary('guava'), null, '改名后旧名查不到')
  assert.deepEqual(libraryUrls(table.findLibrary('guava33'), 'sources'), ['g2-sources.jar'])
  assert.equal(table.removeLibrary('guava33'), true)
  assert.equal(table.removeLibrary('guava33'), false)
  assert.deepEqual(events.map(item => item[0]), ['added', 'added', 'changed', 'removed'], '同名替换也算一次 addJdk 式的 added')
  assert.equal(table.createModifiableModel('missing'), null)
  assert.deepEqual(table.getAllLibraries(), [])
})

test('库表：commit 未命名模型靠 fallbackName 落表；clear 与监听退订', () => {
  const table = new LibraryTable()
  const seen = []
  const listener = event => seen.push(event.type)
  table.addListener(listener)
  const model = new LibraryModifiableModel(named(null, [root('a.jar')]))
  assert.equal(table.commitLibrary(model), null, '既没名字也没兜底名 ⇒ 不落表')
  assert.equal(table.commitLibrary(model, 'anon') !== null, true)
  assert.deepEqual(libraryUrls(table.findLibrary('anon'), 'classes'), ['a.jar'])
  table.removeListener(listener)
  table.clear()
  assert.equal(table.getAllLibraries().length, 0)
  assert.deepEqual(seen, ['changed'], '退订之后不再有事件')
})

test('libraryFromJars：classes/sources 配对，源码 jar 不占 CLASSES 根', () => {
  const library = libraryFromJars(['lib/a.jar', 'lib/a-sources.jar', 'lib/b.jar'])
  assert.equal(library.name, null, 'glob 命中只建**未命名库**（本仓没有逐条附加的库名）')
  assert.deepEqual(library.roots.map(item => [item.path, item.type.type]), [
    ['lib/a-sources.jar', 'sources'],
    ['lib/a.jar', 'classes'],
    ['lib/b.jar', 'classes'],
  ])
  assert.equal(libraryFromJars([]), null, '一个 jar 都没命中就不建库')
  assert.equal(libraryFromJars(['lib/a-sources.jar']).roots.length, 1, '只有源码 jar 时也只有 SOURCES 根')
})

test('sourcesJarOf：只有本身就是 *-sources.jar 才认（不凭空造源码附件）', () => {
  assert.equal(sourcesJarOf('lib/a-sources.jar'), 'lib/a-sources.jar')
  assert.equal(sourcesJarOf('lib/A-SOURCES.JAR'), 'lib/A-SOURCES.JAR', '大小写不敏感')
  assert.equal(sourcesJarOf('lib/a.jar'), null, ' classes jar 不能推断出不存在的源码 jar')
})

test('libraryRootSets：喂给序根枚举的形状（src/orderRoots.ts 的输入）', () => {
  const sets = libraryRootSets([named('a', [root('a.jar'), root('a-src.jar', 'sources')]), named('b', [root('b.jar', 'javadoc')])])
  assert.deepEqual(sets, [{ classes: ['a.jar'], sources: ['a-src.jar'] }, { javadoc: ['b.jar'] }],
    '空类型不出现（不写空数组，避免下游把它当「配了但为空」）')
})
