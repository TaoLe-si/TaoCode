import { request } from './bridge'

export interface ProjectMemoryFileSummary {
  name: string
  path: string
  kind: 'index' | 'item'
  size: number
  updatedAt: number
}

export interface ProjectMemoryWorkspaceSummary {
  id: string
  label: string
  updatedAt: number
  files: ProjectMemoryFileSummary[]
}

export function listProjectMemories(): Promise<ProjectMemoryWorkspaceSummary[]> {
  return request<ProjectMemoryWorkspaceSummary[]>('agent.memory.list')
}

export function readProjectMemoryFile(workspaceId: string, fileName: string): Promise<{ content: string }> {
  return request<{ content: string }>('agent.memory.read', { workspaceId, fileName })
}

export function revealProjectMemoryFile(path: string): Promise<void> {
  return request<void>('shell.reveal', { path })
}
