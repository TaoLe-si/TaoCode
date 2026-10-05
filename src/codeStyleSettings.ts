// 每份文件生效的代码风格 —— `CodeStyleSettings` / `FileIndentOptionsProvider` 一族在本仓的落点。
//
// 上游落点：
//   · 缩进选项本体 —— `platform/code-style-api/src/com/intellij/psi/codeStyle/CommonCodeStyleSettings.java:1035-1048`
//     的 `IndentOptions`（本仓只留**能兑现**的四个字段：`INDENT_SIZE` / `CONTINUATION_INDENT_SIZE` /
//     `TAB_SIZE` / `USE_TAB_CHARACTER`；`SMART_TABS`/`LABEL_*`/`USE_RELATIVE_INDENTS` 这些都需要
//     PSI 级缩进模型，见 §做不到）。
//   · 全局开关 —— `CodeStyleSettings.java:193` `AUTODETECT_INDENTS = true`（**默认开**）。
//   · 逐文件覆盖的准入门 —— `FileIndentOptionsProvider.java:56-58`（`useOnFullReformat()` 默认 **true**）
//     + `:72-74`（`isAllowed(isFullReformat) = !isFullReformat || useOnFullReformat()`），
//     实际消费点是 `modifier/TransientCodeStyleSettings.java:100-109`（整文件重排时**只问**
//     `useOnFullReformat()` 为真的 provider）。
//   · 谁被这道门挡住 —— `platform/lang-impl/.../DetectableIndentOptionsProvider.java:90-92`
//     **显式返回 false**：按内容探测出来的缩进**不用于整文件重排**，只用于输入/选区那条路。
//     `.editorconfig` 那边（`EditorConfigIndentOptionsProvider.kt`）没有覆盖这个方法 ⇒ 走默认 true
//     ⇒ **整文件重排会用 .editorconfig 的缩进**。
//   · .editorconfig 支持的开关 —— `plugins/editorconfig/backend/src/settings/EditorConfigSettings.java:12`
//     `ENABLED = true`（**默认开**）。
//   · LSP 只兑现两个字段 —— `platform/lsp-impl/src/impl/features/formatter/LspFormattingService.kt:119-125`
//     （`createFormattingOptions` 只塞 `tabSize` 与 `isInsertSpaces`，来源正是
//     `codeStyleSettings.getIndentSize(fileType)` 与 `useTabCharacter(fileType)`）。
//   · 导出成 .editorconfig —— `plugins/editorconfig/backend/src/Utils.kt:198-217`（`addIndentOptions`）。
//
// **本仓用什么承接了上游的什么**：上游的 `CodeStyleSettings`（一整套 per-language 规则集）在本仓
// 兑现不到 —— 格式化由语言服务做，规则由它自己的配置决定。真正能贯通的是「**这份文件用几格缩进、
// 用不用制表符**」这一对：`CodeStyleSettings.getIndentSize(fileType)` 那条链在本仓就是
// 「全局设置 → 按内容探测（仅选区/输入）→ .editorconfig」，终点是 LSP 请求的
// `FormattingOptions.tabSize` / `FormattingOptions.insertSpaces`。

import { ref } from 'vue'
import {
  editorConfigDirsFor, indentOptionsFromEditorConfig, mergeEditorConfigs, parseEditorConfig,
  type ParsedEditorConfig,
} from './editorConfig.ts'
import { detectIndentOptions } from './indentDetection.ts'
import { defaultPostFormatSettings, type PostFormatSettings } from './postFormatProcessors.ts'

/**
 * 本仓的缩进选项。字段名沿用上游 `CommonCodeStyleSettings.IndentOptions` 的那四个，
 * 这样「本仓落点 ↔ 上游字段」在代码里就是一一对应。
 */
export interface IndentOptions {
  /** 上游 `INDENT_SIZE`：一次缩进几列。 */
  indentSize: number
  /** 上游 `CONTINUATION_INDENT_SIZE`：续行缩进几列（`adjustForTabUsage` 要用到比值）。 */
  continuationIndentSize: number
  /** 上游 `TAB_SIZE`：一个 Tab 字符显示/折算成几列。 */
  tabSize: number
  /** 上游 `USE_TAB_CHARACTER`：缩进写 Tab 还是空格。 */
  useTabCharacter: boolean
}

/** 从全局编辑器设置起步（`src/settingsModel.ts` 的 `EditorSettings.tabSize` / `useTabCharacter`）。 */
export function indentOptionsFromSettings(settings: { tabSize: number; useTabCharacter: boolean }): IndentOptions {
  return {
    indentSize: settings.tabSize,
    // 上游 `CodeStyleDefaults.DEFAULT_CONTINUATION_INDENT_SIZE` 与 `DEFAULT_INDENT_SIZE` 同为 4
    // （`CommonCodeStyleSettings.java:43-44` 的两个 import）；本仓没有独立的续行设置项，
    // 起步时让它等于缩进宽度。
    continuationIndentSize: settings.tabSize,
    tabSize: settings.tabSize,
    useTabCharacter: settings.useTabCharacter,
  }
}

// ---------------------------------------------------------------- 两个开关（都有默认依据）

/** 代码风格里本仓能兑现、且**默认开**的两个开关。 */
export interface CodeStyleToggles {
  /** 上游 `CodeStyleSettings.AUTODETECT_INDENTS`（`CodeStyleSettings.java:193`），默认 true。 */
  autodetectIndents: boolean
  /** 上游 `EditorConfigSettings.ENABLED`（`EditorConfigSettings.java:12`），默认 true。 */
  editorConfigEnabled: boolean
}

const TOGGLES_KEY = 'taocode.codeStyleToggles'

function readToggles(): CodeStyleToggles {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(TOGGLES_KEY)
    if (!raw) return { autodetectIndents: true, editorConfigEnabled: true }
    const parsed = JSON.parse(raw) as Partial<CodeStyleToggles>
    return {
      autodetectIndents: parsed.autodetectIndents !== false,
      editorConfigEnabled: parsed.editorConfigEnabled !== false,
    }
  } catch {
    return { autodetectIndents: true, editorConfigEnabled: true }
  }
}

export const codeStyleToggles = ref<CodeStyleToggles>(readToggles())

export function setCodeStyleToggles(next: Partial<CodeStyleToggles>): CodeStyleToggles {
  codeStyleToggles.value = { ...codeStyleToggles.value, ...next }
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(TOGGLES_KEY, JSON.stringify(codeStyleToggles.value))
  } catch {
    // 存不住只影响下次会话的持久化，本次会话内照常生效。
  }
  return codeStyleToggles.value
}

// ---------------------------------------------------------------- 格式化后处理设置

const POST_FORMAT_KEY = 'taocode.postFormat'

/**
 * 格式化后处理设置（上游 `CodeStyleSettings` 里那批 `PostFormatProcessor` 开关）。
 * 默认值全部取自上游的字段默认（`CommonCodeStyleSettings.java:261`
 * `LINE_COMMENT_ADD_SPACE_ON_REFORMAT = false`），所以不落盘也等于上游默认。
 */
export const postFormatSettings = ref<PostFormatSettings>({
  ...defaultPostFormatSettings,
  ...readStoredFlag(POST_FORMAT_KEY, 'lineCommentAddSpaceOnReformat'),
})

export function setPostFormatSettings(next: Partial<PostFormatSettings>): PostFormatSettings {
  postFormatSettings.value = { ...postFormatSettings.value, ...next }
  writeStoredFlag(POST_FORMAT_KEY, { lineCommentAddSpaceOnReformat: next.lineCommentAddSpaceOnReformat })
  return postFormatSettings.value
}

function readStoredFlag(key: string, field: string): Record<string, boolean> {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(key)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return typeof parsed[field] === 'boolean' ? { [field]: parsed[field] as boolean } : {}
  } catch {
    return {}
  }
}

function writeStoredFlag(key: string, values: Record<string, boolean | undefined>): void {
  try {
    if (typeof localStorage === 'undefined') return
    const raw = localStorage.getItem(key)
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) delete parsed[name]
      else parsed[name] = value
    }
    localStorage.setItem(key, JSON.stringify(parsed))
  } catch {
    // 同 setCodeStyleToggles：存不住不影响本次会话。
  }
}

// ---------------------------------------------------------------- 每份文件的生效缩进

/** 读一份 `.editorconfig` 的回调：返回 `null` = 该目录没有这份文件，抛错 = 坏文件。 */
export type EditorConfigReader = (dir: string) => Promise<ParsedEditorConfig | null>

export interface ResolveIndentOptionsInput {
  path: string
  /** 文件当前文本（按内容探测与 .editorconfig 的 section 匹配都要用；选区重排传的是**整份**文本）。 */
  text: string
  /** 全局编辑器设置起步值。 */
  base: IndentOptions
  /** 整文件重排为 true、选区/输入重排为 false（`FileIndentOptionsProvider.isAllowed`，`:72-74`）。 */
  isFullReformat: boolean
  /** 工作区根；给出时层级查找**不越过**它（`EditorConfigPropertiesService.kt:78-82` 的 `rootDirs`）。 */
  root?: string
  /** 传了才读 .editorconfig（不传 = 这一层不参与）。 */
  readEditorConfig?: EditorConfigReader
  /** 覆盖全局开关（测试与设置页用）。 */
  toggles?: CodeStyleToggles
}

export interface ResolvedIndentOptions {
  options: IndentOptions
  /** 按内容探测有没有真的改动（`DetectableIndentOptionsProvider` 那一步）。 */
  detected: boolean
  /** `.editorconfig` 有没有真的改动（`EditorConfigIndentOptionsProvider.kt:78-110`）。 */
  fromEditorConfig: boolean
  /** 参与合并的 `.editorconfig` 所在目录（近 → 远），设置页/状态栏据此提示来源。 */
  editorConfigDirs: string[]
}

/**
 * `CodeStyleSettings.getIndentOptionsByFile`（经 `TransientCodeStyleSettings.java:100-109` 的
 * `useOnFullReformat` 门 + `FileIndentOptionsProvider` 链）的端到端等价物。
 *
 * 顺序 = 覆盖优先级（后覆盖前）：全局设置 → 按内容探测（**仅非整文件重排**，因为
 * `DetectableIndentOptionsProvider.java:90-92` 明确 `useOnFullReformat() = false`）→ `.editorconfig`
 * （没覆盖 `useOnFullReformat`，走默认 true，所以整文件重排也吃它）。
 */
export async function resolveIndentOptions(input: ResolveIndentOptionsInput): Promise<ResolvedIndentOptions> {
  const toggles = input.toggles ?? codeStyleToggles.value
  let options = { ...input.base }

  // 按内容探测：整文件重排**不走**这一步（`DetectableIndentOptionsProvider.java:90-92`）。
  const detected = toggles.autodetectIndents && !input.isFullReformat
    ? detectIndentOptions({ text: input.text, options })
    : null
  if (detected) options = detected

  // `.editorconfig`：没覆盖 `useOnFullReformat` ⇒ 走默认 true ⇒ 整文件重排也吃它
  // （`FileIndentOptionsProvider.java:56-58` 对比 `DetectableIndentOptionsProvider.java:90-92`）。
  const editorConfigDirs: string[] = []
  let fromEditorConfig = false
  if (toggles.editorConfigEnabled && input.readEditorConfig) {
    for (const dir of editorConfigDirsFor(input.path, input.root)) {
      let parsed: ParsedEditorConfig | null
      try {
        parsed = await input.readEditorConfig(dir)
      } catch {
        break  // 坏文件：上游 `is InvalidEditorConfig -> break`（`EditorConfigPropertiesService.kt:95-97`）
      }
      if (!parsed) continue
      editorConfigDirs.push(dir)
      const properties = mergeEditorConfigs(input.path, [{ dir, parsed }])
      // `applyCodeStyleSettings`（`EditorConfigIndentOptionsProvider.kt:57-68`）：一个键都没覆盖就不算数。
      if (Object.keys(properties).length) {
        const delta = indentOptionsFromEditorConfig(properties, { tabSize: options.tabSize })
        if (Object.keys(delta).length) { options = { ...options, ...delta }; fromEditorConfig = true }
      }
      if (parsed.isRoot) break
    }
  }
  return { options, detected: detected !== null, fromEditorConfig, editorConfigDirs }
}

// ---------------------------------------------------------------- 导出成 .editorconfig

/**
 * `Utils.addIndentOptions`（`Utils.kt:198-217`）的等价物：把一份缩进选项写成一段 `.editorconfig` 文本。
 * 上游用制表符时写 `indent_style = tab` + `tab_width = N`，用空格时写 `indent_style = space` +
 * `indent_size = N`（`:206-214`），section 头固定 `[*]`。
 *
 * **有意不移植**：`Utils.exportToString`（`Utils.kt:110-127`）后半段按文件类型再写若干 section，
 * 需要 `FileTypeManager` 的扩展名映射；本仓的格式化路径不持有那套模型，所以只出 `[*]` 一段。
 */
export function toEditorConfigText(options: IndentOptions, pattern = '*'): string {
  return [`[${pattern}]`,
    `indent_style = ${options.useTabCharacter ? 'tab' : 'space'}`,
    options.useTabCharacter
      ? `tab_width = ${options.tabSize}`
      : `indent_size = ${options.indentSize}`,
    ''].join('\n')
}

/**
 * 造一个从工作区读 `.editorconfig` 的 reader（宿主注入 `file.read`）。
 * `file.read` 对不存在的文件会抛错 —— 那是「该目录没有这份配置」，转成 `null`。
 */
export function makeEditorConfigReader(read: (path: string) => Promise<{ content: string }>): EditorConfigReader {
  return async dir => {
    let content: string
    try {
      // 工作区根那一层的 `dir` 是空串（见 `editorConfigDirsFor`），
      // 直接写 `${dir}/.editorconfig` 会得到 `/.editorconfig` —— 一个**带前导斜杠的越界路径**，
      // 既不是工作区相对路径、也会被宿主的边界检查挡掉，根那份配置永远读不到。
      content = (await read(dir ? `${dir}/.editorconfig` : '.editorconfig')).content
    } catch {
      return null
    }
    // 解析错误照旧往上抛，由调用方按「坏文件 ⇒ 停止往上找」处理。
    return parseEditorConfig(content)
  }
}
