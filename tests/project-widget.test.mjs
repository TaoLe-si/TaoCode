import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_PROJECT_WIDGET_ITEMS, filterProjects, groupProjects } from '../src/projectWidget.ts'

const project = (name, path, available = true) => ({ name, path, available })

test('an empty query keeps every recent project in its original order', () => {
  const projects = [project('a', '/a'), project('b', '/b')]
  assert.deepEqual(filterProjects(projects, '').map(item => item.name), ['a', 'b'])
  assert.deepEqual(filterProjects(projects, '   ').map(item => item.name), ['a', 'b'])
})

// ProjectWidgetSpeedsearchFilter indexes name + path, so either one matches.
test('the search matches the name and the path, case-insensitively', () => {
  const projects = [project('Alpha', '/work/alpha'), project('Beta', '/work/beta')]
  assert.deepEqual(filterProjects(projects, 'alpha').map(item => item.name), ['Alpha'])
  assert.deepEqual(filterProjects(projects, 'ALPHA').map(item => item.name), ['Alpha'])
  assert.deepEqual(filterProjects(projects, '/work/beta').map(item => item.name), ['Beta'])
  assert.deepEqual(filterProjects(projects, 'nothing'), [])
})

test('the open project is listed first and never repeated among the recent ones', () => {
  const projects = [project('one', '/one'), project('two', '/two'), project('three', '/three')]
  const groups = groupProjects(projects, '/two')
  assert.deepEqual(groups.map(group => group.label), ['已打开的项目', '最近的项目'])
  assert.deepEqual(groups[0].items.map(item => item.name), ['two'])
  assert.deepEqual(groups[1].items.map(item => item.name), ['one', 'three'])
})

test('an empty group is dropped, so a lone project keeps the popup to one section', () => {
  const groups = groupProjects([project('solo', '/solo')], '/solo')
  assert.deepEqual(groups.map(group => group.label), ['已打开的项目'])
  assert.deepEqual(groups[0].items.map(item => item.name), ['solo'])
})

test('with no project open everything lands in the recent group', () => {
  const groups = groupProjects([project('one', '/one')], undefined)
  assert.deepEqual(groups.map(group => group.label), ['最近的项目'])
})

test('no projects at all produces no groups, which keeps the popup closed', () => {
  assert.deepEqual(groupProjects([], '/gone'), [])
})

// MAX_RECENT_COUNT caps the list before it is grouped (ProjectToolbarWidgetAction.kt:263-265).
test('the list is capped before grouping', () => {
  const many = Array.from({ length: MAX_PROJECT_WIDGET_ITEMS + 20 }, (_, index) => project(`p${index}`, `/p${index}`))
  const groups = groupProjects(many, '/p0')
  assert.equal(groups[0].items.length, 1)
  assert.equal(groups[1].items.length, MAX_PROJECT_WIDGET_ITEMS - 1)
  assert.equal(groups[0].items.length + groups[1].items.length, MAX_PROJECT_WIDGET_ITEMS)
})
