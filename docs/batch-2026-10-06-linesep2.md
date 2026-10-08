# batch-2026-10-06-linesep2 — 行分隔符第三档（CR）+ UTF-32 BOM 档 + 收掉"非 crlf 入参被静默当 \n"

lane: linesep2 ｜ 只动 native 侧（`native/workspace.cpp/hpp` 及其 `*_test.cpp`、`CMakeLists.txt` 的 `add_test`）
参考树（唯一）: `D:\Backup\Downloads\intellij-community-master\intellij-community-master`
（仓内 `third_party/intellij-community` = 坏树，禁用）

## §0 接手实况（开文件复核，行号以我读到的为准）

现场（`native/workspace.cpp` 1368 行、`native/workspace.hpp` 101 行、`native/workspace_test.cpp` 609 行、`CMakeLists.txt` `grep -c add_test` = **39**）：

| 任务给的坐标 | 我读到的实际坐标 | 实况 |
| --- | --- | --- |
| `workspace.cpp:878` 非 `crlf` 入参被静默当 `\n` | `:855-856` 已有 `if (separator != "crlf" && separator != "lf") fail("INVALID_SETTINGS", …)`；`:878` 是 `convert_endings(content, separator == "crlf" ? "\r\n" : "\n")` | **一半不符**：当前不会静默（第二档 `lf` 显式拒绝之外的值）。但 `:878` 的三元式确实是"else 一律 `\n`"的静默默认——一旦加了第三档 `cr`，它就会被吞成 LF。按任务意图收掉：显式三档映射 + 未知即 fail。 |
| `:919` 保存侧靠嗅 `\r\n` 定行尾 ⇒ 纯 CR 文件打开→保存被折算成 LF | `:917-920`（注释 917，`const std::string separator = content.find("\r\n") != npos ? "\r\n" : "\n";` 919，`encode_document(convert_endings(content, separator), …)` 920） | **符合**。纯 CR 缓冲嗅不到 `\r\n` ⇒ 落到 `"\n"` ⇒ `convert_endings`（`:245`，孤 `\r` 也算一个断行）把每条 CR 改写成 LF ⇒ 整文件被重写。**这是真的数据损坏**，本 lane 主修。 |
| BOM 读侧只认 UTF-8→UTF-16LE→UTF-16BE，`FF FE 00 00` 被当 UTF-16LE | `encoding_list` `:152-159`（utf-8/gbk/cp1252/system/utf-16le/utf-16be），嗅探循环 `resolve_read` `:221-234` | **符合**。UTF-32 两档整体缺失。附带缺陷：`Encoding::bom` 是 `const char*` 且用 `std::char_traits<char>::length()` 量长度，**UTF-32BE 的 BOM `00 00 FE FF` 以 NUL 开头，strlen 会算成 0** ⇒ 必须先改成带显式长度的形态才能加这一档。 |
| `native/main.cpp` 转发行尾入参 | 实际路由在 `native/file_queries.cpp:202-203`（`file.lineSeparators` → `workspace.convert_line_separators`） | 入参是透传字符串，加第三档**不需要动 `main.cpp`/`file_queries.cpp`**。`write()` 的 `encoding`/`bom` 同理透传。 |
| 前端 | `src/editorFileOps.ts:179`（`separator: 'crlf' | 'lf'`）、`src/menus/fileMenu.ts:84-87`（注释明确写"不做只有名字没有实现的第三项"）、`src/components/TabContextMenu.vue:94-95`、`src/App.vue:2329` 状态栏 `active.content.includes('\r\n') ? 'CRLF' : 'LF'`（两态）、`src/bridge.ts:58` `EncodingKey` 六元联合 | 全部在禁写/黑名单内 ⇒ 只出 §6 请求。 |

## §1 上游核对

参考树根 = `D:\Backup\Downloads\intellij-community-master\intellij-community-master`（唯一可用树；仓内 `third_party/intellij-community` 坏树未使用）。实读：

- `platform/util/src/com/intellij/util/LineSeparator.java:17-20` — `public enum LineSeparator { LF("\n"), CRLF("\r\n"), CR("\r"); }`。**三档确认**，与任务坐标逐行相符。`:14` 注释自陈 Classic Mac「possibly not actual anymore」但仍保留为枚举项。
- `LineSeparator.java:35-43` `fromString` — 未知串走 `Logger.error` 后回落系统行尾（IDE 内部容错）。我们对外层用 `fail("INVALID_SETTINGS")` 更严，属既有裁决，不改。
- `platform/platform-impl/resources/idea/PlatformActions.xml:405-408` — `<group id="ChangeLineSeparators" popup="true">` 下三个 reference：`ConvertToWindowsLineSeparators`(406)、`ConvertToUnixLineSeparators`(407)、`ConvertToMacLineSeparators`(408)。**任务写 405-409，实为 405-408（409 是 `</group>`）**，已换成读到的。
- `platform/platform-impl/src/com/intellij/codeStyle/ConvertToMacLineSeparatorsAction.java:14` — `super(ApplicationBundle.messagePointer("combobox.crlf.mac"), LineSeparator.CR);` **`:14` = `LineSeparator.CR` 确认**。同目录 `ConvertToWindowsLineSeparatorsAction.java:15` = `LineSeparator.CRLF`，`ConvertToUnixLineSeparatorsAction.java` 同构（LF）。
- `platform/editor-ui-ex/src/com/intellij/codeStyle/AbstractConvertLineSeparatorsAction.java:46-48` — 动作把枚举折成 `separator.getSeparatorString()` 字符串；`:64` `update()` 用 `!mySeparator.equals(LoadTextUtil.detectLineSeparator(file,false))` 决定该档是否可用（**当前已是该档就置灰**）；`:128` 同样先探测再改名。
- `platform/core-impl/src/com/intellij/openapi/fileEditor/impl/LoadTextUtil.java:801-813` `ConvertResult.majorLineSeparator()` — **三档投票是本 lane 嗅探的蓝本**：
  `CRLF_count > CR_count && CRLF_count > LF_count` → `"\r\n"`；否则 `CR_count > LF_count` → `"\r"`；否则 `LF_count > 0` → `"\n"`；都没有 → `null`（`:727-730`「when in doubt, leave old separator」）。
- `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/LineSeparatorPanel.java:33-36` — 状态栏文本 = `LineSeparator.fromString(lineSeparator).toString()`，即 **`LF`/`CRLF`/`CR` 三态**，不是两态。⇒ §6 状态栏请求的依据。
- `platform/util/src/com/intellij/openapi/vfs/CharsetToolkit.java:424-429` `guessFromBOM(byte[])` — 顺序：`hasUTF8Bom`→`hasUTF32BEBom`(:426)→`hasUTF32LEBom`(:427)→`hasUTF16LEBom`(:428)→`hasUTF16BEBom`(:429)。**逐行相符**（任务写 424-429 = 整个函数）。
  - 常量 `:79-83`：`UTF32BE_BOM = {0,0,-2,-1}`（`00 00 FE FF`）、`UTF32LE_BOM = {-1,-2,0,0}`（`FF FE 00 00`）；字符集 `:64-65` `UTF_32BE_CHARSET`/`UTF_32LE_CHARSET`。
  - **顺序即语义**：`FF FE 00 00` 必须先判 UTF-32LE，否则被 `FF FE` 抢去当 UTF-16LE —— 正是本地缺陷。UTF-32BE 又排在 UTF-32LE 前。
  - `:86-91` `CHARSET_TO_MANDATORY_BOM` 把 UTF-16/UTF-32 四档列为"必须有 BOM"，本 lane 的写侧只接受显式 `bom=true` 才补记号，与既有 TaoCode 裁决一致，不改。


## §2 落盘

待填：改动清单（native 代码 + 测试 + CMakeLists）。

## §3 判据与反向验证

前缀 `LINESEP2`。待填：注入变异 → 打红 → 原样还原 → cmp/sha1 → grep 归零。

## §4 门禁原始数字

待填：encoding/module-size 测试、build-native + ctest（基线 39 条 → N）、orphan gate、missing-ext。

## §5 无法核实

待填。

## §6 留给主代理的宿主请求

待填（前端档位表 / 状态栏 / 持久化键六处成对）。
