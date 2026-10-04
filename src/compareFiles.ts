// 「比较文件」(IDEA `CompareTwoFiles` = `CompareFilesAction`) 与「比较对象…」那一组。
//
// 上游 `platform/diff-impl/src/com/intellij/diff/actions/CompareFilesAction.java`：
//   · `update()`（`:49-78`）按**选中个数与类型**改标题：
//       1 个文件        → `action.compare.with.text`（**比较对象…**）
//       2 个（或 3 个同类）→ 按类型：`action.compare.files.text`（比较文件）/
//                           `action.CompareDirs.text`（比较目录）/ `action.compare.archives.text`（比较归档）
//       类型混杂        → `action.compare.text`（比较）
//       （2/3 个时若类型一致就用类型名，混杂才退回"比较"。）
//   · `getOtherFile`（`:152-171`）：**记住上次用过的文件/目录**，存在 `PropertiesComponent`
//     的 `two.files.diff.last.used.file` / `two.files.diff.last.used.folder`（项目级），
//     下次打开选择器时默认定位到那里。
//   · 文件选择器的标题是 `select.file.to.compare`（`DiffBundle.properties:252`，中文包 = 选择要比较的文件）。
//   · 菜单位置：`PlatformActions.xml:562-568` 的 `CompareActions` 组 ——
//     `PairFileActions`（CompareTwoFiles 在前、CompareFileWithEditor 在后）+ `CompareClipboardWithSelection`。
//     本仓原先只有最后那一条（「与剪贴板比较」），前两条缺。
//
// 文案一律取随 IDE 发货的中文包（`ActionsBundle.properties` / `DiffBundle.properties`）。

/** `action.compare.with.text`（中文包 = 比较对象…）—— 选中一个文件时那一行的标题。 */
export const COMPARE_WITH_TEXT = '比较对象…'
/** `action.compare.files.text`（中文包 = 比较文件）。 */
export const COMPARE_FILES_TEXT = '比较文件'
/** `action.CompareDirs.text`（中文包 = 比较目录）。 */
export const COMPARE_DIRS_TEXT = '比较目录'
/** `action.compare.archives.text`（中文包 = 比较归档）。 */
export const COMPARE_ARCHIVES_TEXT = '比较归档'
/** `action.compare.text`（中文包 = 比较）—— 类型混杂时的兜底标题。 */
export const COMPARE_TEXT = '比较'
/** `select.file.to.compare`（`DiffBundle.properties:252`，中文包 = 选择要比较的文件）。 */
export const SELECT_FILE_TO_COMPARE = '选择要比较的文件'

/** 上游 `CompareFilesAction.getType`（按 VFS 属性判）。 */
export type CompareKind = 'file' | 'directory' | 'archive'

/** 上游 `LAST_USED_FILE_KEY` / `LAST_USED_FOLDER_KEY`（`PropertiesComponent`，项目级）。 */
export const LAST_USED_FILE_KEY = 'two.files.diff.last.used.file'
export const LAST_USED_FOLDER_KEY = 'two.files.diff.last.used.folder'

/** 上游 `update()`：按选中个数与类型挑标题。 */
export function compareActionText(kinds: readonly CompareKind[]): string {
  if (kinds.length === 1) return COMPARE_WITH_TEXT
  if (kinds.length === 2 || kinds.length === 3) {
    const distinct = new Set(kinds)
    if (distinct.size === 1) {
      const only = kinds[0]
      return only === 'directory' ? COMPARE_DIRS_TEXT : only === 'archive' ? COMPARE_ARCHIVES_TEXT : COMPARE_FILES_TEXT
    }
    return COMPARE_TEXT
  }
  return COMPARE_TEXT
}

/**
 * 上游 `isAvailable`（`:80-96`）：0 个或超过 3 个不可用；三个里带目录或归档也不可用
 * （三方比较只对文本文件开放）。
 */
export function compareAvailable(kinds: readonly CompareKind[]): boolean {
  if (kinds.length === 0 || kinds.length > 3) return false
  if (kinds.length === 3 && kinds.some(kind => kind !== 'file')) return false
  return true
}

/**
 * 「比较对象…」该用哪个记忆键（上游 `getOtherFile`：目录/归档用 folder 键，其余用 file 键）。
 */
export function lastUsedKeyFor(kind: CompareKind): string {
  return kind === 'file' ? LAST_USED_FILE_KEY : LAST_USED_FOLDER_KEY
}

/**
 * 上游 `getDefaultSelection`（`:173-182`）：有记忆就用记忆里的那个路径，没有就用当前文件。
 * `remembered` 是**读回来的路径**（调用方负责判断它还在不在），为空时退回 `current`。
 */
export function defaultCompareSelection(remembered: string | null, current: string): string {
  return remembered !== null && remembered !== '' ? remembered : current
}

/**
 * `CompareActions` 组的成员与顺序（`PlatformActions.xml:562-568` 的
 * `PairFileActions` + `CompareClipboardWithSelection`）。
 * 本仓的视图里，前两条对应"编辑器右键 → 比较对象…"与"与剪贴板比较"。
 */
export const COMPARE_ACTIONS_ORDER = ['compare.twoFiles', 'compare.withEditor', 'compare.clipboard'] as const