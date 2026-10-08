# 接线请求 · 桶 1（重构 / 生成 / 代码风格 / 格式化）· 2026-10-06

> 格式照 `docs/batches-2026-10-06-buckets.md` §4。目标文件全部是**保留文件**（§1），桶 1 只读，
> 所以这些改动由主代理统一做。每条都给了**可直接粘贴**的代码与上游坐标。
> 已复核：`RefactorPreviewDialog` 的挂载点在 `src/App.vue:2399`，**不在本清单里**（不用再交）。

## A1 · `src/keymapBindings.ts`：更改签名 Ctrl+F6 进出厂键位表

- 目标文件：`src/keymapBindings.ts`，`KEY_BINDINGS` 数组里 `refactor.extractVariable` 那一条**之前**
  （数组顺序 = 分派优先级；上游 `$default.xml` 里 ChangeSignature(:469) 在 IntroduceVariable(:321) 之后，
  但本表按「editor 域内不冲突即可」排，Ctrl+F6 与表内任何一条都不撞）。
- 要接什么：
  ```ts
  { id: 'refactor.changeSignature', label: '更改签名…', display: 'Ctrl F6', scope: 'editor',
    chord: { key: 'f6', control: 'ctrl', forbid: ['shift'] }, upstream: '$default.xml:469-471' },
    // 上游 first-keystroke="control F6"（$default.xml:470）；`forbid: ['shift']` 是因为 Ctrl+Shift+F6 属于别的动作
  ```
- 为什么需要：`更改签名` 菜单行已经带 `keys: 'Ctrl F6'`（`src/menus/refactorMenu.ts:73`），
  但出厂表里没有这一条 ⇒ 键位表与实际行为仍不一致，`keymapKeys('refactor.changeSignature')` 回空串。
- 上游依据：`platform/platform-resources/src/keymaps/$default.xml:469-471`（本次已按行核过：
  `:469` `<action id="ChangeSignature">`、`:470` `first-keystroke="control F6"`）。
  判词原文写的「`$default.xml:917-920` = Unwrap」经核对实际在 `:918-920`，且动作 id 是 `Unwrap`（不是 `UnwrapRemove`）。

## A2 · `src/keymap.ts`：分派表补上这个动作 id

- 目标文件：`src/keymap.ts`，`findKeyBinding` 结果的那个 id→handler 映射（现有写法见
  `src/keymap.ts:367-370` 的 `'refactor.extractVariable'`/`'refactor.extractConstant'`/
  `'refactor.extractMethod'`/`'refactor.inline'` 四条）。
- 要接什么：`'refactor.changeSignature': () => void openChangeSignature()`（与
  `'refactor.safeDelete': () => void openSafeDelete(active.value)` 同批加；两者都依赖 A3 的处理函数）。
  Alt+Delete 那条要一并进 A1 的表：`{ id: 'refactor.safeDelete', label: '安全删除…', display: 'Alt Delete',
  scope: 'editor', chord: { key: 'delete', control: 'alt' }, upstream: '$default.xml:999-1001' }`。
  成员上移/下移**不加键位**：`MembersPullUp`/`MemberPushDown` 在 `$default.xml` 里没有默认键位（已按 id 逐条搜过）。
- 为什么需要：键位表与分派表是一体的（`KEY_BINDINGS` 只出「按下了哪个动作」，动作干什么在这张映射里）。
- 上游依据：`platform/platform-resources/src/keymaps/$default.xml:469-471`（ChangeSignature）、
  `:999-1001`（SafeDelete = `alt DELETE`）、`:918-920`（Unwrap = `control shift DELETE`）。

## A3 · `src/App.vue`：`refactorMenuContext` 补 5 个处理函数 + 挂更改签名对话框

- 目标文件：`src/App.vue` 第 1537 行附近（`const refactorMenuContext: RefactorMenuContext = { … }`）
  与模板末尾（`<RefactorPreviewDialog …>` 在 2399 行，新对话框跟它并列）。
- 要接什么（`src/menus/refactorMenu.ts` 已把这五行改成**按能力渲染**：ctx 上没有处理函数就不出现，
  所以现在菜单里看不到它们；接上哪条就出现哪条，不会出现点了没反应的行）：
  ```ts
  const changeSignature = createChangeSignatureFlow({ active, findTab, tabs, editorFor, notify,
    workspace: () => workspace.value, isDesktop, languageOf, applyEditsToFiles, renamePreviewOf,
    conflictMessage, openPreview })   // src/refactorSignatureFlow.ts:79
  // refactorMenuContext 里补：openChangeSignature, openSafeDelete, openPullUp, openPushDown,
  //                          openIntroduceParameterObject
  ```
  ```html
  <RefactorSignatureDialog v-if="changeSignature.changeSignatureState.value"
    :model="changeSignature.changeSignatureState.value" @apply="changeSignature.applyChangeSignature()"
    @cancel="changeSignature.closeChangeSignature()" @add="changeSignature.addParam()"
    @remove="changeSignature.removeParam()" @move="changeSignature.moveParam($event)"
    @select="changeSignature.selectRow($event)" @param="changeSignature.setParam($event.index, $event.patch)"
    @rename="changeSignature.setName($event)" @returntype="changeSignature.setReturnType($event)" />
  ```
  即：`import RefactorSignatureDialog from './components/RefactorSignatureDialog.vue'`，
  同处把 `openChangeSignature` 传进 `refactorMenuContext`。
- 为什么需要：`src/refactorSignature.ts`（模型）+ `src/refactorSignatureFlow.ts`（编排）+
  `src/components/RefactorSignatureDialog.vue`（界面）三件都已落地并互相引用，
  只差宿主那一次装配；缺它这三个模块就是「只有测试消费」。
- 上游依据：`LangActions.xml:358`（ChangeSignature 那一行）、
  `ChangeSignatureDialogBase.java:151/:236/:261/:340/:476/:556`（对话框字段次序与控件）。

## A4 · `src/App.vue` + `src/refactorMemberMove.ts` / `src/refactorIntroduceParameterObject.ts`：
##      成员上移/下移 与 引入形参对象 的宿主编排

- 目标文件：`src/App.vue`（同 A3 那一个 context）。
- 要接什么：`openPullUp` / `openPushDown` 用 `src/refactorMemberMove.ts` 的
  `findMemberMoveClasses()` + `classMembers()` 出勾选表（上游 `MemberSelectionPanel`），
  目标类由 `extends` 的类名在工作区里找同名类（找不到就报错，不猜），
  编辑交给既有的 `renamePreviewOf` + `openPreview` 链路；
  `openIntroduceParameterObject` 用 `src/refactorIntroduceParameterObject.ts` 的
  `parameterObjectEdits()`，勾选表面板次序 = `PARAMETER_OBJECT_PANELS`
  （要提取形参的方法 → 形参类 → 要提取的形参），复选框只在 `supportsDelegate(language)` 为真时给。
- 为什么需要：模型与判据已完成（`tests/refactor-member-move.test.mjs` 11 条、
  `tests/refactor-introduce-parameter-object.test.mjs` 10 条），装配面在保留文件里。
- 上游依据：`LangActions.xml:372`（IntroduceParameterObject）、`:391-392`（MembersPullUp/MemberPushDown）、
  `RefactoringBundle.properties:56/:129/:133/:261/:262/:264/:266/:395/:398/:399/:482`、
  `AbstractIntroduceParameterObjectDialog.java:66-105`、`PushDownDialog.java:31-36`。

## A5 · `src/treeActions.ts`（桶 14 名下）：安全删除三选一对话框的用法账

- 目标文件：`src/treeActions.ts:114-125`（`beginDelete` 的 `warnBeforeDelete`）。
- 要接什么：现在只调 `safeDeleteNotice(baseName, safeDeleteReport(result.refs))`（代码引用一句话）。
  把 `nonCodeReport(files, word)`（`src/nonCodeUsages.ts:225`）的结果一并传进
  `safeDeletePrompt(name, refs, nonCode, options)`（`src/safeDelete.ts:141`），
  按 `prompt.blocked` 决定弹不弹三选一（`查看用法` 是默认项，回车落它，`UnsafeUsagesDialog.java:41-47`），
  勾选项用 `defaultSafeDeleteOptions()`（`SafeDeleteDialog.java:163-165`）。
- 为什么需要：`safeDeletePrompt` 的模型/文案/次序/截断说明都已带判据，缺的只是把注释与字符串
  里的用法账算进去并弹窗。删除入口在树侧，不在本桶名下。
- 上游依据：`platform/lang-impl/src/com/intellij/refactoring/safeDelete/UnsafeUsagesDialog.java:35/:36/:41-47/:58`、
  `SafeDeleteProcessor.java:449-464`、`RefactoringBundle.properties:312/:313/:316/:317/:318`。

## A6 · `src/components/CodeEditor.vue` / `src/editorCommands.ts`：Unwrap 多候选的 chooser

- 现状：`findUnwrapCandidates()`（`src/unwrap.ts:161`，最内层在前、每层带关键字标签）已落地并有判据
  （`tests/unwrap-candidates.test.mjs`），但 `src/editorCommands.ts:138` 只挂 `unwrapCommand`，
  即**直接拆最内层**，多候选列表没有 chooser。
- 要接什么：`Ctrl+Shift+Delete` 触发时列 `findUnwrapCandidates(text, from, to, indentWidth)`；
  只有一条时直接拆（现状），多于一条时弹层选「拆掉 if 包裹」这类标签。
- 为什么需要：判词里「缺：多候选的 chooser UI」。这两个文件都在保留/他桶名下（`CodeEditor.vue` §1、
  `editorCommands.ts` 桶 5）。
- 上游依据：`$default.xml:918-920`（`Unwrap` = control shift DELETE）。

## 不做（不是没接，是**不能真做**，别在主代理那边重开）

1. **Safe Delete / Rename 的「搜索注释/字符串」入参**：本仓 rename/references 走 LSP
   （`textDocument/rename`、`textDocument/references`），这两个请求**不接受**「include comments /
   include non-code」这类入参，也没有别的宿主请求能补齐（`native/` 里只有 `file.usages` 的整仓文本扫描，
   它给的是字面出现，不是语义引用）。上游那两个复选框（`SafeDeleteDialog.java:149/155`、
   `RenameDialog.java:281`）在本仓的口径是：
   · 字面出现那一半**能真做** —— `src/nonCodeUsages.ts` 已经做出来（注释/字符串区间扫描 + 分类账），
     只是要按 A5 接进对话框；
   · 「把它当 rename 入参传给语言服务」那一半**不能做** —— 所以 `defaultSafeDeleteOptions()`
     的 `searchTextOccurrences` 默认**关**（`src/safeDelete.ts:101`），并在文案里写清没扫就是不扫。
2. **「传播形参」按钮**（`ChangeSignatureDialogBase.java:394-421`，alt G `:476`）：
   `createCallerChooser` 要 PSI 的调用者层级，本仓没有 PSI，LSP 也没有 call-hierarchy 的宿主实现 ⇒
   对话框里**没有**那个按钮（不是灰着，是不渲染）。
3. **可见性下拉 / 生成委托面板**（`ChangeSignatureDialogBase.java:249/:322-330`）：同上，不渲染。
4. **InvertBoolean**（`LangActions.xml:393`）：需要表达式级 PSI 取反，本仓菜单里没有这一行。
5. **ExtractClass/ExtractInclude/ExtractInterface/ExtractSuperclass/ExtractModule**
   （`LangActions.xml:378-382`）、**IntroduceField/IntroduceParameter**（`:367/:368`）：
   均无落点，菜单里不出现（`tests/refactor-menu-parity.test.mjs` 的 id 判据守着）。

## 处理结果（wiring-backlog lane，2026-10-06）

- **A1 已接线**：`src/keymapBindings.ts:127` `refactor.changeSignature`（Ctrl F6）、`:132` `refactor.safeDelete`（Alt Delete）。
- **A2 已接线**：`src/keymap.ts:402` `'refactor.changeSignature': () => openChangeSignature()`、`:403` `'refactor.safeDelete': () => void openSafeDelete()`。
- **A3 已接线**：`src/App.vue:1620` 的 `refactorMenuContext` 已含 `openChangeSignature / openPullUp / openPushDown / openIntroduceParameterObject / openSafeDelete`；`:2473` 已挂 `<RefactorSignatureDialog v-if="changeSignatureState" …>`（及 `RefactorMemberChooserDialog` / `RefactorSafeDeleteDialog`）。

结论：**零待接**，未改任何文件。
