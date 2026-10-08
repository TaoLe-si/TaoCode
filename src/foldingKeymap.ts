// 折叠一族的键位表（B4 = codeInsight/folding，判决 `docs/inventory/verdict-folding.md` §A）。
//
// 这里只登记**展开到级别**那族两段式（chord）键位，因为它们是本仓此前判成"分不开、只能单段"
// 的那一段（订正留痕见下）。其余八条单段折叠键（收起 / 展开 / 全部收起 / 全部展开 / 递归 ± /
// 折叠选区 / 折叠代码块）此刻仍写死在 `src/components/CodeEditor.vue` 的常驻 keymap 里、逐条与
// `$default.xml` 对得上（那条是保留文件）。本表要接的只有一条接线（`docs/wiring-requests-2026-10-06-foldchord.md`
// 的 W-1）：把 `CodeEditor.vue` 里那条**写错的单段** `{ key: 'Ctrl-*', run: unfold.level1 }` 摘掉、
// 换成 `...foldingKeymap`（五条 `Ctrl-* 1..5` 两段式）；那八条单段照旧原地不动。
//
// ── 上游坐标（本 lane 逐行开过，不是照抄任务书）────────────────────────────────────────
// `platform/platform-resources/src/keymaps/$default.xml`：
//   · `ExpandToLevel1..5`（`platform/platform-resources/src/keymaps/$default.xml:385-403`）
//     = `first-keystroke="control MULTIPLY"` + `second-keystroke="1".."5"`（每级另有 `NUMPAD1..5` 一条）；
//   · `ExpandAllToLevel1..5`（`platform/platform-resources/src/keymaps/$default.xml:405-424`）
//     = `first-keystroke="control shift MULTIPLY"` + `second-keystroke="1".."5"`（同样各带 `NUMPAD*`）。
// ⇒ 上游本来就是**两段式、每级一键**（10 条独立绑定 × 两族），不是"一条键吃 1–5"。
// 命令侧本仓早已就位：`expandCaretToLevel(1..5)` / `expandAllToLevel(1..5)`（`src/editorFolding.ts`），
// 在 `src/editorCommands.ts` 注册成 `unfold.level1..5` / `unfold.all.level1..5`。缺的只有键位。
//
// ── CodeMirror 支持两段式 chord（本机 node_modules 实证）──────────────────────────────
// `@codemirror/view` 的 `keymap.of([...])` 认**空格分隔的多段键名**：
//   · `node_modules/@codemirror/view/dist/index.js:9164` `buildKeymap` 里 `key.split(/ (?!$)/)` 把
//     `'Ctrl-* 1'` 拆成两段；`:9165-9179` 给每一段前缀注册一个"等下一键"的 handler（`storedPrefix`）；
//   · `:9222-9228` + `:9251` `runHandlers` 命中前缀后把 `storedPrefix.prefix + " "` 与下一个键拼回去查表 ⇒
//     第一段只把编辑器放进"前缀等待"状态、**不触发命令**，第二段才落到具体命令。
//   · 代价：`node_modules/@codemirror/view/dist/index.js:9154-9160` 的 `checkPrefix` —— 同一个键名
//     既当**普通绑定**又当**多段前缀**会抛 `"...used both as a regular binding and as a multi-stroke prefix"`。
//     ⇒ 所以 W-1 必须把 `CodeEditor.vue` 里那条普通的 `{ key: 'Ctrl-*', run: unfold.level1 }` **摘掉**，
//     否则一旦把本表的 `Ctrl-* 1..5` 前缀并进去就直接抛。
//
// ── 订正留痕：为什么"分不开、只能单段"是误读，但"Shift 那一族"确实分不开 ──────────────
// 用 CodeMirror 真实匹配器跑过两段（`tests/editor-folding.test.mjs`）：
//   · `Ctrl+*` 单段（第一段）**不触发任何命令**（它是前缀）；`Ctrl+* 1`..`5` 两段各自触发 `unfold.level1`..`5`
//     ⇒ "一条键只能绑到级别 1 / 分不出 1–5"不成立，两段式对 caret 族完全可用。
//   · 但 `Ctrl+Shift+*` 与 `Ctrl+*` 在浏览器里**分不开**：乘号是"字符键"（`w3c-keyname` 的 `base[106] =
//     shift[106] = '*'`），`@codemirror/view/dist/index.js:9106-9116` 的 `modifiers` 对字符键
//     在首次查表时把 Shift 去掉（`shift !== false` 不成立），于是 `Ctrl+Shift+*` 也解析成前缀 `Ctrl-*`，
//     命中 caret 族 ⇒ `ExpandAllToLevel` 若与 `ExpandToLevel` 绑在同一个乘号上会被完全遮蔽（实测只有 caret 触发）。
//     给 `Ctrl-Shift-* 1..5` 编一组永远不会被命中的绑定就是死键位（规约 §8），所以本表**只绑 caret 族**。
//     `unfold.all.level1..5` 那五条命令照旧走 Code 菜单的「全部展开到级别」子菜单，键位面留空并在此登记理由。

/** 一条 chord 键位：键名 + `editingCommands` 里的命令名（宿主 `runEditorCommand` 的同一套名字）。 */
export interface FoldingChordBinding { key: string; command: string }

/**
 * `Ctrl+*` 之后按 `1`..`5` —— 上游 `ExpandToLevel1..5`（`$default.xml:385-403`）：
 * 把光标所在那块**展开到第 N 层**（`expandCaretToLevel(N)`）。命令名与 `src/editorCommands.ts` 一致。
 */
export const foldingLevelChords: readonly FoldingChordBinding[] = [
  { key: 'Ctrl-* 1', command: 'unfold.level1' },
  { key: 'Ctrl-* 2', command: 'unfold.level2' },
  { key: 'Ctrl-* 3', command: 'unfold.level3' },
  { key: 'Ctrl-* 4', command: 'unfold.level4' },
  { key: 'Ctrl-* 5', command: 'unfold.level5' },
]
