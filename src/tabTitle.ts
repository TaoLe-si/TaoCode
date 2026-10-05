// 编辑器标签上的**标题**（上游 `platform/ide-core-impl/src/com/intellij/openapi/fileEditor/impl/` 一族）。
//
// 上游的合成顺序在 `EditorTabPresentationUtil.getEditorTabTitle`（`EditorTabPresentationUtil.kt:18-22`）：
//
//     getCustomEditorTabTitle(project, file)      // :19-20  先问 EP
//       ?: doGetUniqueNameEditorTabTitle(project, file)  // :20  再问「同名文件带目录」
//       ?: file.presentableName                   // :21  最后才是裸文件名
//
//   · `getCustomEditorTabTitle`（`:33-47`）按 `EditorTabTitleProvider.EP_NAME` 的顺序取**第一个非空**
//     自定义标题（`EditorTabTitleProvider.kt:23-30` 是那个扩展点的契约）。
//   · `doGetUniqueNameEditorTabTitle`（`UniqueNameEditorTabTitleProvider.kt:34-56`）受
//     `UISettings.showDirectoryForNonUniqueFilenames` 门控（默认 **true**，`UISettingsState.kt:218-219`），
//     唯一性只在**已打开的编辑器**里算（`:43-48`：`editorTabPlacement != TABS_NONE` 时走
//     `getUniqueVirtualFilePathWithinOpenedFileEditors`，`UniqueVFilePathBuilderImpl.kt:56-64`），
//     再过一遍 `getEditorTabText`（`:23-31`，`hideKnownExtensionInTabs` 默认 **false**，
//     `UISettingsState.kt:137-138`），最后 `takeIf { it != file.name }`（`:55`）——
//     和裸文件名一样就当没这一层。
//
// 本仓的落点：这条链的**规则**在这里，渲染在 `src/App.vue` 的标签按钮里（原来写死
// `tab.path.split('/').pop()`，即永远只给第 ③ 档）。唯一名算法复用主工具条文件名部件的
// `uniqueFileName`（`src/filenameWidget.ts`）—— 那是同一份 `UniqueVFilePathBuilder` 的文本子集，
// 不在这里再写一份。
import { baseName, uniqueFileName } from './filenameWidget.ts'

/** 一条自定义标题提供者（`EditorTabTitleProvider` 的等价物）。 */
export interface EditorTabTitleProviderLike {
  id?: string
  /** 返回 null / 空串 = 这一条不接管（上游 `:42-44` 跳过空值继续问下一条）。 */
  getEditorTabTitle: (path: string) => string | null | undefined
}

export interface EditorTabTitleOptions {
  /** EP 提供者表，按注册顺序；`getCustomEditorTabTitle` 逐条问，第一个非空胜出。 */
  providers?: readonly EditorTabTitleProviderLike[]
  /** `UISettings.showDirectoryForNonUniqueFilenames`（`UISettingsState.kt:218-219` 默认 true）。 */
  showDirectoryForNonUniqueFilenames?: boolean
  /** `UISettings.hideKnownExtensionInTabs`（`UISettingsState.kt:137-138` 默认 false）。 */
  hideKnownExtensionInTabs?: boolean
}

/** `UISettingsState.kt:218-219` `SHOW_DIRECTORY_FOR_NON_UNIQUE_FILENAMES` 的默认值。 */
export const SHOW_DIRECTORY_FOR_NON_UNIQUE_FILENAMES_DEFAULT = true
/** `UISettingsState.kt:137-138` `HIDE_KNOWN_EXTENSION_IN_TABS` 的默认值。 */
export const HIDE_KNOWN_EXTENSION_IN_TABS_DEFAULT = false

/** 标签自身的设置（`uniqueFileName` 之外的开关都在这里）。 */
export function defaultTabTitleOptions(): Required<Pick<EditorTabTitleOptions, 'showDirectoryForNonUniqueFilenames' | 'hideKnownExtensionInTabs'>> {
  return { showDirectoryForNonUniqueFilenames: SHOW_DIRECTORY_FOR_NON_UNIQUE_FILENAMES_DEFAULT, hideKnownExtensionInTabs: HIDE_KNOWN_EXTENSION_IN_TABS_DEFAULT }
}

/**
 * `EditorTabPresentationUtil.getCustomEditorTabTitle`（`:33-47`）：按 EP 顺序问一遍，
 * **第一个非空**的标题胜出；一条都没给出就返回 null（`:46`）。
 * 异常处理按上游的容错口径（`:38-40` 吞掉 `IndexNotReadyException` 继续下一条）：本仓的 provider
 * 是同步纯函数，抛错就让这一条作废、不拖垮整条标题链。
 */
export function getCustomEditorTabTitle(path: string, providers: readonly EditorTabTitleProviderLike[] = []): string | null {
  for (const provider of providers) {
    let title: string | null | undefined
    try { title = provider.getEditorTabTitle(path) } catch { continue }
    if (title) return title
  }
  return null
}

/**
 * `getEditorTabText`（`UniqueNameEditorTabTitleProvider.kt:23-31`）：`hideKnownExtensionInTabs` 打开时
 * 去掉**最后一个**扩展名（`FileUtilRt.getNameWithoutExtension`），去空了或去掉之后仍以分隔符结尾
 * 就原样返回（`:26-28`）。默认档是关的，所以原样返回是常态。
 */
export function editorTabText(result: string, hideKnownExtensionInTabs = HIDE_KNOWN_EXTENSION_IN_TABS_DEFAULT, separator = '/'): string {
  if (!hideKnownExtensionInTabs) return result
  // FileUtilRt.getNameWithoutExtension（FileUtilRt.java:439-442）取的是**最后一个**点的左边。
  const cut = result.lastIndexOf('.')
  const withoutExtension = cut < 0 ? result : result.slice(0, cut)
  if (!withoutExtension || withoutExtension.endsWith(separator)) return result
  return withoutExtension
}

/**
 * `doGetUniqueNameEditorTabTitle`（`UniqueNameEditorTabTitleProvider.kt:34-56`）：
 * 开关关着就整条跳过（`:36-38`）；开着就算**已打开文件之间**的最短唯一路径，
 * 过 `getEditorTabText`，与裸文件名相同则返回 null（`:55`）。
 *
 * 与上游的一处**有意偏差**：上游的「唯一路径」是 `UniqueNameBuilder.getShortPath` 的字典树结果，
 * 长而无分叉的中间段会折叠成 `…`（`UniqueNameBuilder.java:122-131`）。本仓复用的是
 * `filenameWidget.uniqueFileName`（主工具条文件名部件同一份规则），逐段后缀、不折叠 ——
 * 同名文件少时它给出的后缀**更短**，而标签宽度另有兜底（`src/tabStripLayout.ts` 的
 * `MAX_PINNED_TAB_WIDTH` 与裁切/滚动），不为一个病态场景再写一份字典树。
 */
export function uniqueEditorTabTitle(path: string, peers: readonly string[] = [], options: EditorTabTitleOptions = {}): string | null {
  const { showDirectoryForNonUniqueFilenames = SHOW_DIRECTORY_FOR_NON_UNIQUE_FILENAMES_DEFAULT, hideKnownExtensionInTabs = HIDE_KNOWN_EXTENSION_IN_TABS_DEFAULT } = options
  if (!showDirectoryForNonUniqueFilenames) return null
  const uniqueName = editorTabText(uniqueFileName(path, peers), hideKnownExtensionInTabs)
  return uniqueName === baseName(path) ? null : uniqueName
}

/**
 * `EditorTabPresentationUtil.getEditorTabTitle`（`:18-22`）—— 标签上那行字。
 * `peers` 是**已打开标签**的路径集合（上游的「在已打开的编辑器里算唯一」那一条：
 * `UniqueVFilePathBuilderImpl.kt:56-64`），不是工作区全量文件名。
 */
export function editorTabTitle(path: string, peers: readonly string[] = [], options: EditorTabTitleOptions = {}): string {
  return getCustomEditorTabTitle(path, options.providers)
    ?? uniqueEditorTabTitle(path, peers, options)
    ?? baseName(path)
}
