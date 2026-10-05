// 项目视图「外部库」那一个节点的内容 —— 纯函数，输入是宿主给的清单，输出是树节点。
//
// 上游（`platform/lang-impl/src/com/intellij/ide/projectView/impl/nodes/ExternalLibrariesNode.java`）
// 的结构是这样的，先把它抄清楚再谈我们的取舍：
//   · 容器无条件存在（`ProjectViewProjectNode.java:89` 只受 "Show Library Contents" 开关控制，
//     没有空状态占位节点 —— getChildren() 返空列表就完事；新 UI 的测试
//     `ProjectViewPaneTest.kt:47-56` 也断言无库项目下树里就是光秃秃一行 External Libraries）；
//   · 子节点四类（`ExternalLibrariesNode.java:80-141`）：库、SDK/JDK、插件的 SyntheticLibrary、
//     EP 贡献的 workspace-model 节点。**SDK 与库并列**，都由 `NamedLibraryElementNode` 承载
//     （`NamedLibraryElementNode.java:32`），只是 SDK 那行换 `SdkType.getIcon()`（`:52-59`）；
//   · 两级嵌套：库名节点 → 根（`PsiFileNode` 放 jar / `PsiDirectoryNode` 放 classes 目录），
//     见 `NamedLibraryElementNode.java:43-50` → `LibraryGroupNode.java:75-94`；
//   · **库没有名字时会被摊平**：根直接挂到容器下，不建中间节点
//     （`ExternalLibrariesNode.java:101-104`）。
//
// 我们的取舍：referencedLibraries 只有一堆 glob，没有"库"这一层实体，所以按上游
// "无名库摊平"那条（:101-104）处理 —— 命中的 jar 直接作为叶子挂在容器下；SDK 另起一行。
// 至于插件贡献的 SyntheticLibrary 与 EP 节点，本仓没有对应的扩展点，就没有，不造假行。
//
// 之前这里直接把 glob 字符串本身当叶子显示（lib/**/*.jar），那既不是 jar、也不是库名，
// 点不开也读不懂 —— 用户 2026-10-03 的原话是「外部库现在是空的，什么都没有」。
//
// **本轮接的线**（lp/roots ② 与 pm/roots ① 的缺口就是这个「库/SDK 实体无处可用」）：
//   · jar 不再是裸字符串列表，先经 `libraryFromJars`（`src/libraryModel.ts`）落成
//     `Library` 实体（`-sources.jar` 归 SOURCES 根、其余归 CLASSES 根），再按上游
//     `ExternalLibrariesNode.java:101-104` 的**无名库摊平**渲染成叶子。
//     将来有了具名库，`libraryPresentableName` 那一支直接建中间节点即可，不必改这里。
//   · SDK 行不再自己拼标签，经 `rootsSdkTable.ts` 的 `createSdk` + `sdkPresentableName`
//     （`OrderEntry.getPresentableName()` 的等价物）出文案。

import { matchLibraryGlob } from './buildHost.ts'
import { libraryFromJars } from './libraryModel.ts'
import { createSdk, sdkPresentableName, JAVA_SDK_TYPE } from './rootsSdkTable.ts'
import type { Entry } from './bridge'

/**
 * 合成行的 path 前缀：一个 NUL 字符，表示"这条 path 不落到磁盘"。
 * 与既有合成节点同一套约定（容器本身就是这个前缀 + "libraries"）。
 * 写成 fromCharCode 而不是字面转义，是为了让这个文件里一个控制字符都没有 ——
 * 控制字符会让编辑器与 git diff 把它当二进制，评审时整段看不见。
 */
const OFF_DISK = String.fromCharCode(0)
/** SDK 行的 path —— FileTree 按它换图标（上游 SDK 行用 SdkType.getIcon()，不是文件图标）。 */
export const SDK_ENTRY_PATH = OFF_DISK + 'sdk'
/** 这个 path 是不是"不落到磁盘"的合成行。FileTree 用它决定标题与图标。 */
export function isSyntheticLibraryRow(path: string): boolean { return path.startsWith(OFF_DISK) }

export interface ExternalLibrariesInput {
  /** workspace.files 的全量清单（相对路径，正斜杠）。 */
  files: readonly string[]
  /** java.referencedLibraries 的 glob 列表。 */
  patterns: readonly string[]
  /** 解析出来的项目 SDK（buildHost 的 detectedJdk 口径：配置优先，否则用探测到的）。 */
  jdk: { name: string; version: string; home: string } | null
}

/**
 * 容器下面的行：**先是 SDK，再是命中的 jar**。
 *
 * 顺序：上游 :106 先加库、:109 再加 SDK，两类落进同一个 NamedLibraryElementNode 列表后
 * 不再排序（子节点继承 UNSPECIFIED，按字母序，ProjectViewNode.java:287）。我们把 SDK 放
 * 前面是因为它只有一个、且"项目用哪个 JDK"是最先被问到的事实；jar 列表往往很长，排后面更易读。
 *
 * 全部报 kind: 'file'：这些 path 带 NUL 前缀，本来就不存在于磁盘，报成目录会让 FileTree
 * 去展开一个查不到的东西。
 */
export function externalLibraryEntries(input: ExternalLibrariesInput): Entry[] {
  const out: Entry[] = []
  const jdk = input.jdk
  if (jdk && (jdk.name || jdk.version || jdk.home)) {
    // 标签口径同 NamedLibraryElementNode.java:84-90 → OrderEntry.getPresentableName()：
    // 有名字用名字；没有就用版本；都没有才退回家目录的最后一段（`sdkPresentableName` 就是这三条）。
    out.push({ name: sdkPresentableName(createSdk(jdk.name, JAVA_SDK_TYPE, jdk.home, jdk.version)), path: SDK_ENTRY_PATH, kind: 'file' })
  }
  for (const file of libraryRootPaths(input.files, input.patterns))
    out.push({ name: file.replace(/^.*\//, ''), path: OFF_DISK + 'lib:' + file, kind: 'file' })
  return out
}

/**
 * 命中 jar → `Library` 实体的根路径列表（按路径排序）。
 *
 * 走 `libraryFromJars` 而不是直接把 `matchedJars` 的结果摊开，是为了让 `Library` 这层实体
 * 真的在生产链路上（lp/roots ② 的缺口就是「识别出来的根无处存」）。`libraryFromJars` 建的
 * 库 `name` 为 null，所以按上游 `ExternalLibrariesNode.java:101-104` 的无名库摊平，
 * 根直接当叶子 —— 输出与旧的 `matchedJars` 逐条一致，只是多了一次实体化。
 * 排序放在这里（不放在 `libraryFromJars` 里）是为了保住 `matchedJars` 只负责命中与排序的契约。
 */
export function libraryRootPaths(files: readonly string[], patterns: readonly string[]): string[] {
  const library = libraryFromJars(matchedJars(files, patterns))
  if (!library) return []
  return library.roots.map(root => root.path).sort()
}

/** 按 glob 命中的 jar，按路径排序（上游子节点是字母序，ProjectViewNode.java:287）。 */
export function matchedJars(files: readonly string[], patterns: readonly string[]): string[] {
  const hits: string[] = []
  for (const raw of files) {
    const path = raw.replace(/^\.?\//, '')
    if (!/\.jar$/i.test(path)) continue
    if (patterns.some(pattern => matchLibraryGlob(pattern, path))) hits.push(path)
  }
  return hits.sort()
}
