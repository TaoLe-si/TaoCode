// 浏览器预览的**内存桩**：`vite dev` 下没有 WebView2 宿主，前端要能点得动。
//
// 为什么单独成文件（2026-10-05 模块化体检）：bridge.ts 贴着机检上限（1208 行，只剩 9 行余量），
// 而这一段是**与「桥接的类型与封装」无关的职责** —— 它不 postMessage，只在几个内存 Map 上读写，
// 并且刻意把「预览做不到的事」（lsp./run./git./dap./term. …）逐族回成 BridgeError。
// 留在 bridge.ts 里等于让「桥的类型」和「示例数据」两个域挤在一个文件。
//
// 搬出来时**一个字没改**：general 键白名单（`key === 'fuzzyFileSearch'` 那一条）、file.write 的
// 版本冲突、INVALID_SETTINGS 的各条文案都还在这里，所以那两条读源码的门禁把锚点改到本文件即可
//（见 tests/b6-verdict.test.mjs 与 tests/html-export.test.mjs 里的注释）。
//
// 形状与默认值全部来自各自的域（settingsModel / previewSettings / bookmarkSettings / gradle …），
// 这里只做「预览态的第二道关卡」，与原生 validate_* 同一口径。

import { normalizeFileColor, normalizeFileColors } from './fileColors.ts'
import { normalizeBookmarkLists, normalizeBookmarks, normalizeBookmarksView } from './bookmarkSettings.ts'
import { errorMessage } from './errors.ts'
import { previewSettingsError } from './previewSettings.ts'
import { normalizeRunConfigurations } from './runConfigurationSchema.ts'
import { validateTodoPatterns } from './todoPatterns.ts'
import { normalizeTrustedPath } from './trustedProjects.ts'
import { AUDIO_CUE_IDS, type AudioCueId } from './audioCues.ts'
import { EDITOR_LANGUAGES } from './languages.ts'
import type { TemplateSettings } from './templates'
import { DEFAULT_BUILD_TOOLS } from './gradle.ts'
import type { AutoReloadType, BuildToolsGradleSettings, BuildToolsSettings } from './gradle.ts'
import { BridgeError } from './bridgeError.ts'
import {
  defaultEditorSettings, defaultExportToHtmlSettings, defaultGeneralSettings, defaultProjectSettings,
  type AppState, type ExportToHtmlSettings, type GeneralSettingsState, type JavaProjectSettings,
  type NamedScopeSetting, type ProjectSettings, type TodoPattern,
} from './settingsModel.ts'
import type { Entry, Method } from './bridge.ts'

const previewRoot = '内存示例 / 不访问本地磁盘'
const samples = new Map<string, string>([
  ['src/main.cpp', '#include <iostream>\n#include "workspace.hpp"\n\nint main() {\n    taocode::Workspace workspace;\n\n    // 浏览器示例：编辑仅保存在内存，不会写入磁盘。\n    std::cout << "Welcome to TaoCode" << std::endl;\n    return 0;\n}\n'],
  ['src/workspace.hpp', '#pragma once\n\nnamespace taocode {\n\nclass Workspace {\npublic:\n    void open();\n};\n\n}\n'],
  ['CMakeLists.txt', 'cmake_minimum_required(VERSION 3.24)\nproject(taocode_preview LANGUAGES CXX)\n\nset(CMAKE_CXX_STANDARD 20)\nadd_executable(preview src/main.cpp)\n'],
])
const versions = new Map([...samples.keys()].map(path => [path, 1]))
const previewState: AppState = { recentProjects: [{ name: 'TaoCode 内存示例', path: previewRoot, lastOpened: '', available: true }], settings: { ...defaultEditorSettings }, general: { ...defaultGeneralSettings }, lastProject: null, gitAvailable: false, defaultParent: '' }
let previewProjectSettings: ProjectSettings = structuredClone(defaultProjectSettings)
function previewEntries(path: string): Entry[] {
  const prefix = path ? `${path}/` : ''
  const entries = new Map<string, Entry>()
  for (const file of samples.keys()) {
    if (!file.startsWith(prefix)) continue
    const rest = file.slice(prefix.length)
    const name = rest.split('/')[0]!
    if (rest.includes('/') && previewProjectSettings.excludedDirs.includes(name)) continue
    entries.set(name, { name, path: prefix + name, kind: rest.includes('/') ? 'directory' : 'file' })
  }
  return [...entries.values()].sort((a, b) => Number(b.kind === 'directory') - Number(a.kind === 'directory') || a.name.localeCompare(b.name))
}
export async function previewRequest(method: Method, params: Record<string, unknown>): Promise<unknown> {
  if (method.startsWith('lsp.')) throw new BridgeError('LSP_UNAVAILABLE', '浏览器预览无语言服务，请在桌面端使用。')
  if (method.startsWith('run.')) throw new BridgeError('DESKTOP_REQUIRED', '浏览器预览不能运行命令，请在桌面端使用。')
  if (method.startsWith('git.')) throw new BridgeError('DESKTOP_REQUIRED', '浏览器预览不能操作 Git，请在桌面端使用。')
  if (method.startsWith('search.')) throw new BridgeError('DESKTOP_REQUIRED', '浏览器预览不能全局搜索，请在桌面端使用。')
  if (method.startsWith('dap.')) throw new BridgeError('DESKTOP_REQUIRED', '浏览器预览不能启动调试器，请在桌面端使用。')
  if (method.startsWith('term.')) throw new BridgeError('DESKTOP_REQUIRED', '浏览器预览不能开本地终端，请在桌面端使用。')
  if (method.startsWith('history.')) throw new BridgeError('DESKTOP_REQUIRED', '浏览器预览没有本地历史，请在桌面端使用。')
  if (method.startsWith('plugin.')) throw new BridgeError('DESKTOP_REQUIRED', '浏览器预览不能读写本机插件目录，请在桌面端使用。')
  if (method.startsWith('gradle.')) throw new BridgeError('DESKTOP_REQUIRED', '浏览器预览不能运行 Gradle 同步，请在桌面端使用。')
  if (method === 'dialog.pickFile' || method === 'dialog.saveFile' || method === 'app.exportSettings' || method === 'app.readSettingsArchive' || method === 'app.importSettings' || method === 'app.resetSettings' || method === 'app.writeExportFiles') throw new BridgeError('DESKTOP_REQUIRED', '浏览器预览不能打开系统文件对话框、读写设置归档或导出文件，请在桌面端使用。')
  if (method === 'file.create' || method === 'file.rename' || method === 'file.delete' || method === 'file.copy' || method === 'file.reveal' || method === 'shell.reveal' || method === 'file.readOnly' || method === 'file.lineSeparators' || method.startsWith('session.'))
    throw new BridgeError('DESKTOP_REQUIRED', '浏览器预览不能改动磁盘文件树，请在桌面端使用。')
  const path = String(params.path ?? '')
  switch (method) {
    case 'app.state': return structuredClone(previewState)
    case 'workspace.open': {
      if (path && path !== previewRoot) throw new BridgeError('DESKTOP_REQUIRED', '浏览器只能打开内存示例；请使用桌面端访问本地项目。')
      previewState.lastProject = previewRoot
      previewState.recentProjects = [{ name: 'TaoCode 内存示例', path: previewRoot, lastOpened: new Date().toISOString(), available: true }]
      return { name: 'taocode-preview', root: previewRoot, entries: previewEntries('') }
    }
    case 'workspace.close': previewState.lastProject = null; return { closed: true }
    case 'app.internalErrors': return { count: 0, latest: [] }
    case 'workspace.list': return previewEntries(path)
    // The browser sample has no disk walk; the in-memory sample map *is* the project
    // tree, so the same "excluded directory" rule as previewEntries produces it.
    case 'workspace.files': {
      const files = [...samples.keys()].filter(file =>
        !file.split('/').slice(0, -1).some(part => previewProjectSettings.excludedDirs.includes(part))).sort()
      return { files, truncated: false }
    }
    case 'projects.forget': previewState.recentProjects = previewState.recentProjects.filter(project => project.path !== path); return structuredClone(previewState)
    case 'projects.forgetMany': {
      const set = new Set(Array.isArray(params?.paths) ? params.paths as string[] : [])
      previewState.recentProjects = previewState.recentProjects.filter(project => !set.has(project.path))
      return structuredClone(previewState)
    }
    case 'project.settings.get': return structuredClone(previewProjectSettings)
    case 'project.settings.update': {
      const next = { ...previewProjectSettings }
      if (params.excludedDirs !== undefined) {
        const excludedDirs = params.excludedDirs
        if (!Array.isArray(excludedDirs) || excludedDirs.some(name => typeof name !== 'string' || !name || name === '.' || name === '..' || /[\\/:]/.test(name))) throw new BridgeError('INVALID_SETTINGS', '排除项必须是单独的目录名。')
        next.excludedDirs = [...new Set(excludedDirs as string[])]
      }
      if (params.todoPatterns !== undefined) {
        const patterns = params.todoPatterns as TodoPattern[]
        // 形状规则与设置页/原生同一份（src/todoPatterns.ts），不再在这里手抄一遍。
        const problem = validateTodoPatterns(patterns)
        if (problem) throw new BridgeError('INVALID_SETTINGS', problem)
        // caseSensitive / color 是可选的：原生 validate_todo_patterns 只在**给出时**校验、不补默认值，
        // 所以这里也不能凭空插值（否则预览与桌面端存下来的形状就不一样了）。
        next.todoPatterns = patterns.map(entry => {
          const shaped: TodoPattern = { pattern: entry.pattern.trim(), description: entry.description.trim() }
          if (entry.caseSensitive !== undefined) shaped.caseSensitive = entry.caseSensitive
          if (entry.color !== undefined) shaped.color = entry.color
          return shaped
        })
      }
      // 书签两段的形状校验在 src/bookmarkSettings.ts（桥接文件贴着机检上限；那边也能单测）。
      if (params.bookmarks !== undefined) {
        try {
          next.bookmarks = normalizeBookmarks(params.bookmarks)
        } catch (error) { throw new BridgeError('INVALID_SETTINGS', errorMessage(error)) }
      }
      if (params.bookmarkLists !== undefined) {
        try {
          next.bookmarkLists = normalizeBookmarkLists(params.bookmarkLists)
        } catch (error) { throw new BridgeError('INVALID_SETTINGS', errorMessage(error)) }
      }
      if (params.bookmarksView !== undefined) {
        try {
          next.bookmarksView = { ...(next.bookmarksView ?? defaultProjectSettings.bookmarksView!), ...normalizeBookmarksView(params.bookmarksView) }
        } catch (error) { throw new BridgeError('INVALID_SETTINGS', errorMessage(error)) }
      }
      if (params.fileAssociations !== undefined) {
        const value = params.fileAssociations as Record<string, unknown>
        const languages = ['java', 'cpp', 'typescript', 'other']
        const malformed = !value || typeof value !== 'object' || Array.isArray(value) || Object.entries(value).some(([key, language]) =>
          !/^[a-z0-9]{1,16}$/.test(key) || typeof language !== 'string' || !languages.includes(language))
        if (malformed) throw new BridgeError('INVALID_SETTINGS', '文件类型关联要写成 扩展名 -> java/cpp/typescript/other。')
        next.fileAssociations = Object.fromEntries(Object.entries(value).map(([key, language]) => [key, language as string]))
      }
      // 命名作用域：与原生 `validate_scopes` 同一套形状规则。模式语法**故意不校验** ——
      // IDEA 也允许存下解析不了的模式（NamedScopesHolder.readScope :137-142）。
      if (params.scopes !== undefined) {
        const list = params.scopes as NamedScopeSetting[]
        const encoder = new TextEncoder()
        const keys = ['name', 'pattern', 'shared']
        const malformed = !Array.isArray(list) || list.length > 64 || list.some(entry =>
          !entry || typeof entry !== 'object' || Array.isArray(entry)
          || Object.keys(entry).some(key => !keys.includes(key))
          || typeof entry.name !== 'string' || !entry.name || /[\r\n\t]/.test(entry.name) || encoder.encode(entry.name).length > 80
          || typeof entry.pattern !== 'string' || encoder.encode(entry.pattern).length > 1024
          || typeof entry.shared !== 'boolean')
          || new Set(list.map(entry => entry.name)).size !== list.length
        if (malformed) throw new BridgeError('INVALID_SETTINGS', '作用域要写成 {name, pattern, shared}：名称非空且不重名，模式不超过 1024 字节。')
        next.scopes = list.map(entry => ({ name: entry.name, pattern: entry.pattern, shared: entry.shared }))
      }
      for (const key of ['fileColors', 'localFileColors'] as const) {
        const value = params[key]
        if (value === undefined) continue
        const malformed = !Array.isArray(value) || value.length > 64 || normalizeFileColors(value).length !== value.length ||
          value.some(entry => !entry || typeof entry !== 'object' || Array.isArray(entry) ||
            Object.keys(entry).some(key => key !== 'scope' && key !== 'color') ||
            typeof entry.scope !== 'string' || !entry.scope || new TextEncoder().encode(entry.scope).length > 80 ||
            /[\r\n\t]/.test(entry.scope) || normalizeFileColor(entry.color) === null) ||
          new Set(value.map(entry => entry.scope)).size !== value.length
        if (malformed) throw new BridgeError('INVALID_SETTINGS', `无效文件颜色：${key}`)
        next[key] = normalizeFileColors(value)
      }
      if (params.templates !== undefined) {
        const value = params.templates as Partial<TemplateSettings>
        const encoder = new TextEncoder()
        const text = (value: unknown, max: number) => typeof value === 'string' && value.length > 0 && encoder.encode(value).length <= max
        const overrides = value?.overrides === undefined ? previewProjectSettings.templates.overrides : value.overrides
        const customs = value?.customs === undefined ? previewProjectSettings.templates.customs : value.customs
        const bad = !value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['overrides', 'customs'].includes(key))
          || !Array.isArray(overrides) || !Array.isArray(customs)
          || overrides.length > 400 || overrides.some(entry => !entry || Object.keys(entry).some(key => !['pattern', 'disabled'].includes(key))
            || !text(entry.pattern, 300) || typeof entry.disabled !== 'boolean')
          || new Set(overrides.map(entry => entry.pattern)).size !== overrides.length
          || customs.length > 100 || customs.some(entry => !entry || Object.keys(entry).some(key => !['key', 'body', 'description', 'languages'].includes(key))
            || typeof entry.key !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(entry.key)
            || !text(entry.body, 8000) || !text(entry.description, 120)
            || !Array.isArray(entry.languages) || entry.languages.some(language => !['java', 'cpp', 'typescript', 'other'].includes(language)))
          || new Set(customs.map(entry => entry.key)).size !== customs.length
        if (bad) throw new BridgeError('INVALID_SETTINGS', '模板设置要写成 { overrides:[{pattern,disabled}], customs:[{key,body,description,languages}] }。')
        next.templates = {
          overrides: overrides.map(entry => ({ pattern: entry.pattern, disabled: entry.disabled })),
          customs: customs.map(entry => ({ key: entry.key, body: entry.body, description: entry.description, languages: [...entry.languages] })),
        }
      }
      if (params.java !== undefined) {
        const raw = params.java as Partial<JavaProjectSettings> | null | undefined
        const relative = (path: unknown, glob = false) => typeof path === 'string' && path.length > 0 && path.length <= 512 && !path.startsWith('/') &&
          !/[\\:<>"\u0000-\u001f]/.test(path) && (glob || !/[*?]/.test(path)) &&
          path.split('/').every(part => part && part !== '..')
        const parseJava = (): JavaProjectSettings | null => {
          if (!raw || Array.isArray(raw) || Object.keys(raw).some(key => !['jdkHome', 'jdkName', 'sourcePaths', 'outputPath', 'referencedLibraries'].includes(key))) return null
          if (typeof raw.jdkHome !== 'string' || raw.jdkHome.length > 1024 || /[\u0000-\u001f]/.test(raw.jdkHome) ||
            (raw.jdkHome && !/^[A-Za-z]:[\\/]|^\\\\/.test(raw.jdkHome))) return null
          if (typeof raw.jdkName !== 'string' || !/^(1\.[1-8]|[1-9][0-9](-ea)?|JavaSE-1\.8|JavaSE-(9|[1-9][0-9]))$/.test(raw.jdkName)) return null
          if (typeof raw.outputPath !== 'string' || (raw.outputPath && !relative(raw.outputPath))) return null
          const list = (paths: unknown, glob: boolean) => {
            if (!Array.isArray(paths) || paths.length > 64 || !paths.every(path => relative(path, glob))) return null
            const unique = [...new Set(paths.filter(Boolean))]
            return unique.length === paths.length ? unique as string[] : null
          }
          const sourcePaths = list(raw.sourcePaths, false)
          const libraries = list(raw.referencedLibraries, true)
          return sourcePaths && libraries ? { jdkHome: raw.jdkHome, jdkName: raw.jdkName, sourcePaths, outputPath: raw.outputPath, referencedLibraries: libraries } : null
        }
        const java = parseJava()
        if (!java) throw new BridgeError('INVALID_SETTINGS', 'Java 设置需要绝对 JDK 路径（可留空）、JavaSE 环境名和工作区内路径。')
        next.java = java
      }
      if (params.runConfigs !== undefined) {
        try { next.runConfigs = normalizeRunConfigurations(params.runConfigs) }
        catch (error) { throw new BridgeError('INVALID_SETTINGS', errorMessage(error)) }
      }
      // 构建工具（IDEA `build.tools` 组 + Gradle 页）。**项目级**：IDEA 的
      // `ExternalSystemGroupConfigurable` 是 projectConfigurable，Gradle 三项在 `GradleSettings`
      // （`.idea/gradle.xml`）。校验口径与 native `validate_build_tools` 完全一致。
      if (params.buildTools !== undefined) {
        const raw = params.buildTools as (Partial<BuildToolsSettings> & { gradle?: Partial<BuildToolsGradleSettings> }) | null | undefined
        const reloadTypes: readonly AutoReloadType[] = ['ALL', 'SELECTIVE', 'NONE']
        const distributions: readonly BuildToolsGradleSettings['useGradleFrom'][] = ['wrapper', 'local', 'path']
        const rawGradle = raw && !Array.isArray(raw) ? raw.gradle : undefined
        const pathField = (value: unknown) => typeof value === 'string' && value.length <= 512 && !/[\u0000-\u001f]/.test(value)
        const malformed = !raw || typeof raw !== 'object' || Array.isArray(raw)
          || Object.keys(raw).some(key => !['autoReloadType', 'previousAutoReloadType', 'gradle'].includes(key))
          || (raw.autoReloadType !== undefined && !reloadTypes.includes(raw.autoReloadType as AutoReloadType))
          || (raw.previousAutoReloadType !== undefined && !reloadTypes.includes(raw.previousAutoReloadType as AutoReloadType))
          || (rawGradle !== undefined && (!rawGradle || typeof rawGradle !== 'object' || Array.isArray(rawGradle)
            || Object.keys(rawGradle).some(key => !['enabled', 'useGradleFrom', 'gradlePath', 'gradleUserHome', 'offline'].includes(key))
            || (rawGradle.useGradleFrom !== undefined && !distributions.includes(rawGradle.useGradleFrom as BuildToolsGradleSettings['useGradleFrom']))
            || (rawGradle.gradlePath !== undefined && !pathField(rawGradle.gradlePath))
            || (rawGradle.gradleUserHome !== undefined && !pathField(rawGradle.gradleUserHome))
            || (rawGradle.offline !== undefined && typeof rawGradle.offline !== 'boolean')
            || (rawGradle.enabled !== undefined && typeof rawGradle.enabled !== 'boolean')))
        if (malformed) throw new BridgeError('INVALID_SETTINGS', '构建工具设置要写成 {autoReloadType, previousAutoReloadType, gradle: {useGradleFrom, gradlePath, gradleUserHome, offline}}。')
        const base = next.buildTools ?? structuredClone(DEFAULT_BUILD_TOOLS)
        next.buildTools = { ...base, ...raw, gradle: { ...base.gradle, ...(rawGradle ?? {}) } }
      }
      // 导出到 HTML（IDEA `ExportToHTMLSettings`，项目级）：范围只允许 0/1/2/4，其余字段各有类型。
      if (params.exportToHtml !== undefined) {
        const raw = params.exportToHtml as Partial<ExportToHtmlSettings> | null | undefined
        const scopes = [0, 1, 2, 4]
        const malformed = !raw || typeof raw !== 'object' || Array.isArray(raw)
          || Object.keys(raw).some(key => !['scope', 'includeSubdirectories', 'printLineNumbers', 'openInBrowser', 'outputDirectory'].includes(key))
          || (raw.scope !== undefined && !scopes.includes(Number(raw.scope)))
          || (raw.includeSubdirectories !== undefined && typeof raw.includeSubdirectories !== 'boolean')
          || (raw.printLineNumbers !== undefined && typeof raw.printLineNumbers !== 'boolean')
          || (raw.openInBrowser !== undefined && typeof raw.openInBrowser !== 'boolean')
          || (raw.outputDirectory !== undefined && (typeof raw.outputDirectory !== 'string' || raw.outputDirectory.length > 512))
        if (malformed) throw new BridgeError('INVALID_SETTINGS', '导出到 HTML 的设置要写成 {scope: 0|1|2|4, includeSubdirectories, printLineNumbers, openInBrowser, outputDirectory}。')
        next.exportToHtml = { ...(next.exportToHtml ?? defaultExportToHtmlSettings), ...raw }
      }
      previewProjectSettings = params.foldingState === undefined ? next : { ...next, foldingState: params.foldingState as ProjectSettings['foldingState'] }  // 折叠状态只透传（形状/上限在原生）
      return { settings: structuredClone(previewProjectSettings), entries: previewEntries('') }
    }
    // Source: GeneralSettings.kt:227-266 — the same fields the native side
    // validates in validate_general_patch; the preview keeps one state object
    // like GeneralSettings.getInstance() does.
    case 'settings.general.update': {
      const patch = (params.general ?? {}) as Record<string, unknown>
      if (!patch || typeof patch !== 'object') throw new BridgeError('INVALID_SETTINGS', '设置必须是对象')
      for (const [key, value] of Object.entries(patch)) {
        const accepted = key === 'defaultProjectDirectory' || key === 'reopenLastProject' ||
          key === 'deleteToBin' || key === 'autoSyncFiles' || key === 'backgroundSyncFiles' ||
          key === 'autoSaveFiles' || key === 'autoSaveIfInactive' || key === 'isUseSafeWrite' ||
          key === 'confirmExit' || key === 'isShowWelcomeScreen' || key === 'confirmOpenNewProject2' ||
          key === 'processCloseConfirmation' || key === 'inactiveTimeout' || key === 'supportScreenReaders' || key === 'audioCuesMode' || key === 'audioCuesDisabled' ||
          key === 'autoShowProcessPopup' || key === 'fuzzyFileSearch' || key === 'debuggerHideNullValues' || key === 'debuggerSortByName' || key === 'foldConsoleLines' || key === 'foldExceptions' || key === 'diffContextLines' || key === 'externalTools' || key === 'showStickyLines' || key === 'stickyLinesLimit' || key === 'trustedPaths'
        if (!accepted) throw new BridgeError('INVALID_SETTINGS', `无效设置：${key}`)
        if (key === 'inactiveTimeout') {
          // UINumericRange(15, 1, 300): values outside the range snap to the bounds.
          if (!Number.isInteger(value)) throw new BridgeError('INVALID_SETTINGS', 'inactiveTimeout 必须是整数')
        } else if (key === 'trustedPaths') {
          // 受信任项目清单：`{path, trusted}` 数组，与 native `validate_general_patch` 同一口径
          // （长度 / 路径长度 / 换行 / 重复路径都拦），桌面端真源在 native/settings_schema.cpp。
          if (!Array.isArray(value) || value.length > 256) throw new BridgeError('INVALID_SETTINGS', '无效设置：trustedPaths')
          const seen = new Set<string>()
          for (const entry of value) {
            const record = entry as { path?: unknown; trusted?: unknown } | null
            if (!record || typeof record !== 'object' || Array.isArray(record)
              || Object.keys(record).some(field => field !== 'path' && field !== 'trusted')
              || typeof record.path !== 'string' || !record.path.length || record.path.length > 1024
              || /[\r\n]/.test(record.path) || typeof record.trusted !== 'boolean')
              throw new BridgeError('INVALID_SETTINGS', '无效设置：trustedPaths')
            const normalized = normalizeTrustedPath(record.path)
            if (!normalized || seen.has(normalized)) throw new BridgeError('INVALID_SETTINGS', '无效设置：trustedPaths')
            seen.add(normalized)
          }
        } else if (key === 'confirmOpenNewProject2') {
          if (value !== null && ![-1, 0, 1, 2].includes(Number(value))) throw new BridgeError('INVALID_SETTINGS', '无效设置：confirmOpenNewProject2')
        } else if (key === 'processCloseConfirmation') {
          if (!['ASK', 'TERMINATE', 'DISCONNECT'].includes(String(value))) throw new BridgeError('INVALID_SETTINGS', '无效设置：processCloseConfirmation')
        } else if (key === 'defaultProjectDirectory') {
          if (typeof value !== 'string' || value.length > 512) throw new BridgeError('INVALID_SETTINGS', '无效设置：defaultProjectDirectory')
        } else if (key === 'audioCuesMode') {
          // AudioCuesMode 三档（AudioCuesSettings.kt:75-79）；与 native validate_general_patch 同一口径。
          if (!['auto', 'on', 'off'].includes(String(value))) throw new BridgeError('INVALID_SETTINGS', '无效设置：audioCuesMode')
        } else if (key === 'audioCuesDisabled') {
          // AudioCuesSettingsState.disabledCues（AudioCuesSettings.kt:69-72）的数组形态：
          // 只能是 IdeAudioCues.kt:13-39 的六个 cue id，最多六条（与 native 同一套规则）。
          if (!Array.isArray(value) || value.length > AUDIO_CUE_IDS.length
            || value.some(id => typeof id !== 'string' || !AUDIO_CUE_IDS.includes(id as AudioCueId)))
            throw new BridgeError('INVALID_SETTINGS', '无效设置：audioCuesDisabled')
        } else if (typeof value !== 'boolean') throw new BridgeError('INVALID_SETTINGS', `无效设置：${key}`)
      }
      const merged = { ...defaultGeneralSettings, ...previewState.general, ...patch } as GeneralSettingsState
      // GeneralSettings.inactiveTimeout clamps through SAVE_FILES_AFTER_IDLE_SEC.fit (kt:193-202).
      merged.inactiveTimeout = Math.min(300, Math.max(1, merged.inactiveTimeout))
      previewState.general = merged
      return structuredClone(merged)
    }
    case 'settings.update': {
      const patch = params.settings as Record<string, unknown>
      if (!patch || typeof patch !== 'object') throw new BridgeError('INVALID_SETTINGS', '设置必须是对象')
      // 预览态的键表与取值校验在 src/previewSettings.ts（同一条规则的第二道关卡，
      // 桌面端真源是 native/settings_schema.cpp；tests/settings-keys-parity.test.mjs 读的正是那里）。
      for (const [key, value] of Object.entries(patch)) {
        const invalid = previewSettingsError(key, value, EDITOR_LANGUAGES)
        if (invalid) throw new BridgeError('INVALID_SETTINGS', invalid)
      }
      Object.assign(previewState.settings, patch)
      return { ...previewState.settings }
    }
    case 'file.read': {
      if (!samples.has(path)) throw new BridgeError('NOT_FOUND', '示例文件不存在')
      // The in-memory samples are plain text: encoding is reported so the desktop and
      // preview shapes stay interchangeable for the UI.
      return { path, content: samples.get(path), version: String(versions.get(path)), encoding: 'utf-8', bom: false }
    }
    case 'file.write': {
      if (!samples.has(path)) throw new BridgeError('NOT_FOUND', '示例文件不存在')
      if (params.expectedVersion !== String(versions.get(path))) throw new BridgeError('CONFLICT', '文件已改变，请重新打开')
      const content = String(params.content)
      samples.set(path, content)
      const version = versions.get(path)! + 1
      versions.set(path, version)
      return { version: String(version), bytes: new TextEncoder().encode(content).length }
    }
    default: throw new BridgeError('DESKTOP_REQUIRED', '此操作需要 C++ 桌面端，浏览器预览不会创建项目或克隆仓库。')
  }
}
