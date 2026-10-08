// 大文件的**按字节**判定（补齐 `src/largeFileMode.ts` 注释里点名的缺口：「判定按字符数而不是
// 字节数」）。上游 `LargeFileEditorProvider` 拿到的是 VFS 的文件长度（字节）；本仓前端只有已解码
// 文本，所以用码点逐段累加 UTF-8 字节数 —— 对 CJK/emoji 源码，字符数与字节数能差 3–4 倍，
// 「5 MiB 的翻译文件」按字符判会晚 3 倍才降级。
//
// 阈值沿用 `LARGE_FILE_LIMIT`（5 MiB），策略复用 `largeFilePolicy`。这个模块补两件事：
//   ① 「文本 → 字节」（`utf8ByteLength`，实现已搬到 `src/fileSizeFormat.ts`，这里原样再导出）；
//   ② **降级档由编辑器提供者裁决**：字节超限后问 `com.intellij.fileEditorProvider` 上的
//      `LargeFileEditor` 支（`largeFileEditorViewFor`，bundled 贡献在 `src/largeFileViewer.ts`）
//      —— 第三方按同一 id 覆盖它、或挂抑制器，都能改掉本仓编辑器的降级结果。
//      改前这里是本地写死的一支，EP 只影响提示条文案（见
//      `docs/wiring-requests-2026-10-07-epmount.md` 的 W-EP-2）。
//
// 判据：`tests/large-file-bytes.test.mjs`。

import { LARGE_FILE_LIMIT, largeFilePolicy, type LargeFilePolicy } from './largeFileMode.ts'
import { formatFileSize, utf8ByteLength } from './fileSizeFormat.ts'
import { largeFileEditorViewFor } from './largeFileViewer.ts'

// 两个格式化件已搬到 `src/fileSizeFormat.ts`（那里写了为什么）；这里原样再导出，
// 既有 import 点（`src/components/CodeEditor.vue:89` 与 tests/editor-large-file-guard.test.mjs:45）不用动。
export { formatFileSize, utf8ByteLength } from './fileSizeFormat.ts'

/**
 * 按字节判大文件 —— **编辑器侧**的那一次判定（`CodeEditor.vue:130` 调的就是它）。
 *
 * `path` / `root` 透给编辑器提供者（按路径认领的 provider 要它们；不传时按空串，认领只看大小那一支）。
 * 分三档：
 *   · 没超限 ⇒ 本地结论即终局（不该有任何 provider 接管，bundled 的 `accept` 也是同一个阈值）；
 *   · 超限但**没有我们这支的视图**（被抑制器挡住 / 被别的 provider 抢先）⇒ 退回本地档，与旧版逐字一致；
 *   · 有视图 ⇒ 按视图的 `features` 判：三个能力里有任何一个没开就是降级档（全开 = 这个文件不用降级）。
 */
export function largeFilePolicyForText(text: string, path = '', root = ''): LargeFilePolicy {
  const bytes = utf8ByteLength(text)
  const local = largeFilePolicy(bytes)
  if (!local.large) return local
  const view = largeFileEditorViewFor({ path, root, bytes })
  if (!view) return local
  const degraded = !view.features.lsp || !view.features.syntaxHighlighting || !view.features.wordWrap
  return { large: degraded, notice: view.notice || local.notice, features: view.features }
}

/** 超限了吗（状态栏/提示的布尔问法）。纯本地：不经过 EP，不涉及降级档。 */
export function isLargeFileText(text: string): boolean {
  return utf8ByteLength(text) >= LARGE_FILE_LIMIT
}

/**
 * 编辑器侧的**降级计划**：`largeFilePolicyForText` 那三个分量（`features`）各自到底开不开，
 * 加上只读与提示文案 —— 宿主（`CodeEditor.vue`）要的就是这几件事，而不是一个被压扁的布尔。
 *
 * 为什么要有这一层：`CodeEditor.vue:131` 现在把结论压成 `const heavy = large.large`，于是
 * 语法高亮 / 语言服务 / 自动换行**三项一起开关**；第三方按同一 id 覆盖 `LargeFileEditor`
 * 只想关一项（例如只关 wordWrap）时，本仓仍会三项全关。这个函数把 EP 裁决出来的粒度原样给出，
 * 宿主逐个分量接线即可（接线点与逐行改法见
 * `docs/wiring-requests-2026-10-07-epmount2.md` 的 W2-EP-2）。
 *
 * `readOnly`：大文件档一律只读（上游 `EditorModel.java:1017` 用 `EditorFactory.createViewer`），
 * 非大文件档取调用方给的 `props.readOnly`。
 */
export interface EditorLargeFilePlan {
  /** 超限且被判成降级档（与 `policy.large` 同值；保留给"只问降级与否"的调用点）。 */
  degraded: boolean
  /** 语言服务（补全 / 诊断 / 语义着色 / 折叠区间 / inlay…）是否可用。 */
  lsp: boolean
  /** 语法高亮（词法着色）是否可用。 */
  syntaxHighlighting: boolean
  /** 自动换行是否可用。 */
  wordWrap: boolean
  /** 编辑器是否只读。 */
  readOnly: boolean
  /** 顶部提示条文案（不降级时 null）。 */
  notice: string | null
}

/**
 * 由一次判定结果算出编辑器计划。三个分量**逐个**透出（不再压成一个布尔）——
 * 这就是「features 粒度没被消费」那个缺口的纯逻辑侧落点。
 */
export function editorLargeFilePlan(policy: LargeFilePolicy, diskReadOnly = false): EditorLargeFilePlan {
  return {
    degraded: policy.large,
    lsp: policy.features.lsp,
    syntaxHighlighting: policy.features.syntaxHighlighting,
    wordWrap: policy.features.wordWrap,
    readOnly: policy.large || diskReadOnly,
    notice: policy.large ? policy.notice : null,
  }
}
