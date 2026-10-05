// pm/file-index 的判据：`ProjectFileIndex` / `WorkspaceFileIndex` 查询面的移植口径
// （`src/projectFileIndex.ts`）与「来自源根的路径」的真实消费链路。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  createProjectFileIndex, isTestSourceRoot, normalizeIndexPath, sourceRootFor, sourceRootFromConvention,
} from '../src/projectFileIndex.ts'
import { sourceRootPathText } from '../src/copyPathActions.ts'

const here = dirname(fileURLToPath(import.meta.url))

const files = [
  'src/main/java/com/example/App.java',
  'src/main/java/com/example/Util.java',
  'src/test/java/com/example/AppTest.java',
  'src/main/resources/app.properties',
  'build/classes/com/example/App.class',
  'lib/guava.jar',
  'README.md',
]

const makeIndex = (overrides = {}) => createProjectFileIndex({
  files,
  sourceRoots: ['src/main/java', 'src/test/java'],
  excludedDirs: ['build'],
  moduleName: 'demo',
  ...overrides,
})

test('isInContent / isInProject：内容根之下算内容，排除子树与项目外不算（ExcludedRootFileIndexContributor）', () => {
  const index = makeIndex()
  assert.equal(index.isInProject('src/main/java/com/example/App.java'), true)
  assert.equal(index.isInContent('src/main/java/com/example/App.java'), true)
  // 排除根：仍在项目清单里（可见），但 isInContent 为假，且能说出被哪个目录名排除。
  assert.equal(index.isInProject('build/classes/com/example/App.class'), true)
  assert.equal(index.isInContent('build/classes/com/example/App.class'), false)
  assert.equal(index.isExcluded('build/classes/com/example/App.class'), true)
  assert.equal(index.getExcludedRoot('build/classes/com/example/App.class'), 'build')
  assert.equal(index.getExcludedRoot('src/main/java/com/example/App.java'), null)
})

test('getSourceRootForFile：配置的源根优先（最长前缀）、项目外与排除子树为 null', () => {
  const index = makeIndex()
  assert.equal(index.getSourceRootForFile('src/main/java/com/example/App.java'), 'src/main/java')
  assert.equal(index.getSourceRootForFile('src/test/java/com/example/AppTest.java'), 'src/test/java')
  // 内容根直属文件没有源根（上游返回 null）。
  assert.equal(index.getSourceRootForFile('README.md'), null)
  // 排除子树里的文件不算内容，源根也为 null。
  assert.equal(index.getSourceRootForFile('build/classes/com/example/App.class'), null)
  assert.equal(index.getSourceRootForFile('lib/guava.jar'), null)
})

test('没有配置源根时按目录约定推导（sourceRootFromConvention）', () => {
  const index = makeIndex({ sourceRoots: [] })
  assert.equal(index.getSourceRootForFile('src/main/java/com/example/App.java'), 'src/main/java')
  assert.equal(index.getSourceRootForFile('src/test/java/com/example/AppTest.java'), 'src/test/java')
  assert.equal(index.getSourceRootForFile('src/main/resources/app.properties'), 'src/main/resources')
  // 顶层 src 也是约定根（与 src/fileTemplateVars.ts 的 SOURCE_ROOTS 口径一致）。
  assert.equal(sourceRootFromConvention('src/deep/inner.ts'), 'src')
  assert.equal(sourceRootFromConvention('docs/readme.md'), null)
  assert.equal(sourceRootFor('src/deep/inner.ts'), 'src')
  assert.equal(sourceRootFor('src/deep/inner.ts', ['other']), 'src')
})

test('getModuleForFile / getContentRootForFile / isInTestSourceContent（ProjectRootTestSourcesFilter）', () => {
  const index = makeIndex()
  assert.equal(index.getModuleForFile('src/main/java/com/example/App.java'), 'demo')
  // 工作区清单之外的路径不是项目文件：模块/内容根都为 null。
  assert.equal(index.getModuleForFile('outside/dep.jar'), null)
  assert.equal(index.getContentRootForFile('src/main/java/com/example/App.java'), '')
  assert.equal(index.getContentRootForFile('outside/dep.jar'), null)
  assert.equal(index.isInTestSourceContent('src/test/java/com/example/AppTest.java'), true)
  assert.equal(index.isInTestSourceContent('src/main/java/com/example/App.java'), false)
  assert.equal(isTestSourceRoot('src/test/java'), true)
  assert.equal(isTestSourceRoot('src/main/java'), false)
  // locate 一次给全部归属。
  assert.deepEqual(index.locate('src/main/java/com/example/App.java'), {
    inProject: true, inContent: true, excludedRoot: null, sourceRoot: 'src/main/java',
    contentRoot: '', module: 'demo', inTestSource: false,
  })
})

test('增量：addFile / removeFile 只动那一条，不重扫清单（WorkspaceFileIndexDataImpl）', () => {
  const index = makeIndex()
  index.addFile('src/main/java/com/example/New.java')
  assert.equal(index.isInContent('src/main/java/com/example/New.java'), true)
  assert.equal(index.getSourceRootForFile('src/main/java/com/example/New.java'), 'src/main/java')
  index.removeFile('src/main/java/com/example/New.java')
  assert.equal(index.isInProject('src/main/java/com/example/New.java'), false)
  assert.equal(index.files.length, files.length)
})

test('normalizeIndexPath：反斜杠、./ 前缀、尾斜杠都归一', () => {
  assert.equal(normalizeIndexPath('src\\main\\java\\A.java'), 'src/main/java/A.java')
  assert.equal(normalizeIndexPath('./src/main/java/'), 'src/main/java')
  assert.equal(normalizeIndexPath('  '), '')
})

test('sourceRootPathText 就是 CopySourceRootPathProvider：相对源根，null 时调用方不出这一条', () => {
  assert.equal(sourceRootPathText({ path: 'src/main/java/com/example/App.java', line: 1 }, 'src/main/java'), 'com/example/App.java')
  assert.equal(sourceRootPathText({ path: 'src/main/java/com/example/App.java', line: 1 }, null), null)
  // 文件不在那个源根之下：上游 getRelativePath 也返不出东西。
  assert.equal(sourceRootPathText({ path: 'src/main/resources/a.txt', line: 1 }, 'src/main/java'), null)
})

test('标签右键菜单真的渲染了这一行，并走同一个剪贴板动作', () => {
  const component = readFileSync(join(here, '..', 'src', 'components', 'TabContextMenu.vue'), 'utf8')
  assert.match(component, /import \{ SOURCE_ROOT_PATH_LABEL, sourceRootPathText \} from '\.\.\/copyPathActions'/)
  assert.match(component, /import \{ sourceRootFor \} from '\.\.\/projectFileIndex'/)
  assert.match(component, /sourceRootPathText\(copyTarget\(\), sourceRootFor\(props\.path\)\)/)
  assert.match(component, /<button v-if="sourceRootRow" class="sub-item"/)
  assert.match(component, /pickSourceRootCopy\(sourceRootRow\.text\)/)
})
