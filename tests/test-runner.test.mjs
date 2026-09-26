import { test } from 'node:test'
import assert from 'node:assert/strict'
const {
  discover, discoverCtest, discoverNodeTests, discoverJunit,
  parseTapLine, parseCtestLine, parseJunitLine, parseResultLine,
  rerunCommand, FailedSet, firstStackFrame,
} = await import('../src/testRunner.ts')

test('ctest discovery reads add_test with and without NAME', () => {
  const found = discoverCtest('add_test(NAME unit_a cmd)\nadd_test(unit_b cmd2)')
  assert.deepEqual(found.map(t => [t.name, t.line]), [['unit_a', 1], ['unit_b', 2]])
  assert.ok(found.every(t => t.id.startsWith('ctest:')))
})

test('node:test discovery reads test()/it() with line numbers', () => {
  const found = discoverNodeTests("test('alpha', () => {})\n\nit('beta', async () => {})")
  assert.deepEqual(found.map(t => [t.name, t.line]), [['alpha', 1], ['beta', 3]])
})

test('junit discovery pairs @Test with the following method', () => {
  const found = discoverJunit('class A {\n  @Test\n  void works() {}\n}')
  assert.deepEqual(found.map(t => t.name), ['works'])
  assert.equal(found[0].line, 3)
})

test('discover routes by path shape', () => {
  assert.equal(discover('CMakeLists.txt', 'add_test(NAME x cmd)').length, 1)
  assert.equal(discover('test/A.test.mjs', "test('x', () => {})").length, 1)
  assert.equal(discover('src/A.java', '@Test\nvoid x() {}').length, 1)
  assert.equal(discover('src/main.cpp', 'int main() {}').length, 0)
})

test('TAP lines parse pass/fail/skip with durations', () => {
  assert.deepEqual(parseTapLine('✔ alpha (1.2ms)'), { id: 'npm:alpha', name: 'alpha', outcome: 'passed', durationMs: 1.2 })
  assert.equal(parseTapLine('✖ beta (0.5ms)')?.outcome, 'failed')
  assert.equal(parseTapLine('﹣ gamma # SKIP')?.outcome, 'skipped')
  assert.equal(parseTapLine('ok 3 delta')?.outcome, 'passed')
})

test('TAP ok/not-ok forms parse', () => {
  assert.equal(parseTapLine('ok 1 alpha')?.outcome, 'passed')
  assert.equal(parseTapLine('not ok 2 beta')?.outcome, 'failed')
  assert.equal(parseTapLine('ok 4 gamma # SKIP')?.outcome, 'skipped')
})

test('ctest result rows parse', () => {
  assert.equal(parseCtestLine('  1/12 Test  #3: unit_a ...   Passed  0.05 sec')?.outcome, 'passed')
  assert.equal(parseCtestLine('  2/12 Test  #4: unit_b ...***Failed')?.outcome, 'failed')
})

test('gradle and junit-failure headers parse', () => {
  assert.equal(parseJunitLine('MathTest > adds PASSED')?.outcome, 'passed')
  const failed = parseJunitLine('1) MathTest.adds  3 was not 4')
  assert.equal(failed?.outcome, 'failed')
  assert.equal(failed?.name, 'adds')
})

test('parseResultLine fans out across frameworks', () => {
  assert.equal(parseResultLine('✔ a')?.outcome, 'passed')
  assert.equal(parseResultLine('not ok 2 b')?.outcome, 'failed')
  assert.equal(parseResultLine('  5/9 Test #5: c ... Passed 0.01 sec')?.outcome, 'passed')
  assert.equal(parseResultLine('plain text'), null)
})

test('rerunCommand shapes per framework', () => {
  const failed = ['unit_a', 'with (parens)']
  assert.equal(rerunCommand('ctest', 'ctest --output-on-failure', failed), 'ctest --output-on-failure -R "^(unit_a|with \\(parens\\))$"')
  assert.ok(rerunCommand('npm', 'npm test', failed).startsWith('npm test --test-name-pattern='))
  assert.equal(rerunCommand('junit', 'mvn test', failed), 'mvn test -Dtest=unit_a,with (parens)')
  assert.equal(rerunCommand('npm', 'npm test', []), 'npm test')
})

test('FailedSet keeps exactly the still-red tests', () => {
  const set = new FailedSet()
  set.apply({ id: 'npm:a', name: 'a', outcome: 'failed' })
  set.apply({ id: 'npm:b', name: 'b', outcome: 'failed' })
  assert.equal(set.size, 2)
  set.apply({ id: 'npm:a', name: 'a', outcome: 'passed' })
  assert.deepEqual(set.names(), ['b'])
  set.clear()
  assert.equal(set.size, 0)
})

test('firstStackFrame picks the first source frame', () => {
  const frame = firstStackFrame([
    '    at Test.run (node:internal/test_runner/test:1325:25)',
    '    at D:\\repo\\tests\\a.test.mjs:10:5',
  ])
  assert.deepEqual(frame, { path: 'D:/repo/tests/a.test.mjs', line: 10 })
  assert.equal(firstStackFrame(['no frames here']), null)
})
