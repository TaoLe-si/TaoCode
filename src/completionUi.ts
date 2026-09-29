import { acceptCompletion, autocompletion, currentCompletions, startCompletion, type Completion, type CompletionSource } from '@codemirror/autocomplete'
import { Prec, type EditorState } from '@codemirror/state'
import { EditorView, ViewPlugin, getTooltip, keymap, repositionTooltips, showTooltip, tooltips, type TooltipView } from '@codemirror/view'
import { completionIcon } from './completionIcons.ts'
import { completionPresentation, type PresentedCompletion } from './completionPresentation.ts'

// $default.xml:732-734 is BASIC. :909-911 is SMART, a different contributor.
// Neither a physical-key fallback nor a menu invocation may alias Smart to Basic.
export function isBasicCompletionKey(event: Pick<KeyboardEvent, 'key' | 'code' | 'keyCode' | 'ctrlKey' | 'altKey' | 'metaKey' | 'shiftKey' | 'isComposing' | 'defaultPrevented'>): boolean {
  return !event.defaultPrevented && !event.isComposing && event.keyCode !== 229 && event.key !== 'Process'
    && event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey
    && (event.code === 'Space' || event.key === ' ')
}

export function startBasicCompletion(view: EditorView): boolean {
  // Menu / Find Action left focus on a button or input. The lookup does not take
  // focus (LookupImpl.java:248); the editor must own subsequent lookup keys.
  view.focus()
  return startCompletion(view)
}

export function handleBasicCompletionKey(event: KeyboardEvent, view: EditorView): boolean {
  return isBasicCompletionKey(event) && startBasicCompletion(view)
}

export const basicCompletionKeys = [
  Prec.highest(EditorView.domEventHandlers({ keydown: handleBasicCompletionKey })),
  // EditorChooseLookupItemReplace is Tab ($default.xml:111-113). Without this,
  // CodeEditor's indentation consumes Tab even when a lookup is open.
  Prec.high(keymap.of([{ key: 'Tab', run: acceptCompletion }])),
]

function presentationOf(completion: Completion) {
  return (completion as PresentedCompletion).presentation
    ?? completionPresentation({ kind: completion.type ?? 'text', detail: completion.detail })
}

// The runtime passes a 4th `match` argument (the matched ranges inside the label):
// @codemirror/autocomplete/dist/index.js `optionContent` calls
// `render(completion, _s, _v, match)` for every entry, including its own built-in
// label renderer. The bundled .d.ts declares only three parameters and simply omits
// it, so `match` is optional here — that keeps this assignable to the narrower
// declared type while still receiving the real argument at runtime.
type OptionRender = (
  completion: Completion,
  state: EditorState,
  view: EditorView,
  match?: readonly number[],
) => HTMLElement

export function renderCompletionRow(
  completion: Completion,
  _state: EditorState,
  view: EditorView,
  match: readonly number[] = [],
): HTMLElement {
  const doc = view.dom.ownerDocument
  const row = doc.createElement('span')
  row.className = 'tc-completion-row'
  const icon = row.appendChild(doc.createElement('span'))
  icon.className = 'tc-completion-icon'
  icon.setAttribute('aria-hidden', 'true')
  const name = row.appendChild(doc.createElement('span'))
  name.className = 'tc-completion-name'
  const label = completion.displayLabel ?? completion.label
  let end = 0
  for (let i = 0; i + 1 < match.length; i += 2) {
    const from = match[i]!, to = match[i + 1]!
    if (from < end || to > label.length || to <= from) continue
    name.appendChild(doc.createTextNode(label.slice(end, from)))
    const marked = name.appendChild(doc.createElement('span'))
    marked.className = 'cm-completionMatchedText'
    marked.textContent = label.slice(from, to)
    end = to
  }
  name.appendChild(doc.createTextNode(label.slice(end)))
  const tail = row.appendChild(doc.createElement('span'))
  tail.className = 'tc-completion-tail'
  const type = row.appendChild(doc.createElement('span'))
  type.className = 'tc-completion-type'
  const refresh = () => {
    const presentation = presentationOf(completion)
    row.classList.toggle('tc-completion-bold', presentation.bold)
    row.classList.toggle('tc-completion-deprecated', presentation.strikeout)
    tail.textContent = presentation.tail
    type.textContent = presentation.typeText ? ` ${presentation.typeText}` : ''
    const source = completionIcon(presentation.icon, view.state.facet(EditorView.darkTheme))
    icon.style.backgroundImage = source ? `url("${source}")` : 'none'
  }
  refresh()
  // Theme (dark/light) can change while the popup is open; the icon variant follows it.
  // This must NOT schedule another measure — that recursed through completionLayout.
  ;(completion as PresentedCompletion).refreshPresentation = refresh
  return row
}

// 颜色一律读 tokens.css 的 `--completion-*` / `--popup-*`（月相层，随 data-theme 换面）：
// 这里**不再写死十六进制**，也不再按 CM 的 light/dark 类各发一份 —— 那会让补全弹窗与
// 菜单浮层在换主题时各走各的。度量（行高、条数、inset、右留白）才是这个文件管的事，
// 每一条后面注了上游的类与行号。
export const completionThemeRules = {
  // 月相浮层规格：圆角 + 1px 描边 + 与菜单弹层同一档阴影（--popup-shadow）。
  // **不能写 overflow: hidden** —— CM 把右侧文档面板（.cm-completionInfo）绝对定位在
  // tooltip 之内、列表之外，一裁就没了。圆角靠行本身的外缩与圆角达成，不靠裁切。
  '.cm-tooltip.tc-completion': {
    backgroundColor: 'var(--completion-background)', color: 'var(--completion-foreground)',
    border: 'var(--popup-border)', borderRadius: 'var(--popup-radius)',
    boxShadow: 'var(--popup-shadow)',
    fontFamily: 'var(--font-mono)', lineHeight: 'normal',
    width: 'max-content', maxWidth: 'min(500px, 100vw)',
  },
  // UISettingsState.kt:197,199: max width 500, max 11 visible items.
  // LookupCellRenderer.kt:718 + UIUtil.java:3079-3081: MINIMUM row height,
  // not a fixed row height. New UI List.rowHeight is 24; large editor fonts grow.
  '.cm-tooltip.tc-completion > ul': {
    fontFamily: 'inherit', minWidth: '0', maxWidth: '100%', height: 'auto',
    maxHeight: `calc(11 * max(var(--popup-row-h), 1lh + 4px) + 2 * var(--popup-pad))`,
    overflowX: 'hidden', overflowY: 'auto',
    padding: 'var(--popup-pad) 0',
  },
  // LookupCellRenderer: bodyInsets=4 (:209), selectionInnerInsets=2 (JBUI:1456),
  // name icon inset=6 (:958), icon/text gap=4 (:105), tail/type right inset=10 (:113,119).
  '.cm-tooltip.tc-completion > ul > li': {
    minHeight: 'var(--popup-row-h)', padding: '2px 6px', lineHeight: 'normal', cursor: 'default',
    margin: `0 var(--popup-selection-inset)`, borderRadius: 'var(--radius-sm)',
    position: 'relative', transition: `background-color var(--dur-1) var(--ease), color var(--dur-1) var(--ease)`,
  },
  // 选中行的左缘一道"月光"标记条：IDEA 的 lookup 用整条反色，我们这层加一道 2px 的定位标记，
  // 让"当前项"在只靠底色区分之外还有一条明确的边（长列表里扫一眼就能定位）。
  '.cm-tooltip.tc-completion > ul > li[aria-selected]::before': {
    content: '""', position: 'absolute', left: '0', top: '3px', bottom: '3px',
    width: 'var(--popup-mark-width)', borderRadius: 'var(--popup-mark-width)',
    backgroundColor: 'var(--popup-mark-color)',
  },
  '.cm-tooltip.tc-completion > ul > li[aria-selected]': {
    backgroundColor: 'var(--completion-selection)', color: 'var(--completion-foreground)',
  },
  '.cm-tooltip.tc-completion.cm-tooltip-autocomplete-disabled > ul > li[aria-selected]': {
    backgroundColor: 'var(--completion-inactive)',
  },
  '.cm-tooltip.tc-completion > ul > li[aria-selected]::after': { content: 'none' },
  // The custom renderer supplies all three text columns. CM's built-in label/detail
  // must not render a duplicate, and its generic glyph icons are disabled below.
  '.tc-completion > ul > li > .cm-completionLabel, .tc-completion > ul > li > .cm-completionDetail': { display: 'none' },
  '.tc-completion-row': { display: 'flex', alignItems: 'center', whiteSpace: 'pre', minWidth: '0' },
  '.tc-completion-icon': { flex: '0 0 16px', height: '16px', marginLeft: '6px', marginRight: '4px', backgroundSize: 'contain', backgroundRepeat: 'no-repeat' },
  '.tc-completion-no-icons .tc-completion-icon': { flexBasis: '0', marginLeft: '1px' },
  '.tc-completion-name': { flex: '0 1 auto', overflow: 'hidden', textOverflow: 'ellipsis' },
  '.tc-completion-tail': { flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: '10px', color: 'var(--completion-info)' },
  '.tc-completion-type': { flex: '0 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: '10px', color: 'var(--completion-info)' },
  '.tc-completion-bold .tc-completion-name': { fontWeight: 'bold' },
  '.tc-completion-deprecated .tc-completion-name, .tc-completion-deprecated .tc-completion-tail': { textDecoration: 'line-through' },
  // 命中的字符：上色 + 加粗，但不划线（划线留给"已弃用"，两种语义不能共用一种笔法）。
  '.tc-completion .cm-completionMatchedText': { color: 'var(--completion-match)', fontWeight: '600', textDecoration: 'none' },
  // 右侧文档面板（`completionItem/resolve` 回来的内容）= 同一套浮层规格，
  // 而不是 CM 默认的"贴一张白底方块"。
  '.tc-completion .cm-completionInfo': {
    maxHeight: '100vh', overflow: 'auto', color: 'var(--text)',
    backgroundColor: 'var(--elevated)', border: 'var(--popup-border)',
    borderRadius: 'var(--popup-radius)', boxShadow: 'var(--shadow-2)',
    padding: '6px 8px', lineHeight: '1.55',
  },
  '.tc-completion .cm-completionInfo.cm-completionInfo-left': { marginRight: '4px' },
  '.tc-completion .cm-completionInfo.cm-completionInfo-right': { marginLeft: '4px' },
  '.tc-completion .completion-info': { font: 'inherit', maxWidth: '100%', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
}

const completionLayout = ViewPlugin.fromClass(class {
  constructor(readonly view: EditorView) { this.schedule() }
  update() { this.schedule() }
  schedule() { this.view.requestMeasure(this.measure) }
  measure = {
    read: () => {
      const tooltip = this.view.state.facet(showTooltip).map(t => t && getTooltip(this.view, t))
        .find(t => t?.dom.classList.contains('tc-completion'))
      const name = tooltip?.dom.querySelector<HTMLElement>('.tc-completion-name')
      if (!tooltip || !name) return null
      return { tooltip, indent: name.getBoundingClientRect().left - tooltip.dom.getBoundingClientRect().left }
    },
    write: (value: { tooltip: TooltipView; indent: number } | null) => {
      if (!value) return
      // LookupUi.java:345-356 aligns item text, not the icon, to lookupStart.
      // Let CM keep ownership of screen clipping and the above/below decision.
      if (value.tooltip.offset?.x !== -value.indent) {
        value.tooltip.offset = { x: -value.indent, y: 0 }
        repositionTooltips(this.view)
      }
    },
  }
})

export function completionUi(sources: CompletionSource[]) {
  return [
    ...basicCompletionKeys,
    // The CM tooltip container carries view.themeClasses and tracks theme changes.
    // Body hosting removes editor overflow/transform containing-block constraints.
    tooltips({ parent: document.body }),
    autocompletion({ override: sources, icons: false,
      tooltipClass: state => `tc-completion${currentCompletions(state).some(item => presentationOf(item).icon) ? '' : ' tc-completion-no-icons'}`,
      addToOptions: [{ render: renderCompletionRow as OptionRender, position: 10 }],
    }),
    EditorView.baseTheme(completionThemeRules),
    completionLayout,
  ]
}
