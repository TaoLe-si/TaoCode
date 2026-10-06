// 模块根模型的判据（`src/rootsModel.ts`，lp/roots ① / pm/roots ③ / an/module ① 的呈现层）。
//
// 上游依据（与源文件头同一批）：
//   · `platform/projectModel-api/src/com/intellij/openapi/roots/ModuleRootModel.java:51/:58/:84/:92/:100/:118/:130`
//   · 同目录 `ContentEntry.java:56/:63/:92/:122`、`SourceFolder.java:44/:52/:62`、
//     `OrderEntry.java:31/:52/:60`、`CompilerModuleExtension.java:29/:45/:76`。
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildContentEntry, buildOrderEntries, buildRootModel, contentEntryForFile, contentRootUrls,
         excludeFoldersFromFiles, excludeRootUrls, isTestSourceKind, ORDER_ENTRY_LABELS, orderEntryKindLabel, orderEntryText,
         rootModelRows, sourceRootUrls } from '../src/rootsModel.ts'
import { libraryFromJars } from '../src/libraryModel.ts'
import { createSdk, JAVA_SDK_TYPE } from '../src/rootsSdkTable.ts'

const FILES = ['src/main/java/A.java', 'src/main/java/p/B.java', 'src/test/java/T.java', 'build/x/y.class',
               'build/z.class', 'node_modules/pkg/i.js', 'out/production/app/A.class', 'README.md']

test('isTestSourceKind：测试性是源根自己的属性（SourceFolder.java:44）', () => {
  assert.equal(isTestSourceKind('tests'), true)
  assert.equal(isTestSourceKind('test-resources'), true)
  assert.equal(isTestSourceKind('sources'), false)
  assert.equal(isTestSourceKind('resources'), false)
  assert.equal(isTestSourceKind('generated'), false)
})

test('排除根按目录名在清单上求出实际命中的目录，只收最外层（ContentEntry.java:92）', () => {
  const folders = excludeFoldersFromFiles(FILES, ['build', 'node_modules', 'out'])
  assert.deepEqual(folders.map(item => [item.path, item.name, item.fileCount]), [
    ['build', 'build', 2],
    ['node_modules', 'node_modules', 1],
    ['out', 'out', 1],
  ], 'out/production/app 不各出一条 —— 外层排除整棵子树')
  assert.deepEqual(excludeFoldersFromFiles(FILES, []), [], '没配排除目录就不该凭空长出排除根')
  assert.deepEqual(excludeFoldersFromFiles(['a/build'], ['build']), [], '末段是文件本身，不是被排除的目录')
})

test('内容根对象图：源根带类型/测试性/文件数/磁盘核对（ContentEntry.java:63 + :122）', () => {
  const entry = buildContentEntry({ moduleName: 'app', sourcePaths: ['src/main/java', 'src/test/java', 'missing/root', 'build/gen'], files: FILES, excludedDirs: ['build'] }, '')
  assert.equal(entry.url, '')
  assert.deepEqual(entry.sources.map(item => [item.path, item.kind, item.test, item.fileCount, item.missing, item.excludedBy]), [
    ['src/main/java', 'sources', false, 2, false, null],
    ['src/test/java', 'tests', true, 1, false, null],
    ['missing/root', 'sources', false, 0, true, null],
    ['build/gen', 'sources', false, 0, true, 'build'],
  ])
  assert.deepEqual(entry.sources.every(item => item.packagePrefix === ''), true,
    '包前缀没有存储字段 ⇒ 空串，不编（SourceFolder.java:52）')
  assert.deepEqual(entry.excludes.map(item => item.path), ['build'], '这条内容根只按「build」这一个名字排除')
})

test('序根条目：SDK → 库 → 模块输出；没有模块依赖就不出那一条（ModuleRootModel.java:58）', () => {
  const entries = buildOrderEntries({
    moduleName: 'app',
    sdk: createSdk('21', JAVA_SDK_TYPE, '/jdk21', '21'),
    libraries: [libraryFromJars(['lib/a.jar', 'lib/a-sources.jar'])],
    outputPath: 'out/production/app',
    files: FILES,
  })
  assert.deepEqual(entries.map(item => [item.kind, item.presentableName, item.valid]), [
    ['jdk', '21', true],
    ['library', 'a.jar', true],
    ['output', 'out/production/app', true],
  ], '未命名库的名字 = 第一个 CLASSES 根的文件名（LibraryBridgeImpl.kt:235-247）')
  assert.deepEqual(entries[0].roots.classes, ['/jdk21'])
  assert.deepEqual(entries[0].roots.sources, ['/jdk21/lib/src.zip'])
  assert.deepEqual(entries[1].roots.classes, ['lib/a.jar'])
  assert.deepEqual(entries[1].roots.sources, ['lib/a-sources.jar'])
  assert.deepEqual(entries[2].roots.classes, ['out/production/app'])
  assert.equal(entries.every(entry => entry.kind !== 'module'), true, '本仓没有模块间依赖的存储面 ⇒ 不放假条目')
})

// roots3 补的第二条：`ModuleSourceOrderEntry`（模块自己那条源根条目）。判据在改前是红的
// （`buildOrderEntries` 根本没这一支；面板树行里 SDK 之前什么都没有）。
test('模块自己的源根条目：只贡献 SOURCES、恒有效、一个根都没配就不出这一行', () => {
  const entries = buildOrderEntries({
    moduleName: 'app', sourcePaths: ['src/main/java', 'src\\test\\java', 'src/main/java'],
    files: ['src/test/java/T.java'],
  })
  assert.deepEqual(entries.map(item => [item.kind, item.presentableName, item.valid]), [['moduleSource', '<模块源码>', true]],
    'presentableName = ProjectModelBundle.properties:40 的 `<Module source>` 直译（OrderEntriesBridge.kt:367）')
  assert.deepEqual(entries[0].roots.sources, ['src/main/java', 'src/test/java'], '去重、反斜杠归一、保持配置顺序')
  assert.deepEqual([entries[0].roots.classes, entries[0].roots.javadoc, entries[0].roots.annotations], [[], [], []],
    'getFiles(type) 只在 SOURCES 下给根，其余类型空数组（OrderEntriesBridge.kt:365）')
  assert.equal(entries[0].valid, true,
    'src/main/java 不在磁盘清单上也不翻这条（OrderEntry.java:56「条目有效不等于每个根都有效」）')
  assert.equal(orderEntryText(entries[0]), '模块源码')
  assert.equal(buildOrderEntries({ moduleName: 'app', sourcePaths: ['  ', ''] }).length, 0, '没配源根 ⇒ 不出永远为空的行')
  const withSdk = buildOrderEntries({ moduleName: 'app', sourcePaths: ['src'], sdk: createSdk('21', JAVA_SDK_TYPE, '/jdk21', '21') })
  assert.deepEqual(withSdk.map(item => item.kind), ['moduleSource', 'jdk'], '模块自己的条目排在 SDK 之前（OrderRootComputer.java:58-63）')
})

test('序根条目的有效性口径：空库无效、未构建的输出目录不报无效（OrderEntry.java:60）', () => {
  const entries = buildOrderEntries({
    moduleName: 'app',
    libraries: [{ name: 'empty', roots: [] }],
    outputPath: 'out/production/app',
    files: ['src/main/java/A.java'],
  })
  assert.deepEqual(entries.map(item => [item.kind, item.valid]), [['library', false], ['output', true]])
  assert.equal(orderEntryText(entries[0]), '库（无效）')
  assert.equal(orderEntryText(entries[1]), '输出')
  assert.equal(orderEntryKindLabel('jdk', false), 'SDK（无效）', '树行只有 kind + valid，标签函数得能单独用')
  assert.equal(orderEntryKindLabel('testOutput', true), '测试输出')
  const diskUnknown = buildOrderEntries({ moduleName: 'app', outputPath: 'out' })
  assert.equal(diskUnknown[0].valid, true, '磁盘清单还没到时不把没构建的输出说成无效')
  assert.equal(buildOrderEntries({ moduleName: 'app' }).length, 0, '什么都没配就没有条目')
})

test('测试输出没有存储字段 ⇒ 不猜路径（CompilerModuleExtension.java:29/:45）', () => {
  const without = buildOrderEntries({ moduleName: 'app', outputPath: 'out/production/app' })
  assert.deepEqual(without.map(item => item.kind), ['output'], '只有生产输出那一条')
  const withTest = buildOrderEntries({ moduleName: 'app', outputPath: 'out/production/app', compilerTestOutput: 'out/test/app' })
  assert.deepEqual(withTest.map(item => [item.kind, item.presentableName]), [['output', 'out/production/app'], ['testOutput', 'out/test/app']])
})

test('模型查询面：contentRootUrls / sourceRootUrls(includingTests) / excludeRootUrls（:84/:92/:100/:118/:130）', () => {
  const model = buildRootModel({
    moduleName: 'app', contentRoots: ['plugins/ext'], sourcePaths: ['src/main/java', 'src/test/java', 'plugins/ext/src'],
    excludedDirs: ['build', 'node_modules', 'out'], files: [...FILES, 'plugins/ext/src/E.java'],
  })
  assert.deepEqual(contentRootUrls(model), ['', 'plugins/ext'], '本仓存储只有工作区根这一个内容根，但对象图按复数建')
  assert.deepEqual(sourceRootUrls(model), ['src/main/java', 'plugins/ext/src'], '默认不含测试根')
  assert.deepEqual(sourceRootUrls(model, true), ['src/main/java', 'src/test/java', 'plugins/ext/src'])
  assert.deepEqual(model.contentEntries.map(entry => entry.sources.map(item => item.path)), [
    ['src/main/java', 'src/test/java'], ['plugins/ext/src'],
  ], '每条源根只归属**最长匹配**的那条内容根（ContentEntry 各管自己根下的东西）')
  assert.deepEqual(excludeRootUrls(model), ['build', 'node_modules', 'out'])
  assert.equal(model.moduleName, 'app')
  assert.equal(model.contentEntries.length, 2)
})

test('内容根归属：最长前缀命中，工作区根兜底（getModule/ContentEntry 的按文件寻址）', () => {
  const model = buildRootModel({ moduleName: 'app', contentRoots: ['plugins/ext'], sourcePaths: [], files: FILES })
  assert.equal(contentEntryForFile(model, 'plugins/ext/src/E.java')?.url, 'plugins/ext')
  assert.equal(contentEntryForFile(model, 'src/main/java/A.java')?.url, '')
  assert.equal(contentEntryForFile(model, 'README.md')?.url, '')
})

test('面板树行：内容根 → 按类型分组 → 组内逐根 → 排除根 → 序根条目（ContentEntryTreeEditor 的等价物）', () => {
  const model = buildRootModel({
    moduleName: 'app', sourcePaths: ['src/main/java', 'src/test/java'], excludedDirs: ['build', 'node_modules', 'out'],
    libraries: [libraryFromJars(['lib/a.jar'])], sdk: createSdk('21', JAVA_SDK_TYPE, '/jdk21', '21'), files: FILES,
  })
  const rows = rootModelRows(model, true)
  assert.deepEqual(rows.map(row => [row.depth, row.text]), [
    [0, '内容根 app'],
    [1, '源代码根（1）'],
    [2, 'src/main/java'],
    [1, '测试根（1）'],
    [2, 'src/test/java'],
    [1, '排除根（3）'],
    [2, 'build'],
    [2, 'node_modules'],
    [2, 'out'],
    [0, '模块「app」的序根条目'],
    [1, '<模块源码>'],
    [1, '21'],
    [1, 'a.jar'],
  ])
  assert.equal(rows[2].count, 2, '源根行带文件数（SidePanelCountLabel）')
  assert.equal(rows[2].kind, 'sources')
  assert.equal(rows[4].kind, 'tests')
  assert.equal(rows[6].comment, '按目录名「build」排除')
  assert.equal(rows[10].orderEntryKind, 'moduleSource', '模块自己那条源根条目排在序根组的第一行（OrderEntriesBridge.kt:363-367）')
  assert.equal(rows[10].count, 2, '源根条目只贡献 SOURCES 那两条（:365 其余类型返空数组）')
  assert.equal(rows[11].orderEntryKind, 'jdk')
  assert.equal(rows[11].count, 2, 'SDK 条目贡献 classes + sources 两个根')
  const unknown = rootModelRows(model, false)
  assert.equal(unknown[0].count, null, '清单没到时不编数字')
  assert.equal(unknown[2].count, null)
  const empty = rootModelRows(buildRootModel({ moduleName: 'x', sourcePaths: [], files: [] }), true)
  assert.deepEqual(empty.map(row => row.text), ['内容根 x', '没有源码目录'])
})

test('多个源根同名分类时按配置顺序排在同一组里，条目 key 唯一（渲染的 v-for key）', () => {
  const model = buildRootModel({ moduleName: 'app', sourcePaths: ['src/main/java', 'src/main/resources', 'src/test/java', 'target/generated-sources/annotations'], files: ['src/main/java/A.java', 'src/test/java/T.java'] })
  const keys = rootModelRows(model, true).map(row => row.key)
  assert.equal(new Set(keys).size, keys.length, 'key 不重复')
  assert.deepEqual(model.contentEntries[0].sources.map(item => [item.kind, item.path]), [
    ['sources', 'src/main/java'], ['resources', 'src/main/resources'], ['tests', 'src/test/java'], ['generated', 'target/generated-sources/annotations'],
  ], '源根列表保持配置顺序（分组才按标签表顺序）')
  assert.deepEqual(ORDER_ENTRY_LABELS, {
    moduleSource: '模块源码', jdk: 'SDK', library: '库', module: '模块依赖', output: '输出', testOutput: '测试输出',
  }, '标签表按 `RootOrderEntryKind` 全覆盖（roots3 加了 moduleSource）')
})
