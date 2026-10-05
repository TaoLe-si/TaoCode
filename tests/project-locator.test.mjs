// 项目定位（`src/projectLocator.ts`）：根归一、项目身份比较、按路径定位最近的祖先，
// 以及项目部件「已打开/最近」分组的接线（不再用 === 比路径）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  isSameProjectPath, locateAllProjects, locateProject, normalizeProjectRoot,
  projectContains, projectNameFromRoot, projectRelativePath, uniqueProjectRoots,
} from '../src/projectLocator.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('根归一：分隔符、尾斜杠、空串', () => {
  assert.equal(normalizeProjectRoot('D:\\work\\app\\'), 'D:/work/app')
  assert.equal(normalizeProjectRoot('D:/work/app///'), 'D:/work/app')
  assert.equal(normalizeProjectRoot(''), '/')
  assert.equal(projectNameFromRoot('D:/work/my-app/'), 'my-app')
  assert.equal(projectNameFromRoot('/'), '/')
})

test('项目身份比较：大小写与分隔符不敏感，空值不相等', () => {
  assert.equal(isSameProjectPath('D:/Work/App', 'd:\\work\\app\\'), true)
  assert.equal(isSameProjectPath('D:/work/app', 'D:/work/other'), false)
  assert.equal(isSameProjectPath(undefined, 'D:/work/app'), false)
  assert.equal(isSameProjectPath('D:/work/app', undefined), false)
})

test('包含判定是路径边界而不是前缀：/a/b 不属于 /a/bc', () => {
  assert.equal(projectContains('D:/work/app', 'D:/work/app/src/a.ts'), true)
  assert.equal(projectContains('D:/work/app', 'D:/work/app'), true)
  assert.equal(projectContains('D:/work/app', 'D:/work/app2/a.ts'), false)
  assert.equal(projectRelativePath('D:/work/app', 'D:/work/app/src/a.ts'), 'src/a.ts')
  assert.equal(projectRelativePath('D:/work/app', 'D:/work/app'), '')
  assert.equal(projectRelativePath('D:/work/app', 'D:/other/a.ts'), null)
})

test('按路径定位：最近的（最长）根赢，全部命中按近到远', () => {
  const roots = ['D:/work', 'D:/work/app', 'D:/work/app2', 'E:/other']
  assert.equal(locateProject('D:/work/app/src/a.ts', roots), 'D:/work/app')
  assert.equal(locateProject('D:/work/lib/a.ts', roots), 'D:/work')
  assert.equal(locateProject('C:/none/a.ts', roots), null)
  assert.deepEqual(locateAllProjects('D:/work/app/src/a.ts', roots), ['D:/work/app', 'D:/work'])
  // 传入顺序不影响结果（内部按长度排）。
  assert.equal(locateProject('D:/work/app/src/a.ts', [...roots].reverse()), 'D:/work/app')
})

test('根列表去重：归一后同名只留首个原文', () => {
  assert.deepEqual(uniqueProjectRoots(['D:/Work/App', 'd:\\work\\app\\', 'D:/other']), ['D:/Work/App', 'D:/other'])
})

test('接线：项目部件的「已打开」分组按项目身份比，不是字符串相等', () => {
  const widget = readFileSync(join(root, 'src/projectWidget.ts'), 'utf8')
  assert.match(widget, /from '\.\/projectLocator\.ts'/, '项目部件没有接定位模块')
  assert.match(widget, /isSameProjectPath\(project\.path, currentRoot\)/, '分组没有按项目身份比较')
  assert.ok(!/project\.path === currentRoot/.test(widget), '旧的 === 比较不能还在')
})
