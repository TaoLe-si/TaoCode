// 包围（Surround With）与模板选择器 —— 从 App.vue 搬出的一域（72 行，外部依赖只有 6 个）。
//
// 判据：两套"提示 + 候选列表 + 应用"的交互共享同一套结构（打开提示、方向键移动、回车应用、
// Esc 取消），状态（提示开关 / 查询 / 索引 / 输入）也自成一体。外部依赖越少越好拆 —— 实测 6 个。
import { computed, nextTick, ref, watch, type Ref } from 'vue'
import { request, type PluginInfo, type ProjectSettings, type Workspace } from './bridge'
import { rankCommands } from './commandSearch'
import { surroundTemplates, type SurroundTemplate } from './surround'
import { candidates as templateCandidates, effectiveTemplates, expand as expandTemplateAt,
         defaultTemplateSettings, type Template } from './templates'

/** 当前标签（宿主是 computed，只要只读视图）。 */
type ActiveTab = { path: string; line: number; column: number } | undefined

export interface SurroundTemplatesDeps {
  notify: (message: string, error?: boolean) => void
  menu: Ref<string | null>
  projectSettings: Ref<ProjectSettings>
  workspace: Ref<Workspace | null>
  active: { readonly value: ActiveTab }
  /** 取处于活动状态的编辑器（宿主按 path 索引）。 */
  editorFor: (path: string) => any
  /** 已安装插件：启用插件贡献的实时模板也进模板列表与「包围」选择器。 */
  pluginList: Ref<PluginInfo[]>
}

export function createSurroundTemplates(deps: SurroundTemplatesDeps) {
  const { menu, projectSettings, workspace, active, editorFor, pluginList } = deps
  const surroundPrompt = ref(false)
  const surroundQuery = ref('')
  const surroundIndex = ref(0)
  const surroundInput = ref<HTMLInputElement>()
  const surroundChoices = computed(() => rankCommands(surroundTemplates, surroundQuery.value))
  function openSurround() {
    if (!active.value) { deps.notify('请先打开一个文件。', true); return }
    menu.value = null
    surroundQuery.value = ''
    surroundIndex.value = 0
    surroundPrompt.value = true
    void nextTick(() => surroundInput.value?.focus())
  }
  function moveSurround(step: number) {
    const size = Math.max(1, surroundChoices.value.length)
    surroundIndex.value = (surroundIndex.value + step + size) % size
  }
  function applySurround(template: SurroundTemplate | undefined) {
    const tab = active.value
    if (!template || !tab) return
    surroundPrompt.value = false
    editorFor(tab.path)?.surroundWith(template)
    deps.notify(`已用「${template.title}」包裹`)
  }
  watch(surroundQuery, () => { surroundIndex.value = 0 })
  // Live Template Chooser: IDEA's "Surround/Expand Live Template" popup. The inventory
  // is whatever src/templates.ts actually offers for the current file (effectiveTemplates
  // already applies per-template overrides, disable flags and custom templates).
  const templateChooser = ref(false)
  const templateQuery = ref('')
  const templateIndex = ref(0)
  const templateInput = ref<HTMLInputElement>()
  interface TemplateChoice { id: string; title: string; keywords: string; template: Template }
  const templateChoices = computed<TemplateChoice[]>(() => {
    const path = active.value?.path ?? ''
    // rankCommands matches title+keywords (IDEA's Find Action rules), so each entry is
    // searchable by both its trigger key and its Chinese description.
    const entries = effectiveTemplates(path, projectSettings.value.templates, pluginList.value).map((entry, index) => ({
      id: `${entry.pattern}#${index}`,
      title: entry.template.key,
      keywords: `${entry.template.description} ${entry.template.postfix ? 'postfix 后置' : 'live template'}`,
      template: entry.template,
    }))
    return rankCommands(entries, templateQuery.value)
  })
  function openTemplateChooser() {
    if (!active.value) { deps.notify('请先打开一个文件。', true); return }
    menu.value = null
    templateQuery.value = ''
    templateIndex.value = 0
    templateChooser.value = true
    void nextTick(() => templateInput.value?.focus())
  }
  function moveTemplate(step: number) {
    const size = Math.max(1, templateChoices.value.length)
    templateIndex.value = (templateIndex.value + step + size) % size
  }
  function applyTemplate(choice: TemplateChoice | undefined) {
    if (!choice) return
    const tab = active.value
    templateChooser.value = false
    if (!tab) return
    // Postfix templates expand `receiver.key`; the caret must sit after a real receiver,
    // so offer those only when the previous expansion would otherwise silently fail.
    const ok = editorFor(tab.path)?.expandAtCursor(choice.template.postfix ? `.${choice.template.key}` : choice.template.key) ?? false
    // 展开成功时编辑器里**出现了那段文本**，不必再说一遍；失败才是用户无法感知的
    // （看不出为什么按了没反应），所以只报失败。
    if (!ok) deps.notify(`「${choice.template.key}」不是当前光标处的有效触发，未展开。`, true)
  }
  watch(templateQuery, () => { templateIndex.value = 0 })
  // IDEA stores run configurations with the project (.idea/runConfigurations), so the
  // list follows the workspace instead of the machine: `project.settings.*` owns it.

  return {
    surroundPrompt, surroundQuery, surroundIndex, surroundInput, surroundChoices, openSurround, moveSurround, applySurround,
    templateChooser, templateQuery, templateIndex, templateInput, templateChoices, openTemplateChooser, moveTemplate, applyTemplate,
  }
}
