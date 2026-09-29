// LSP `textDocument/semanticTokens/*` —— IDEA 的 daemon 着色路径。
//
// IDEA 侧：`HighlightVisitor.visit`（platform/analysis-impl/src/com/intellij/codeInsight/daemon/impl/HighlightVisitor.java:17,36）
// 与 `Annotator.annotate`（platform/analysis-api/src/com/intellij/lang/annotation/Annotator.java:22,36）
// 产出 `HighlightInfo`，颜色由 `TextAttributesKey` 决定；默认那一套 key 在
// `platform/core-api/src/com/intellij/openapi/editor/DefaultLanguageHighlighterColors.java`：
//   `:14` KEYWORD、`:29` LOCAL_VARIABLE、`:30` REASSIGNED_LOCAL_VARIABLE、
//   `:33` FUNCTION_DECLARATION、`:35` PARAMETER、`:41` INSTANCE_FIELD、`:43` STATIC_FIELD。
//
// **一处重要的建模差别**：IDEA 把 `static` 这种"修饰符"表达成**另一个 TextAttributesKey**
// （`STATIC_FIELD` 而不是 `INSTANCE_FIELD`），而 LSP 把它表达成 tokenModifiers 的**位掩码**。
// 这里保留 LSP 的形状（type + modifiers[]），但 CSS 表现按 IDEA 的视觉惯例来：
// static / abstract 斜体、deprecated 删除线、readonly 虚线下划线。
//
// 解码规则（规范 "Semantic Tokens"）：`data` 是**压缩的整数数组**，每 5 个一组
//   [deltaLine, deltaStartChar, length, tokenType, tokenModifiers]
// 其中 deltaLine 相对**上一个 token 的行**；deltaStartChar 在 deltaLine === 0 时相对
// 上一个 token 的起始列，否则是**该行的绝对列**。第一个 token 相对 (0, 0)。
// 这两个"相对 vs 绝对"的切换是这段代码最容易写错的地方，所以它只有这一份实现
// （原生层原样透传整数数组，不解码）。

/** 与 `native/lsp_session.cpp` 的 `initialize` 里 `semanticTokens.tokenTypes` **必须逐项同序**。 */
export const SEMANTIC_TOKEN_TYPES = [  'namespace', 'type', 'class', 'enum', 'interface', 'struct', 'typeParameter', 'parameter',
  'variable', 'property', 'enumMember', 'event', 'function', 'method', 'macro', 'keyword',
  'modifier', 'comment', 'string', 'number', 'regexp', 'operator', 'decorator',
] as const

/** 与 `initialize` 的 `semanticTokens.tokenModifiers` **必须逐项同序**（位掩码按索引取）。 */
export const SEMANTIC_TOKEN_MODIFIERS = [
  'declaration', 'definition', 'readonly', 'static', 'deprecated', 'abstract', 'async',
  'modification', 'documentation', 'defaultLibrary',
] as const

export interface SemanticToken {
  /** 0 基行号。 */
  line: number
  /** 0 基起始列（UTF-16 单元，与 CodeMirror 的 pos 一致）。 */
  startChar: number
  length: number
  /** tokenTypes 表里的名字；索引越界时为空串（不是编造一个名字）。 */
  type: string
  /** tokenModifiers 表里的名字，按位升序。 */
  modifiers: string[]
}

/** `SemanticTokensEdit`：`start`/`deleteCount` 是**整数数组的下标**，不是行号。 */
export interface SemanticTokenEdit {
  start: number
  deleteCount: number
  data?: number[]
}

/** 原生层整形后的回答（`native/lsp_session.cpp` 的 `semanticTokens` 分支）。 */
export type LspSemanticTokensResult = SemanticTokensReply

export interface SemanticTokensReply {
  available: boolean
  kind?: 'full' | 'delta'
  resultId?: string
  data?: number[]
  edits?: SemanticTokenEdit[]
  /** 服务端 `semanticTokensProvider.legend`（宿主原样带出；老宿主可能没有）。 */
  legend?: SemanticLegend
}

/** `semanticTokensProvider.legend`：`data` 里的两个索引按**这张表**编，不是按客户端声明的那张。 */
export interface SemanticLegend {
  tokenTypes?: readonly string[]
  tokenModifiers?: readonly string[]
}

/**
 * 把压缩数组解成 token 列表。长度不是 5 的倍数时**丢掉尾部残缺的那一组**，而不是抛异常：
 * 一个畸形响应不该把编辑器打挂（服务端的 bug 不该变成我们的崩溃）。
 *
 * `legend` 是**服务端**的能力声明。索引按它解 —— 用客户端的 `SEMANTIC_TOKEN_TYPES` 解会整份错位
 * （实测：JDT LS 的索引顺序不同，`declaration`/`definition` 会被解成 `deprecated`，于是
 * `Main`/`main`/`args` 凭空出现删除线）。没给 legend 时才退回客户端那张表（旧宿主/无 provider）。
 */
export function decodeSemanticTokens(data: readonly number[] | undefined | null, legend?: SemanticLegend | null): SemanticToken[] {
  if (!Array.isArray(data) || data.length < 5) return []
  const types = legend?.tokenTypes ?? SEMANTIC_TOKEN_TYPES
  const modifiers = legend?.tokenModifiers ?? SEMANTIC_TOKEN_MODIFIERS
  const tokens: SemanticToken[] = []
  let line = 0
  let startChar = 0
  for (let index = 0; index + 4 < data.length; index += 5) {
    const deltaLine = data[index]
    const deltaStart = data[index + 1]
    const length = data[index + 2]
    const typeIndex = data[index + 3]
    const modifierBits = data[index + 4]
    // 相对 vs 绝对：换了行就**重置**为绝对列，在同一行内才累加。写反了整份着色会整体右移。
    if (deltaLine > 0) { line += deltaLine; startChar = deltaStart }
    else startChar += deltaStart
    const names: string[] = []
    for (let bit = 0; bit < modifiers.length; bit++) {
      if ((modifierBits & (1 << bit)) !== 0) names.push(modifiers[bit]!)
    }
    tokens.push({
      line,
      startChar,
      length,
      type: types[typeIndex] ?? '',
      modifiers: names,
    })
  }
  return tokens
}

/**
 * 应用一个 delta：`edits` 的 `start`/`deleteCount` 是整数数组下标。
 *
 * **按 `start` 降序应用**：这样每个 edit 都作用在尚未被更靠后的 edit 改动的下标上，
 * 就地 splice 不会互相错位。规范没有明写 edits 是"相对原数组"还是"相对前一个 edit"，
 * 服务器的顺序也不保证 —— 降序对前者恒正确，对后者只在单 edit 时等价。
 * 这一点是 `待核`：拿真实服务器（如 typescript-language-server）的多 edit delta 核对。
 */
export function applySemanticTokenEdits(data: readonly number[], edits: readonly SemanticTokenEdit[] | undefined): number[] {
  const next = [...data]
  if (!Array.isArray(edits) || edits.length === 0) return next
  const ordered = [...edits].sort((left, right) => right.start - left.start)
  for (const edit of ordered) {
    const start = Math.max(0, Math.min(edit.start, next.length))
    const remove = Math.max(0, Math.min(edit.deleteCount, next.length - start))
    next.splice(start, remove, ...(Array.isArray(edit.data) ? edit.data : []))
  }
  return next
}

/** token 的 CSS 类名。基础色 + 修饰符（`cm-sem-mod-*`）。 */
export function semanticTokenClass(token: SemanticToken): string {
  const classes: string[] = []
  if (token.type) classes.push(`cm-sem-${token.type}`)
  for (const modifier of token.modifiers) classes.push(`cm-sem-mod-${modifier}`)
  return classes.join(' ')
}

/** 表里的索引是否合法 —— 用来判断"服务端的 legend 和客户端不一致"。 */
export function tokenTypeKnown(typeIndex: number): boolean {
  return Number.isInteger(typeIndex) && typeIndex >= 0 && typeIndex < SEMANTIC_TOKEN_TYPES.length
}
