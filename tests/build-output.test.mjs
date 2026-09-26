import { test } from 'node:test'
import assert from 'node:assert/strict'
const { parseRunIssue, normalizeRunPath, parseCmakeIssue, parseAnyIssue } = await import('../src/buildOutput.ts')

test('MSVC format with column parses', () => {
  const issue = parseRunIssue('src/main.cpp(12,5): error C2065: "x": undeclared identifier')
  assert.deepEqual(issue, { path: 'src/main.cpp', line: 12, column: 5 })
})

test('MSVC format without column defaults to 1', () => {
  const issue = parseRunIssue('main.cpp(7): fatal error C1083: 无法打开包括文件')
  assert.deepEqual(issue, { path: 'main.cpp', line: 7, column: 1 })
})

test('GCC/Clang format with column parses', () => {
  const issue = parseRunIssue('src/lib.rs:3:9: error[E0425]: cannot find value `x` in this scope')
  assert.deepEqual(issue, { path: 'src/lib.rs', line: 3, column: 9 })
})

test('GCC format without column parses', () => {
  const issue = parseRunIssue('./build/main.c:42: warning: implicit declaration of function')
  assert.deepEqual(issue, { path: 'build/main.c', line: 42, column: 1 })
})

test('javac format parses', () => {
  const issue = parseRunIssue('Main.java:10: error: cannot find symbol')
  assert.deepEqual(issue, { path: 'Main.java', line: 10, column: 1 })
})

test('plain output lines are not issues', () => {
  assert.equal(parseRunIssue('[100%] Built target demo'), null)
  assert.equal(parseRunIssue('hello world'), null)
  assert.equal(parseRunIssue('src/main.cpp: contents'), null)
  assert.equal(parseRunIssue(''), null)
})

test('normalizeRunPath strips the absolute root and flips separators', () => {
  assert.equal(normalizeRunPath('D:\\proj\\src\\main.cpp', 'D:\\proj'), 'src/main.cpp')
  assert.equal(normalizeRunPath('d:/proj/src/a.ts', 'D:/proj'), 'src/a.ts')
  assert.equal(normalizeRunPath('./src/a.ts', ''), 'src/a.ts')
  assert.equal(normalizeRunPath('other/file.txt', 'D:/proj'), 'other/file.txt')
})

test('CMake errors point at the CMakeLists line', () => {
  const issue = parseCmakeIssue('CMake Error at CMakeLists.txt:12 (add_executable): Target name conflict')
  assert.deepEqual(issue, { path: 'CMakeLists.txt', line: 12, column: 1 })
})

test('parseAnyIssue routes through both parsers and normalizes', () => {
  assert.deepEqual(parseAnyIssue('src/x.cpp(3,1): error C2065: y', 'D:/p'), { path: 'src/x.cpp', line: 3, column: 1 })
  assert.deepEqual(parseAnyIssue('CMake Error at CMakeLists.txt:4 (x): bad', 'D:/p'), { path: 'CMakeLists.txt', line: 4, column: 1 })
  assert.equal(parseAnyIssue('nothing here', 'D:/p'), null)
})
