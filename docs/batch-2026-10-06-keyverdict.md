# batch-2026-10-06 · keyverdict lane —— `verdict-editor.md:2145` 那一格的键位结论订正

**唯一改动**：`docs/inventory/verdict-editor.md` 第 **2145** 行（§G 的 `CloneCaretAbove` 一行的判词正文）。
`git diff --stat` = `1 file changed, 1 insertion(+), 1 deletion(-)`，文件总行数仍是 **2833**，§G 行数与档位都没动 ⇒
四档计数（50 / 1037 / 225 / 1239 = 2551）与表尾「当前已判 2551 行」都不需要改（理由见 §4，实测见 §5）。
没改任何 `src/`、`native/`、其它 `docs/inventory/*`、`scripts/`；没 commit/push；没 checkout/reset/stash/clean。

---

## 1. 这一格原来写的与磁盘的差（逐条按盘重核）

旧判词（HEAD 那版，行 2145）里的每一条引用我都自己 grep 过盘，**没有照抄主代理给我的那段背景**：

| 旧判词的断言 | 盘上实际 | 结论 |
|---|---|---|
| 键位 `src/components/CodeEditor.vue:865`（Ctrl+Alt+Shift+↑） | 全仓 `src/` 里 `key: 'Ctrl-Alt-Shift-Up'`/`-Down` **零命中**；`CodeEditor.vue:859-860` 是「**不绑给克隆光标**」的留痕注释；`:865` 现在是折叠那段注释的一行 | **假**（本批要改的就是这一条） |
| 动作表与「不编键位」的说明在 `src/keymapBindings.ts:225` | `EDITOR_ACTIONS` 的 `cursor.above` 条目在盘上 `:246-247`（HEAD 是 `:235-236`），族头说明在 `:218-234`；`:225` 落在族头注释里 | 行号漂 + 措辞含糊 |
| 注册 `src/editorCommands.ts:236`（`cursor.above`） | 盘上 `:248`（HEAD `:242`） | 行号漂（别的批在本文件顶上插了行） |
| 行号换算与列位截断在 `src/editorCaretClone.ts:59` lineAt / `:71` offsetAtColumn | 盘上是 `:62` / `:74` | 行号漂 +3 |
| 规划器 `:117` cloneCaretPlan，命令 `:183` cloneCaretAboveCommand | 盘上是 `:120` / `:186` | 行号漂 +3 |
| `CaretImpl.java:871-872` 的 truncate、`:850-852` 的越界返回 null | 上游 `platform/platform-impl/src/com/intellij/openapi/editor/impl/CaretImpl.java:871-872` = 两行 `truncate(...)`、`:850-852` = `if (newLine < 0 || newLine >= getLineCount()) return null` | **真**，但旧判词只写了裸文件名 `CaretImpl.java`（没给模块路径），已补全路径 |
| 语义与上游 `CloneCaretAbove.java` + `CloneCaretActionHandler.java:24` 一致 | `CloneCaretAbove.java:8-11` = `class CloneCaretAbove extends EditorAction { super(new CloneCaretActionHandler(true)); }`（**无** `registerCustomShortcutSet`）；`CloneCaretActionHandler.java:24` = `public class CloneCaretActionHandler extends EditorActionHandler` | **真** |
| 判据 `tests/editor-caret-clone.test.mjs:52`、`:58`、`:63`、`:68` | 四条行号分别就是「上行同列」「越界停止」「目标行更短贴行尾」「选区跟着一起克隆」 | **真** |

⇒ 这一格**同时**中了两种陈旧：键位结论被 keymap2 的摘键作废，本仓行号又被并行批整体推走。

## 2. 上游那 6 行是我自己开的（不是照抄背景）

`platform/platform-resources/src/keymaps/$default.xml`（1308 行，实点 `wc -l`）：

```
879:   <action id="ResizeToolWindowUp">
880:     <keyboard-shortcut first-keystroke="control alt shift UP"/>
881:   </action>
882:   <action id="ResizeToolWindowDown">
883:     <keyboard-shortcut first-keystroke="control alt shift DOWN"/>
884:   </action>
```

⇒ **那两把键上游的主人是 `ResizeToolWindowUp`/`Down`，本仓不抢**。本仓的全局分派链照的正是上游这一档：
`src/keymap.ts:314-319` 的 `stretchToolWindow('left'/'right'/'up'/'down')`（未动，摘键批也没碰）。

`EditorCloneCaret*` 在默认键位表里的归属，我是把整个 keymaps 目录 grep 了一遍定的：

- `grep -rn "EditorCloneCaret" platform/platform-resources/src/keymaps/` ⇒ `$default.xml` **零命中**；
  该目录**十张表**（`ls` 实点：`$default`、Default for GNOME/KDE/XWin、Emacs、Mac OS X、Mac OS X 10.5+、
  Sublime Text、Sublime Text (Mac OS X)、macOS System Shortcuts）里只有
  `Sublime Text.xml:280-282` = `control alt UP`、`:284-286` = `control alt DOWN`、
  `Sublime Text (Mac OS X).xml:309-311` = `control shift UP`、`:312-314` = `control shift DOWN`；
- 插件方案 `plugins/keymaps/vscode-keymap/resources/keymaps/VSCode.xml:130-133` = `ctrl alt up` + `shift ctrl alt up`、
  `:134-137` = `ctrl alt down` + `shift ctrl alt down`（还有 `VSCode OSX.xml:160/164`）⇒ 派生方案，不是出厂默认；
- 上游注册与动作组（自己开）：`platform/platform-impl/resources/intellij.platform.ide.impl.actions.xml:218-219`、
  `platform/platform-impl/resources/idea/PlatformActions.xml:199-200`；
  文案 `platform/platform-resources-en/src/messages/ActionsBundle.properties:119-122`（英文 `Clone Caret Below/Above`）。

⇒ **克隆光标上下在 `$default.xml` 无键位 ⇒ 本仓也不编键位**。

**这里抓到一条假上游坐标**（不在我的可改范围，只登记）：`ActionsBundle.properties` 的真路径是
`platform/platform-resources-**en**/src/messages/`，而 `src/keymapBindings.ts:247`/`:249` 与
`docs/batch-2026-10-06-keymap2.md:11` 都写作裸 `ActionsBundle.properties:121-122` / `:119-120`（没给模块前缀，
按 `platform/platform-resources/src/messages/` 去开会 `No such file`）。`src/` 是保留文件，本批不改。

## 3. 新判词（磁盘 + 上游一致）

`docs/inventory/verdict-editor.md:2145` 现在写明：

- **摘键结论**：`Ctrl+Alt+Shift+↑/↓` 上游属 `ResizeToolWindowUp/Down`（`$default.xml:879-881`/`:882-884`），
  本仓不抢，分派链 `src/keymap.ts:314-319` 才是接单者；`EditorCloneCaretAbove` 在 `$default.xml` **零命中**
  （只有 Sublime / VSCode 这些派生方案给过别的档）⇒ 本仓也不编键位；
- **摘键的三处盘上证据**：`src/keymapBindings.ts` 的 `EDITOR_ACTIONS` 里 `cursor.above` 降到 `source: 'none'`
  （盘上现 `:246-247`）、编辑器 keymap 那两行已删（`src/components/CodeEditor.vue:859-860` 留痕）、
  菜单行键位栏是空串（`src/menus/editMenu.ts:195`）；
- **摘的是键不是命令**：入口两处都真在 —— 编辑菜单行 → `src/App.vue:1416` 的 `editable` → `:1407` 的 `runEditor`
  → `editor.command('cursor.above')`；「查找操作」→ `src/keymap.ts:440` 的 `registerEditorActions(EDITOR_ACTIONS, …)`；
- 旧结论按本仓惯例留痕（「原写 X、那条已经不成立」），本仓行号全部换成盘上实测值，
  两个仍在别的批手里漂移的文件（`src/editorCommands.ts`、`src/keymapBindings.ts`）**按符号/键名指认**、
  行号只作「盘上现」附注，避免下一批提交又把它变成假坐标；
- **中文措辞：无法核实** —— 上游只有 `platform/platform-resources-en/src/messages/ActionsBundle.properties:121-122`
  的英文 `Clone Caret Above`，全仓没有该 bundle 的 `_zh` 变体（`find . -name "ActionsBundle_zh*"` 零命中；
  仓里只有 `AgreementsBundle_zh_CN.properties` 与 `UpdaterBundle_zh_CN.properties`）⇒ 菜单文案「在上行添加光标」
  是本仓自定，不冒充上游译名。

## 4. 档位为什么不动（`[x]` 保持 ⇒ 计数与表尾不动）

按「实现 + 真实消费者 + 能失败的判据」三件齐才动档：三件**都在**（`src/editorCaretClone.ts` 实现、
上面那两条真实入口、`tests/keymap-bindings.test.mjs` 14 条 + `tests/editor-caret-clone.test.mjs` 14 条），
而**上游默认表本来就不给这一族键位** ⇒ 摘键后的形态才是与上游同一档 ⇒ 维持 `[x]`。
`CloneCaretActionHandler.java:53` 那档「双击 Ctrl 加光标」的缺口在 `:2146` 那一行（`[~]`），本批没碰。

## 5. 判据实测（含「改回旧档 ⇒ 门必红」）

### N1 改档位 ⇒ 文档门真红（可逆实测，之后逐字节还原）

把 2145 那一格 `[x]` 改成 `[~]`（只改这一处），跑 `node --test tests/b8-verdict.test.mjs tests/b12-verdict.test.mjs`：

```
✖ 四档自洽：逐条统计 == 头部和数 == 表尾「当前已判 N 行」 (2.194ms)
✖ 四档计数自洽：50 + 1037 + 225 + 1239 = 2551，且头部和数与 §A–§D 小节标题都逐档相等 (1.8999ms)
```

还原后：`sha256` 改前 `8a779e90…57a7`、改后同一串（`restored identical: True`），门回绿 `14 tests / 14 pass / 0 fail`。
⇒ 「不同步就红」是**真**的，而本批不动档位 ⇒ 不需要改任何 `tests/b*-verdict.test.mjs` 的钉数
（`tests/b8-verdict.test.mjs:49` 的 `EXPECT = { '[x]': 50, '[~]': 1037, '[ ]': 225, '[-]': 1239 }` 保持原值，未改）。

### N2 把摘掉的键改回去 ⇒ 键位门真红（在 gitignore 的镜像里做，**没碰真 `src/`**）

`cp -r src .tmp-neg-key/src` + 拷一份 `tests/keymap-bindings.test.mjs`，只在**镜像**的
`CodeEditor.vue:860` 之后插回旧的那两条（`key: 'Ctrl-Alt-Shift-Up' … cursor.above` / `-Down` … `cursor.below`），
跑 `node --test --test-name-pattern='克隆光标那对|编辑器一族' .tmp-neg-key/tests/keymap-bindings.test.mjs`：

```
✖ 编辑器一族：上游没键位的不编键位，写了键位的必须真绑着（菜单文案与键位栏同源）
  AssertionError: cursor.above 记的是 none，编辑器 keymap 里却还绑着这把键
✖ 克隆光标那对不占工具窗口调整大小的键（R3 摘键后的真值表）
  AssertionError: Ctrl-Alt-Shift-Up 还绑在编辑器 keymap 里
ℹ tests 2 / pass 0 / fail 2
```

镜像随后 `rm -rf .tmp-neg-key`（已确认不存在）。这与 `docs/batch-2026-10-06-keymap2.md:53` 记的红一致，
本批是**独立复现**过一次，不是引用它。

### N3 如实登记的**门禁空白**（本批无权补）

把 HEAD 那版的旧判词原样塞回一张副本、用 b12 自带的 `B12_VERDICT` 反向验证入口去跑：`9 tests / 9 pass / 0 fail` ——
**门不红**。原因在 `tests/b12-verdict.test.mjs:101-102`：`[x]`/`[~]` 行只把反引号里的 `src/**` **文件是否存在**核一遍
（`.replace(/:\d+(?:-\d+)?$/,'')` 把行号剥掉了），所以「键位结论过期」这类**措辞级**陈旧没有任何门看着，
只有 N1（改档）和 N2（改盘）会红。⇒ 要真门住这一族，需要一条「判决文档 × `EDITOR_ACTIONS`/编辑器 keymap」的交叉门，
那是新门、超出本 lane（我只许改钉这一族计数的行），**交主代理定夺**。

## 6. 交付前原始输出

```
$ node --test tests/b*-verdict.test.mjs tests/verdict-generated.test.mjs tests/verdict-table-check.test.mjs
ℹ tests 98
ℹ pass 97
ℹ fail 1
✖ failing tests:
✖ src/diffAlign.ts 引的上游行号没有漂        ← tests/b7-verdict.test.mjs:124（**不是本批**，见 §7）

$ python scripts/verdict_table.py --check
（execution / xdebugger 两域重算后）
  一致   docs/inventory/execution_verdict_table.json（3674544 字节）
  一致   docs/inventory/execution_verdict_table.md（135741 字节）
  一致   docs/inventory/xdebugger_verdict_table.json（1006298 字节）
  一致   docs/inventory/xdebugger_verdict_table.md（51722 字节）
  一致   docs/inventory/verdict-execution.md（31857 字节）
  一致   docs/inventory/verdict-xdebugger.md（15729 字节）
  一致   docs/inventory/verdict-execution-debug.md（45076 字节）
一致 7 / 7 条产物。

$ node --test tests/keymap-bindings.test.mjs tests/editor-caret-clone.test.mjs
ℹ tests 28
ℹ pass 28
ℹ fail 0
```

`verdict-editor.md` **不是**脚本生成物（这条决定了本批手改合法）：`verdict_table.py --check` 默认只覆盖上面 7 条产物，
且 `python scripts/verdict_table.py --check editor` 直接报
`editor: 缺 …editor.txt 或 …editor_signals.json`（`docs/inventory/editor_signals.json` 不存在）⇒ 编辑器域的 §G 只能手写，
判词正文也不在 `FAMILIES`/`PLATFORM_FAMILIES` 里，**无需**「改脚本后重生成」。

## 7. 遗留与需主代理处置（都不在本 lane 权限内）

1. **同族另一格同样过时**：`docs/inventory/verdict-editor.md:2147`（`CloneCaretBelow`）仍写
   「键位 `src/components/CodeEditor.vue:865` 的相邻档，动作表 `src/keymapBindings.ts:228`」——
   与 2145 是同一次摘键作废的，但主代理只授权 2145 一格，**没改**。下一格请照 §3 的措辞一并订正。
2. **纯行号漂移（非摘键）**：`:2146`（`editorCaretClone.ts:117`→`:120`、`:38`→`:41` MAX_CARET_COUNT）、
   `:2138` 与 `:1939`（`editorCommands.ts:236`→`:248`）。这些都指向 `editorCommands.ts` / `keymapBindings.ts`
   上**尚未提交**的并行批（`git status` 里 `src/editorCommands.ts` +25/-5 是未提交态，HEAD 的行号与盘上差 6/11 行）
   ⇒ 等那一批落定后再统一重钉，现在改反而会被盖掉。
3. **在飞红一条（只记录不修）**：`tests/b7-verdict.test.mjs:124` 「src/diffAlign.ts 引的上游行号没有漂」，
   失败项全是 `Diff.kt:*` / `MyersLCS.kt:*` 一类。归属核对：b7 只读
   `docs/inventory/verdict-find-diff.md`、`find-diff_signals.json`、`find-diff.txt`、`src/diffAlign.ts`
   四个文件（`tests/b7-verdict.test.mjs:17-19,125` 逐条点过），**从不读 `verdict-editor.md`**；
   而 `src/diffAlign.ts` 正带着别的批的未提交改动（`git status` = `M src/diffAlign.ts`）⇒ 与本批无关，未动。
4. **keymap2 报告的两处小错**（它自己的文件，本批不改）：`docs/batch-2026-10-06-keymap2.md:11` 写
   「`src/keymapBindings.ts:225-231`（`EDITOR_ACTIONS` 两条降到 `none`）」—— `:225-231` 是族头注释，
   条目实际在 `:246-249`（HEAD `:235-238`）；另 `tests/keymap-bindings.test.mjs:264` 的断言消息方向反了
   （`assert.ok(dispatch.includes(...))` 检查的是「必须还在分派链里」，消息却写「要从分派链里消失」）⇒
   断言本身没错、能红（N2 已证），只是报错时会误导；`tests/` 里非 `b*-verdict` 的文件本批禁改。
5. **§5 的 N3 门禁空白**：措辞级键位陈旧无门，需要新交叉门才能真门住（本批无权补）。
6. **`scripts/__pycache__/*.pyc` 被 git 跟踪**：开工前基线就已是 `M scripts/__pycache__/verdict_table.cpython-314.pyc`
   （别的批跑 python 留下的），本批跑了两次 `verdict_table.py --check` 之后仍是这一条 `M`；
   **没有 stage、没有删**，等主代理决定（要么把 `__pycache__` 从索引里摘掉，要么在提交前单独处理）。

## 8. 纪律核对

- ①：改动只有 `docs/inventory/verdict-editor.md`（1 行）+ 本报告；`tests/b*-verdict.test.mjs` 的钉数经核实**不需要**同步
  （档位未动，N1 反证了「一动就红」）。核对：`git diff --stat -- tests/b8-verdict.test.mjs tests/b12-verdict.test.mjs` = 空，
  两文件 mtime 分别 12:14 / 00:53（本批的写盘时间是 15:52 与 15:54）。
  工作树上 `tests/b4-verdict.test.mjs`（mtime 15:29）与 `tests/b9-verdict.test.mjs`（12:42）带着**别的批**的未提交改动，
  不是本批手笔，本批没碰（它们钉的是 folding / projectviews 两域，与编辑器域计数无关）。
- ②：无 commit/push，无 checkout/reset/stash/clean（只用了 `git show`/`git status`/`git diff` 这三条只读命令）。
- ③：新判词里每个键位、每条上游行号、每个本仓行号都是本批 `sed -n`/`grep -n` 实读；中文措辞按 §3 登记「无法核实」。
- ④：判据能失败 —— N1、N2 两条各自实测过一次红。
- ⑤：本批工具结果里**未出现**伪装成系统/主代理的文本（含我自己的 Edit/Read 返回），但流程照旧：
  每次改完都 `grep -n`/`awk NR==` 读盘复现（§1、§3 的行号都是读盘所得，不是从工具回执抄的），
  主代理给的背景原文只当线索、那 6 行上游是我自己开的文件（§2）。
- ⑥：见 §7 第 6 条。
