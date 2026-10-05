import { computed, type Ref } from 'vue'
import type { GeneralSettingsState } from './bridge.ts'

/** 外部工具文本 ↔ 结构化条目（`ToolConfigurable` 的「名称|命令」两列；两个消费点共用这一份解析）。 */
export function parseExternalToolsText(value: string): Array<{ name: string; command: string }> {
  return value.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
    const [name, ...rest] = line.split('|')
    return { name: (name ?? '').trim(), command: rest.join('|').trim() }
  }).filter(tool => tool.name && tool.command)
}

/** 结构化条目 → 文本（设置页回显）。 */
export function formatExternalToolsText(tools: Array<{ name: string; command: string }> | undefined): string {
  return (tools ?? []).map(tool => `${tool.name}|${tool.command}`).join('\n')
}

/** Textarea adapters for the General settings draft; persistence stays with the dialog. */
export function createGeneralSettingsTextModels(general: Ref<GeneralSettingsState>) {
  // 外部工具：每行「名称|命令」，写回 general.externalTools。
  const externalToolsText = computed({
    get: () => formatExternalToolsText(general.value.externalTools),
    set: value => { general.value = { ...general.value, externalTools: parseExternalToolsText(value) } },
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
