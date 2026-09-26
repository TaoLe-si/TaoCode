import test from 'node:test'
import assert from 'node:assert/strict'
import { lastOpenedPath, matchesSearch, searchText, systemDependentPath } from '../src/welcomeProjects.ts'

const project = (path, lastOpened, extra = {}) => ({
  name: path.split('/').pop(),
  path,
  lastOpened,
  available: true,
  ...extra,
})

// RecentProjectTreeItem.kt:139-147 — "<group name> <path> <display name>".
test('the searched text carries the group name, the path and the name', () => {
  const item = project('D:/work/alpha', '2026-09-26T10:00:00Z')
  assert.equal(searchText(item, '客户项目'), '客户项目 D:/work/alpha alpha')
})

test('a project matches on its group name as well as on its path or name', () => {
  const item = project('D:/work/alpha', '2026-09-26T10:00:00Z')
  assert.equal(matchesSearch(item, '客户项目', '客户'), true)
  assert.equal(matchesSearch(item, '客户项目', 'work'), true)
  assert.equal(matchesSearch(item, '客户项目', 'alpha'), true)
  assert.equal(matchesSearch(item, '客户项目', 'beta'), false)
})

test('an empty query keeps every project', () => {
  const item = project('D:/work/alpha', '2026-09-26T10:00:00Z')
  assert.equal(matchesSearch(item, '未分组', ''), true)
  assert.equal(matchesSearch(item, '未分组', '   '), true)
})

test('the search ignores case', () => {
  const item = project('D:/Work/Alpha', '2026-09-26T10:00:00Z')
  assert.equal(matchesSearch(item, '未分组', 'work/alpha'), true)
})

// RecentProjectFilteringTree.kt:236-254 — select the project that was opened last.
test('the newest activation timestamp wins', () => {
  const projects = [
    project('D:/a', '2026-09-20T08:00:00Z'),
    project('D:/b', '2026-09-26T09:30:00Z'),
    project('D:/c', '2026-09-24T23:00:00Z'),
  ]
  assert.equal(lastOpenedPath(projects), 'D:/b')
})

test('unparseable timestamps fall back to the first record, an empty list to nothing', () => {
  const projects = [project('D:/a', 'not-a-date'), project('D:/b', 'also-not-a-date')]
  assert.equal(lastOpenedPath(projects), 'D:/a')
  assert.equal(lastOpenedPath([]), '')
})

// CopyProjectPathAction.kt:25-32 — FileUtil.toSystemDependentName.
test('the copied path uses the platform separators', () => {
  assert.equal(systemDependentPath('D:/work/alpha', true), 'D:\\work\\alpha')
  assert.equal(systemDependentPath('D:\\work\\alpha', true), 'D:\\work\\alpha')
  assert.equal(systemDependentPath('D:\\work\\alpha', false), 'D:/work/alpha')
})
