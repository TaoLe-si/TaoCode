import { StateEffect, StateField, type Extension } from '@codemirror/state'
import { EditorView, showPanel, type Panel } from '@codemirror/view'
import { BIDI_DIRECTIONS, bidiDirectionLabel, type BidiDirection } from './bidiTextDirection.ts'
import { BIDI_NOTIFICATION_KEY, containsBidirectionalText, showBidiNotification } from './bidiNotification.ts'

function notificationDisabled(): boolean {
  try { return localStorage.getItem(BIDI_NOTIFICATION_KEY) === 'true' } catch { return false }
}

// BidiContentNotificationProvider.java:47-62: per-editor hide, application-wide disable.
export function bidiNotificationExtension(choose: (direction: BidiDirection) => void): Extension {
  const hide = StateEffect.define<boolean>()
  const state = StateField.define<{ contains: boolean; hidden: boolean }>({
    create: editor => ({ contains: containsBidirectionalText(editor.doc.toString()), hidden: false }),
    update(value, transaction) {
      let contains = value.contains
      if (!contains && transaction.docChanged) {
        transaction.changes.iterChanges((_from, _to, _newFrom, _newTo, inserted) => {
          if (!contains) contains = containsBidirectionalText(inserted.toString())
        })
      }
      const hidden = transaction.effects.some(effect => effect.is(hide)) || value.hidden
      return contains === value.contains && hidden === value.hidden ? value : { contains, hidden }
    },
    provide: field => showPanel.from(field, value => showBidiNotification(value.contains, value.hidden, notificationDisabled()) ? panel : null),
  })
  function panel(view: EditorView): Panel {
    const dom = document.createElement('div')
    dom.className = 'bidi-notification'
    dom.setAttribute('role', 'status')
    const message = dom.appendChild(document.createElement('span'))
    message.textContent = '双向文本的显示布局取决于基础方向（视图 › 文本方向）。'
    const direction = dom.appendChild(document.createElement('select'))
    direction.setAttribute('aria-label', '选择文本方向')
    const prompt = direction.appendChild(document.createElement('option'))
    prompt.textContent = '选择方向'
    prompt.value = ''
    for (const mode of BIDI_DIRECTIONS) {
      const option = direction.appendChild(document.createElement('option'))
      option.value = mode
      option.textContent = bidiDirectionLabel(mode)
    }
    direction.addEventListener('change', () => {
      if (BIDI_DIRECTIONS.includes(direction.value as BidiDirection)) choose(direction.value as BidiDirection)
      direction.value = ''
    })
    const hideButton = dom.appendChild(document.createElement('button'))
    hideButton.type = 'button'
    hideButton.textContent = '隐藏提示'
    hideButton.addEventListener('click', () => view.dispatch({ effects: hide.of(true) }))
    const disable = dom.appendChild(document.createElement('button'))
    disable.type = 'button'
    disable.textContent = '不再显示'
    disable.addEventListener('click', () => {
      try { localStorage.setItem(BIDI_NOTIFICATION_KEY, 'true') } catch { /* editor-local hide still works */ }
      view.dispatch({ effects: hide.of(true) })
      document.dispatchEvent(new Event(BIDI_NOTIFICATION_KEY))
    })
    const onDisabled = () => { if (notificationDisabled()) view.dispatch({ effects: hide.of(true) }) }
    document.addEventListener(BIDI_NOTIFICATION_KEY, onDisabled)
    return { dom, top: true, destroy: () => document.removeEventListener(BIDI_NOTIFICATION_KEY, onDisabled) }
  }
  return [state, EditorView.perLineTextDirection.of(true), EditorView.baseTheme({
    '.bidi-notification': { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', padding: '6px 10px', color: 'var(--text)', background: 'var(--elevated)', borderBottom: '1px solid var(--line)', fontSize: '12px' },
    '.bidi-notification span': { flex: '1 1 240px' },
    '.bidi-notification button, .bidi-notification select': { color: 'var(--text)', background: 'var(--editor)', border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-xs)', padding: '2px 6px', font: 'inherit' },
    '.bidi-notification button:hover': { background: 'var(--hover)' },
  })]
}
