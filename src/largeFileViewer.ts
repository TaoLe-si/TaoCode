// **大文件查看器**（上游 `com.intellij.largeFilesEditor.editor.LargeFileEditorProvider`）——
// 把 `src/largeFileMode.ts` / `src/largeFileBytes.ts` 的降级规则，按上游**同名的编辑器提供者**
// 挂到 `com.intellij.fileEditorProvider` 这条 EP 上（宿主与消费端在 `src/fileEditorProviders.ts`）。
//
// 上游坐标：
//   · EP 条目 `platform/platform-impl/resources/intellij.platform.ide.impl.xml:1243`
//     `<fileEditorProvider implementation="com.intellij.openapi.fileEditor.impl.text.LargeFileEditorProvider" id="LargeFileEditor" …/>`
//     —— `id="LargeFileEditor"` 是 EP 的 id（本文件的 `LARGE_FILE_EDITOR_PROVIDER_ID`）；
//   · `platform/lang-impl/src/com/intellij/largeFilesEditor/editor/LargeFileEditorProvider.java:26`
//     `PROVIDER_ID = "LargeFileEditorProvider"` 是 `getEditorTypeId()` 的返回值
//     （本文件的 `LARGE_FILE_EDITOR_TYPE_ID`）；
//   · `accept`（`:33-38`）= 文本文件 && `SingleRootFileViewProvider.isTooLargeForContentLoading(file)`
//     && 特性开关开 && 非二进制 && 本地文件系统；
//   · `createEditor`（`:46-48`）= `new LargeFileEditorImpl(project, file)`；
//   · `getPolicy()`（`:56`）= `FileEditorPolicy.NONE`（与默认文本编辑器并存的那一档用不上，
//     本仓是"接管这个文件、换成只读降级视图"）。
//
// 本仓此前：大文件降级是 CodeEditor 自己按字符数判的（`src/largeFileMode.ts`），没有"编辑器提供者"
// 这一层 —— 第三方无法按 id 挂自己的大文件/自定义类型查看器。本文件把它挂上：
// `accept` 用**按字节**的判定（`src/largeFileBytes.ts`，修掉"按字符数判"那个已知缺口），
// `createEditor` 产出本仓的**只读降级视图描述**（关掉语法高亮 / 语言服务 / 自动换行，给出提示），
// 消费端 `editorProviderFor()` 取到它时，宿主就不再走默认 CodeMirror 全功能档。
//
// 与上游的如实差异：上游 `LargeFileEditorImpl` 是一个按页加载的独立 Swing 编辑器
// （`DocumentOfPagesModel`/`LargeFileManagerImpl`，见 `lp/large-files` 判词）；本仓是同一
// CodeMirror 视图内的降级，`createEditor` 返回的是视图描述而非编辑器对象。
//
// 判据：`tests/large-file-viewer.test.mjs`。

import { LARGE_FILE_LIMIT, largeFilePolicy, type LargeFileFeatures } from './largeFileMode.ts'
// 两个格式化件从 `fileSizeFormat` 来（不是 `largeFileBytes`）：后者要 import 本文件（判定过 EP），
// 走这里才不成环。搬家的原因写在 `src/fileSizeFormat.ts` 头部。
import { formatFileSize, utf8ByteLength } from './fileSizeFormat.ts'
import {
  editorProviderFor, registerFileEditorProvider, type FileEditorPolicy, type FileEditorProviderInput,
} from './fileEditorProviders.ts'

/** 上游 EP 条目 id（`intellij.platform.ide.impl.xml:1243` 的 `id="LargeFileEditor"`）。 */
export const LARGE_FILE_EDITOR_PROVIDER_ID = 'LargeFileEditor'
/** 上游 `LargeFileEditorProvider.PROVIDER_ID`（`LargeFileEditorProvider.java:26`）= `getEditorTypeId()`。 */
export const LARGE_FILE_EDITOR_TYPE_ID = 'LargeFileEditorProvider'
/** 上游 `LargeFileEditorProvider.getPolicy()` 的返回值。 */
export const LARGE_FILE_EDITOR_POLICY: FileEditorPolicy = 'NONE'

/** 本仓的"大文件查看器"视图描述（`createEditor` 的产物）。 */
export interface LargeFileEditorView {
  /** 上游 `getEditorTypeId()`。 */
  editorTypeId: string
  path: string
  /** 大文件档一律只读（上游 `LargeFileEditor` 不可写；本仓由提示条上的「解除只读」放行）。 */
  readOnly: true
  policy: FileEditorPolicy
  /** 文件大小文案（`formatFileSize`）。 */
  sizeText: string
  /** 按字节算出来的降级档（关掉高亮/语言服务/自动换行）。 */
  features: LargeFileFeatures
  notice: string
}

/** 由输入算出字节数：优先用宿主给的 `bytes`，否则按文本算；两者都没有按 0（不当大文件）。 */
export function largeFileBytesOf(input: FileEditorProviderInput): number {
  if (typeof input.bytes === 'number' && Number.isFinite(input.bytes)) return Math.max(0, input.bytes)
  if (typeof input.text === 'string') return utf8ByteLength(input.text)
  return 0
}

/**
 * `LargeFileEditorProvider.accept(project, file)` 的等价物：**按字节**判超限。
 * 上游还要求"文本文件 && 非二进制 && 本地文件系统"；本仓的输入只在前端有文本时才有意义
 * （二进制走 `file.readBinary` 的另外一条路，不会到编辑器），所以这里只保留大小这一条硬条件。
 */
export function acceptsLargeFile(input: FileEditorProviderInput): boolean {
  return largeFileBytesOf(input) >= LARGE_FILE_LIMIT
}

/** `LargeFileEditorProvider.createEditor(project, file)` 的等价物：产出只读降级视图描述。 */
export function createLargeFileEditorView(input: FileEditorProviderInput): LargeFileEditorView {
  const bytes = largeFileBytesOf(input)
  const policy = largeFilePolicy(bytes)
  return {
    editorTypeId: LARGE_FILE_EDITOR_TYPE_ID,
    path: input.path,
    readOnly: true,
    policy: LARGE_FILE_EDITOR_POLICY,
    sizeText: formatFileSize(bytes),
    features: policy.features,
    notice: policy.notice ?? '',
  }
}

/** bundled 贡献（`<fileEditorProvider implementation="…" id="LargeFileEditor"/>`）。 */
export const LARGE_FILE_EDITOR_PROVIDER = {
  id: LARGE_FILE_EDITOR_PROVIDER_ID,
  getEditorTypeId: () => LARGE_FILE_EDITOR_TYPE_ID,
  accept: acceptsLargeFile,
  createEditor: (input: FileEditorProviderInput) => createLargeFileEditorView(input),
  getPolicy: () => LARGE_FILE_EDITOR_POLICY,
} as const

let registered = false

/** 注册 bundled 的大文件查看器（幂等）。 */
export function registerBundledLargeFileEditor(): void {
  if (registered) return
  registered = true
  registerFileEditorProvider(LARGE_FILE_EDITOR_PROVIDER, { source: 'bundled' })
}

// 模块加载即注册（EP 的 bundled 贡献者必须真在表里，消费端才拿得到）。
registerBundledLargeFileEditor()

/**
 * 这个文件该不该用大文件查看器：问 `editorProviderFor()`，看赢下来的那支是不是我们
 * （第三方按同一 id 覆盖或按自己的 id 抢先，都按 EP 的注册顺序裁决，与上游 `getProvider` 同口径）。
 */
export function largeFileEditorViewFor(input: FileEditorProviderInput): LargeFileEditorView | null {
  if (!acceptsLargeFile(input)) return null
  const provider = editorProviderFor(input)
  if (!provider || provider.id !== LARGE_FILE_EDITOR_PROVIDER_ID) return null
  const view = provider.createEditor(input)
  return view as LargeFileEditorView
}
