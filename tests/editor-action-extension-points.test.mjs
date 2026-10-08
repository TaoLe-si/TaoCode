// 判据 · **编辑器动作的扩展点**（`src/editorActionExtensionPoints.ts`，上游
// `com.intellij.typedHandler` / `braceMatcher` / `lang.braceMatcher` / `enterHandlerDelegate` /
// `backspaceHandlerDelegate` 五条 EP）。
//
// 钉四件事：
//   ① 五条 EP 的 id 与上游 qualifiedName / EP_NAME 逐字一致，且已在宿主里声明；
//   ② 贡献者按 id 注册/注销生效、按语言/文件类型过滤（空视为通吃）；
//   ③ 消费面真的读 EP：`dispatchTypedHandler` 首个非 CONTINUE 说了算、
//      `dispatchEnterDelegate` 首个非 Continue 说了算、`dispatchBackspaceAfter` 任一为真即真、
//      `bracePairsFor` 两条 EP 合起来去重；
//   ④ bundled 贡献（`()[]{}` 文件类型对 + Java `<>` 语言对 + 三支 passthrough）真的能被消费点拿到。
import test from 'node:test'
import assert from 'node:assert/strict'

import { EXTENSIONS, APPLICATION_SCOPE } from '../src/extensionPoints.ts'
import {
  BACKSPACE_HANDLER_DELEGATE_EP,
  BRACE_MATCHER_EP,
  BUNDLED_BACKSPACE_HANDLER_ID,
  BUNDLED_ENTER_HANDLER_ID,
  BUNDLED_FILE_TYPE_BRACE_MATCHER_ID,
  BUNDLED_LANGUAGE_BRACE_MATCHER_ID,
  BUNDLED_TYPED_HANDLER_ID,
  ENTER_HANDLER_DELEGATE_EP,
  LANGUAGE_BRACE_MATCHER_EP,
  TYPED_HANDLER_EP,
  backspaceHandlerDelegates,
  braceMatchersFor,
  bracePairsFor,
  builtinFileTypeBraceMatcher,
  builtinJavaAngleBraceMatcher,
  dispatchBackspaceAfter,
  dispatchBackspaceBefore,
  dispatchEnterDelegate,
  dispatchTypedHandler,
  enterHandlerDelegates,
  fileTypeOfLanguage,
  immediatePaintingEnabled,
  isRegisteredBracePair,
  notifyEnterPostProcess,
  notifyTypingStarted,
  pairedBraceMatchersFor,
  registerBackspaceHandlerDelegate,
  registerBraceMatcher,
  registerEnterHandlerDelegate,
  registerPairedBraceMatcher,
  registerTypedHandlerDelegate,
  typedHandlerDelegates,
} from '../src/editorActionExtensionPoints.ts'

const typedInput = (over = {}) => ({
  path: 'src/Sample.ts', language: 'typescript', fileType: 'TypeScript',
  text: 'const a = 1', line: 0, character: 9, char: 'x', ...over,
})
const enterInput = (over = {}) => ({
  path: 'src/Sample.java', language: 'java', text: 'int a;', offset: 6, line: 0, character: 6, ...over,
})
const backspaceInput = (over = {}) => ({
  path: 'src/Sample.java', language: 'java', text: 'f()', offset: 2, line: 0, character: 2, char: '(', ...over,
})

test('五条 EP 已声明，id 与上游 qualifiedName / EP_NAME 逐字一致', () => {
  assert.equal(TYPED_HANDLER_EP, 'com.intellij.typedHandler')
  assert.equal(BRACE_MATCHER_EP, 'com.intellij.braceMatcher')
  assert.equal(LANGUAGE_BRACE_MATCHER_EP, 'com.intellij.lang.braceMatcher')
  assert.equal(ENTER_HANDLER_DELEGATE_EP, 'com.intellij.enterHandlerDelegate')
  assert.equal(BACKSPACE_HANDLER_DELEGATE_EP, 'com.intellij.backspaceHandlerDelegate')
  for (const id of [
    TYPED_HANDLER_EP, BRACE_MATCHER_EP, LANGUAGE_BRACE_MATCHER_EP,
    ENTER_HANDLER_DELEGATE_EP, BACKSPACE_HANDLER_DELEGATE_EP,
  ]) {
    assert.equal(EXTENSIONS.hasExtensionPoint(id), true, `${id} 未声明`)
  }
})

test('字符输入委托：按语言过滤，首个非 CONTINUE 说了算', () => {
  const ts = registerTypedHandlerDelegate({
    id: 'demo.typed.ts', languages: ['typescript'],
    charTyped: input => input.char === '}' ? 'STOP' : 'CONTINUE',
  })
  const any = registerTypedHandlerDelegate({
    id: 'demo.typed.any', charTyped: () => 'DEFAULT',
  })
  try {
    assert.ok(typedHandlerDelegates('typescript').some(d => d.id === 'demo.typed.ts'))
    assert.equal(typedHandlerDelegates('java').some(d => d.id === 'demo.typed.ts'), false)
    assert.equal(dispatchTypedHandler(typedInput({ char: '}' }), 'charTyped'), 'STOP')
    // 只有 java 委托返回 DEFAULT，ts 那条继续说 CONTINUE ⇒ 整体 DEFAULT
    assert.equal(dispatchTypedHandler(typedInput({ char: 'x' }), 'charTyped'), 'DEFAULT')
  } finally {
    ts.dispose(); any.dispose()
  }
  assert.equal(typedHandlerDelegates('typescript').some(d => d.id === 'demo.typed.ts'), false)
})

test('newTypingStarted 逐个通知；isImmediatePaintingEnabled 任一为真即真', () => {
  const started = []
  const a = registerTypedHandlerDelegate({
    id: 'demo.typed.notify', newTypingStarted: input => { started.push(input.char) },
    isImmediatePaintingEnabled: () => true,
  })
  try {
    assert.equal(notifyTypingStarted(typedInput({ char: 'q' })), 1)
    assert.deepEqual(started, ['q'])
    assert.equal(immediatePaintingEnabled(typedInput()), true)
  } finally { a.dispose() }
  assert.equal(immediatePaintingEnabled(typedInput()), false)
})

test('括号对：文件类型 EP 与语言 EP 合起来去重，trim 掉没填全的对', () => {
  const fileType = registerBraceMatcher({
    id: 'demo.brace.fileType', fileType: 'TypeScript',
    getPairs: () => [
      { leftBrace: '${', rightBrace: '}', structural: false },
      { leftBrace: '(', rightBrace: ')', structural: false }, // 与 bundled 重复，应去重
      { leftBrace: '', rightBrace: ']', structural: true },    // 缺左 ⇒ 丢弃
    ],
  })
  const language = registerPairedBraceMatcher({
    id: 'demo.brace.language', language: 'typescript',
    getPairs: () => [{ leftBrace: '<<', rightBrace: '>>', structural: false }],
  })
  try {
    assert.equal(braceMatchersFor('TypeScript').some(m => m.id === 'demo.brace.fileType'), true)
    assert.equal(braceMatchersFor('CPLUSPLUS').some(m => m.id === 'demo.brace.fileType'), false)
    assert.equal(pairedBraceMatchersFor('typescript').some(m => m.id === 'demo.brace.language'), true)

    const pairs = bracePairsFor({ language: 'typescript', fileType: 'TypeScript' })
    const keys = pairs.map(p => `${p.leftBrace}${p.rightBrace}`)
    assert.ok(keys.includes('${}'))
    assert.ok(keys.includes('<<>>'))
    assert.equal(keys.filter(k => k === '()').length, 1, '重复的 () 应去重')
    assert.equal(keys.includes(']'), false, '缺左括号的对应被丢弃')
    assert.equal(isRegisteredBracePair('<<', '>>', { language: 'typescript' }), true)
    assert.equal(isRegisteredBracePair('<', '>', { language: 'typescript' }), false)
    assert.equal(isRegisteredBracePair('<', '>', { language: 'java' }), true)
    assert.equal(isRegisteredBracePair('{', ']', { language: 'typescript' }), false)
  } finally {
    fileType.dispose(); language.dispose()
  }
})

test('回车委托：首个非 Continue 说了算，Stop/ForceIndent 原样返回；postProcess 通知', () => {
  const first = registerEnterHandlerDelegate({
    id: 'demo.enter.first', languages: ['java'],
    preprocessEnter: () => ({ result: 'Continue' }),
  })
  const second = registerEnterHandlerDelegate({
    id: 'demo.enter.second', languages: ['java'],
    preprocessEnter: () => ({ result: 'DefaultForceIndent', caretAdvance: 2 }),
  })
  const posts = []
  const poster = registerEnterHandlerDelegate({
    id: 'demo.enter.post', languages: ['java'],
    preprocessEnter: () => ({ result: 'Continue' }),
    postProcessEnter: () => { posts.push('x') },
  })
  try {
    assert.ok(enterHandlerDelegates('java').some(d => d.id === 'demo.enter.second'))
    const hit = dispatchEnterDelegate(enterInput())
    assert.equal(hit?.delegate.id, 'demo.enter.second')
    assert.equal(hit?.result, 'DefaultForceIndent')
    assert.equal(hit?.caretAdvance, 2)
    assert.equal(dispatchEnterDelegate(enterInput({ language: 'typescript' }))?.delegate.id, undefined)
    assert.equal(notifyEnterPostProcess(enterInput()), 1)
    assert.deepEqual(posts, ['x'])
  } finally {
    first.dispose(); second.dispose(); poster.dispose()
  }
})

test('退格委托：beforeCharDeleted 逐个通知，charDeleted 任一为真即真', () => {
  const before = []
  const a = registerBackspaceHandlerDelegate({
    id: 'demo.backspace.a', languages: ['java'],
    beforeCharDeleted: input => { before.push(input.char) },
    charDeleted: input => input.char === '(',
  })
  const b = registerBackspaceHandlerDelegate({
    id: 'demo.backspace.b', languages: ['java'], charDeleted: () => false,
  })
  try {
    assert.ok(backspaceHandlerDelegates('java').some(d => d.id === 'demo.backspace.a'))
    assert.equal(dispatchBackspaceBefore(backspaceInput()), 1)
    assert.deepEqual(before, ['('])
    assert.equal(dispatchBackspaceAfter(backspaceInput({ char: '(' })), true)
    assert.equal(dispatchBackspaceAfter(backspaceInput({ char: 'x' })), false)
  } finally {
    a.dispose(); b.dispose()
  }
  assert.equal(dispatchBackspaceAfter(backspaceInput()), false)
})

test('bundled 五条贡献挂上后消费点真的拿到', () => {
  assert.ok(braceMatchersFor('JAVA').some(m => m.id === BUNDLED_FILE_TYPE_BRACE_MATCHER_ID))
  assert.ok(pairedBraceMatchersFor('java').some(m => m.id === BUNDLED_LANGUAGE_BRACE_MATCHER_ID))
  assert.ok(typedHandlerDelegates('java').some(d => d.id === BUNDLED_TYPED_HANDLER_ID))
  assert.ok(enterHandlerDelegates('java').some(d => d.id === BUNDLED_ENTER_HANDLER_ID))
  assert.ok(backspaceHandlerDelegates('java').some(d => d.id === BUNDLED_BACKSPACE_HANDLER_ID))

  // 内建文件类型对 `()[]{}` 真的进了合并表
  const keys = bracePairsFor({ language: 'java', fileType: 'JAVA' }).map(p => `${p.leftBrace}${p.rightBrace}`)
  for (const key of ['()', '[]', '{}', '<>']) assert.ok(keys.includes(key), `缺少括号对 ${key}`)

  // 内建三支 passthrough 不改变原有行为（都 CONTINUE/不接管 ⇒ 派发回落到 DEFAULT/false）
  assert.equal(dispatchTypedHandler(typedInput({ language: 'other', char: 'z' }), 'charTyped'), 'DEFAULT')
  assert.equal(dispatchBackspaceAfter(backspaceInput({ language: 'other' })), false)
})

test('语言 → fileType 的粗映射与内建构造器（白盒）', () => {
  assert.equal(fileTypeOfLanguage('java'), 'JAVA')
  assert.equal(fileTypeOfLanguage('cpp'), 'CPLUSPLUS')
  assert.equal(fileTypeOfLanguage('typescript'), 'TypeScript')
  assert.equal(fileTypeOfLanguage('other'), 'PLAIN_TEXT')
  assert.equal(fileTypeOfLanguage(undefined), 'PLAIN_TEXT')

  const fileType = builtinFileTypeBraceMatcher()
  assert.equal(fileType.isLBraceToken('('), true)
  assert.equal(fileType.isRBraceToken(')'), true)
  assert.equal(fileType.getOppositeBraceTokenType('('), ')')
  assert.equal(fileType.getOppositeBraceTokenType('<'), null)
  assert.equal(fileType.isPairBraces('{', '}'), true)
  assert.equal(fileType.isPairBraces('(', ']'), false)
  assert.equal(builtinJavaAngleBraceMatcher().getPairs().length, 4)
})
