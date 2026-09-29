<script setup lang="ts">
// Lightweight read-only CodeMirror: no editor commands, LSP, navigation or document-open effects.
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, lineNumbers, WidgetType } from '@codemirror/view'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import type { SearchEverywherePreviewData } from '../searchEverywhere'

const props = defineProps<{ document: SearchEverywherePreviewData }>()
const container = ref<HTMLElement>()
const language = new Compartment()
let view: EditorView | undefined
let generation = 0
class PositionMarker extends WidgetType {
  toDOM() { const marker = document.createElement('span'); marker.className = 'se-position'; return marker }
}
function position(state: EditorState, line: number, character = 0) {
  const info = state.doc.line(Math.max(1, Math.min(state.doc.lines, Math.trunc(line) + 1)))
  return Math.min(info.to, info.from + Math.max(0, Math.trunc(character)))
}
async function render() {
  if (!container.value) return
  const id = ++generation
  view?.destroy()
  const data = props.document
  const initial = EditorState.create({ doc: data.content })
  const target = data.line === undefined ? 0 : position(initial, data.line, data.character)
  const ranges = []
  if (data.line !== undefined) {
    ranges.push(Decoration.line({ class: 'se-target-line' }).range(initial.doc.lineAt(target).from))
    const end = data.endLine === undefined || data.endCharacter === undefined ? target : position(initial, data.endLine, data.endCharacter)
    if (end > target) ranges.push(Decoration.mark({ class: 'se-target-range' }).range(target, end))
    else if (data.character !== undefined) ranges.push(Decoration.widget({ widget: new PositionMarker(), side: 1 }).range(target))
  }
  const editor = new EditorView({ parent: container.value, state: EditorState.create({
    doc: data.content,
    extensions: [EditorState.readOnly.of(true), EditorView.editable.of(false),
      EditorView.contentAttributes.of({ tabindex: '0', 'aria-label': '只读文件全文预览' }),
      lineNumbers(), syntaxHighlighting(defaultHighlightStyle), language.of([]),
      EditorView.decorations.of(Decoration.set(ranges, true)),
      EditorView.theme({
        '&': { height: '100%', backgroundColor: 'var(--bg)', color: 'var(--text)' },
        '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--font-mono, monospace)', fontSize: '12px' },
        '.cm-gutters': { backgroundColor: 'var(--panel)', color: 'var(--muted)', border: 'none' },
        '.se-target-line': { backgroundColor: 'var(--hover, rgba(127,127,127,.15))' },
        '.se-target-range': { backgroundColor: 'var(--selection, rgba(100,150,240,.35))' },
        '.se-position': { borderLeft: '2px solid var(--accent)', marginLeft: '-1px' },
      }),
    ],
  }) })
  view = editor
  if (data.line !== undefined) editor.dispatch({ effects: EditorView.scrollIntoView(target, { y: 'center' }) })
  // Same language packages/extension rules and heavy-document cutoff as CodeEditor.vue:518.
  if (data.content.length > 5 * 1024 * 1024) return
  try {
    const path = data.path
    let extension: Extension = []
    if (/\.java$/i.test(path)) extension = (await import('@codemirror/lang-java')).java()
    else if (/\.(cpp|cc|c|h|hpp|cxx)$/i.test(path)) extension = (await import('@codemirror/lang-cpp')).cpp()
    else if (/\.(ts|tsx|js|jsx|mjs)$/i.test(path)) extension = (await import('@codemirror/lang-javascript')).javascript({ typescript: /\.tsx?$/i.test(path), jsx: /\.[jt]sx$/i.test(path) })
    else if (/\.json$/i.test(path)) extension = (await import('@codemirror/lang-json')).json()
    else if (/\.(html|vue)$/i.test(path)) extension = (await import('@codemirror/lang-html')).html()
    else if (/\.css$/i.test(path)) extension = (await import('@codemirror/lang-css')).css()
    if (id === generation) editor.dispatch({ effects: language.reconfigure(extension) })
  } catch { /* Full text remains readable when an optional language chunk fails. */ }
}
onMounted(() => { void render() })
watch(() => props.document, () => { void render() })
onBeforeUnmount(() => { generation++; view?.destroy(); view = undefined })
</script>
<template><div ref="container" class="se-preview-editor" /></template>
<style scoped>
.se-preview-editor { flex: 1; min-height: 0; overflow: hidden; }
</style>
