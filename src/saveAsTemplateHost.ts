import { buildTemplateDraft, saveAsTemplateAvailable, suggestAbbreviation } from './saveAsTemplate.ts'
import type { TemplateSettings } from './templates'

export interface SaveAsTemplateHostDeps {
  selection: () => string
  hasEditor: () => boolean
  hasProject: () => boolean
  projectKey: () => string | null
  language: () => string
  templates: () => TemplateSettings
  openSettings: () => Promise<void>
  save: (templates: TemplateSettings) => Promise<void>
}

export function createSaveAsTemplateHost(deps: SaveAsTemplateHostDeps) {
  const availableFor = (selection: string) =>
    deps.hasProject() && deps.hasEditor() && saveAsTemplateAvailable({ selection }).available
  const available = () => availableFor(deps.selection())

  async function run() {
    const selection = deps.selection()
    if (!availableFor(selection)) return
    const language = deps.language()
    const projectKey = deps.projectKey()
    await deps.openSettings()
    if (!deps.hasProject() || deps.projectKey() !== projectKey) return
    const current = deps.templates()
    const draft = buildTemplateDraft(selection, language, suggestAbbreviation(selection, current.customs.map(template => template.key)))
    await deps.save({ ...current, customs: [...current.customs, draft] })
  }

  return { available, run }
}
