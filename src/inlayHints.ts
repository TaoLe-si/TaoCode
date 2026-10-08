// 内联提示（LSP `textDocument/inlayHint`）的**纯规则**：显示什么文本、按类型开不开、点一下做什么。
//
// IDEA 侧的对应物（已核实的类）：
//   · `InlayHintsProvider`（`platform/lang-impl/src/com/intellij/codeInsight/hints/InlayHintsProvider.kt`）
//     给出条目与点击信息；`InlayParameterHintsProvider` 是参数名那一族；
//   · 设置面在 Editor › Inlay Hints（`InlayHintsConfigurable`），按"参数名/类型/…"分组开关 ——
//     LSP 用 `kind` 表达同一件事（规范：1 = Type，2 = Parameter）。
//
// 本仓现状（如实）：渲染在 `src/components/CodeEditor.vue` 的 `InlayWidget`，**只读 span**：
// 按类型的开关、点击动作都还没有接（那一处文件贴着机检行数上限、本批冻结）。
// 先把规则落在这里并用判据锁住，接线时编辑器只做"读设置 → 过滤 → 挂事件"三件事。
//
// `tooltip` / `command` 由宿主转发（`native/lsp_session_kinds.cpp:578-594`，原判词写的
// `native/lsp_session.cpp` 是旧坐标，2026-10-06 的 `restsix` 复核已订正），本文件的
// `inlayHintCommand` / `inlayHintTooltip` 就是它们的消费点。
//
// 参数提示的**排除列表**这一档：规则本体在 `src/inlayHintExcludeList.ts`（上游
// `ParameterHintExcludeListService.kt:93-105` + `filtering/MethodMatcher.kt` + `filtering/StringMatcherBuilder.kt`），
// 本文件只负责"从设置里把清单读出来"，过滤发生在 `src/inlayHintLayout.ts` 的归位链里。

import { DEFAULT_PARAMETER_HINT_EXCLUDE_LIST } from './inlayHintExcludeList.ts'

/** 宿主整形后的内联提示（形状与 `src/bridge.ts` 的 `LspInlayHint` 一致；`command` 是待转发字段）。 */
export interface InlayHintLike {
  line: number
  character: number
  label: string
  paddingLeft?: boolean
  paddingRight?: boolean
  /** LSP `kind`：1 = Type，2 = Parameter，缺省 = 其它。 */
  kind?: number
  /** LSP `InlayHint.command`：点击时执行（宿主转发后才有）。 */
  command?: { command: string; arguments?: unknown[] }
  /** LSP `InlayHint.tooltip`：悬停说明（宿主转发后才有）。 */
  tooltip?: string
}

/** 按类型的开关（设置页三格；默认全开，与 IDEA 的出厂一致）+ 参数提示的排除清单。 */
export interface InlayHintToggles {
  type: boolean
  parameter: boolean
  other: boolean
  /**
   * 参数提示排除清单（一行一条模式，规则见 `src/inlayHintExcludeList.ts`）。
   * 上游它不在"勾选框"那一档里 —— `ParameterHintsSettingsPanel.kt:18-22` 是一个独立的
   * "Exclude list…" 入口，但**生效点**与这三格同一个（`ExcludeListPanel.kt:122` 保存后
   * `refreshParameterHintsOnNextPass()`）。本仓把它折进同一份"该显示什么"里，
   * 于是改清单和改勾选走的是同一条重画链（`inlayHintTogglesKey`）。
   * 可选：老 state 与老调用点没这一项就是"不排除任何东西"。
   */
  parameterHintExcludeList?: readonly string[]
}

export const DEFAULT_INLAY_HINT_TOGGLES: InlayHintToggles = {
  type: true, parameter: true, other: true, parameterHintExcludeList: DEFAULT_PARAMETER_HINT_EXCLUDE_LIST,
}

/** 一个提示属于哪一组（LSP `kind` → 设置页的那一格）。 */
export type InlayHintGroup = 'type' | 'parameter' | 'other'

export function inlayHintGroup(kind: number | undefined): InlayHintGroup {
  if (kind === 1) return 'type'
  if (kind === 2) return 'parameter'
  return 'other'
}

/**
 * 设置页要登记的三把键（与 `src/settingsModel.ts` 的 `EditorSettings` 同族的命名）。
 * 登记状态：编辑器档（`defaultEditorSettings` + native `EDITOR_SETTING_KEYS` + `previewSettings.ts`），
 * 页面 = `src/components/InlayHintsSettingsPage.vue`，消费点 = `src/editorInlayHints.ts` 的
 * `createInlayHints({ toggles })` —— 三档各对应本文件的一组（LSP `kind`：1=Type / 2=Parameter）。
 */
export type InlayHintSettingKey = 'showTypeInlayHints' | 'showParameterInlayHints' | 'showOtherInlayHints'

export const INLAY_HINT_SETTING_KEYS: Record<InlayHintGroup, InlayHintSettingKey> = {
  type: 'showTypeInlayHints',
  parameter: 'showParameterInlayHints',
  other: 'showOtherInlayHints',
}

/**
 * 参数提示排除清单那把键的名字（**唯一**定义处：设置页与读侧都从这里取，不许现抄字符串）。
 * 它对应上游 `ParameterNameHintsSettings`（`@Storage("parameter.hints.xml")`，`:47`）里按语言存的
 * added/removed 差量；本仓没有"按语言"这一层（只有一个 LSP provider），所以是**一把全局清单键**。
 * 登记状态（2026-10-08 lane lp-editor 收口，六处齐）：`EditorSettings` 类型 + `defaultEditorSettings`
 * + native `EDITOR_SETTING_KEYS` 白名单 + `editor_defaults_impl()` 默认值 +
 * `native/settings_editor_keys.hpp` 的形状校验分支 + 预览白名单（`src/previewSettings.ts`），
 * 界面是 `src/components/InlayHintsSettingsPage.vue` 的清单编辑框，判据
 * `tests/inlay-hints-settings.test.mjs` 与 `native/settings_editor_keys_test.cpp`。
 */
export const INLAY_HINT_EXCLUDE_LIST_SETTING_KEY = 'parameterHintExcludeList' as const

/** 设置里那三格的来源形状（`EditorSettings` 的那三个字段；窄接口，老 state 缺键也吃得下）。 */
export interface InlayHintSettingSource {
  showTypeInlayHints?: unknown
  showParameterInlayHints?: unknown
  showOtherInlayHints?: unknown
  /** 排除清单（`string[]`）；键没登记 / 老 state 没有 ⇒ 按默认（空清单 = 不排除）。 */
  [INLAY_HINT_EXCLUDE_LIST_SETTING_KEY]?: unknown
}

/** 清单读侧的容错口径：不是数组就整个忽略，数组里只留非空字符串（上游 `ExcludeListPanel.kt:118` 丢空行、`mapNotNull` 丢坏模式）。 */
function readExcludeList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return DEFAULT_PARAMETER_HINT_EXCLUDE_LIST
  const list = value.filter(item => typeof item === 'string' && item.trim() !== '')
  return list.length === 0 ? DEFAULT_PARAMETER_HINT_EXCLUDE_LIST : list
}

/** 把编辑器设置的那三把键折成本模块要的形态（缺项按默认全开，坏值不崩；排除清单缺项按默认空）。 */
export function inlayHintToggles(settings: InlayHintSettingSource | null | undefined): InlayHintToggles {
  const read = (key: InlayHintSettingKey) => settings?.[key] !== false
  return {
    type: read(INLAY_HINT_SETTING_KEYS.type),
    parameter: read(INLAY_HINT_SETTING_KEYS.parameter),
    other: read(INLAY_HINT_SETTING_KEYS.other),
    parameterHintExcludeList: readExcludeList(settings?.[INLAY_HINT_EXCLUDE_LIST_SETTING_KEY]),
  }
}

/**
 * 三档（+ 排除清单）拼成一行（watch 的比较键：数组每次都是新引用，拿它当依赖会每拍都触发）。
 * 清单为空时**不追加后缀** —— 上游那一条的语义是"保存差量后刷新提示"（`ExcludeListPanel.kt:122`），
 * 空清单与"没有这一档"必须是同一个比较键，否则老 state 每拍都重画。
 */
export function inlayHintTogglesKey(toggles: InlayHintToggles): string {
  const base = `${toggles.type},${toggles.parameter},${toggles.other}`
  const list = toggles.parameterHintExcludeList ?? []
  return list.length === 0 ? base : `${base}|${list.join('|')}`
}

/** 这条提示在当前开关下显示吗。 */
export function shouldShowInlayHint(hint: InlayHintLike | undefined | null, toggles: InlayHintToggles = DEFAULT_INLAY_HINT_TOGGLES): boolean {
  if (!hint || typeof hint.label !== 'string' || hint.label === '') return false
  return toggles[inlayHintGroup(hint.kind)]
}

/**
 * 实际画出来的文本：label + 规范里的左右 padding。
 * 与 `CodeEditor.vue` 的 `InlayWidget.toDOM` 同一个形状 —— 两处不一致时"测试绿而界面白"。
 */
export function inlayHintDisplayText(hint: InlayHintLike | undefined | null): string {
  if (!hint) return ''
  return `${hint.paddingLeft ? ' ' : ''}${hint.label}${hint.paddingRight ? ' ' : ''}`
}

/** 点击要发什么命令（对应 `InlayHintsProvider` 的点击信息）。没有命令就是 null = 不可点。 */
export function inlayHintCommand(hint: InlayHintLike | undefined | null): { command: string; arguments?: unknown[] } | null {
  const command = hint?.command
  if (!command || typeof command.command !== 'string' || command.command === '') return null
  return Array.isArray(command.arguments) ? { command: command.command, arguments: command.arguments } : { command: command.command }
}

/** 悬停说明：优先宿主转发的 `tooltip`，没有就说清"这是参数名/类型提示"。 */
export function inlayHintTooltip(hint: InlayHintLike | undefined | null): string {
  if (!hint) return ''
  if (hint.tooltip) return hint.tooltip
  const group = inlayHintGroup(hint.kind)
  return group === 'type' ? '推断的类型' : group === 'parameter' ? '参数名' : '内联提示'
}
