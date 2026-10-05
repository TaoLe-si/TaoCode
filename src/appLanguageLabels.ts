// 编辑器/状态栏的**语言显示名**规则 —— App.vue 的 `languageLabels` + `languageOf`
// （原 741-757 行）2026-10-06 逐字搬入本文件。
//
// 为什么能搬：`(path, 已关联的语言) => 显示名` 是一段纯规则，不读 ref、不碰 DOM、不发宿主请求。
// 「项目关联覆盖」那一半（`resolveEditorLanguage(path, content, projectSettings.fileAssociations)`）
// 要读项目设置，留在装配根的 `associationOf` 里，把结果作为入参传进 `editorLanguageLabel`。
//
// 语言**标识**表 `EDITOR_LANGUAGES` 在 `src/languages.ts`（它被 bridge.ts 与 fileTypes.ts 共用、
// 刻意保持零依赖）；本文件只做「标识 → 界面上叫什么」。
// IDEA maps a file to its type by extension; a project can override that mapping
// ("Associate with File Type…"), and the override drives both the status-bar label
// and the editor's syntax highlighting.

/** 关联表里的语言标识 → 界面显示名（`EDITOR_LANGUAGES` 的四档）。 */
export const languageLabels: Record<string, string> = { java: 'Java', cpp: 'C++', typescript: 'TypeScript', other: '纯文本' }

/**
 * 状态栏与「关联到文件类型」用的显示名：先看项目的关联覆盖（`mapped`，由调用方取自
 * `resolveEditorLanguage`），命中就用关联表的名字、表里没有就原样显示；
 * 没关联才按扩展名兜底。
 */
export function editorLanguageLabel(path: string, mapped?: string): string {
  if (mapped) return languageLabels[mapped] ?? mapped
  if (/\.java$/.test(path)) return 'Java'
  if (/\.(c|cpp|h|hpp|cc|cxx)$/.test(path)) return 'C++'
  if (/\.vue$/.test(path)) return 'Vue'
  if (/\.tsx?$/.test(path)) return 'TypeScript'
  if (/\.[cm]?jsx?$/.test(path)) return 'JavaScript'
  if (/\.json$/.test(path)) return 'JSON'
  if (/CMakeLists\.txt$/i.test(path)) return 'CMake'
  return '纯文本'
}
