import ignoreFactory, { type Ignore } from 'ignore'
import { reactive } from 'vue'
import { BridgeError, request, type WorkspaceSearchFileEntry, type WorkspaceSearchFileList } from './bridge.ts'

export const WORKSPACE_FILE_SEARCH_IGNORE_FILE = '.zcodeignore'
export const WORKSPACE_FILE_SEARCH_GITIGNORE_FILE = '.gitignore'

const BUILTIN_IGNORE_LINES = [
  '.git/', '.hg/', '.svn/', 'node_modules/', 'bower_components/', 'jspm_packages/',
  '__pycache__/', 'site-packages/', 'venv/', 'coverage/', 'htmlcov/', 'lcov-report/',
  'cmakefiles/', 'cmake-build-*/', 'bazel-*/', 'pods/', 'deriveddata/',
  'storybook-static/', 'playwright-report/', 'test-results/', 'allure-results/',
  'allure-report/', 'cdk.out/', '*.egg-info/', '*.dist-info/', 'eggs/',
  'pip-wheel-metadata/', 'wheels/',
]

const TEMPLATE_HEADER = [
  '# ZCode 工作区文件搜索忽略规则（.zcodeignore）',
  '# 语法与 .gitignore 一致，只影响 ZCode 的 @ 文件候选 / Command Center / 文件树搜索，',
  '# 不影响文件树浏览、上传或 Agent 文件访问。',
  '# 修改 .gitignore 不会自动同步到本文件；可在设置页「从 .gitignore 同步」。',
  '',
]

const SYNC_MARKER = '# ===== ↑ 以上同步自 .gitignore（「从 .gitignore 同步」只重写以上部分）====='
const DEFAULTS_MARKER = '# ----- ↑ 以上为 ZCode 默认排除规则（自定义规则请写在本行下方，不会被同步/恢复改动）-----'
const CUSTOM_HINT = '# 自定义规则写在下方（本行提示可删除）'

export interface WorkspaceFileIgnoreSnapshot {
  root: string
  content: string
  version: string | null
  mode: 'write' | 'new' | null
  source: 'file' | 'created' | 'fallback'
  error: string | null
}

export const workspaceFileIgnoreChanged = reactive({ root: '', revision: 0 })

const SKIPPED_FILE_NAMES = new Set(['coverage.out', 'lcov.info'])
const SKIPPED_FILE_EXTENSIONS = new Set([
  '.a', '.aar', '.beam', '.class', '.dll', '.dylib', '.ear', '.exe', '.gcda', '.gcno',
  '.gem', '.hi', '.idb', '.ilk', '.jar', '.lib', '.node', '.nupkg', '.o', '.obj',
  '.pdb', '.profdata', '.profraw', '.pyc', '.pyo', '.rlib', '.so', '.tsbuildinfo', '.war',
])
let candidateRequest: { root: string; promise: Promise<WorkspaceSearchFileEntry[]> } | null = null

function buildWorkspaceFileSearchIgnoreTemplate(gitignoreContent: string | null): string {
  const gitignoreSection = gitignoreContent !== null && gitignoreContent.trim().length > 0
    ? gitignoreContent.endsWith('\n') ? gitignoreContent : `${gitignoreContent}\n`
    : `${TEMPLATE_HEADER.join('\n')}\n`
  return [gitignoreSection, SYNC_MARKER, buildBuiltinDefaultsSection(gitignoreContent), DEFAULTS_MARKER, CUSTOM_HINT, ''].join('\n')
}

function buildBuiltinDefaultsSection(gitignoreContent: string | null): string {
  if (gitignoreContent === null) return BUILTIN_IGNORE_LINES.join('\n')
  const declared = new Set<string>()
  for (const rawLine of gitignoreContent.split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith('!')) continue
    declared.add(line)
    declared.add(line.replace(/\/$/u, ''))
  }
  return BUILTIN_IGNORE_LINES.filter(line => {
    const bare = line.replace(/\/$/u, '')
    return !declared.has(line) && !declared.has(bare)
  }).join('\n')
}

function splitSections(content: string): { gitignore: string; defaults: string; custom: string } | null {
  const lines = content.split(/\r?\n/u)
  const syncIndex = lines.findIndex(line => line.trim() === SYNC_MARKER)
  const defaultsIndex = lines.findIndex(line => line.trim() === DEFAULTS_MARKER)
  if (syncIndex < 0 || defaultsIndex <= syncIndex) return null
  return {
    gitignore: lines.slice(0, syncIndex).join('\n'),
    defaults: lines.slice(syncIndex + 1, defaultsIndex).join('\n').trim(),
    custom: lines.slice(defaultsIndex + 1).join('\n').replace(/^\n+/u, ''),
  }
}

export async function transformWorkspaceFileSearchIgnore(
  root: string,
  content: string,
  transform: 'sync-gitignore' | 'reset-defaults',
): Promise<string> {
  const gitignore = await readOptionalFile(root, WORKSPACE_FILE_SEARCH_GITIGNORE_FILE).catch(() => null)
  const sections = splitSections(content)
  if (!sections) return buildWorkspaceFileSearchIgnoreTemplate(gitignore)
  const gitignoreSection = gitignore !== null && gitignore.trim().length > 0
    ? gitignore.endsWith('\n') ? gitignore : `${gitignore}\n`
    : `${TEMPLATE_HEADER.join('\n')}\n`
  const next = transform === 'sync-gitignore'
    ? [gitignoreSection, SYNC_MARKER, sections.defaults, DEFAULTS_MARKER, sections.custom]
    : [sections.gitignore, SYNC_MARKER, buildBuiltinDefaultsSection(sections.gitignore), DEFAULTS_MARKER, sections.custom]
  return next.join('\n').replace(/\n+$/u, '\n')
}

async function loadWorkspaceFileSearchIgnore(root: string): Promise<WorkspaceFileIgnoreSnapshot> {
  try {
    const saved = await readFile(WORKSPACE_FILE_SEARCH_IGNORE_FILE)
    return { root, content: saved.content, version: saved.version, mode: 'write', source: 'file', error: null }
  } catch (error) {
    if (!isMissing(error)) {
      const fallback = await readOptionalFile(root, WORKSPACE_FILE_SEARCH_GITIGNORE_FILE).catch(() => null)
      return {
        root, content: fallback ?? buildWorkspaceFileSearchIgnoreTemplate(null), version: null, mode: null,
        source: 'fallback', error: messageOf(error),
      }
    }
  }

  const gitignore = await readOptionalFile(root, WORKSPACE_FILE_SEARCH_GITIGNORE_FILE).catch(() => null)
  const content = buildWorkspaceFileSearchIgnoreTemplate(gitignore)
  try {
    const created = await request<{ version: string }>('file.writeNew', { path: WORKSPACE_FILE_SEARCH_IGNORE_FILE, content })
    return { root, content, version: created.version, mode: 'write', source: 'created', error: null }
  } catch (error) {
    if (codeOf(error) === 'EXISTS') {
      try {
        const saved = await readFile(WORKSPACE_FILE_SEARCH_IGNORE_FILE)
        return { root, content: saved.content, version: saved.version, mode: 'write', source: 'file', error: null }
      } catch (readError) {
        return { root, content, version: null, mode: 'new', source: 'fallback', error: messageOf(readError) }
      }
    }
    return { root, content, version: null, mode: 'new', source: 'fallback', error: messageOf(error) }
  }
}

export async function readWorkspaceFileSearchIgnoreForSettings(root: string): Promise<WorkspaceFileIgnoreSnapshot> {
  try {
    const saved = await readFile(WORKSPACE_FILE_SEARCH_IGNORE_FILE)
    return { root, content: saved.content, version: saved.version, mode: 'write', source: 'file', error: null }
  } catch (error) {
    if (!isMissing(error)) {
      return {
        root, content: '', version: null, mode: null, source: 'fallback', error: messageOf(error),
      }
    }
  }

  const gitignore = await readOptionalFile(root, WORKSPACE_FILE_SEARCH_GITIGNORE_FILE).catch(() => null)
  return {
    root, content: buildWorkspaceFileSearchIgnoreTemplate(gitignore), version: null,
    mode: 'new', source: 'fallback', error: null,
  }
}

export async function saveWorkspaceFileSearchIgnore(
  content: string,
  snapshot: WorkspaceFileIgnoreSnapshot,
): Promise<WorkspaceFileIgnoreSnapshot> {
  if (snapshot.mode === 'new') {
    const created = await request<{ version: string }>('file.writeNew', { path: WORKSPACE_FILE_SEARCH_IGNORE_FILE, content })
    markWorkspaceFileIgnoreChanged(snapshot.root)
    return { root: snapshot.root, content, version: created.version, mode: 'write', source: 'file', error: null }
  }
  if (snapshot.mode !== 'write' || snapshot.version === null) throw new BridgeError('READ_ONLY', '无法保存工作区搜索规则。')
  const saved = await request<{ version: string }>('file.write', {
    path: WORKSPACE_FILE_SEARCH_IGNORE_FILE, content, expectedVersion: snapshot.version,
    encoding: 'utf-8', bom: false, safeWrite: true,
  })
  markWorkspaceFileIgnoreChanged(snapshot.root)
  return { root: snapshot.root, content, version: saved.version, mode: 'write', source: 'file', error: null }
}

/**
 * 取一次工作区文件候选（已按 `.zcodeignore` 过滤）。
 *
 * 默认会复用**同一个根的在途请求**（同一个根被两个消费方同时要时只扫一次盘）。
 * `fresh: true` 表示调用方明确要一份"此刻"的快照：不复用缓存，另起一次扫描。
 * 用它的场合是**磁盘已经变了**（Search Everywhere 收到文件变化推送、或换了一轮会话）——
 * 在途那次扫描是在变化之前发出的，拿它回来就是一份过期清单。
 * 注意：`fresh` 不会去取消同根的在途扫描 —— 那一份可能正被另一个消费方等待
 * （`src/agentPanelPromptMenu.ts` 的 @ 文件候选），取消它会把别人的加载打成失败。
 * 过期的那一份由调用方自己按请求序号丢弃。
 */
export function loadWorkspaceFileSearchEntries(root: string, options: { fresh?: boolean } = {}): Promise<WorkspaceSearchFileEntry[]> {
  if (!options.fresh && candidateRequest?.root === root) return candidateRequest.promise
  if (candidateRequest && candidateRequest.root !== root) void request('workspace.searchFiles.cancel').catch(() => undefined)
  const promise = (async () => {
    const [scan, snapshot] = await Promise.all([
      request<WorkspaceSearchFileList>('workspace.searchFiles'),
      loadWorkspaceFileSearchIgnore(root),
    ])
    if (scan.cancelled) throw new BridgeError('CANCELLED', '搜索已取消。')
    const matcher = buildMatcher(snapshot.content)
    return scan.entries.filter(entry => entry.path !== WORKSPACE_FILE_SEARCH_IGNORE_FILE &&
      !matcher.ignores(entry.type === 'directory' ? `${entry.path}/` : entry.path) &&
      isSearchableWorkspaceEntry(entry))
  })()
  const requestState = { root, promise }
  candidateRequest = requestState
  void promise.then(
    () => { if (candidateRequest === requestState) candidateRequest = null },
    () => { if (candidateRequest === requestState) candidateRequest = null },
  )
  return promise
}

function buildMatcher(content: string): Ignore {
  return ignoreFactory().add(content)
}

function markWorkspaceFileIgnoreChanged(root: string): void {
  if (candidateRequest?.root === root) {
    void request('workspace.searchFiles.cancel').catch(() => undefined)
    candidateRequest = null
  }
  workspaceFileIgnoreChanged.root = root
  workspaceFileIgnoreChanged.revision += 1
}

function isSearchableWorkspaceEntry(entry: WorkspaceSearchFileEntry): boolean {
  const path = entry.path
  if (entry.type === 'directory') return !path.split('/').some(segment => segment.startsWith('.'))
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
  if (name === '.env' || name.startsWith('.env.') || SKIPPED_FILE_NAMES.has(name)) return false
  const dot = name.lastIndexOf('.')
  return !SKIPPED_FILE_EXTENSIONS.has(dot > 0 ? name.slice(dot) : '')
}

async function readFile(path: string): Promise<{ content: string; version: string }> {
  return request<{ content: string; version: string }>('file.read', { path })
}

async function readOptionalFile(root: string, path: string): Promise<string | null> {
  if (!root) return null
  try { return (await readFile(path)).content } catch (error) {
    if (isMissing(error)) return null
    throw error
  }
}

function isMissing(error: unknown): boolean { return codeOf(error) === 'NOT_FOUND' }
function codeOf(error: unknown): string | null { return error instanceof BridgeError ? error.code : null }
function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error) }
