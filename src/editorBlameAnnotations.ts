import { EditorView, GutterMarker, gutter } from '@codemirror/view'
import type { Extension, Range } from '@codemirror/state'
import { RangeSet, StateEffect, StateField } from '@codemirror/state'
import type { BlameAnnotation } from './blameAnnotations.ts'

export type { BlameAnnotation } from './blameAnnotations'

type Aspect = 'date' | 'author'
function aspectText(annotation: BlameAnnotation, aspect: Aspect): string {
  return annotation[aspect] ?? (aspect === 'author' && annotation.date === undefined ? annotation.text : '')
}

class BlameMarker extends GutterMarker {
  private readonly text: string
  private readonly tooltip: string
  constructor(annotation: BlameAnnotation, aspect: Aspect) {
    super()
    this.text = aspectText(annotation, aspect)
    this.tooltip = annotation.tooltip
  }
  eq(other: GutterMarker) {
    return other instanceof BlameMarker && other.text === this.text && other.tooltip === this.tooltip
  }
  toDOM() {
    const node = document.createElement('span')
    node.className = 'cm-blame-annotation'
    node.textContent = this.text
    node.title = this.tooltip
    return node
  }
}

class BlameMeasureMarker extends GutterMarker {
  private readonly texts: readonly string[]
  constructor(texts: readonly string[]) { super(); this.texts = texts }
  eq(other: GutterMarker) {
    return other instanceof BlameMeasureMarker && other.texts.length === this.texts.length
      && other.texts.every((text, index) => text === this.texts[index])
  }
  toDOM() {
    const node = document.createElement('div')
    node.className = 'cm-blame-measure'
    // EditorGutterComponentImpl.calcAnnotationsSize measures every actual line, not just
    // visible rows. A grid stack lets the browser measure the same strings with its real font.
    for (const text of this.texts) {
      const line = document.createElement('span')
      line.className = 'cm-blame-annotation'
      line.textContent = text
      node.append(line)
    }
    return node
  }
}

export const setBlameAnnotations = StateEffect.define<readonly BlameAnnotation[]>()

const blameField = StateField.define<readonly BlameAnnotation[]>({
  create: () => [],
  update(value, transaction) {
    let next = value
    for (const effect of transaction.effects) if (effect.is(setBlameAnnotations)) next = effect.value
    if (next === value && !transaction.docChanged) return value
    return next.filter(annotation => Number.isInteger(annotation.line) && annotation.line > 0
      && annotation.line <= transaction.state.doc.lines && annotation.text.length > 0)
  },
})

function measureMarker(annotations: readonly BlameAnnotation[], aspect: Aspect) {
  return new BlameMeasureMarker([...new Set(annotations.map(annotation => aspectText(annotation, aspect)).filter(Boolean))])
}

const blameTheme = EditorView.theme({
  '.cm-gutter-blame': { minWidth: '0px' },
  '.cm-blame-measure': { display: 'grid', height: '0px', overflow: 'hidden' },
  '.cm-blame-measure > span': { gridArea: '1 / 1' },
  '.cm-blame-annotation': {
    color: 'var(--muted)', fontFamily: 'var(--font-ui)', fontSize: 'var(--ui-font-size, 13px)',
    whiteSpace: 'pre', paddingRight: '5px',
  },
})

export function blameAnnotationsExtension(): Extension {
  const columns = (['date', 'author'] as const).map(aspect => gutter({
    class: `cm-gutter-blame cm-gutter-blame-${aspect}`,
    initialSpacer: view => measureMarker(view.state.field(blameField), aspect),
    updateSpacer: (spacer, update) => update.startState.field(blameField) === update.state.field(blameField)
      ? spacer : measureMarker(update.state.field(blameField), aspect),
    markers: view => {
      const annotations = view.state.field(blameField).filter(annotation => aspectText(annotation, aspect))
      const ranges: Range<GutterMarker>[] = annotations.map(annotation =>
        new BlameMarker(annotation, aspect).range(view.state.doc.line(annotation.line).from))
      return ranges.length ? RangeSet.of(ranges, true) : RangeSet.empty
    },
  }))
  return [blameField, columns, blameTheme]
}

export function syncBlameAnnotations(view: EditorView | undefined, annotations: readonly BlameAnnotation[]): void {
  view?.dispatch({ effects: setBlameAnnotations.of(annotations) })
}
