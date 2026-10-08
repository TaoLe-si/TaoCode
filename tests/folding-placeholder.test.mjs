// 折起来以后**显示的那段文字**（`docs/inventory/verdict-folding.md` §G 的 `EditorFoldingInfo` /
// `CodeFoldingPass` 那两行没写、但用户每一下收起都看得见的那一半）。
//
// 上游坐标（本地参考树逐行核过）：
//   · `platform/foldings/src/com/intellij/codeInsight/folding/impl/UpdateFoldRegionsOperation.java:150-162`
//     —— `placeholder = descriptor.getPlaceholderText()`，落地时
//     `createOrMergeWithZombie(..., placeholder == null ? "..." : placeholder, ...)`
//     ⇒ 默认占位是**三个点**（不是 CodeMirror 那个单字符省略号 `…`，那是
//     `@codemirror/language` 的 `FoldConfig.placeholderText` 默认值）；
//   · `platform/lsp-impl/src/impl/features/folding/LspFoldingBuilder.kt:48-53` ——
//     LSP 路径把服务端的 `collapsedText` 原样交给 descriptor（`info.highlightingInfo.collapsedText`），
//     `:63` 的 `getPlaceholderText` 反过来返回 `null`（注释原文："null value is ambiguous"）
//     ⇒ 服务端给了就用服务端的，没给就落到上面那条三点；
//   · `platform/core-api/src/com/intellij/lang/folding/CustomFoldingBuilder.java:102-111` ——
//     自定义折叠区域那一段是 provider 的 `getPlaceholderText(elementText)`，
//     规则（含「正则不匹配就原样返回整段注释」）在 `src/customFoldingProviders.ts`。
//
// 渲染钩子在宿主那一侧（`codeFolding({ placeholderDOM, preparePlaceholder })`，本仓现在用的是
// `basicSetup` 里那一份默认配置）⇒ 宿主那一句在 `docs/wiring-requests-2026-10-06-stickyfold.md`
// （W-1/W-2；`2026-10-06 stickyfold` 订正留痕：这里原写 `docs/wiring-requests-2026-10-06-folding2.md` W-7，
// 那份文件**不在盘上**（`ls docs | grep folding2` 零命中）⇒ 那条请求从没落过盘，本批评据要的钩子改指在盘的那份）。
// 本文件钉的是模块侧那份「这一段该显示什么」的唯一答案。
import test from 'node:test'
import assert from 'node:assert/strict'
import { codeFolding } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { FOLD_PLACEHOLDER_TEXT, foldPlaceholderFor, foldingRanges, localRegionFolds, setFoldingRanges } from '../src/editorFolding.ts'
import { regionLabel } from '../src/customFoldingRegions.ts'

const lines = text => text.split('\n')

/** 一条区间的偏移边界（与 `editorFolding.ts` 内部同一算法：整行起、整行止）。 */
function boundsOf(state, startLine, endLine) {
  return { from: state.doc.line(startLine + 1).from, to: state.doc.line(endLine + 1).to }
}

function stateWith(doc, ranges) {
  return EditorState.create({ doc, extensions: [codeFolding(), foldingRanges] })
    .update({ effects: setFoldingRanges.of(ranges) }).state
}

test('默认占位是三个点，不是 CodeMirror 的那个单字符省略号', () => {
  assert.equal(FOLD_PLACEHOLDER_TEXT, '...', 'UpdateFoldRegionsOperation.java:162 的字面量')
  assert.notEqual(FOLD_PLACEHOLDER_TEXT, '…')
  const state = stateWith('class A {\n  int x;\n}\n', [{ startLine: 0, endLine: 1, kind: 'imports' }])
  assert.equal(foldPlaceholderFor(state, boundsOf(state, 0, 1)), '...', '服务端没给 collapsedText ⇒ 三点')
  assert.equal(foldPlaceholderFor(state, { from: 3, to: 9 }), '...', '对不上任何区间（语法树折的那块）⇒ 三点')
  assert.equal(foldPlaceholderFor(stateWith('', []), { from: 0, to: 0 }), '...', '空文档不抛')
})

test('服务端给的 collapsedText 优先（LspFoldingBuilder.kt:48-53）', () => {
  const state = stateWith('import a\nimport b\nlet c = 1\n', [{ startLine: 0, endLine: 1, kind: 'imports', collapsedText: '2 imports' }])
  assert.equal(foldPlaceholderFor(state, boundsOf(state, 0, 1)), '2 imports')
  // 空串不算「服务端给了」—— 上游给的是一段文字，空串退回默认占位。
  const blank = stateWith('import a\nimport b\nlet c = 1\n', [{ startLine: 0, endLine: 1, kind: 'imports', collapsedText: '' }])
  assert.equal(foldPlaceholderFor(blank, boundsOf(blank, 0, 1)), '...')
})

test('region 一族显示 provider 的说明文字，与列表弹层同一份规则', () => {
  const doc = '//region 构造\na\n//endregion\nplain\n'
  const state = stateWith(doc, localRegionFolds(doc))
  const area = boundsOf(state, 0, 2)
  assert.equal(foldPlaceholderFor(state, area), '构造', 'VisualStudio 那一族的尾巴')
  assert.equal(foldPlaceholderFor(state, area), regionLabel(lines(doc)[0]),
    '折痕里的文字与「转到自定义折叠」列表里的必须一模一样')
  const netbeans = '//<editor-fold desc="成员">\nb\n//</editor-fold>\n'
  const folded = stateWith(netbeans, localRegionFolds(netbeans))
  assert.equal(foldPlaceholderFor(folded, boundsOf(folded, 0, 2)), '成员')
  // 正则不匹配那一档：上游 `replaceFirst` 原样返回入参 ⇒ 整条注释，不是三点。
  const bare = '//<editor-fold>\nb\n//</editor-fold>\n'
  const bareState = stateWith(bare, localRegionFolds(bare))
  assert.equal(foldPlaceholderFor(bareState, boundsOf(bareState, 0, 2)), '//<editor-fold>')
  // 有开始标记、但说明捕获为空（`//region` 后面什么都没有）⇒ 三点。
  const empty = '//region\nb\n//endregion\n'
  const emptyState = stateWith(empty, localRegionFolds(empty))
  assert.equal(foldPlaceholderFor(emptyState, boundsOf(emptyState, 0, 2)), '...')
})

test('非 region 的族（comment / imports / 不带 kind）都走默认占位', () => {
  const doc = '/* 一段注释 */\ncode\n'
  const state = stateWith(doc, [{ startLine: 0, endLine: 1, kind: 'comment' }, { startLine: 0, endLine: 1 }])
  assert.equal(foldPlaceholderFor(state, boundsOf(state, 0, 1)), '...', '注释折叠不冒充 region 说明')
})

// ── 2026-10-06 `stickyfold`：取值链与宿主钩子的**形状**契约 ─────────────────────────────
//
// 上游这一族没有「用户可自定义占位符」那一档：
//   · `platform/core-api/src/com/intellij/codeInsight/folding/CodeFoldingSettings.java:7-11`
//     整份设置就 5 个布尔（COLLAPSE_IMPORTS / COLLAPSE_METHODS / COLLAPSE_FILE_HEADER /
//     COLLAPSE_DOC_COMMENTS / COLLAPSE_CUSTOM_FOLDING_REGIONS），一个字符串字段都没有；
//   · 能"自定义"的只有**标记里那段说明文字**（`NetBeansCustomFoldingProvider.java:24-27`、
//     `VisualStudioCustomFoldingProvider.java:22-27`，两处各自 `isEmpty() ? "..." : …`）。
// ⇒ 本批不新增设置项，只核下面这三档。

test('取值链的两条 trim 规则分开：服务端的 collapsedText 原样、provider 的说明 trim', () => {
  // 服务端那一档：上游 `LspFoldingBuilder.kt:71/:85` 把 `collapsedText` 直接当 placeholder 交回，
  // `UpdateFoldRegionsOperation.java:162` 只判 `== null` ⇒ 一段空白也**原样落地**（不 trim、不退回三点）。
  const padded = stateWith('import a\nimport b\nlet c = 1\n',
    [{ startLine: 0, endLine: 1, kind: 'imports', collapsedText: '   ' }])
  assert.equal(foldPlaceholderFor(padded, boundsOf(padded, 0, 1)), '   ',
    '服务端给三段空格就显示三段空格（本仓不许悄悄 trim，那是与上游不同的一档）')
  // provider 那一档：两个 provider 都在 `:26` 之后 `.trim()`（NetBeans `:25`、VS `:25`）⇒ 说明文字两边留白要摘掉。
  const desc = '//<editor-fold desc="  成员  ">\nb\n//</editor-fold>\n'
  const descState = stateWith(desc, localRegionFolds(desc))
  assert.equal(foldPlaceholderFor(descState, boundsOf(descState, 0, 2)), '成员',
    'desc 两侧留白按上游 trim（NetBeansCustomFoldingProvider.java:25 的 .trim()）')
})

test('区间表被清空时（文档刚改过）仍然只有默认占位，不抛、不返回 undefined', () => {
  // `foldingRanges` 在 `docChanged` 时清表（`src/editorFolding.ts:44-50`），下一次服务端回包之前
  // 老的折痕还在、表却空了 ⇒ 上游同一档是「descriptor 没了就只剩默认占位」（:162 那条 `== null`）。
  const state = stateWith('class A {\n  int x;\n}\n', [{ startLine: 0, endLine: 1, kind: 'imports', collapsedText: '2 imports' }])
  const emptied = state.update({ changes: { from: 0, insert: '#' } }).state
  assert.equal(foldPlaceholderFor(emptied, { from: 1, to: 10 }), '...', '空表 ⇒ 三点，且必须是字符串')
})

test('foldPlaceholderFor 的形状 = CodeMirror preparePlaceholder 的入参形状（宿主可原样塞进 codeFolding）', () => {
  // `node_modules/@codemirror/language/dist/index.d.ts:783-786`：
  //   `preparePlaceholder?: (state: EditorState, range: { from: number; to: number }) => any`
  // 接线请求 W-1 就是把这两个形状对接起来 ⇒ 签名漂了就当场红，别让宿主去猜。
  assert.equal(foldPlaceholderFor.length, 2, '两个形参：state 与 { from, to }')
  const state = stateWith('//region 构造\na\n//endregion\n', localRegionFolds('//region 构造\na\n//endregion\n'))
  const prepared = foldPlaceholderFor(state, boundsOf(state, 0, 2))
  assert.equal(typeof prepared, 'string')
  assert.equal(prepared, '构造')
  // 反证用的另一头：`codeFolding()` 不带配置时用的是 `placeholderText` 默认档（`index.js:1517` 的 `"…"`），
  // 与上游的三点不是一回事 ⇒ 本仓必须传配置，这条钉住「模块给的答案不是单字符」。
  assert.notEqual(prepared, '…')
  assert.notEqual(FOLD_PLACEHOLDER_TEXT, '…')
})

