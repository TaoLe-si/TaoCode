import test from 'node:test'
import assert from 'node:assert/strict'
import { ref } from 'vue'
import { createGeneralSettingsTextModels } from '../src/generalSettingsTextModels.ts'

test('missing optional lists are displayed as empty text', () => {
  const models = createGeneralSettingsTextModels(ref({}))
  assert.equal(models.externalToolsText.value, '')
  assert.equal(models.foldConsoleText.value, '')
  assert.equal(models.foldExceptionText.value, '')
})

test('external tool text keeps command pipes and filters incomplete rows', () => {
  const general = ref({ externalTools: [{ name: 'Format', command: 'format | check' }], sentinel: true })
  const { externalToolsText } = createGeneralSettingsTextModels(general)
  assert.equal(externalToolsText.value, 'Format|format | check')
  const before = general.value
  externalToolsText.value = '  Build | npm run build | report  \r\n\nNo command\n|No name\nEmpty|   \n 检查 | npm test '
  assert.deepEqual(general.value, {
    externalTools: [
      { name: 'Build', command: 'npm run build | report' },
      { name: '检查', command: 'npm test' },
    ],
    sentinel: true,
  })
  assert.notEqual(general.value, before, 'editing replaces the draft instead of mutating the old value')
  assert.deepEqual(before.externalTools, [{ name: 'Format', command: 'format | check' }])
  assert.equal(externalToolsText.value, 'Build|npm run build | report\n检查|npm test')
})

test('console folding and exception text trim blank rows without deduplicating', () => {
  const general = ref({ foldConsoleLines: ['old'], foldExceptions: ['keep'], sentinel: 42 })
  const { foldConsoleText, foldExceptionText } = createGeneralSettingsTextModels(general)
  foldConsoleText.value = '  repeat  \r\n\n repeat\n  other '
  assert.deepEqual(general.value.foldConsoleLines, ['repeat', 'repeat', 'other'])
  assert.deepEqual(general.value.foldExceptions, ['keep'])
  assert.equal(foldConsoleText.value, 'repeat\nrepeat\nother')
  foldExceptionText.value = '  error \r\n \n warn  '
  assert.deepEqual(general.value.foldExceptions, ['error', 'warn'])
  assert.deepEqual(general.value.foldConsoleLines, ['repeat', 'repeat', 'other'])
  assert.equal(foldExceptionText.value, 'error\nwarn')
  assert.equal(general.value.sentinel, 42)
})

test('models follow a replaced draft and empty input clears each list', () => {
  const general = ref({})
  const models = createGeneralSettingsTextModels(general)
  general.value = {
    externalTools: [{ name: 'Test', command: 'npm test' }],
    foldConsoleLines: ['one', 'two'],
    foldExceptions: ['failure'],
    sentinel: true,
  }
  assert.equal(models.externalToolsText.value, 'Test|npm test')
  assert.equal(models.foldConsoleText.value, 'one\ntwo')
  assert.equal(models.foldExceptionText.value, 'failure')
  models.externalToolsText.value = '\n  '
  models.foldConsoleText.value = ''
  models.foldExceptionText.value = ' \r\n '
  assert.deepEqual(general.value, { externalTools: [], foldConsoleLines: [], foldExceptions: [], sentinel: true })
})
