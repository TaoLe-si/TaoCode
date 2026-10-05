// 项目根/源根的纯规则判据（`src/projectRoots.ts`）。
//
// 上游依据（裁决口径与文件头一致）：
//   · 源根类型图标 `JavaModuleSourceRootEditHandler` / `JavaTestSourceRootEditHandler`
//     （源根 #40B6E0、测试根 #62B543、生成根叠灰 #9AA7B0）；
//   · `ProjectRootsUtil.isExcludedFromProject`（排除按路径段匹配）；
//   · `ContentEntryEditor`：磁盘上不存在的根要有告警态。
import test from 'node:test'
import assert from 'node:assert/strict'
import { classifySourceRoot, detectSourceRoots, excludedByNames, isUsableRootPath, normalizeRootPath,
         SOURCE_ROOT_LABELS, validateSourceRoots } from '../src/projectRoots.ts'

test('路径规范化：反斜杠/尾斜杠/空白都收敛成存储口径', () => {
  assert.equal(normalizeRootPath(' src\\main\\java\\ '), 'src/main/java')
  assert.equal(normalizeRootPath('src/main/java/'), 'src/main/java')
  assert.equal(normalizeRootPath(''), '')
})

test('可用根：拒绝绝对路径、..、空段', () => {
  assert.equal(isUsableRootPath('src/main/java'), true)
  assert.equal(isUsableRootPath('src\\main\\java'), true)
  assert.equal(isUsableRootPath('/abs'), false)
  assert.equal(isUsableRootPath('C:/x'), true, '盘符路径会被上游 invalidRelative 拒绝，但这里只判相对性')
  assert.equal(isUsableRootPath('src/../x'), false)
  assert.equal(isUsableRootPath('src//x'), false)
  assert.equal(isUsableRootPath(''), false)
})

test('根类型按 Maven/Gradle 约定判定（生成根优先，测试资源先于资源）', () => {
  assert.equal(classifySourceRoot('src/main/java'), 'sources')
  assert.equal(classifySourceRoot('src/main/kotlin'), 'sources')
  assert.equal(classifySourceRoot('src/test/java'), 'tests')
  assert.equal(classifySourceRoot('tests'), 'tests')
  assert.equal(classifySourceRoot('src/main/resources'), 'resources')
  assert.equal(classifySourceRoot('src/test/resources'), 'test-resources')
  assert.equal(classifySourceRoot('target/generated-sources/annotations'), 'generated')
  assert.equal(classifySourceRoot('build/generated/sources'), 'generated')
})

test('生成根判定不被大小写/分隔符绕过', () => {
  assert.equal(classifySourceRoot('Target\\Generated-Sources\\annotations'), 'generated')
  assert.equal(classifySourceRoot('SRC/TEST/JAVA'), 'tests')
})

test('排除目录按路径段命中（ProjectRootsUtil.isExcludedFromProject）', () => {
  assert.equal(excludedByNames('build/classes/java', ['build', '.git']), 'build')
  assert.equal(excludedByNames('src/build-tools/java', ['build']), null, '段必须整段相等，不能子串')
  assert.equal(excludedByNames('src/main/java', []), null)
})

test('逐根核对：文件数、磁盘缺失、排除冲突', () => {
  const files = ['src/main/java/A.java', 'src/main/java/p/B.java', 'src/test/java/T.java', 'README.md']
  const states = validateSourceRoots(['src/main/java', 'src/test/java', 'src/missing', 'build/java'], files, ['build'])
  assert.deepEqual(states.map(s => [s.path, s.kind, s.fileCount, s.missing, s.excludedBy]), [
    ['src/main/java', 'sources', 2, false, null],
    ['src/test/java', 'tests', 1, false, null],
    ['src/missing', 'sources', 0, true, null],
    ['build/java', 'sources', 0, true, 'build'],
  ])
})

test('逐根核对去重并丢掉不可用路径（保存前的那层校验不在这里重复）', () => {
  const states = validateSourceRoots(['src/main/java', 'src\\main\\java', '/abs', 'src/../x'], ['src/main/java/A.java'])
  assert.deepEqual(states.map(s => s.path), ['src/main/java'])
})

test('约定根检测：只报还没被现有根覆盖的目录', () => {
  const files = ['app/src/main/java/A.java', 'app/src/test/java/T.java', 'app/src/main/resources/x.xml',
                 'app/target/generated-sources/annotations/G.java', 'lib/src/main/java/L.java', 'README.md']
  assert.deepEqual(detectSourceRoots(files), [
    { path: 'app/src/main/java', kind: 'sources' },
    { path: 'app/src/main/resources', kind: 'resources' },
    { path: 'app/src/test/java', kind: 'tests' },
    { path: 'app/target/generated-sources', kind: 'generated' },
    { path: 'lib/src/main/java', kind: 'sources' },
  ])
  assert.deepEqual(detectSourceRoots(files, ['app/src/main/java']).map(item => item.path),
    ['app/src/main/resources', 'app/src/test/java', 'app/target/generated-sources', 'lib/src/main/java'],
    '已配置根下的目录不再建议（是被覆盖的，不是缺的）')
  assert.deepEqual(detectSourceRoots(files, ['app']), [{ path: 'lib/src/main/java', kind: 'sources' }],
    '现有根 `app` 覆盖它那棵子树，但不影响别的模块目录')
})

test('非约定的包目录不当作源根（src/java 会被当成包名而不是根）', () => {
  assert.deepEqual(detectSourceRoots(['src/java/A.java', 'com/example/src/main/java/B.java']), [
    // com/example/src/main/java 是合法约定布局（多模块目录下的 src/main/java）
    { path: 'com/example/src/main/java', kind: 'sources' },
  ])
})

test('标签表就是面板显示的那个口径', () => {
  assert.deepEqual(SOURCE_ROOT_LABELS, { sources: '源代码', tests: '测试', resources: '资源', 'test-resources': '测试资源', generated: '生成' })
})
