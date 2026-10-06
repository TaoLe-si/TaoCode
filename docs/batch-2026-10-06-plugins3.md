# 批次 · 2026-10-06 · 插件域收尾（代号 `plugins3`，族 `pf/plugins` / `ic/plugins`）

上一轮（`docs/batch-2026-10-06-plugins.md`）交付了 `src/` 侧实现 + 一份接线请求，但门禁没跑完。
本轮做三件事：**①逐条核对两份请求文档并给出可粘贴的 old/new**、**②补判词里仍然可做的模块侧缺项（搜索框的属性词建议浮层）**、
**③把 §5 的全部门禁跑完**。上游坐标全部亲手打开核过，路径 `D:\Backup\Downloads\intellij-community-master\intellij-community-master`。

可改面（派单写的）：`src/plugin*.ts`、`src/components/{PluginDialog,PluginMarketPanel}.vue`、`tests/plugin-*`、
以及两份请求文档本身（`docs/wiring-requests-2026-10-06-*.md` 不在保留清单里）。
保留文件一个没动：`src/App.vue`、`src/bridge.ts`、`src/style.css`、`src/tokens.css`、`CMakeLists.txt`、
`scripts/verdict_table.py`、`docs/inventory/*.md`；本轮也**没有**改 `src/projectExtras.ts`、`src/settingsModel.ts`、
`native/main.cpp`、`native/settings_schema.cpp`、`index.html`（上一轮把它们当保留文件处理，本轮继续只写请求）。

---

## 1. 请求文档核对（派单任务 1）

### 1.1 两份文档只有一份存在

| 派单点名的文件 | 实际 |
|---|---|
| `docs/wiring-requests-2026-10-06-plugins.md` | 存在（130 行，P-1…P-4）→ 本轮逐条核对并重写为 298 行 |
| `docs/wiring-requests-2026-10-06-pluginsearch.md` | **不存在**。`ls docs/ | grep -i plugin` 只有 `-plugins.md` 与 `batch-…-plugins.md`；`grep -ril pluginsearch docs/` 命中的是 `PluginSearchResult.kt` 这类上游类名和 `src/pluginMarket.ts`，不是请求文档 |

⇒ 派单里的第二份文档**无法核对**（记进 §6）。与「插件搜索」有关的请求实际就是 `-plugins.md` 的 P-1/P-3/P-4 三条，
本轮把其中**模块侧能做的那一条直接做掉了**（§2 的搜索建议浮层），剩下的仍是宿主/安全决策。

### 1.2 P-1…P-4 逐条判定：**四条全部未闭环**（没有一条被后续轮次落地）

| 请求 | 判定 | 核对方式（本轮亲手） |
|---|---|---|
| P-1 宿主侧「打开插件页并定位到某个插件」入口 | **未闭环** | `src/projectExtras.ts` 全文 grep `focusPlugin|pluginFocusId|openPluginsAndSelect` ⇒ **0 命中**；`src/App.vue` 的 `<PluginDialog …>` 挂载行（本轮抓在 `:2532-2533`）没有 `:focus-plugin`。接收侧仍在：`src/components/PluginDialog.vue:67`（prop）、`:292`（`focusInstalledPlugin`）、`:304`（`watch`） |
| P-2 市场页仓库目录成为持久键 `pluginMarketRoot` | **未闭环** | `grep -rn pluginMarketRoot src/settingsModel.ts native/settings_schema.cpp src/App.vue src/components/PluginMarketPanel.vue src/pluginMarket.ts` ⇒ **0 命中**；面板仍是一次性状态 `src/components/PluginMarketPanel.vue:80` |
| P-3 bundled 层需要第二个插件目录 | **未闭环** | `native/main.cpp:1416-1417` 仍是 `case "plugin.list"_h … case "plugin.uninstall"_h: { const fs::path directory = profile / L"plugins";`；`bundled` 在 `native/plugins.{hpp,cpp}` 与 `src/plugin*` 里只出现在注释/说明行（如 `src/pluginGroups.ts:119`），JSON 无该字段 |
| P-4 远程仓库三条通道（网络 / CSP / 验签） | **未闭环，维持「要主代理拍板」** | `index.html:6` 的 CSP 仍是 `connect-src 'self' ws://127.0.0.1:5173`；`src/bridge.ts:109` 的 `Method` union 里与外网有关的仍只有 `'shell.openUrl'` |

没有任何一条可以标「已闭环」⇒ 按要求**把四条全部改写成可直接粘贴的 old/new**（锚点取自当前文件原文），
并留痕订正了 3 处上一轮写错的地方：

1. **P-2 的新事件**：原文要新造 `emit('refresh')`。实际 `src/components/PluginMarketPanel.vue:68` 早有 `(event: 'changed'): void`、
   `:272` 装完就 `emit('changed')`、`src/components/PluginDialog.vue:540` 已经 `@changed="emit('refresh')"`
   ⇒ 宿主重取列表的通道**早就接通**，改仓库根应当复用 `changed`，不再新造事件。
2. **P-1 的「第一个真实调用方」**：原文说 `src/pluginCommands.ts` 在动作 id 找不到时「只是丢掉那一行」。
   实际该文件 `:75-77` 的注释与 `:94` 的 `enabled: () => hooks.hasAction!(...)` 说明是**整行置灰**、不是丢掉 ⇒ 理由重写。
3. **P-2 第 4/5 步的 App.vue 入口**：原文写 `setGeneralSetting(...)` / `saveSettingsPatch` —— 两个名字在 `src/App.vue` 里
   **都不存在**；真实的写回形状是 `src/App.vue:483` 的 `generalSettings` ref + `:603-613` 的 `deleteToBin`
   （`computed({get,set})` + `request('settings.general.update', { general })` + 失败回滚），本轮按它重写了可粘贴代码。
4. **P-1 的上游调用方路径**（引用门当场抓出来的，见 §3）：原文写 `.../com/intellij/ide/plugins/newui/PluginAdvertiserEditorNotificationProvider.kt:196`，
   参考树里没有该路径；`find` 只出 `platform/platform-impl/src/com/intellij/openapi/updateSettings/impl/pluginsAdvertisement/PluginAdvertiserEditorNotificationProvider.kt`，
   其 `:196` 逐字是 `PluginManagerConfigurable.showPluginConfigurableAndEnable(project, setOf(installedPlugin))` ⇒ 已按真路径改正。
5. **本轮一度起草的 P-5**（「在资源管理器里打开已装插件目录」）：**自查后撤销** ——
   `find` 全树没有 `PluginsConfigurableWrapper*` 也没有 `PluginModelActions*`，
   `grep -rln "OpenPluginDirectory|openPluginDirectory|getPluginDirectory" platform/` 三种拼法各 0 命中，
   `grep -rn "openDir(" platform/platform-impl/src/com/intellij/ide/plugins/` 0 命中 ⇒ 上游指不到就不写请求，
   撤销理由留在文档里（P-5 段落）以免后人重犯。

---

## 2. 判词里「仍然可做」的模块侧缺项（派单任务 2）

上一轮 §1 A 表里还挂着 `[ ]` 的四项，按「本仓能不能做」重分类：

| 缺项 | 上游 | 本轮判定 | 落点 |
|---|---|---|---|
| 搜索建议弹窗（打 `/` 出属性词表 + 上下键浮层） | `platform/platform-impl/src/com/intellij/ide/plugins/newui/SearchPopupController.java:40-284`、`newui/PluginsTab.kt:118-125,144-153,162-184,190-193,217-236`、`InstalledPluginsTab.kt:404-435`、`MarketplacePluginsTab.kt:377-408`、`newui/SearchQueryParser.kt:259-262` | **可做 → 本轮做完** | `src/pluginSearchSuggest.ts`（331 行，纯规则）；已安装页 `src/components/PluginDialog.vue:124-196`（脚本）+ `:399`（输入框四个入口）+ `:409-413`（浮层）+ `:560-562`（样式）；市场页 `src/components/PluginMarketPanel.vue:139-196` + `:327` + `:332-336` + `:414-416`；判据 `tests/plugin-search-suggest.test.mjs` |
| `/bundled`、`/updatedBundled` 的可点档位 | `newui/PluginUiModel.kt:34,146`；消费点 `InstalledPluginsTabSearchResultPanel.kt:133-145` | 模块侧**已尽力**：词表按数据条件裁掉，裁的理由与上游同类机制写进代码；宿主只有一个插件目录 | `src/pluginSearchSuggest.ts` 文件头 + `src/pluginGroups.ts:431,448` ⇒ 请求 P-3 |
| `/updatesFrom:` 更新源过滤 | `InstalledPluginsTab.kt:415-417`（上游自己就是 `isPluginUpdateSourceVisibleInUI()` 条件项） | 解析有、过滤无（更新源来自 marketplace） | 维持 `[~]` ⇒ 请求 P-4 |
| 远程市场（在线搜索/下载/评分） | `marketplace/PluginSignatureVerifier.kt:19-25`、`auth/PluginRepositoryAuthService.kt:17-26` | 三条通道都不在，属安全决策 | 维持 `[ ]` ⇒ 请求 P-4 |

### 2.1 本轮实现的规则（逐条对着上游行号搬）

- 弹不弹由**光标**决定（`SearchPopupController.java:45-54`）：光标在词中间、或文本以空格结尾 ⇒ 走搜索面板那支。
- 光标前那一段先遇 `:` 算「正在输入取值」、先遇空格算「正在输入词名」（`:70-100`）。
- 前缀筛词（`:184-210`）：空白前缀不过滤；前缀与某个词**完全相等**时收起浮层；忽略大小写前缀留删；筛空退回搜索面板。
- 选中词名 ⇒ 接着开它的取值表（`:117-119`）；取值集合为空 ⇒ 不弹（`:125-129`）；选中取值 ⇒ 走
  `SearchQueryParser.wrapAttribute`（`:259-262`，含空格/逗号/冒号才包双引号）并收起浮层（`:144-145`）。
- 接收选中项 = 替换光标前那段前缀、光标后的残留原样接回、光标落回插入段之后（`:234-259`），
  且前缀只在候选确实以它开头（含「用户已打引号」那种）时才删（`:251-253`）。
- 上下键：第一次 Down 选中第 0 项（`:275-277`），浮层没开时**不拦**方向键（`SearchUpDownPopupController.java:31-38`）；
  Enter 有选中项交给浮层、否则收浮层并按当前文本搜（`:261-268` + `PluginsTab.kt:145-150`）；
  Esc 先收浮层、浮层没开才清文本（`PluginsTab.kt:162-184`）；Ctrl+Space 空文本给整张词表、浮层已开时不再开（`:118-125,190-193`）。
- 取值集合的形状照上游：已安装页厂商 = 计数多的在前、同数按名字**忽略大小写倒序**，且该比较器把「同数、只差大小写」
  的两种写法当同一个元素（`newui/MyPluginModel.kt:838-849` + `:1336-1345`）；市场页标签 = HashSet 精确去重后
  `String.CASE_INSENSITIVE_ORDER` 排（`MarketplacePluginsTab.kt:504-527`）；市场页厂商 = `LinkedHashSet` 不排序（`:483-502`）。
- `/sortBy:` 的取值表是**四条**（`MarketplacePluginsTab.kt:398-403`），不含 `relevance`（枚举有五条，
  `MarketplaceTabSearchSortByOptions.kt:11-15`）—— 钉死在判据里。
- 上游搜索是防抖的（`InstalledPluginsTab.kt:73` 100ms、`MarketplacePluginsTab.kt:81` 250ms）；本仓词表与取值都在内存里，直接算。

### 2.2 没有放假控件

浮层的词表与取值表只列**本仓真有数据**的那几条；上游本身就是按数据条件加项的
（`InstalledPluginsTab.kt:415-417`、`MarketplacePluginsTab.kt:383-390`），所以这不是我自作主张：
没有 bundled 层 ⇒ 词表不含 `/bundled`、`/updatedBundled`；已安装页没有标签/更新源数据 ⇒ 不含 `/tag:`、`/updatesFrom:`；
没有自定义远端仓库 ⇒ 市场页不含 `/repository:`、`/staffPicks`、`/suggested`、`/internal`。
判据第 1 条（`tests/plugin-search-suggest.test.mjs` 的「词表」那节）把这两件事钉住，并显式断言
`INSTALLED_SUGGEST_WORDS` 里不出现 `bundled`、市场页不出现那四个远端词。

---

## 3. 门禁与自查（派单任务 3；命令名逐条，数字是原始输出）

### 3.1 `node --test tests/plugin-search-suggest.test.mjs`（本轮新增的判据）

收工前最后一次（`tests/plugin-*.test.mjs tests/ext-plugin-file-types.test.mjs` 全插件域）：

```
ℹ tests 106
ℹ suites 0
ℹ pass 106
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

上一轮基线是 95/95 ⇒ 本轮 +11 条，**既有断言一条没改**（`deepEqual`/`match` 没降级、数字下限没调）。
新判据 11 节：词表两页各一条、`parseAttributeInQuery`、光标早退、前缀筛词、完整建议状态、
`wrapAttribute`、`appendSearchText`、三张取值集合形状、上下键钳位、按键分派、两页接线（读 `.vue` 原文）。

### 3.2 `npx vue-tsc -b --force` ⇒ 2 错，**插件域 0 错**

```
src/lspProgress.ts(253,41): error TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'.
src/refactorPreview.ts(207,7): error TS2322: Type '"file" | "class" | "method" | "directory"' is not assignable to type '"file" | "directory"'.
```
两条都在别人的在途文件里（本轮开始时全量是 **7 条**：另 5 条是
`editorSemanticField.ts` / `runInstances.ts` / `usageViewGrouping.ts`×2 等，收工前已被各自代理修掉）。
`grep -i plugin` 的输出是空 ⇒ 本域（`src/pluginSearchSuggest.ts`、两个 `.vue`、`src/plugin*.ts`）**零错**。

### 3.3 `node --test tests/module-size.test.mjs` ⇒ 5/5 绿

```
ℹ tests 5
ℹ pass 5
ℹ fail 0
```
中途出现过一次红，**不是本域**：`actual: [ 'src/components/ProblemsPanel.vue(903 行)' ]`（problems 域在途，上限 900）。
本域最大文件 `src/components/PluginDialog.vue` **619 / 900**；新模块 `src/pluginSearchSuggest.ts` **331 行**。
上限一个没动、没登记任何豁免。

### 3.4 `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` ⇒ 11 tests / 8 pass / **3 fail**，本域 0 条

坏引用逐条归属（`grep` 复算，**没有一条来自本域文件**）：
`docs/batch-2026-10-06-ptree3.md`、`docs/batch-2026-10-06-status2defect.md`、`docs/batch-2026-10-06-welcome2.md`、
`docs/wiring-requests-2026-10-06-vcs2.md` 指向参考树里不存在的
`platform/lang-api/src/com/intellij/psi/util/PsiUtil.java`、
`platform/analysis-api/src/com/intellij/codeInsight/SuppressIntentionAction.java`、
`platform/structure-view-impl/src/com/intellij/ide/structureView/StructureViewFactoryImpl.java`、
`platform/editor-ui-api/src/com/intellij/openapi/editor/settings/EditorSettingsExternalizable.java`。
锚点门另有 3 条「moved」漂移：`docs/batch-2026-10-06-bucket14b.md`、`docs/settings-parity.md`、`src/trustedProjects.ts`（都不是本域）。

**本域自己踩到的一条已经修掉**：我把 P-1 的上游调用方写成 `.../ide/plugins/newui/PluginAdvertiserEditorNotificationProvider.kt:196`
⇒ 门红 ⇒ 用 `find` 找到真路径（`.../openapi/updateSettings/impl/pluginsAdvertisement/…`）并改写 ⇒ 复绿。
本域新文档里对不存在文件的批评**一律不带行号、也不写成完整路径**（规约 §5 的那条坑）。

### 3.5 `node .tools/find-orphan-modules.mjs --gate` ⇒ 绿

```
门禁：已登记孤儿 9 / 基线 9 · 新增 0 · 本轮清掉 0
门禁绿：没有基线之外的新增零消费方模块。
```
9 条基线孤儿逐个列出后**没有一条属于插件域**（`src/agent.ts`、`src/components/ColorSchemeSettingsPage.vue`、
`src/dragAndDropTargets.ts`、`src/generalSettingsLocal.ts`、`src/ideShellCreateTarget.ts`、`src/jarRun.ts`、
`src/popupLiveUpdate.ts`、`src/runAnythingContext.ts`、`src/scratchHistory.ts`）
⇒ **本域没有孤儿模块可删**（别人的孤儿不在我的可改面，按规约不代拆）。
`src/main.ts` 是工具自带的合法例外（应用入口）。

### 3.6 三个语法工具

```
node .tools/find-param-props.mjs   ⇒ 共 0 处参数属性（每个都会让引用它的 node --test 用例加载失败）
node .tools/find-ts-in-mjs.mjs     ⇒ 干净：tests/*.mjs 全部是纯 JavaScript。
node .tools/find-missing-ext.mjs   ⇒ 扫描 1302 个文件（src + tests）里的 from / 副作用 / 动态 三种 import 形态
                                     干净：没有漏扩展名、且静态也解析不到的相对 import。
```
本轮 `.ts` 里一律用 `//` 行注释（新模块文件头就是行注释），值 import 全带 `.ts` 扩展名（`./pluginGroups.ts`、`./pluginMarket.ts`）。

### 3.7 本轮**没有**跑 ctest

`native/plugins.cpp`、`native/plugins.hpp`、`native/plugins_test.cpp` 本轮**一行未改**（`git status` 显示的 M 是上一轮 vendor 解析留下的在途状态）。
⇒ 按规约「改了 native 才跑 ctest」，本轮无 native 改动，不重跑；上一轮 `plugin_management` 的 Passed 仍成立。

---

## 4. 反向验证（注入 ⇒ 变红 ⇒ 撤掉 ⇒ 复绿，三步数字）

注入文件都用 `cp` 备份到 `build/`（gitignore），撤换也用 `cp` 还原，**没有用任何 git checkout/reset/stash**。

| 轮 | 注入了什么 | 变红 | 撤掉后 |
|---|---|---|---|
| 1 | `src/pluginSearchSuggest.ts` 两处一起：① `showsAttributesAtCaret` 改成无条件 `return true`（拆掉 `SearchPopupController.java:45-54` 的光标早退）；② `INSTALLED_SUGGEST_WORDS` 里加进 `/bundled`（假控件） | `tests/plugin-search-suggest.test.mjs`：**2 红 / 11**（`ℹ tests 11 / pass 9 / fail 2`）——红的是「词表：两条页各按上游顺序…」（被 ② 抓到）与「光标决定弹不弹…」（被 ① 抓到） | `cp build/pluginSearchSuggest.ts.bak` 还原 ⇒ **11/11** |
| 2 | `src/components/PluginDialog.vue` 的搜索框删掉 `@keydown="onSearchKeydown"`（浮层打不开） | 全插件域 **1 红 / 106**（`ℹ tests 106 / pass 105 / fail 1`）：「接线：两页的搜索框都挂着建议浮层…」 | `cp build/PluginDialog.vue.bak` 还原 ⇒ **106/106** |

另外记一笔**判据自己先红的那三轮**（不是注入，是写判据时把形状钉错，代码没错）：
`/enabled ` 光标停在空格前的分支、`appendSearchText` 的光标算术、厂商集合的塌陷模型 ——
第一次运行是 **3 红 / 11**。前两处的修法是把断言改成**上游代码算出来的值**（逐格手算 `:234-259` 与 `:70-100`）；
第三处**没有放松断言**，而是改实现：`installedVendorValues` 原来对「只差大小写的两个厂商」一律去重，
照 `newui/MyPluginModel.kt:842-846` 的 `TreeSet` 比较器，**只有计数相同**时才会塌陷 ⇒ 改成同数才塌，
于是 `[{vendor:'Beta'},{vendor:'Beta'},{vendor:'BETA'}]` 的上游结果是 `['Beta','BETA']`（两个都留、按计数排），
这条现在钉在判据里。
没有任何一条既有断言被放松（`deepEqual` 仍是 `deepEqual`，数字下限一个没调）。

---

## 5. 改动文件清单（`wc -l` 前后）

| 文件 | 本轮前 | 本轮后 | 改了什么 |
|---|---:|---:|---|
| `src/pluginSearchSuggest.ts` | — | **331（新增）** | 建议浮层的全部纯规则：两张词表、三张取值表、光标解析、前缀筛词、接收、按键分派、`wrapAttribute` |
| `tests/plugin-search-suggest.test.mjs` | — | **245（新增）** | 11 节判据（每条都会因上面任一规则被拆而红） |
| `src/components/PluginDialog.vue` | 520 | 619 | 已安装页搜索框接入浮层（caret/Ctrl+Space/上下键/Enter/Esc/鼠标点选 + `.plugin-suggest` 样式） |
| `src/components/PluginMarketPanel.vue` | 348 | 444 | 市场页搜索框接同一条通道，取值表来自本地清单（tag / sortBy / vendor） |

（两个 `.vue` 的「本轮前」取上一轮报告 `docs/batch-2026-10-06-plugins.md` §2 的口径：520 / 348；
本轮动它们之前没有单独 `wc -l`，「本轮后」619 / 444 是收工时实测。增量 99 / 96 与本轮实际加的行数吻合。）
| `docs/wiring-requests-2026-10-06-plugins.md` | 130 | 298 | 四条请求逐条核对 + 可粘贴 old/new + 5 处留痕订正（含撤销的 P-5） |
| `src/pluginGroups.ts` / `src/pluginMarket.ts` / `src/pluginInfo.ts` / `src/pluginCommands.ts` / `native/plugins*` | — | — | **未改**（本轮只核不做） |

`git diff --stat` 自查：本轮我只动了上面 4 个源文件 + 1 份文档；hunk 全是插件相关，没有顺手重排别人的代码。
**未 commit、未 push、未跑任何 git checkout/reset/stash/clean**。
临时件收工已删：`build/pluginSearchSuggest.ts.bak`、`build/PluginDialog.vue.bak`、`build/plugins3-tsc.txt`、
`build/plugins3-tsc-final.txt`（都在 gitignore 的 `build/` 下，已 `rm`）。

本轮**没有新增**除 `src/pluginSearchSuggest.ts` 以外的模块，且它有两个组件消费者（`grep -rln pluginSearchSuggest src/ tests/ docs/`：
`src/components/PluginDialog.vue`、`src/components/PluginMarketPanel.vue`、`tests/plugin-search-suggest.test.mjs`、
`docs/wiring-requests-2026-10-06-plugins.md`）⇒ 零消费方自查通过。

新模块逐个出口的消费点：

| 出口 | 定义（`src/pluginSearchSuggest.ts`） | 消费方 |
|---|---|---|
| `SEARCH_WORD_VENDOR` / `SEARCH_WORD_TAG` / `SEARCH_WORD_SORT_BY` | `:40` / `:41` / `:42` | `PluginDialog.vue:129`、`PluginMarketPanel.vue:143-145`（取值表按词分派） |
| `INSTALLED_SUGGEST_WORDS` | `:49` | `PluginDialog.vue:136`（`suggestionState` 的词表实参） |
| `MARKETPLACE_SUGGEST_WORDS` | `:52` | `PluginMarketPanel.vue:152` |
| `MARKETPLACE_SORT_BY_VALUES` | `:59` | `PluginMarketPanel.vue:144`（`/sortBy:` 的取值表） |
| `attributeTokenAtCaret` | `:75` | 同文件 `suggestionState`（`:154` 起）内部 + 判据 |
| `showsAttributesAtCaret` | `:106` | 同文件 `suggestionState`（`:154` 起）内部 + 判据 |
| `filterWordsByPrefix` | `:132` | 同文件 `suggestionState`（`:154` 起）内部（词表与取值表各一次）+ 判据 |
| `NO_SUGGESTION` | `:147` | `PluginDialog.vue:159`、`PluginMarketPanel.vue:154`（`activeSuggest`） |
| `suggestionState` | `:154` | `PluginDialog.vue:136`、`PluginMarketPanel.vue:152` |
| `wrapAttributeValue` | `:175` | 同文件 `suggestionKeyAction`（`:244` 起）内部 + 两组件 `acceptSuggestion`（`PluginDialog.vue:178`、`PluginMarketPanel.vue:184`） |
| `applySuggestion` | `:183` | 同文件 `suggestionKeyAction`（`:244` 起）内部 + 两组件 `acceptSuggestion`（`PluginDialog.vue:179`） |
| `moveSuggestion` | `:207` | 同文件 `suggestionKeyAction`（`:244` 起）内部（Up/Down 那一支） |
| `suggestionKeyAction` | `:244` | `PluginDialog.vue:187`、`PluginMarketPanel.vue:192` |
| `installedVendorValues` | `:274` | `PluginDialog.vue:129` |
| `marketplaceTagValues` | `:301` | `PluginMarketPanel.vue:143` |
| `marketplaceVendorValues` | `:314` | `PluginMarketPanel.vue:145` |

---

## 6. 做不到 / 无法核实

| 项 | 具体卡在哪一环 |
|---|---|
| `docs/wiring-requests-2026-10-06-pluginsearch.md` 的逐条核对 | **该文件不存在**（`ls docs/` + 全仓 `grep -ril pluginsearch` 复算，见 §1.1）⇒ 派单点名的第二份文档无从核对 |
| P-1…P-4 的落地 | 四条都卡在保留文件（`src/App.vue`、`src/projectExtras.ts`、`src/settingsModel.ts`、`native/settings_schema.cpp`、`native/main.cpp`、`src/bridge.ts`、`index.html`），本轮**只重写请求、不代改**；可粘贴 old/new 已给到逐字原文 |
| 浮层里放 `/bundled`、`/updatedBundled` | 宿主 `native/main.cpp:1416-1417` 只有一个插件目录 ⇒ `PluginUiModel.kt:34` 的 `isBundled` 无数据来源；放出来就是点不动的假控件。裁掉它的同类机制上游自己就在用（`InstalledPluginsTab.kt:415-417`） |
| 浮层里放已安装页 `/tag:`、`/updatesFrom:` | 上游取值点是 `MyPluginModel.kt:851-860`（`descriptor.calculateTags(sessionId)`）与 `InstalledPluginsTabSearchResultPanel.kt:105-116`（`getPendingPluginUpdateSource`），两者都要市场信息/远端待更新源；本仓已装插件没有这两层数据 |
| 浮层里放市场页 `/repository:`、`/staffPicks`、`/suggested`、`/internal` | `MarketplacePluginsTab.kt:383-390` 上游就是条件项（自定义仓库存在 / 有 view customizer 才加）；本仓没有自定义远端仓库也没有 view customizer EP 宿主 |
| 上下键在**表内**的完整行为 | 上游把 Up/Down 丢给 `JList.dispatchEvent`（`SearchPopupController.java:280`），参考树里看不到「无选中项时按 Up 会选到谁」的结果 ⇒ 本仓实现为**钳位不回绕、无选中项时 Up 不凭空选末尾**，并在代码注释与判据里写明这是本仓选择而非上游证明 |
| 浮层的视觉呈现（弹层定位、滚动、键盘焦点环） | 上游是 `JBPopup`（`newui/SearchPopup.java:73-185` 那一套 `createAndShow` 与 `XOffset`/`ComponentAdapter`），本仓是 DOM 列表：规则与接收逻辑逐条照搬，**呈现层按本仓架构**（贴在搜索框下方的 `.plugin-suggest` / `.market-suggest`），没有照抄 Swing 的像素与偏移 |
| 判词本体（`scripts/verdict_table.py` 里 `pf/plugins` / `ic/plugins` 两段文字） | 保留文件，只读。本轮把「bundled 层引用订正」之外还该写进判词的**新增事实**（搜索建议浮层已落地、词表按数据条件裁剪）整理进本报告与请求文档，请主代理代登 |
| `pf/plugins` 的 265 个类逐类复判 | 没做，也不该由本批做（逐类表是生成物 `docs/inventory/platform_rest_verdict_table.json`）。本轮只复核族判词里的可核实断言与 `ic/plugins` 的 5 个类（上一轮已做，本轮未推翻任何一条） |

---

## 7. 需要主代理接的线

全部在 **`docs/wiring-requests-2026-10-06-plugins.md`**（本轮重写，每条都是可粘贴的「原文 ⇒ 改为」）：

- **P-1** 宿主侧 `pluginFocusId` + `openPluginsAndSelect` + `<PluginDialog :focus-plugin>`（4 段可照抄，`src/projectExtras.ts:34-35`/`:185-187`、`src/App.vue:940`/`:2532-2533`）。
- **P-2** 持久键 `pluginMarketRoot`（`src/settingsModel.ts:111-113`/`:182-184`、`native/settings_schema.cpp:140-141`/`:190-193`，**旧存档缺键补默认、不许判损坏**；
  App.vue 侧按 `:483` + `:603-613` 的真实形状；面板侧不再新造事件，复用 `changed`）。
- **P-3** bundled 层要宿主给第二个插件目录（`native/main.cpp:1416-1417`，两个方案），并同步把 `/bundled`、`/updatedBundled`
  补回筛选按钮与**新增的建议词表**。
- **P-4** 远程仓库三条通道（`index.html:6` CSP、`src/bridge.ts:109` Method union、`PluginSignatureVerifier` 验签）——安全决策，要拍板。

另需主代理知道的三条**不属于本域、收工时仍红**的：
`npx vue-tsc -b --force` 2 错（`src/lspProgress.ts:253`、`src/refactorPreview.ts:207`）；
引用门 3 fail（坏引用/漂移散在 `batch-2026-10-06-ptree3` / `-status2defect` / `-welcome2` / `-vcs2` / `-bucket14b`、
`docs/settings-parity.md`、`src/trustedProjects.ts`，明细见 §3.4）。
孤儿门、三个语法工具、模块尺寸门、全插件域测试收工时都是绿的。
