// `ic/file-types` 的注册与事件面判据（`src/fileTypeRegistry.ts`）。
//
// 上游依据（逐条对齐）：
//   · `FileTypeAssocTable.findAssociatedFileType`（jps/model-impl，:159-175）的匹配优先级：
//     精确名（大小写敏感 → 忽略大小写）→ 通配模式（更具体的在前）→ 扩展名；
//   · `FileTypeConsumer.EXTENSION_DELIMITER = ";"` 的分号认领；
//   · `FileTypeEvent`/`FileTypeListener` 的 before/after 广播与 added/removed；
//   · `IgnoredPatternSet` 的分号掩码表（`getIgnoredFilesList`/`setIgnoredFilesList`/`isFileIgnored`）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { FileTypeManager, fileTypeManager, parseFileNameMatcher } from '../src/fileTypeRegistry.ts'
import { detectFileType, resolveEditorLanguage } from '../src/fileTypeDetection.ts'

const type = (id, name, language, matchers) => ({ id, name, language, matchers })

test('扩展名大小写不敏感；认不出回 null（调用方按 Unknown 兜底）', () => {
  const manager = new FileTypeManager([type('JAVA', 'Java', 'java', [{ kind: 'extension', extension: 'java' }])])
  assert.equal(manager.getFileTypeByExtension('JAVA').name, 'Java')
  assert.equal(manager.getFileTypeByFileName('A.Java').name, 'Java')
  assert.equal(manager.getFileTypeByExtension('nope'), null)
  assert.equal(manager.getFileTypeByFileName('Makefile'), null, '没注册的精确名不该被扩展名规则误认')
})

test('精确名优先于通配与扩展名；通配里更具体的模式在前', () => {
  const manager = new FileTypeManager([
    type('Gradle', 'Gradle', 'other', [{ kind: 'extension', extension: 'gradle' }]),
    type('GradleKts', 'Gradle Kotlin', 'other', [{ kind: 'exact', fileName: 'build.gradle', ignoreCase: true }]),
    type('TS', 'TypeScript', 'typescript', [{ kind: 'extension', extension: 'ts' }]),
    type('DTS', 'TypeScript Declaration', 'typescript', [{ kind: 'wildcard', pattern: '*.d.ts' }]),
  ])
  assert.equal(manager.getFileTypeByFileName('build.gradle').id, 'GradleKts', '精确名应压过扩展名')
  assert.equal(manager.getFileTypeByFileName('BUILD.GRADLE').id, 'GradleKts', '忽略大小写的精确名')
  assert.equal(manager.getFileTypeByFileName('a.ts').id, 'TS')
  assert.equal(manager.getFileTypeByFileName('a.d.ts').id, 'DTS', '通配模式应压过扩展名')
  assert.equal(manager.getFileTypeByFileName('.gitignore'), null)
})

test('consume 分号认领、associate/removeAssociation 与 getAssociations', () => {
  const manager = new FileTypeManager()
  manager.consume(type('Kt', 'Kotlin', 'other'), 'kt;kts')
  assert.deepEqual(manager.getFileTypeByFileName('a.kts').id, 'Kt')
  manager.associate('Kt', { kind: 'exact', fileName: 'kotlin.script' })
  assert.equal(manager.getFileTypeByFileName('kotlin.script').id, 'Kt')
  const associations = manager.getAssociations('Kt')
  assert.equal(associations.length, 3)
  manager.removeAssociation('Kt', { kind: 'extension', extension: 'kt' })
  assert.equal(manager.getFileTypeByFileName('a.kt'), null)
  assert.equal(manager.getFileTypeByFileName('a.kts').id, 'Kt', '摘一条不该误伤另一条')
  // 空词条跳过（`;;` 不注册空扩展名）。
  manager.consume(type('Empty', 'Empty', 'other'), ';;')
  assert.deepEqual(manager.getAssociations('Empty'), [])
})

test('变更事件：before 早于 after，且带 added/removed', () => {
  const manager = new FileTypeManager()
  const seen = []
  manager.addFileTypeListener({
    beforeFileTypesChanged: event => seen.push(['before', event.added?.id ?? null, event.removed?.id ?? null]),
    fileTypesChanged: event => seen.push(['after', event.added?.id ?? null, event.removed?.id ?? null]),
  })
  manager.register(type('A', 'A', 'other', [{ kind: 'extension', extension: 'a' }]))
  manager.unregister('A')
  assert.deepEqual(seen, [['before', 'A', null], ['after', 'A', null], ['before', null, 'A'], ['after', null, 'A']])
  // 歧义写法：注册同一 id 是移除再注册（上游兼容路径），事件里 after 事件带新类型。
  manager.register(type('B', 'B', 'other', []))
  manager.register(type('B', 'B2', 'other', []))
  assert.equal(manager.getType('B').name, 'B2')
})

test('注册表工厂（FileTypeFactory）与注册/注销的整表语义', () => {
  const manager = new FileTypeManager()
  manager.registerFactory(consumer => consumer.consume(type('Py', 'Python', 'other'), 'py;pyi'))
  assert.equal(manager.getFileTypeByFileName('x.pyi').id, 'Py')
  assert.equal(manager.getRegisteredTypes().length, 1)
  manager.unregister('Py')
  assert.deepEqual(manager.getRegisteredTypes(), [])
  assert.equal(manager.getFileTypeByFileName('x.py'), null, '注销要连带清掉它认领的关联')
})

test('忽略清单：分号掩码、去重、精确名/通配/扩展名三种掩码', () => {
  const manager = new FileTypeManager()
  manager.setIgnoredFilesList('*.pyc; *.class ;Thumbs.db;*.pyc;')
  assert.equal(manager.getIgnoredFilesList(), '*.pyc;*.class;Thumbs.db')
  assert.equal(manager.isFileIgnored('cache.pyc'), true)
  assert.equal(manager.isFileIgnored('App.class'), true)
  assert.equal(manager.isFileIgnored('Thumbs.db'), true)
  assert.equal(manager.isFileIgnored('main.py'), false)
  // 不带 `*.` 的掩码是精确名（上游 FileNameMatcherFactoryImpl：无 `*`/`?` → ExactFileNameMatcher）。
  manager.setIgnoredFilesList('log')
  assert.equal(manager.isFileIgnored('log'), true)
  assert.equal(manager.isFileIgnored('a.log'), false)
})

// 上游那道「遮蔽闸」：`IgnoredPatternSet.addIgnoreMask`
// （`platform/platform-impl/src/com/intellij/openapi/fileTypes/impl/copy1/IgnoredPatternSet.java:47-53`）
// 先拿**新词条自己当文件名**去问现有掩码表（`:49` 的 `findAssociatedFileType(ignoredFile) == null`），
// 只要已经被盖住，`:50-51` 两行都不执行 ⇒ 它连 `masks` 集合都进不去，
// 于是 `getIgnoreMasks()`（`:34-36`）与 `FileTypeManagerImpl.getState()` 存的那份（`:1434`）里都没有它。
test('忽略清单的遮蔽闸：已被现有掩码盖住的词条不进清单，也不是按字符串去重', () => {
  const manager = new FileTypeManager()
  manager.setIgnoredFilesList('*.pyc')
  assert.equal(manager.addIgnoreMask('build.pyc'), false, '`*.pyc` 已经盖住 `build.pyc`（扩展名匹配器 = endsWithIgnoreCase）')
  assert.equal(manager.getIgnoredFilesList(), '*.pyc', '被盖住的那条不留任何痕迹：不进清单 ⇒ 也不会被持久化')
  assert.equal(manager.addIgnoreMask('*.pyc'), false, '同一道闸顺带去重：`*.pyc` 自己就被 `*.pyc` 匹配到')
  assert.equal(manager.addIgnoreMask('*.class'), true, '没被盖住的照常收')
  assert.equal(manager.addIgnoreMask('   '), false, '空词条不收')
  // 证明判的是**掩码匹配**、不是字符串相等：把遮蔽者换掉后同一条就该收进来了
  // （上游 `unignoreMask` 重建整表也是这个意思，`FileTypeManagerImpl.java:1322-1329`）。
  manager.setIgnoredFilesList('*.class')
  assert.equal(manager.addIgnoreMask('build.pyc'), true, '遮蔽者不在了就要收 —— 反向验证上面那条 false 不是字符串去重')
  assert.equal(manager.getIgnoredFilesList(), '*.class;build.pyc')
})

// 上游 `FileTypeAssocTable.addAssociation` 末尾那条比较器（为一修 IJPL-149806）：
//   `jps/model-impl/src/com/intellij/openapi/fileTypes/impl/FileTypeAssocTable.java:113-120`
//   第一级 `comparing(presentableString().length(), reverseOrder())` = **长的在前**；
//   第二级 `.thenComparing(presentableString().replace("?" -> \uFFFE).replace("*" -> \uFFFF))` = **升序**，
//   而 \uFFFE < \uFFFF ⇒ 同长时带 `?` 的那条排在带 `*` 的前面。两级方向不同，本仓原来把它们
//   并成一个字符串键整体降序比 ⇒ 同长时 `*` 抢了 `?` 的位置（注释写对了、代码写反了）。
test('通配表排序：长度降序；同长时 `?` 先于 `*`，且与注册顺序无关', () => {
  const starFirst = new FileTypeManager([
    type('Star', 'Star', 'other', [{ kind: 'wildcard', pattern: '*at.ts' }]),
    type('Quest', 'Quest', 'other', [{ kind: 'wildcard', pattern: '?at.ts' }]),
  ])
  assert.equal(starFirst.getFileTypeByFileName('cat.ts').id, 'Quest', '两条都是 6 长 ⇒ 走第二级：`?` 在前')
  const questFirst = new FileTypeManager([
    type('Quest', 'Quest', 'other', [{ kind: 'wildcard', pattern: '?at.ts' }]),
    type('Star', 'Star', 'other', [{ kind: 'wildcard', pattern: '*at.ts' }]),
  ])
  assert.equal(questFirst.getFileTypeByFileName('cat.ts').id, 'Quest', '结论由排序键定，不该看注册顺序')
  const byLength = new FileTypeManager([
    type('Near', 'Near', 'other', [{ kind: 'wildcard', pattern: '*at.ts' }]),
    type('Far', 'Far', 'other', [{ kind: 'wildcard', pattern: '*cart.ts' }]),
  ])
  assert.equal(byLength.getFileTypeByFileName('cart.ts').id, 'Far', '第一级优先：8 长的比 6 长的具体')
})

test('parseFileNameMatcher：`*.foo` → 扩展名、普通词 → 精确名、带通配符（含 `*.d.ts`）→ 通配', () => {
  assert.deepEqual(parseFileNameMatcher('*.cpp'), { kind: 'extension', extension: 'cpp' })
  assert.deepEqual(parseFileNameMatcher('.gitignore'), { kind: 'exact', fileName: '.gitignore' })
  assert.deepEqual(parseFileNameMatcher('*Test.java'), { kind: 'wildcard', pattern: '*Test.java' })
  assert.deepEqual(parseFileNameMatcher('*.d.ts'), { kind: 'wildcard', pattern: '*.d.ts' }, '尾段带点的不算扩展名')
})

test('消费链：进程内单例注册后编辑器语言判定立刻生效，注销后复原', () => {
  const descriptor = type('TAOCODE_TEST_TYPE', 'TaoCode Test', 'typescript', [{ kind: 'extension', extension: 'taocodex' }])
  assert.equal(resolveEditorLanguage('a.taocodex', '', {}), undefined, '注册前按老路径（无词法层语言）')
  fileTypeManager.register(descriptor)
  try {
    assert.equal(resolveEditorLanguage('a.taocodex', '', {}), 'typescript', '注册后编辑器语言判定要走注册表')
    assert.equal(detectFileType('a.taocodex', '').type, 'TaoCode Test')
  } finally {
    fileTypeManager.unregister('TAOCODE_TEST_TYPE')
  }
  assert.equal(resolveEditorLanguage('a.taocodex', '', {}), undefined, '注销后复原')
})

test('接线：文件类型探测改走注册表（不是两套内置表）', () => {
  const detection = readFileSync('src/fileTypeDetection.ts', 'utf8')
  assert.ok(detection.includes("import { fileTypeManager } from './fileTypeRegistry.ts'"), '探测没有引入注册表')
  assert.ok(detection.includes('fileTypeManager.getFileTypeByFileName(fileName)'), '探测没有查注册表')
  assert.ok(!detection.includes('DEFAULT_EXTENSIONS'), '内置扩展名表还留在探测模块里（应只在注册表一份）')
})
