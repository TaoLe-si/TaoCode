import { AGENT_TOOLBAR_KEY_BINDINGS, matchesKeyChord } from './keymapBindings.ts'
import { effectiveKeyBindings } from './keymapEditor.ts'

export type AgentComposerShortcutAction = (typeof AGENT_TOOLBAR_KEY_BINDINGS)[number]['id']

export function isAgentComposerShortcutTarget(target: EventTarget | null): boolean {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false
  return Boolean(target.closest('.agent'))
}

export function resolveAgentComposerShortcut(event: KeyboardEvent): AgentComposerShortcutAction | null {
  if (event.defaultPrevented || event.repeat || event.isComposing) return null
  const bindings = effectiveKeyBindings()
  for (const action of AGENT_TOOLBAR_KEY_BINDINGS) {
    const binding = bindings.find(item => item.id === action.id)
    if (binding && matchesKeyChord(binding.chord, event)) return action.id
  }
  return null
}

export function shouldDelegateAgentComposerShortcut(event: KeyboardEvent): boolean {
  if (!isAgentComposerShortcutTarget(event.target)) return false
  const target = event.target instanceof Element ? event.target : null
  const agent = target?.closest<HTMLElement>('.agent')
    ?? document.querySelector<HTMLElement>('.agent')
  if (agent?.getAttribute('aria-busy') === 'true') return false
  const action = resolveAgentComposerShortcut(event)
  return action === 'openModelMenu'
    && Boolean(agent?.querySelector('.agent-model-wrap button:not(:disabled)'))
}
