// 统一差异补丁的**解析与应用**（上游 `platform/vcs-impl/src/com/intellij/openapi/diff/impl/patch/`
// 一族：`GitPatchParser` / `PatchReader` / `PatchFileHeaderParser` / `PatchHunk` /
// `apply/ApplyFilePatchFactory` / `apply/ApplyTextFilePatch` / `apply/PlainSimplePatchApplier` /
// `formove/PatchApplier` / `formove/PathsVerifier` / `formove/TriggerAdditionOrDeletion` /
// `ApplyPatchStatus`）。
//
// 上游那条链：`PatchReader` 按文件头把补丁切成 `FilePatch`（TEXT / NEW / DELETED / MOVED /
// RENAMED / BINARY），`PathsVerifier` 逐条核对路径与状态（禁止逃出仓库根、区分
// ADD/DELETE/MOVE），真正落到文件上的那一半按类型分派：文本走 `ApplyTextFilePatch` →
// `PlainSimplePatchApplier`（**逐块核对上下文行**，对不上就整块失败），新增/删除/移动由
// `TriggerAdditionOrDeletion` / `formove/PatchApplier` 处理，二进制走 `ApplyBinaryFilePatch`。
//
// 本仓做的是**文本子集**（与导出侧成对：整仓补丁走 `src/patchExport.ts`，正文来自宿主的 `git diff`；
// 前端自己生成 unified 文本走 `src/diffText.ts` 的 `generateUnifiedDiff`，那块头的两侧行数是按
// 正文实际行数列的 —— 与这里「按声明行数收」是同一份账，判据 `tests/patch-hunk-counts.test.mjs`，
// 含真 `git apply --check`）：
//   · 认 `git diff` / `diff -u` 的 unified 格式：`diff --git`、`--- /dev/null`、`+++ b/x`、
//     `rename from/to`、`new file mode`、`deleted file mode`、`@@ -a,b +c,d @@`、
//     `\ No newline at end of file`、`Binary files ... differ`；
//   · **块内容按 `@@` 声明的两侧行数收**（`PatchReader.readNextHunkUnified`，
//     `platform/vcs-impl/src/com/intellij/openapi/diff/impl/patch/PatchReader.java:335-392`），
//     所以 `git format-patch` 的邮件头、diffstat 与结尾的 `-- ` 签名都不会被吃进最后一个块；
//   · 应用时**先核块头与正文的账**（`apply/PlainSimplePatchApplier.java:114-122`：块头声明的两侧行数
//     必须等于正文实际的行数，对不上就是 `patch.simple.apply.hunk.base.body.error` /
//     `.patched.body.error`，文案在 `platform/vcs-api/vcs-api-core/resources/messages/VcsBundle.properties:444-445`），
//     再**逐块核对上下文**（`PlainSimplePatchApplier.checkContextLines` 的等价物，
//     `apply/PlainSimplePatchApplier.java:98`），不猜；核对不上再走**偏移搜索**
//     （`src/patchFuzzy.ts` = `apply/GenericPatchApplier` 的位置那一半，`apply/GenericPatchApplier.java:74-86`）；
//     同一道账目闸也挡在**「已应用」判定**（`isAlreadyApplied`）前面：账目不对的块在上游永远到不了
//     ALREADY_APPLIED 那一档（`apply/GenericPatchApplier.java:121-122` 的 FAILURE 排在 `:124`/`:134`
//     的 ALREADY_APPLIED 之前，而 `myNotExact` 的落位算的就是块头声明的两个数，`:1241-1242`）；
//     原写「GNU patch 的 fuzz 属 GenericPatchApplier，本仓没做」—— 实际偏移搜索已做，
//     没做的是**吃掉上下文行**那一档（`apply/GenericPatchApplier.java:209-223` 那段 fuzz 循环里
//     `:212` 调的 `complementInsertAndDelete`，函数体在 `:312-320`；`trySolveSomehow` 在 `:363-393`，
//     只有 `applySomehow` 那条路会用），它会改写匹配处的文本，本仓不引入；
//   · 只写「计划」不碰 IO：`planPatchApplication` 吃「补丁 + 每个目标文件的当前内容（不存在 = null）」
//     给出逐文件动作与最终内容，IO 由调用方（`src/patchApplyHost.ts` → `SourceControl.vue`）走宿主通道执行。
//     这样整批补丁可以**先全部验证再落盘**（上游 `PathsVerifier` 的用意）。
//   · 二进制补丁（`GIT binary patch` / base85）不解析：判 `skip` 并给出理由
//     （上游 `ApplyBinaryFilePatch` + `lib/base85xjava/Base85x`，本仓没有这条解码链）。
import { detectLineSeparator, looksBinary, normalizeLineSeparators, patchHunkStartIndex, splitPatchLines, stripBom } from './vcsFileUtil.ts'
import { applyHunksWithOffsetSearch } from './patchFuzzy.ts'

/** 逐文件的应用结果（上游 `ApplyPatchStatus`，去掉本仓没有的 SKIP/ABORT 之外仍保留同形）。 */
export type ApplyPatchStatus = 'success' | 'partial' | 'alreadyApplied' | 'skip' | 'failure'

/** 补丁行类型（上游 `PatchLine.Type`：CONTEXT / ADD / REMOVE）。 */
export type PatchLineType = 'context' | 'add' | 'remove'

export interface PatchLine {
  type: PatchLineType
  text: string
  /** `\ No newline at end of file`：这一行在原文/新文里没有结尾换行（`PatchLine.isSuppressNewLine`）。 */
  noNewline: boolean
}

/** 一个块（上游 `PatchHunk`：before/after 两侧的起点与行数 + 行表）。 */
export interface PatchHunk {
  /** `@@ -beforeStart,beforeCount ...`（1 基；`0` 表示空文件的插入点）。 */
  beforeStart: number
  beforeCount: number
  afterStart: number
  afterCount: number
  lines: PatchLine[]
}

/** 一个文件的补丁（上游 `FilePatch` 的类型判定收敛成这四档）。 */
export interface PatchFilePatch {
  /** 文本改动 / 新增 / 删除 / 改名（改名可能同时带内容改动）。 */
  kind: 'text' | 'add' | 'delete' | 'rename'
  /** 旧路径（`add` 为 null；已去掉 `a/` 前缀）。 */
  oldPath: string | null
  /** 新路径（`delete` 为 null）。 */
  newPath: string | null
  hunks: PatchHunk[]
  /** 补丁里显式声明为二进制（`Binary files ... differ` / `GIT binary patch`）。 */
  binary: boolean
  /** 头里的原文，用于诊断（`NotAPatchException` 的错误位置）。 */
  header: string
}

export interface ParsedPatch {
  files: PatchFilePatch[]
  /** 解析期间的问题（非致命：好的文件仍然进 `files`）。 */
  problems: string[]
}

/** 去掉 `a/`、`b/` 前缀与 git 的引号；`/dev/null` 折成 null。 */
function cleanPatchPath(raw: string | undefined): string | null {
  if (raw === undefined) return null
  let path = raw.trim()
  if (!path || path === '/dev/null') return null
  if (path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1)
  if (path.startsWith('a/') || path.startsWith('b/')) path = path.slice(2)
  return path
}

function parseHunkHeader(line: string): { beforeStart: number; beforeCount: number; afterStart: number; afterCount: number } | null {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line)
  if (!match) return null
  return {
    beforeStart: Number(match[1]),
    beforeCount: match[2] === undefined ? 1 : Number(match[2]),
    afterStart: Number(match[3]),
    afterCount: match[4] === undefined ? 1 : Number(match[4]),
  }
}

/**
 * 解析 unified diff（上游 `GitPatchParser` + `PatchReader` 的文本子集）。
 * 认不出的开头进 `problems`，但后面的文件照常解析。
 *
 * **块内容按 `@@` 声明的行数收**（上游 `PatchReader.readNextHunkUnified`，
 * `platform/vcs-impl/src/com/intellij/openapi/diff/impl/patch/PatchReader.java:335-392`）：
 * `:357-362` 把 `-a,b +c,d` 里的 `linesBefore` / `linesAfter` 读出来（省略第二个数就是 1，
 * 本仓 `parseHunkHeader` 同款），`:375` 用 `before < linesBefore || after < linesAfter` 决定
 * 「这一行还必须是一块内容」（`parsePatchLine` 的 `expectMeaningfulLines`，`:407-432`），
 * 凑满了就 `iterator.previous(); break`（`:376-379`）把当前行**退回去**按表头重新判。
 * 这条规矩是本仓原来缺的：不认行数时，`git format-patch` 结尾那行 `-- ` 会被当成删除行
 * 并进最后一个块（前缀 `-` ⇒ REMOVE，文本 ` `），于是整份补丁核对上下文失败；
 * 反向地，删除行本身长得像文件头（`--- 旧内容`）时也不能让它抢走表头判定。
 */
export function parseUnifiedPatch(text: string): ParsedPatch {
  const lines = stripBom(normalizeLineSeparators(text)).split('\n')
  const files: PatchFilePatch[] = []
  const problems: string[] = []
  let current: PatchFilePatch | null = null
  let hunk: PatchHunk | null = null
  /** 当前块已吃进的两侧行数（上游 `readNextHunkUnified` 的 `before` / `after`，`:366-368`）。 */
  let hunkBefore = 0
  let hunkAfter = 0

  const finishFile = () => {
    if (current && (current.hunks.length > 0 || current.binary || current.kind !== 'text' || current.oldPath !== null || current.newPath !== null)) {
      files.push(current)
    }
    current = null
    hunk = null
    hunkBefore = 0
    hunkAfter = 0
  }
  const ensure = (): PatchFilePatch => {
    if (!current) {
      current = { kind: 'text', oldPath: null, newPath: null, hunks: [], binary: false, header: '' }
    }
    return current
  }
  /** 收一行进块，并把它算进两侧的行数（上游 `:380-388` 的 `switch` + `hunk.addLine(lastLine)`）。 */
  const pushLine = (type: PatchLineType, text2: string): void => {
    hunk?.lines.push({ type, text: text2, noNewline: false })
    if (type !== 'add') hunkBefore++
    if (type !== 'remove') hunkAfter++
  }

  for (const line of lines) {
    if (hunk) {
      // `\ No newline at end of file` 挂在**上一行**上（上游 `:371-373`，只认 lastLine != null）。
      if (line.startsWith('\\')) {
        const last = hunk.lines[hunk.lines.length - 1]
        if (last) last.noNewline = true
        continue
      }
      if (hunkBefore < hunk.beforeCount || hunkAfter < hunk.afterCount) {
        const marker = line[0]
        if (marker === ' ') { pushLine('context', line.slice(1)); continue }
        if (marker === '+') { pushLine('add', line.slice(1)); continue }
        if (marker === '-') { pushLine('remove', line.slice(1)); continue }
        if (line === '') { pushLine('context', ''); continue }
        // 行数没凑满却不是块内容：上游在这里让 `parsePatchLine` 返回 null 从而结束这一块，
        // 本仓额外留一条诊断（`problems` 非致命，后面的文件照常）。
        problems.push(`块内认不出的行：${line}`)
        hunk = null
      } else {
        // 声明的行数已凑满 ⇒ 这一块到此为止，当前行退回按表头判（上游 `:376-379`）。
        hunk = null
      }
    }
    if (line.startsWith('diff --git ')) {
      finishFile()
      const file = ensure()
      file.header = line
      // `diff --git a/x b/x`（路径可能带引号含空格：只取 `a/`、`b/` 两个已知前缀那一段）。
      const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line)
      if (match) { file.oldPath = cleanPatchPath(match[1]); file.newPath = cleanPatchPath(match[2]) }
      continue
    }
    if (line.startsWith('GIT binary patch') || /^Binary files .* differ$/.test(line)) {
      ensure().binary = true
      continue
    }
    if (line.startsWith('rename from ')) { const f = ensure(); f.kind = 'rename'; f.oldPath = cleanPatchPath(line.slice('rename from '.length)); continue }
    if (line.startsWith('rename to ')) { const f = ensure(); f.kind = 'rename'; f.newPath = cleanPatchPath(line.slice('rename to '.length)); continue }
    if (line.startsWith('copy from ')) { const f = ensure(); f.kind = 'rename'; f.oldPath = cleanPatchPath(line.slice('copy from '.length)); continue }
    if (line.startsWith('copy to ')) { const f = ensure(); f.kind = 'rename'; f.newPath = cleanPatchPath(line.slice('copy to '.length)); continue }
    if (line.startsWith('new file mode')) { ensure().kind = 'add'; continue }
    if (line.startsWith('deleted file mode')) { ensure().kind = 'delete'; continue }
    if (line.startsWith('--- ')) {
      const f = ensure()
      const path = cleanPatchPath(line.slice(4))
      // `/dev/null` 在旧侧 = 新增（`FilePatch` 的 NEW：没有旧路径）。
      if (path === null) { f.oldPath = null; f.kind = 'add' } else f.oldPath = path
      continue
    }
    if (line.startsWith('+++ ')) {
      const f = ensure()
      const path = cleanPatchPath(line.slice(4))
      // `/dev/null` 在新侧 = 删除。
      if (path === null) { f.newPath = null; f.kind = 'delete' } else f.newPath = path
      continue
    }
    if (line.startsWith('@@ ')) {
      const header = parseHunkHeader(line)
      if (!header) { problems.push(`块头认不出：${line}`); hunk = null; continue }
      hunk = { ...header, lines: [] }
      hunkBefore = 0
      hunkAfter = 0
      ensure().hunks.push(hunk)
      continue
    }
  }
  finishFile()
  return { files, problems }
}

/** 应用结果：成功给新文本，失败给**第几块**与理由（对应 `PatchApplyException`）。 */
export type HunkApplyResult = { ok: true; text: string; offsetHunks?: number } | { ok: false; hunk: number; reason: string }

function splitHunkLines(text: string): string[] {
  return splitPatchLines(text)
}

function joinHunkLines(lines: string[], separator = '\n'): string {
  return lines.join(separator)
}

/** 块的「原文」行（context + remove）与「新文」行（context + add）。 */
function beforeLines(hunk: PatchHunk): string[] {
  return hunk.lines.filter(line => line.type !== 'add').map(line => line.text)
}
function afterLines(hunk: PatchHunk): string[] {
  return hunk.lines.filter(line => line.type !== 'remove').map(line => line.text)
}

/** 一侧的「块头声明行数」与「正文实际行数」是否同一笔账（上游 `PatchHunkUtil.kt:13-28` 的那个 switch）。 */
function countsOfSide(hunk: PatchHunk, side: 'before' | 'after'): number {
  const skip: PatchLineType = side === 'before' ? 'add' : 'remove'
  let count = 0
  for (const line of hunk.lines) if (line.type !== skip) count++
  return count
}

/**
 * 块头与正文的账目核对（上游 `PlainSimplePatchApplier.checkContextLines`，
 * `platform/vcs-impl/src/com/intellij/openapi/diff/impl/patch/apply/PlainSimplePatchApplier.java:98-122`）：
 * `:114-116` 数出正文两侧的 `baseCount` / `patchedCount`，`:117-122` 拿它们与块头算出的跨度
 * （`baseEnd - baseStart` = 块头声明的 `linesBefore`，见 `PatchReader.java:363-364`）逐一比，
 * 对不上就 `PatchApplyException`（文案 `VcsBundle.properties:444-445`
 * `patch.simple.apply.hunk.base.body.error` / `.patched.body.error`）。
 * 本仓原来没有这一道：块是手构的（不是 `parseUnifiedPatch` 收出来的）时，声明与正文不符会**静默**按正文走。
 */
function hunkCountsMismatch(hunk: PatchHunk): string | null {
  const before = countsOfSide(hunk, 'before')
  if (before !== hunk.beforeCount) return `块头声明原文 ${hunk.beforeCount} 行，正文实际 ${before} 行`
  const after = countsOfSide(hunk, 'after')
  if (after !== hunk.afterCount) return `块头声明新文 ${hunk.afterCount} 行，正文实际 ${after} 行`
  return null
}

/**
 * 把补丁块应用到文本（`PlainSimplePatchApplier` 的等价物：**先核账**（块头声明的行数 = 正文行数），
 * 再**逐块核对上下文**，不 fuzz）。任一块对不上就整文件失败 —— 返回第几块（1 基）与理由，调用方不许写盘。
 *
 * 行尾：目标文本按上游 `LineTokenizer.tokenize(text, false)` 的切法切行（`splitPatchLines`），
 * 与补丁那一侧（`parseUnifiedPatch` 已把 `\r\n`/`\r` 归一成 `\n`）同一口径 ⇒ CRLF 文件的补丁能对上
 * （上游同款规矩：`LineOffsetsUtil.java:11-12`「不支持 CRLF，先 convertLineSeparators」+
 * `BaseRevisionTextPatchEP.java:99`）；写回的文本用**原文件自己的主行尾**（`patchLineEnding`）。
 */
export function applyHunksToText(text: string, hunks: readonly PatchHunk[]): HunkApplyResult {
  const separator = patchLineEnding(text)
  const hadTrailingNewline = text.endsWith('\n')
  const source = splitHunkLines(text)
  const target: string[] = []
  let cursor = 0
  for (let index = 0; index < hunks.length; index++) {
    const hunk = hunks[index]!
    // 账目先核（上游 `apply/PlainSimplePatchApplier.java:117-122`，路径经参考树 `find -iname` 核实为
    // `platform/vcs-impl/src/com/intellij/openapi/diff/impl/patch/apply/PlainSimplePatchApplier.java`，
    // 派单写的 `platform/diff-impl/…/diff/impl/` 那份在本树里不存在；行号 `:114-115` 数、`:117-122` 比，未漂）：
    // 块头声明的两侧行数 ≠ 正文实际行数 ⇒ 整块失败，**不进入**后面的上下文核对与偏移搜索。
    const mismatch = hunkCountsMismatch(hunk)
    if (mismatch) return { ok: false, hunk: index + 1, reason: `块头与正文不符：${mismatch}` }
    // 块的起点：`beforeCount === 0` 的纯插入块，块头那个数是「插在第几行之后」（git 的 `@@ -l,s` 语义，
    // 见 `patchHunkStartIndex` 的注释）；其余情况是 1 基的首行行号。
    const start = patchHunkStartIndex(hunk.beforeStart, hunk.beforeCount)
    if (start < cursor) return { ok: false, hunk: index + 1, reason: '与上一块重叠' }
    if (start > source.length) return { ok: false, hunk: index + 1, reason: '起点超出文件行数' }
    for (let i = cursor; i < start; i++) target.push(source[i] ?? '')
    cursor = start
    for (const line of hunk.lines) {
      if (line.type === 'add') { target.push(line.text); continue }
      if ((source[cursor] ?? '') !== line.text) {
        return { ok: false, hunk: index + 1, reason: `第 ${cursor + 1} 行上下文对不上（补丁要「${line.text}」，文件里是「${source[cursor] ?? ''}」）` }
      }
      if (line.type === 'context') target.push(source[cursor] ?? '')
      cursor++
    }
  }
  for (let i = cursor; i < source.length; i++) target.push(source[i] ?? '')
  let result = joinHunkLines(target, separator)
  // 补丁声明「新文件的最后一行没有结尾换行」：那就是块里最后一行带 `\ No newline`
  // （上游 `PatchHunk.isNoNewLineAtEnd`，`platform/vcs-api/vcs-api-core/src/com/intellij/openapi/diff/impl/patch/PatchHunk.java:65-70`
  // —— 取的就是 `myLines` 最后一行的 `isSuppressNewLine()`）。落盘时按它决定补不补行尾
  // （`platform/vcs-impl/src/com/intellij/openapi/diff/impl/patch/apply/PlainSimplePatchApplier.java:74-79` 的 `isNoNewlinePatched`、
  // `apply/GenericPatchApplier.java:1139-1145` 的 `withLineBreak`），
  // 并且只在**这一块吃到文件末尾**时才生效（同处的 `containsLastLine`，`:1150-1152`）。
  const lastHunk = hunks[hunks.length - 1]
  const touchesEnd = cursor >= (hadTrailingNewline ? source.length - 1 : source.length)
  const suppress = lastHunk?.lines[lastHunk.lines.length - 1]?.noNewline === true && touchesEnd
  if (suppress) {
    if (result.endsWith('\n')) result = result.slice(0, -1)
  } else if (hadTrailingNewline && !result.endsWith('\n') && result !== '') {
    // 原文有结尾换行 ⇒ 补回去。但 `result === ''` 是「整份文件被删空」那一档（正文只剩
    // `splitPatchLines` 结尾那个空元素），真 `git apply` 给的是**空文件**而不是一个空行 —— 不补。
    result += separator
  } else if (!hadTrailingNewline && result.endsWith('\n') && text !== '') {
    // 原文没有结尾换行、补丁也没显式声明 ⇒ 保留「无结尾换行」的形态。
    result = result.slice(0, -1)
  }
  return { ok: true, text: result }
}

/**
 * 「这个补丁是不是已经应用过了」：逐块比对新文那一侧（上游 `ApplyTextFilePatch` 用
 * 文件内容与 before/after 两侧比，命中 after 就是 `ALREADY_APPLIED`）。
 * 起点用 `patchHunkStartIndex`（`+c,0` 的纯删除块，那个 `c` 是「删完之后落在第 c 行之后」）。
 *
 * **账目先核**（上游 `apply/GenericPatchApplier.java:121-122`：`myNotExact` 非空 ⇒ `getStatus()` 直接
 * 返回 FAILURE，这条排在 `:124`/`:134` 那两条 ALREADY_APPLIED **之前**；而 `myNotExact` 装的正是
 * `SplitHunk.read(hunk)`（`:186`），其落位用的两个数是块头声明的 `getStartLineBefore()` /
 * `getStartLineAfter()`（`:1241-1242`）⇒ 正文放不下声明的跨度时根本走不到「已应用」那一档）。
 * 本仓原先没有这一道：块头比正文多报几行的补丁（真实输入 = 半截补丁文件）在这里被判成 `alreadyApplied`，
 * 于是 `planPatchApplication` 给 `plan.ok = true`，宿主那条「计划不 ok 时一个字节都不写」
 * （`src/patchApplyHost.ts:64`）被绕开；改名那一档还会产出 `action: 'rename'` + **没打过补丁**的原文，
 * 把文件改了名而让整块改动静默丢失。
 */
export function isAlreadyApplied(text: string, hunks: readonly PatchHunk[]): boolean {
  for (const hunk of hunks) if (hunkCountsMismatch(hunk)) return false
  const source = splitHunkLines(text)
  for (const hunk of hunks) {
    const start = patchHunkStartIndex(hunk.afterStart, hunk.afterCount)
    const expected = afterLines(hunk)
    if (start + expected.length > source.length) return false
    for (let i = 0; i < expected.length; i++) if (source[start + i] !== expected[i]) return false
  }
  return hunks.length > 0
}

/**
 * 两级应用（上游 `GenericPatchApplier.apply` 的主入口，`:74-86`）：
 * 先 `applyHunksToText`（逐块核对块头的行号），对不上再**偏移搜索**（`src/patchFuzzy.ts`，
 * 在附近 ±1000 行内找能对上上下文的位置）。两级都失败才算失败 —— 整文件一个字节都不改。
 *
 * 成功时 `offsetHunks` 记有几块是靠偏移找到的（0 = 全对在原位）：偏移只改落点、不改内容，
 * 所以档位仍是 SUCCESS（`GenericPatchApplier.getStatus` 的口径）。
 */
export function applyHunksFlexible(text: string, hunks: readonly PatchHunk[]): HunkApplyResult {
  // 块头与正文的账目先核一遍（上游 `PlainSimplePatchApplier.java:117-122`）：这笔账不对时
  // **不许**再走偏移搜索 —— 偏移只救「行号偏了」，不救「行数对不上」。
  for (let index = 0; index < hunks.length; index++) {
    const mismatch = hunkCountsMismatch(hunks[index]!)
    if (mismatch) return { ok: false, hunk: index + 1, reason: `块头与正文不符：${mismatch}` }
  }
  const exact = applyHunksToText(text, hunks)
  if (exact.ok) return exact
  const searched = applyHunksWithOffsetSearch(text, hunks)
  if (searched.ok && searched.text !== undefined) return { ok: true, text: searched.text, offsetHunks: searched.offsetHunks }
  return { ok: false, hunk: searched.hunk ?? exact.hunk, reason: `${exact.reason}；偏移搜索也没找到：${searched.reason ?? '无'}` }
}

/** 逐文件的执行计划（纯数据；IO 由调用方做）。 */
export interface PatchFilePlan {
  status: ApplyPatchStatus
  action: 'update' | 'create' | 'delete' | 'rename' | 'none'
  /** 写盘的目标路径（`relativePath` 语义；`delete` 时是要删的路径）。 */
  path: string
  /** 改名来源（只有 `rename` 有）。 */
  fromPath?: string
  /** 新内容（`create`/`update`/`rename` 有；`delete` 为 null）。 */
  content: string | null
  /** `skip`/`failure` 的理由。 */
  reason?: string
}

export interface PatchPlan {
  files: PatchFilePlan[]
  /** 整批的合并档位（上游 `ApplyPatchStatus.and`：一好一已应用算 partial，最坏的那个赢）。 */
  status: ApplyPatchStatus
  /** 有失败文件时：整批不落盘（除非调用方显式要求部分应用）。 */
  ok: boolean
}

/** 档位合并（上游 `ApplyPatchStatus.and` 的排序：success < alreadyApplied < partial < failure）。 */
export function andStatus(left: ApplyPatchStatus, right: ApplyPatchStatus): ApplyPatchStatus {
  const order: ApplyPatchStatus[] = ['skip', 'success', 'alreadyApplied', 'partial', 'failure']
  const pair = new Set([left, right])
  if (pair.size === 2 && pair.has('success') && pair.has('alreadyApplied')) return 'partial'
  return order[Math.max(order.indexOf(left), order.indexOf(right))] ?? 'failure'
}

/** 逃逸检查（上游 `PathsVerifier`：补丁路径不许是绝对路径或带 `..`）。 */
export function verifyPatchPath(path: string): string | null {
  const unified = path.replace(/\\/g, '/')
  if (!unified) return '空路径'
  if (/^[A-Za-z]:/.test(unified) || unified.startsWith('/')) return '绝对路径'
  if (unified.split('/').some(segment => segment === '..')) return '路径含 ..'
  return null
}

/**
 * 计算整份补丁的执行计划。`files` 是「目标文件当前内容」表（不存在的路径给 `null`），
 * key 用仓库相对路径。任何一项失败 ⇒ `ok: false`，调用方应当整批不落盘。
 */
export function planPatchApplication(patch: ParsedPatch, files: ReadonlyMap<string, string | null>): PatchPlan {
  const plans: PatchFilePlan[] = []
  let status: ApplyPatchStatus | null = null
  const add = (plan: PatchFilePlan) => {
    plans.push(plan)
    status = status === null ? plan.status : andStatus(status, plan.status)
  }
  for (const file of patch.files) {
    // 删除的补丁新侧是 `/dev/null`，可写路径取旧侧；其余取新侧。
    const target = file.newPath ?? file.oldPath ?? ''
    const targetError = verifyPatchPath(target) ?? (file.kind === 'rename' && file.oldPath ? verifyPatchPath(file.oldPath) : null)
    if (targetError) {
      add({ status: 'failure', action: 'none', path: target, content: null, reason: `路径不安全：${targetError}` })
      continue
    }
    if (file.binary) {
      add({ status: 'skip', action: 'none', path: target, content: null, reason: '二进制补丁（GIT binary patch / Binary files differ）本仓没有解码链，未应用' })
      continue
    }
    if (file.kind === 'rename') {
      const from = file.oldPath ?? ''
      const to = file.newPath ?? file.oldPath ?? ''
      const source = files.get(from) ?? null
      if (source === null) {
        add({ status: 'failure', action: 'none', path: to, fromPath: from, content: null, reason: `改名的源文件不在工作区：${from}` })
        continue
      }
      if (file.hunks.length === 0) {
        if (files.get(to) !== undefined && files.get(to) !== null) {
          add({ status: 'failure', action: 'none', path: to, fromPath: from, content: null, reason: `改名的目标已存在：${to}` })
          continue
        }
        add({ status: 'success', action: 'rename', path: to, fromPath: from, content: source })
        continue
      }
      const applied = applyHunksFlexible(source, file.hunks)
      if (!applied.ok) {
        const statusValue: ApplyPatchStatus = isAlreadyApplied(source, file.hunks) ? 'alreadyApplied' : 'failure'
        add({ status: statusValue, action: statusValue === 'alreadyApplied' ? 'rename' : 'none', path: to, fromPath: from, content: statusValue === 'alreadyApplied' ? source : null, reason: applied.ok ? undefined : applied.reason })
        continue
      }
      add({ status: applied.text === source ? 'alreadyApplied' : 'success', action: 'rename', path: to, fromPath: from, content: applied.text })
      continue
    }
    if (file.kind === 'add') {
      const path = file.newPath ?? ''
      if (files.get(path) !== undefined && files.get(path) !== null) {
        add({ status: 'failure', action: 'none', path, content: null, reason: `新增的路径已存在：${path}` })
        continue
      }
      const content = joinHunkLines(file.hunks.flatMap(hunk => afterLines(hunk))) + '\n'
      add({ status: 'success', action: 'create', path, content })
      continue
    }
    if (file.kind === 'delete') {
      const path = file.oldPath ?? ''
      const source = files.get(path) ?? null
      if (source === null) {
        add({ status: 'alreadyApplied', action: 'none', path, content: null })
        continue
      }
      if (file.hunks.length === 0) { add({ status: 'success', action: 'delete', path, content: null }); continue }
      const applied = applyHunksFlexible(source, file.hunks)
      if (!applied.ok) {
        add({ status: 'failure', action: 'none', path, content: null, reason: applied.reason })
        continue
      }
      // 删文件：块应用后的结果必须是空文本（上游 `TriggerAdditionOrDeletion` 的删除分支）。
      add({ status: applied.text.trim() === '' || applied.text === '\n' ? 'success' : 'partial', action: 'delete', path, content: null })
      continue
    }
    // text：普通改动（也覆盖没有 `diff --git` 行、只有 `---/+++` 的 diff -u）。
    const path = file.newPath ?? file.oldPath ?? ''
    const source = files.get(path) ?? null
    if (source === null) {
      add({ status: 'failure', action: 'none', path, content: null, reason: `文件不在工作区：${path}` })
      continue
    }
    if (file.hunks.length === 0) {
      add({ status: 'skip', action: 'none', path, content: null, reason: '补丁里没有块（可能只是模式改动）' })
      continue
    }
    const applied = applyHunksFlexible(source, file.hunks)
    if (!applied.ok) {
      const statusValue: ApplyPatchStatus = isAlreadyApplied(source, file.hunks) ? 'alreadyApplied' : 'failure'
      add({ status: statusValue, action: 'none', path, content: null, reason: applied.reason })
      continue
    }
    add({ status: applied.text === source ? 'alreadyApplied' : 'success', action: applied.text === source ? 'none' : 'update', path, content: applied.text })
  }
  const finalStatus: ApplyPatchStatus = status ?? 'skip'
  return { files: plans, status: finalStatus, ok: plans.every(plan => plan.status === 'success' || plan.status === 'alreadyApplied' || plan.status === 'skip') }
}

/** 补丁文本的主行尾（写回落盘时保留原文件的；补丁自己的行尾只用于解析）。 */
export function patchLineEnding(original: string): '\r\n' | '\r' | '\n' {
  return detectLineSeparator(original)
}

/** 二进制守卫：调用方读到的补丁文本若本身是二进制就拒绝（上游 `NotAPatchException`）。 */
export function isBinaryPatchText(text: string): boolean {
  return looksBinary(text)
}
