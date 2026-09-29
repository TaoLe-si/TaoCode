import test from 'node:test'
import assert from 'node:assert/strict'
import { EditorState } from '@codemirror/state'
import { blameAnnotationsExtension, setBlameAnnotations } from '../src/editorBlameAnnotations.ts'

function fixture(doc = 'one\ntwo\nthree') {
  const extension = blameAnnotationsExtension()
  const providers = extension.flat(Infinity).filter(part => part?.value?.class?.startsWith('cm-gutter-blame'))
  assert.equal(providers.length, 2)
  let state = EditorState.create({ doc, extensions: extension })
  const columns = providers.map(provider => state.facet(provider.facet).find(config => config === provider.value))
  let spacers = columns.map(column => column.initialSpacer({ state }))
  return {
    columns,
    get state() { return state },
    get spacers() { return spacers },
    apply(spec) {
      const transaction = state.update(spec)
      const update = { startState: state, state: transaction.state }
      spacers = spacers.map((spacer, index) => columns[index].updateSpacer(spacer, update))
      state = transaction.state
    },
  }
}

const annotation = (line, date, author) => ({ line, date, author, text: `${date}  ${author}`, tooltip: author })

test('closed annotation columns have no phantom measurement strings or line markers', () => {
  const f = fixture()
  for (let i = 0; i < f.columns.length; i++) {
    assert.deepEqual(f.spacers[i].texts, [])
    assert.equal(f.columns[i].markers({ state: f.state }).size, 0)
  }
})

test('annotation width uses every real row in separate date and author columns', () => {
  const f = fixture()
  const veryLongName = 'W'.repeat(100)
  f.apply({ effects: setBlameAnnotations.of([
    annotation(1, '2026-09-01', 'Li'),
    annotation(3, '2026-09-02', veryLongName),
  ]) })
  assert.deepEqual(f.spacers[0].texts, ['2026-09-01', '2026-09-02'])
  assert.deepEqual(f.spacers[1].texts, ['Li', veryLongName])
  assert.equal(f.columns[1].markers({ state: f.state }).size, 2)
})

test('turning annotations off restores empty measurement markers', () => {
  const f = fixture()
  const empty = f.spacers.slice()
  f.apply({ effects: setBlameAnnotations.of([annotation(1, '2026-09-01', 'LongName')]) })
  assert.equal(f.spacers[1].eq(empty[1]), false)
  f.apply({ effects: setBlameAnnotations.of([]) })
  assert.ok(f.spacers.every((marker, index) => marker.eq(empty[index])))
  assert.ok(f.columns.every(column => column.markers({ state: f.state }).size === 0))
})

test('invalid or deleted rows cannot retain annotation width', () => {
  const f = fixture()
  f.apply({ effects: setBlameAnnotations.of([
    annotation(0, 'date', 'invalid'), annotation(99, 'date', 'outside'),
    annotation(1.5, 'date', 'fractional'), annotation(3, 'date', 'visible'),
  ]) })
  assert.deepEqual(f.spacers[1].texts, ['visible'])
  f.apply({ changes: { from: 3, to: f.state.doc.length } })
  assert.deepEqual(f.spacers[1].texts, [])
})

test('cursor movement does not remeasure unchanged annotation data', () => {
  const f = fixture()
  f.apply({ effects: setBlameAnnotations.of([annotation(1, 'date', 'Author')]) })
  const markers = f.spacers.slice()
  f.apply({ selection: { anchor: 2 } })
  assert.ok(f.spacers.every((marker, index) => marker === markers[index]))
})

test('changed annotation tooltip produces a changed line marker', () => {
  const f = fixture()
  f.apply({ effects: setBlameAnnotations.of([annotation(1, 'date', 'Author')]) })
  const before = f.columns[1].markers({ state: f.state }).iter().value
  f.apply({ effects: setBlameAnnotations.of([{ ...annotation(1, 'date', 'Author'), tooltip: 'New commit' }]) })
  const after = f.columns[1].markers({ state: f.state }).iter().value
  assert.equal(after.eq(before), false)
})
