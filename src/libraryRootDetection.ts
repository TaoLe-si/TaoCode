// 「附加根时识别根类型」—— 上游 `LibraryRootsDetector` / `JavaVfsSourceRootDetectionUtil` /
// `RootDetectionUtil` / `DetectedRootsChooserDialog` / `SuggestedChildRootInfo` 这一串的 DOM 等价物
//（lp/roots ② 的另一半：识别出来要有地方放，放的地方在 `src/libraryModel.ts`，这层是「怎么认」）。
//
// 上游依据（逐条核过）：
//   · `platform/lang-impl/src/com/intellij/openapi/roots/libraries/ui/RootDetector.java:24`
//     一个检测器 = (根类型, 是否 jar 目录, 可显示的根类型名)。
//   · `platform/lang-impl/src/com/intellij/openapi/roots/libraries/ui/impl/LibraryRootsDetectorImpl.java:40-49`
//     `detectRoots` 逐个候选跑一遍各个检测器，把结果**平铺**，每条带上自己的根类型与 jarDirectory 标记；
//     `:52-59` `getRootTypeName` 按 (类型, jarDirectory) 找可显示名。
//   · `java/idea-ui/src/com/intellij/openapi/roots/ui/configuration/LibraryJavaSourceRootDetector.java:15`
//     Java 的源根检测器 = `(OrderRootType.SOURCES, false, "sources")` —— 可显示名是小写 `sources`。
//   · `java/idea-ui/src/com/intellij/openapi/roots/ui/configuration/JavaVfsSourceRootDetectionUtil.java:36-72`
//     `suggestRoots`：**非目录直接返空**（`:37-39`）；遍历到目录时若它被忽略或名字以 `testData`
//     开头（大小写不敏感）就 `SKIP_CHILDREN`（`:50-52`）；遇到 `.java` 就按包名反推根，
//     推出来就收下并 `skipTo(root)`（`:57-61`，同一棵子树不重复收）。
//   · 同文件 `:74-101` `suggestRootForJavaFile` 的反推算法：从 `.java` 的父目录起，
//     **按包名从后往前逐段比对目录名**，任一段对不上就返回 null；全部对上则当前目录就是根。
//   · `platform/lang-impl/src/com/intellij/openapi/roots/libraries/ui/impl/RootDetectionUtil.java:53-149`
//     `detectRoots` 的整条流程（下面 `detectRootsForAttach` 逐条照抄它的判定顺序）。
//   · 同文件 `:151-158` `allRootsHaveOneTypeAndEqualToOrAreDirectParentOf`：
//     **每个**检出根都必须「只有一个类型」且「等于候选本身或就是候选的直接子目录」，
//     否则整批进「要用户挑」的对话框。
//   · 同文件 `:101-146` 一个都没检出时的两级兜底：只剩一种根类型 ⇒ 问「要不要按它附加」；
//     多种 ⇒ 让用户从列表里挑，**挑中的每个都套到全部候选上**。
//   · `platform/lang-impl/src/com/intellij/openapi/roots/libraries/ui/DetectedLibraryRoot.java:12-31`
//     检出根 = 文件 + **一组**根类型（多类型 = 「同一个文件既能当这个也能当那个」）。
//   · `.../ui/impl/SuggestedChildRootInfo.java:23` 默认选中第一个类型；`:42-49` 按**可显示名**
//     反查并切换；`:51-55` 可显示名按大小写不敏感排序。
//   · `.../ui/impl/DetectedRootsChooserDialog.java:193-210` 对话框的树是三级：假根 → 候选 → 检出根，
//     **按候选的 presentable url 排序**（`:195`）后逐个挂上去；
//     `:143-152` 叶子显示「相对候选的路径」，空则退成根分隔符。
//
// 文案（上游 bundle；中文取自 `D:\IntelliJ IDEA 2026.2\plugins\localization-zh\lib\localization-zh.jar`
// 里的 `messages/LangBundle.properties` 与 `messages/ProjectBundle.properties`，只读字符串不猜）：
//   · `dialog.title.attach.roots` = 附加根
//   · `dialog.message.cannot.determine` = {0} 无法确定所选项包含的文件种类。是否要将它们附加为 ''{1}''?
//   · `dialog.title.choose.categories.selected.files` = 选择所选文件的类别
//   · `root.detector.cannot.determine.file.kind` = {0} 无法确定所选项包含的文件种类。<br>从列表中选择相应类别。
//   · `detected.roots.chooser.description` = {0} 刚刚扫描了文件，检测到以下{1 个根}。<br>选择下面树中的项或按“取消”取消操作。
//   · `dialog.title.detected.roots` = 检测到的根
//   · `section.title.choose.roots` = 选择根
//   · `invalid.root.label` = [无效]
//   · `progress.title.scanning.for.roots` = 正在扫描根…

import { libraryRootType, type LibraryRootType } from './libraryModel.ts'

/** 一个检测器（上游 `RootDetector`，`RootDetector.java:24` 的三参构造器）。 */
export interface RootDetector {
  readonly rootType: LibraryRootType
  /** 可显示的根类型名（`LibraryJavaSourceRootDetector.java:15` 传的是小写 `sources`）。 */
  readonly presentableRootTypeName: string
  /**
   * 在**一个候选根**内部检出根。输入是候选下的文件（工作区相对路径）与读文本的通道；
   * 返回空 = 这个候选没认出根（上游用空集合表达，不抛错）。
   */
  detectRoots(candidate: string, files: readonly string[], textOf: (path: string) => string | null): string[]
}

/** 一个检出根（上游 `DetectedLibraryRoot`）：文件 + 一组候选根类型。 */
export interface DetectedLibraryRoot {
  readonly candidate: string
  readonly file: string
  readonly types: readonly LibraryRootType[]
}

const rootTypeKey = (type: LibraryRootType) => `${type.type}|${type.jarDirectory ? '1' : '0'}`

/** `LibraryRootsDetectorImpl.getRootTypeName`（`:52-59`）：按 (类型, jarDirectory) 查可显示名。 */
export function rootTypeName(detectors: readonly RootDetector[], type: LibraryRootType): string | null {
  for (const detector of detectors) {
    if (detector.rootType.type === type.type && detector.rootType.jarDirectory === type.jarDirectory) return detector.presentableRootTypeName
  }
  return null
}

/** 候选下的文件（`files` 是 `workspace.files` 的全量清单）。 */
function filesUnder(files: readonly string[], candidate: string): string[] {
  if (!candidate) return [...files]
  const prefix = `${candidate}/`
  return files.filter(file => file.startsWith(prefix))
}

/**
 * `LibraryRootsDetectorImpl.detectRoots`（`:40-49`）：逐候选、逐检测器跑，把结果平铺。
 * 每条结果带**全部**检测器给出的根类型 —— 上游是「每个检测器一条 `DetectedLibraryRoot`」，
 * 而 `RootDetectionUtil.java:71-79` 会把同一文件的多条按类型名归到一条建议上；这里在源头就合成
 * 一条多类型记录，对话框才有一个可勾选行（上游的 `DetectedRootsChooserDialog.java:97` 也只在
 * 类型数 > 1 时让类型列可编辑 —— 说的就是这个多类型记录）。
 */
export function detectRoots(
  detectors: readonly RootDetector[],
  candidates: readonly string[],
  files: readonly string[],
  textOf: (path: string) => string | null = () => null,
): DetectedLibraryRoot[] {
  const byKey = new Map<string, { candidate: string; file: string; types: LibraryRootType[] }>()
  for (const candidate of candidates) {
    const under = filesUnder(files, candidate)
    for (const detector of detectors) {
      for (const file of detector.detectRoots(candidate, under, textOf)) {
        const key = `${candidate}|${file}`
        const existing = byKey.get(key)
        if (existing) {
          if (!existing.types.some(type => type.type === detector.rootType.type && type.jarDirectory === detector.rootType.jarDirectory))
            existing.types.push(detector.rootType)
        } else {
          byKey.set(key, { candidate, file, types: [detector.rootType] })
        }
      }
    }
  }
  return [...byKey.values()].map(entry => ({ candidate: entry.candidate, file: entry.file, types: entry.types }))
}

// ── `JavaVfsSourceRootDetectionUtil`：Java 源根检测 ──────────────────────────────────

/** `JavaSourceRootDetectionUtil.getPackageName` 的口径：只认 `package` 后第一段非空的声明。 */
export function packageNameOf(text: string): string | null {
  const match = /^[ \t]*package[ \t]+([\w.]+)[ \t]*;/m.exec(text)
  return match ? match[1]! : null
}

const parentOf = (path: string) => {
  const slash = path.lastIndexOf('/')
  return slash <= 0 ? '' : path.slice(0, slash)
}

const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1)

/** `:87`：大小写敏感性取决于文件系统；本仓统一按大小写不敏感处理（Windows 宿主）。 */
const dirMatchesToken = (dirName: string, token: string) => dirName.toLowerCase() === token.toLowerCase()

/**
 * `suggestRootForJavaFile`（`JavaVfsSourceRootDetectionUtil.java:74-101`）：
 * 从 `.java` 的父目录起，按包名**从后往前**逐段比目录名；任何一段对不上就返回 null。
 * 这条宁可漏也不猜 —— 猜错会把整棵子树当源码根。
 * `textOf` 拿不到文本时返回 null（读不到就不当根，不当「无包名」）。
 */
export function sourceRootForJavaFile(javaFile: string, textOf: (path: string) => string | null): string | null {
  const text = textOf(javaFile)
  if (text === null) return null
  const packageName = packageNameOf(text)
  if (!packageName) return null
  let root = parentOf(javaFile)
  let index = packageName.length
  while (index > 0) {
    const dot = packageName.lastIndexOf('.', index - 1)
    const token = packageName.slice(dot + 1, index)
    if (!root || !dirMatchesToken(nameOf(root), token)) return null
    root = parentOf(root)
    if (!root) return null
    index = dot
  }
  return root || null
}

/** `:50-52`：目录名以 `testData` 开头（忽略大小写）就整棵子树跳过。 */
export function isSkippedScanDirectory(name: string): boolean {
  return name.toLowerCase().startsWith('testdata')
}

const underSkippedDir = (path: string, candidate: string) => {
  const floor = candidate.length
  for (let at = parentOf(path); at && at.length >= floor; at = parentOf(at)) {
    if (isSkippedScanDirectory(nameOf(at))) return true
  }
  return false
}

/**
 * `suggestRoots`（`:36-72`）的清单版：`files` 是候选下文件的**工作区相对路径**。
 *
 * 上游靠 `skipTo(root)`（DFS 状态）避免重复收同一个子树；本仓把同一个效果写成显式的
 * 「已收下的根 + 它们的祖先都算已覆盖」判定 —— 语义与 `skipTo(root)` 一致。
 * `testData` 的 `SKIP_CHILDREN` 也在目录这一层判（`:50-52`），命中的目录及其以下都不扫。
 */
export function suggestJavaSourceRoots(
  candidate: string,
  files: readonly string[],
  textOf: (path: string) => string | null,
): string[] {
  const prefix = candidate ? `${candidate}/` : ''
  const javaFiles = files
    .filter(file => (prefix ? file.startsWith(prefix) : true) && /\.java$/i.test(file) && !underSkippedDir(file, candidate))
    .sort()
  const found: string[] = []
  const covered = (dir: string) => found.some(root => dir === root || dir.startsWith(`${root}/`))
  for (const javaFile of javaFiles) {
    if (covered(parentOf(javaFile))) continue
    const root = sourceRootForJavaFile(javaFile, textOf)
    if (root && !covered(root)) found.push(root)
  }
  return found.sort()
}

/** Java 源根检测器（`LibraryJavaSourceRootDetector.java:13-23`）。 */
export const JAVA_SOURCE_ROOT_DETECTOR: RootDetector = {
  rootType: libraryRootType('sources', false),
  presentableRootTypeName: 'sources',
  detectRoots: (candidate, files, textOf) => suggestJavaSourceRoots(candidate, files, textOf),
}

// ── `RootDetectionUtil.detectRoots`：整条附加流程 ────────────────────────────────────

/** 挂在某个候选下的建议（上游 `SuggestedChildRootInfo`，`:13-24`）。 */
export interface SuggestedChildRootInfo {
  /** 候选根本身（对话框树的第二级节点）。 */
  readonly rootCandidate: string
  readonly detectedRoot: DetectedLibraryRoot
  /** 按 `LibraryRootType` 键索引的可显示名表。 */
  readonly typeNames: Readonly<Record<string, string>>
  /** 默认选中第一个类型（`SuggestedChildRootInfo.java:23`）。 */
  selectedType: LibraryRootType
}

export function libraryRootTypeKeyOf(type: LibraryRootType): string { return rootTypeKey(type) }

/** `SuggestedChildRootInfo.getRootTypeNames`（`:51-55`）：可显示名按大小写不敏感排序。 */
export function suggestedRootTypeNames(info: SuggestedChildRootInfo): string[] {
  return Object.values(info.typeNames).sort((left, right) => left.toLowerCase() < right.toLowerCase() ? -1 : left.toLowerCase() > right.toLowerCase() ? 1 : 0)
}

/** `SuggestedChildRootInfo.setSelectedRootType`（`:42-49`）：按**可显示名**反查类型后切换。 */
export function selectSuggestedRootType(info: SuggestedChildRootInfo, presentableName: string): SuggestedChildRootInfo {
  for (const type of info.detectedRoot.types) {
    if (info.typeNames[rootTypeKey(type)] === presentableName) return { ...info, selectedType: type }
  }
  return info
}

/** `allRootsHaveOneTypeAndEqualToOrAreDirectParentOf`（`RootDetectionUtil.java:151-158`）。 */
export function allRootsUnambiguous(roots: readonly DetectedLibraryRoot[], candidate: string): boolean {
  return roots.every(root => root.types.length === 1 && (root.file === candidate || parentOf(root.file) === candidate))
}

/** 附加结果的三种形态（`RootDetectionUtil.detectRoots` 的返回路径）。 */
export type AttachOutcome =
  /** `:64-69` 直接收下：类型唯一且根就是候选本身或其直接子目录。 */
  | { kind: 'auto'; roots: Array<{ file: string; type: LibraryRootType }> }
  /** `:88-99` 进了对话框：调用方把 `suggestions` 给用户挑，回传勾选结果。 */
  | { kind: 'choose'; suggestions: SuggestedChildRootInfo[] }
  /** `:101-146` 一个都没检出：只允许选一种类型时问「要不要按它附加」。 */
  | { kind: 'askSingleType'; typeName: string; type: LibraryRootType }
  /** 同上，多种类型可选：让用户从列表里挑（`ChooseRootTypeElementsDialog`）。 */
  | { kind: 'askTypes'; typeNames: string[] }
  /** 候选为空（连 `allowedTypes` 都没给）。 */
  | { kind: 'none' }

export interface DetectRootsOptions {
  readonly detectors: readonly RootDetector[]
  readonly candidates: readonly string[]
  readonly files: readonly string[]
  readonly textOf?: (path: string) => string | null
  /**
   * 「一个都没检出时」允许用户选的类型（上游 `rootTypesAllowedToBeSelectedByUserIfNothingIsDetected`，
   * `RootDetectionUtil.java:55`；`LibrarySourceRootDetectorUtil.java:39` 传的是 `{SOURCES}`）。
   */
  readonly allowedTypes?: readonly LibraryRootType[]
}

/** 造一条建议（把检测器的可显示名带进去，对话框的根类型列靠它）。 */
function toSuggestion(roots: DetectedLibraryRoot[], detectors: readonly RootDetector[]): SuggestedChildRootInfo[] {
  return roots.map(root => {
    const typeNames: Record<string, string> = {}
    for (const type of root.types) typeNames[rootTypeKey(type)] = rootTypeName(detectors, type) ?? type.type
    return { rootCandidate: root.candidate, detectedRoot: root, typeNames, selectedType: root.types[0]! }
  })
}

/**
 * `RootDetectionUtil.detectRoots`（`:53-149`）的 DOM 等价物，判定顺序逐条照抄：
 *   1. 逐候选检出；**候选自身的**检出根若「类型唯一且等于候选或其直接子目录」就直接收（`:64-69`），
 *      否则整批转成建议（`:70-80`）；
 *   2. 有建议 ⇒ 返回 `choose`，让用户勾（`:88-99`；上游弹 `DetectedRootsChooserDialog`）；
 *   3. 什么都没收上且给了 `allowedTypes` ⇒ 只剩一种可显示名就 `askSingleType`（`:113-127`），
 *      多种就 `askTypes`（`:128-145`）；注意这两种兜底里**用户选的类型会套到全部候选上**。
 */
export function detectRootsForAttach(options: DetectRootsOptions): AttachOutcome {
  const { detectors, candidates, files, textOf = () => null, allowedTypes = [] } = options
  const auto: Array<{ file: string; type: LibraryRootType }> = []
  const suggestions: SuggestedChildRootInfo[] = []
  for (const candidate of candidates) {
    const roots = detectRoots(detectors, [candidate], files, textOf)
    if (roots.length && allRootsUnambiguous(roots, candidate)) {
      for (const root of roots) auto.push({ file: root.file, type: root.types[0]! })
    } else {
      suggestions.push(...toSuggestion(roots, detectors))
    }
  }
  if (suggestions.length) return { kind: 'choose', suggestions }
  if (auto.length) return { kind: 'auto', roots: auto }
  if (!allowedTypes.length) return { kind: 'none' }
  // `:104` 对每个类型再问一遍「是不是 jar 目录」两种取法，按可显示名去重。
  const pairs = new Map<string, LibraryRootType>()
  for (const type of allowedTypes) {
    for (const jarDirectory of [false, true]) {
      const name = rootTypeName(detectors, { type: type.type, jarDirectory })
      if (name) pairs.set(name, { type: type.type, jarDirectory })
    }
  }
  const names = [...pairs.keys()].sort()
  if (names.length === 1) return { kind: 'askSingleType', typeName: names[0]!, type: pairs.get(names[0]!)! }
  return names.length ? { kind: 'askTypes', typeNames: names } : { kind: 'none' }
}

/**
 * 「用户按建议单选的那一种类型附加到全部候选」的收尾（`RootDetectionUtil.java:121-126` 与 `:139-144`）。
 * 传空数组 = 用户取消（`:92-94` 的 `showAndGet` 为假）。
 */
export function attachWithChosenType(
  candidates: readonly string[],
  type: LibraryRootType,
  chosenPresentableNames: readonly string[] = [],
): Array<{ file: string; type: LibraryRootType }> {
  if (!chosenPresentableNames.length) return []
  return candidates.map(candidate => ({ file: candidate, type }))
}

/** 对话框那步的收尾：把用户勾中的建议变成根（`RootDetectionUtil.java:95-98`）。 */
export function attachChosenSuggestions(chosen: readonly SuggestedChildRootInfo[]): Array<{ file: string; type: LibraryRootType }> {
  return chosen.map(info => ({ file: info.detectedRoot.file, type: info.selectedType }))
}

// ── `DetectedRootsChooserDialog` 的树模型 ──────────────────────────────────────────

export interface DetectedRootsTreeNode {
  /** 假根 = null；候选节点 = presentable url；叶子 = 相对候选的路径。 */
  readonly file: string | null
  readonly isCandidate: boolean
  readonly children: DetectedRootsTreeNode[]
  /**
   * 这一行的**完整**工作区相对路径（渲染层拿 `file` 显示、拿 `path` 落库 —— 上游的树节点本身就是
   * `VirtualFile`，显示文本与对象是同一个东西的两面，`DetectedRootsChooserDialog.java:143-152`）。
   */
  readonly path?: string
  /** 叶子才有：这一行可显示的根类型名（`ROOT_TYPE_COLUMN.valueOf`，`DetectedRootsChooserDialog.java:66-69`）。 */
  readonly typeName?: string
  /** 叶子才有：这一行的根类型**数** > 1 时才可改（`:97` 的 `isCellEditable`）。 */
  readonly editableType?: boolean
  /** 叶子才有：路径取不到相对形式时按无效根渲染（`:154-157` + `ProjectBundle` 的 `invalid.root.label`）。 */
  readonly invalid?: boolean
}

const presentableUrl = (path: string) => path.replace(/\\/g, '/')

/**
 * `DetectedRootsChooserDialog.createRoot`（`:193-210`）的两级子树（外加那个不渲染的假根）：
 * 候选按 presentable url 排序，同一候选下的检出根挂成它的孩子。
 * 叶子文本 = 相对候选的路径（`:146-148`），空则用根分隔符 `'/'`（`:149`），
 * 拿不到相对形式时标 `invalid`（`:154-157`）。
 */
/**
 * `DetectedRootsChooserDialog.createRoot`（`:193-210`）的两级子树排序：候选按 presentable url，
 * 同一候选下的检出根按自己的 presentable url。
 */
function sortedSuggestions(suggestions: readonly SuggestedChildRootInfo[]): SuggestedChildRootInfo[] {
  return [...suggestions].sort((left, right) => {
    const byCandidate = presentableUrl(left.rootCandidate).localeCompare(presentableUrl(right.rootCandidate))
    return byCandidate !== 0 ? byCandidate : presentableUrl(left.detectedRoot.file).localeCompare(presentableUrl(right.detectedRoot.file))
  })
}

/** 把树模型给渲染层（与 `suggestedRootsTree` 配套；`DetectedRootsChooserDialog.java:133-191` 的数据侧）。 */
export function detectedRootsTree(suggestions: readonly SuggestedChildRootInfo[]): DetectedRootsTreeNode {
  const root: DetectedRootsTreeNode = { file: null, isCandidate: false, children: [] }
  const byCandidate = new Map<string, DetectedRootsTreeNode>()
  for (const info of sortedSuggestions(suggestions)) {
  let candidateNode = byCandidate.get(info.rootCandidate)
    if (!candidateNode) {
      candidateNode = { file: presentableUrl(info.rootCandidate), isCandidate: true, children: [], path: info.rootCandidate }
      byCandidate.set(info.rootCandidate, candidateNode)
      root.children.push(candidateNode)
    }
    let relative = info.detectedRoot.file.slice(info.rootCandidate.length).replace(/^\//, '')
    if (!relative) relative = info.detectedRoot.file === info.rootCandidate ? '/' : ''
    candidateNode.children.push({
      file: relative || presentableUrl(info.detectedRoot.file),
      isCandidate: false,
      children: [],
      path: info.detectedRoot.file,
      typeName: info.typeNames[rootTypeKey(info.selectedType)],
      editableType: info.detectedRoot.types.length > 1,
      invalid: !relative && info.detectedRoot.file !== info.rootCandidate,
    })
  }
  return root
}

/** 对话框的标题与说明（`DetectedRootsChooserDialog.init`，`:123-131` + `createTitlePane`，`:213-215`）。 */
export function detectedRootsChooserText(productName: string, suggestedCount: number): { title: string; section: string; description: string } {
  const noun = suggestedCount === 1 ? '1 个根' : `${suggestedCount} 个根`
  return {
    title: '检测到的根',
    section: '选择根',
    description: `${productName} 刚刚扫描了文件，检测到以下${noun}。<br>选择下面树中的项或按“取消”取消操作。`,
  }
}

/** 「一个都没检出、只剩一种类型」时的确认文案（`RootDetectionUtil.java:114-117`）。 */
export function attachRootsPrompt(productName: string, typeName: string): { title: string; message: string } {
  return {
    title: '附加根',
    message: `${productName} 无法确定所选项包含的文件种类。是否要将它们附加为 '${typeName}'?`,
  }
}

/** 多种类型可选时的说明（`RootDetectionUtil.java:129-132`）。 */
export function chooseRootTypesText(productName: string): { title: string; description: string } {
  return {
    title: '选择所选文件的类别',
    description: `${productName} 无法确定所选项包含的文件种类。<br>从列表中选择相应类别。`,
  }
}

/** 扫描期的进度标题（`ProjectBundle` 的 `progress.title.scanning.for.roots`）。 */
export const SCANNING_ROOTS_PROGRESS = '正在扫描根…'
