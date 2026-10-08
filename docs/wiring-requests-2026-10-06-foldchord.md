# 接线请求 · 折叠两段式 chord 键位 · 2026-10-06（lane: foldchord）

保留文件 `src/components/CodeEditor.vue` 归主代理（任务硬约束 §3 点名不许动），本 lane 只把折叠域能自己
落地的部分落了（`src/foldingKeymap.ts` 权威表 + `src/editorCommands.ts` 接成 `foldingKeymap: KeyBinding[]`），
宿主那**一行**留在这里。上游/本机证据全部本 lane 自己开过（坐标见 `docs/batch-2026-10-06-foldchord.md`）。

## W-1｜把 `CodeEditor.vue` 里那条写错的单段 `Ctrl-*` 摘掉，换成两段式表

- 哪一行：`src/components/CodeEditor.vue:882`
  ```ts
  { key: 'Ctrl-*', preventDefault: true, run: editingCommands['unfold.level1']! },
  ```
- 改成什么：删掉这一条，在折叠那一族末尾（`:881` 的 `fold.block` 之后）展开本 lane 交出去的表：
  ```ts
  ...foldingKeymap,
  ```
  并在 `:12` 那行 `import { foldingRanges, lspFoldService } from '../editorFolding'` 旁边加一条：
  ```ts
  import { foldingKeymap } from '../editorCommands'
  ```
  （`foldingKeymap` 由 `src/editorCommands.ts` 用 `foldingLevelChords`（`src/foldingKeymap.ts`）接成 `KeyBinding[]`，
  `run` 就是 `editingCommands['unfold.level1..5']` 那五条已存在的命令。）
- 为什么：
  1. **上游本来就是两段式**：`ExpandToLevel1..5` = `control MULTIPLY` + `second-keystroke="1".."5"`
     （`platform/platform-resources/src/keymaps/$default.xml:385-403`，每级另有一条 `NUMPAD1..5`，浏览器里与主键区同名 ⇒ 各一条即可），
     不是"`Ctrl+*` 单段 = 展开到级别 1"。现在这条单段绑定就是那个误读的落地。
  2. **CodeMirror 原生支持两段式**（本机 node_modules 实证）：`node_modules/@codemirror/view/dist/index.js:9164`
     `buildKeymap` 把 `'Ctrl-* 1'` 按 `/ (?!$)/` 拆两段、`:9165-9179` 注册前缀、`:9222-9228`+`:9251` 命中前缀后拼第二段查表。
  3. **不摘就抛**：`node_modules/@codemirror/view/dist/index.js:9154-9160` 的 `checkPrefix` —— 同一个键名既当普通绑定
     （`Ctrl-*`）又当多段前缀（`Ctrl-* 1..5`）会抛 `"... used both as a regular binding and as a multi-stroke prefix"`。
     所以必须**删这条单段**、只留表里的 `Ctrl-* 1..5`。
  4. **只绑 caret 族，不绑 `Ctrl-Shift-*`**：乘号是字符键（`w3c-keyname` 的 `base[106] = shift[106] = '*'`），
     `@codemirror/view/dist/index.js:9106-9116` 的 `modifiers` 首次查表对字符键去掉 Shift ⇒ `Ctrl+Shift+*` 也解析成前缀 `Ctrl-*`，
     与 `Ctrl+*` 分不开（实测：两者之后按 N 都落到 `unfold.levelN`）。上游 `ExpandAllToLevel1..5`
     （`$default.xml:405-424`，`control shift MULTIPLY` + 1..5）在浏览器里会被 caret 族完全遮蔽；
     给分不开的键编死绑定是假键位（规约 §8），故那五条 `unfold.all.level1..5` 命令只走 Code 菜单的
     「全部展开到级别」子菜单（`src/menus/codeMenu.ts`），键位面留空并在此登记理由。
- 判据（本 lane 已落在 `tests/editor-folding.test.mjs`，反向验证过：注入→红→还原→绿）：
  - `展开到级别 1–5 = 两段式 chord：单段 Ctrl+* 不触发，Ctrl+* N 触发第 N 级（$default.xml:385-403）`
    —— 钉死 `foldingLevelChords` 的 5 条键名/命令名、`foldingKeymap[i].run === editingCommands['unfold.levelN']`（identity），
    并用真实 `runScopeHandlers` 跑两段：第一段 `Ctrl+*` 之后 hits 为空、第二段落到 `unfold.levelN`（N=1..5）。
  - `全部展开到级别（Ctrl+Shift+*）与 Ctrl+* 分不开 ⇒ 不绑 chord，只走菜单`—— 钉 `foldingLevelChords` 里没有 `Ctrl-Shift-*`，
    且实测 `Ctrl+Shift+*` 之后按 3 落到 `unfold.level3`（证实分不开）。
  - 宿主落地后的额外判据（本 lane 够不到，留给接线的那条 lane 补）：`CodeEditor.vue` 的常驻 keymap 里不再有
    `{ key: 'Ctrl-*', ... }` 这条单段，且 `...foldingKeymap` 在其中；整篇 keymap 能构造出来（不抛 checkPrefix）。

## 与本 batch 另一件（T1：折叠代码块撤里层用户自建折痕）无耦合

T1 全部落在 `src/editorFolding.ts`（非保留文件），不需要接线；判据同样在 `tests/editor-folding.test.mjs`。

## 处理结果（wiring-backlog lane，2026-10-06）

- 目标 `src/components/CodeEditor.vue`（禁改清单）+ `src/menus/codeMenu.ts`（本 lane）。因键位在 CodeEditor 内、单改菜单键位栏会与键位表不一致（判据会红），需 CodeEditor owner。

结论：零接线（转 CodeEditor owner）。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「零接线（转 CodeEditor owner）。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
