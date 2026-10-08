import { request } from './bridge.ts'

export type AgentSkillScope = 'workspace' | 'user' | 'plugin'

export interface AgentSkillMetadata {
  slug?: string
  version?: string
  ownerId?: string
  publishedAt?: number
}

export interface AgentSkill {
  id: string
  name: string
  description: string
  body: string
  path: string
  sourcePath: string
  scope: AgentSkillScope
  enabled: boolean
  pluginName?: string
  pluginId?: string
  metadata?: AgentSkillMetadata
}

export interface AgentSkillDiagnostic {
  code: string
  severity: 'error' | 'warning'
  message: string
  path?: string
  skillName?: string
}

export interface AgentSkillsList {
  skills: AgentSkill[]
  capability: { userScopeAvailable: boolean }
  diagnostics: AgentSkillDiagnostic[]
}

export interface AgentSkillPromptContext {
  prompt: string
  activatedSkillNames: string[]
}

export function listAgentSkills(workspacePath: string): Promise<AgentSkillsList> {
  return request<AgentSkillsList>('agent.skills.list', { workspacePath })
}

export function setAgentSkillEnabled(workspacePath: string, skillId: string, enabled: boolean): Promise<AgentSkillsList> {
  return request<AgentSkillsList>('agent.skills.setEnabled', { workspacePath, skillId, enabled })
}

export function deleteAgentSkill(workspacePath: string, skillId: string): Promise<AgentSkillsList> {
  return request<AgentSkillsList>('agent.skills.delete', { workspacePath, skillId })
}

export function revealAgentSkill(workspacePath: string, skillId: string): Promise<{ opened?: boolean }> {
  return request<{ opened?: boolean }>('agent.skills.reveal', { workspacePath, skillId })
}

export function buildAgentSkillPromptContext(workspacePath: string, prompt: string): Promise<AgentSkillPromptContext> {
  return request<AgentSkillPromptContext>('agent.skills.promptContext', { workspacePath, prompt })
}
