// 编辑器双向文本方向（IDEA `EditorBidiTextDirection` 子菜单 + `EditorSettingsExternalizable.BIDI_TEXT_DIRECTION`）。
//
// 逐条对照的源码（`D:\Backup\Downloads\intellij-community-master\intellij-community-master`）：
//   · 枚举 `platform/ide-core-impl/src/com/intellij/openapi/editor/ex/BidiTextDirection.java:21-23`
//     `CONTENT_BASED, LTR, RTL`（只有三个值）
//   · 设置字段与默认值 `.../ex/EditorSettingsExternalizable.java:137`
//     `public BidiTextDirection BIDI_TEXT_DIRECTION = BidiTextDirection.CONTENT_BASED;`
//     （持久化在 `editor.xml` ⇒ 归 TaoCode 的 `editorSettings`）
//   · 动作 `platform/platform-impl/src/com/intellij/openapi/editor/actions/SetEditorBidiTextDirectionAction.java`
//     —— `ToggleAction`：`isSelected` = `getBidiTextDirection() == myDirection`（三选一），
//     `setSelected` 写设置并 `EditorFactory.getInstance().refreshAllEditors()`（立即刷新所有编辑器）
//   · 菜单 `platform/platform-impl/resources/idea/PlatformActions.xml:591-595`：
//     `ViewMenu` 末尾的 **popup 子菜单** `EditorBidiTextDirection`，三项
//     `EditorSetContentBasedBidiTextDirection` / `EditorSetLtrBidiTextDirection` / `EditorSetRtlBidiTextDirection`
//     （动作类见 `intellij.platform.ide.impl.actions.xml:418-422`）
//
// TaoCode 的落点：设置值 = `editorSettings.bidiTextDirection`（三个字面量，见下），
// 行为 = 在编辑器内容容器上设置 CSS `direction` / `unicode-bidi`（`src/style.css`）。
// 三档到 CSS 的映射是这里唯一的"翻译"，所以它单独成模块并附单测：
//   · `ltr` → `direction: ltr`（IDEA 的 LTR：强制从左到右）
//   · `rtl` → `direction: rtl`
//   · `contentBased` → `unicode-bidi: plaintext` + `direction: ltr` —— 这是浏览器里"按内容定方向"的等价物：
//     `unicode-bidi: plaintext` 让**每个由换行分隔的段落**各自按其首个强方向字符定方向
//     （IDEA 的 CONTENT_BASED 也是段落级判定，不是整篇一个方向）。

/** 取值与 `BidiTextDirection` 一一对应（顺序同枚举声明）。 */
export const BIDI_DIRECTIONS = ['contentBased', 'ltr', 'rtl'] as const
export type BidiDirection = (typeof BIDI_DIRECTIONS)[number]

/** `EditorSettingsExternalizable.java:137` 的默认值 `CONTENT_BASED`。 */
export const BIDI_DIRECTION_DEFAULT: BidiDirection = 'contentBased'

/** 原生设置存的是字符串，读回来先过这一关。 */
export function isBidiDirection(value: unknown): value is BidiDirection {
  return typeof value === 'string' && (BIDI_DIRECTIONS as readonly string[]).includes(value)
}

/** 设置页与菜单里的文案（IDEA 的 `BidiTextDirection` 三项显示名）。 */
export function bidiDirectionLabel(direction: BidiDirection): string {
  switch (direction) {
    case 'contentBased': return '内容自适应'
    case 'ltr': return '从左到右'
    case 'rtl': return '从右到左'
  }
}

/** 菜单行 id：直接沿用 IDEA 的动作 id，便于对照。 */
export function bidiDirectionActionId(direction: BidiDirection): string {
  switch (direction) {
    case 'contentBased': return 'EditorSetContentBasedBidiTextDirection'
    case 'ltr': return 'EditorSetLtrBidiTextDirection'
    case 'rtl': return 'EditorSetRtlBidiTextDirection'
  }
}

/**
 * 该档位在内容容器上要设置的样式声明。
 * `contentBased` 同时给出 `direction: ltr` 作兜底 —— `unicode-bidi: plaintext` 只改**段落内**的
 * 方向判定，容器本身仍需要一个基准方向（否则外层 RTL 环境会把它整体翻过来）。
 */
export function bidiContentStyle(direction: BidiDirection): { direction: string; unicodeBidi: string } {
  if (direction === 'rtl') return { direction: 'rtl', unicodeBidi: 'isolate' }
  if (direction === 'ltr') return { direction: 'ltr', unicodeBidi: 'isolate' }
  return { direction: 'ltr', unicodeBidi: 'plaintext' }
}

/** 给宿主用的 data 属性值（`src/style.css` 按它选选择器）。 */
export function bidiDataAttribute(direction: BidiDirection): string {
  return direction
}
