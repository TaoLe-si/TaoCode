import { computed, type Ref } from 'vue'
import type { GeneralSettingsState } from './bridge'

/** Textarea adapters for the General settings draft; persistence stays with the dialog. */
export function createGeneralSettingsTextModels(general: Ref<GeneralSettingsState>) {
  // 外部工具：每行「名称|命令」，写回 general.externalTools。
  const externalToolsText = computed({
    get: () => (general.value.externalTools ?? []).map(tool => `${tool.name}|${tool.command}`).join('\n'),
    set: value => {
      const entries = value.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
        const [name, ...rest] = line.split('|')
        return { name: (name ?? '').trim(), command: rest.join('|').trim() }
      }).filter(tool => tool.name && tool.command)
      general.value = { ...general.value, externalTools: entries }
    },
  })

  const foldConsoleText = computed({
    get: () => (general.value.foldConsoleLines ?? []).join('\n'),
    set: value => { general.value = { ...general.value, foldConsoleLines: value.split('\n').map(line => line.trim()).filter(Boolean) } },
  })
  const foldExceptionText = computed({
    get: () => (general.value.foldExceptions ?? []).join('\n'),
    set: value => { general.value = { ...general.value, foldExceptions: value.split('\n').map(line => line.trim()).filter(Boolean) } },
  })

  return { externalToolsText, foldConsoleText, foldExceptionText }
}
