# lane verdict-editor-reds（2026-10-08）

6 条红（b4/b8/b9/b11/b12 + code-lens 那条设置页判据）→ 全绿。根因**不是**判词降档：
枚举基准 `editor.txt` 2551 / `settings-run.txt` 3247 / `folding.txt` 69 **一个数都没变**，
红在判决书自身的**计数/行格式漂移**与设置页被 UI 重构**拿掉的描述钩子**。核实方式：逐条脚本重数 §G
（不信文档自报），三份读数见下。不 commit / 不 push。

## A. editor 域（`verdict-editor.md`，2551 类）—— 谁漂了：文档

逐条重数 §G 实数 `[x]` 51 / `[~]` 1038 / `[ ]` 223 / `[-]` 1239；头部与 §A/§B/§C 标题停在 50/1037/225。
两个来源：
1. 工作树里既有的**真升档**：`ConvertToMacLineSeparatorsAction` `[ ]`→`[x]`。核实为真（四处坐标都在）：
   `native/workspace_codec.hpp:246-250`（crlf/lf/cr 三档）+ `src/editorFileOps.ts:179-199`
   （`separator: 'crlf'|'lf'|'cr'`）+ `src/menus/fileMenu.ts:86`（`file.lineSeparatorMac`）
   + `src/components/LineSeparatorStatusWidget.vue` ⇒ 订正头部（不降回）。
2. 更早一处**无留痕漂移**：HEAD 的 §G 已是 `[~]` 1038 / `[ ]` 224，头部按 1037/225 记（一行实际 `[~]`、头部当 `[ ]` 算）；本 lane 只同步计数。
改：`verdict-editor.md:14`（头部和数）、`:51`/`:94`/`:145`（§A/§B/§C 标题）、`:264`（§F 同句引用）、
`:2833`（§G 表尾补复核留痕，不含改档）。`tests/b8-verdict.test.mjs:54`（EXPECT→51/1038/223/1239，
原钉的是旧数）、`:78`（用例名）、`:85`（`includes` 那句）、`:50-53`（留痕注释）。
顺修 `b8:57`：`keyOf` 的分隔符原写成**裸 NUL 字节**（非 `\u0000` 转义）⇒ 文件被判二进制、工具拒读；
改成转义（语义一致，测试行为不变）。

## B. folding 域（`verdict-folding.md`，69 类）—— 谁漂了：文档行格式

§G 只解析出 67 行：`CollapseSelectionHandler`（`:171`）与 `CollapseSelectionAction`（`:199`）
**既无反引号、也无行尾 `|`**（Markdown 容忍、门禁正则不容忍）；其中一行落点写成
`src/editorFolding.ts:isFoldSelectionEnabled`（符号名当行号 ⇒ 存在性检查必红）。
改：两行补成 `| \`类\` | \`路径\` | \`[~]\` | … |`，落点写 `src/editorFolding.ts:722`（真实行号）。
改后 §G = 69 = `33/7/0/29`，与表尾「…= 69」逐档相等；档位维持 `[~]`（表尾自己列的「维持 `[~]` 的 7 行」
就是它们 + `ExpandAllToLevel1..5Action`）。判词正文一字未改。

## C. settings-run 域（`verdict-settings-run.md`，3247 类）—— 谁漂了：文档行格式

§G 的 3247 行**一行不少**，但 `StackTraceFolding` / `StackTraceFoldingConfigurable` /
`StackTraceFoldingSettings`（`:301`–`:303`）行尾**缺 `|` 前的空格**（`……展开。|`）⇒ 正则数到 3244。
表头「当前已判 **3247** 行」与「四档合计 **[x] 47 + [~] 398 + [ ] 2504 + [-] 298 = 3247**」是对的。
补空格后 §G = 3247 = `47/398/2504/298`，与表头逐档相等（三行档位 `[~]/[x]/[~]` 原就在，与 §B 叙述一致）。

[-] 的理由标记 ↔ 机械事实（`kind/widget/paint/os/test` 或路径：测试源码集 / `/gen/`）：
按 b9+b11 全部断言写了镜像脚本逐条跑，**0 条错配**；报出并已修的四处：
1. `:302` 落点 `native/settings_schema.*`（通配符，b11 逐条 `existsSync` 必红）⇒ 展开成真实存在的
   `native/settings_schema.cpp` + `native/settings_schema.hpp`。
2. `:1600` `FoldLinesLikeThis` `[~]` 只写「剩余差异：」⇒ 改「缺：上游经 Console Configurable 先编辑
   再应用，本仓直接持久化该规则；行折叠是本仓列表渲染实现」（说实缺口，不是换词）。
3. `:301` `StackTraceFolding` 的「剩余交互差异：」⇒ 改「缺：」，缺口说实（本仓工具条一次全展、上游逐段展开）。
4. `:303` `StackTraceFoldingSettings` `[~]` 通篇没有缺口句 ⇒ 补唯一可机械核实的差异：上游两键与
   `ConsoleFoldingSettings` 同装一个 `SimplePersistentStateComponent`、共用 `consoleFolding.xml`
   （上游 `StackTraceFoldingSettings.kt:15-17`/`:22-25`），本仓没有那份 XML 存储单元，两键落在编辑器设置
   键空间（`native/settings_schema.cpp:154`、`:297-304`，`.hpp:142`）；键名/默认/取值域逐条一致。
**生成物一个字没改**：`settings-run_verdict_table.json` 未手改（只允许重建）。

## D. 设置页（`tests/code-lens-grouping.test.mjs`）—— 谁漂了：页面

`91badd6`（UI 视觉重构批量）重写 `CodeVisionSettingsPage.vue` 时把四组复选框的 `:aria-describedby` 与
`field-hint` 一起拿掉了（`11a736e` 版还有，见 `git show 11a736e:…:82,85-86`），而判据
`tests/code-lens-grouping.test.mjs:534` 仍按「分组复选框带 `cv-group-<id>-hint` 描述」认这一行
（没它分不清总闸与四个分组开关）。这条判据是 SSR 真渲染，不是数源码。
改 `src/components/CodeVisionSettingsPage.vue`：`:37-44` 导入四个组 id；`:63-69` `GROUP_HINTS` +
`groupHintId`（四组各一条说明，只说本仓真会渲染的东西）；`:105` 复选框加 `:aria-describedby`；
`:108` 四个 `p.field-hint`（id 与描述同源）+ `:109` 分开关口径那句；样式沿用既有 `.field-hint`
（`SettingsDialog.vue:1067`），未新增几何/裸值。判据是 SSR 真渲染，改后 21/21 绿。

## E. 门禁读数（收尾）

- `b4` 6/6、`b8` 5/5、`b12` 9/9、`b9` 9/9、`b11` 11/11、`code-lens-grouping` 21/21（合计 61/61）、`verdict-generated` 5/5
- 反向验证：三条族都**先看到红**（消息即缺陷原文，如 `§G 应有 3247 行，实为 3244`、
  `头部 50 + 1037 + 225 + 1239，实为 51 + 1038 + 223 + 1239`、`…那一条不是分组复选框`）⇒ 改后绿。
- `npx vue-tsc --noEmit`：**9 错，全在别的 lane 正在写的文件**：`agent-settings/MemorySettingsSection.vue`(7)、
  `src/agentModelToolSchema.ts`(2)（mtime 18:01，检查 18:04；后者未跟踪，错因是同 lane 刚改的
  `src/agentMemoryFiles.ts` 缺那几个导出）。本 lane 动的 5 个文件**零错**。

## F. 仍缺什么

1. **vue-tsc 0 错**：还差别人那两个文件收口（不在我名下，未动）。
2. **生成物收敛**：`settings-run_verdict_table.json` 里 `StackTrace*` 三行的 `verdict/why` 仍是 `[ ]` 旧文案（不上门禁）；按规则没手改，重建生成器时应与 §G 对齐。
3. **editor 那处无留痕漂移**：§G 有一行实际 `[~]`、头部旧文按 `[ ]` 记，来源批次没写修订段；本轮只同步
   计数。要追到行，建议筛 `[~]` 且 `why` 带「撤销机械降级」的行逐条比上游坐标（未做）。
4. **规则冲突留痕**：`docs/lanes-2026-10-08.md` 硬规则 2 把 `docs/inventory/**` 整目录列为禁改，本任务却
   授权订正判决书 `.md`（生成物 `.json` 仍禁手改）。本轮按任务授权执行、未动生成物；建议该条改成
   「`docs/inventory/**/*.json` 禁手改，判决书 `.md` 可按实况订正」。
