import type { Completion } from '@codemirror/autocomplete'
import type { LspCompletionItem } from './bridge'

export interface CompletionPresentation {
  icon: string | null
  tail: string
  typeText: string
  bold: boolean
  strikeout: boolean
}
export interface PresentedCompletion extends Completion {
  presentation?: CompletionPresentation
  refreshPresentation?: () => void
}

// IDEA platform/lsp/src/api/customization/LspCompletionCustomizer.kt:146-172.
// A missing icon is intentional (not an invented glyph for an unsupported kind).
// `command` 不是 LSP 条目种类：它是本仓**命令补全**条目的 kind，图标照上游
// `CommandCompletionProvider.kt:392` 的 `IntentionBulbGrey`（见 src/completionIcons.ts 的 `intention`）。
const icons: Record<string, string> = {
  text: 'word', method: 'method', function: 'function', constructor: 'class', field: 'field',
  variable: 'variable', class: 'class', interface: 'interface', property: 'property', enum: 'enum',
  snippet: 'template', color: 'colors', file: 'anyType', folder: 'folder', 'enum-member': 'enum',
  constant: 'constant', struct: 'object', 'type-parameter': 'type', command: 'intention',
}

export function completionPresentation(item: Pick<LspCompletionItem, 'kind' | 'detail' | 'raw'>): CompletionPresentation {
  const raw = item.raw && typeof item.raw === 'object' ? item.raw as Record<string, unknown> : {}
  const label = raw.labelDetails && typeof raw.labelDetails === 'object'
    ? raw.labelDetails as Record<string, unknown> : {}
  // LspCompletionCustomizer.kt:128-184: label, gray tail, right-aligned type;
  // keywords are bold, and only a server's deprecated flag/tag adds a strikeout.
  return {
    icon: icons[item.kind.toLowerCase()] ?? null,
    tail: typeof label.detail === 'string' ? label.detail : '',
    typeText: typeof label.description === 'string' ? label.description : item.detail ?? '',
    bold: item.kind.toLowerCase() === 'keyword',
    strikeout: raw.deprecated === true || Array.isArray(raw.tags) && raw.tags.includes(1),
  }
}

export function completionMatch(completion: Completion, matched: readonly number[] = []): readonly number[] {
  if (!completion.displayLabel || completion.displayLabel === completion.label) return matched
  // filterText is a matching key, not necessarily visible text. Never underline
  // unrelated characters when the server supplies an alias for the visible label.
  const start = completion.displayLabel.indexOf(completion.label)
  return start < 0 ? [] : matched.map(offset => offset + start)
}
