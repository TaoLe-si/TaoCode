import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { computed, ref } from 'vue'
import * as argumentsModel from '../src/runConfigTree.ts'

// Exercise the component's actual computed setter/getter without mounting the UI.
function argumentField(args) {
  const source = readFileSync(new URL('../src/components/RunConfigurationsDialog.vue', import.meta.url), 'utf8')
  const start = source.indexOf('const argsText = computed(')
  const end = source.indexOf('\nconst uniqueName', start)
  assert.ok(start >= 0 && end > start)
  const js = ts.transpileModule(source.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  const form = ref({ args })
  const field = new Function('computed', 'form', 'formatRunArguments', 'parseRunArguments', `${js}; return argsText`)(
    computed, form, argumentsModel.formatRunArguments, argumentsModel.parseRunArguments,
  )
  return { field, form }
}

test('run config dialog preserves classpath with spaces when editing main class', () => {
  const { field, form } = argumentField(['-cp', 'out/project with spaces;lib/a b.jar', 'app.Main'])
  assert.equal(field.value, '-cp "out/project with spaces;lib/a b.jar" app.Main')
  field.value = '-cp "out/project with spaces;lib/a b.jar" app.OtherMain'
  assert.deepEqual([...form.value.args], ['-cp', 'out/project with spaces;lib/a b.jar', 'app.OtherMain'])
})

test('run config dialog round trips empty arguments, quoted text, Windows paths and trailing backslashes', () => {
  const args = ['', 'two words', 'quote"inside', 'C:\\Program Files\\', 'C:\\plain\\path', 'a\\"b']
  const { field, form } = argumentField(args)
  const text = field.value
  field.value = text
  assert.deepEqual([...form.value.args], args)
})
