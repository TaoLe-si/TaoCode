// 追溯注解的**作者配色** —— 上游 `platform/vcs-impl/src/com/intellij/openapi/vcs/actions/`
// 的 `AnnotationsSettings` + `AnnotateToggleAction.computeBgColors` 在装订线侧的等价物。
//
// 上游是什么（逐条核过）：
//   · `AnnotationsSettings.getOrderedColors`（`AnnotationsSettings.java:51-61`）：从配色方案读
//     五个 `VCS_ANNOTATIONS_COLOR_*` 锚色，`ColorGenerator.generateLinearColorSequence` 插值成
//     21 档有序调色板；
//   · `getAuthorsColors`（`:35-49`）：把有序调色板按 `SHUFFLE_STEP = 4` 隔步重排，让相邻作者
//     （按名字排序）拿到的色相离得远；
//   · `AnnotateToggleAction.computeBgColors`（`:370-381`）：作者名**排序后**逐个领色
//     （`index % palette.length`），挂到该作者的每一行上（`commitAuthorColors`）；
//   · 提交序那一半（`:386-397`）按 `palette[size * index / count]` 等距取色 —— 本仓的注解列
//     没有"按提交分组上色"的开关，如实不落。
//
// 本仓的锚色来自 `platform/platform-resources/src/DefaultColorSchemesManager.xml` 的默认值
// （亮/暗两套，见 `src/colorGenerator.ts` 的 `VCS_ANNOTATION_ANCHORS_*`）—— 本仓没有可改的
// 配色方案存储，所以取的是上游那份 XML 的默认档。
//
// 消费链路：`src/editorBlameAnnotations.ts` 的 `blameAnnotationsExtension()` 把作者色刷到
// 作者那一列（`BlameMarker.toDOM` 的 `style.color`）；主题取自当前文档的 `data-theme`
// （`src/appearanceActions.ts` 写、`src/style.css` 消费），与编辑器主题同一来源。
//
// 判据：`tests/blame-author-colors.test.mjs`。

import { authorColorMap, rgbToHex } from './colorGenerator.ts'

/** 主题（本仓的亮/暗两档，与 `src/appearance.ts` 的 `Theme` 同一口径）。 */
export type BlameTheme = 'light' | 'dark'

/** 一个作者在装订线上的颜色（上游 `commitAuthorColors` 的 value 侧）。 */
export interface BlameAuthorColor {
  author: string
  color: string
}

/**
 * 作者名 → `#rrggbb`（上游 `computeBgColors:370-381`）：
 * 去重、按名字排序、从 `getAuthorsColors` 的调色板逐个领色。
 * 空名（认不出作者）不占档 —— 它本来就不该画在作者列上。
 */
export function blameAuthorColors(authors: readonly string[], theme: BlameTheme = 'light'): BlameAuthorColor[] {
  const named = authors.filter(author => author.trim() !== '')
  const map = authorColorMap(named, theme)
  return [...map.entries()].map(([author, color]) => ({ author, color: rgbToHex(color) }))
}

/** 给某一行取作者色；作者为空或不在表里返回 undefined（那一行就保持默认色）。 */
export function blameColorFor(author: string | undefined, colors: readonly BlameAuthorColor[]): string | undefined {
  if (!author) return undefined
  return colors.find(entry => entry.author === author)?.color
}

/**
 * 从文档里读当前主题（`html[data-theme]`）—— 与编辑器主题同一来源
 * （`src/appearanceActions.ts` 写这个属性）。读不到（node --test、隐私模式）时按亮色。
 */
export function blameThemeFromDocument(): BlameTheme {
  try {
    if (typeof document === 'undefined') return 'light'
    const attr = document.documentElement?.getAttribute('data-theme')
    return attr === 'dark' ? 'dark' : 'light'
  } catch { return 'light' }
}