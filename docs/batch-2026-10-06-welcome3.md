# 批次报告 · 2026-10-06 · welcome3（welcome2 的 R2 / R3 / R5 + trust4 的 T1）

## 0. 一句话

T1 已落；R2 的判定收进**一条模块出口** `src/externalLinkLauncher.ts` 并把不在保留文件里的
**三处**调用点接上（App.vue 那两处只剩 §W1 的四条粘贴行）；R3 的落库、第三个回值与配置目录
**全部在盘**（只差宿主那一个模板属性）；R5 核过成对性（两侧都没有 ⇒ 不是假通道），
新加了一条「半边就红」的门禁，通道请求写在 §W2。

## 1. 判词表

| 族 | 项 | 判定 | 上游相对路径:行号（本轮亲手打开） | 本仓落点 | 一句话说明 |
|---|---|---|---|---|---|
| trust/T1 | `workspaceLifecycle` return 表露 `trustEntries, saveTrustedPaths` | `[x]` 已做 | `platform/platform-impl/src/com/intellij/ide/impl/TrustedPaths.kt:25-28`（R4 口径，未变） | `src/workspaceLifecycle.ts:510` | R2/R3 的前置；该域 7 个测试文件 127 条全绿 |
| browsers/R2 | 「打开外部链接前的那一句」= 一条判定 + 五处出口 | `[~]` 部分 | `platform/platform-api/src/com/intellij/ide/browsers/BrowserLauncherAppless.kt:88-112`；`platform/platform-impl/src/com/intellij/ide/browsers/BrowserLauncherImpl.kt:59-87`（`:60-62` project==null 放行 / `:69-71` 已信任不问 / `:72-81` 三按钮+默认 Open+焦点 Trust / `:83` 答 Open 不写 / `:84` 答 Trust 才 `setProjectTrusted` / `:85` 其它不开） | `src/externalLinkLauncher.ts:70-79`（一条出口）+ `src/workspaceLifecycle.ts:188-193`（装配即 install）+ `src/components/TerminalPanel.vue:373`、`src/components/RunConsole.vue:237`、`src/quickDocHost.ts:252` | 本仓已做：判定收敛成一条 + 三处调用点改走它。**还差**：`src/App.vue:1011`、`:1436` 两处直连（§W1 第 2、3 条）与模板那颗 link 框（§W1 第 4 条） |
| browsers/R2 | 「四个 URL 出口」这个数 | `[x]` 复核并纠正 | 同上 | `src/App.vue:1011`/`:1436`、`src/components/TerminalPanel.vue`、`src/components/RunConsole.vue`、`src/quickDocHost.ts` | **原写四个、实际五个**（RunConsole 那一处是 welcome2 之后落地的）；`tests/welcome-external-link-launch.test.mjs` 的「五出口」条钉住 `App.vue` 里恰好剩 2 处 |
| browsers/R2 | 已挂着问句时不叠第二扇模态 | `[x]` 已做 | `BrowserLauncherImpl.kt:75-81`（`MessageDialogBuilder…show(project)` = 模态） | `src/workspaceLifecycle.ts:171-186` | 后到的那条按「取消」答（`:85` 的 else 档 = 不开），判据见新测试第 6 条 |
| trust/R3 | 第三个回值 `trustAll` 一路接到落库 | `[x]` 已做（模块 + 生命周期两半） | `TrustedProjectsDialog.kt:64-73`（`:66` `projectRoot.parent != null && dialog.isTrustAll` → `:69` `TrustedPathsSettings.addTrustedPath(父目录)`；`:72-73` 安全模式记 false；取消两路都不进） | `src/workspaceLifecycle.ts:141-159` | 回值收成三个 ⇒ `resolveTrustPrompt(choice, remember, trustAll)`；勾了才多落父目录（`applyTrustDecision(entries, trustDecisionPaths(...))`），没勾只落根，取消什么都不记 |
| trust/R3 | 配置目录里的来源不落父目录 | `[x]` 已做 | `TrustedProjects.kt:95-107`（`:105` 父目录为空 → false、`:106` `parent.startsWith(PathManager.getOriginalConfigDir())` → false）；`TrustedPathsSettings.kt:34-48`（清单是 `List<String>`、每条隐式 `true`，`:46`） | `src/trustedProjects.ts:254-259`/`:270-283`（既有）+ `src/workspaceLifecycle.ts:110-114`（新：`trustConfigDir` 来自 `app.info` 的 `profile`，`bootstrap()` 里读，`src/workspaceLifecycle.ts:243-247`） | 可用性 `trustCanTrustAll` 也在生命周期里算好了（配置目录读不到就不给那一格）⇒ 宿主只剩把两个 prop 粘进模板 |
| trust/R3 | 宿主模板那一行 | `[ ]` 未做（保留文件） | 同上 | `src/App.vue:2646` | §W1 第 4 条；**顺带纠正一条假门禁**：`tests/welcome-trust-dialog.test.mjs:113` 钉的是 `!mount.includes('canTrustAll')`，而宿主按 camelCase→kebab 写的是 `:can-trust-all="trustCanTrustAll"` ⇒ 落了也不会红（假绿），请求里给了正向钉法 |
| browsers/R5 | `shell.openUrlWithBrowser` 成对性 | `[-]` 不适用（本轮结论，不是回避） | `BrowserLauncherImpl.kt:54-57`（只有 `DefaultBrowserPolicy.FIRST` 才给 `firstActiveBrowser`）；`BrowserLauncherAppless.kt:211-218`（路径空 = `showError`，**不是**回退系统默认） | `src/bridge.ts:109`（union 里没有）、`native/file_queries.cpp:234-239`（只有 `shell.openUrl`）、`native/workspace.cpp:1223`（`open_external` 实现体） | 两侧都缺 ⇒ 现在**不是**假通道；新增门禁 `tests/welcome-external-link-launch.test.mjs` 最后一条：union 与 native 分派、native 键表与 `src/settingsModel.ts`/`src/bridgePreview.ts` 必须同批出现，半边就红（反向验证已实测注入会变红） |
| browsers/R5 | 「新键登记四处」 | `[x]` 复核并纠正 | —— | `native/settings_schema.hpp:142`、`native/settings_schema.cpp:183`/`:216-232`、`src/settingsModel.ts:171`/`:221`、`src/bridgePreview.ts:271` | 实际**五处**（welcome2 R5 漏了 `settings_schema.hpp` 的 `GENERAL_SETTING_KEYS`，未知键会被 `settings_schema.cpp:187` 的 `known_keys` 剪掉） |
| browsers/R5 | 别的桶声称「browserList/defaultBrowserPolicy 四处都有」 | `[x]` 复核并**证伪** | —— | 实测 19:1x：`native/settings_schema.hpp`、`native/settings_schema.cpp`、`src/settingsModel.ts`、`src/bridgePreview.ts`、`src/settingsBridge.ts` 对 `browserList\|defaultBrowserPolicy` **全部 0 命中** | 那条批次的 §4 写「四处都有」与盘上不符 ⇒ 主代别据此跳过第 5 处登记 |
| browsers/R5 | 浏览器设置页 | `[ ]` 未做 | `BrowserSettingsPanel.kt:83/:111/:115`；注册项 `intellij.platform.ide.impl.xml:1306` | `src/browsers.ts:323-340`/`:376-386`/`:396-417`（规则已在盘） | 通道没到位 = 表格选完无处可去 ⇒ 按规约 §3 不渲染；§W3 等通道到位同批做 |
| welcome2/R2 附带 | 上游 `browse()` 的 `jar:` 忽略（`:91-94`）、malformed URL（`:101-105`）、UNC（`:106-109`） | `[ ]` 未做（要拍板，见 §W5） | 同上 | `native/workspace.cpp:1223-1226` + `native/workspace.hpp:96-99`（本仓现有那一道协议白名单边界） | 搬这三档改的是「开不开得成」而不是「问不问」，会把现在能开的链接变成开不了 = 行为变更，不在 R2 范围 |
| welcome2/R2 附带 | 「文件级信任做不到」那句 | `[~]` 口径不准（登记，不改代码） | 我亲手打开的是调用侧：`BrowserLauncherImpl.kt:63-67` 与 `:89-108`、`IdeBundle.properties:3154 Trust File and Open` | `src/trustedProjects.ts:117-121`（现有如实登记） | 上游确实**另有一处** per-file 前缀树存储，所以准确说法是「没搬（要新增一格持久存储）」而不是「做不到」；`TrustedFiles.kt:21-50` 那三个坐标本轮**我没有逐行打开** ⇒ 标未亲验 |

## 2. 改动文件清单（HEAD 行数 → 现在行数）

| 文件 | 前 | 后 | 做了什么 |
|---|---|---|---|
| `src/externalLinkLauncher.ts` | 新建（0） | **79** | 一条 URL 出口：`installExternalLinkGate` / `externalLinkGateInstalled` / `openExternalUrl(url, open?)`；判定复用 `browseWithTrustCheck`，运输默认 `shell.openUrl`，`open` 是 R5 那一格留的位 |
| `src/workspaceLifecycle.ts` | 452（本轮开始时） | **513** | T1（return 表 +2 名）；R3（三参回值 + `trustDecisionPaths`/`applyTrustDecision` 落库 + `trustConfigDir`（`app.info` 的 profile）+ `trustCanTrustAll`）；R2（`linkPrompt`/`askExternalLink`/`resolveLinkPrompt` + 装配即 `installExternalLinkGate`）；return 表另露 5 个名字 |
| `src/components/TerminalPanel.vue` | 774 | 817（含别的桶在途 +41） | 我这次：`openTerminalUrl` 改走 `openExternalUrl(url)`；import 去掉 `request`（本文件已无其他用处）、加 `openExternalUrl`；注释留痕 |
| `src/components/RunConsole.vue` | 591 | 600（含别的桶在途） | 我这次：`openConsoleUrl` 改走 `openExternalUrl(url)`；`request` import 保留（`:278/:285/:347` 还在用） |
| `src/quickDocHost.ts` | 330 | 337 | 我这次：`openExternalDoc` 走 `openExternalUrl(url, next => request('shell.openUrl', { url: next }))` —— 保住注入 `request` 的替身（`tests/doc-host.test.mjs` 那两条仍真跑） |
| `tests/terminal-hyperlinks.test.mjs` | 240（估） | 246 | 被搬走的锚点改指 `src/externalLinkLauncher.ts`，断言体 `/request\('shell\.openUrl', \{ url \}\)/` 一字未动；面板一侧加正向钉 |
| `tests/console-hyperlinks.test.mjs` | 152（估） | 159 | 同上（RunConsole 那一族） |
| `tests/welcome-external-link-launch.test.mjs` | 新建（0） | **209** | 10 条判据（行为 6 + 源码形状 3 + R5 成对性 1），详见 §3 |
| `docs/wiring-requests-2026-10-06-welcome3.md` | 新建（0） | 203 | W1（App.vue 四条粘贴行）/W2（R5 五处 + 建议函数）/W3（设置页）/W4（两处只读持久清单）/W5（要拍板） |

**git 纪律**：我**没有**执行任何 commit/push/checkout/reset/stash/clean。
本轮期间别的桶把工作区整体提交过至少一次（`git status --short src/workspaceLifecycle.ts src/externalLinkLauncher.ts tests/welcome-external-link-launch.test.mjs` 现在为空、
内容都在 HEAD 里），所以「前/后」用的是 `git show HEAD:<file> | wc -l` 与当前行数。

## 3. 新判据（每条都能失败，反向验证见 §5）

`tests/welcome-external-link-launch.test.mjs`（10 条，全绿）：
1. 装了门禁 + 未信任 + 答「打开」⇒ 运输收到 **trim 后**的 URL、`writes` 为空（`:83`）。
2. 答「信任项目并打开」⇒ 每一手 `generalSettings` 写入的 `trustedPaths` 恰为 `[{d:/work/p,true}]`（**只有根这一条**，没勾 trust-all 不记父目录）。
3. 答「取消」⇒ 运输 0 次、返回 `canceled`、`writes` 空、`linkPrompt` 收掉。
4. 已信任 / 没开项目 ⇒ `linkPrompt` 始终 null（`:60-62`、`:69-71`）。
5. **不叠第二扇模态** ⇒ 第二句立刻 `canceled` 且运输 0 次，第一句仍由用户答案决定。
6. **没装门禁 = 接线前行为** ⇒ 请求真的发给 `shell.openUrl`（node 里必然 `浏览器预览…` 报错，报错恰好证明没被静默吞）。
7. 五出口收成一条：三个非保留调用点含 `openExternalUrl(` 且不含 `request('shell.openUrl', { url })`；`src/App.vue` 里恰好剩 **2** 处。
8. R3 形状：三参 Promise、`applyTrustDecision(entries, trustDecisionPaths(choice, root, trustAll, trustConfigDir.value))`、`else rememberSessionTrust(root, choice === 'trust')`、`resolveTrustPrompt(choice, remember, trustAll)`、return 表含 T1 那两个名字。
9. R3 可用性（**行为**，不是文本）：`trustConfigDir` 未知 → `trustCanTrustAll` false；设为 `C:/Users/me/.taocode` 且根是 `D:/Work/Proj` → true；根换成配置目录里的镜像项目 → false；`trustConfigDir` 退回 null → false。
10. R5 成对性：`Method` union ↔ native 分派、native 键表 ↔ `src/settingsModel.ts` ↔ `src/bridgePreview.ts` 必须同批出现。

## 4. §5 自查命令的前后数字

| 命令 | 改前 | 改后 |
|---|---|---|
| `npx vue-tsc -b --force` | 中途一度被 `src/runConfigurationSchema.ts:37-39` 的多行 `as` 表达式打断（别的桶 19:0x 自修） | **0 错**（本轮最终源码状态下跑的，输出为空） |
| `node --test tests/module-size.test.mjs` | —— | **4 通过 / 1 失败**：失败的是 `src/components/CodeEditor.vue 1152 > 上限 1147`（**不是本桶文件**，编辑器那一路在途）。本桶文件全在上限内：`workspaceLifecycle.ts` 513/900、`externalLinkLauncher.ts` 79/900、`TerminalPanel.vue` 817/900、`RunConsole.vue` 600/900、`quickDocHost.ts` 337/900，**上限一个都没改** |
| `node .tools/find-param-props.mjs` | 0 | **0 处参数属性** |
| `node .tools/find-ts-in-mjs.mjs` | 干净 | **干净**（新测试里没有 TS 语法） |
| `node .tools/find-missing-ext.mjs` | 1308 文件 / 干净 | 扫描 **1308** 个文件、**干净**（`.ts` 值 import 一律带扩展名） |
| `node .tools/find-orphan-modules.mjs --gate` | 基线 8 | **已登记孤儿 7 / 基线 8 / 新增 0 / 本轮清掉 1（`src/jarRun.ts`，别的桶）⇒ 门禁绿**。`src/externalLinkLauncher.ts` **不在孤儿表里**：4 个真实 importer（`.ts` 侧 `workspaceLifecycle.ts:27`、`quickDocHost.ts:29`；`.vue` 侧 `TerminalPanel.vue:41`、`RunConsole.vue:61`） |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | 11/11 | **11 通过 / 0 失败**（含本轮两份新文档里的全部坐标） |
| 本域测试（只跑自己那片，不跑全量） | —— | `welcome-external-link-launch / welcome-trust-dialog / trusted-projects / trusted-session-single-source / trusted-trust-all / trusted-external-link / trusted-locations / trusted-locations-union / doc-host / terminal-hyperlinks / console-hyperlinks / welcome-browsers-launch / browsers` = **127 通过 / 0 失败** |
| `npm run test:native` / ctest | —— | **没跑**：本轮 `native/` 一个字没改（R5 要动 native 的那几处全部写成请求） |

## 5. 反向验证（注入违规 → 变红 → 撤掉 → 复绿，三步数字）

| # | 注入了什么 | 红的条数 / 名字 | 撤掉后 |
|---|---|---|---|
| A | 把 `src/components/TerminalPanel.vue` 那一行退回 `request('shell.openUrl', { url })`（= 假装修好了一条出口） | **2 红 / 30**：`welcome-external-link-launch` 的「五条 URL 出口收成一个调用」+ `terminal-hyperlinks` 的「消费链」 | 复绿 |
| B | 把 `resolveTrustPrompt` 退回两参（= R3 的第三个回值没接） | **1 红 / 10**：「R3：确认框的第三个回值一路接到落库」 | 复绿 |
| C | 只给 `src/bridgePreview.ts:271` 的白名单加 `browserList`（= 半边假通道） | **1 红 / 10**：「R5：指定浏览器那条通道要么两侧都在，要么一侧都没有」 | 复绿 |
| 撤干净后 | 本域 13 个测试文件 | **127 通过 / 0 失败**（`welcome-external-link-launch` 单独跑 10/10），`git diff -- src/bridgePreview.ts` 为空 | —— |

## 6. 零消费方自查结论

- 新增模块只有 `src/externalLinkLauncher.ts`（79 行）：**四个真实 importer**，其中两个是本轮自己落的调用点改动
  （`.ts`：`workspaceLifecycle.ts`、`quickDocHost.ts`；`.vue`：`TerminalPanel.vue`、`RunConsole.vue`），
  `--gate` 结论见 §4（新增 0、绿）。
- 别的桶在 17:05 / 17:49 / 19:0x 三次报过「`src/externalLinkLauncher.ts` 是零消费方新文件、已删除」——
  **与盘上不符**：文件在（5063 字节、79 行），`grep -c openExternalUrl` 在四个消费者里分别是 2/2/2/4，
  `--gate` 绿。那三次结论来自我接完调用点之前的扫描（或把 `.vue` 侧没数进去）。
- `src/browsers.ts` 的 `normalizeBrowserSettings` / `browserLaunchPayload` / `selectDefaultBrowser`
  仍是「只有判据、没有生产消费方」的那一族（文件头 `:16` 已如实登记）——本轮**没有**新加零消费方，
  也没有替它们假装接上（要等 §W2 的通道）。

## 8. 收工补丁（最后一批改动与真实数字；覆盖 §2/§3/§4/§5/§6/§7 里被这些改动改掉的数字）

**为什么还有第二批**：§2 落完之后自查发现一个「接一半比不接更糟」的形状 ——
门禁是**装配时**装上的，而 `mode="link"` 那颗弹框要等宿主把它挂进模板（W1 第 4 条，保留文件），
中间那段状态里 `askExternalLink` 的 Promise 永远 pending ⇒ 终端/控制台/快速文档里的链接
**点了什么都不发生**。补了一条挂载信号，两种状态都能走：

| 文件 | 补了什么 |
|---|---|
| `src/externalLinkLauncher.ts`（79 → **98 行**） | `markLinkDialogMounted(bool)` / `linkDialogIsMounted()`（`:44-58`）—— 那颗框此刻在不在屏幕上 |
| `src/components/TrustedProjectDialog.vue`（110 → **119 行**） | `onMounted`/`onBeforeUnmount` 里只在 `mode="link"` 那一档报挂载（`:53-54`）；另加 `import { markLinkDialogMounted }` |
| `src/workspaceLifecycle.ts`（513 → **532 行**） | `askExternalLink` 改 async：`await nextTick()` 后没人挂 ⇒ 收掉 `linkPrompt`、按「打开」放行、`notify` 一句为什么没弹（`:181-196`）；`type LinkPromptState` 抽出来（TS 把 Promise 执行体里的赋值钉成 `never`，`settle` 那一行注释写了原因） |
| `tests/welcome-external-link-launch.test.mjs`（209 → **225 行，判据 10 → 11 条**） | `beforeEach` 默认「宿主已挂框」（原来 5 条按这个状态跑）；新增第 11 条「宿主还没挂 mode="link" 那颗框时不卡住：按「打开」放行并说一句为什么没弹」 |

**最终数字（全部在改完第二批之后重跑）**：
- 本域 14 个测试文件（`welcome-external-link-launch / welcome-trust-dialog / trusted-projects /
  trusted-session-single-source / trusted-trust-all / trusted-external-link / trusted-locations /
  trusted-locations-union / doc-host / terminal-hyperlinks / console-hyperlinks /
  welcome-browsers-launch / browsers / run-configuration-inspection`）= **128 通过 / 0 失败**
  （`welcome-external-link-launch` 单独 **11/11**）；
- `node --test tests/module-size.test.mjs` = **5 通过 / 0 失败**（中途那条 `CodeEditor.vue 1152 > 1147`
  是编辑器那一路在途，他们随后自己收回去了；本桶没动任何上限）；
- `node .tools/find-orphan-modules.mjs --gate` = **已登记孤儿 6 / 基线 8 / 新增 1 / 本轮清掉 2**，
  新增那 1 个是 **`src/editorSplitLine.ts`（编辑器那一路的在途新文件，不是本桶）**；
  `src/externalLinkLauncher.ts` **不在孤儿表里**（消费方 5 个：`workspaceLifecycle.ts:27`、
  `quickDocHost.ts:29`、`TerminalPanel.vue:41`、`RunConsole.vue:61`、`components/TrustedProjectDialog.vue:20`）；
- `find-missing-ext`（扫描 **1313** 个文件）/ `find-ts-in-mjs` / `find-param-props`（**0 处**）= 干净；
- `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` = **11 通过 / 0 失败**；
- `npx vue-tsc -b --force`：**本桶 0 错**；收工那一刻全仓剩 **3–5 条**，来源都不是本桶
  （`src/components/CodeEditor.vue:116` `smartEnterLanguageForView` 未定义、
  `src/editorSplitLine.ts:146` `.map()` 传了带可选参数的函数、`src/lspNavigation.ts:20` 从
  `editorGroups.ts` import 了一个不存在的 `jumpTargetPane`）⇒ 编辑器/LSP 那两路在途，主代收工前 Their 那三条必须自己收掉。
- 反向验证的三条注入（§5）在补完挂载信号之后仍然成立：注入 A（把 `TerminalPanel.vue` 那行退回直连）
  会让 `welcome-external-link-launch` 第 7 条 + `terminal-hyperlinks` 的「消费链」红；
  注入 B/C 同理。**注意**：新加的第 11 条不看「未接线形状」，它测的是那条分支本身，
  所以宿主挂了框之后它也应当继续绿（不需要反转）。

**顺带纠正两条别人的在途记录（留痕）**：
1. 另一路（run-issues 那批）两次报「`src/externalLinkLauncher.ts` 是零消费方新文件、已删除」——
   实测文件在（98 行）、有 5 个 importer、`--gate` 不报它。那两句来自我接完调用点之前的扫描。
2. 同批的 `RunConsole.vue` 重写一度把控制台那条 URL 出口删掉（`openConsoleUrl` 整条不在），
   随后他们又按 `openExternalUrl` 的形状重新接回（现在叫 `openConsoleExternalUrl`，
   判据已挪到 `tests/run-configuration-inspection.test.mjs:203-205`，本轮实测 10/10 绿）；
   `tests/console-hyperlinks.test.mjs` 那条被删掉的锚点也已经在 `:158-159` 复现。**本轮没有再动这两个文件。**
3. §1 里「别的桶声称 browserList/defaultBrowserPolicy 四处都有」那条**仍然成立**：
   收工前再实测 `native/settings_schema.hpp`、`native/settings_schema.cpp`、`src/settingsModel.ts`、
   `src/bridgePreview.ts`、`src/settingsBridge.ts` 对这两个键 **0 命中**；
   `src/browsers.ts` 归另一路（他们本轮也在改），本桶一个字没动它。


1. **宿主那四处粘贴行**：`src/App.vue` 是保留文件 ⇒ 只出请求（§W1）。R2 因此还没在真应用里生效：
   现在 `App.vue:1011`/`:1436` 仍直连 `shell.openUrl`，未信任项目里从编辑器文档链接与「导出 HTML 后打开浏览器」
   这两条路点外链**仍然一句都不问**。
2. **`mode="link"` 那颗框现在渲染不出来，但已经不会把链接打死**（原写「Promise 永远 pending、
   接一半比不接更糟」——那是 §8 补之前的状态，已被挂载信号替掉，见 §8 第一段的四条改动）：
   `linkPrompt`/`resolveLinkPrompt` 在 return 表里、`askExternalLink` 等一拍后发现没人挂框 ⇒
   **按「打开」放行 + 一句可见提示**（判据 §8 那条新用例）。所以 W1 那三条**不必**绑成一批了，
   但只有全落才是「上游那一句真的会问」：
   `src/App.vue:1011`/`:1436` 仍直连 `shell.openUrl`（未信任项目里从编辑器文档链接与
   「导出 HTML 后打开浏览器」这两条路点外链**仍然一句都不问**），
   `tests/welcome-external-link-launch.test.mjs` 第 7 条用 `App.vue` 里恰剩 2 处直连钉住这个状态，落地后改 `0`。
3. **文件级信任**（`BrowserLauncherImpl.kt:63-67` + `:89-108`）：本仓 `generalSettings.trustedPaths` 只有目录级条目
   （`native/trusted_paths.cpp` 的三道硬边界也按目录判），要搬得新增一格 per-file 存储并动
   `native/settings_schema.*` + `src/settingsModel.ts`（都不可由本桶改）⇒ 登记，不做。
   `TrustedFiles.kt:21-50`（另一路代理给的坐标）**本轮未逐行打开** ⇒ 标未亲验。
4. **Windows Defender 那一格**（`TrustedProjectsDialog.kt:76-88`）：本仓宿主没有 Defender 通道，
   `pathsToExclude` 那条链在 `:76` 就要求非空 ⇒ 本仓根本不画那一格（与 welcome2 同口径，未改）。
5. **`browse()` 的 jar:/malformed/UNC 三档**：见 §W5，属行为变更，要拍板后才动。
6. **`app.info` 的 profile 在浏览器预览里读不到**（`bridgePreview` 对 `app.info` 报 `DESKTOP_REQUIRED`）⇒
   `trustCanTrustAll` 退回 false、那一格不画。预览本来也不弹信任框（`confirmTrust` 首行 `if (!isDesktop …) return true`），
   所以只是「保守缺格」，不是坏行为。
7. **上游 `TrustedProjects.kt:76-81`**：`isSystemTrusted`（IDE 自有的 Home/镜像项目目录）的路径**不写进持久清单**
   （注释原文 `:77-78`：「cannot be revoked there」）。本仓 `trustDecisionPaths` 一律记项目根 ⇒
   一处如实差异，本轮没改（要改就得给「系统路径」下定义，本仓现在没有那个概念）。
