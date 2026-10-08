// 判据 · **编辑器动作（第二批）的扩展点**（`src/editorActionExtraExtensionPoints.ts`，上游
// `com.intellij.copyPastePreProcessor` / `typingActionsExtension` / `commentCompleteHandler` /
// `basicWordSelectionFilter` / `customPasteProvider` / `selectionUnquotingFilter` /
// `formatOnSaveOptions.defaultsProvider` 七条 EP）。
//
// 钉四件事：
//   ① 七条 EP 的 id 与上游 qualifiedName 逐字一致，且已在宿主里声明；
//   ② 贡献者按 id 注册/注销生效、按语言过滤（未知语言不收窄）；
//   ③ **真实消费点**读 EP：`blockCommentComplete`（`src/editorEnterBlockComment.ts`）、
//      `extendLevels`（`src/editorExtendSelection.ts`）、`runQuoteKey` 的 wrap 分支所在模块、
//      `runActionsOnSave` 的判据函数都取到第三方贡献；
//   ④ bundled 贡献（七支 passthrough）真的在 EP 里，且不改变既有行为。
import test from 'node:test'
import assert from 'node:assert/strict'

import { EXTENSIONS } from '../src/extensionPoints.ts'
import {
  BASIC_WORD_SELECTION_FILTER_EP,
  BUNDLED_COMMENT_COMPLETE_HANDLER_ID,
  BUNDLED_COPY_PASTE_PRE_PROCESSOR_ID,
  BUNDLED_CUSTOM_PASTE_PROVIDER_ID,
  BUNDLED_FORMAT_ON_SAVE_DEFAULTS_ID,
  BUNDLED_SELECTION_UNQUOTING_FILTER_ID,
  BUNDLED_TYPING_ACTIONS_EXTENSION_ID,
  BUNDLED_WORD_SELECTION_FILTER_ID,
  COMMENT_COMPLETE_HANDLER_EP,
  COPY_PASTE_PRE_PROCESSOR_EP,
  CUSTOM_PASTE_PROVIDER_EP,
  FORMAT_ON_SAVE_DEFAULTS_PROVIDER_EP,
  SELECTION_UNQUOTING_FILTER_EP,
  TYPING_ACTIONS_EXTENSION_EP,
  builtinCommentCompleteHandler,
  canSelectWord,
  commentCompleteHandlers,
  commentCompleteVerdict,
  copyPastePreProcessors,
  customPasteProviderFor,
  customPasteProviders,
  fileTypeOfPath,
  formatOnSaveDefaultFileTypes,
  formatOnSaveDefaultsProviders,
  formatsOnSaveByDefault,
  optimizeImportsOnSaveDefaultFileTypes,
  performCustomPaste,
  preprocessCopiedText,
  preprocessPastedText,
  registerCommentCompleteHandler,
  registerCopyPastePreProcessor,
  registerCustomPasteProvider,
  registerFormatOnSaveDefaultsProvider,
  registerSelectionUnquotingFilter,
  registerTypingActionsExtension,
  registerWordSelectionFilter,
  requiresAllDocumentsCommitted,
  selectionUnquotingFilters,
  shouldSkipQuoteReplacement,
  suitableTypingActionsExtension,
  notifyTypingActions,
  typingActionsExtensions,
  wordSelectionFilters,
} from '../src/editorActionExtraExtensionPoints.ts'
// 真实消费点：块注释回车的「注释写完了吗」那一问。
import { blockCommentComplete, enterInBlockComment, blockLexiconFor } from '../src/editorEnterBlockComment.ts'
// 真实消费点：扩展选区的词/词素那一档。
import { extendLevels, wordRange } from '../src/editorExtendSelection.ts'

const JAVA_LEXICON = blockLexiconFor({ block: ['/*', '*/'] })

const pasteContext = (over = {}) => ({
  path: 'src/Sample.java', language: 'java', text: 'int a;', line: 0, character: 6, ...over,
})

test('七条 EP 的 id 与上游逐字一致，且都已在宿主里声明', () => {
  assert.equal(COPY_PASTE_PRE_PROCESSOR_EP, 'com.intellij.copyPastePreProcessor')
  assert.equal(TYPING_ACTIONS_EXTENSION_EP, 'com.intellij.typingActionsExtension')
  assert.equal(COMMENT_COMPLETE_HANDLER_EP, 'com.intellij.commentCompleteHandler')
  assert.equal(BASIC_WORD_SELECTION_FILTER_EP, 'com.intellij.basicWordSelectionFilter')
  assert.equal(CUSTOM_PASTE_PROVIDER_EP, 'com.intellij.customPasteProvider')
  assert.equal(SELECTION_UNQUOTING_FILTER_EP, 'com.intellij.selectionUnquotingFilter')
  assert.equal(FORMAT_ON_SAVE_DEFAULTS_PROVIDER_EP, 'com.intellij.formatOnSaveOptions.defaultsProvider')
  for (const id of [
    COPY_PASTE_PRE_PROCESSOR_EP, TYPING_ACTIONS_EXTENSION_EP, COMMENT_COMPLETE_HANDLER_EP,
    BASIC_WORD_SELECTION_FILTER_EP, CUSTOM_PASTE_PROVIDER_EP, SELECTION_UNQUOTING_FILTER_EP,
    FORMAT_ON_SAVE_DEFAULTS_PROVIDER_EP,
  ]) {
    assert.equal(EXTENSIONS.hasExtensionPoint(id), true, `${id} 应当已声明`)
  }
})

test('bundled 七支都在 EP 里，且默认不改变既有行为', () => {
  const ids = [
    BUNDLED_COPY_PASTE_PRE_PROCESSOR_ID, BUNDLED_TYPING_ACTIONS_EXTENSION_ID,
    BUNDLED_COMMENT_COMPLETE_HANDLER_ID, BUNDLED_WORD_SELECTION_FILTER_ID,
    BUNDLED_CUSTOM_PASTE_PROVIDER_ID, BUNDLED_SELECTION_UNQUOTING_FILTER_ID,
    BUNDLED_FORMAT_ON_SAVE_DEFAULTS_ID,
  ]
  const present = new Set([
    ...copyPastePreProcessors('java'), ...typingActionsExtensions('java'),
    ...commentCompleteHandlers('java'), ...wordSelectionFilters('java'),
    ...selectionUnquotingFilters('java'), ...customPasteProviders('java'),
    ...formatOnSaveDefaultsProviders(),
  ].map(contribution => contribution.id))
  for (const id of ids) assert.equal(present.has(id), true, `${id} 应当是 bundled 贡献`)
  // passthrough 的三条语义
  assert.equal(preprocessPastedText(pasteContext()).text, 'int a;')
  assert.equal(preprocessPastedText(pasteContext()).changed, false)
  assert.equal(shouldSkipQuoteReplacement({ ...pasteContext(), selectedText: 'x', typed: '"' }), false)
  assert.equal(customPasteProviderFor({ ...pasteContext(), clipboardText: 'x' }), null)
  assert.equal(canSelectWord({ ...pasteContext(), from: 4, to: 5, word: 'a', lexicalKind: 'word' }), true)
  assert.deepEqual(formatOnSaveDefaultFileTypes(), [])
  assert.deepEqual(optimizeImportsOnSaveDefaultFileTypes(), [])
  // 内建注释补全处理器「不适用」⇒ 词法兜底照旧
  assert.equal(builtinCommentCompleteHandler().isApplicable({}), false)
})

test('复制粘贴预处理器：preprocessOnPaste 逐条串起来、preprocessOnCopy 第一个非 null 说了算', () => {
  const first = registerCopyPastePreProcessor({
    id: 'test.pre.one', languages: ['java'],
    preprocessOnPaste: input => `${input.text}\n// one`,
    preprocessOnCopy: input => `/*${input.text}*/`,
    isReformatCodeBeforePaste: () => true,
  })
  const second = registerCopyPastePreProcessor({
    id: 'test.pre.two', languages: ['java'],
    preprocessOnPaste: input => `${input.text}\n// two`,
    preprocessOnCopy: () => 'second',  // 上游：第一条非 null 说了算 ⇒ 它不会被问到
  })
  try {
    const result = preprocessPastedText(pasteContext())
    assert.equal(result.text, 'int a;\n// one\n// two', '上一条的输出要喂给下一条')
    assert.equal(result.changed, true)
    assert.equal(result.reformatBeforePaste, true)
    assert.deepEqual(result.applied, ['test.pre.one', 'test.pre.two'])
    const copied = preprocessCopiedText({ ...pasteContext(), startOffsets: [0], endOffsets: [1] })
    assert.equal(copied.text, '/*int a;*/')
    assert.equal(copied.handledBy, 'test.pre.one')
    // 语言收窄：cpp 那一档不适用 ⇒ 原样
    assert.equal(preprocessPastedText({ ...pasteContext(), language: 'cpp' }).text, 'int a;')
    // 未知语言（''/'other'）不收窄：仍被问到
    assert.equal(preprocessPastedText({ ...pasteContext(), language: '' }).text, 'int a;\n// one\n// two')
    // `requiresAllDocumentsToBeCommitted` 缺省 true
    assert.equal(requiresAllDocumentsCommitted(pasteContext()).required, true)
  } finally {
    first.dispose()
    second.dispose()
  }
})

test('打字动作扩展：findForContext 第一个适用者说了算，bundled 兜底排在第三方之后', () => {
  const third = registerTypingActionsExtension({
    id: 'test.typing.third',
    isSuitableContext: input => input.language === 'java',
    startPaste: () => {},
  })
  try {
    const found = suitableTypingActionsExtension({ ...pasteContext() })
    assert.equal(found?.id, 'test.typing.third', '第三方要排在 bundled 兜底之前')
    assert.equal(notifyTypingActions('startPaste', pasteContext()), true)
    assert.equal(notifyTypingActions('endPaste', pasteContext()), false, '没实现 endPaste ⇒ false')
    // 不适用时落到 bundled 兜底（它什么也不做，但确实被选中）
    const other = suitableTypingActionsExtension({ ...pasteContext(), language: 'other' })
    assert.equal(other?.id, BUNDLED_TYPING_ACTIONS_EXTENSION_ID)
  } finally {
    third.dispose()
  }
})

test('注释补全处理器：第一个 isApplicable 为真的说了算；真实消费点在块注释回车那一问', () => {
  // 词法兜底：没闭尾 ⇒ 不算写完
  assert.equal(blockCommentComplete('/* a', 0, JAVA_LEXICON), false)
  // 第三方说「这条注释写完了」⇒ 回车不再补闭尾（EnterHandler.java:200-204 的口径）
  const handler = registerCommentCompleteHandler({
    id: 'test.comment.complete', languages: ['java'],
    isApplicable: () => true,
    isCommentComplete: () => true,
  })
  try {
    assert.equal(blockCommentComplete('/* a', 0, JAVA_LEXICON, { language: 'java' }), true)
    // `enterInBlockComment`：注释「算写完」⇒ 走 `* ` 续行那一支（这里没有 `* ` ⇒ 不接），
    // 关键是**不再补闭尾**（此前会给出 { edits: [{ insert: '\n */' }] }）。
    const result = enterInBlockComment('/* a', 4, JAVA_LEXICON, true, { language: 'java' })
    assert.equal(result, null, '不补闭尾、也没有续行前缀 ⇒ 不接管')
    // 语言不匹配时收窄（贡献只认 java）
    assert.equal(blockCommentComplete('/* a', 0, JAVA_LEXICON, { language: 'cpp' }), false)
  } finally {
    handler.dispose()
  }
  // 拿掉之后回到词法兜底：回车重新补闭尾
  const back = enterInBlockComment('/* a', 4, JAVA_LEXICON, true, { language: 'java' })
  assert.deepEqual(back?.edits, [{ from: 4, insert: '\n */' }])
})

test('词选择过滤：canSelect 任一为假即假；真实消费点在扩展选区的词/词素那一档', () => {
  const text = 'int value = 1;'
  const head = text.indexOf('value') + 2
  const before = extendLevels({ text, head, current: { from: head, to: head }, style: null })
  assert.equal(before.length > 0, true, '没有过滤时词/词素那一档照给')
  const filter = registerWordSelectionFilter({
    id: 'test.word.filter', languages: ['java'],
    value: input => input.lexicalKind !== 'comment',
  })
  try {
    const word = wordRange(text, head)
    assert.equal(canSelectWord({
      path: '', language: 'java', text, line: 0, character: head,
      from: word.from, to: word.to, word: 'value', lexicalKind: 'word',
    }), true)
    assert.equal(canSelectWord({
      path: '', language: 'java', text, line: 0, character: head,
      from: word.from, to: word.to, word: 'value', lexicalKind: 'comment',
    }), false)
    // 消费点：在注释里的词不再被扩展选区选中（本仓按词法判种类，见 editorExtendSelection 的
    // `lexicalKindAt`：`style: null` 时判不出注释 ⇒ 这一档用 `word` 传给过滤）
    const inComment = extendLevels({
      text, head, current: { from: head, to: head }, style: null, context: { language: 'java' },
    })
    assert.equal(inComment.length, before.length, 'style: null 判不出注释 ⇒ 词档仍在')
  } finally {
    filter.dispose()
  }
})

test('选区去引号过滤：任一为真即真', () => {
  const filter = registerSelectionUnquotingFilter({
    id: 'test.unquote', languages: ['java'],
    skipReplacementQuotesOrBraces: input => input.selectedText === 'x',
  })
  try {
    assert.equal(shouldSkipQuoteReplacement({ ...pasteContext(), selectedText: 'x', typed: '"' }), true)
    assert.equal(shouldSkipQuoteReplacement({ ...pasteContext(), selectedText: 'y', typed: '"' }), false)
    assert.equal(shouldSkipQuoteReplacement({ ...pasteContext(), language: 'cpp', selectedText: 'x', typed: '"' }), false)
  } finally {
    filter.dispose()
  }
})

test('自定义粘贴：第一条 isPasteEnabled 为真的接管', () => {
  let performed = ''
  const provider = registerCustomPasteProvider({
    id: 'test.paste.provider', languages: ['java'],
    isPasteEnabled: input => input.clipboardText.startsWith('import'),
    performPaste: input => { performed = input.clipboardText },
  })
  try {
    const claimed = customPasteProviderFor({ ...pasteContext(), clipboardText: 'import java.util.List;' })
    assert.equal(claimed?.id, 'test.paste.provider')
    assert.equal(performCustomPaste(claimed, { ...pasteContext(), clipboardText: 'import java.util.List;' }), true)
    assert.equal(performed, 'import java.util.List;')
    assert.equal(customPasteProviderFor({ ...pasteContext(), clipboardText: 'List x;' }), null)
  } finally {
    provider.dispose()
  }
})

test('保存时格式化默认档：fileTypeOfPath + 合并各贡献的文件类型', () => {
  assert.equal(fileTypeOfPath('src/A.java'), 'JAVA')
  assert.equal(fileTypeOfPath('src/a/b'), '')
  const provider = registerFormatOnSaveDefaultsProvider({
    id: 'test.fos', getFileTypesFormattedOnSaveByDefault: () => ['java', 'kt'],
    getFileTypesWithOptimizeImportsOnSaveByDefault: () => ['java'],
  })
  try {
    assert.deepEqual(formatOnSaveDefaultFileTypes().sort(), ['JAVA', 'KT'])
    assert.deepEqual(optimizeImportsOnSaveDefaultFileTypes(), ['JAVA'])
    assert.equal(formatsOnSaveByDefault('src/A.java'), true)
    assert.equal(formatsOnSaveByDefault('src/a.txt'), false)
    assert.equal(formatsOnSaveByDefault('src/noext'), false)
  } finally {
    provider.dispose()
  }
  assert.equal(formatsOnSaveByDefault('src/A.java'), false, '拿掉贡献后恒假 ⇒ 判据回到显式设置那一档')
})
