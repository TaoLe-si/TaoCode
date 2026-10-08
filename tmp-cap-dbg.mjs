import { EditorState } from '@codemirror/state'
import { CompletionContext } from '@codemirror/autocomplete'
import { createLspCompletion } from './src/lspCompletion.ts'
import { autoPopupKind } from './src/completionAutoPopup.ts'
console.log('kind 方 =', autoPopupKind('方'), 'kind . =', autoPopupKind('.'))
for (const text of ['System.', '变量.方']) {
  const view = { state: EditorState.create({ doc: text, selection: { anchor: text.length } }) }
  view.dispatch = spec => { view.state = view.state.update(spec).state }
  const source = createLspCompletion({ enabled: () => true, path: () => 'src/Main.java', view: () => view,
    request: async () => ({ available: true, items: [{ label: 'println', kind: 'method', raw: { label: 'println', data: { id: 1 } } }] }),
    sync: async () => ({}), reportError: e => console.log('ERR', e) })
  const context = new CompletionContext(view.state, text.length, false)
  const r = await source(context)
  console.log(JSON.stringify(text), '=>', r ? { from: r.from, labels: r.options.map(o => o.label) } : null)
}
