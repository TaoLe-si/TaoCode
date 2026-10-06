# 接线请求 · 2026-10-06 · lshl（语义高亮注册表 / hover range 复核）

本文件的三条都要动**别人名下或保留**的文件，我一条都没动。模块侧（`src/semanticHighlighting.ts`、
`src/editorSemanticField.ts`）已经把闸和缓存做出来并测死（`tests/semantic-highlighting.test.mjs` 10 条），
缺的只是消费点。

---

## W1 · `src/components/CodeEditor.vue` 的语义 token 拉取改走按特性缓存（两条闸）

- **目标文件**：`src/components/CodeEditor.vue`
- **目标行号**：第 **317-340** 行整段替换（`async function runSemanticTokens()` 全体）；
  第 **64** 行那条 `import { ... } from '../bridge'` 之后补一行 import（见下）。
- **要接什么**：①**capability 没声明就不请求**（服务器回过一次 `LSP_UNSUPPORTED` 后不再发第二次）；
  ②**按文档修订的在途闸门**（答案回来时文档已变 ⇒ 整份丢弃，连解码都不做）。
- **上游依据**：
  - `platform/lsp-impl/src/impl/features/highlighting/LspSemanticTokensCache.kt:29-36`
    （`isSupportedForFile`：`serverCapabilities?.semanticTokensProvider?.full` 不为 true 就**不发**请求）
  - `platform/lsp-impl/src/impl/features/highlighting/LspSemanticTokensCache.kt:40-41,51-54`
    （请求前记 `document.modificationStamp`；回来时戳变了 ⇒ `return@readAction emptyList()`，注释写着
    "The result will be ignored anyway … so let's save time by not calling decodeSemanticTokens()"）
  - `platform/lsp-impl/src/impl/features/highlightingCommon/LspHighlightingCacheRegistry.kt:28`
    （语义 token 的那份缓存是**注册表里的一条具名特性**，不是各调用点各建一份）
- **本仓落点**：`src/semanticHighlighting.ts`（`semanticHighlightingCache`、`semanticRevisionOf`、
  `SemanticPullPlan`）；装饰层已经接上了（`src/editorSemanticField.ts:25-28,132-157`）。

**第 64 行 import 段之后补**：

```ts
// 语义高亮的按特性注册表 + 文档修订快照（capability 没声明就不请求、在途答案过期即丢）。
import { semanticHighlightingCache, semanticRevisionOf } from '../semanticHighlighting'
```

**第 317-340 行整段替换为**（只多两道闸，其余逻辑一字未改）：

```ts
async function runSemanticTokens(): Promise<boolean> {
  const editor = view
  if (!editor || !props.lspEnabled) return true
  // 闸①：能力没声明（或宿主已经回过 LSP_UNSUPPORTED）就一个字节都不发 ——
  // 上游 isSupportedForFile 就是这个口径（LspSemanticTokensCache.kt:29-36），
  // 没有这道闸时导入期每 400ms 就往一条死能力上打请求。
  const revision = semanticRevisionOf(editor.state.doc)
  if (semanticHighlightingCache.plan(editor.state.doc, revision) === 'unsupported') return true
  try {
    const docAtRequest = editor.state.doc
    const result = await request<LspSemanticTokensResult>('lsp.request', {
      kind: 'semanticTokens', path: props.path, line: 0, character: 0,
      // 没有 resultId 时**不发这个键**：发空串等于告诉服务器"上一份是空的"，它会走另一条路。
      ...(semanticResultId ? { previousResultId: semanticResultId } : {}),
    })
    // 期间换过文档（视图重建）的话这次答案已经过期，不能 dispatch 到新文档上。
    const target = view
    if (target !== editor) return true
    // 闸②：请求在飞的这段时间里文档改了 ⇒ 整份丢弃，连解码都不做
    // （上游 LspSemanticTokensCache.kt:51-54 同一句注释）。旧 token 的行列是新文档的偏移量，
    // 顶上会把颜色画错位置。
    if (target.state.doc !== docAtRequest) return true
    if (!result.available) { resetSemanticTokens(); target.dispatch({ effects: setSemanticTokens.of([]) }); return true }
    if (result.resultId) semanticResultId = result.resultId
    // 规范允许 `/full/delta` 用整份 `data` 回答（"全部替换"），所以 edits 为空时就用 data。
    const hasEdits = Array.isArray(result.edits) && result.edits.length > 0
    semanticData = result.kind === 'delta' && hasEdits
      ? applySemanticTokenEdits(semanticData, result.edits)
      : [...(result.data ?? [])]
    target.dispatch({ effects: setSemanticTokens.of(decodeSemanticTokens(semanticData, result.legend)) })
    // 非空才算"着色已到位"；空数组还可能是导入期，交给 warmup 退避重试（available: false 则到此为止）。
    return semanticData.length > 0
  } catch (error) {
    // 宿主对这条能力回 LSP_UNSUPPORTED（`native/lsp_capability_queries.cpp:105`）⇒ 记进快照缓存，
    // 之后 `plan()` 恒为 unsupported。其它错误（超时/停机）照旧交给 warmup 退避重试。
    if ((error as { code?: string } | null)?.code === 'LSP_UNSUPPORTED') semanticHighlightingCache.noteServerDeclined()
    return false
  }
}
```

- **验证判据**：`tests/semantic-highlighting.test.mjs` 的「能力没声明…不发第二次」已经把
  `plan()`/`noteServerDeclined()` 的语义钉死；接完之后建议再加一条 DOM 级判据（同一条能力
  只发一次请求）。**没接之前不会出错**，只是那条重试链仍在打死能力。
- **注意**：`error.code` 的形状请照 `src/bridge.ts` 的 `BridgeError` 复核一次（我这边只读到
  native 侧 `native/lsp_capability_queries.cpp:105` 的 `invalid("LSP_UNSUPPORTED", …)`）。

## W2 · `src/editorSemanticField.ts` 的取用面（同一处消费点的第二半，可选）

装饰层现在会在**同一文档修订**上复用已建好的 `DecorationSet`（上游 `LspPullResult.Unchanged`
的「保留内容不重画」），并把旧修订的快照作废（`src/editorSemanticField.ts:139`）。这条已经接好了，
**不需要主代理动手**；列在这里只是为了说明 W1 的两道闸与它读的是同一份缓存
（`semanticHighlightingCache`），不要再建第二份。

## W3 · `src/docHoverContent.ts:31-34` 的陈旧注释（桶 3a 名下，我只报不改）

那里写「本仓登记的类型是 `LspHoverResult { available, contents }`，**没有** range 那一格」——
实际 native 已透传 range（`native/lsp_session.cpp:166-171`）。请把该段改成中性描述，避免下一个代理
又照它提一遍 R5。**已自修的同款**：`src/hoverDocumentation.ts:12-24`（留痕写法可照抄）。
