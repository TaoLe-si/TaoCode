// pm/file-index 缺项 ② 的判据：「已配置源根」的进程表（显式配置 > 进程表 > 目录约定）
// 与它在 `src/gradleHost.ts` 的写者接线。上游口径：`getSourceRootForFile` 读根模型，
// 约定推断只是「设置不可得」时的本仓代偿 —— 表一旦灌上配置，约定就让位。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  getConfiguredSourceRoots, setConfiguredSourceRoots, sourceRootFor, createProjectFileIndex,
} from '../src/projectFileIndex.ts'

const here = dirname(fileURLToPath(import.meta.url))
const readSource = file => readFileSync(join(here, '..', 'src', file), 'utf8')

test('默认没有表时行为不变：按目录约定推源根', () => {
  setConfiguredSourceRoots([])
  assert.deepEqual(getConfiguredSourceRoots(), [])
  assert.equal(sourceRootFor('module/src/main/java/com/acme/Foo.java'), 'module/src/main/java')
})

test('表灌上配置后配置优先：自定义根压过约定，最长前缀命中；尾斜杠/反斜杠/空段被归一', () => {
  setConfiguredSourceRoots(['library/src\\', '', '  app/code ', 'src/main/java'])
  assert.deepEqual(getConfiguredSourceRoots(), ['library/src', 'app/code', 'src/main/java'])
  assert.equal(sourceRootFor('library/src/Whatever.java'), 'library/src', '自定义根命中（约定推不出这个）')
  assert.equal(sourceRootFor('app/code/com/acme/Main.kt'), 'app/code')
  assert.equal(sourceRootFor('src/main/java/A.java'), 'src/main/java')
  assert.equal(sourceRootFor('module/src/main/java/A.java'), 'module/src/main/java', '表里的根没覆盖到时仍走约定代偿')
})

test('显式传参压过进程表（实例侧带自己配置的调用方不受进程表影响）', () => {
  setConfiguredSourceRoots(['shared'])
  // 同一文件：显式给了更深的根时以显式为准；显式没给上（不匹配）才轮到进程表。
  assert.equal(sourceRootFor('shared/sub/A.java', ['shared/sub']), 'shared/sub')
  assert.equal(sourceRootFor('shared/other/A.java', ['shared/sub']), 'shared', '显式根不命中时进程表补位')
  const index = createProjectFileIndex({ files: ['explicit/dir/A.java', 'process/root/B.java'], sourceRoots: ['explicit/dir'] })
  assert.equal(index.getSourceRootForFile('explicit/dir/A.java'), 'explicit/dir')
})

test('清表回到初始形态（测试与换工程都清得掉）', () => {
  setConfiguredSourceRoots(['process/root'])
  setConfiguredSourceRoots([])
  assert.deepEqual(getConfiguredSourceRoots(), [])
  assert.equal(sourceRootFor('process/root/A.java'), null, '既无配置又不成约定形态 → null（上游对不在源根的文件同返 null）')
})

test('接线：gradleHost 是这张表的写者（java.sourcePaths → setConfiguredSourceRoots）', () => {
  const host = readSource('gradleHost.ts')
  assert.match(host, /import \{ setConfiguredSourceRoots \} from '\.\/projectFileIndex\.ts'/)
  assert.match(host, /watch\(\(\) => deps\.projectSettings\.value\.java\?\.sourcePaths \?\? \[\], roots => \{ setConfiguredSourceRoots\(roots\) \}/)
})
