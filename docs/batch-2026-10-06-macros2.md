# batch: macros2（实时模板宏域收尾 · 2026-10-06）

代号 `macros2`。上一轮 `fix-macros` 交了 `src/templateMacros.ts`（624 行）+ `docs/wiring-requests-2026-10-06-fix-macros.md`（W-1…W-6）。
本批三件事：① 逐条重开当前代码复核那 6 条请求（结果与订正在**更新后的请求文档**里）；
② 把宏域里仍能在**模块侧**闭环的缺项落掉（3 条，只碰 `src/templateMacros.ts`、`src/templates.ts`、
`src/components/TemplateSettingsPage.vue` 与对应 tests）；③ 查宏执行面有没有「注册了但没人调用」的假通道。

上游真源：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（本批逐条打开，无网查）。

---

## 1. 判词表

| 族 / 项 | 判定 | 上游依据（相对路径:行号，本批亲自打开） | 本仓落点（文件:行号） | 一句话说明 |
|---|---|---|---|---|
| `escapeString` 的「不可打印」集合漏了变体选择符两块 | 接手 `[ ]` → `[x]` | `platform/util/src/com/intellij/openapi/util/text/StringUtil.java:605-611`（`isPrintableUnicode` 除了 5 个 `Character.getType` 档与 LINE/PARAGRAPH_SEPARATOR，还排除 `VARIATION_SELECTORS`/`VARIATION_SELECTORS_SUPPLEMENT` 两块） | `src/templateMacros.ts:177`（`NON_PRINTABLE` 加 `\p{Variation_Selector}`）+ 注释 `:168-176`；判据 `tests/template-macros.test.mjs:116-124` | 上游会把 U+FE0F 打成 `\uFE0F`，本批之前原样吐出去；`\p{Variation_Selector}` 正好是那两块的并集（补充块本来就是代理对，已被 `\p{Cs}` 覆盖） |
| `date(...)`/`time(...)`：认不出的样式字母被**原样打印** | 接手 `[ ]` → `[x]` | `platform/lang-impl/src/com/intellij/codeInsight/template/macro/CurrentDateMacro.java:33-38`（`new SimpleDateFormat(pattern)` 包在 `try/catch (Exception)` 里，异常 ⇒ 那句 `Problem when formatting date/time for pattern "…"`） | `src/templateMacros.ts:212`（`patternError`）、`:262`（`default` 分支：字母 ⇒ 报错，非字母才是原文）；判据 `tests/template-macros.test.mjs:101-114` | 原来 `date('pp')` 给用户 `pp`，上游这里是抛 ⇒ 本仓必须给那句报错 |
| `date(...)`：入口先对整串做正则，**引号档里的字母被误报** | 接手 `[ ]` → `[x]` | 同上 `CurrentDateMacro.java:33-34`（整串交给 `SimpleDateFormat`，引号里的字符是原文） | `src/templateMacros.ts:212`（判定移到扫描循环里，删掉整串预检 `UNSUPPORTED_PATTERN_LETTER`）；判据 `tests/template-macros.test.mjs:108`（`date("'Z' yyyy")` ⇒ `Z 2026`） | 老写法 `'Z' yyyy` 会整条变报错；改完引号档不参与字母表判定 |
| `date(...)` 少支持的样式字母（`S`/`D`/`k`/`K`） | 接手 `[ ]` → `[x]` | `CurrentDateMacro.java:34`（上游就是 JDK 的 `SimpleDateFormat`，这四个都是它的字段） | `src/templateMacros.ts:216`（`dayOfYear`）、`:250`（`D`）、`:253-254`（`k`/`K`）、`:257`（`S`）；判据 `tests/template-macros.test.mjs:103-108` | `HH:mm:ss.SSS`、`D`（一年中第几天）、`k`（1-24 时）、`K`（0-11 时）现在出真实字段 |
| 模板正文的美元转义 `$$` 没有（且设置页写着「引擎没有转义机制」） | 接手 `[ ]` → `[x]` | `platform/analysis-impl/src/com/intellij/codeInsight/template/impl/TemplateTextLexer.flex:27`（`"$""$"` ⇒ ESCAPE_DOLLAR）+ `platform/analysis-impl/src/com/intellij/codeInsight/template/impl/TemplateBase.java:66-68`（⇒ 往正文里落一个字面 `$`） | `src/templates.ts:153`（`TEMPLATE_TEXT_TOKEN` 的第一条候选）、`:168`（槽位收集跳过转义）、`:180`（输出 `$`）；判据 `tests/templates.test.mjs:66-75` | `$NAME$` 之外的第二个上游 token 终于有了；`render()` 少一个字符就少一个字符，光标/槽位偏移都按转义后的文本算 |
| 槽位词法**两份**（引擎允许跨行、设置页不允许） | 接手 `[ ]` → `[x]` | `TemplateTextLexer.flex:21-23`（`VARIABLE = "$"({ALPHA}|{DIGIT})+"$"` ⇒ 一个 `$…$` token 里根本没有换行） | `src/templates.ts:153`（唯一一份，导出）+ `src/components/TemplateSettingsPage.vue:4`（import）、`:53-56`（`slotTokens()`）、`:84`、`:94`、`:109`；`src/templates.ts:153` 的默认值段改 `[^$\n]*`；判据 `tests/templates.test.mjs:77-81`（跨行不是槽位）+ 门 `tests/template-macro-registry.test.mjs:147-149`（词法只许一份） | 原来「页面上说不是槽位」和「引擎真插进一个槽位」能同时成立，现在两处读同一个正则 |
| 设置页那条**假文案**（「引擎没有转义机制…」） | 接手 `[ ]` → `[x]` | `TemplateTextLexer.flex:27` + `TemplateBase.java:66-68` | `src/components/TemplateSettingsPage.vue:248` | 转义机制上游有、本批本仓也有了，文案改成「需要一个字面的美元符号就写 $$」 |
| W-1…W-6 复核 | 见请求文档 | 见请求文档逐条 | 见请求文档逐条 | 结论：**W-1a/W-2/W-3/W-4/W-7 仍缺（都给了当前逐字 old→new）**；**W-1b 不落（前提不成立）**；**W-6 不落（等口径）**；W-5 状态更新。没有任何一条是「已闭环」—— 六条挂点的代码本批一行都没进 `App.vue`/`CodeEditor.vue`/`keymap*.ts`/`commentToggle.ts`（都在只读面） |
| 宏执行面的假通道 | `[x]` 查过：无零消费方导出 | — | 见本文件 §5 | 两个新符号（`patternError`/`dayOfYear`、`TEMPLATE_TEXT_TOKEN`）都有生产消费方；老的 36 个 export 逐个 grep 过 |
| 12 条登记侧宏 | `[-]` 仍接不上（理由逐条在表里，本批复核未变） | `platform/lang-impl/resources/intellij.platform.lang.impl.xml:1031-1063`（本批数过：正好 33 条 `<liveTemplateMacro>`） | `src/templateMacros.ts:501-514` | 21 实现 + 12 登记 = 33；本批没有把任何一条从登记侧搬到实现侧（三条候选的挂点都在只读文件里） |

---

## 2. 改动文件清单（`wc -l` 前 → 后）

| 文件 | 前 | 后 | 改了什么 |
|---|---|---|---|
| `src/templateMacros.ts` | 624 | **644** | `NON_PRINTABLE` 加 `\p{Variation_Selector}`；`formatDateTimePattern` 的样式字母判定改到扫描循环内（删掉 `UNSUPPORTED_PATTERN_LETTER` 整串预检）、新增 `patternError`/`dayOfYear` 两个模块私有件与 `D`/`k`/`K`/`S` 四个 case；两处注释按上游行号写实 |
| `src/templates.ts` | 269 | **275** | 槽位词法导出成 `TEMPLATE_TEXT_TOKEN`（加 `$$` 候选、默认值段改 `[^$\n]*`），`render()` 认转义并跳过它收集槽位 |
| `src/components/TemplateSettingsPage.vue` | 312 | **316** | 删掉自带的那份 `VARIABLE` 正则，改读引擎导出的 `TEMPLATE_TEXT_TOKEN`（`slotTokens()`）；`unresolved` 认 `$$`；订正「引擎没有转义机制」那句文案 |
| `tests/template-macros.test.mjs` | 172 | **200** | +2 条用例（样式字母表、变体选择符）；既有断言一字未动 |
| `tests/templates.test.mjs` | 124 | **143** | +2 条用例（`$$` 转义、默认值不跨行）；既有断言一字未动 |
| `tests/template-macro-registry.test.mjs` | 150 | **155** | 消费锚点门（T6）**只加**三条：词法有导出源、页面读它、页面不许留第二份；既有断言一字未动 |
| `docs/batch-2026-10-06-macros2.md` | 不存在 | 本文件 | 交付报告 |
| `docs/wiring-requests-2026-10-06-fix-macros.md` | 181 | **355** | 全文复核重写（W-1 拆成 1a/1b、W-3 的本仓入口订正、W-6 维持不落、新增 W-7） |

`git diff --stat`（本批 6 个文件）：`+103 / -20`。

---

## 3. 规约 §5 每条自查命令的前后数字

| 检查 | 接手时 | 收工时 |
|---|---|---|
| `node --test tests/templates.test.mjs tests/template-macros.test.mjs tests/template-macro-registry.test.mjs`（本域核心 3 个） | 30 / **30 绿** / 0 红 | **34 / 34 绿 / 0 红**（多的 4 条 = 本批新判据） |
| 同域另 7 个文件（`template-create`、`find-replacement-template`、`surround`、`file-template-parser/registry/vars`、`run-config-templates`）—— `render()` 词法被动过，必须连老用例一起看 | 未跑 | **54 / 54 绿 / 0 红**（两组合计 **88 / 88 绿**） |
| `npx vue-tsc -b --force` | 未跑改前基线（别的半区在途，基线本来一直在动） | 批内两次：**4 错**（`CodeEditor.vue` 1 + `TrustedProjectDialog.vue` 2 + `workspaceLifecycle.ts` 1）→ **3 错**（`CodeEditor.vue` 2 + `editorSplitLine.ts` 1）。**本域 0 条**（`grep templateMacros\|templates\.ts\|TemplateSettingsPage` 零命中） |
| `node --test tests/module-size.test.mjs` | 未跑 | 批内两次：**4 / 5（1 红：`src/components/CodeEditor.vue` 1151 > 上限 1147，别的半区在途）** → 收工 **5 / 5 绿**（那个文件被它的 owner 缩回 1145）。本域文件：`templateMacros.ts` 644 < 900、`templates.ts` 275、页面 316，都不需要登记 |
| `node .tools/find-orphan-modules.mjs --gate` | 未跑 | 批内两次：绿（已登记 7 / 基线 8 / **新增 0**）→ 收工**红 2**：`src/editorColumnMode.ts`、`src/editorSplitLine.ts`（编辑器半区刚拆出来的，本批没碰、也不在可改面）。本域三个文件都不在清单里 |
| `node .tools/find-param-props.mjs` | 未跑 | **0 处**参数属性 |
| `node .tools/find-ts-in-mjs.mjs` | 未跑 | **干净**（`tests/*.mjs` 全纯 JS） |
| `node .tools/find-missing-ext.mjs` | 未跑 | **干净**（扫 1310 个文件） |
| `node --test tests/source-citations.test.mjs` | 未跑 | **3 / 3 绿** |
| `node --test tests/source-citation-anchors.test.mjs` | 未跑 | **8 / 8 绿**（快照 3009 条 / 仓里活引用 3179 条 / 未入快照 170 条 / 区间为空 0 条；本批新增的引用落在「未入快照」那一档，门里写明不拦） |
| native / ctest | 未涉及 | 未涉及（本批没碰 `native/`） |
| 收工删临时件 | — | `build/export-audit.cjs`、`build/check1.mjs`、`build/check2.mjs`、`build/check3.mjs`、`build/peek.cjs`、`build/inject.cjs`、`build/inject-check.cjs`、`build/patch-doc.cjs` 全部删除；`grep` 过无残留标记（见 §4） |

---

## 4. 反向验证（注入违规 → 红 → 撤 → 绿）

方法：临时脚本 `build/inject.cjs`（已删）逐条把违规注进**当前文件**、只跑对应域测试、
按字节比对复原（每条都报 `复原=逐字节一致`），最后复跑三个域测试确认复绿。

| # | 注入了什么 | 结果（注入后） | 撤后 |
|---|---|---|---|
| 基线 | 无 | `templates` 14 绿、`template-macros` 14 绿、`template-macro-registry` 6 绿（合计 34 / 0 红） | — |
| I1 | `NON_PRINTABLE` 去掉 `\p{Variation_Selector}`（= 退回接手前） | `template-macros` **fail=1 / pass=13**，红的正是 `escapeString treats variation selectors as non-printable` | 14 / 14 绿 |
| I2 | `formatDateTimePattern` 的 `default` 分支去掉「字母 ⇒ 报错」（= 原样打印） | `template-macros` **fail=2 / pass=12**：新用例红，**既有那条 `date and time read the injected clock…` 也红**（它钉着 `ZZ` 必须出报错 ⇒ 老断言本身也在守这次的行为，没被放松） | 14 / 14 绿 |
| I3 | 把判定挪回入口整串正则（`if (/[GzZDSweku]/.test(pattern)) return patternError(pattern)`） | `template-macros` **fail=1 / pass=13**：`the date pattern covers…`（`'Z' yyyy` 被误报那条） | 14 / 14 绿 |
| I4 | `TEMPLATE_TEXT_TOKEN` 去掉 `\$\$\|` 候选 | `templates` **fail=1 / pass=13**：`a doubled dollar is the escaped dollar sign, not a slot` | 14 / 14 绿 |
| I5 | 默认值段从 `[^$\n]*` 放回 `[^$]*` | `templates` **fail=1 / pass=13**：`a slot default does not swallow a line break` | 14 / 14 绿 |
| I6 | 设置页再塞回一份自己的 `const VARIABLE = …`（第二份词法） | `template-macro-registry` **fail=1 / pass=5**：T6 `消费链路：宏真的进展开、设置页真的读同一张表` | 6 / 6 绿 |

I1 第一次跑**没有变红**，取证后发现是我的注入锚点打错了位置：`from` 命中的是**注释里**那句
`\p{Variation_Selector}`（文档注释也写了这个属性名），正则本体没动 ⇒ 判据当然还绿。锚点改成
`\p{Zl}\p{Zp}\p{Variation_Selector}]/u` 后才红（就是表里那条 I1）。**记下来免得下一批把「注入了但没红」当成判据成立。**

残留自查（收工跑）：
- `grep -rn "SUPPORTED_PATTERN_LETTER|const VARIABLE =|GzZDSweku" src tests`
  ⇒ 只剩 `src/completionSnippets.ts:56` 的 `const VARIABLE`（别的模块自己的正则，与本域无关）与
  `tests/template-macro-registry.test.mjs:149` 那条**门本身**的 `doesNotMatch(/const VARIABLE =/)`；
  `grep -n "SUPPORTED_PATTERN_LETTER|GzZDSweku" src/templateMacros.ts` ⇒ 零命中。

---

## 5. 零消费方 / 假通道自查

`node .tools/find-orphan-modules.mjs --gate` 的结论见 §3（本域无新增孤儿；收工那两条红是编辑器半区的）。
符号级：临时脚本 `build/export-audit.cjs`（已删）把 `src/templateMacros.ts` + `src/templates.ts` 的
**39 个 export** 逐个在 `src/ tests/ docs/ native/ scripts/` 里 grep（按词边界，排除两个自身文件），
结论：**没有任何一个 export 是「src/tests/docs 全零」**，所以按「死代码直接删」该删的是一条都没有。
但把「生产消费方」和「只有测试在用」分开看，有一档要写清（都是上一轮就存在的，本批没有新增）：

| export | 生产消费方（src） | 只有测试/文档 | 判定 |
|---|---|---|---|
| `resolveTemplateSlotValues` | `src/templates.ts:173`（`render()` 里的那次调用） | — | 真通道 |
| `LIVE_TEMPLATE_MACROS`、`templateMacroOfExpression`、`unknownMacroCall` | `src/components/TemplateSettingsPage.vue:5` | — | 真通道 |
| `DEFERRED_TEMPLATE_MACROS` | 无（页面**禁止**渲染它，门 `:153` 钉着） | `tests/template-macro-registry.test.mjs:28` + 文档 | 登记侧，消费方是对账门，符合规约 §3 的「不渲染」；不删 |
| `TemplateMacroContext`、`TemplateSlotDefinition`、`TemplateMacro`、`MacroParameters`、`TemplateExpressionEnvironment`、`TemplateExpressionNode`、`DeferredTemplateMacro` | 公开签名的组成部分（`src/templates.ts:8` 用前两个） | 其余由签名与门/文档引用 | 类型不是通道，保留 |
| `templateMacroByName`、`parseTemplateExpression`、`evaluateTemplateExpression`、`isTemplateMacroExpression`、`nameToWordList` | **模块内部**（`:154`/`:354`/`:590`/`:628`/`:637`）都在用；对外零生产 import | `tests/template-macros.test.mjs:3-6`、`tests/template-macro-registry.test.mjs:28` | **不是假通道**：查表/解析/求值三段各自对应上游公开 API（`MacroFactory.java:13-15`、`MacroParser.java:53`、`Expression.calculateResult`、`NameUtilCore.kt:143`），删掉公开面就只能把行为判据从「解析树/求值」降级成「一段正文的输出」，会丢分档（null vs 空串 vs marker）。上一轮已按同口径把**真正没人用**的 `escapeStringCharacters`、`tokenizeTemplateExpression` 降为模块私有，本批复核：那两个确实只有模块内引用 ⇒ 保持私有。**注意**：`src/symbolSearch.ts:6` 出现的 `nameToWordList` 只是注释里在引上游名字，不是 import ⇒ 没有第二份实现，也不需要接线 |
| `TEMPLATE_TEXT_TOKEN`（本批新增 export） | `src/templates.ts:162`（`render()` 自己用）+ `src/components/TemplateSettingsPage.vue:4/:56` | `tests/template-macro-registry.test.mjs:147-148` | 两个生产消费方，不是「只过自己测试」 |
| `patternError`、`dayOfYear`（本批新增） | 模块私有，`formatDateTimePattern` 用 | 行为由 `tests/template-macros.test.mjs:101-114` 钉 | 不公开 ⇒ 无通道可言 |
| `TemplateSettingsPage.vue` 的 `slotTokens`（本批新增） | 同文件 `:84/:94/:109` 三处 | — | 组件内私有 |

界面侧没有新控件：本批只改了那一行**已存在**的提示文案（`TemplateSettingsPage.vue:248`），
没有加按钮、没加图标、没加动效，也没有新增 `--dur-*`/hex/毫秒裸值。

---

## 6. 做不到 / 无法核实

1. **12 条登记侧宏本批一条都没能落地**。逐条卡点（`src/templateMacros.ts:501-514` 的 `reason` 仍在表里）：
   - `lineNumber`：要展开点行号，唯一挂点 `src/components/CodeEditor.vue:576`（只读）。W-1a 已给逐字 old/new。
   - `fileRelativePath`：**「加个 projectRoot 就能做」这个前提被本批推翻** —— 上游
     `platform/refactoring/src/com/intellij/ide/actions/FqnUtil.java:59-73` 是先问
     `VirtualFileQualifiedNameProvider` 扩展点、才回落 base directory，而社区版唯一那条 provider
     （`java/java-impl/src/com/intellij/ide/actions/JavaVirtualFileQualifiedNameProvider.java:21-32`）
     给的是**源根**相对路径。本仓展开点没有源根/模块索引 ⇒ 见 W-1b「不落」。
   - `clipboard`：`src/clipboard.ts:52` 仍是 async；且 `src/clipboard.ts:3` 起就 import Vue，
     不能进 `src/templates.ts` 的依赖图（否则 `node --test` 直接加载不了模板层）⇒ 只能「展开前预取再传进来」，见 W-2。
   - `user`：上游 `CurrentUserMacro.java:15-18` = `SystemProperties.getUserName()`；本仓没有同步的 OS 用户名通道
     （`src/bridge.ts:109` 的方法清单里有 `git.user`，那是 git 身份，不是 OS 用户，**不能拿来冒充**）。
   - `complete`/`completeSmart`/`showParameterInfo`：`Expansion`（`src/templates.ts:36-42`）没有「收尾动作」这一格；
     补上它要改 `src/templates.ts` + `src/components/CodeEditor.vue`（只读）两处 ⇒ 见 W-3（并订正了原请求里两个不存在的入口名）。
   - 5 条注释宏（`lineCommentStart`…`commentEnd`）：`src/commentStyles.ts` 仍不存在（`ls src` 实查只有
     `commentToggle.ts`/`editorEnterBlockComment.ts`/`editorJoinComments.ts`），而 `src/commentToggle.ts:24`
     仍 value-import `@codemirror/state`。搬表这件事不在本批可改面 ⇒ 见 W-4（本批把 `commentEnd` 与 `trim()` 两条上游口径补细，`CommentMacro.java:30-36`、`:65-73`）。
   - 6 条已实现宏少了「实参算不出 ⇒ 用编辑器选区」这一档（`MacroBase.java:55-67` 的 `useSelection`，
     只有 `ConvertToCamelCaseMacro.java:35`、`SplitWordsMacro.java:28`、`CapitalizeAndUnderscoreMacro.java:23` 开了）：
     本批不私自加一个没有生产喂料的 `selection` 字段（那就是「注册了但没人调用」的假通道），改写成**新请求 W-7**。
2. **JDK 侧无法核实**：`CurrentDateMacro.java:34` 直接 `new SimpleDateFormat(pattern)`，而 JDK 源码不在本地树。
   于是：① 字母表按 JDK 常识收（`y M d D H h K k m s S E a`）；② 异常消息**尾巴**（`e.getMessage()`）本仓写成
   `Unsupported pattern letter`，上游真实原文（形如 `Illegal pattern character 'p'`）**无法核实**，注释与用例都写明那是本仓替身；
   ③ `S` 的位数超过实际位数时 JDK 会不会截断，也无法核实 ⇒ 本仓不截断（`emit` 只补零）。
3. **`$$` 与本仓发明的 `:默认值` 段交叉**是**推定**，不是上游行为：上游正文词法只有
   VARIABLE / ESCAPE_DOLLAR / TEXT 三个 token（`TemplateTextLexer.flex:21-28`），没有「默认值」这一列
   （那是 `TemplateSettings.java` 变量表的列）。本仓取「先认 `$$`、再认 `$NAME:段$`，段里不吃 `$` 也不吃换行」这条最贴近上游词法优先级的读法，
   钉在 `tests/templates.test.mjs:66-75`（`$$$NAME:value$` ⇒ `$value`）。
4. **`$1$` 这类数字开头的槽位名没有放宽**：上游 `TemplateTextLexer.flex:21-23` 的 `{ALPHA}|{DIGIT}` 允许数字开头，
   本仓（引擎与页面）仍要求首字符是字母或下划线。本批**故意不跟着放宽** —— 本仓那一段还兼任字面默认值，
   放宽会把 `$1$…$2$` 这种正文（正则替换串、jQuery 风格代码里常见）突然变成两个槽位；
   这是一处**有意的本仓差异**，写在这里而不是悄悄留着。
5. `docs/inventory/citation-anchors.json` 与两个 citation 门都是主代理独占：本批新增的引用（含
   `platform/refactoring/...`、`java/java-impl/...` 两条**新的上游路径**）只落在「未入快照」，
   要收进快照请主代理跑 `$env:TAOCODE_CITATION_ANCHORS='update'; node --test tests/source-citation-anchors.test.mjs`。
6. 语言专属宏仍不做：`java/java-impl/resources/intellij.java.impl.xml` 里另有 **27** 条 `liveTemplateMacro`（本批实数），
   kotlin/python/groovy 的还有（上一轮记的 11/5/1 本批**未复核**）；它们要 PSI/类型推断，本仓没有 PSI ⇒ 不实现、不渲染，
   也不进本域「33 条」的对账口径（口径是 `platform/lang-impl/resources/intellij.platform.lang.impl.xml:1031-1063`）。

---

## 7. 派单给的上游坐标：逐条实查结果（订正留痕）

| 派单/旧文档给的坐标 | 实查 | 处置 |
|---|---|---|
| `platform/ide-impl/src/com/intellij/codeInsight/template/impl/MacrosImpl.java`（本次派单） | **不存在**：`platform/ide-impl/src/com/intellij/codeInsight/template/` 这个目录就没有；全树 `find -name "MacrosImpl*"` 零命中 | 已在请求文档开头与 `src/templateMacros.ts:16-18` 的头注释留痕；真身按 `platform/lang-impl/src/com/intellij/codeInsight/template/macro/`（实现类）+ `platform/analysis-impl/src/com/intellij/codeInsight/template/macro/`（`MacroFactory.java`/`MacroService.java`）对齐 |
| `.../template/impl/Macros.java`（上一轮派单） | 同样**不存在**（`platform/lang-impl/src/com/intellij/codeInsight/template/impl/` 里是 `EditVariableDialog.java` 等界面件，本批重列过） | 上一轮已留痕，本批维持 |
| `.../template/macro/` 下一族（本次派单） | **成立**：24 个宏类在 `platform/lang-impl/.../template/macro/`，本批逐条打开并核了构造器/`getName()`/`getPresentableName()`/`getDefaultValue()`/实参取料口径 | 表里各条按它对齐 |
| `com/intellij/codeInsight/template/Template.java`（本次派单没给模块前缀） | 真身在 `platform/analysis-impl/src/com/intellij/codeInsight/template/Template.java`（**不是** analysis-api）；`:26-27` 就是 `END`/`SELECTION` 两个常量 | W-7 用它做「`SELECTION` 是预定义变量名」的证据；`Template.java` 在 analysis-api 那份的同名文件不存在（`find` 只命中这一条） |
| `Macro.java` 的 `:18/:20/:26-28/:30-32/:34/:40/:44` | **成立**（`platform/analysis-api/src/com/intellij/codeInsight/template/Macro.java`） | 无需改 |
| `TemplateStateBase.java:55-57`、`:72-97` | **成立**（在 `platform/analysis-impl/.../template/impl/`，不在 `template/`） | 头注释的引用不改 |
| `TemplateState.java:637-680`、`:660`、`:763-803`、`:1122-1149`、`:1137-1141` | **成立**（`:660` 就是 `(getTemplate().getVariableCount() + 1) * 3`；`:705` 是 `while (!calcedSegments.isEmpty() && maxAttempts >= 0)`；`:1137-1140` 就是 marker 那三行） | 头注释的引用不改 |
| `MacroParser.java:53-148`、`_MacroLexer.flex:22-36` | **成立** | 不改 |
| `intellij.platform.lang.impl.xml:1031-1063` = 33 条 | **成立**（`grep -c` = 33） | 门的口径不变 |
| 「复用 `src/editorCommands.ts` 的 `triggerParameterInfoAt`/`triggerCompletionAt`」（旧 W-3） | 本仓 `src/editorCommands.ts` 里**没有**这两个名字 | 已在 W-3 订正为真实入口：`src/completionUi.ts:52`（`startCompletionAs`）/`:73`（`startBasicCompletion`）与 `src/components/CodeEditor.vue:669`（`emitSemantic`，`'signature'` 档在 `:791` 的 Ctrl+P） |
| 「`props.projectRoot ?? ''`」（旧 W-1） | `CodeEditor.vue:91` 的 props 里没有 `projectRoot` | 已在 W-1b 订正 |

---

## 8. 要主代理接的线

全部在 **`docs/wiring-requests-2026-10-06-fix-macros.md`**（本批更新到 355 行）：
W-1a（一行挂点，解锁 `lineNumber`）、W-2（剪贴板预取）、W-3（`Expansion.after` 收尾动作，解锁 3 条宏）、
W-4（抽 `src/commentStyles.ts`，解锁 5 条注释宏）、W-7（`selection` 传料，补齐 6 条宏的选区档）；
W-1b 与 W-6 本批判为**不落**，理由与证据都写在对应小节里。
另有两条基线维护动作：孤儿门基线（`jarRun.ts`/`runAnythingContext.ts` 已接上可清、
`editorColumnMode.ts`/`editorSplitLine.ts` 由编辑器半区自己接）、引用快照重算（见 §6.5）。
