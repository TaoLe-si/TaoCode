// LSP 语义高亮的**颜色映射表** —— IDEA `TextAttributesKey` → scheme 颜色的对应物。
//
// 为什么单独一个模块（2026-09-27 模块化）：这是**一张数据表加一段规则**，与 CodeMirror 宿主的
// 生命周期无关；它原先内联在 `CodeEditor.vue` 的主题对象里，一改配色就得动 1200 行的宿主文件。
//
// ## 选择器为什么都用**两个类**（`.cm-content .cm-sem-xxx`）
//
// CodeMirror 的 `HighlightStyle` 生成的是**单类**规则（`.cm-sem-keyword`）。同样特异性时胜负取决于
// 样式注入顺序，而顺序取决于扩展数组的位置 —— 靠顺序太脆。`EditorView.theme` 生成的规则把
// `.cm-content` 也带上（CodeMirror 会给 theme 选择器加 `.cm-editor`/`.cm-content` 前缀），
// 特异性更高，于是"语义层压过词法层"这件事不再依赖扩展顺序。
//
// ## 颜色为什么复用词法着色那 9 个变量
//
// IDEA 的语义着色与词法着色走的是**同一套** `TextAttributesKey` → scheme 颜色，所以两层不会
// 突然变成两种风格。变量名见 `src/tokens.css`。
//
// ## 依据（IDEA 源码）
//   · 语义着色由 daemon 的 `HighlightInfoType`/`SemanticHighlightingRenderer` 落到
//     `CodeInsightColors` 里的一组 key 上（例如 `METHOD_CALL`/`STATIC_METHOD_ATTRIBUTES`）。
//   · 修饰符的视觉惯例：`static`/`abstract` 斜体、`deprecated` 删除线、`readonly` 虚线下划线
//     —— 由各 key 的 `TextAttributes` 自带（`STATIC_FIELD` 等），不是位掩码。
//
// 纯数据模块（零 import），可直接被 `node --test` 读取。
export const semanticHighlightStyles: Record<string, Record<string, string>> = {
  key: { color: 'var(--syntax-keyword)', fontWeight: '600' },
  modifier: { color: 'var(--syntax-operator)' },
  string: { color: 'var(--syntax-string)' },
  regexp: { color: 'var(--syntax-string)' },
  number: { color: 'var(--syntax-number)' },
  comment: { color: 'var(--syntax-comment)', fontStyle: 'italic' },
  function: { color: 'var(--syntax-function)' },
  method: { color: 'var(--syntax-function)' },
  macro: { color: 'var(--syntax-function)' },
  namespace: { color: 'var(--syntax-type)' },
  type: { color: 'var(--syntax-type)' },
  class: { color: 'var(--syntax-type)' },
  enum: { color: 'var(--syntax-type)' },
  interface: { color: 'var(--syntax-type)' },
  struct: { color: 'var(--syntax-type)' },
  typeParameter: { color: 'var(--syntax-type)' },
  event: { color: 'var(--syntax-type)' },
  decorator: { color: 'var(--syntax-meta)' },
  property: { color: 'var(--syntax-property)' },
  enumMember: { color: 'var(--syntax-property)' },
  parameter: { color: 'var(--syntax-property)' },
  operator: { color: 'var(--syntax-operator)' },
  // `variable` 不在表里：IDEA 的 DEFAULT_LOCAL_VARIABLE 就是不额外着色的前景色。
  // 修饰符只改字形不改颜色（见文件头的依据）。
  'mod-static': { fontStyle: 'italic' },
  'mod-abstract': { fontStyle: 'italic' },
  'mod-deprecated': { textDecoration: 'line-through' },
  'mod-readonly': { textDecoration: 'underline dotted' },
}

/**
 * 把上表展开成 `EditorView.theme()` 能吃的形状：每个键都挂到 `.cm-content .cm-sem-<key>` 下。
 */
export function semanticHighlightThemeRules(): Record<string, Record<string, string>> {
  const rules: Record<string, Record<string, string>> = {}
  for (const [name, style] of Object.entries(semanticHighlightStyles))
    rules[`.cm-content .cm-sem-${name}`] = style
  return rules
}
