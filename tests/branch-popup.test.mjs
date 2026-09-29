import test from 'node:test'
import assert from 'node:assert/strict'
import { BRANCH_ROW_ACTIONS, BRANCH_TOP_ACTIONS, filterBranches, sortBranches, validateBranchName } from '../src/branchPopup.ts'

// IDEA 分支弹窗（GitBranchesPopup）的动作清单来自 backend.xml:303-333；
// 这里锁住"清单里的每一项都有原生落点"这个前提，避免以后加了没有实现的动作。
test('every popup action maps to a native git command', () => {
  const implemented = new Set(['checkout', 'create', 'delete', 'compare', 'rebase', 'merge', 'push', 'checkoutInput'])
  for (const action of [...BRANCH_TOP_ACTIONS, ...BRANCH_ROW_ACTIONS])
    assert.ok(implemented.has(action.id), `${action.id} 没有对应实现`)
  assert.equal(BRANCH_TOP_ACTIONS.some(action => action.id === 'create'), true, 'Git.CreateNewBranch')
  assert.equal(BRANCH_ROW_ACTIONS.some(action => action.id === 'checkout'), true, 'GitCheckoutAction')
})

test('the current branch sorts first, the rest by natural order', () => {
  assert.deepEqual(sortBranches(['v1.10', 'main', 'feature/x', 'v1.9'], 'main'),
    ['main', 'feature/x', 'v1.9', 'v1.10'])
  assert.deepEqual(sortBranches(['b', 'a'], 'a'), ['a', 'b'])
  assert.deepEqual(sortBranches([], 'main'), [])
  // 当前分支不在列表里（例如游离 HEAD）时不报错，只是正常排序。
  assert.deepEqual(sortBranches(['b', 'a'], 'detached'), ['a', 'b'])
})

// GitBranchesPopupBase.kt:352 装的是平台的 speed search：忽略大小写的子串匹配。
test('the speed search filters case-insensitively and ranks earlier matches first', () => {
  const branches = ['main', 'feature/MAIN-thing', 'release']
  assert.deepEqual(filterBranches(branches, ''), branches, 'an empty query keeps everything')
  assert.deepEqual(filterBranches(branches, '  '), branches, 'a blank query is the same as empty')
  assert.deepEqual(filterBranches(branches, 'main'), ['main', 'feature/MAIN-thing'], 'the earlier match comes first')
  assert.deepEqual(filterBranches(branches, 'MAIN'), ['main', 'feature/MAIN-thing'], 'case does not matter')
  assert.deepEqual(filterBranches(branches, 'zzz'), [])
})

test('branch names are checked against git check-ref-format', () => {
  assert.equal(validateBranchName('feature/x'), null)
  assert.equal(validateBranchName('v1.2.3'), null)
  assert.equal(validateBranchName('release-2026'), null)
  assert.match(validateBranchName(''), /不能为空/)
  assert.match(validateBranchName('   '), /不能为空/)
  assert.match(validateBranchName('a b'), /空格/)
  assert.match(validateBranchName('a~b'), /不能包含/)
  assert.match(validateBranchName('a^b'), /不能包含/)
  assert.match(validateBranchName('a:b'), /不能包含/)
  assert.match(validateBranchName('a?b'), /不能包含/)
  assert.match(validateBranchName('a*b'), /不能包含/)
  assert.match(validateBranchName('a[b'), /不能包含/)
  assert.match(validateBranchName('-bad'), /不能以 -/)
  assert.match(validateBranchName('/bad'), /不能以 -/)
  assert.match(validateBranchName('bad/'), /不能以 \/ 或 \. 结尾/)
  assert.match(validateBranchName('bad.'), /不能以 \/ 或 \. 结尾/)
  assert.match(validateBranchName('bad.lock'), /不能以 \/ 或 \. 结尾/)
  assert.match(validateBranchName('a..b'), /不能出现/)
  assert.match(validateBranchName('a@{b'), /不能出现/)
  assert.match(validateBranchName('a//b'), /不能出现/)
})
