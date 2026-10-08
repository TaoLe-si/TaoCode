# 接线请求 · encod2（文件编码族实质核对）· 2026-10-06

> 报告本体：`docs/batch-2026-10-06-encod2.md`。本文件里的每一条目标都是**保留文件**（`src/App.vue`、`native/main.cpp`）
> 或**并发黑名单**（`src/menus/*`、`src/components/*` 里别人名下的桶）或 **native**，本 lane 一个字都没改，只交可照抄的 old/new。
> 上游基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`
> —— 每条上游坐标都是本轮 `Read`/`sed` 实读过的行；仓内 `third_party/intellij-community` 是坏树，未使用。
>
> 工作区是多路并行的，行号会漂：每条同时给了「这一段的识别特征」（同一行必须出现的关键调用）。

## R-1 · native：`file.lineSeparators` 补 CR 档，并且未知档位必须报错（现在静默按 LF 重写）

- **目标文件**：`native/workspace.cpp`（`Workspace::convert_line_separators`），契约注释 `native/workspace.hpp:40-43`。
- **上游依据**（本轮实读）：`platform/util/src/com/intellij/util/LineSeparator.java:17-20` 三档 `LF("\n")/CRLF("\r\n")/CR("\r")`；
  `platform/platform-impl/resources/idea/PlatformActions.xml:405-409` 的 `ChangeLineSeparators` 组挂三条动作，
  第三条 `ConvertToMacLineSeparatorsAction.java:14` 就是 `LineSeparator.CR`。
- **现状（缺陷）**：`native/workspace.cpp:878`

  ```cpp
          const std::string converted = convert_endings(content, separator == "crlf" ? "\r\n" : "\n");
  ```

  除字面量 `"crlf"` 外**任何**入参都落进 `"\n"` 分支：将来客户端送 `"cr"`、送错大小写、送空串，宿主都会
  把整份文件的行尾**静默改成 LF** 并回报 `changed: true`。`convert_endings` 本体（`:245-259`）是通用的，
  认单个 `\r` 也是断行，所以缺的只是档位映射与校验。
- **建议 new**（识别特征：同一函数里下一行是 `encode_document(converted, utf8_encoding(), false)`）：

  ```cpp
          // LineSeparator.java:17-20 的三档；未知档位一律报错，不能当成 LF 重写用户的文件。
          std::string ending;
          if (separator == "crlf") ending = "\r\n";
          else if (separator == "lf") ending = "\n";
          else if (separator == "cr") ending = "\r";
          else fail("INVALID_ARGUMENT", "未知的行分隔符档位：" + separator);
          const std::string converted = convert_endings(content, ending);
  ```

  （`fail` 的用法与错误码风格照同文件 `:164` `fail("INVALID_ENCODING", …)`；若 `INVALID_ARGUMENT` 已在别处占用，
  按现有码表挑一条同义的，别新造第二套。）
- **同时改契约注释**：`native/workspace.hpp:41` 现文 `// normalized to "crlf" or "lf"; version-checked and read-only-guarded.`
  ⇒ 改成 `"crlf" / "lf" / "cr"`,并注明未知档位 `fail`。

## R-2 · App.vue（保留）：UTF-16 的 BOM 是强制的，勾选项要跟着编码档走

- **目标文件**：`src/App.vue`（编码弹层那一行，识别特征：同一行有 `class="encoding-bom"`）。
- **上游依据**：`platform/core-api/src/com/intellij/openapi/vfs/VirtualFile.java:507-511` `setCharset` ——
  `byte[] bom = CharsetToolkit.getMandatoryBom(charset);` 有强制 BOM（UTF-16LE/BE、UTF-32，见
  `CharsetToolkit.java:86-92`）就**直接取它**，用户没有「去掉 BOM」这一选；否则才看「原本有 BOM 且新编码容得下」
  （`CharsetToolkit.java:584` `canHaveBom`），容不下就 `setBOM(null)`。
- **现状**：`src/App.vue:2407`

  ```vue
          <label class="encoding-bom"><input v-model="encodingPrompt.bom" type="checkbox" :disabled="encodingPrompt.encoding === 'gbk' || encodingPrompt.encoding === 'cp1252' || encodingPrompt.encoding === 'system'" />写入字节顺序标记（BOM）</label>
  ```

  置灰清单只覆盖「根本没有 BOM」的三档（本 lane 已在 `src/fileEncodingRules.ts` + `src/editorFileOps.ts`
  把这半边的**状态**修对，判据 `tests/encoding-bom.test.mjs`）。UTF-16 两档的复选框仍然可勾可解，
  而 `bomAfterEncodingSwitch('utf-16le', false)` 现在**故意**保留 `false`（不自动补 BOM）——
  因为「控件说可以关、行为却强行打开」比现状更坏。判据里把这条现状钉成了显式断言，改动时必须同步。
- **建议 new**（三档合一：置灰 = 「强制 BOM」∪「根本没有 BOM」，值由规则模块给）：

  ```vue
          <label class="encoding-bom"><input v-model="encodingPrompt.bom" type="checkbox" :disabled="!encodingBomToggleable(encodingPrompt.encoding)" />写入字节顺序标记（BOM）</label>
  ```

  并在 `src/fileEncodingRules.ts` 补两个纯函数（本 lane 没加，因为加了没有消费者就是死代码 —— 等这条落地）：
  `encodingBomToggleable(encoding) = encoding === 'utf-8'`，
  `mandatoryBom(encoding) = (encoding === 'utf-16le' || encoding === 'utf-16be')`；
  `bomAfterEncodingSwitch` 相应改成 `mandatoryBom(encoding) ? true : encodingHasPossibleBom(encoding) ? currentBom : false`。
  `src/App.vue` 需从 `./fileEncodingRules.ts` 取 `encodingBomToggleable`（现文件已经在 `:1158` 从 `editorFileOps` 取那一族口子，
  加一行 import 即可）。届时 `tests/encoding-bom.test.mjs` 里「utf-16le 保留 false」那条断言要改成钉「强制 true」。

## R-3 · native：保存侧的行尾档位不该从缓冲正文里嗅

- **目标文件**：`native/workspace.cpp`（`Workspace::write`，识别特征：同一行有 `encode_document(convert_endings(content, separator), chosen, bom)`）。
- **现状**：`native/workspace.cpp:916-920`

  ```cpp
          // The document's line endings are a buffer property (CodeMirror keeps LF in
          // memory and joins with EditorState.lineSeparator), so the bytes written must
          // carry them too — otherwise saving a CRLF file silently converts it to LF.
          const std::string separator = content.find("\r\n") != std::string::npos ? "\r\n" : "\n";
          const auto bytes = encode_document(convert_endings(content, separator), chosen, bom);
  ```

  纯 CR（Classic Mac OS）文件：`convert_endings` 认 `\r` 是断行（`:250-253`），而嗅探只看 `\r\n` ⇒
  「打开→原样保存」把整份文件折算成 LF。上游这一档来自 `FileDocumentManager.getLineSeparator`
  （`LineSeparatorPanel.java:34` 用的就是它，值可来自 `.editorconfig` 的 `end_of_line`、
  `CodeStyleSettings.LINE_SEPARATOR_BY_FILE`、`LoadTextUtil.detectLineSeparator`），是**显式档位**不是嗅探。
- **建议**：`file.write` 增加可选入参 `separator`（`"crlf"|"lf"|"cr"`，缺省时保留现在的嗅探行为，
  以免打断没升级的客户端），由 TS 侧把标签的行尾档显式送下来；TS 侧的送值点在 `src/App.vue:1132`
  （`request<SaveResult>('file.write', { … encoding: tab.encoding, bom: tab.bom … })`，保留文件，本 lane 没动）。
- **状态栏那一格同时要跟着改**（`src/App.vue:2329`，识别特征：`showWidget('lineSeparator')` 那一行）：
  现在 `active.content.includes('\r\n') ? 'CRLF' : 'LF'`，两态；上游 `LineSeparatorPanel.java:34` 的文本是
  `LineSeparator.fromString(lineSeparator).toString()`，三档都可能。本仓要出第三档 `CR` 就得先有 R-1，
  并且那个「转换行尾」按钮（同文件，识别特征：`title="转换行分隔符（点击在 Windows 与 Unix 之间切换）"`）
  的两态 toggle 语义也要跟着换 —— 上游那里点开的是三条动作的弹层，不是循环切换。

## R-4 · 黑名单文件：CR 档的两条入口（等 R-1 落地再做，别先做名字）

- **目标文件**：`src/menus/fileMenu.ts:83-87`、`src/components/TabContextMenu.vue:92-95`。
- 现文件已经写明白为什么没有第三项（`src/menus/fileMenu.ts:86-87`：「IDEA 还有 ConvertToMacLineSeparators(CR)：
  TaoCode 的换行转换只有 CRLF/LF 两种……不做只有名字没有实现的第三项」）——**这句在 R-1 之前是对的**，别提前推翻。
- R-1 落地后两条各加一项，标题逐字照上游英文 `ApplicationBundle.properties:447`
  `combobox.crlf.mac=Classic Mac OS (\r)` ⇒ 中文「转换为 Classic Mac OS (CR) 行尾」里
  「转换为/行尾」两截是本仓既有措辞（对齐现文件 `:94-95`），**「Classic Mac OS」的中文译法无法核实**
  （上游树里没有中文资源包），不许自己造一个「老式 Mac」出来。
- 顺带把 `src/editorFileOps.ts:176` 的联合类型扩成 `'crlf' | 'lf' | 'cr'`，并让 `:186/:195` 那两句
  提示词不再用「`separator === 'crlf' ? A : B`」的二叉写法（第三档会被挤进 B，说成 Unix）。
  `editorFileOps.ts` 不在保留名单里，本可以本轮就改，但**类型扩了三档而宿主只认两档**会立刻踩 R-1 的静默 LF ⇒ 与 R-1 同批做。

## R-5 · 登记，不是请求：搜索层与编辑器的读侧编码不是同一套答案

- **事实**：编辑器 `file.read` 的 auto 链是「BOM → 严格 UTF-8 → 报 `INVALID_UTF8`」（`native/workspace.cpp:221-234,744-752`）；
  搜索层是「UTF-8 失败就按 GBK(936) 解，两边都不成才计入跳过」（`native/search.cpp:237-249`）。
  同一个中文旧文件：Find in Path 按 GBK 匹配得到，编辑器却拒绝打开。上游两处共用 VFS 的同一份检测结果
  （`LoadTextUtil.java:331-349` + `CharsetToolkit.java:242-261`），不会给两套答案。
- **不必新增控件**：`skippedNonUtf8` 已经有消费链路（`src/bridge.ts:193,199` → `src/components/SearchPanel.vue:313`、
  `src/searchReplaceOutcome.ts:27`，判据 `tests/search-replace-outcome.test.mjs`），"哪些文件读不了"已经在说话。
- **要做的只是决定哪一侧是准绳**（属编码族owner，不由本 lane 拍）：要么编辑器 auto 链在 UTF-8 解不开时按项目默认编码
  续读并**报出用的是哪档**（对齐上游 `INVALID_UTF8 ⇒ defaultCharset`），要么搜索层改成与编辑器同一严格度、
  把这类文件计入跳过。两边都改了才算闭环，只改一边会把差异挪个地方。

## R-6 · 登记：工程级编码映射与 `.editorconfig` 的 `charset` / `end_of_line` 没有消费链路

- 上游按文件/目录记编码在 `EncodingProjectManagerImpl`（`.idea/encodings.xml`），读侧优先级里它是第 2-3 档
  （`LoadTextUtil.java:339-343`）；`.editorconfig` 的 `charset`/`end_of_line` 走上游 `EncodingRegistry` / `LineSetStatistics`。
- 本仓现状：按文件编码只活在会话快照里（`src/sessionEncodings.ts:3-8` 自己写明了这一点，判据 `tests/session-encoding.test.mjs`）；
  `.editorconfig` 的两条键只在 `src/editorConfig.ts:338-339` **登记不消费**。
- 若要做工程级 `encodings.xml` 等价物：新持久化键**缺键必须补默认**（不能按字段数判损坏），
  默认值取上游语义 —— 没有映射 = 走读侧检测，而不是「默认 GBK」。

## 处理结果（wiring-backlog lane，2026-10-06）

- **R-2 已接线**：`src/App.vue:2457` 的 BOM 复选框已是 `:disabled="!encodingBomToggleable(encodingPrompt.encoding)"`，`src/fileEncodingRules.ts:40` 的 `encodingBomToggleable` 已有生产消费方。
- **R-1 / R-3（native 行尾档位）** —— 目标 `native/workspace.cpp`，非本 lane 可改面。跳过给 native owner。
- **文件右键「行尾」档** —— 目标 `src/menus/fileMenu.ts:83-87` + `src/components/TabContextMenu.vue:92-95`（本 lane 可改面）。复核未接，但依赖 R-1/R-3 的 native 契约（未知档位 `fail`）⇒ 无 native 侧前接上 = 假档。登记为「等 native owner」。

结论：R-2 已接线；R-1/R-3 及依赖它们的菜单档转给 native owner。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「R-2 已接线；R-1/R-3 及依赖它们的菜单档转给 native owner。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
