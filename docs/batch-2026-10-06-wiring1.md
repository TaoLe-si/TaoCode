# 接线报告 · 桶 1（重构域）死模块接进生产链路 · 2026-10-06

> 执行者：主代理下游的**接线执行者**。授权范围（本次专门放开）：`src/App.vue`、`src/keymap.ts`、
> `src/keymapBindings.ts`、`src/menus/refactorMenu.ts`。请求原文：
> `docs/wiring-requests-2026-10-06-bucket1b.md`（A1–A4 是我的活；A5 桶 14、A6 桶 5/保留文件，没碰）。
>
> 结论先说：**A1/A2/A3/A4 四条全部接上并跑通**。原先 5 个零消费方模块
> （`src/refactorSignatureFlow.ts`、`src/refactorSignature.ts`、`src/components/RefactorSignatureDialog.vue`、
> `src/refactorMemberMove.ts`、`src/refactorIntroduceParameterObject.ts`）已从孤儿门禁里消失。

---

## 1. 真实依赖名对照（请求写的 → 实际用的）

请求里那四个依赖名，主代理实测在 `src/App.vue` 搜不到。我把 `src/App.vue` 与 `src/semanticActions.ts`
的**真实出口**读完后逐条对上（`createSemanticActions` 的解构块现在在 `src/App.vue:990-1008`）：

| 请求里写的名字 | 实际存在吗 | 我用的真名与出处 |
|---|---|---|
| `applyEditsToFiles` | **在**（`createSemanticActions` 的出口，`src/App.vue:993` 就解构了它） | `applyEditsToFiles(edits, doneMessage)` — `src/semanticActions.ts:482`，实现是「逐文件套用 → `file.write` → 报 `… · 更新 N 个文件`」 |
| `renamePreviewOf` | **不在** `createSemanticActions` 的出口里 | `src/renamePreview.ts:91` 的**模块级纯函数** `renamePreviewOf(edits): RenamePreview`，我在装配层直接 import（`refactorPreviewOf` 那种「宿主方法」并不存在） |
| `conflictMessage` | **不存在这个名字** | 真名 `renameConflictMessage(preview)` — `src/renamePreview.ts:119`。它要求整份 `RenamePreview`，而 `ChangeSignatureDeps.conflictMessage` 只声明 `{ conflicts }` 那一半（逆变不成立）⇒ 我在装配层把刚算好的那份预览记住再传，**没用类型谎言、没重算**（`src/refactorHostAssembly.ts:98-103`） |
| `openPreview(label, edits)` | **不存在这个名字** | 真名 `openEditsPreview(label, edits, write)` — `src/semanticActions.ts:658`，它比请求多一个**写盘回调**（文件头注释写明「与 `openRefactorPreview` 的差别就是写盘动作由调用方给」）。`src/App.vue:995` 原先没解构它 ⇒ 我把 `openEditsPreview` 补进解构（只加一个名字，没加行） |

请求 A3 那段可直接粘贴的代码里，还有三处与真实接口不符，我按**真实组件契约**改写了：

| 请求里写的 | 真实情况 | 我写成 |
|---|---|---|
| `@returntype="…setReturnType($event)"` | 组件的 emit 名是 `returnType`（`src/components/RefactorSignatureDialog.vue:44`） | `@return-type="value => changeSignature.setReturnType(value)"` |
| `@param="…setParam($event.index, $event.patch)"` | `param` 是**两个**载荷（`:45`），`$event` 只拿得到第一个 | `@param="(index, patch) => changeSignature.setParam(index, patch)"` |
| `createChangeSignatureFlow({ active, findTab, tabs, … })` | `App.vue` 里没有 `tabs` 这个绑定 | 传 `allTabs`（`src/App.vue:181`）；`editorFor`/`languageOf`/`findTab`/`baseName`/`confirmDelete` 都按真实名字注入 |

`createChangeSignatureFlow` 的返回键也核对过：请求列的 11 个都在（`src/refactorSignatureFlow.ts:210-217`），
另外还有一个 `changeSignatureOpen` 与 `isSignatureSource`，我没用到 `changeSignatureOpen`。

---

## 2. 改动文件与行号

### 新增
- `src/refactorHostAssembly.ts`（448 行）—— **唯一装配面**：A3 的 `createChangeSignatureFlow` 注入、
  A4 的勾选表编排（`openMemberMove`/`openIntroduceParameterObject`/`applyChooser`）、
  A2 的 `openSafeDelete`/`safeDeleteChoose`，外加共享的工作区扫描 `scanFiles`。
- `src/components/RefactorMemberChooserDialog.vue`（115 行）—— 上游 `MemberSelectionPanel` 那张表的等价物，
  成员上移/下移与引入形参对象**共用**（`PullUpDialog.java:111-114` 用的就是同一个 `myMemberSelectionPanel`）。
- `src/components/RefactorSafeDeleteDialog.vue`（63 行）—— 三选一对话框，文案/次序**全部**取
  `safeDeletePrompt()` 的模型（组件里不另写一句文案）。
- `tests/refactor-host-assembly.test.mjs`（7 条）—— 装配层的判据（见 §4）。

### 修改（授权范围内）
> 下面 `src/App.vue` 的行号是**写完时的快照**（这棵树十几个代理在动，行号会漂）；
> 定位请用每条后面那段原文再 grep 一次，别按行号硬改。
- `src/App.vue`：2686 → **2708 行**（登记上限 2737，还剩 29 行；每次改动后都跑了 `node --test tests/module-size.test.mjs`）
  - `:10` 三个对话框组件的 import（挂在既有那一行里，不新增行）
  - `:62` `import { createRefactorHost } from './refactorHostAssembly'`
  - `:995` 解构补 `openEditsPreview`
  - `:1009-1016` 装配一次 `createRefactorHost({ active, allTabs, findTab, editorFor, notify, workspace, isDesktop, languageOf, applyEditsToFiles, openEditsPreview, deleteFile, showUsages, refreshOutline, outline })`
  - `:1014` `deleteFile: async path => { deleteTarget.value = {…}; await confirmDelete() }`（复用宿主既有删档链，见 §5）
  - `:1018-1020` 解构（只解构，不写逻辑）
  - `:1553` `refactorMenuContext` 补五个处理函数 `openChangeSignature / openPullUp / openPushDown / openIntroduceParameterObject / openSafeDelete`
  - `:1811` `createKeymap` 的参数补 `openChangeSignature, openSafeDelete`
  - `:2416-2421` 三行模板挂载（更改签名 / 勾选表 / 三选一）
- `src/keymapBindings.ts`
  - `:105-109` `refactor.changeSignature`，`display: 'Ctrl F6'`，`chord: { key: 'f6', control: 'ctrl', forbid: ['shift', 'alt'] }`，`upstream: '$default.xml:469-471'`
  - `:110-111` `refactor.safeDelete`，`display: 'Alt Delete'`，`chord: { key: 'delete', control: 'alt' }`，`upstream: '$default.xml:999-1001'`
- `src/keymap.ts`
  - `:81` / `:83` `KeymapContext` 补 `openChangeSignature` / `openSafeDelete`
  - `:371-372` 分派表补 `'refactor.changeSignature': () => openChangeSignature(),` / `'refactor.safeDelete': () => void openSafeDelete(),`
  - （`tests/keymap-bindings.test.mjs:105` 要求「出厂表与分派表一一对应」⇒ 这两张表必须成对改，改一处必红）
- `tests/refactor-signature.test.mjs`：接线判据从「**请求文档**里写了可粘贴代码」升级为「**三个生产文件**里真的有那一条」
  （`src/keymapBindings.ts` 的绑定字面量 + `src/keymap.ts` 的分派 + `src/App.vue` 的挂载/上下文/一次装配调用）。
  这是同一件事的**更强**写法，没有放松成 `includes`/`ok`；上游 `$default.xml:469-471` 的取证门禁原样保留。
- `tests/refactor-menu-parity.test.mjs`：
  - `:57-63` 修正 `PENDING_HOST_ROWS` 上方那段**已过时**的注释（「宿主还没接」→ 已接），
    并写明那条判据守的是 `hosted(ctx.openX)` 契约本身（宿主没接就不出现），不因为宿主接上了而失效；
  - 文件末尾**新增**一条测试，正面机检五条线都真的落位（`refactorMenuContext` 里五个名字、三个对话框挂载、
    键位表与分派表成对、`refactorHostAssembly` 里四个模型入口都被调用），
    并钉住「成员上移/下移在上游没有默认键位 ⇒ 出厂表里也不许出现这两条」。

### 没改（如实登记）
- `src/menus/refactorMenu.ts`：我**一行都没动**。它上一轮已经是「按能力渲染」的版本，
  我接上一条、菜单里就多一条，五条全接上后那 5 行才全部出现（`git status` 里它的 `M` 是上一轮桶 1 留下的）。
- `src/treeActions.ts`（桶 14）、`src/components/CodeEditor.vue`、`src/editorCommands.ts`、`src/style.css`、
  `src/tokens.css`、`src/settingsModel.ts`、`src/bridge*.ts`、`src/actionRegistry.ts`、`CMakeLists.txt`、
  `tests/module-size.test.mjs` 的上限数字：**未触碰**。

---

## 3. 上游坐标（自己按行核过，不抄请求）

| 事实 | 坐标 | 我核到的原文 |
|---|---|---|
| 更改签名 = Ctrl+F6 | `platform/platform-resources/src/keymaps/$default.xml:469-471` | `:469 <action id="ChangeSignature">`、`:470 first-keystroke="control F6"` |
| 为什么 `forbid: ['shift']` | 同文件 `:472-474` | `ChangeTypeSignature` = `control shift F6` |
| 为什么**还**要 `forbid: ['alt']`（请求没写，我补的） | 同文件 `:36-38` | `SwitchCoverage` = `control alt F6` ⇒ Ctrl+Alt+F6 不能落进更改签名 |
| 同一物理键第四档 | 同文件 `:996-998` | `RenameElement` = `shift F6`（本仓已有 `semantic('rename', … 'Shift F6')`） |
| 安全删除 = Alt+Delete | 同文件 `:999-1001` | `:999 <action id="SafeDelete">`、`:1000 first-keystroke="alt DELETE"` |
| 三选一与默认项 | `platform/lang-impl/src/com/intellij/refactoring/safeDelete/UnsafeUsagesDialog.java:35/:36/:41-47/:58/:98` | `:35 setTitle(usages.detected)`、`:41-47 createActions()` 返回 `{viewUsagesAction, ignoreAction, new CancelAction()}`、`:98 putValue(DEFAULT_ACTION, TRUE)` ⇒ 回车落「查看用法」 |
| 勾选表（上移/下推同一个表） | `java/java-impl-refactorings/src/com/intellij/refactoring/memberPushDown/PushDownDialog.java:31-34`、`…/memberPullUp/PullUpDialog.java:111-114` | `new MemberSelectionPanel(members.to.be.pushed.down.panel.title, getMemberInfos(), keep.abstract.column.header)`；上移复用 `myMemberSelectionPanel` |
| 引入形参对象三块面板 | `platform/lang-impl/src/com/intellij/refactoring/introduceParameterObject/AbstractIntroduceParameterObjectDialog.java:66-105` | `myParameterClassPanel`(:66) → `myParamsPanel`(:105) |

⚠️ 请求 A4/A5 里 `PushDownDialog.java` 写的是 `platform/lang-impl/…`（**该路径在参考树里不存在**），
真实路径是 `java/java-impl-refactorings/src/…`；我按真实路径引，`tests/source-citations.test.mjs` 才不会被我这批注释判红。

---

## 4. 验证

| 跑的东西 | 结果 |
|---|---|
| `node --test tests/refactor*.test.mjs tests/module-size.test.mjs tests/keymap*.test.mjs` | **88 用例 / 88 通过 / 0 失败** |
| 上面这套 + `tests/safe-delete.test.mjs tests/action-registry.test.mjs` | **100 / 100 / 0** |
| `node --test tests/refactor-host-assembly.test.mjs`（新增） | **7 / 7 / 0** |
| 所有读 `src/App.vue` 的 74 个测试文件（回归面） | **666 用例 / 665 通过 / 1 失败** —— 唯一那条红是 `tests/source-citations.test.mjs`，且**不是我的**：剩 3 条坏引用全在别人的文档里（`docs/batch-2026-10-06-bucket12b.md` ×2、`docs/batch-2026-10-06-bucket13c.md` ×1、`docs/wiring-requests-2026-10-06-bucket3b.md` ×1）。我自己那 1 条（`PushDownDialog.java` 路径）已经修好并从红名单里消失 |
| `node .tools/find-param-props.mjs` | **共 0 处参数属性** |
| `npx vue-tsc -b --force`（全仓） | 见下 |
| `node .tools/find-orphan-modules.mjs`（孤儿门禁） | 见下 |

**定向 strict tsc 自证**（全仓 `vue-tsc` 受别人在途文件影响，不能拿它当我的清白证据）：

```
npx tsc --noEmit --strict --target es2022 --module esnext --moduleResolution bundler \
  --allowImportingTsExtensions --skipLibCheck src/refactorHostAssembly.ts   →  0 错
```

`npx vue-tsc -b --force` 三次跑的错误**全都不在我改的文件里**，而且是别的桶正在写的在途语法错（我一次没碰）：
第 1 次 `src/customFoldingProviders.ts(48,103) TS1002`（后来被别人修好了）→ 第 2 次 `src/quickEvaluateHint.ts(220,222) TS1128` + `src/todoMultiLine.ts(57,46) TS1005` → 第 3 次只剩 `src/todoMultiLine.ts(57,46)`。
这两个文件在 `git status` 里都是 `??`（未跟踪的新文件，桶 5/别的桶名下）。
⇒ 「全仓基线 0 错」这一条**我现在拿不到**，不是被我弄坏的：请主代理在别人文件修完后复跑；
我这批文件的清白由上面那条定向 tsc + 「所有 vue-tsc 报错都不含我的文件名」两条一起担保。

**孤儿门禁前后对比**（`node .tools/find-orphan-modules.mjs` 首行）：

| 时点 | 零生产消费方模块 | 我这批的 5 个在不在里面 |
|---|---|---|
| 接线前 | **19 个**（合法例外 1） | 在：`components/RefactorSignatureDialog.vue`、`refactorIntroduceParameterObject.ts`、`refactorMemberMove.ts`、`refactorSignatureFlow.ts`（`refactorSignature.ts` 因被 flow 引用已不在列表，但整簇是死的） |
| 接线后 | **10–11 个**（合法例外 1；两次跑差一个，是别的桶并发进出） | **全部消失**；`grep -cE "refactorSignature\|Refactor\|refactorMember\|refactorIntroduce\|refactorHost"` 命中 **0**，我新增的 3 个文件也都不是孤儿 |

中间 19→14→10 的两次下降里，14→10 那 4 个是别的桶并发接上的，不是我这边。
`--gate` 仍然 `exit 1`（因为还剩 10 个别人的：`agent.ts`/`debugWindowPolicy.ts`/`dragAndDropTargets.ts`/
`fileTypeIgnoredList.ts`/`generalSettingsLocal.ts`/`ideShellCreateTarget.ts`/`jarRun.ts`/`popupLiveUpdate.ts`/
`runAnythingContext.ts`/`scratchHistory.ts` + `main.ts`）——**不是我这条线的账**。

**新门禁的反向验证**（作业规约 §6.4：门禁不红就是空转）：把 `src/App.vue` 里 `refactorMenuContext`
那一行的 `, openPullUp` 去掉 → 新增那条测试的正则 `refactorMenuContext: RefactorMenuContext = \{[^}]*\bopenPullUp\b`
由 true 变 false ✓；把 `src/keymap.ts` 里 `'refactor.safeDelete': () => void openSafeDelete(),` 整条删掉 → 对应断言变 false ✓；
把 `src/keymapBindings.ts` 那条 chord 的 `forbid` 改成 `[]` → 对应断言变 false ✓。全部只在内存里试，**没落盘**。

**装配层的功能判据**（`tests/refactor-host-assembly.test.mjs`，假宿主依赖，不启界面）：
1. 更改签名：状态立起来 → 改名/改形参后 `preview` 是 `function hello(name: string, shout: boolean)` → `apply` 先 `openEditsPreview`（2 个文件）再 `applyEditsToFiles` → 对话框收掉；
2. 光标不在声明上：不立空对话框，只 notify 那一句；
3. 成员上移：面板次序 `['将Main的成员向上拉取至:', '成员']`、第三列表头 `保持抽象`、目标类默认 `Base`、勾选 `run` 后走预览链，完成提示取 `memberMoveNotice`；
4. 没有父类：直接 `「Solo」没有父类，无法向上拉取成员。`，不起勾选表（不猜目标）；
5. 引入形参对象：三块面板次序 = `PARAMETER_OBJECT_PANELS`、建议类名 `DrawOptions`、`typescript` 档 `checks` 为空（`supportsDelegate` 为假 ⇒ 那一格**不渲染**，不是灰着）；
6. 安全删除：注释里有字面出现 → `blocked` → 三选一（次序 `viewUsages/deleteAnyway/cancel`，默认项 `viewUsages`）→ 选「仍然删除」才调宿主删档；
7. 安全删除：一笔用法都没有 → 不弹框，直接交宿主删（上游 `SafeDeleteProcessor` 同口径）。

**接线时顺手发现并修掉的两个真 bug**（不修就是「接上了但一点就崩」那种假接线）：
- `refactorMemberMove` 的目标类原来只扫**别的文件**（`locateClasses` 把声明所在文件整份 `skipPath` 掉了）
  ⇒ Java/Kotlin 里父类与子类写在同一个文件时上移永远「找不到父类」。现在先认同文件的声明、再扫其它标签与工作区
  （`src/refactorHostAssembly.ts:222-231`）。
- `safeDeletePrompt` 的注释那一半原本会**静默漏报**：`nonCodeReport` 拿的是 `FileText{path,text,style}`，
  而我的 `scanFiles` 只给 `{path,text,nonCode}`，`style` 缺省时 `nonCodeUsages` 用 `null` ⇒ 字符串能扫到、注释扫不到
  （账目少一半还看不出来）。现在显式补 `style: commentStyleFor(undefined, path)`
  （`src/refactorHostAssembly.ts:404-408`）；这条由测试第 6 条钉住。

---

## 5. 做过的与没做的

| 项 | 判定 | 说明 |
|---|---|---|
| **A3 更改签名 Ctrl+F6** | **做了** | `createChangeSignatureFlow` 装配 + `RefactorSignatureDialog` 挂载 + `openChangeSignature` 进 `refactorMenuContext` + 键位表/分派表成对补 `refactor.changeSignature`。菜单里那一行现在真的出现，按下去真的起对话框，「重构」真的过预览再写盘 |
| **A1 出厂键位表** | **做了**（并比请求多禁一档 `alt`） | 见 §3 的 `$default.xml:36-38` |
| **A2 分派表 + 安全删除那一半** | **做了，而且没动 `src/treeActions.ts`** | 请求书假设「删除入口在树侧、要改桶 14 的文件」。我读完 `src/App.vue` 后确认删档本身是宿主的 `confirmDelete()`（`src/App.vue:1767` 的 `confirmDelete()`：`file.delete` + 关标签 + 刷树 + 未保存拦截），三选一的模型 `safeDeletePrompt()`（`src/safeDelete.ts:141`）吃的又只是「名字 + 引用账 + 非代码账」⇒ 重构菜单/快捷键这一侧的入口完全可以在装配层成立。**树侧那条（A5：`treeActions.ts:114-125` 的 `beginDelete` 现在还是只 `notify(safeDeleteNotice(…))` 一句话，没有三选一）仍然没做，也不该我做** —— 它要在树里改删除流程，属桶 14。两条入口共用同一份 `safeDeletePrompt` 与同一份 `confirmDelete`，将来 A5 接上不会打架 |
| **A4 成员上移/下移 + 引入形参对象** | **做了** | `findMemberMoveClasses()`/`classMembers()`/`memberMoveEdits()` 与 `parameterObjectEdits()`/`PARAMETER_OBJECT_PANELS` 都进了装配层；编辑一律走**既有** `openEditsPreview`（`src/semanticActions.ts:658`）→ `RefactorPreviewDialog` → `applyEditsToFiles` 那条链，没有另起一套写盘。**成员上移/下移不加键位**（上游 `$default.xml` 里这两个 id 没有默认键位，已由测试钉住「出厂表里也不许出现」） |
| **A6 Unwrap 多候选 chooser** | **没做**（不是我的活） | 文件在 `src/components/CodeEditor.vue`（保留文件）与 `src/editorCommands.ts`（桶 5）名下 |
| 请求 A5（`src/treeActions.ts`） | **没做**（桶 14 名下） | 见上一行 A2 的说明：我没必要为了它越权 |
| SafeDelete 的两个搜索复选框（`SafeDeleteDialog.java:149/:155`） | **没渲染**（按请求「不做」第 1 条） | 对话框只出上游那三个选择；`defaultSafeDeleteOptions()` 的 `searchTextOccurrences` 保持默认关，注释里写明了原因（LSP 的 rename/references 不接受这个入参）。不画一个当场改了没用的框 |
| 「传播形参」按钮 / 可见性下拉 / 生成委托面板 | **没渲染**（同上，「不做」第 2/3 条） | 需要 PSI 调用者层级，本仓没有 |
| InvertBoolean、ExtractClass/Interface/Superclass/Module、IntroduceField/IntroduceParameter | **菜单里仍不出现** | 判据由 `tests/refactor-menu-parity.test.mjs` 的 id 断言守着，我没放松 |

**架构不等价处本仓用什么承接了上游的什么**（作业规约 §2 要求写明）：
上游 `PsiChangeSignatureHandler`/`MemberSelectionPanel`/`SafeDeleteProcessor` 都建立在 PSI 上；
本仓由 `refactorHostAssembly`（装配层）+ 文本层模型（`refactorSignature`/`refactorMemberMove`/
`refactorIntroduceParameterObject`/`nonCodeUsages`）+ 既有重构预览对话框（`RefactorPreviewDialog`，
上游 `RefactoringDialog` 用法树那一面）承接，用户可见的那一面（键位、菜单行次序、勾选表面板次序与列名、
三选一的次序与默认项、完成提示的账目）全部照上游坐标，**没有**照抄 Swing/DI 的组件结构。

---

## 6. 风险与后续（给主代理）

1. `App.vue` 现在 **2708/2737**，余量 29 行。本次只加了 22 行，装配逻辑一律在新文件里；后续任何桶再往 `App.vue` 塞东西请先算余量。
2. `npx vue-tsc -b --force` 拿不到 0 错，卡在别人未跟踪的在途文件 `src/todoMultiLine.ts(57,46)`（TS1005）。请别人修完后复跑；我这边定向 tsc 是 0 错。
3. 孤儿门禁还剩 10 个，全在别的桶名下（清单见 §4），`--gate` 因此仍 `exit 1`。
4. 树侧删除入口（A5）还没接三选一；接的时候建议直接用 `refactorHostAssembly` 暴露的 `openSafeDelete`/`safeDeleteChoose`，别再写第二份 `safeDeletePrompt` 的组装。
5. 勾选表的目标类目前用「输入框 + `note` 里列候选」而不是上游的 `ClassChooser` 树形弹窗；候选多于一个时用户能手输另一个类名（`memberMoveEdits` 会按名字精确匹配并在找不到时给中文错误）。这是本仓架构下的降级形态，如实登记，不是假控件。
6. `openChangeSignature` 与 `openSafeDelete` 走的是 `editorFor(path).getCursor()`；编辑器实例不在（比如该文件在另一个分栏没挂载）时回退到 `tab.line/column`，与 `src/refactorSignatureFlow.ts:140` 原口径一致。
