// pm/roots 的判据：序根枚举（`OrderRootComputer` / `OrderRootsEnumeratorImpl` / `OrderRootsCache` 的
// 单模块等价物，`src/orderRoots.ts`）与 javac 类路径的真实接线。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  enumerateOrderRoots, orderCompileClasspath, orderRootPaths, orderSourceRoots, OrderRootsCache, RootModificationTracker,
} from '../src/orderRoots.ts'
import { javacCommand } from '../src/projectBuild.ts'

const here = dirname(fileURLToPath(import.meta.url))

const MODULE = {
  moduleName: 'demo',
  sourceRoots: ['src/main/java'],
  testSourceRoots: ['src/test/java'],
  outputPaths: ['out/production/demo'],
  libraryRoots: [{ classes: ['lib/a.jar', 'lib/b.jar'], sources: ['lib/a-sources.jar'] }],
  sdkRoots: { classes: ['C:/jdk/lib/jrt-fs.jar'] },
}

test('CLASSES 的顺序：模块输出 → 库 → SDK，按首次出现去重（OrderRootComputer.java:51-100）', () => {
  assert.deepEqual(orderCompileClasspath(MODULE), ['out/production/demo', 'lib/a.jar', 'lib/b.jar', 'C:/jdk/lib/jrt-fs.jar'])
  // 重复路径只留第一次出现的那条（上游 LinkedHashSet）。
  const dup = { ...MODULE, libraryRoots: [{ classes: ['out/production/demo', 'lib/a.jar'] }] }
  assert.deepEqual(orderCompileClasspath(dup), ['out/production/demo', 'lib/a.jar', 'C:/jdk/lib/jrt-fs.jar'])
  // withoutSdk 等价于 OrderEnumerator.withoutSdk()。
  assert.deepEqual(orderCompileClasspath({ ...MODULE, withoutSdk: true }), ['out/production/demo', 'lib/a.jar', 'lib/b.jar'])
})

test('SOURCES：主源根在前、测试源根在后，库的 sources 根也算（LibraryOrSdkOrderEntry.getRootFiles）', () => {
  assert.deepEqual(orderSourceRoots(MODULE), ['src/main/java', 'src/test/java', 'lib/a-sources.jar'])
  assert.deepEqual(orderSourceRoots({ ...MODULE, withoutSdk: true }).length, 3)
  assert.deepEqual(orderRootPaths(MODULE, 'javadoc'), [])
})

test('每个根都带类型与模块名（RootEntry 形态）', () => {
  assert.deepEqual(enumerateOrderRoots(MODULE, 'classes').slice(0, 2), [
    { type: 'classes', path: 'out/production/demo', module: 'demo' },
    { type: 'classes', path: 'lib/a.jar', module: 'demo' },
  ])
})

test('OrderRootsCache：同 key 只算一次，修改计数变了整批作废（ProjectRootModificationTracker）', () => {
  const tracker = new RootModificationTracker()
  const cache = new OrderRootsCache()
  let computed = 0
  const compute = () => { computed += 1; return orderCompileClasspath(MODULE) }
  const first = cache.getOrComputeRoots(MODULE, 'classes', '', compute)
  const second = cache.getOrComputeRoots(MODULE, 'classes', '', compute)
  assert.equal(computed, 1)
  assert.deepEqual(second, first)
  tracker.incModificationCount()
  cache.setModificationCount(tracker.modificationCount)
  cache.getOrComputeRoots(MODULE, 'classes', '', compute)
  assert.equal(computed, 2)
  // 计数没变时不清缓存。
  cache.setModificationCount(tracker.modificationCount)
  cache.getOrComputeRoots(MODULE, 'classes', '', compute)
  assert.equal(computed, 2)
})

test('javacCommand 的 -cp 真的走这条枚举：输出在前、库在后、重复项去掉', () => {
  const command = javacCommand({ jdkHome: 'C:/jdk-21', outputPath: 'build/classes', classpath: ['lib/a.jar', 'build/classes'], projectName: 'demo' }, 'args.txt')
  assert.match(command, /-cp "(build\/classes|build\\classes)[;:](lib\/a|lib\\a)\.jar"/)
  // 输出目录在 classpath 里重复出现时只留一次（上游去重）。
  const occurrences = command.split('build/classes').length - 1 + (command.split('build\\classes').length - 1)
  assert.equal(occurrences, 2, `输出目录应只出现两次（-d 一次、-cp 一次）：${command}`)
  const source = readFileSync(join(here, '..', 'src', 'projectBuild.ts'), 'utf8')
  assert.match(source, /import \{ orderCompileClasspath \} from '\.\/orderRoots\.ts'/)
  assert.match(source, /orderCompileClasspath\(\{/)
  assert.doesNotMatch(source, /\[output, \.\.\.request\.classpath\]/)
})
