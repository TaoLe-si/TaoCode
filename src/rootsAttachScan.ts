// 「附加目录时先扫一遍再落列表」的**异步外壳** —— 把 `src/libraryRootDetection.ts` 那套纯规则
// 接到本仓真实的读文本通道（`file.read`）上（lp/roots ② 的最后一环：识别要有能跑的地方）。
//
// 上游对应的是 `RootDetectionUtil.detectRoots`（`platform/lang-impl/src/com/intellij/openapi/roots/
// libraries/ui/impl/RootDetectionUtil.java:53-149`）里那段带进度的扫描：
//   · 进度标题 `progress.title.scanning.for.roots` = 「正在扫描根…」（本仓 `SCANNING_ROOTS_PROGRESS`）；
//   · 扫描走 `JavaVfsSourceRootDetectionUtil.suggestRoots`（`java/idea-ui/src/com/intellij/openapi/roots/
//     ui/configuration/JavaVfsSourceRootDetectionUtil.java:36-72`）—— 它要**读文件文本**才能拿到包名，
//     上游有 VFS 缓存所以逐文件读不贵；本仓每次读都要过一趟宿主 IPC，所以这里必须设上限。
//
// 上限不是省事的借口，是**可观察的取舍**：读满就 `truncated` 说出来，面板把那句话说给用户，
// 而不是假装扫全了（假控件禁令的同一条口径）。
import { detectRootsForAttach, JAVA_SOURCE_ROOT_DETECTOR, SCANNING_ROOTS_PROGRESS, type AttachOutcome, type RootDetector } from './libraryRootDetection.ts'
import { libraryRootType, type LibraryRootType } from './libraryModel.ts'

/** 一次附加扫描最多读多少个 `.java`（每个都是一趟宿主 IPC）。 */
export const MAX_SCANNED_SOURCE_FILES = 40

export interface AttachScanOptions {
  /** 用户选中的目录（工作区相对路径）。 */
  candidates: readonly string[]
  /** `workspace.files` 的全量清单。 */
  files: readonly string[]
  /** 读文本的通道（`file.read` 的 `content`）；读不到返回 null —— 检测器据此不当根。 */
  read: (path: string) => Promise<string | null>
  /** 缺省只跑 Java 源根检测器（上游 `LibraryJavaSourceRootDetector.java:15` 那一档）。 */
  detectors?: readonly RootDetector[]
  /** 「什么都没检出」时允许用户挑的类型（上游 `LibrarySourceRootDetectorUtil.java:39` 给 `{SOURCES}`）。 */
  allowedTypes?: readonly LibraryRootType[]
  /** 覆盖默认上限（测试用）。 */
  limit?: number
}

export interface AttachScanResult {
  outcome: AttachOutcome
  /** 实际读了几个文件（=0 说明候选下没有 `.java`，不读就不该谎称扫过）。 */
  readCount: number
  /** 命中上限：还有文件没读，检出结果可能不完整。 */
  truncated: boolean
  /** 进度标题（宿主在扫描期间显示）。 */
  progress: string
}

const javaUnder = (candidate: string, files: readonly string[]): string[] => {
  const prefix = candidate ? `${candidate.replace(/\/+$/, '')}/` : ''
  return files.filter(file => (prefix ? file.startsWith(prefix) : true) && /\.java$/i.test(file)).sort()
}

/**
 * 扫描候选目录并把结果整成 `AttachOutcome`。
 *
 * 顺序与上游一致：先把候选下的 `.java` 读进一张表（有上限），再用同步的 `textOf` 跑纯规则 ——
 * 纯规则因此保持可单测（`tests/library-root-detection.test.mjs`），这一层只管取数据与配额。
 */
export async function scanAttachRoots(options: AttachScanOptions): Promise<AttachScanResult> {
  const limit = options.limit ?? MAX_SCANNED_SOURCE_FILES
  const queue: string[] = []
  const seen = new Set<string>()
  for (const candidate of options.candidates) {
    for (const file of javaUnder(candidate, options.files)) {
      if (seen.has(file)) continue
      seen.add(file)
      queue.push(file)
    }
  }
  const texts = new Map<string, string>()
  let readCount = 0
  let truncated = false
  for (const file of queue) {
    if (readCount >= limit) { truncated = true; break }
    const text = await options.read(file).catch(() => null)
    readCount += 1
    if (text !== null) texts.set(file, text)
  }
  const detectors = options.detectors ?? DEFAULT_DETECTORS
  const outcome = detectRootsForAttach({
    detectors,
    candidates: options.candidates,
    files: options.files,
    textOf: path => texts.get(path) ?? null,
    allowedTypes: options.allowedTypes ?? DEFAULT_ALLOWED_TYPES,
  })
  return { outcome, readCount, truncated, progress: SCANNING_ROOTS_PROGRESS }
}

/** 默认检测器：Java 源根那一个（本仓没有别的语言的包名规则，不编第二个）。 */
const DEFAULT_DETECTORS: readonly RootDetector[] = [JAVA_SOURCE_ROOT_DETECTOR]
const DEFAULT_ALLOWED_TYPES: readonly LibraryRootType[] = [libraryRootType('sources')]

/**
 * 扫描结果里可以直接落进源根列表的那几条（`kind: 'auto'` 与用户在对话框里勾中的建议）。
 * 上游把勾选结果交给 `Library.ModifiableModel.addRoot`；本仓的落点是 `JavaProjectSettings.sourcePaths`
 * （唯一有存储字段的根表），所以这里只取**检出路径**，类型标签由 `src/projectRoots.ts` 的约定判。
 *
 * `askSingleType` / `askTypes` 两支按上游的兜底把**全部候选**都附加上（`RootDetectionUtil.java:121-126`
 * 与 `:139-144`：用户选的类型套到每个候选），用户取消时 `confirmed` 为假 ⇒ 一条都不加。
 */
export function attachablePaths(
  result: AttachScanResult,
  options: { candidates: readonly string[]; chosen?: readonly string[]; confirmed?: boolean } = { candidates: [] },
): string[] {
  const chosen = options.chosen ?? []
  const outcome = result.outcome
  if (outcome.kind === 'auto') return outcome.roots.map(root => root.file).filter(Boolean)
  if (outcome.kind === 'choose') {
    const byFile = new Set(outcome.suggestions.map(info => info.detectedRoot.file))
    return chosen.filter(file => byFile.has(file))
  }
  if (outcome.kind === 'askSingleType' || outcome.kind === 'askTypes') {
    return options.confirmed ? [...options.candidates] : []
  }
  return []
}
