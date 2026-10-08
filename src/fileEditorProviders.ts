// **文件编辑器提供者宿主**（上游 `com.intellij.openapi.fileEditor.FileEditorProvider` 一族）——
// 「打开一个文件时用哪个编辑器」这一格的 EP 面。
//
// 上游是什么：插件在 plugin.xml 里写一句话
//   `<fileEditorProvider implementation="…" id="…"/>`
// （EP 声明 `com.intellij.fileEditorProvider` 在
// `platform/analysis-api/resources/intellij.platform.analysis.xml:17`，dynamic="true"），
// `FileEditorProviderManagerImpl.getProvider(project, file)` 遍历全部 provider，
// 取**第一个** `accept(project, file)` 为真的来 `createEditor`（`FileEditorProviderManagerImpl.java`
// 的 `getProvider` / `getProviderList` 同语义）；`getPolicy()` 决定它相对默认文本编辑器的摆位
// （`FileEditorPolicy`：`HIDE_OTHER_EDITORS` / `PLACE_BEFORE_DEFAULT_EDITOR` /
// `PLACE_AFTER_DEFAULT_EDITOR` / `HIDE_DEFAULT_EDITOR` / `NONE`）。
//
// 上游接口的方法面（`FileEditorProvider.java:33-`，本仓逐名保留）：
//   `accept(project, file)`、`createEditor(project, file)`、`getEditorTypeId()`、`getPolicy()`，
//   外加可选的 `acceptRequiresReadAction()`、`disposeEditor(editor)`。
//
// 本仓此前：没有这一层 —— "大文件换编辑器"是写死在 `src/largeFileMode.ts` 里由 CodeEditor 自己
// 降级，第三方无法按 id 挂一个自己的编辑器提供者。本文件补上宿主 + 消费端；bundled 贡献是
// `src/largeFileViewer.ts`（`LargeFileEditorProvider`）。
//
// 与上游的如实差异：本仓没有 `Project`/`VirtualFile`，`accept(input)` 的输入是
// `{ path, root, text?, bytes? }`；`createEditor` 返回一个**编辑器描述**（本仓的 CodeMirror 是
// 单视图，描述由宿主解释成"只读查看器/降级档"），不是 FileEditor 对象。
// 抑制器 EP（`com.intellij.fileEditorProviderSuppressor`）只登记 accept，本仓还没有内建的抑制者。
//
// 纯数据层：只 import `src/extensionPoints.ts`。
//
// 判据：`tests/file-editor-providers.test.mjs`。

import {
  APPLICATION_SCOPE, EXTENSIONS, FILE_EDITOR_PROVIDER_EP, FILE_EDITOR_PROVIDER_SUPPRESSOR_EP,
  type ExtensionHandle, type RegisterExtensionOptions,
} from './extensionPoints.ts'

/** 上游 `FileEditorPolicy` 的五档（逐字）。 */
export type FileEditorPolicy =
  | 'HIDE_OTHER_EDITORS'
  | 'PLACE_BEFORE_DEFAULT_EDITOR'
  | 'PLACE_AFTER_DEFAULT_EDITOR'
  | 'HIDE_DEFAULT_EDITOR'
  | 'NONE'

/** `accept` / `createEditor` 的输入（上游 `(Project, VirtualFile)` 在本仓的可移植形状）。 */
export interface FileEditorProviderInput {
  /** 仓库/工作区相对路径（'/' 分隔）。 */
  path: string
  /** 当前工作区根（空 = 没有工作区）。 */
  root: string
  /** 已知的文档文本（大文件判定要它时由调用方给；没有则只能用 `bytes`）。 */
  text?: string
  /** 已知的字节大小（宿主侧算好的，避免前端再解码一次）。 */
  bytes?: number
}

/**
 * 一条编辑器提供者（`FileEditorProvider` 的方法面，名字与上游逐字相同）。
 * `accept` 与 `createEditor` 必填；`getPolicy` / `acceptRequiresReadAction` / `disposeEditor` 可省
 * （上游后三个都是 default 方法）。
 */
export interface FileEditorProviderContribution {
  id: string
  /** 上游 `getEditorTypeId()`：编辑器类型名（同类型重复打开会复用）。 */
  getEditorTypeId: () => string
  /** 上游 `accept(project, file)`：这一支认不认这个文件。 */
  accept: (input: FileEditorProviderInput) => boolean
  /** 上游 `createEditor(project, file)`：建编辑器（本仓返回编辑器描述）。 */
  createEditor: (input: FileEditorProviderInput) => unknown
  /** 上游 `getPolicy()`；缺省 `NONE`。 */
  getPolicy?: () => FileEditorPolicy
  /** 上游 `acceptRequiresReadAction()`；缺省 false（本仓没有 read action）。 */
  acceptRequiresReadAction?: () => boolean
  /** 上游 `disposeEditor(editor)`；缺省空实现。 */
  disposeEditor?: (editor: unknown) => void
}

/** 一条抑制器（上游 `FileEditorProviderSuppressor`：某些条件下不许换编辑器）。 */
export interface FileEditorProviderSuppressorContribution {
  id: string
  /** 返回 true = 这个文件不许被任何 provider 接管（上游 `accept` 同义）。 */
  suppress: (input: FileEditorProviderInput) => boolean
}

/** 注册一条编辑器提供者贡献（`<fileEditorProvider implementation="…"/>` 的等价物）。 */
export function registerFileEditorProvider(
  contribution: FileEditorProviderContribution,
  options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return EXTENSIONS.registerExtension(FILE_EDITOR_PROVIDER_EP, contribution.id, contribution, options)
}

/** 注册一条抑制器贡献。 */
export function registerFileEditorProviderSuppressor(
  contribution: FileEditorProviderSuppressorContribution,
  options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return EXTENSIONS.registerExtension(FILE_EDITOR_PROVIDER_SUPPRESSOR_EP, contribution.id, contribution, options)
}

/** 全部已挂的提供者（按注册顺序；消费端 `getProvider` 取第一个接受的）。 */
export function fileEditorProviders(scope: string = APPLICATION_SCOPE): FileEditorProviderContribution[] {
  return EXTENSIONS.extensionsOf<FileEditorProviderContribution>(FILE_EDITOR_PROVIDER_EP, scope)
}

/** 全部已挂的抑制器。 */
export function fileEditorProviderSuppressors(scope: string = APPLICATION_SCOPE): FileEditorProviderSuppressorContribution[] {
  return EXTENSIONS.extensionsOf<FileEditorProviderSuppressorContribution>(FILE_EDITOR_PROVIDER_SUPPRESSOR_EP, scope)
}

/** 这个文件是否被某个抑制器挡住（上游 `FileEditorProviderManagerImpl` 先问抑制器）。 */
export function editorProviderSuppressed(input: FileEditorProviderInput, scope: string = APPLICATION_SCOPE): boolean {
  return fileEditorProviderSuppressors(scope).some(suppressor => {
    try { return suppressor.suppress(input) } catch { return false }
  })
}

/** 认领这个文件的**全部** provider（上游 `getProviderList`）。被抑制时返回空表。 */
export function editorProvidersFor(input: FileEditorProviderInput, scope: string = APPLICATION_SCOPE): FileEditorProviderContribution[] {
  if (editorProviderSuppressed(input, scope)) return []
  return fileEditorProviders(scope).filter(provider => {
    try { return provider.accept(input) } catch { return false }
  })
}

/** 上游 `getProvider(project, file)`：第一个接受的 provider（没有则 undefined ⇒ 用默认文本编辑器）。 */
export function editorProviderFor(input: FileEditorProviderInput, scope: string = APPLICATION_SCOPE): FileEditorProviderContribution | undefined {
  return editorProvidersFor(input, scope)[0]
}

/** 诊断：当前挂了哪些 provider、各自的编辑器类型名与摆位。 */
export function fileEditorProviderCatalog(scope: string = APPLICATION_SCOPE): { id: string; editorTypeId: string; policy: FileEditorPolicy }[] {
  return fileEditorProviders(scope).map(provider => ({
    id: provider.id,
    editorTypeId: provider.getEditorTypeId(),
    policy: provider.getPolicy?.() ?? 'NONE',
  }))
}

// ── 宿主决策面（打开一个文件时"用哪个编辑器"的那一次裁决） ──────────────────────────────────────
//
// 上游 `FileEditorProviderManagerImpl.getProvider(project, file)` 的落点是**宿主**（`FileEditorManagerImpl`
// 打开文件时），它拿到的不是"某一支 provider"而是三件事：赢下来的 provider、它的 `getEditorTypeId()`、
// 以及 `getPolicy()` 决定的摆位（`FileEditorPolicy`）。本仓此前只有 `editorProviderFor()`（取第一支），
// 宿主若要用还得自己再问 `getPolicy` / 判断抑制器 —— 于是"接进 App.vue 的 openFile"这件事没有
// 单一入口（见 `docs/wiring-requests-2026-10-07-epmount2.md` 的 W2-EP-1）。这一节把它收成一个函数。

/**
 * 一次编辑器裁决的结果（`getProvider` + `getPolicy` + 抑制器判定的可移植面）。
 * `providerId === null` = 走默认文本编辑器（没有 provider 认领，或被抑制器挡住）。
 */
export interface FileEditorProviderDecision {
  /** 赢下来的 provider id；null = 默认文本编辑器。 */
  providerId: string | null
  /** 赢下来的 provider 的 `getEditorTypeId()`；null = 默认。 */
  editorTypeId: string | null
  /** 赢下来的 provider 的 `getPolicy()`（默认编辑器那一档也是 'NONE'）。 */
  policy: FileEditorPolicy
  /** 认领这个文件的**全部** provider id（`getProviderList`；被抑制时为空表）。 */
  accepted: readonly string[]
  /** 被某个抑制器挡住（上游先问抑制器，挡住就完全不换编辑器）。 */
  suppressed: boolean
  /** 编辑器描述里 `readOnly === true`（本仓大文件查看器给的只读档；上游是 `FileEditor` 自身属性）。 */
  readOnly: boolean
}

/**
 * `FileEditorProviderManagerImpl.getProvider(project, file)` 的等价裁决：
 *   · 抑制器为真 ⇒ 全空（`providerId: null`、`accepted: []`、`policy: 'NONE'`）；
 *   · 否则取第一支 `accept` 为真的 provider，读出它的 `getEditorTypeId()` / `getPolicy()`，
 *     并问一次 `createEditor` 取 `readOnly`（`createEditor` 抛错按"不是只读"处理，不让坏插件挡住打开）；
 *   · 没有 provider 认领 ⇒ 默认文本编辑器那一档（`providerId: null`）。
 * 纯函数：不改任何状态，宿主可直接在 `openFile` 里调一次（`src/App.vue` 禁改，接线请求里写明）。
 */
export function editorProviderDecision(
  input: FileEditorProviderInput,
  scope: string = APPLICATION_SCOPE,
): FileEditorProviderDecision {
  const suppressed = editorProviderSuppressed(input, scope)
  const accepted = editorProvidersFor(input, scope)
  const provider = accepted[0]
  if (!provider) return { providerId: null, editorTypeId: null, policy: 'NONE', accepted: [], suppressed, readOnly: false }
  let editorTypeId = ''
  let policy: FileEditorPolicy = 'NONE'
  try { editorTypeId = provider.getEditorTypeId() } catch { /* 坏 provider 退回空类型名 */ }
  try { policy = provider.getPolicy?.() ?? 'NONE' } catch { policy = 'NONE' }
  let readOnly = false
  try {
    const editor = provider.createEditor(input)
    readOnly = Boolean(editor && typeof editor === 'object' && (editor as { readOnly?: unknown }).readOnly === true)
  } catch { /* 建编辑器抛错：按默认（非只读）处理，不让坏插件挡住文件打开 */ }
  return { providerId: provider.id, editorTypeId, policy, accepted: accepted.map(item => item.id), suppressed, readOnly }
}

export { FILE_EDITOR_PROVIDER_EP, FILE_EDITOR_PROVIDER_SUPPRESSOR_EP }
