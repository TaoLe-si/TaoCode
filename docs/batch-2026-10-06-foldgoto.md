# 批次报告 2026-10-06 · 代号 `foldgoto`

域：`lp/custom-folding` 的「自定义折叠区域列表 + 跳到上/下一个区域」
（上游 `CustomFoldingRegionsPopup` / `GotoCustomRegionAction`）。
改动：**1 行代码**（`src/customFoldingRegions.ts`，140 → 155 行，`git diff` = +18/−3，其中代码只有 1 增 1 删，其余是注释）
+ 新增判据 `tests/custom-folding-regions.test.mjs`（147 行）+ 本两份文档。**没动别的文件。**

## 0. 派单前提订正（留痕：不是"新建"，是"已存在且已接线"）

派单写「落点建议新建 `src/customFoldingRegions.ts`」。磁盘核对：该文件与弹层
`src/customFoldingPopup.ts` 都在 `git ls-files` 里（已提交），区域表 / 上下一条 / 缩进 / 落点规格
四样齐全，且宿主已绑 `Ctrl-Alt-.`（`src/components/CodeEditor.vue:915-919`，控制器建于 `:112`）。
⇒ 本批**不重写已有的解析**（复用 `src/customFoldingProviders.ts` 那张表与
`src/editorFolding.ts` 的 `regionMarkerBody`），只做「按上游逐行重核 + 修核出来的缺陷 + 补判据」，
剩下没宿主的两件写进 `docs/wiring-requests-2026-10-06-foldgoto.md`（W-1、W-2）。

## 1. 上游依据（参考树逐行 `sed -n` 打开核，全部命中）

参考树 = `D:/Backup/Downloads/intellij-community-master/intellij-community-master`。
**`third_party/intellij-community` 是空树**，不能当依据：工作树零文件、`git log` 报
`your current branch appears to be broken`、`count-objects` 显示 in-pack 0，只有一个
761 MB 的 `tmp_pack_C8oOYZ` 被 git 自己标为 `garbage` ⇒ 读不出任何 blob。

| 上游坐标 | 实测内容 | 核对 |
|---|---|---|
| `GotoCustomRegionAction.java`（119 行）`:60/:61/:62/:65`、`update` 在 `:74-81`（`:79` = `editor != null && project != null`） | 收 descriptor → 判空 → 非空弹层、空则提示；`update` 只看编辑器与工程 | ✓ 模块头引的行号原样成立 |
| `CustomFoldingRegionsPopup.java`（89 行）`:26`、`:57-58`、`:65-69`、`:72-76`（`:73` 出栈条件）、`:80-88`（`:82` 界闸 / `:84` `moveToOffset` / `:85` CENTER / `:86` 清选区） | 排序按**元素**起始、每层三个空格、栈算层数、落点是元素起始 | ✓ |
| `CustomFoldingBuilder.java`（249 行）`:85-87` | `new TextRange(startNode…getStartOffset(), child…getEndOffset())` + `new FoldingDescriptor(startNode, range)` ⇒ **元素起始 == 区域起始**，`:73` 那个比较在本仓就是「新区域 `from` ≥ 栈顶 `rangeEnd`」 | ✓（这条是 `regionEntries` 用两个区间的依据） |
| 同上 `:102-111` / `:117-119` / `:164-187` / `:194-203` | 占位文字转发 provider；单参重载固定 `...`；两次询问；`getDefaultProvider` 的循环 `:197-199` **确实没有 break** ⇒ 取最后一个认领者并按实例缓存 | ✓（别人那条「取最后一个」的说法成立） |
| `intellij.platform.core.xml:40` + `intellij.platform.lang.impl.xml:1466-1467` | EP 声明 + 全树 `customFoldingProvider` 注册**共 3 行命中** = 声明 1 + 实现 2（NetBeans / VisualStudio） | ✓ |
| `$default.xml:535-537`、`intellij.platform.lang.impl.actions.xml:378`、`IdeBundle.properties:1062-1066` | `control alt PERIOD`；唯一动作 `GotoCustomRegion`；`…menu.item` / `command` / `dumb` / `light` / `unavailable` 五行连排 | ✓ |
| 两个 provider 的判定/占位/`defaultstate` | `VisualStudio…:13-14/:22-27/:36-43`、`NetBeans…:14-15/:19-20/:23-27/:45-48`，正则字面量与仓里那张表逐字符一致 | ✓ |

**无法核实（两条，都留原判）**：
① `<region>` 一族的 provider —— `grep -rn --include=*.java "<region" platform/analysis-impl platform/lang-impl platform/core-api` = **0 命中**，注册表也只有两条 ⇒ 它的 `getPlaceholderText` 规则确实无上游依据，仓里那条「借用两个真 provider 共用的最窄规则」维持。
② 中文文案出处 `plugins/localization-zh/lib/localization-zh.jar` —— 参考树 `plugins/` 下**没有** `localization*`，`find -maxdepth 4 -iname "*localization*"` 零命中，本机也没找到带该 jar 的 IDE ⇒ 中文是原值还是意译判不了（英文键与行号已核实）。

## 2. 修掉的缺陷：区域表的偏移数错了坐标系（1 行）

`regionEntries` 里逐行起始偏移的推进量，上一版写的是
`at += lines[index].length + (text.startsWith('\r\n', at) ? 2 : 1)`，注释自称「按真正的换行符个数推进，
CRLF 不会把后面的行推歪」。两支都不成立：
· 判据量的是**行首**，而 CRLF 的 `\r` 在**行尾** ⇒ 只有**空行**判得出 `\r\n` ⇒ 同一份文档里非空行 +1、空行 +2；
· 这些偏移的落点是 `view.dispatch({selection})`，而 CM 建 `Text` 时把换行**归一成一个 `\n`**
（实测 `EditorState.create({doc:'a\r\nb'})` ⇒ `doc.length === 3`、`line(1).text === 'a'`，`\r` 不进文档）
⇒ 就算判对了行尾，记 2 也会越过行首。

原始数字（量具 = `EditorState`；三条区域的 `from`：修后 / 修前 / CM 真值）：
`0 / 0 / 0`、`35 / 37 / 35`、`46 / 49 / 46`；标记前有 10 条 CRLF 空行时 `10 / 20 / 10`。
纯 LF 与"没有空行的 CRLF"两支本来就对（偏差只在空行处累加）。
可见后果：从弹层挑一条以后 `moveToOffset`（`:84`）落不到开始标记行首，光标被放到标记**之后**几个字符处。
修法 = 一律 `+ 1`（与 CM 同一坐标系），并把注释换成上面这些实测值。

## 3. 判据与反向验证

命令（按派单限定）：`node --test tests/custom-folding-regions.test.mjs tests/editor-folding*.test.mjs`
⇒ **tests 56 / pass 56 / fail 0**（新增这 7 条 + 折叠域原有 49 条）。
新判据 7 条：①偏移与 CM 逐条对齐（LF / CRLF / 无尾换行 / 标记前一串空行）②上下跳落在**行首**（端到端 dispatch）
③`from…to` 就是开始标记整行、`rangeEnd` 落在收尾标记行尾 ④层数不随行尾形态变化
⑤没有区域返回 `null`（对 `:65` 提示分支）⑥源码锚点（`+ 1` 那一行在、`? 2 : 1` 那一支不在）⑦lone `\r` 的已登记偏离。

**反向验证**：把旧算式原样装回再跑同一份判据 ⇒ **pass 3 / fail 4**，失败的是
①偏移对齐、②落在行首、③`from…to` 对上文本、⑥源码锚点（④⑤⑦与行尾形态无关，照旧通过）。
随后把修后算式装回，复跑 ⇒ 56/56。判据不再靠"改前改后都绿"的那种弱断言。

**已知偏离（钉住，不改）**：lone `\r`（旧 Mac 行尾）在本仓**行模型**里不是一行 ——
`regionEntries` 与 `localRegionFolds` 共用 `split(/\r?\n/)`，实测两侧都产出 0 条区域 / 0 条区间，
而 CM 会把同一份文本切成 4 行。要改得同时动折叠那一族的共用规则（不在本模块单方面收紧），
所以第 ⑦ 条只把实测值钉住，改动必须是有意的。

## 4. 交给宿主的两条（见请求文档）

- **W-1**：上/下一个区域**没有命令入口**（`nextCustomRegion` 只用于弹层初始高亮）。
  上游**没有**这个动作（全树只有 `GotoCustomRegion` 一条）⇒ 标注为本仓自定，键选 `Ctrl-Alt-[` / `]`
  （上游 `$default.xml` 与本仓 `src/` 里都零命中，不撞车），净增 2 行（`CodeEditor.vue` 上限 1147、现 1144）。
- **W-2**：`CodeEditor.vue:917` 硬编码「这个文件里没有自定义折叠区域」，
  而 `customFoldingPopup.ts:29` 导出 `NO_CUSTOM_REGIONS_IN_FILE`（=「当前文件中没有自定义的折叠」）**无人消费**
  ⇒ 同一句上游提示两种文字、导出那份是死的；改用常量，净增 0 行。
