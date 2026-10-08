export const BIDI_NOTIFICATION_KEY = 'bidi.content.notification.disable'

// Unicode RTL scripts and explicit RTL embedding/override/isolate controls.
const RTL_TEXT = /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Samaritan}\p{Script=Mandaic}\p{Script=Adlam}\p{Script=Hanifi_Rohingya}\p{Script=Yezidi}\p{Script=Old_Hungarian}\p{Script=Phoenician}\p{Script=Imperial_Aramaic}\p{Script=Palmyrene}\p{Script=Nabataean}\p{Script=Hatran}\p{Script=Old_North_Arabian}\p{Script=Old_South_Arabian}\p{Script=Avestan}\p{Script=Inscriptional_Parthian}\p{Script=Inscriptional_Pahlavi}\p{Script=Psalter_Pahlavi}\p{Script=Manichaean}\p{Script=Mende_Kikakui}\p{Script=Old_Turkic}\p{Script=Sogdian}\p{Script=Old_Sogdian}\p{Script=Elymaic}\p{Script=Chorasmian}\u200f\u202b\u202e\u2067]/u

export function containsBidirectionalText(text: string): boolean {
  return RTL_TEXT.test(text)
}

export function showBidiNotification(contains: boolean, hidden: boolean, disabled: boolean): boolean {
  return contains && !hidden && !disabled
}

// ── 扩展点接线（2026-10-07 epclose2） ──────────────────────────────────────────────────────
//
// 上游「编辑器顶部那条提示」是 `com.intellij.editorNotificationProvider`
// （`platform/platform-api/resources/intellij.platform.ide.xml:99`，`interface="com.intellij.ui.EditorNotificationProvider"`，
// 方法面 `collectNotificationData(project, file)`；本条内建提示对应上游
// `BidiContentNotificationProvider`（`platform/platform-impl/resources/intellij.platform.ide.impl.xml:1251` 那条注册））。
// 本仓把它作为 bundled 贡献登记进同名 EP，第三方按同一 id 挂的 provider 与内建那支走同一条收集路径
// （`editorNotificationsFor`）。与上游的如实差异：上游返回一个 Swing `JComponent` 工厂，本仓给
// `{ id, text, actions }`（DOM 面板的可移植面）。
import {
  editorNotificationsFor, registerEditorNotificationProvider,
  type EditorNotificationContribution, type EditorNotificationProviderContribution,
} from './ideViewExtensionPoints.ts'

/** 内建双向文本提示的面板 id（本仓自己的名字；上游是 `BidiContentNotificationProvider` 那个类）。 */
export const BIDI_NOTIFICATION_PANEL_ID = 'TaoCode.bidiContentNotification'
/** 提示文案（与 `src/editorBidiNotification.ts` 面板里那一行同一份，避免两处漂）。 */
export const BIDI_NOTIFICATION_TEXT = '双向文本的显示布局取决于基础方向（视图 › 文本方向）。'

/** 内建提供者：文本里含双向字符时给一条面板，否则 null（上游 `collectNotificationData` 的同一档）。 */
export function bidiNotificationProvider(): EditorNotificationProviderContribution {
  return {
    id: BIDI_NOTIFICATION_PANEL_ID,
    collectNotificationData: ({ text }) =>
      containsBidirectionalText(text) ? { id: BIDI_NOTIFICATION_PANEL_ID, text: BIDI_NOTIFICATION_TEXT } : null,
  }
}

// 模块加载即登记（bundled 贡献必须真的在表里，否则消费端拿到空表）。
registerEditorNotificationProvider(bidiNotificationProvider())

/** 一份文本上要显示的全部编辑器通知面板（内建那支 + 第三方挂的）。 */
export function editorPanelsForText(
  input: { path: string; root: string; text: string },
): EditorNotificationContribution[] {
  return editorNotificationsFor(input)
}

/**
 * 内建那一条面板（找不到时 null）—— `src/editorBidiNotification.ts` 直接用它取文案。
 *
 * **走 EP 收集路径**（不是本地硬编码一条）：先按 id 在 `editorNotificationsFor` 的收集结果里找内建那支
 * —— 第三方按同一 id 覆盖它就能换掉这条提示的文案，按别的 id 挂的 provider 由
 * `editorPanelsForText` 收（本仓编辑器是单视图，CodeEditor.vue 禁改，所以额外面板的落点在接线请求里）。
 * `path`/`root` 可选（认领只看文本的那一支不需要它们）。
 */
export function bidiPanelForText(text: string, path = '', root = ''): EditorNotificationContribution | null {
  if (!containsBidirectionalText(text)) return null
  const collected = editorNotificationsFor({ path, root, text })
  const builtin = collected.find(panel => panel.id === BIDI_NOTIFICATION_PANEL_ID)
  // 内建那支在表里（模块加载即登记）；万一被第三方注销了，退回常量文案而不是空。
  return builtin ?? { id: BIDI_NOTIFICATION_PANEL_ID, text: BIDI_NOTIFICATION_TEXT }
}
