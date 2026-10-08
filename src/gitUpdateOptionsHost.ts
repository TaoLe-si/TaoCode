import { computed, shallowRef } from 'vue'
import { updateOptionsDialogModel, type UpdateMethodId, type UpdateOptionsDialogModel } from './vcsUpdateOptions.ts'

export interface GitUpdateOptionsDialogState {
  method: UpdateMethodId
  model: UpdateOptionsDialogModel
}

export type GitUpdateOptionsChoice =
  | { kind: 'ok'; method: UpdateMethodId; showDialog: boolean }
  | { kind: 'cancel' }

interface DialogDraft {
  method: UpdateMethodId
  showDialog: boolean
}

const draft = shallowRef<DialogDraft | null>(null)
let resolveChoice: ((choice: GitUpdateOptionsChoice) => void) | undefined

export const gitUpdateOptionsDialog = computed<GitUpdateOptionsDialogState | null>(() => {
  const current = draft.value
  if (!current) return null
  const model = updateOptionsDialogModel(current, {
    setMethod: method => { draft.value = { ...current, method } },
    setShowDialog: showDialog => { draft.value = { ...current, showDialog } },
    resetToRemoteBranch: cancelGitUpdateOptionsDialog,
  }, { scopeName: '项目', repositoryCount: 1 })
  // The native reset endpoint is `git reset --hard`; IDEA uses `git checkout -B`.
  // Keep the source action model intact while withholding that non-equivalent action.
  return { method: current.method, model: { ...model, leftActions: [] } }
})

export function showGitUpdateOptionsDialog(initial: DialogDraft): Promise<GitUpdateOptionsChoice | null> {
  if (draft.value) return Promise.resolve(null)
  return new Promise(resolve => {
    resolveChoice = resolve
    draft.value = { ...initial }
  })
}

export function setGitUpdateDialogMethod(method: UpdateMethodId): void {
  if (draft.value) draft.value = { ...draft.value, method }
}

export function setGitUpdateDialogShown(showDialog: boolean): void {
  if (draft.value) draft.value = { ...draft.value, showDialog }
}

export function acceptGitUpdateOptionsDialog(): void {
  const current = draft.value
  if (!current) return
  finish({ kind: 'ok', method: current.method, showDialog: current.showDialog })
}

export function cancelGitUpdateOptionsDialog(): void {
  if (draft.value) finish({ kind: 'cancel' })
}

function finish(choice: GitUpdateOptionsChoice): void {
  const resolve = resolveChoice
  resolveChoice = undefined
  draft.value = null
  resolve?.(choice)
}
