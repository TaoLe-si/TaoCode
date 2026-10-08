# batch-2026-10-06-inlayparams — 参数内联提示「排除列表」一档

lane: inlayparams（只读复核来源：`docs/batch-2026-10-06-restsix.md` 的 `lp/inlay-hints` 节）
范围：**只做一件事** — parameter hints 的排除列表（excluded namespaces / excluded names）一档，含上游核对、真消费方接线、判据。
状态：**进行中**（骨架，前 3 次调用落盘）

## §0 接手实况（先判现场，不照抄派单坐标）

- 现场文件（`ls -la src/ | grep -i inlay` + `ls -la tests/ | grep -i inlay`）：
  - `src/inlayHints.ts`（5710 B，mtime 2026-10-05 10:32）
  - `src/inlayHintLayout.ts`（5301 B，mtime 2026-10-05 16:06）
  - `src/editorInlayHints.ts`（18325 B，mtime 2026-10-06 14:58）← 撞墙 lane 留过注入，主代理称已还原，**待复核**
  - `tests/inlay-hints.test.mjs`（3903 B）/ `tests/inlay-hint-layout.test.mjs`（2920 B）/ `tests/inlay-hints-settings.test.mjs`（19847 B）
- 派单给的落点 `inlayHints.ts` / `inlayHintLayout.ts:71` / `InlayHintsSettingsPage.vue` — 逐行核实见 §2。
- 撞墙闸复核：**闸是真的**。`grep -rn "|| true" src/editorInlayHints.ts` → exit 1（零命中）；
  `src/editorInlayHints.ts:259` 现为 `if (!inlayHintCache.acceptFull(path, revision, semanticRevisionOf(target.state.doc), items)) return`
  （注释 `:258` 说明语义），`acceptFull` 的定义/契约判据在它名下测试里。
  接手时跑的红绿实况：`node --test tests/inlay-hints.test.mjs tests/inlay-hint-layout.test.mjs tests/inlay-hints-settings.test.mjs tests/module-size.test.mjs`
  ⇒ **21 tests / 21 pass / 0 fail**（详见 §4，派单里写的 `tests/hint*.test.mjs` glob 是零匹配，见 §4）。
- 现状与本档的缺口：`src/inlayHints.ts`（109 行）只有「按 kind 三档开关 + 显示文本 + 命令 + tooltip」；
  `src/inlayHintLayout.ts:71` 的过滤链只有一档 `shouldShowInlayHint(hint, toggles)`（派单给的 :71 **行号正确**，就是那一行）；
  `src/components/InlayHintsSettingsPage.vue`（65 行）**故意不渲染排除清单入口**，
  页面注释 `:20-21` 与判据 `tests/inlay-hints-settings.test.mjs:335`（`for (const label of ['排除','Exclude','排除清单']) assert.ok(!/<span>\s*排除/…)`）
  钉的就是「没有真消费方 ⇒ 不放控件」。本档把规则与消费方补上，**页面仍不放**（原因见 §5/§6：持久化键未登记 ⇒ 放上去就是假控件）。

## §1 上游核对（亲自开 D:\Backup\Downloads\intellij-community-master\intellij-community-master；`third_party/intellij-community` 未用）

**派单给的候选类名有两处是假的**（本仓 `restsix` 之外也要留痕）：

1. **`ParameterHintsSettings`（`isExcluded` / `getExcludedNamespaces` 一族）在这棵树里不存在。**
   全树 `find -name "ParameterHintsSettings*"` 只命中 `platform/lang-impl/src/com/intellij/codeInsight/hints/settings/ParameterHintsSettingsPanel.kt`（26 行）。
   现役的是 **`ParameterNameHintsSettings`**（`platform/lang-api/src/com/intellij/codeInsight/hints/settings/ParameterNameHintsSettings.kt`，233 行，`@State(name="ParameterNameHintsSettings", storages=[Storage("parameter.hints.xml")], category=CODE)` `:47`）
   + **`ParameterHintsExcludeListService`**（`platform/lang-impl/src/com/intellij/codeInsight/hints/parameters/ParameterHintExcludeListService.kt`，201 行）。
   `getExcludedNamespaces` 全树 grep **零命中** ⇒ 「排除的粒度是命名空间」这一条**判词就是错的**。
   同族里 `JavaParameterHintsSettings` 也不存在，Java 侧的默认清单是 `java/java-impl/src/com/intellij/codeInsight/hints/JavaInlayParameterHintsProvider.kt:65-67` 的 `override fun getDefaultBlackList(): Set<String> = defaultBlackList`。
   `ParameterHintsConfigurable` 亦不存在（现役是 `InlaySettingsConfigurable` + `ParameterHintsSettingsPanel`/`ExcludeListDialog`）。

2. **排除的真实粒度 = 方法全限定名 glob + 参数名 glob 列表**，不是命名空间、也不是单独的类型名/参数名：
   - 入口 `ParameterHintExcludeListService.kt:93-94`：
     `fun isExcluded(fullyQualifiedName: String, parameterNames: List<String>, language: Language) = getMatchers(language).any { it.isMatching(fullyQualifiedName, parameterNames) }`；
     清单来源 `:96-105` `getMatchers` = `getFullExcludeList(language).mapNotNull { MatcherConstructor.createMatcher(it) }`（坏模式被 `mapNotNull` 丢掉，不抛）。
   - 主题的定义 `platform/lang-api/src/com/intellij/codeInsight/hints/InlayParameterHintsProvider.kt:75`：
     `open class MethodInfo(val fullyQualifiedName: String, val paramNames: List<String>, val language: Language?)`，注释 `:71-72`
     「Provides fully qualified method name (e.g. "java.util.Map.put") and list of its parameter names. Used to match method with exclude list」。
     Java 侧怎么算出主题：`JavaInlayParameterHintsProvider.kt:57-63` `StringUtil.getQualifiedName(containingClass.qualifiedName, method.name)` + 每个参数的 `it.name`。
   - 模式文法（逐行读完两处小文件）：
     `platform/platform-impl/src/com/intellij/codeInsight/hints/filtering/StringMatcherBuilder.kt:28-61` ——
     空串=全匹配（`:29`）；`*` 单独=全匹配（`:41`）；无星号=**精确相等**（`:38`）；`*x`=endsWith（`:45-48`）；`x*`=startsWith（`:50-53`）；`*x*`=contains（`:55-58`）；
     **星号多于 2 个或位置不合法 ⇒ `return null`（整条模式作废）**（`:35` `if (asterisksCount > 2) return null`、`:60` 兜底 `return null`）。
     `…/filtering/MethodMatcher.kt:53-106` `MatcherConstructor` —— 以**最后一个 `(`** 切成「方法部分 + 参数列表部分」（`:59-71`）；
     `(a,b)` 这种开头就是括号的 ⇒ 方法部分为空串（`:63-66`，空串匹配器=恒真）；参数列表按逗号拆、
     `StringParamMatcher:33-43` 要求 **`paramNames.size == paramMatchers.size`** 再逐位 zip；
     列表里有空项或括号长度 ≤2 ⇒ 整条作废（`:86`、`:90`、`:92-93`）；无括号 ⇒ `AnyParamMatcher`（`:29-31`、`:100`）。
   - 命名空间只是**写法**上的前缀（`kotlin.require*(*)`、`org.gradle.api.Project.file(path)`），不是独立一档。

3. **默认排除清单长什么样**（都是 per-language provider 数据）：
   `JavaInlayParameterHintsProvider.kt:67-…` 前 11 条是参数名形态 `"(begin*, end*)" "(start*, end*)" "(first*, last*)" "(first*, second*)" "(from*, to*)" "(min*, max*)" "(key, value)" "(format, arg*)" "(message)" "(message, error)" "*Exception"`，
   之后是方法名形态 `"*.set*(*)"`/`"*.get(*)"`/`"*.println(*)"`…；
   Kotlin 侧 `plugins/kotlin/code-insight/kotlin.code-insight.k2/src/org/jetbrains/kotlin/idea/k2/codeinsight/hints/KtParameterHintsProvider.kt:449-…` `getDefaultExcludeList()` = `"*listOf" "*setOf" "kotlin.require*(*)" "*contains*(value)"` + 一批 Gradle DSL。
   消费侧的「默认 + 用户 diff」折算是 `platform/lang-impl/src/com/intellij/codeInsight/hints/HintUtils.kt:87-90`
   `getExcludeList(settings, config) = settings.getExcludeListDiff(config.language).applyOn(config.defaultExcludeList)`，
   diff 结构 `ParameterNameHintsSettings.kt:26-45`（`class Diff(added, removed)` + `applyOn` + `Builder.build(base, updated)` 用「base-updated / updated-base」两个方向算增删），
   按 **语言显示名** 存 key（`:177-197` `language.displayName`），落盘 XML 形如 `<blacklists><blacklist language="Java"><added pattern="…"/><removed pattern="…"/></blacklist></blacklists>`（`:14-24` 的 tag 常量 + `:71-92` 写出）。

4. **设置页那一格**（本仓最在意的形状）：
   `platform/lang-impl/src/com/intellij/codeInsight/hints/settings/ParameterHintsSettingsPanel.kt:14-25` ——
   面板本体**只有一个 ActionLink**（`if (config.isExcludeListSupported)` 才加，文案 `CodeInsightBundle` key `settings.inlay.java.exclude.list` = `Exclude list…`，properties `:321`），点开
   `platform/lang-impl/src/com/intellij/codeInsight/hints/ExcludeListPanel.kt:32-124` 的 `ExcludeListDialog`：
   标题 key `settings.inlay.parameter.hints.exclude.list` = `Parameter Name Hints Exclude List`（properties `:314`）；
   本体是**一个纯文本多行编辑器，一行一条模式**（`:133-144` `EditorTextField(FileTypes.PLAIN_TEXT)`、`Dimension(400,350)`）；
   右上角 `Reset` 链接把文本恢复成 provider 默认清单（`:68-73` + `:94-96`）；
   逐行校验用 `HintUtils.kt:44-53 getExcludeListInvalidLineNumbers`（`MatcherConstructor.createMatcher` 返 null 的行号），
   有非法行就**禁掉 OK** 并把那些行加错误底色（`:98-109`、`:146-155`）；
   保存走 `:117-123` `storeExcludeListDiff`：按行拆、丢空行、`Diff.build(default, updated)` 存 diff、再 `refreshParameterHintsOnNextPass()`。
   另一条真消费方是意图/弹窗：`PopupActions.kt:116-141` `AddToExcludeListCurrentMethodIntention`
   （`ParameterNameHintsSettings.getInstance().addIgnorePattern(getLanguageForSettingKey(language), info.toPattern())` + 通知里可跳设置/撤销 `:320` 文案 `Method ''{0}'' added to exclude list`）。
   注意：本仓 `InlayHintsSettingsPage.vue:20-21` 引的 key 名与行号（`ParameterHintsSettingsPanel.kt:18-22`）经核实**是对的**（`:18` 的 `if (config.isExcludeListSupported)`、`:19` 的 ActionLink、`:20` 的 bundle key）。

5. **「完全关掉参数提示」确实另有一档**（不是排除清单的一部分）：
   `platform/lang-impl/src/com/intellij/codeInsight/hints/HintUtils.kt:72-80`
   `isParameterHintsEnabledForLanguage(language)` = `InlayHintsSettings.instance().hintsShouldBeShown(language)` **且** `ParameterNameHintsSettings.isEnabledForLanguage(getLanguageForSettingKey(language))`；
   写侧 `:82-85 setShowParameterHintsForLanguage`；存储 `ParameterNameHintsSettings.kt:114-124`（`disabledLanguages` 集合，XML 段 `<disabledLanguages><language id="…"/></disabledLanguages>` `:21-23`、`:101-109`）；
   UI 侧入口 `settings/language/ParameterInlayProviderSettingsModel.kt:37-40`（`InlayProviderSettingsModel(isParameterHintsEnabledForLanguage(language), ID, language)`，`ID = "parameter.hints.old"`）。
   ⇒ 本仓这一档**已经存在**（三把 `show*InlayHints` 布尔键 + `shouldShowInlayHint`），不需要新加。

6. **上游 LSP 侧没有排除清单的消费方**：`grep -rn "ParameterHintsExcludeListService|isExcluded" platform/lsp-impl/src/impl` 只命中
   `LspDocumentSyncManager.kt:188` 的 `fileIndex.isExcluded(originFile)`（那是文件索引的 excluded，与提示无关）。
   排除清单只挂在 `InlayParameterHintsProvider`（PSI 侧）与 declarative 的 `ParameterHintsExcludeListConfigProvider.kt:14-27` 上。

7. **中文措辞**：`find -name "CodeInsightBundle_zh*"` 零命中（整树只有 `AgreementsBundle_zh_CN.properties` 与 `UpdaterBundle_zh_CN.properties`）
   ⇒ 本页所有中文文案（含 `Exclude list…`/`Parameter Name Hints Exclude List`/`Do not show hints for current method`）一律进 §5「无法核实」。


### §3.1 注入变异实测（每发都：备份 ⇒ 注入 ⇒ 跑判据 ⇒ 从备份还原 ⇒ sha1 逐字核过）

备份在 `/tmp/tmp.m9UlXGtSBT`、`/tmp/tmp.inlayparams2`（仓外），还原后 `sha1sum` 与注入前**同一个值**，下表「还原」列即该核对结果。

| # | 注入的变异（改的是什么行为） | 命中的判据 | 还原 |
|---|---|---|---|
| M1 | `src/inlayHintLayout.ts`：`{ ++hidden.exclude; continue }` → `{ continue }`（藏了但不计数） | `tests/inlay-hints-exclude-list.test.mjs` **5 条红** | sha1 一致 ✔ |
| M2 | 同文件：去掉组闸 `inlayHintGroup(hint.kind) === 'parameter' &&`（类型提示也被参数清单藏掉） | **5 条红** | sha1 一致 ✔（第一次 `cp` 因文件被外部占用失败，重试后核对通过；当场发现当场补，没留半成品） |
| M3 | `src/inlayHintExcludeList.ts`：`if (stars > 2) return null` → `> 3`（放宽上游的星号上限） | **5 条红** | sha1 一致 ✔ |
| M4 | 同文件：`paramNames.length === globs.length` → `>=`（上游 arity 语义被松掉） | **7 条红** | sha1 一致 ✔ |
| M5 | 同文件：`DEFAULT_PARAMETER_HINT_EXCLUDE_LIST = []` → `["key"]`（自造默认值） | **11 条红** | sha1 一致 ✔ |
| M6 | `src/inlayHints.ts`：比较键的「空清单不追加后缀」那一半改成恒假 | **1 条红**（`读侧：清单从设置键折算进来…` 定点红，其余 11 条仍绿） | sha1 一致 ✔ |
| M7 | 同文件：`readExcludeList` 的类型闸从 `!Array.isArray(value)` 改成 `value === undefined`（坏值穿透） | **3 条红** | sha1 一致 ✔ |
| M8 | `src/components/InlayHintsSettingsPage.vue`：模板里塞一条 `<label class="checkbox-row"><span>排除清单</span></label>`（假控件） | 两个判据文件合跑 **2 条红**（本族那条 + `tests/inlay-hints-settings.test.mjs` 的「页面不渲染无对应物入口」那条） | sha1 一致 ✔ 且 `git status --porcelain` 对该文件**空输出**（回到 HEAD 原样） |

断言没有放松：M1–M8 每一发都是"改坏 ⇒ 红"，且新判据比原族多 12 条用例、`tests/inlay-hints-settings.test.mjs` 两处 `deepEqual` 的期望**变严**（多核一项默认值）。

### §3.2 标记残留核查

`grep -rn "<派单点名的 10 字面量前缀>" src/ tests/ native/ docs/` ⇒ **0 命中**（命令 exit 1）。
本报告不写出那个字面量，否则 `docs/` 自己就是残留（报告里一律写作"前缀"或用拼接）。
撞墙闸复查同时做过：`grep -rn "|| true" src/editorInlayHints.ts` ⇒ **0 命中**（exit 1），
`src/editorInlayHints.ts` mtime 仍是主代理还原那一刻的 `2026-10-06 14:58:29`，本 lane 没碰它。

## §4 门禁原始数字

```
$ ls src/ | grep -i inlay
editorInlayHints.ts   inlayHintLayout.ts   inlayHints.ts          # + 本轮新增 inlayHintExcludeList.ts
$ ls tests/ | grep -iE "^inlay|^hint"
inlay-hint-layout.test.mjs
inlay-hints-exclude-list.test.mjs      # 本轮新增
inlay-hints-settings.test.mjs
inlay-hints.test.mjs
```
派单给的 `tests/hint*.test.mjs` 这一档**零匹配**（`ls tests/ | grep -iE "^hint"` 无输出），shell 把字面量原样交给 node，
node 对它没有任何"Could not find"报错、也没把它算进用例数 ⇒ 报数如下（33 = 本族 28 + module-size 5）。

```
$ node --test tests/inlay*.test.mjs tests/hint*.test.mjs tests/module-size.test.mjs
✖ 已登记的 native 大文件不许继续变大 (3.157ms)
ℹ tests 33
ℹ pass 32
ℹ fail 1
  # 唯一那条红 = `native/history.cpp 现在 935 行 > 上限 910`，
  # 该文件 mtime 2026-10-06 17:19:44（本 lane 正在跑时被别的 lane 改的；本 lane 零 native 改动）⇒ 在飞红，只记录不修。

$ node --test tests/inlay-hints.test.mjs tests/inlay-hint-layout.test.mjs tests/inlay-hints-settings.test.mjs tests/inlay-hints-exclude-list.test.mjs
ℹ tests 28
ℹ pass 28
ℹ fail 0
```

```
$ node .tools/find-orphan-modules.mjs --gate
门禁红：1 个**新增**零生产消费方模块。
  ✘ 新增零生产消费方模块：src/components/CodeActionPopup.vue        # codeactionpopup 路在飞（mtime 17:21:40），不是本 lane
门禁：已登记孤儿 6 / 基线 8 · 新增 1 · 本轮清掉 2
词法自检：0 异常
  # 本 lane 的新模块 `src/inlayHintExcludeList.ts` **不在孤儿名单里**（被 `src/inlayHints.ts` 真 import）。

$ node .tools/find-missing-ext.mjs
扫描 1388 个文件（src + tests）里的 from / 副作用 / 动态 三种 import 形态
干净：没有漏扩展名、且静态也解析不到的相对 import。

$ node .tools/find-param-props.mjs
共 0 处参数属性（每个都会让引用它的 node --test 用例加载失败）

$ npx tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler \
      --allowImportingTsExtensions --verbatimModuleSyntax --skipLibCheck --lib ES2022,DOM,DOM.Iterable \
      src/inlayHintExcludeList.ts src/inlayHints.ts src/inlayHintLayout.ts src/editorInlayHints.ts
（无输出）tsc exit=0
  # 隔离 tsconfig 口径：并发期全仓 `npx vue-tsc -b` 的"0 错"不可作证据（按派单），故逐文件面单查。

$ for f in src/inlayHintExcludeList.ts src/inlayHints.ts src/inlayHintLayout.ts src/editorInlayHints.ts; do node -e "import('./$f')…"; done
OK  src/inlayHintExcludeList.ts -> 10 exports
OK  src/inlayHints.ts -> 10 exports
OK  src/inlayHintLayout.ts -> 5 exports
OK  src/editorInlayHints.ts -> 4 exports
  # 第 7 种半截形态（单测全绿但模块加载就抛）逐模块自证过。

$ node --test tests/source-citations.test.mjs
ℹ tests 3 / ℹ pass 3 / ℹ fail 0            # 本轮新增的上游引用全部指得到（路径 + 行号都在参考树里）
$ node --test tests/source-citation-anchors.test.mjs
锚点核对：快照 4293 条 / 仓里活引用 4300 条 / 未入快照 7 条 / 区间为空 1 条
ℹ tests 8 / ℹ pass 8 / ℹ fail 0            # 未入快照那 7 条是 native/history.hpp 与 foldcheck/histdays 两篇文档的，不是本 lane
```

## §5 无法核实 / 口径差（登记，不假装）

1. **中文措辞一律无法核实**：参考树里没有 `CodeInsightBundle_zh*`（全树 zh 本地化只有 `AgreementsBundle_zh_CN.properties`
   与 `UpdaterBundle_zh_CN.properties`）⇒ 上游那一格的英文原文是
   `settings.inlay.java.exclude.list=Exclude list…`、`settings.inlay.parameter.hints.exclude.list=Parameter Name Hints Exclude List`、
   `inlay.hints.exclude.list.method=Do not show hints for current method`、
   `inlay.hints.show.settings=Disable Hints for Method ''{0}''`、
   `notification.inlay.method.added.to.exclude.list=Method ''{0}'' added to exclude list`（`platform/lang-api/resources/messages/CodeInsightBundle.properties:224-321`）；
   本仓若将来落这一格，中文怎么写**没有上游依据可抄**。
2. **arity（多参数模式）在本仓恒不匹配**：上游 `(begin*, end*)` 这类要求"这次调用正好两个参数"
   （`MethodMatcher.kt:33-43`）；LSP 每条提示独立、服务端不给 arity，本仓也**不打算**用"同一行相邻提示"去猜调用
   （猜出来的 arity 会把两次调用的参数拼成一次，比不匹配更坏）⇒ 该形态被解析、被接受入库（与上游一样不报错），但在本仓不会命中。
   判据 `清单为空 / 缺项 ⇒ 这一档完全不影响旧行为` 与 `模式解析…` 两条钉住的是"解析正确"，没有假装命中。
3. **方法 FQN 档在本仓不存在**：上游主题是 `java.util.Map.put` 这种 FQN；LSP `textDocument/inlayHint` 的条目只有
   `label / paddingLeft / paddingRight / kind / tooltip / command`（宿主转发面见 `native/lsp_session_kinds.cpp:552-594`）⇒
   本仓把同一条 glob 同时套在方法名位与参数名位（`compileExcludePatterns`）。这是**口径差**，不是上游的等价实现：
   `*.get(*)` 这类在前缀带 `.` 的写法在本仓命中的是"label 以 `.get(` 之类结尾"，与上游不同；要还原 FQN 就得先有 PSI/语义调用信息，本仓没有那一层。
4. **上游默认排除清单没有可映射的条目**：`JavaInlayParameterHintsProvider.kt:67-…` 与 `KtParameterHintsProvider.kt:449-…`
   的条目全部是方法名形态或 arity-2 参数形态（见上两条）⇒ 出厂默认取空（`DEFAULT_PARAMETER_HINT_EXCLUDE_LIST`），
   判据 `出厂默认清单是空的，且这一条要**明说**` 把"为什么是空"钉在断言消息里。
5. **"按语言分组的清单"这一层本仓没有**：上游的排除清单按 `language.displayName` 分槽
   （`ParameterNameHintsSettings.kt:177-197`），还有 `blackListDependencyLanguage`（Kotlin 依赖 Java 那份）
   （`ParameterHintExcludeListService.kt:151-161`）⇒ 本仓只有一个 provider（LSP），折成**一把全局清单**，不做按语言档（做了就是没有消费方的空壳）。
6. **上游 LSP 侧没有这条链的先例**（§1.6）⇒ "排除清单该不该作用在 LSP 来源的提示上"在 JetBrains 代码里找不到直接答案，
   本仓的选择（作用在 `kind = 2` 那一组）是按上游"这份清单管的是 parameter hints"的语义推的，**登记为推得**。

## §6 接线请求（本 lane 禁写的面；主代理一条接完就全亮）

**唯一缺的一件**：把清单键 `parameterHintExcludeList`（字符串数组）登记成"真设置"。读侧与消费侧**已经就绪**，
`src/inlayHints.ts` 的 `INLAY_HINT_EXCLUDE_LIST_SETTING_KEY` 是键名唯一定义处；键一登记，界面上写回的值就会：
① 被 `inlayHintToggles()` 读进 `parameterHintExcludeList`；② 在 `layoutInlayHints()` 里过滤（只作用 `kind = 2`）；
③ 改变 `inlayHintTogglesKey()` ⇒ `src/components/CodeEditor.vue:1054` 那条**既有** watch 立刻重画（上游同款语义 =
`ExcludeListPanel.kt:122` 存完差量就 `refreshParameterHintsOnNextPass()`）—— **两个冻结文件都不用改**（`CodeEditor.vue`、`App.vue`、`bridge.ts` 零改动）。

需要落的六处（都在别人的文件面，按 `codeVisionDisabledGroups` 这把**同类数组键**的现成范式抄，逐处坐标即该键的登记位置）：

| # | 文件 | 落什么 | 现成范式（同一个数组键的登记处） |
|---|---|---|---|
| 1 | `src/settingsModel.ts` | `EditorSettings` 加 `parameterHintExcludeList: string[]` | `:489` `codeVisionDisabledGroups: string[];` |
| 2 | `src/settingsModel.ts` | `defaultEditorSettings` 加默认 `parameterHintExcludeList: []`（**缺键补默认，不许按键数判损坏**） | `:265` 同一行里的 `codeVisionDisabledGroups: []` |
| 3 | `native/settings_schema.hpp` | `EDITOR_SETTING_KEYS[]` 加该键（漏了 ⇒ `validate_editor_patch` 的 `known_keys` 拒掉整次 `settings.update`，且 `prune_unknown` 把它从盘上剪掉） | `:104` `"codeVisionDisabledGroups"` |
| 4 | `native/settings_schema.cpp` | `editor_defaults_impl()` 加 `{"parameterHintExcludeList", Json::array()}` | `:416` `{"codeVisionDisabledGroups", Json::array()}` |
| 5 | `native/settings_editor_keys.hpp` | 数组档校验（条目是字符串、条数/长度上限，照 `codeVisionDisabledGroups` 那一支写） | `:89` `if (key == "codeVisionDisabledGroups" \|\| key == "codeVisionEnabledGroups")` |
| 6 | `src/previewSettings.ts` | accepted 白名单 + 数组档校验（浏览器态与桌面态同一口径） | `:47` / `:86` 那两处 |
| 附 | `native/settings_editor_keys_test.cpp` | 该键的正反两例（合法数组收、超限/坏条目拒） | `:61`、`:73`、`:105` 那三处同款 |

**键落地之后才做的事**（本 lane 故意没做，做了就是假控件）：
`src/components/InlayHintsSettingsPage.vue` 里那一格 —— 形状按上游：多行文本框、一行一条模式
（`ExcludeListPanel.kt:133-144`）、坏行标红并禁「确定」（`:98-109` + `HintUtils.kt:44-53` ⇒ 本仓现成口
`invalidExcludePatternLines`）、"Reset" 把文本换回默认清单（`:68-73`/`:94-96` ⇒ 现成口 `DEFAULT_PARAMETER_HINT_EXCLUDE_LIST` +
`renderExcludeListText`）、保存走差量而非全量（`:117-123` ⇒ 现成口 `buildExcludeListDiff`/`parseExcludeListText`）。
文案中文措辞见 §5.1（无法核实）。判据 `消费链与"不放假控件"` 那一条现在钉的是"页面不放"，键与页面一起落地时要把它改成
"页面放了、绑的是那把真键、且写回的键名来自 `INLAY_HINT_EXCLUDE_LIST_SETTING_KEY`"（同一条判据里的三格复选框那两句就是范式），
不是把这条删掉。

**再往后的两档**（判词"真缺"的另两条，超出本 lane 的"只做一件事"，登记不动手）：
插件 EP 宿主 / declarative hints（`FactoryInlayHintsCollector`/`HintsBuffer`/`InlayTags`，见 `restsix` §2.5 第 6、7 行）；
上游"点提示 ⇒ Do not show hints for current method"那条意图（`PopupActions.kt:116-141` + `addIgnorePattern`）——
它需要"这条提示属于哪个方法"的信息，即 §5.3 那条口径差补平之后才有意义。


| 文件 | 状态 | 净行数（`git diff --numstat` / `wc -l`） | 内容 |
|---|---|---|---|
| `src/inlayHintExcludeList.ts` | **新增**（未跟踪） | 197 行 | 排除清单的纯规则本体：`createExcludeGlob`（上游 `StringMatcherBuilder.kt:28-61` 逐字对应，含「星号 >2 或位置不合法 ⇒ 整条作废」）、`createExcludePatternMatcher`（上游 `MethodMatcher.kt:53-106`：最后一个 `(` 切两半、`(…)` 开头 ⇒ 方法侧恒真、arity 必须相等）、`invalidExcludePatternLines`（`HintUtils.kt:44-53`）、`buildExcludeListDiff`/`applyExcludeListDiff`（`ParameterNameHintsSettings.kt:26-45`）、`parseExcludeListText`/`renderExcludeListText`（`ExcludeListPanel.kt:118`/`:95`）、`normalizeParameterHintLabel`、`compileExcludePatterns`（对应 `getMatchers` 的「编译一次 + 坏条目静默丢」）、`DEFAULT_PARAMETER_HINT_EXCLUDE_LIST = []`（默认清单为何取空写在常量注释里） |
| `src/inlayHints.ts` | 改 | +55 / −8 | ① 头注释里那条**假坐标**订正：原判「宿主把 tooltip/command 丢了、转发在 `native/lsp_session.cpp`」⇒ 实为 `native/lsp_session_kinds.cpp:578-586`（command）/`:588-594`（tooltip），本文件 `:97`/`:104` 就是消费点（本轮实测该行号区间，与 `restsix` 的订正一致）；② `InlayHintToggles` 多一个**可选**字段 `parameterHintExcludeList`（不是加宽：缺省 = 不排除，见判据「老调用点没传清单 ⇒ 行为不变」）；③ `INLAY_HINT_EXCLUDE_LIST_SETTING_KEY`（键名唯一定义处）+ `InlayHintSettingSource` 的窄读口 + `readExcludeList`（非数组整个忽略、非字符串/空串丢掉、缺键按默认）；④ `inlayHintTogglesKey` 把清单并进比较键（上游 `ExcludeListPanel.kt:122` 存完就刷新 ⇒ 本仓改清单也要即时重画），**空清单不追加后缀**，老 state 不会每拍重画 |
| `src/inlayHintLayout.ts` | 改 | +14 / −5 | 过滤链里多一档（`:71` 那一行之后）：`if (inlayHintGroup(hint.kind) === 'parameter' && excluded(hint.label)) { ++hidden.exclude; continue }`；`hidden` 多 `exclude` 计数、`hiddenInlayCount` 把它算进去；清单在归位入口 `compileExcludePatterns` 编译一次（对齐上游的缓存口径）；头注释的链条改成「开关 → 排除清单 → 排序 → 去重 → 优先级 → 行内上限」 |
| `tests/inlay-hints-exclude-list.test.mjs` | **新增**（未跟踪） | 176 行 / 12 条用例 | 见 §3 |
| `tests/inlay-hints-settings.test.mjs` | 改 | +20 / −5 | 两处 `deepEqual(inlayHintToggles(…))` 的期望**变严**（多核一项 `parameterHintExcludeList: []`，即「缺键 ⇒ 默认不排除」），断言数量只增不减 |
| `src/editorInlayHints.ts` | **未动** | 0 | `paint()` 已经是 `layoutInlayHints(…, toggles, …)`，清单顺着同一个 `toggles` 落进渲染前那一档 ⇒ 不需要改这个文件（它是今天刚被主代理还原的撞墙 lane 现场，能不动就不动） |
| `src/components/InlayHintsSettingsPage.vue` | **未动** | 0 | 不放排除控件：那把键还没进 `src/settingsModel.ts` + native 键表（六处成对，本 lane 禁写那些文件）⇒ 放上就是「写了不记账、重启就没」的假控件；原因已经在页面注释 `:20-21` 里，判据把它钉住（§3 第 12 条） |

派单给的三个落点核实结果：`src/inlayHints.ts` 在（对）；`src/inlayHintLayout.ts:71` 就是 `shouldShowInlayHint` 那一行（对，本轮就在它后面加一档）；`src/components/InlayHintsSettingsPage.vue` 在、65 行有余量，但**本轮没动它**（理由见上表最后一行）。

## §3 判据与反向验证

判据文件：`tests/inlay-hints-exclude-list.test.mjs`（12 条，全部对上 §1 的上游行号）：
1 glob 文法逐条（含 `a*b` ⇒ null、`**` ⇒ 恒真、`a*b*c` ⇒ null）；2 模式解析（括号切分 / arity / 五种坏模式全 null）；
3 坏行号口径；4 差量存储（改回原样 ⇒ 差量为空，不写全量）；5 文本 ⇄ 数组；6 默认清单为空且**写明原因**；
7 label 主题化（只剥尾部一个分隔符、大小写敏感）；8 编译后判定（坏模式静默丢 / 非字符串忽略 / 空清单恒假 / 空文本不匹配）；
9 归位链那一档只藏参数组，`hidden.exclude` 与 `hiddenInlayCount` 都算数；10 清单缺项 ⇒ 旧行为一字不变；
11 读侧折算 + 比较键（空清单不追加后缀、改清单必变键）；12 消费链与「不放假控件」（过滤位置正则钉死、编辑器那一拍仍带 toggles、页面仍不渲染 `排除` 且注释里要有上游坐标）。

反向验证（注入变异 ⇒ 打红 ⇒ 原样还原 ⇒ sha1 核过）：见本节末尾的实测表（§3.1）。
残留核查：本 lane 的临时标记字面量（派单点名的那个前缀，报告里不写出以免 `docs/` 自己命中）在收尾时
`grep -rn` 四个面必须 **0 命中** —— 实测见 §3.2。


## §4 门禁原始数字

待填（贴原始输出）。

## §5 无法核实

待填。

## §6 接线请求（禁写文件的成对键）

待填：`src/settingsModel.ts` + `native/settings_schema.cpp/hpp` + `native/settings_editor_keys.hpp`（本 lane 禁写）。
