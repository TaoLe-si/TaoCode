// IDEA FileColorManager + EditorTabColorProvider: resolve IDs once, expose CSS to consumers.
import { computed, type Ref } from 'vue'
import { FILE_COLOR_NAMES, fileColorCss, normalizeFileColors, resolveFileColor, tabFileColorEnabled, projectViewFileColorEnabled, type FileColorName } from './fileColors.ts'
import type { EditorSettings, ProjectSettings, Workspace } from './bridge'

export interface FileColorHostDeps {
  editorSettings: Ref<EditorSettings>
  projectSettings: Ref<ProjectSettings>
  workspace: Ref<Workspace | null>
}
export function createFileColorHost(deps: FileColorHostDeps) {
  const { editorSettings, projectSettings, workspace } = deps
  const local = computed(() => normalizeFileColors(projectSettings.value.localFileColors))
  const project = computed(() => normalizeFileColors(projectSettings.value.fileColors))
  const assignments = computed(() => [...local.value, ...project.value])
  function hit(path: string, isDirectory = false) {
    return resolveFileColor({
      path, isDirectory,
      scopes: projectSettings.value.scopes ?? [],
      localFileColors: local.value,
      fileColors: project.value,
      context: { moduleName: workspace.value?.name ?? '' },
    })
  }
  function tabFileColor(path: string): string | null {
    return tabFileColorEnabled(editorSettings.value) ? fileColorCss(hit(path)?.color) : null
  }
  function tabFileColorScope(path: string): string | null {
    return tabFileColorEnabled(editorSettings.value) ? hit(path)?.scope ?? null : null
  }
  /** Project-view consumer supplies workspace-relative paths and the actual directory flag. */
  function projectViewFileColor(path: string, isDirectory = false): string | null {
    return projectViewFileColorEnabled(editorSettings.value) ? fileColorCss(hit(path, isDirectory)?.color) : null
  }
  return { tabFileColor, tabFileColorScope, projectViewFileColor, fileColorAssignments: assignments, FILE_COLOR_NAMES }
}
export type { FileColorName }
