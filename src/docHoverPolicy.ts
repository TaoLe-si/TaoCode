// 文档面的**两个自动开关** —— 上游那两个 `ToggleAction` 在本仓的等价物。
//
// 判决 `docs/inventory/verdict-platform_rest.md` 的 `lp/documentation`，「缺：…… hover
// 自动显示/自动更新开关（`ToggleShowDocsOnHoverAction`/`ToggleAutoUpdateAction`）」那一条。
// 上游逐条（键位/文案/默认档照抄，Swing 那层不抄）：
//   · `platform/lang-impl/src/com/intellij/codeInsight/documentation/ToggleShowDocsOnHoverAction.java:22`
//     读 `EditorSettingsExternalizable.isShowQuickDocOnMouseOverElement()`，`:32` 写回同一个键；
//     标题是 `CodeInsightBundle` 的 `javadoc.show.on.mouse.move`（`:17`）。
//     **默认档 = 开**（`platform/ide-core-impl/src/com/intellij/openapi/editor/ex/
//     EditorSettingsExternalizable.java:76` `SHOW_QUICK_DOC_ON_MOUSE_OVER_ELEMENT = true`）。
//     生效点在 `platform/lang-impl/src/com/intellij/openapi/editor/EditorMouseHoverPopupManager.java:452`
//     （`findElementForQuickDoc` 第一行就是这条闸）与 `HoverPopupContext.kt:106`
//     （`showDocumentation && isShowQuickDocOnMouseOverElement` 才去算文档）。
//     闸本身在 `EditorSettingsExternalizable.java:838-840`：还多一条 `&& !isSupportScreenReaders()`
//     —— 读屏模式下不自动弹文档。本仓没有读屏设置面（`src/settingsModel.ts` 里没这一格），
//     所以这一半**不实现**，而不是默默当成开（差异写在下面 `docHoverDifferenceForScreenReader`）。
//   · `platform/lang-impl/src/com/intellij/lang/documentation/ide/actions/ToggleAutoUpdateAction.kt:13`
//     读 `:17` 写 `DocumentationToolWindowManager.autoUpdate`；
//     **默认档 = 开**（`DocumentationToolWindowManager.kt:55`
//     `by propComponentProperty(name = "documentation.auto.update", defaultValue = true)`）。
//     生效点三处：`:121`（关了就不抢焦点）、`:191`、`:219`（选区变了要不要刷这一页）。
//     中文说明取自中文包 `action.description.refresh.documentation.on.selection.change.automatically`
//     ＝「选区更改时自动刷新文档」（`localization-zh.jar messages/CodeInsightBundle.properties:17`，
//     上游英文同键在 `platform/lang-api/resources/messages/CodeInsightBundle.properties:353`）。
//   · 还有第三个开关 `Documentation.ToggleAutoShow`（`intellij.platform.lang.impl.actions.xml:56-57` →
//     `ToggleAutoShowAction.kt:23-28`，读写 `CodeInsightSettings.AUTO_POPUP_JAVADOC_INFO`），
//     它管的是**补全弹层里**自动展开文档，且 `update()` 只在有 active lookup 时才可见（`:16-20`）。
//     本仓的补全弹层在桶 2 名下（`src/completionUi.ts`），这里不代收，见报告的接线请求。
//
// 本仓的承接方式（架构不等价，用户可见行为等价）：
//   · 「自动显示」= 编辑器 hover 250ms 弹提示那一族（`src/components/CodeEditor.vue` 的 `hoverTooltip`）。
//     该文件是保留文件 ⇒ 消费点在接线请求里，本模块给判据 `shouldShowDocOnHover()`。
//   · 「自动更新」= 快速文档弹层**开着的时候移动光标 → 这一页跟着换**。
//     消费点就在本仓我名下的 `src/quickDocHost.ts`（它 watch 当前标签页的 `line/column`，
//     那两个字段由 `App.vue:2157` 的 `@cursor` 写），已经接上。
import { reactive } from 'vue'
import type { EditorSettings } from './settingsModel.ts'

/** 两个开关的当前值（模块级单例：与上游的 `EditorSettingsExternalizable` 单例同一形态）。 */
export interface DocHoverPolicy {
  /** `SHOW_QUICK_DOC_ON_MOUSE_OVER_ELEMENT`：鼠标停在符号上就弹文档。 */
  showOnMouseMove: boolean
  /** `documentation.auto.update`：选区/光标变了就刷这一页。 */
  autoUpdate: boolean
}

/** 默认档逐条抄上游：两条都是**开**（`EditorSettingsExternalizable.java:76`、`DocumentationToolWindowManager.kt:55`）。 */
export const DEFAULT_DOC_HOVER_POLICY: DocHoverPolicy = { showOnMouseMove: true, autoUpdate: true }

/**
 * 设置里那两把键（`src/settingsModel.ts:504`/`:506` 的 `EditorSettings` 字段 +
 * `native/settings_schema.cpp:419` 的出厂默认 + `src/previewSettings.ts:49` 的预览档，都已登记）。
 * `docHoverPolicy` 自己是运行时真值，这两把只是它的持久化外壳：
 *   · 读盘 → 运行时：**已经接上** —— `src/workspaceLifecycle.ts` 在 `refreshAppState()` 里调
 *     `docHoverPolicyFromSettings(editorSettings.value)`（与 Code Vision 那四把键同一拍）；
 *   · 运行时 → 盘：齿轮那一次改动要落盘还缺宿主一行 —— `src/components/QuickDocPopup.vue:73`
 *     把 `docHoverPolicyPatch()` 以 `policy-change` 事件交出去，而 `src/App.vue:2428` 那一条
 *     `<QuickDocPopup …>` 现在**没有** `@policy-change` 绑定 ⇒ 齿轮当场生效、重启回出厂。
 *     接线请求 D-1（`docs/wiring-requests-2026-10-06-codevision2.md`：给那一行加一个属性，
 *     **不新增行数**，App.vue 只剩几十行余量）。
 * 订正留痕（2026-10-06 codevision2）：这里原写「登记与否不影响本模块 … 登记请求在
 * `docs/wiring-requests-2026-10-06-bucket3.md` 的 S1」—— 登记（S1）其实早就落了，
 * 缺的从来不是键，是读盘那一步的调用方。
 */
export const DOC_HOVER_SETTING_KEYS: Record<keyof DocHoverPolicy, 'showQuickDocOnMouseHover' | 'autoUpdateDocumentation'> = {
  showOnMouseMove: 'showQuickDocOnMouseHover',
  autoUpdate: 'autoUpdateDocumentation',
}

/** 文案逐条取上游中文包，不自编。 */
export const DOC_HOVER_LABELS = {
  /** `javadoc.show.on.mouse.move`（`localization-zh.jar messages/CodeInsightBundle.properties:312`）。 */
  showOnMouseMove: '在鼠标移动时显示',
  /** `documentation.auto.update` 那条动作的说明（同包 `:17`）。 */
  autoUpdate: '选区更改时自动刷新文档',
  /** 关掉之后 tooltip 里那句解释（本仓文案，上游没有对应键）。 */
  showOnMouseMoveOffHint: '已关闭自动显示：按 Ctrl+Q 仍可查看当前符号的文档。',
} as const

/** 运行时真值（设置页与弹层齿轮都读写这一份）。 */
export const docHoverPolicy = reactive<DocHoverPolicy>({ ...DEFAULT_DOC_HOVER_POLICY })

/** 从编辑器设置折回运行时值：缺键按上游默认档（**开**），坏值不崩。 */
export function docHoverPolicyFromSettings(settings: Record<string, unknown> | null | undefined): DocHoverPolicy {
  const read = (key: keyof DocHoverPolicy) => settings?.[DOC_HOVER_SETTING_KEYS[key]] !== false
  const next = { showOnMouseMove: read('showOnMouseMove'), autoUpdate: read('autoUpdate') }
  docHoverPolicy.showOnMouseMove = next.showOnMouseMove
  docHoverPolicy.autoUpdate = next.autoUpdate
  return next
}

/** 把运行时值写回设置补丁（调用方拿去 `saveSettingsPatch`）。 */
/**
 * 补丁的类型按**真键**收窄（不是 `Partial<Record<string, boolean>>`）：
 * 宿主那一头是 `saveSettingsPatch(patch: Partial<EditorSettings>)`，索引签名里的 `boolean`
 * 赋不进 `fontSize: number` 那些字段，vue-tsc 会报 TS2345；更重要的是宽类型让"补丁里出现
 * 一个没登记过的键"这件事在编译期没人管。键名仍然只从 `DOC_HOVER_SETTING_KEYS` 取，两处不会漂。
 */
export type DocHoverSettingsPatch = Partial<Pick<EditorSettings, 'showQuickDocOnMouseHover' | 'autoUpdateDocumentation'>>

export function docHoverPolicyPatch(): DocHoverSettingsPatch {
  return {
    [DOC_HOVER_SETTING_KEYS.showOnMouseMove]: docHoverPolicy.showOnMouseMove,
    [DOC_HOVER_SETTING_KEYS.autoUpdate]: docHoverPolicy.autoUpdate,
  }
}

/** 改一档并返回补丁（设置页与弹层齿轮共用这一个动作，避免两处各写一份）。 */
export function toggleDocHoverPolicy(key: keyof DocHoverPolicy): DocHoverSettingsPatch {
  docHoverPolicy[key] = !docHoverPolicy[key]
  return docHoverPolicyPatch()
}

/** 现在该不该在鼠标停住时弹文档（`EditorMouseHoverPopupManager.java:452` 那一道闸）。 */
export function shouldShowDocOnHover(): boolean {
  return docHoverPolicy.showOnMouseMove
}

/** 现在该不该跟着选区刷新这一页（`DocumentationToolWindowManager.kt:121/191/219` 那三处判断）。 */
export function shouldAutoUpdateDoc(): boolean {
  return docHoverPolicy.autoUpdate
}

/**
 * 上游那条读屏闸的**如实差异说明**（`EditorSettingsExternalizable.java:839`）：
 * 开着读屏支持时 `isShowQuickDocOnMouseOverElement()` 恒 false，哪怕用户那格勾的是开。
 * 本仓没有读屏设置面，所以这里不做那条与运算 —— 返回 true 表示"这一条差异是**已知未实现**"，
 * 不是"已经实现了"。
 */
export function docHoverDifferenceForScreenReader(): boolean {
  return true
}

/**
 * 自动更新的去抖 —— 与 `src/codeLens.ts` 的三档去抖**不是**同一个数：
 * 上游把"文档/内联提示这一类外观性拉取"统一压在文档静止 300ms 之后
 * （`platform/lsp-impl/src/impl/features/highlightingCommon/LspHighlightingCache.kt:264-269`
 * `LOW_PRIORITY_QUIESCENCE_DELAY: Duration = 300.milliseconds`，注释点明"cosmetic while the user types"），
 * 而诊断那一类是 250ms（`:257-262`）。这里要的是前者。
 */
export const DOC_AUTO_UPDATE_QUIESCENCE_MS = 300

/**
 * 这一页该不该因"光标动了"而重取 —— 纯判据，给 watch 用（也便于单测钉住）。
 * 同一行同一列不重取（`selectionSet` 会在选区变化时也响，光标没挪就没必要再发一次 hover）。
 */
export function shouldRefreshDocPage(
  current: { line: number; character: number } | null,
  next: { line: number; character: number },
  policy: DocHoverPolicy = docHoverPolicy,
): boolean {
  if (!policy.autoUpdate) return false
  if (!current) return true
  return current.line !== next.line || current.character !== next.character
}
