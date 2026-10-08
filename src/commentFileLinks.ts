// 注释里的**文件路径链接** —— 上游 `ContributedReferencesAnnotator` 那一族的本仓 bundled 贡献。
//
// 上游是什么：`ContributedReferencesAnnotator`（`platform/analysis-api/src/com/intellij/lang/annotation/ContributedReferencesAnnotator.java:15-31`）
// 让插件给「带引用的宿主」（`PsiLanguageInjectionHost` / `HintedReferenceHost` / `ContributedReferenceHost`）
// 上的引用**补注解**，典型用途就是类注释里写的：把字符串/注释里的 URL、路径这类「不寻常位置出现的引用」
// 标出来让人看得见。消费点 `HyperlinkAnnotator.annotateContributedReferences`
// （`platform/lang-impl/src/com/intellij/codeInsight/highlighting/HyperlinkAnnotator.java:76-86`）先让
// 平台的 `annotateHyperlinks` 画一遍，再按文件语言取贡献者逐个 `annotate(element, references, holder)`。
//
// 本仓为什么是「注释里的文件路径」：`src/annotatorHighlights.ts` 的 `webLinkAnnotator` 已经承担了
// 上游 `HyperlinkAnnotator` 的两半（批处理闸门 + 注释里的 `http(s)` 链接）。剩下没被覆盖的那半，
// 正是开发中最常见的一种引用：注释里写的**工作区文件路径**（`src/foo/bar.ts`、`./docs/x.md`、
// `C:\repo\a.ts`）—— 上游由 `WebReferencesAnnotatorBase` 一族按语言提供，本仓落成一条
// `ContributedReferencesAnnotator` 贡献，与网页链接并列画在 `kind: 'hyperlink'` 那一档上。
//
// **target 的形状是硬约束**：`target` 必须是 `src/documentLinks.ts:95` 的 `classifyLinkTarget`
// 判成 `{ kind: 'file' }` 的形式（含 `/` 或 `\`、或盘符、或 `file:`），否则点下去会走
// `src/App.vue:1068` 那条外链分支（`shell.openUrl`）—— 产出一个被误判成外链的东西比不产出更糟。
// 本模块因此**逐条**过 `classifyLinkTarget`，只有判成 `file` 的才交出去（见 `filePathLinksIn`）。
//
// 纯函数 + 一个贡献对象；只 import `src/documentLinks.ts`（零依赖）与 `src/daemonAnalysisExtensionPoints.ts`
// 的类型，便于 `node --test` 直测。判据：`tests/daemon-analysis-extension-points.test.mjs`。

import { classifyLinkTarget } from './documentLinks.ts'
import type {
  ContributedReference, ContributedReferencesAnnotatorContribution, ContributedReferencesHolder,
  ContributedReferencesHost,
} from './daemonAnalysisExtensionPoints.ts'

/** 本仓贡献的 id（`source: 'bundled'`）。 */
export const COMMENT_FILE_LINKS_ID = 'taocode.commentFileLinks'

/** 注释里那一条文件路径链接的 tooltip（上游对应面是 `IdeBundle` 的打开动作文案）。 */
export const OPEN_FILE_LINK_TOOLTIP = '在编辑器中打开这个文件'

/**
 * 路径的形状：可选盘符或 `./`/`../` 前缀 + **至少一层目录** + 带扩展名的文件名。
 *
 * 为什么必须有扩展名与目录分隔符：注释里的裸词（`TODO`、`see also`）不该变成可点的链接；
 * 只写文件名（`README`）指不到唯一位置，上游那一族也只认「看起来就是路径」的形态。
 * 扩展名限 1..8 个字符（够 `.ts` `.markdown` `.d.ts` 这一族），避免把 `v1.2` 这种版本号吞进来。
 */
const FILE_PATH = /(?:[A-Za-z]:[\\/]|\.{1,2}[\\/])?(?:[\w@+-]+[\\/])+[\w@+-]+\.[A-Za-z][\w+-]{0,7}/g

/** 出现在这些字符后面的「路径」其实是一个 URL 的尾巴（`https://x.com/a.ts` 的 `x.com/a.ts`）。 */
const URL_TAIL_BEFORE = /[/:.]/

export interface FilePathLinkHit {
  /** 相对宿主（注释区间）的偏移。 */
  from: number
  to: number
  /** 交出去的 target（已过 `classifyLinkTarget`，保证判成 `file`）。 */
  path: string
}

/**
 * `body`（注释正文）里的文件路径链接。两道闸门：
 *   ① 匹配到的词前面紧跟 `/`、`:`、`.` 时不算（那是 URL 或路径后缀的尾巴，不是独立的一条路径）；
 *   ② `classifyLinkTarget(path)` 必须判成 `file` —— 判成 `external`/`none` 的一律丢掉。
 * 返回值是**相对 body 的**偏移，调用方加上注释起点即可。
 */
export function filePathLinksIn(body: string): FilePathLinkHit[] {
  const out: FilePathLinkHit[] = []
  for (const match of body.matchAll(FILE_PATH)) {
    const path = match[0]
    const at = match.index ?? 0
    const before = at > 0 ? body[at - 1] : ''
    if (before && URL_TAIL_BEFORE.test(before)) continue
    const action = classifyLinkTarget(path)
    if (action.kind !== 'file') continue
    out.push({ from: at, to: at + path.length, path })
  }
  return out
}

/**
 * 这条 bundled 贡献（注册进 `com.intellij.contributedReferencesAnnotator`）。方法名与上游逐字相同：
 * `annotate(element, references, holder)`。
 *
 * `references` 的用法照上游：`HyperlinkAnnotator` 先画过的那一批（本仓 = `webLinkAnnotator` 找到的
 * 网页 URL 区间）。**已经被引用覆盖的区间不重复产出** —— 上游也是「平台先画完，贡献者补漏」，
 * 叠两条同区间的注解会让悬停文案互相盖住。
 */
export const commentFilePathLinks: ContributedReferencesAnnotatorContribution = {
  id: COMMENT_FILE_LINKS_ID,
  annotate: (element: ContributedReferencesHost, references: readonly ContributedReference[],
             holder: ContributedReferencesHolder) => {
    const body = element.text.slice(element.from, element.to)
    for (const hit of filePathLinksIn(body)) {
      const from = element.from + hit.from
      const to = element.from + hit.to
      if (references.some(reference => reference.from < to && reference.to > from)) continue
      holder.add({ from, to, kind: 'hyperlink', target: hit.path, description: OPEN_FILE_LINK_TOOLTIP })
    }
  },
}
