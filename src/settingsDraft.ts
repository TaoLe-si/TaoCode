import { computed, ref, type Ref } from 'vue'
import type { EditorSettings, GeneralSettingsState, NamedScopeSetting } from './bridge'
import type { CommitMessageInspectionSettings } from './commitMessageInspection'
import type { FileColorSetting } from './fileColors'

/** Public Apply/OK payload. Omitted fields are unchanged; empty arrays replace the table. */
export interface SettingsDraft {
  editor?: EditorSettings
  general?: GeneralSettingsState
  commitMessage?: CommitMessageInspectionSettings
  scopes?: NamedScopeSetting[]
  localFileColors?: FileColorSetting[]
  fileColors?: FileColorSetting[]
}

export interface FileColorsDraft {
  local: FileColorSetting[]
  shared: FileColorSetting[]
}

interface DraftPage<T> {
  readonly dirty: boolean
  getDraft: () => T
}
export function createSettingsDraftPages(
  editorDirty: Readonly<Ref<boolean>>,
  commitMessageDirty: Readonly<Ref<boolean>>,
  generalDirty: Readonly<Ref<boolean>>,
) {
  const scopesPage = ref<DraftPage<NamedScopeSetting[] | null>>()
  const fileColorsPage = ref<DraftPage<FileColorsDraft>>()
  const dirty = computed(() => editorDirty.value || commitMessageDirty.value || generalDirty.value
    || scopesPage.value?.dirty || fileColorsPage.value?.dirty)
  return { scopesPage, fileColorsPage, dirty }
}

interface SettingsDraftActionsDeps {
  editor: Ref<EditorSettings>
  general: Ref<GeneralSettingsState>
  commitMessage: Ref<CommitMessageInspectionSettings>
  editorDirty: Readonly<Ref<boolean>>
  generalDirty: Readonly<Ref<boolean>>
  commitMessageDirty: Readonly<Ref<boolean>>
  dirty: Readonly<Ref<boolean | undefined>>
  scopesPage: Readonly<Ref<DraftPage<NamedScopeSetting[] | null> | undefined>>
  fileColorsPage: Readonly<Ref<DraftPage<FileColorsDraft> | undefined>>
  busy: () => boolean
  valid: () => boolean
  reportEditorValidity: () => boolean | undefined
  showScopes: () => void
  save: (draft: SettingsDraft, close: boolean) => void
  close: () => void
}

/** Collect once; persistence owns serial writes and only closes after success. */
export function createSettingsDraftActions(deps: SettingsDraftActionsDeps) {
  function applyAll(closeAfterSave = false) {
    if (deps.busy() || !deps.valid()) return
    if (deps.editorDirty.value && !deps.reportEditorValidity()) return
    const scopes = deps.scopesPage.value?.dirty ? deps.scopesPage.value.getDraft() : undefined
    if (scopes === null) {
      deps.showScopes()
      return
    }
    const colors = deps.fileColorsPage.value?.dirty ? deps.fileColorsPage.value.getDraft() : undefined
    deps.save({
      editor: deps.editorDirty.value ? { ...deps.editor.value } : undefined,
      general: deps.generalDirty.value ? { ...deps.general.value } : undefined,
      commitMessage: deps.commitMessageDirty.value ? { ...deps.commitMessage.value } : undefined,
      scopes,
      localFileColors: colors?.local,
      fileColors: colors?.shared,
    }, closeAfterSave)
  }
  function ok() {
    if (deps.busy()) return
    if (!deps.dirty.value) {
      deps.close()
      return
    }
    applyAll(true)
  }
  return { applyAll, ok }
}
