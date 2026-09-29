import test from 'node:test'
import assert from 'node:assert/strict'
import {
  compileScope, compileScopeText, convertModulePattern, convertToRegexp, excludeFrom, includeInto,
  lexScope, scopeMatches, scopePriority, scopeText, intersectionOf, unionOf,
} from '../src/scopes.ts'

// _ScopesLexer.flex:20-46 —— 每个返回类型都要有对应 token，且**空白不跳过**。
test('the lexer reproduces every flex rule, whitespace included', () => {
  assert.deepEqual(lexScope('file:*.cpp||file:*.h').map(t => t.kind),
    ['identifier', 'colon', 'asterisk', 'dot', 'identifier', 'oror', 'identifier', 'colon', 'asterisk', 'dot', 'identifier'])
  assert.deepEqual(lexScope('a && b').map(t => t.kind),
    ['identifier', 'whitespace', 'andand', 'whitespace', 'identifier'], 'a space is a token of its own')
  assert.deepEqual(lexScope('a\tb').map(t => t.text), ['a', '\t', 'b'])
  assert.deepEqual(lexScope('!x~y-z#w').map(t => t.kind),
    ['excl', 'identifier', 'tilde', 'identifier', 'minus', 'identifier', 'sharp', 'identifier'])
  assert.deepEqual(lexScope('12[()]').map(t => t.kind),
    ['integer', 'lbracket', 'lparenth', 'rparenth', 'rbracket'])
  assert.deepEqual(lexScope('$name').map(t => [t.kind, t.text]), [['identifier', '$name']])
  assert.deepEqual(lexScope('$').map(t => [t.kind, t.text]), [['identifier', '$']], '"$" alone is an IDENTIFIER in the flex file')
  // `<YYINITIAL> [^] { return BAD_CHARACTER; }` —— a lone & or | has no rule of its own.
  assert.deepEqual(lexScope('&|?').map(t => t.kind), ['bad', 'bad', 'bad'])
  const tokens = lexScope('a b')
  assert.deepEqual(tokens.map(t => [t.start, t.end]), [[0, 1], [1, 2], [2, 3]], 'offsets are UTF-16 indices')
})

// FilePatternPackageSet.java:73-120 —— traced branch by branch.
test('convertToRegexp follows the source character by character', () => {
  // A single '*' that is not immediately followed by another '*' is flushed as ".*".
  assert.equal(convertToRegexp('*.cpp'), '.*\\.cpp')
  // Two consecutive '*' collapse into a segment-bounded run; the source escapes the
  // separator even inside the class (`buf.append("[^\\").append(separator)`).
  assert.equal(convertToRegexp('a**b'), 'a[^\\/]*b')
  // A trailing single '*' is flushed at the end of the loop (:115-117).
  assert.equal(convertToRegexp('*'), '[^\\/]*')
  // A single separator is escaped; a doubled one means "recursive" (:99-106).
  assert.equal(convertToRegexp('src/main/*.cpp'), 'src\\/main\\/.*\\.cpp')
  assert.equal(convertToRegexp('src//*'), 'src\\/(.*\\/)?[^\\/]*')
  // `*/` : the '*' is flushed by the separator that follows, leaving ".*".
  assert.equal(convertToRegexp('*/'), '.*')
  assert.equal(convertToRegexp('#a'), '#a')
})

// PatternBasedPackageSet.java:72-88
test('module patterns escape everything except letters, digits, spaces and *', () => {
  assert.equal(convertModulePattern('My Mod'), 'My Mod')
  assert.equal(convertModulePattern('a*b'), 'a.*b')
  assert.equal(convertModulePattern('a.b'), 'a\\.b')
  assert.equal(convertModulePattern('a-b'), 'a\\-b')
})

// PackageSetFactoryImpl.Parser + FilePackageSetParserExtension
test('the parser builds the same node tree as the source', () => {
  assert.deepEqual(compileScope('file:*.cpp'),
    { kind: 'file', modulePattern: null, pattern: '*.cpp', projectFiles: true })
  assert.deepEqual(compileScope('ext:*.jar'),
    { kind: 'file', modulePattern: null, pattern: '*.jar', projectFiles: false }, 'ext: means "not project files"')
  assert.deepEqual(compileScope('file[Src]:*.cpp'),
    { kind: 'file', modulePattern: 'Src', pattern: '*.cpp', projectFiles: true })
  assert.deepEqual(compileScope('projectPath:src//*'),
    { kind: 'projectPath', pattern: 'src//*' })
  assert.deepEqual(compileScope('$other'), { kind: 'named', name: 'other' })

  const union = compileScope('file:a||file:b')
  assert.equal(union.kind, 'union')
  assert.equal(scopeText(union), 'file:a||file:b')

  const intersection = compileScope('file:a&&file:b')
  assert.equal(intersection.kind, 'intersection')

  // `!` binds tighter than `&&`, which binds tighter than `||` (:87-122).
  const nested = compileScope('!file:a&&file:b||file:c')
  assert.equal(nested.kind, 'union')
  assert.equal(nested.sets[0].kind, 'intersection')
  assert.equal(nested.sets[0].sets[0].kind, 'complement')
  assert.equal(scopeText(nested), '!file:a&&file:b||file:c')

  // Parentheses regroup and are re-emitted because the union's priority (3) beats the intersection's (2).
  const grouped = compileScope('(file:a||file:b)&&file:c')
  assert.equal(scopeText(grouped), '(file:a||file:b)&&file:c')
  assert.equal(scopeText(compileScope('!(file:a||file:b)')), '!(file:a||file:b)')
  assert.equal(scopeText(compileScope('!file:a')), '!file:a')
  assert.equal(scopeText(compileScope('ext[Lib]:*/')), 'ext[Lib]:*/')
  assert.equal(scopeText(compileScope('file[My Mod]:a/*.b-c~d#e')), 'file[My Mod]:a/*.b-c~d#e')
  assert.equal(scopeText(compileScope('file:a||file:b||file:c')), 'file:a||file:b||file:c')
})

// ParsingException messages carry the 1-based position (PackageSetFactoryImpl.java:207-210).
test('parse failures report the source position', () => {
  const unknown = compileScopeText('bogus:x')
  assert.equal(unknown.error, 'Unknown scope type at position 1')
  assert.equal(unknown.position, 1)
  assert.deepEqual(unknown.set, { kind: 'invalid', text: 'bogus:x' })

  // The whitespace after `*.cpp` is swallowed into the pattern, so the next term starts on a space.
  const spaced = compileScopeText('file:*.cpp && file:*.h')
  assert.equal(spaced.error, 'Unknown scope type at position 14')

  assert.equal(compileScopeText('file:').error, 'Package pattern expected at position 6')
  assert.equal(compileScopeText('file:(a)').error, 'Package pattern expected at position 6')
  assert.equal(compileScopeText('(file:a').error, "')' expected at position 8")
  assert.equal(compileScopeText('file:a file:b').error, "Unexpected ':' at position 12")
  assert.equal(compileScopeText('file:a@b').error, "Unexpected '@' at position 7")

  // An empty pattern field is not an error: it is an empty InvalidPackageSet (:436-442).
  const empty = compileScopeText('')
  assert.equal(empty.error, null)
  assert.deepEqual(empty.set, { kind: 'invalid', text: '' })
})

// InvalidPackageSet.java:16-18 + AbstractPackageSet.java:14-21 — priority 1, never matches.
test('an invalid scope has priority 1 and matches nothing', () => {
  const invalid = { kind: 'invalid', text: 'file:' }
  assert.equal(scopePriority(invalid), 1)
  assert.equal(scopeMatches(invalid, 'a.cpp'), false)
  assert.equal(scopeText(invalid), 'file:')
})

test('node priorities match getNodePriority()', () => {
  assert.equal(scopePriority(compileScope('file:a')), 0)
  assert.equal(scopePriority(compileScope('projectPath:a')), 0)
  assert.equal(scopePriority(compileScope('$a')), 0)
  assert.equal(scopePriority(compileScope('!file:a')), 1)
  assert.equal(scopePriority(compileScope('file:a&&file:b')), 2)
  assert.equal(scopePriority(compileScope('file:a||file:b')), 3)
})

// FilePatternPackageSet.java:49-71 + PatternBasedPackageSet.java:44-58
test('file patterns match content-root-relative paths', () => {
  const cpp = compileScope('file:*.cpp')
  // A single '*' becomes ".*", so it spans separators.
  assert.equal(scopeMatches(cpp, 'a.cpp'), true)
  assert.equal(scopeMatches(cpp, 'src/main/a.cpp'), true)
  assert.equal(scopeMatches(cpp, 'a.h'), false)

  const source = compileScope('file:src//*')
  assert.equal(scopeMatches(source, 'src/a.cpp'), true)
  assert.equal(scopeMatches(source, 'src/x/y.cpp'), true, '// is recursive')
  assert.equal(scopeMatches(source, 'src'), false, 'the directory itself only matches with the trailing slash')
  assert.equal(scopeMatches(source, 'src', true), true)
  assert.equal(scopeMatches(source, 'other/a.cpp'), false)

  const shallow = compileScope('file:src/*')
  assert.equal(scopeMatches(shallow, 'src/a.cpp'), true)
  assert.equal(scopeMatches(shallow, 'src/x/y.cpp'), false, 'a single / is not recursive')
})

test('module patterns are matched against the single implicit module', () => {
  const context = { moduleName: 'TaoCode' }
  assert.equal(scopeMatches(compileScope('file[TaoCode]:*.cpp'), 'a.cpp', false, context), true)
  assert.equal(scopeMatches(compileScope('file[TaoC*]:*.cpp'), 'a.cpp', false, context), true, '* spans the module name')
  assert.equal(scopeMatches(compileScope('file[Other]:*.cpp'), 'a.cpp', false, context), false)
  assert.equal(scopeMatches(compileScope('file[Other]:*.cpp'), 'a.cpp'), false, 'no module name known means no match')
  assert.equal(scopeMatches(compileScope('file:*.cpp'), 'a.cpp'), true, 'no module pattern means "any module"')
})

test('ext: never matches because project files are always in content', () => {
  assert.equal(scopeMatches(compileScope('ext:*.jar'), 'lib/a.jar'), false)
})

test('projectPath patterns use the project base directory and drop a leading slash', () => {
  assert.equal(scopeMatches(compileScope('projectPath:src/*'), 'src/a.cpp'), true)
  assert.equal(scopeMatches(compileScope('projectPath:/src/*'), 'src/a.cpp'), true, 'a leading / is trimmed')
  assert.equal(scopeMatches(compileScope('projectPath:src/*'), 'src/x/y.cpp'), false)
})

test('union, intersection and complement evaluate like the source', () => {
  const union = compileScope('file:*.cpp||file:*.h')
  assert.equal(scopeMatches(union, 'a.h'), true)
  assert.equal(scopeMatches(union, 'a.cpp'), true)
  assert.equal(scopeMatches(union, 'a.txt'), false)

  const intersection = compileScope('file:*.cpp&&file:src//*')
  assert.equal(scopeMatches(intersection, 'src/a.cpp'), true)
  assert.equal(scopeMatches(intersection, 'other/a.cpp'), false)
  assert.equal(scopeMatches(intersection, 'src/a.h'), false)

  const complement = compileScope('file:*.cpp&&!file:test//*')
  assert.equal(scopeMatches(complement, 'src/a.cpp'), true)
  assert.equal(scopeMatches(complement, 'test/a.cpp'), false)
})

test('$name resolves through the scope table and survives cycles', () => {
  const cpp = compileScope('file:*.cpp')
  const context = { lookup: name => (name === 'cpp' ? cpp : null) }
  assert.equal(scopeMatches(compileScope('$cpp'), 'a.cpp', false, context), true)
  assert.equal(scopeMatches(compileScope('$cpp'), 'a.h', false, context), false)
  assert.equal(scopeMatches(compileScope('$missing'), 'a.cpp', false, context), false, 'an unresolved reference matches nothing')

  const self = { kind: 'named', name: 'loop' }
  assert.equal(scopeMatches(self, 'a.cpp', false, { lookup: () => self }), false, 'a self-reference must not recurse forever')
})

// ScopeEditorPanel.java:583-609 / :545-574
test('Include and Exclude merge patterns the way the source does', () => {
  const a = compileScope('file:a')
  const b = compileScope('file:b')

  assert.equal(includeInto(null, a), a, 'the first Include is just the pattern')
  assert.equal(scopeText(includeInto(a, b)), 'file:a||file:b')
  assert.equal(scopeText(excludeFrom(null, a)), '!file:a')
  assert.equal(scopeText(excludeFrom(b, a)), 'file:b&&!file:a')
  assert.equal(scopeText(excludeFrom(compileScope('file:a||file:b'), a)), 'file:b', 'a union member is dropped')
  // Including a member of an AND rebuilds a UNION (:602-605 always creates a UnionPackageSet),
  // which is exactly what IDEA does — the surviving term plus the newly included one.
  assert.equal(scopeText(includeInto(compileScope('file:a&&file:b'), a)), 'file:b||file:a')

  // Including exactly what was excluded cancels the rule out (processComplementaryScope :616-622).
  assert.equal(includeInto(compileScope('!file:a'), a), null)
  // Excluding exactly what the scope is leaves nothing (:623-628).
  assert.equal(excludeFrom(a, a), null)
  // Cancelling one member of a union leaves the rest.
  assert.equal(scopeText(includeInto(compileScope('file:a||!file:b'), b)), 'file:a')
  // An empty InvalidPackageSet is replaced, a non-empty one is unioned with (:589-591).
  assert.equal(scopeText(includeInto({ kind: 'invalid', text: '' }, a)), 'file:a')
  assert.equal(scopeText(includeInto({ kind: 'invalid', text: 'junk' }, a)), 'junk||file:a')
  assert.equal(scopeText(excludeFrom({ kind: 'invalid', text: '' }, a)), '!file:a')
  assert.equal(scopeText(excludeFrom({ kind: 'invalid', text: 'junk' }, a)), 'junk&&!file:a')
  // unionOf/intersectionOf collapse a single element (UnionPackageSet.java:14-17).
  assert.equal(unionOf([a]), a)
  assert.equal(intersectionOf([a, b]).kind, 'intersection')
  assert.throws(() => unionOf([]))
})
