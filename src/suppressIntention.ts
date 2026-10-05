// 抑制动作（上游 `platform/lang-impl/src/com/intellij/codeInsight/intention/` 里 `SuppressIntentionAction`
// 那一族：Java 的 `@SuppressWarnings`、`//noinspection` 注释，以及各语言的等价抑制形式）。
//
// 本仓现状：Alt+Enter 只列语言服务给的 `textDocument/codeAction`，本地检查（如 `src/junitInspections.ts`
// 的 JUnit 规则）报出来的条目**没有抑制入口** —— 用户只能关掉整条规则。这个模块把「按语言/来源
// 生成抑制文本」落成纯规则：给出 `insertText` 与插入位置，编辑器侧只做一次文本插入。
//
// 覆盖的形态（上游对应类）：
//   · Java  `//noinspection <Id>`（`SuppressIntentionAction` 的注释式）与注解式 `@SuppressWarnings("…")`；
//   · JS/TS `// eslint-disable-next-line <rule>`（ESLint 抑制）与 `// @ts-ignore`；
//   · Python `# noqa: <code>`（flake8）与 `# type: ignore`（mypy）；
//   · C/C++ `// NOLINT(<check>)`（clang-tidy）与 `#pragma clang diagnostic ignored`；
//   · Go    `//nolint:<linter>`。
// 来源名（诊断的 `source` 字段）到规则 id 的映射也在这一层：映射不到时给「本行抑制」的通用形式。

/** 一条可用的抑制动作。 */
export interface SuppressOption {
  id: string
  /** 菜单里的标题（IDEA 的 `SuppressIntentionAction.getText`）。 */
  title: string
  /** 写进文本的内容（不含缩进，编辑器按行首缩进补齐）。 */
  insertText: string
  /** 插到哪里：上一行（注释式）/ 行尾（noqa、nolint）/ 声明上方（注解式，本仓降级为上一行）。 */
  placement: 'line-above' | 'line-end'
}

/** 诊断的最小形状（同 `src/problems.ts` 的 `ProblemRow` 子集 + 编辑器给的行首缩进）。 */
export interface SuppressibleProblem {
  line: number
  source: string
  /** 规则/检查器 id（服务器诊断里常有 `code`；没有就按 source 猜）。 */
  code?: string
}

/** 来源 → 规则 id 的映射（语言服务/检查器的常见 source 值）。 */
const SOURCE_RULES: ReadonlyArray<{ match: RegExp; language: string; rule: string; tool: string }> = [
  { match: /eslint/i, language: 'typescript', rule: '', tool: 'eslint' },
  { match: /typescript|ts/i, language: 'typescript', rule: '', tool: 'ts' },
  { match: /jdt|java|eclipse/i, language: 'java', rule: '', tool: 'java' },
  { match: /pylint|flake8|pyflakes|ruff|python/i, language: 'python', rule: '', tool: 'python' },
  { match: /clang|gcc|cpp|c\+\+|msvc/i, language: 'cpp', rule: '', tool: 'clang' },
  { match: /go(lint|vet)?/i, language: 'go', rule: '', tool: 'go' },
  { match: /junit/i, language: 'java', rule: 'JUnit', tool: 'java' },
]

/** 从来源 + code 猜出「用哪个工具抑制、抑制哪条规则」。 */
export function suppressionRuleFor(problem: SuppressibleProblem): { language: string; tool: string; rule: string } {
  const source = `${problem.source ?? ''} ${problem.code ?? ''}`.trim()
  for (const entry of SOURCE_RULES) {
    if (entry.match.test(source)) return { language: entry.language, tool: entry.tool, rule: problem.code?.trim() || entry.rule }
  }
  return { language: '', tool: 'generic', rule: problem.code?.trim() ?? '' }
}

/** 生成某个语言的抑制动作列表；顺序 = 菜单里的推荐顺序（注释式在前，强抑制在后）。 */
export function suppressOptionsFor(problem: SuppressibleProblem, language: string): SuppressOption[] {
  const { tool, rule } = suppressionRuleFor(problem)
  const ruleSuffix = rule ? rule : ''
  switch (language) {
    case 'java': {
      const options: SuppressOption[] = []
      if (ruleSuffix) options.push({ id: 'noinspection', title: `抑制本条（//noinspection ${ruleSuffix}）`, insertText: `//noinspection ${ruleSuffix}`, placement: 'line-above' })
      options.push({ id: 'suppress-warnings', title: '在声明上加 @SuppressWarnings("all")', insertText: '@SuppressWarnings("all")', placement: 'line-above' })
      return options
    }
    case 'typescript':
    case 'javascript': {
      const options: SuppressOption[] = []
      if (tool === 'eslint' && ruleSuffix) options.push({ id: 'eslint-disable-next-line', title: `抑制本条（// eslint-disable-next-line ${ruleSuffix}）`, insertText: `// eslint-disable-next-line ${ruleSuffix}`, placement: 'line-above' })
      else options.push({ id: 'eslint-disable-next-line', title: '抑制下一行（// eslint-disable-next-line）', insertText: '// eslint-disable-next-line', placement: 'line-above' })
      options.push({ id: 'ts-ignore', title: '抑制类型错误（// @ts-ignore）', insertText: '// @ts-ignore', placement: 'line-above' })
      return options
    }
    case 'python': {
      const options: SuppressOption[] = []
      options.push({ id: 'noqa', title: ruleSuffix ? `抑制本条（# noqa: ${ruleSuffix}）` : '抑制本行（# noqa）', insertText: ruleSuffix ? `# noqa: ${ruleSuffix}` : '# noqa', placement: 'line-end' })
      options.push({ id: 'type-ignore', title: '抑制类型检查（# type: ignore）', insertText: '# type: ignore', placement: 'line-end' })
      return options
    }
    case 'cpp':
      return [
        { id: 'nolint', title: ruleSuffix ? `抑制本条（// NOLINT(${ruleSuffix})）` : '抑制本行（// NOLINT）', insertText: ruleSuffix ? `// NOLINT(${ruleSuffix})` : '// NOLINT', placement: 'line-end' },
        { id: 'pragma-diagnostic', title: '用 #pragma 抑制（clang 诊断）', insertText: '#pragma clang diagnostic ignored "-Wdeprecated-declarations"', placement: 'line-above' },
      ]
    case 'go':
      return [{ id: 'nolint', title: ruleSuffix ? `抑制本条（//nolint:${ruleSuffix}）` : '抑制本行（//nolint）', insertText: ruleSuffix ? `//nolint:${ruleSuffix}` : '//nolint', placement: 'line-end' }]
    default:
      return [{ id: 'generic', title: '用注释抑制本行', insertText: '// 已确认：忽略此行告警', placement: 'line-above' }]
  }
}

/**
 * 把抑制动作写进文本：`line` 是 0 基问题行；`indent` 是该行行首缩进（注释式按它对齐）。
 * `line-end` 追加到该行末尾；`line-above` 插到该行之前。返回值是**新文本**（不改入参）。
 * 行号越界时返回 null —— 编辑器据此不动作，而不是把注释插到文件尾巴上。
 */
export function applySuppression(
  text: string, problemLine: number, option: SuppressOption, indent = '',
): string | null {
  const lines = text.split('\n')
  if (!Number.isInteger(problemLine) || problemLine < 0 || problemLine >= lines.length) return null
  if (option.placement === 'line-end') {
    lines[problemLine] = `${lines[problemLine]}  ${option.insertText}`
    return lines.join('\n')
  }
  lines.splice(problemLine, 0, `${indent}${option.insertText}`)
  return lines.join('\n')
}

/** 这一行是否已经有同 id 的抑制（避免重复插入；行尾查本行，上一行式只查上一行）。 */
export function alreadySuppressed(text: string, problemLine: number, option: SuppressOption): boolean {
  const lines = text.split('\n')
  const probe = option.placement === 'line-end'
    ? lines[problemLine] ?? ''
    : lines[problemLine - 1] ?? ''
  return probe.includes(option.insertText)
}
