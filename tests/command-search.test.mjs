import test from 'node:test'
import assert from 'node:assert/strict'

import { rankCommands, scoreCommand } from '../src/commandSearch.ts'

const command = (title, keywords) => ({ title, keywords })

test('an empty query keeps the registry order and a limit', () => {
  const items = ['一', '二', '三'].map(title => command(title))
  assert.deepEqual(rankCommands(items, '  '), items)
  assert.equal(rankCommands(items, '', 2).length, 2)
})

test('a contiguous hit outranks a scattered subsequence', () => {
  const titled = command('查找用法 Usage', 'find')
  const scattered = command('储藏', 'stash save')
  assert.equal(scoreCommand('zx', titled), 0, 'letters that never appear must not match')
  assert.ok(scoreCommand('sa', scattered) > 0, 'a scattered alias still matches, weakly')
  const ranked = rankCommands([scattered, titled], 'sa')
  assert.equal(ranked[0], scattered, 'the only matching command is the scattered one')
  assert.ok(scoreCommand('usa', titled) > scoreCommand('usa', scattered), 'the word in the title wins')
})

test('latin aliases make Chinese titles findable', () => {
  const blame = command('Git 追溯（Annotate）', 'blame annotate git')
  assert.ok(scoreCommand('annotate', blame) > 0, 'a word inside the title matches')
  assert.ok(scoreCommand('blame', blame) > 0, 'a keyword alias matches')
  assert.ok(scoreCommand('blame git', blame) > 0, 'a multi-word alias matches')
  const titles = [blame, command('保存文件', 'save')]
  assert.deepEqual(rankCommands(titles, 'blame').length, 1)
})

test('word starts in an alias outrank a mid-word hit', () => {
  const items = [command('全部保存', 'all save'), command('保存文件', 'save file'), command('粘贴', 'paste')]
  const ranked = rankCommands(items, 'save')
  assert.deepEqual(ranked.map(item => item.title), ['保存文件', '全部保存'])
  assert.ok(!ranked.includes(items[2]), 'unrelated commands stay out of the list')
})

test('the visible title beats a keyword alias for the same letters', () => {
  const titled = command('查找用法', 'find usages')
  const aliased = command('在文件中查找与替换', 'usage find')
  assert.ok(scoreCommand('find', titled) > scoreCommand('find', aliased))
})
