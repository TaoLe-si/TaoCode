// 链接进来的构建工程 → 内容根 / 排除根的判据（`src/buildContentRoots.ts` + `src/rootsModel.ts` 的接线）。
//
// 上游依据（与两个源文件头同一批，本轮逐条打开数过）：
//   · `plugins/maven/src/main/java/org/jetbrains/idea/maven/importing/MavenRootModelAdapterLegacyImpl.java:100-103`
//     （内容根 = pom 所在目录，已有外层根时不再加）与 `:106-109`（`isEqualOrAncestor` 的祖先规则）、`:96`（`setExcludeOutput(true)`）
//   · `plugins/maven-server-api/src/main/java/org/jetbrains/idea/maven/model/MavenConstants.java:21`（`POM_XML = "pom.xml"`）
//   · `plugins/gradle/src/org/jetbrains/plugins/gradle/service/project/CommonGradleProjectResolverExtension.java:310`
//     （`gradleModule.getContentRoots()`）、`:330-334`（`getExcludeDirectories()` → `storePath(EXCLUDED, …)`）、
//     `:396-408`（build 目录 `storePath(EXCLUDED, buildDirPath)`）
//   · `platform/workspace/jps/src/com/intellij/platform/workspace/jps/bridge/impl/JpsJavaModuleExtensionBridge.kt:43`
//     （`isExcludeOutput()` 的上游默认值 = true）
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildContentRoots, isAncestorPath, isInModuleContent, excludedBy, mavenProjectDirs, mergeContentRoots,
  outputExcludeRoots, MAVEN_POM_FILE,
} from '../src/buildContentRoots.ts'
import { buildContentEntry, buildRootModel, rootModelRows } from '../src/rootsModel.ts'

const AE2 = ['Build/build.gradle', 'Build/settings.gradle', 'README.md', 'docs/note.md', 'Build/core/src/main/java/A.java']

test('mavenProjectDirs：只认真实的 pom.xml（MavenConstants.java:21），根 pom 算工作区根', () => {
  assert.deepEqual(mavenProjectDirs(['pom.xml', 'core/pom.xml', 'other/pom.scala', 'README.md']), ['', 'core'])
  assert.equal(MAVEN_POM_FILE, 'pom.xml')
  // 清单里没有 pom ⇒ 一条都不出（不猜「这大概是 Maven 工程」）
  assert.deepEqual(mavenProjectDirs(AE2), [])
})

test('mergeContentRoots：去重 + 祖先规则（外层盖住内层就不再挂内层那条）', () => {
  assert.deepEqual(mergeContentRoots(['Build', 'Build/sub', 'Build']), ['Build'])
  assert.deepEqual(mergeContentRoots(['a/b', 'a']), ['a/b', 'a'])   // 先来者赢：内层先到时外层仍会加（上游同口径）
  assert.deepEqual(mergeContentRoots(['', 'Build']), [''])          // 工作区根是所有路径的祖先
  assert.deepEqual(mergeContentRoots(['../x', '/abs/x', 'ok']), ['ok'])  // 绝对路径与 `..` 不当根
  assert.deepEqual(mergeContentRoots(['Build/', './Build']), ['Build'])  // 尾斜杠与 `./` 归一后是同一条
})

test('buildContentRoots：Gradle 链接表 + Maven 的 pom 目录并成一集，按祖先去重', () => {
  assert.deepEqual(buildContentRoots({ linkedGradleDirs: ['Build', 'Build/sub'], files: [] }), ['Build'])
  assert.deepEqual(buildContentRoots({ linkedGradleDirs: [], files: ['pom.xml', 'core/pom.xml'] }), [''])
  assert.deepEqual(buildContentRoots({ linkedGradleDirs: ['plugins/ext'], files: ['plugins/ext/pom.xml'] }), ['plugins/ext'])
  assert.deepEqual(buildContentRoots({ linkedGradleDirs: ['Build'], maven: false, files: ['pom.xml'] }), ['Build'])
  // 什么都没有 ⇒ 空数组，兜底由调用方决定（`buildRootModel` 保留工作区根那条地板）
  assert.deepEqual(buildContentRoots({ files: AE2 }), [])
})

test('outputExcludeRoots：配置的编译输出才是排除根（上游 excludeOutput 默认 true，没配不猜目录名）', () => {
  assert.deepEqual(outputExcludeRoots({ outputPath: 'build/classes', contentRoots: [''] }),
    [{ path: 'build/classes', name: 'classes', rule: 'output' }])
  assert.deepEqual(outputExcludeRoots({ outputPath: '', contentRoots: [''] }), [])           // 没配输出 ⇒ 不猜 build/out/target
  assert.deepEqual(outputExcludeRoots({ outputPath: 'elsewhere/out', contentRoots: ['Build'] }), [])  // 不在内容根之下 ⇒ 谈不上挖掉
  assert.deepEqual(outputExcludeRoots({ outputPath: 'out', excludeOutput: false, contentRoots: [''] }), [])
  // 生产与测试输出同一条路径时只出一条（不重复挂）
  assert.deepEqual(outputExcludeRoots({ outputPath: 'out', testOutput: 'out', contentRoots: [''] }).length, 1)
})

test('isInModuleContent / excludedBy：排除优先（内容根之下但躺在排除根里 ⇒ 不算内容）', () => {
  const roots = ['Build']
  const excludes = [{ path: 'Build/sub/build', name: 'build', rule: 'output' }]
  assert.equal(isInModuleContent('Build/src/A.java', roots, excludes), true)
  assert.equal(isInModuleContent('Build/sub/build/x.class', roots, excludes), false)
  assert.equal(isInModuleContent('docs/note.md', roots, excludes), false)   // 不在任何内容根之下
  assert.deepEqual(excludedBy('Build/sub/build/deep/x.class', excludes)?.path, 'Build/sub/build')
  // 多条排除根嵌套时报最深的那条（说得出"被哪一条直接盖住"）
  const nested = [{ path: 'Build', name: 'Build', rule: 'name' }, { path: 'Build/sub/build', name: 'build', rule: 'output' }]
  assert.equal(excludedBy('Build/sub/build/x.class', nested)?.path, 'Build/sub/build')
  assert.equal(isAncestorPath('', 'anything'), true)
})

test('根模型：链接的工程目录进内容根，工作区根那条地板仍在（rootsModel 文件头第 2 条不等价）', () => {
  const model = buildRootModel({
    moduleName: 'ae2', sourcePaths: ['Build/core/src/main/java'], files: AE2,
    buildProjectDirs: buildContentRoots({ linkedGradleDirs: ['Build'], files: AE2 }),
  })
  assert.deepEqual(model.contentEntries.map(entry => entry.url), ['', 'Build'])
  assert.deepEqual(rootModelRows(model, true).filter(row => row.depth === 0).map(row => row.text),
    ['内容根 ae2', '内容根 Build', '模块「ae2」的序根条目'])
  // 源根归**最长匹配**的那条内容根（邻居根不抢）
  assert.deepEqual(model.contentEntries[1].sources.map(item => item.path), ['Build/core/src/main/java'])
  assert.deepEqual(model.contentEntries[0].sources, [])
  // 没给工程目录时与改前逐字一致（一条工作区根）
  const plain = buildRootModel({ moduleName: 'ae2', sourcePaths: ['src/main/java'], files: ['src/main/java/A.java'] })
  assert.deepEqual(plain.contentEntries.map(entry => entry.url), [''])
})

test('排除优先落在树上：配了输出目录 ⇒ 多一条排除根，踩在里面的源根被标出来', () => {
  const files = ['Build/build.gradle', 'Build/src/main/java/A.java', 'Build/build/x.class', 'Build/build/y.class']
  const entry = buildContentEntry({ moduleName: 'ae2', sourcePaths: ['Build/src/main/java', 'Build/build/gen'],
    outputPath: 'Build/build', files, buildProjectDirs: ['Build'] }, 'Build')
  assert.deepEqual(entry.excludes.map(item => [item.path, item.rule, item.fileCount]), [['Build/build', 'output', 2]])
  assert.deepEqual(entry.sources.map(item => [item.path, item.excludedBy]),
    [['Build/src/main/java', null], ['Build/build/gen', 'build']])
  const rows = rootModelRows(buildRootModel({ moduleName: 'ae2', sourcePaths: ['Build/build/gen'],
    outputPath: 'Build/build', files, buildProjectDirs: ['Build'] }), true)
  // 排除根只挂在**最长匹配**的那条内容根上（工作区根那条不重复列 ⇒ key 也不撞）
  assert.deepEqual(rows.filter(row => row.depth === 2).map(row => [row.key, row.comment]),
    [['source:Build:Build/build/gen', undefined], ['exclude:Build:Build/build', '编译输出目录（不参与内容）']])
  assert.equal(new Set(rows.map(row => row.key)).size, rows.length, '树行的 key 必须唯一（v-for key 撞了会静默少渲染）')
})

test('目录名表与输出目录命中同一条路径时不重复挂排除根（名字表先命中就归名字表）', () => {
  const files = ['build/x.class', 'src/main/java/A.java']
  const entry = buildContentEntry({ moduleName: 'app', sourcePaths: ['src/main/java'], excludedDirs: ['build'],
    outputPath: 'build', files }, '')
  assert.deepEqual(entry.excludes.map(item => [item.path, item.rule]), [['build', 'name']])
})
