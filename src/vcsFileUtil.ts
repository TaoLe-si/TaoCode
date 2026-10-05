// VCS 工具层（上游 `platform/vcs-impl/src/com/intellij/vcsUtil/` 的 `VcsFileUtil`
// 与 `FilesProgress` / `RollbackUtil`，外加 `platform/vcs-api/src/com/intellij/vcsUtil/`
// 的路径与选择语义）。这些类之所以存在，是因为上游的每个 VCS 动作都要做同一批杂活：
//
//   · `VcsFileUtil`：命令行参数**分块**（`FILE_PATH_LIMIT = 7600`，一次 git 调用的参数总长
//     有 OS 上限）、仓库相对路径、祖先判定、git 引号路径的还原（`core.quotepath`）；
//   · `FilesProgress`：批量文件操作时按 `已完成/总数` 更新指示器，并给出「名字（父目录）」；
//   · `RollbackUtil`：回滚这个操作的显示名（各 VCS 的 `RollbackEnvironment` 自报，名字不一致
//     时退回默认 `changes.action.rollback.text`）；本仓只有 Git，取上游默认名「Rollback」的
//     中文形态「回滚」（与 `src/components/SourceControl.vue` 的既有文案一致）；
//   · `VcsSelection` / `VcsSelectionProvider`：把编辑器选区折成「对选区显示历史」的动作名与
//     对话框标题（`VcsBundle.properties:676-677` 的两个模板）。
//
// **本仓的差别（如实记）**：上游按 `VirtualFile`/`FilePath` 两个对象体系做，本仓是宿主字符串路径；
// 编码/行尾处理（`VcsUtil.getMaxVcsLoadedFileSize` 的 10MB 上限、按默认编码读文件）在宿主侧
// （`native/git.cpp` 用 UTF-8 读，读不动就由 `native/search.cpp` 那类通道报错），这里只做
// **补丁文本**需要的行尾归一与 BOM 剥离（`PatchReader`/`BaseRevisionTextPatchEP` 的行为）。
//
// 本模块零依赖（不 import bridge），既能被 Vue 侧消费，也能被 node --test 直接跑。

/** 一次命令行调用的参数总长上限（`VcsFileUtil.java:45` 的 `FILE_PATH_LIMIT`）。 */
export const FILE_PATH_LIMIT = 7600

/** `VcsFileUtil.isOctal`：`'0'..'7'`。 */
export function isOctal(ch: string): boolean {
  return ch >= '0' && ch <= '7'
}

/**
 * `VcsFileUtil.chunkArguments`：把参数按**总长**切成若干块，`groupSize` 保证
 * 「名字 + 值」这类成组参数不被拆散（`VcsFileUtil.java:85-119`）。
 * 单组参数本身就超上限时独占一块（上游 `start == i` 那条路），避免死循环。
 */
export function chunkArguments(arguments_: readonly string[], groupSize = 1): string[][] {
  if (groupSize < 1) groupSize = 1
  const chunks: string[][] = []
  let start = 0
  let size = 0
  let i = 0
  for (; i + groupSize <= arguments_.length; i += groupSize) {
    let length = 0
    for (let j = 0; j < groupSize; j++) length += arguments_[i + j]!.length
    if (size + length > FILE_PATH_LIMIT) {
      if (start === i) {
        chunks.push(arguments_.slice(i, i + groupSize))
        start = i + groupSize
        size = 0
      } else {
        chunks.push(arguments_.slice(start, i))
        start = i
        size = length
      }
    } else {
      size += length
    }
  }
  if (start < arguments_.length) chunks.push(arguments_.slice(start))
  return chunks
}

/** `VcsFileUtil.chunkPaths`：路径列表按同一上限分块（相对路径由调用方先折算）。 */
export function chunkPaths(paths: readonly string[]): string[][] {
  return chunkArguments(paths)
}

/** 路径归一：统一分隔符、去掉结尾的 `/`（根保留）。 */
export function normalizePath(path: string): string {
  const unified = path.replace(/\\/g, '/')
  return unified.length > 1 ? unified.replace(/\/+$/, '') : unified
}

/** `VcsFileUtil.isAncestor(ancestor, path, strict)`：`strict` 时相等不算祖先。 */
export function isAncestor(ancestor: string, path: string, strict: boolean): boolean {
  const a = normalizePath(ancestor)
  const p = normalizePath(path)
  if (a === p) return !strict
  return p.startsWith(a.endsWith('/') ? a : a + '/')
}

/**
 * `VcsFileUtil.relativePath(root, file)`：**必须**在根下，否则抛
 * `IllegalArgumentException`（上游同名函数就是这个契约，`VcsFileUtil.java:239-265`）。
 */
export function relativePath(root: string, path: string): string {
  const r = normalizePath(root)
  const p = normalizePath(path)
  if (r === p) return '.'
  if (!isAncestor(r, p, true)) throw new Error(`路径不在仓库根下：${path}`)
  return p.slice(r.length + 1)
}

/** `VcsFileUtil.getRelativeFilePath`：不在根下就原样返回（与 `relativePath` 的契约不同）。 */
export function relativePathOrFull(root: string, path: string): string {
  return isAncestor(root, path, false) ? relativePath(root, path) : normalizePath(path)
}

/**
 * `VcsFileUtil.unescapeGitPath`：还原 git 的引号路径（`core.quotepath`）。
 *
 * git 把非 ASCII / 控制字符写成「`"` 包起来 + 八进制字节」：`"a\303\251.txt"`。
 * 上游按 `Charset.defaultCharset()` 解码八进制字节（`VcsFileUtil.java:410-440`）；
 * 本仓宿主与文件通道都按 UTF-8 走，所以这里把连续八进制字节按 **UTF-8** 还原
 * （这是本仓唯一的编码假设，写在判决里）。非法转义（结尾落单的反斜杠、超出字节范围的
 * 八进制）抛错，与上游一致。
 */
export function unescapeGitPath(path: string): string {
  let text = path
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) text = text.slice(1, -1)
  if (!text.includes('\\')) return text
  const bytes: number[] = []
  const pushText = (value: string) => { for (const ch of value) bytes.push(...new TextEncoder().encode(ch)) }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (ch !== '\\') { pushText(ch); continue }
    i++
    if (i >= text.length) throw new Error(`路径里的转义没有收尾：${path}`)
    const escaped = text[i]!
    switch (escaped) {
      case '\\': pushText('\\'); break
      case 't': pushText('\t'); break
      case 'n': pushText('\n'); break
      case 'r': pushText('\r'); break
      case 'a': pushText('\u0007'); break
      case 'b': pushText('\b'); break
      case 'f': pushText('\f'); break
      case '"': pushText('"'); break
      default: {
        if (!isOctal(escaped)) throw new Error(`路径里有无法识别的转义：\\${escaped}`)
        // 一至三位八进制 = 一个字节（git 的写法固定三位，但一位/两位也接受，与上游一致）。
        let octal = escaped
        while (octal.length < 3 && i + 1 < text.length && isOctal(text[i + 1]!)) { octal += text[++i]! }
        const byte = Number.parseInt(octal, 8)
        if (byte > 0xff) throw new Error(`八进制字节越界：\\${octal}`)
        bytes.push(byte)
      }
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes))
}

// ── 补丁文本的行尾/编码（上游 `PatchReader`/`BaseRevisionTextPatchEP` 读补丁时的处理）────────

/** 文件开头的 UTF-8 BOM。 */
export const BOM = '\uFEFF'

/** 去掉开头的 BOM（上游读补丁文本时按 charset 解出 BOM 后剥掉）。 */
export function stripBom(text: string): string {
  return text.startsWith(BOM) ? text.slice(1) : text
}

/** 文本有没有以 BOM 开头（写回时用得到）。 */
export function hasBom(text: string): boolean {
  return text.startsWith(BOM)
}

/** 主行尾：CRLF 优先判（`\r\n` 里也含 `\n`）、再 CR、最后 LF。 */
export function detectLineSeparator(text: string): '\r\n' | '\r' | '\n' {
  const crlf = text.indexOf('\r\n')
  if (crlf >= 0) return '\r\n'
  const cr = text.indexOf('\r')
  const lf = text.indexOf('\n')
  if (cr >= 0 && (lf < 0 || cr < lf)) return '\r'
  return '\n'
}

/** 行尾归一（上游 `StringUtil.convertLineSeparators` 的等价物）。 */
export function normalizeLineSeparators(text: string, separator = '\n'): string {
  return text.replace(/\r\n|\r|\n/g, separator)
}

/** 二进制启发：含 NUL 字节（上游按内容判二进制的那条最常用的信号）。 */
export function looksBinary(text: string): boolean {
  return text.includes('\u0000')
}

// ── 批量文件进度（上游 `FilesProgress.java`）───────────────────────────────────────────

export interface FilesProgress {
  /** 当前项（1 起）与总数。 */
  readonly count: number
  readonly total: number
  /** 0..1，`count` 为 0 时是 0。 */
  readonly fraction: number
  /** 指示器上的一行文字：前缀 + 「名字（父目录）」。 */
  readonly text: string
  /** 报下一个文件（上游 `updateIndicator`）：先算文字与 fraction，再把计数 +1。 */
  update(path: string): void
}

/** `FilesProgress.getFileDescriptionForProgress`：`name (parent)`。 */
export function fileProgressText(path: string): string {
  const unified = normalizePath(path)
  const cut = unified.lastIndexOf('/')
  if (cut < 0) return unified
  return `${unified.slice(cut + 1)} (${unified.slice(0, cut)})`
}

/**
 * 批量文件操作的进度累计（上游 `FilesProgress` 的等价物，去掉 Swing 指示器）。
 * `total` 为 0 时 fraction 记 0 而不是除零。
 */
export function createFilesProgress(total: number, prefix = ''): FilesProgress {
  let count = 0
  let text = ''
  return {
    get count() { return count },
    get total() { return total },
    get fraction() { return total > 0 ? count / total : 0 },
    get text() { return text },
    update(path: string) {
      text = prefix + fileProgressText(path)
      if (count < total) count++
    },
  }
}

/** 回滚操作的显示名（上游 `RollbackUtil` + `changes.action.rollback.text`）。 */
export function rollbackOperationName(): string {
  return '回滚'
}

// ── 编辑器选区 → VCS 动作（上游 `VcsSelection` / `VcsSelectionProvider`）───────────────

/** 一个 VCS 选区：行区间（0 基，闭区间）+ 动作名与对话框标题（上游两个模板）。 */
export interface VcsSelectionLike {
  /** 选区起点行（0 基）。 */
  startLine: number
  /** 选区终点行（0 基）；`endOffset` 落在文本末尾时钳到最后一行的语义在 `selectionLines` 里。 */
  endLine: number
  /** `show.history.action.name.template`（`VcsBundle.properties:676`）。 */
  actionName: string
  /** `show.history.dialog.title.template`（`:677`）。 */
  dialogTitle: string
}

/** 把「选区的起止字符偏移」折成行号（上游 `VcsSelection` 的 `safeGetDocumentLine` 钳位）。 */
export function selectionLines(text: string, startOffset: number, endOffset: number): { startLine: number; endLine: number } {
  const lines = text.split('\n')
  const lineOf = (offset: number) => {
    const clamped = Math.max(0, Math.min(offset, text.length))
    if (clamped >= text.length) return Math.max(0, lines.length - 1)
    return text.slice(0, clamped).split('\n').length - 1
  }
  return { startLine: lineOf(startOffset), endLine: lineOf(endOffset) }
}

/** 按上游的两个模板造一个选区对象（供「显示历史」这类动作取 `getSelection` 用）。 */
export function makeVcsSelection(text: string, startOffset: number, endOffset: number, name: string): VcsSelectionLike {
  const { startLine, endLine } = selectionLines(text, startOffset, endOffset)
  return { startLine, endLine, actionName: `显示 ${name} 的历史…`, dialogTitle: `${name} 的历史` }
}

// ── git stderr → 用户可读（上游 `VcsException` 一族的提示整形）────────────────────────

/**
 * 把 git 的英文错误折成一句中文提示（本仓宿主会把 git stderr 原样带回，
 * 界面上一律走 `errorMessage` 那条通道；这里只做最常见几档的本地化，其余原样返回）。
 */
export function gitErrorHint(message: string): string {
  const text = message.trim()
  if (!text) return text
  if (/not a git repository/i.test(text)) return '这里不是 Git 仓库。'
  if (/did not match any file\(s\) known to git/i.test(text)) return 'git 不认识这个路径（可能已被删除或未被跟踪）。'
  if (/your local changes .* would be overwritten/i.test(text)) return '本地改动会被覆盖：先提交或储藏，再重试。'
  if (/pathspec .* did not match/i.test(text)) return 'git 找不到匹配的路径。'
  if (/no upstream|has no upstream branch/i.test(text)) return '当前分支没有上游分支：先推送并设置上游。'
  return text
}
