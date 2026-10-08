# batch-2026-10-06-macrotbl — 实时模板宏表按上游逐条对齐

Lane: **macrotbl** (D:\TaoCode). 范围：**只做"表本身齐不齐、每条宏的语义对不对"**（执行面已由 templ2 落下）。
参考树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（**唯一**可用；仓内 `third_party/intellij-community` 坏树禁用）。
无 zh 本地化包 ⇒ 中文措辞一律「无法核实」。所有坐标当候选，逐条盘读复核。

## 0. 接手实况（mtime 自查 + 路径复核）

**给定坐标复核结果：真。**
- 上游 33 条 `<liveTemplateMacro>` 确在
  `platform/lang-impl/resources/intellij.platform.lang.impl.xml:1031-1063`（逐行读盘：1031 `CurrentDateMacro` … 1063 `EnumMacro`，不多不少 33 行）。
  同一棵树里另有 **另外两处**注册：`java/java-impl/resources/intellij.java.impl.xml:203-229`（27 条 Java 系宏）与
  `intellij.java.impl.analyzer.xml:65-91`（同一批的重复注册）。`grep -rn "<liveTemplateMacro"` 全树 = **104** 行，
  其中 lang.impl 那份 33 条才是本域范围。EP 声明在 `platform/analysis-api/resources/intellij.platform.analysis.xml:102`。
- 真身类确认：`platform/lang-impl/src/com/intellij/codeInsight/template/macro/*.java`（25 个文件，含嵌套类）
  + 基类 `MacroBase.java` / `SimpleMacro.java` / `FilePathMacroBase.java` / `SplitWordsMacro.java` / `ConvertToCamelCaseMacro.java`
  + EP 契约 `platform/analysis-api/src/com/intellij/codeInsight/template/Macro.java`。
  **`TemplateConfiguration` 确实不存在**（复核：全树 `find -name TemplateConfiguration.java` = 空）。
- 本仓候选四个文件**全在**，路径没被编：`src/templateMacros.ts`(672 行)、`src/templates.ts`(275)、`src/surroundTemplates.ts`(119)、
  `src/components/TemplateSettingsPage.vue`(316)。

**mtime 自查（归属判定）**
```
15:29:18  src/components/TemplateSettingsPage.vue
15:33:15  src/templateMacros.ts
15:40:53  src/surroundTemplates.ts   ← 最晚，customfold 那条 `surroundRowForFile`/`customFoldingSurround.ts` 的改动就在里面
12:28:23  src/templates.ts
```
`git status --porcelain` 三者都是 `M`（在途、未提交）。读盘复核后：`surroundTemplates.ts` 里 customfold 动的是
`surroundChoices`（`:40-46`，用 `src/customFoldingSurround.ts` 按注释词法重包折叠行），**与本域的宏表无交集**；
本域不碰那几行，也不写该文件（它已归 customfold 在途）。

**接手时域测试基线 = 全绿（79/79）**
`node --test tests/template*.test.mjs tests/macro*.test.mjs tests/surround*.test.mjs tests/module-size.test.mjs`
→ `tests 79 / pass 79 / fail 0 / cancelled 0 / skipped 0`，619ms。
其中已有的对账锚点：「抄写的 33 条与 XML 里的注册逐字相同」「设置页里的宏清单 = 上游 Expression 下拉那份」「宏真的进展开、设置页读同一张表」。

## 0.1 表本身的齐度（先回答"齐不齐"）

`LIVE_TEMPLATE_MACROS` **25 条** + `DEFERRED_TEMPLATE_MACROS` **8 条** = **33**，与上游那 33 行**一一对上、无缺、无多、无自造**：
按 `upstream` 字段（嵌套类用 `$`）逐条比对 XML 注册，两边集合相同。所以「上游有本仓无」在**宏名层面是空的**；
真正的问题只在 §1C「两边都有但语义不同」。

## 1. 逐条差异表（三栏）

比对方法：上游 25 个宏文件逐个读盘（构造器第一个参数 = `getName()`、第二个 = `getPresentableName()`，
`CodeInsightBundle.message(...)` 的那几个再到 `platform/lang-api/resources/messages/CodeInsightBundle.properties:178-185`
取英文原值）；基类的 `getDefaultValue()` 三档各查各的根（`MacroBase.java:47-49`=`"a"`、
`SimpleMacro.java:27-29`=`"11.11.1111"`、`Macro.java:30-32`=`""`）；本仓 `calculate` 与上游 `calculateResult` 逐条对。

### 1A 上游有 / 本仓无 —— **空**（宏名层面）

33 条注册本仓**全部有落点**：25 条在 `LIVE_TEMPLATE_MACROS`、8 条在 `DEFERRED_TEMPLATE_MACROS`，
且 `tests/template-macro-registry.test.mjs` 已经把「多一条红、少一条也红」钉住（它自己去读参考树那份 XML）。
`java/java-impl` 的另外 27 条 Java 系宏**不在本域**（那是 `com.intellij.codeInsight.template.macro` 的 Java 插件侧，
本仓没有 PSI/类型推断原料，且不属于 lang.impl 那 33 条）。**没有发现本仓自造的上游不存在的宏。**

### 1B 本仓有 / 上游无 —— **空**

`LIVE_TEMPLATE_MACROS` 的 25 个 `upstream` 值逐条都能在 `:1031-1063` 找到同一行注册。

### 1C 两边都有但语义不同 —— 本轮查出 9 条（按「能不能今天落」分档）

| # | 宏 | 上游 | 本仓（改前） | 判定 |
|---|---|---|---|---|
| C1 | `regularExpression` | `RegExMacro.java:43` 走 `String.replaceAll`：命名捕获组 `(?<y>…)` **算一个组**，`$1` 合法 | 组数用 `/\((?!\?)/g` 数：`(?<` 被 `(?!\?)` 一起排除掉 ⇒ **命名组不计数** ⇒ `$1` 被判越界 ⇒ 整条宏返回 `null` ⇒ 槽位回落成 marker `"a"` | **落**（实测：`regularExpression("2026-10-06","(?<y>[0-9]{4})-([0-9]{2})","$1/$2")` 改前 `null`、改后 `2026/10-06`） |
| C2 | 同上 | 同一条数组长不到：`\(` 转义括号**不是**组、`[(]` 字符类里的括号**不是**组，却被 `\((?!\?)` 计成组 ⇒ 越界判据反向往复（放过本该 `IndexOutOfBoundsException` 的 `$1`） | 同 | **落**（与 C1 同一个计数器，一次修对） |
| C3 | `fileNameWithoutExtension` | `FilePathMacroBase.java:46-47` → `VirtualFile.java:196-198` → `FileUtilRt.java:439-441`：`lastIndexOf('.')`，**i<0 才留原名**；i=0（dotfile）砍成**空串** | 借用了 `src/fileTemplateVars.ts:49` 的 `fileNameStem`，那条是 `dot > 0` ⇒ `.gitignore` → `.gitignore`（上游是 `""`） | **落**（宏侧单独实现上游档；不改 `fileTemplateVars.ts`，它不是名下文件，差异登记进 §6） |
| C4 | `camelCase`、`underscoresToCamelCase`、`capitalizeAndUnderscore`、`snakeCase`、`lowercaseAndDash`、`spaceSeparated` **6 条** | 取料用 `getTextResult(params, context, **true**)`（`ConvertToCamelCaseMacro.java:35`、`CapitalizeAndUnderscoreMacro.java:23`、`SplitWordsMacro.java:28`）：实参算出 `null` 时回落去读 `context.getProperty(ExpressionContext.SELECTION)`（`MacroBase.java:55-66`）。而 `capitalize`/`decapitalize`/`firstWord`/`escapeString`/`underscoresToSpaces`/`spacesToUnderscores` 6 条是 `**false**` —— 这条**不对称**是真的 | 本仓 `singleText()`（`:392`）一律 `parameters.length===1 ? parameters[0] : null`，**没有 SELECTION 这条通道**，且对 12 条一视同仁 | **登记**：`TemplateMacroContext`（`:73-78`）只有 `path`/`now`；选区在 `CodeEditor.vue`（**禁写**）那一侧，`expand()`（`src/templates.ts:226-236`）只拿到整行文本与光标，没有选区 ⇒ 原料拿不到。不是「语义抄错」，是**挂点缺**，写进 §6 接线请求 |
| C5 | `filePath` | `FilePathMacroBase.java:71` 过 `FileUtil.toSystemDependentName` ⇒ Windows 上出 `C:\a\b\Foo.java` | 本仓内部路径一律 `/`，不做平台改写（`:420-422` 已写明是**有意**） | **登记**：宿主是 win32，用户看到的斜杠方向确实与上游不同；但「系统相关名」需要一个平台通道，JS 侧自造 `navigator` 判定属于猜测 ⇒ 不动，登记 §6 |
| C6 | `date` / `time`（无参档） | `CurrentDateMacro.java:41` → `DateFormatUtil.formatDate/formatTime`，读**区域设置** | 本仓钉死 `yyyy/M/d`、`H:mm`（沿用 `src/fileTemplateVars.ts:112-113` 同一档），并在 `:200-214` 写明「这是本仓档不是上游档」 | **无法核实**（见 §5）：参考树里没有 zh 本地化包，中文环境下上游到底出 `2026/10/6` 还是 `2026年10月6日` 取不到 |
| C7 | `date` / `time`（带 pattern 档） | 认不出的字母 ⇒ `SimpleDateFormat` 构造期抛 ⇒ 走 `:36-38` 那句 `Problem when formatting date/time for pattern "…": + e.getMessage()` | 同一句错，但**尾串 `Unsupported pattern letter` 是本仓替身**；且字母表只覆盖 `y M d D H h K k m s S E a`，JDK 另有的 `G L u Q q w W F x X z Z` 等本仓会**误报** | **登记**：JDK 的 `SimpleDateFormat` 源码不在参考树 ⇒ 完整字母表无法核实，不照记忆扩（§5）。报错**形状**已对齐，报错**触发面**偏宽 |
| C8 | `regularExpression` 的替换串方言 | Java `Matcher.appendReplacement` 只认 `$$`/`$n`/`${name}`/`$<name>`；`$0`、`$&`、`` $` ``、`$'` **不是**它的记法 | 本仓用 JS 的 `String.replace`：实测 `regularExpression("abc","(b)","[$0]")` → `a[$0]c`（JS 不认 `$0`），`[$&]` → `a[b]c`（JS 认 `$&`）——两边都不是上游档 | **登记**：这四种记号在 Java 里的确切行为属于 JDK，不在参考树 ⇒ 不照记忆改（§5）。且 `Pattern` 与 `RegExp` 的**模式方言**本就不同源，整条宏不可能靠换写法对齐 |
| C9 | 8 条登记侧宏（`user`/`clipboard`/`lineNumber`/`fileRelativePath`/`complete`/`completeSmart`/`showParameterInfo`/`commentEnd`） | 注册在 EP 里 ⇒ `MacroParser.java:67-70` 认得这个名字 ⇒ 走 `MacroCallNode`，真的求值 | `macroIndex` 只有 25 条 ⇒ `isTemplateMacroExpression("user()")` 为假 ⇒ 那一格按**字面量默认值**插 `user()` | **已缓解、登记**：`unknownMacroCall()`（`:576-580`）正是判这种写法，设置页 `TemplateSettingsPage.vue:107-113` 已经在渲染警告，用户能看到「那一格不会算」；但展开文本里那串字面 `user()` 与上游的用户名仍然不同。逐条落不了的理由各自不同（见 `DEFERRED_TEMPLATE_MACROS:531-541`），本轮复核**逐条仍然成立**，见下 §2.3 |

复核到的「**抄对了**」的部分（本轮不动、留证据）：`capitalize`/`decapitalize` 对空串的**不对称**（`CapitalizeMacro.java:26-31` 空串出 `TextResult("")`，
`DecapitalizeMacro.java:26-30` 空串出 `null`）本仓保住了；`firstWord`、`escapeString`（含变体选择符那一档，逐条对过
`StringUtil.java:549-618` + `:604-611` 的 `isPrintableUnicode`）、`underscoresToSpaces`/`spacesToUnderscores`（Java `replace(char,char)` 是全替 = JS `replaceAll`）、
`concat`（`StringUtil.notNullize` 跳 null、结果为空 → null）、`substringBefore`（恰好两参 + `indexOf > 0` 的原样口径，分隔符在 0 位给空串）、
`enum`（取第一个实参、`params.length===0` → null）、`camelCase` 的词表与 `Character.isLetterOrDigit` 首字符门槛、
`snakeCase`/`lowercaseAndDash`/`spaceSeparated`/`capitalizeAndUnderscore` 的分词（`NameUtil.java:385-403` 实查**就是**委托
`NameUtilCore.nameToWordList`，与本仓 `joinWords` 同一档）、comment 一族的 `.trim()` 与 `StringUtil.isNotEmpty` 门槛、
三档 `getDefaultValue()`、以及 25 条 `presentableName` 与英文 bundle 的**逐字**相同。

## 2. 落盘

只落 §1C 里标了「落」的三条（C1/C2/C3）。都是**已有宏的求值语义/边界**，不新增宏名、不动执行面、不放假控件。

### 2.1 C1+C2 — `regularExpression` 的组号上界（`src/templateMacros.ts`）

原判据 `expression.source.match(/\((?!\?)/g)?.length ?? 0` 换成逐码元的 `captureGroupCount()`：
转义项 `\` 与其后一码元整体跳过、`[...]` 字符类整体跳过、`(` 后不是 `?` 计一组、`(?<` 后不是 `=`/`!` 计一组（命名捕获组）。
**判据只用「Java 与 ECMA-262 同一条」的那一半**——不去碰 `$0`/`$&` 那种只有 JDK 能证的记号（见 §5）。

实测（同一进程、`[0-9]` 写法避掉 shell 转义歧义）：

| 实参（value / pattern / replacement） | 改前 | 改后 | 上游应为 |
|---|---|---|---|
| `2026-10-06` / `(?<y>[0-9]{4})-([0-9]{2})` / `$1/$2` | `null` → 槽位落 marker `"a"` | `2026/10-06` | 有 2 个组、`$1` 合法 |
| `ab` / `(?<n>a)(?<m>b)` / `$2$1` | `null` | `ba` | 同上 |
| `ab` / `(?<n>a)` / `$2` | `null` | `null` | 越界 → `IndexOutOfBoundsException` → null（**没放宽**） |
| `ab` / `(?<n>a)` / `$1` | `null` | `ab` | 命名组就是 1 号组 |
| `a(b` / `[(]` / `$1` | 放行后由引擎吐出字面 `$1` | `null` | 0 个组 → 越界 → null |
| `a(b` / `[(]` / `X` | `aXb` | `aXb` | 字符类正常匹配 |
| `abc` / `a(b)c` / `$2` | `null` | `null` | 既有那条不回归 |

引擎侧自证（不是照记忆断言）：用 `new RegExp('(?:' + p + ')|').exec('').length - 1` 取真组数，
`(?<y>[0-9]{4})-([0-9]{2})` → **2**（旧判据 1）、`[(]`/`[a-z(]` → **0**（旧判据 1）、`(a)(?:b)(?<z>c)` → **2**（旧判据 1）。
`captureGroupCount()` 与这一列逐条相同。

顺带查清**不是** bug 的两条（留证据，避免下一批误改）：`pattern='('`、`pattern='a(b'` 都让 `new RegExp` 抛
→ 走 `catch` 返回 `null`，与上游 `PatternSyntaxException` → `RegExMacro.java:46-47` → null 同档。

### 2.2 C3 — `fileNameWithoutExtension` 的 dotfile 档（`src/templateMacros.ts`）

`filePathMacro('stem')` 原来借 `src/fileTemplateVars.ts:49` 的 `fileNameStem()`（判据 `dot > 0`）。
上游那条链实查是 `FilePathMacroBase.java:46-47` → `VirtualFile.java:196-198` → **`FileUtilRt.java:439-441`**：
`i = lastIndexOf('.'); return i < 0 ? name : name.subSequence(0, i)` —— **只有找不到点才留原名**，`i = 0` 也照砍。
改成宏侧单独实现，并把那条 import 摘掉（本文件里它只有这一个用处，`--noUnusedLocals` 已证没留 dangling）。

| 路径 | 改前 | 改后（=上游） |
|---|---|---|
| `repo/.gitignore` | `.gitignore` | `""` |
| `repo/.hidden` | `.hidden` | `""` |
| `repo/.a.b` | `.a` | `.a` |
| `repo/archive.tar.gz` | `archive.tar` | `archive.tar` |
| `repo/Makefile` | `Makefile` | `Makefile` |
| `src/main/App.java` | `App` | `App` |

空结果落的 marker 是这条宏自己的 `getDefaultValue()` = `Macro.java:30-32` 的 `""`（`FilePathMacroBase` 没覆写它，
`table` 里 `defaultValue: ''` 本来就已对上），所以 dotfile 展开是**留空**、不会吐出一个 `"a"`。

### 2.3 登记侧的 8 条：逐条复核，理由**全部仍然成立**（其中 1 条措辞改硬）

`user`（`SystemProperties.getUserName()`）／`clipboard`（`src/clipboard.ts:52` 的 `readClipboardText` 确是 `Promise`，同步求值路径拿不到）／
`lineNumber`（`LineNumberMacro.java:22-23` 要 `context.getEditor().offsetToLogicalPosition(getStartOffset())`；
本仓 `expand(line, caret, path)`（`src/templates.ts:226-236`）只拿到**单行文本 + 行内列**，行号在 `CodeEditor.vue` 那一侧）／
`fileRelativePath`（`FilePathMacroBase.java:83` 要 `FqnUtil.getVirtualFileFqn(virtualFile, project)`，即项目 + 源根）／
`complete`/`completeSmart`（`BaseCompleteMacro.java` 的 `InvokeActionResult`：要在编辑器里再拉起一次补全并等选中）／
`showParameterInfo`（要先 `finishTemplate` 再拉参数信息浮层）／`commentEnd`（单格语法表达不出「合法的空收尾」）。

`user` 那条把理由改硬了：文件模板侧 `src/components/FileTemplatesSettingsPage.vue:50/:150` 传的是**写死的 `user: 'tao'`**，
照它接等于往用户模板里放假用户名 ⇒ 不是「通道没接」而是「没有真通道」。注册门只要求 `reason.length >= 10`
（`tests/template-macro-registry.test.mjs:108`），改措辞不动条数（25/8 未变，`node import` 实测仍 25/8）。

## 3. 判据与反向验证

前缀 `MACROTBL`。两条各做一次「注入 → 红 → 还原 → `cmp`/`sha1` → 残留清零」。

**注入 1（组计数）**：`const groups = captureGroupCount(pattern)` → `const groups = pattern.match(/\((?!\?)/g)?.length ?? 0 // MACROTBL-INJECT`
→ `tests/template-macros.test.mjs`：**tests 17 / pass 16 / fail 1**，红的正是
`✖ regularExpression counts the capture groups it actually built`（**没有**误伤其余 16 条 ⇒ 判据精确）。还原：`cmp` identical、`sha1sum -c` OK。

**注入 2（dotfile 词干）**：头两次注入**方法错了**，都不是有效的行为级红，已作废重做，过程如实记着——
1. 先写成 `return dot > 0 ? name : name // MACROTBL-INJECT`：行尾注释把下一行的 `}` 一起注释掉 ⇒
   `ERR_INVALID_TYPESCRIPT_SYNTAX`，是**加载期炸**不是断言红，证不了任何东西；
2. 再写 `dot > 0 ? name : name.slice(0, dot)`：条件反了但结果与原版**同值**（`dot=0` 两边都给空串）⇒ 假注入。
第 3 次改成 `/* MACROTBL */ (dot > 0 ? name.slice(0, dot) : name)`（块注释、不动 `}`）⇒
**tests 17 / pass 16 / fail 1**，红的正是 `✖ fileNameWithoutExtension follows FileUtilRt: a dotfile has an empty stem`。

**注入过程中撞到的写锁（不当数据放过，读盘复现过）**：`cp /tmp/tm.good src/templateMacros.ts` 两次报
`cp: cannot create regular file 'src/templateMacros.ts': Permission denied`。第二次报错时**还原真的没落盘**——
`cmp` 报 `differ: byte 24852, line 422`、`sha1sum -c` **FAILED**、残留 `MACROTBL` = **1**、域测试 81 里 1 红。
带重试循环重跑 `cp` 后 `cmp identical` + `sha1sum -c` 双双 OK。⇒ 教训：**「cp 成功」不等于「还原到位」，必须以 `cmp`/`sha1` 为准**。
该锁是间歇性的（同一个 `cp` 命令一次成一次败），非文件只读属性（`ls -l` 全程 `-rw-r--r--`）。

**终态**：`grep -rn "MACROTBL" src/ tests/ native/` = **0**；`src/templateMacros.ts` sha1
`e7c697df4f150f9d806d9043f9da90bfc8c97719`、`tests/template-macros.test.mjs` sha1
`220199c9c2980368cea12e811b249f914d701bc3`。没有放松任何既有断言（81 条里 79 条是接手时既有、原样通过）。

## 4. 门禁原始数字

- **域测试** `node --test tests/template*.test.mjs tests/macro*.test.mjs tests/surround*.test.mjs tests/module-size.test.mjs`
  → 接手基线 `tests 79 / pass 79 / fail 0`（619.9ms）；落盘后 `tests 81 / pass 81 / fail 0 / cancelled 0 / skipped 0 / todo 0`（828ms）。
  净 +2 条（`regularExpression counts the capture groups it actually built`、
  `fileNameWithoutExtension follows FileUtilRt: a dotfile has an empty stem`）。
- **孤儿模块门** `node .tools/find-orphan-modules.mjs --gate` → **红，但红点不在本域**：
  `已登记孤儿 6 / 基线 8 · 新增 1 · 本轮清掉 2`；`✔ 已接上：src/jarRun.ts`、`✔ 已接上：src/runAnythingContext.ts`；
  `✘ 新增零生产消费方模块：src/components/CodeActionPopup.vue`。该文件在 `codeactionpopup` 名下、正在跑，**本域未碰**。
  本域改动只动了已注册表内部（`captureGroupCount` 是模块内私有 helper、不导出；宏表条数 25/8 未变）⇒ 不新增模块、不产生孤儿。
- **扩展名门** `node .tools/find-missing-ext.mjs` → `扫描 1386 个文件（src + tests）` / `干净：没有漏扩展名、且静态也解析不到的相对 import`。
- **隔离 `tsc --noEmit`**（并发期全仓 `vue-tsc -b` 的 0 错不可信，按名下模块单跑）
  `tsc --noEmit --strict --noUnusedLocals --target ES2022 --module preserve --moduleResolution bundler
  --allowImportingTsExtensions --verbatimModuleSyntax --skipLibCheck src/templateMacros.ts src/templates.ts`
  → **0 错，EXIT=0**。`--noUnusedLocals` 顺带证伪了「摘掉 `fileNameStem` import 后留了个没用到的绑定」。
- **改动模块逐个 `node -e import()` 自证可加载**
  `src/templateMacros.ts` → loaded, exports: 10；`src/templates.ts` → loaded, exports: 13；
  `src/surroundTemplates.ts`（本域未改，customfold 名下）→ loaded, exports: 1。
  再从模块内实读：`LIVE_TEMPLATE_MACROS.length` = **25**、`DEFERRED_TEMPLATE_MACROS.length` = **8**、`user` 那条 reason 长度 154。
- **模块大小门** `src/templateMacros.ts` 672 → **701 行**（上限 900，`tests/module-size.test.mjs` 绿）。
- 未跑全量 `npm test`（按门禁口径）。

## 5. 无法核实

1. **中文措辞**：参考树里 `find -name "*_zh*" -o -name "*zh_CN*"` 只命中 `build/conf/nsis/idea_zh_CN.nsi`、
   `AgreementsBundle_zh_CN.properties`、`UpdaterBundle_zh_CN.properties` —— **没有 `CodeInsightBundle_zh_CN.properties`**。
   所以 8 条走 `CodeInsightBundle.message(...)` 的 `presentableName`（`macro.capitalize.string` 等，
   `platform/lang-api/resources/messages/CodeInsightBundle.properties:178-185`）只能核到**英文原值**；
   中文 IDE 里上游下拉到底显示什么，取不到。本仓那份是英文原值，与上游**英文**档逐字相同（已核），中文档不下判断。
2. **JDK 不在参考树**：`SimpleDateFormat` 的完整字母表（本仓只覆盖 `y M d D H h K k m s S E a`，其余字母一律报错——
   报错**形状**对得上 `CurrentDateMacro.java:36-38`，触发**面**是否偏宽不可证）、
   `Matcher.appendReplacement` 对 `$0`、`$&`、`` $' ``、`$$`、`${name}` 的确切记号表（§1C 的 C8），
   以及 `FileUtil.toSystemDependentName` 之外的路径改写细节。这些一律**登记不改**。
3. **`DateFormatUtil.formatDate/formatTime` 的无参档**：`CurrentDateMacro.java:41` 读区域设置，
   本仓钉 `yyyy/M/d`、`H:mm` 并已写明「本仓档」。中文环境下上游出什么——同 1，无法核实。
4. **本仓真机展开观感**：没起宿主 GUI（按「不做未授权真机测试」），全部结论来自模块级实测 + 逐条读盘。

## 6. 接线请求

本域**没有**新增用户可见控件，也没有需要新挂点的模块（改动都在既有宏的求值体内）。需要别的文件/别的 lane 配合的，按优先级：

1. **SELECTION 通道（C4，6 条宏：`camelCase`/`underscoresToCamelCase`/`capitalizeAndUnderscore`/`snakeCase`/`lowercaseAndDash`/`spaceSeparated`）**
   上游 `MacroBase.java:55-66` 的 `getTextResult(params, context, useSelection=true)`：实参算出 `null` 时回落读
   `context.getProperty(ExpressionContext.SELECTION)`。要接上需要两处，都**不在本域名下**：
   - `src/templateMacros.ts:73-78` 的 `TemplateMacroContext` 加一个 `readonly selection?: string`（本域可加，但加了没人填就是假字段）；
   - 选区的**来源**在 `src/components/CodeEditor.vue`（**禁写**，2 行贴顶）/ `src/bridge.ts`（**0 贴顶**）那一侧，
     `expand()`（`src/templates.ts:226-236`）目前只拿到单行文本与行内列。
   ⇒ 请编辑器那条 lane 把「展开时的选区文本」传到 `expand()`。**这条不对称也要保住**：另外 6 条
   （`capitalize`/`decapitalize`/`firstWord`/`escapeString`/`underscoresToSpaces`/`spacesToUnderscores`）上游是 `false`，接线时别一律传 `true`。
2. **`lineNumber`**：需要编辑器给出**文档内行号**（上游 `context.getEditor().offsetToLogicalPosition(getStartOffset()).line + 1`，
   `LineNumberMacro.java:22-23`）。同上，来源在 `CodeEditor.vue`（禁写）。`expand()` 现有签名塞不进。
3. **`filePath` 的 `toSystemDependentName`（C5）**：宿主是 win32，上游在 Windows 出反斜杠、本仓出正斜杠。
   需要一个「平台路径分隔符」通道（`bridge` 或 native 侧给一个 `pathSeparator`），JS 侧猜 `navigator` 不算证据。
4. **`src/fileTemplateVars.ts:49` 的 `fileNameStem`（`dot > 0`）与本宏（`i < 0`）现在**两套口径**。**
   该文件不是本域名下、也不是本轮在飞名单里的，但它是 `fileNameStem` 的**唯一**其余消费方（文件模板 `${NAME}` 那条路）。
   ⇒ 请该文件的主人确认**文件模板**侧的上游档：若那里同样走 `FileUtilRt.getNameWithoutExtension`，就把 `dot > 0` 改成 `i < 0`，
   两套口径归一；若上游文件模板侧本来就是另一条判据，就维持现状、本宏这条注释已经是分界说明。
5. **既有的挂点清单**：`docs/wiring-requests-2026-10-06-fix-macros.md`（在 `fix-macros` 名下、本轮未改）与本报告 §2.3 一致，
   8 条登记侧宏的理由逐条复核过，无新增缺挂点。
